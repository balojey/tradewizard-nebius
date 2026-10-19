/**
 * WebSocket $connect handler.
 *
 * Validates the JWT token from the query string, extracts the userId,
 * and stores the connectionId in DynamoDB with a 24-hour TTL.
 *
 * Stores the *internal* users.id (not the Cognito sub) so all downstream
 * services can address WebSocket connections using the same user identifier
 * that lives in RDS foreign keys.
 *
 * Environment variables:
 * - CONNECTIONS_TABLE: DynamoDB table name for WebSocket connections
 * - COGNITO_USER_POOL_ID: Cognito User Pool ID for JWT issuer validation
 * - DB_SECRET_ARN: Secrets Manager ARN for RDS credentials (sub→id lookup)
 * - DB_HOST: RDS endpoint hostname
 * - AWS_REGION: AWS region for Cognito issuer URL
 */

import { APIGatewayProxyHandler, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
import * as jwt from 'jsonwebtoken';
import * as https from 'https';
import { getUserIdByCognitoSub } from '../shared/db';

const dynamoClient = new DynamoDBClient({});
const CONNECTIONS_TABLE = process.env.CONNECTIONS_TABLE || '';
const COGNITO_USER_POOL_ID = process.env.COGNITO_USER_POOL_ID || '';
const REGION = process.env.AWS_REGION || 'us-east-1';

// Cache for Cognito JWKS keys
let cachedJwks: JwksKey[] | null = null;

interface JwksKey {
  kid: string;
  kty: string;
  alg: string;
  use: string;
  n: string;
  e: string;
}

interface CognitoJwtPayload {
  sub: string;
  iss: string;
  token_use: string;
  client_id: string;
  exp: number;
  iat: number;
  email?: string;
}

/**
 * Fetch JWKS from Cognito User Pool.
 */
async function getJwks(): Promise<JwksKey[]> {
  if (cachedJwks) return cachedJwks;

  const issuer = `https://cognito-idp.${REGION}.amazonaws.com/${COGNITO_USER_POOL_ID}`;
  const jwksUrl = `${issuer}/.well-known/jwks.json`;

  return new Promise((resolve, reject) => {
    https.get(jwksUrl, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const jwks = JSON.parse(data);
          cachedJwks = jwks.keys as JwksKey[];
          resolve(cachedJwks);
        } catch (err) {
          reject(new Error(`Failed to parse JWKS: ${err}`));
        }
      });
    }).on('error', (err) => {
      reject(new Error(`Failed to fetch JWKS: ${err.message}`));
    });
  });
}

/**
 * Convert a JWKS key to PEM format for jwt.verify.
 */
function jwkToPem(jwk: JwksKey): string {
  // Build RSA public key in PEM format from n and e components
  const n = Buffer.from(jwk.n, 'base64url');
  const e = Buffer.from(jwk.e, 'base64url');

  // DER encoding for RSA public key
  const encodedN = encodeLength(n);
  const encodedE = encodeLength(e);

  const sequenceContent = Buffer.concat([
    Buffer.from([0x02]), encodedN,
    Buffer.from([0x02]), encodedE,
  ]);

  const sequence = Buffer.concat([
    Buffer.from([0x30]),
    derLength(sequenceContent.length),
    sequenceContent,
  ]);

  // RSA OID: 1.2.840.113549.1.1.1
  const rsaOid = Buffer.from([
    0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86,
    0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00,
  ]);

  const bitString = Buffer.concat([
    Buffer.from([0x03]),
    derLength(sequence.length + 1),
    Buffer.from([0x00]),
    sequence,
  ]);

  const publicKeyInfo = Buffer.concat([
    Buffer.from([0x30]),
    derLength(rsaOid.length + bitString.length),
    rsaOid,
    bitString,
  ]);

  const pem = [
    '-----BEGIN PUBLIC KEY-----',
    publicKeyInfo.toString('base64').match(/.{1,64}/g)!.join('\n'),
    '-----END PUBLIC KEY-----',
  ].join('\n');

  return pem;
}

function encodeLength(buf: Buffer): Buffer {
  // If the high bit is set, prepend a 0x00 byte
  const needsPadding = buf[0] & 0x80;
  const content = needsPadding ? Buffer.concat([Buffer.from([0x00]), buf]) : buf;
  return Buffer.concat([derLength(content.length), content]);
}

function derLength(length: number): Buffer {
  if (length < 0x80) {
    return Buffer.from([length]);
  }
  const bytes: number[] = [];
  let temp = length;
  while (temp > 0) {
    bytes.unshift(temp & 0xff);
    temp >>= 8;
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

/**
 * Validate a Cognito JWT token and return the payload.
 */
async function validateToken(token: string): Promise<CognitoJwtPayload> {
  const issuer = `https://cognito-idp.${REGION}.amazonaws.com/${COGNITO_USER_POOL_ID}`;

  // Decode header to get kid
  const decoded = jwt.decode(token, { complete: true });
  if (!decoded || !decoded.header.kid) {
    throw new Error('Invalid token: missing kid in header');
  }

  // Get matching key from JWKS
  const jwks = await getJwks();
  const key = jwks.find((k) => k.kid === decoded.header.kid);
  if (!key) {
    throw new Error('Invalid token: no matching key found');
  }

  // Convert JWK to PEM and verify
  const pem = jwkToPem(key);
  const payload = jwt.verify(token, pem, {
    issuer,
    algorithms: ['RS256'],
  }) as CognitoJwtPayload;

  // Verify token_use is 'access' or 'id'
  if (payload.token_use !== 'access' && payload.token_use !== 'id') {
    throw new Error('Invalid token: unexpected token_use');
  }

  return payload;
}

/**
 * WebSocket $connect Lambda handler.
 *
 * Note: The $connect route receives a full HTTP-like event with queryStringParameters,
 * so we use APIGatewayProxyHandler (V1 type) which correctly types this.
 */
export const handler: APIGatewayProxyHandler = async (event): Promise<APIGatewayProxyResult> => {
  const connectionId = event.requestContext.connectionId!;

  // Extract token from query string
  const token = event.queryStringParameters?.token;
  if (!token) {
    console.warn('Connection rejected: missing token in query string');
    return { statusCode: 401, body: 'Unauthorized' };
  }

  // Validate JWT and extract userId
  let cognitoSub: string;
  try {
    const payload = await validateToken(token);
    cognitoSub = payload.sub;
  } catch (err) {
    console.warn('Connection rejected: invalid token', err);
    return { statusCode: 401, body: 'Unauthorized' };
  }

  // Translate cognito sub → internal users.id so the connections table is
  // keyed by the same identifier downstream services use (RDS FK / SNS event).
  // Falls back to the cognito sub if the user record hasn't been provisioned
  // yet (signup race condition); we still store the connection so a later
  // post-confirmation can stitch things together, but most code paths
  // tolerate the fallback because both are UUID-shaped strings.
  let internalUserId: string;
  try {
    const resolved = await getUserIdByCognitoSub(cognitoSub);
    internalUserId = resolved ?? cognitoSub;
    if (!resolved) {
      console.warn(
        `WS connect: no users row for cognito_sub=${cognitoSub}; storing sub as fallback`,
      );
    }
  } catch (err) {
    console.error('WS connect: cognito_sub→users.id lookup failed, using sub:', err);
    internalUserId = cognitoSub;
  }

  // Store connection in DynamoDB
  const now = new Date();
  const ttl = Math.floor(now.getTime() / 1000) + 86400; // 24 hours from now

  await dynamoClient.send(
    new PutItemCommand({
      TableName: CONNECTIONS_TABLE,
      Item: marshall({
        connectionId,
        userId: internalUserId,
        cognitoSub,
        connectedAt: now.toISOString(),
        ttl,
      }),
    })
  );

  console.log(`Connection stored: ${connectionId} for user ${internalUserId} (cognito_sub=${cognitoSub})`);
  return { statusCode: 200, body: 'Connected' };
};
