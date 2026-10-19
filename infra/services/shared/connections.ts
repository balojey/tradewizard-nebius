/**
 * Shared WebSocket connection utilities.
 *
 * Manages connection lifecycle in DynamoDB:
 * - Store new connections with 24h TTL
 * - Remove connections on disconnect
 * - Query all connections for a given user (via userId-index GSI)
 *
 * Environment variables:
 * - CONNECTIONS_TABLE: DynamoDB table name for WebSocket connections
 */

import {
  DynamoDBClient,
  PutItemCommand,
  DeleteItemCommand,
  QueryCommand,
} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';

const dynamoClient = new DynamoDBClient({});
const CONNECTIONS_TABLE = process.env.CONNECTIONS_TABLE || '';

/**
 * Store a WebSocket connection in DynamoDB with a 24-hour TTL.
 */
export async function storeConnection(
  connectionId: string,
  userId: string
): Promise<void> {
  const now = new Date();
  const ttl = Math.floor(now.getTime() / 1000) + 86400; // 24 hours from now

  await dynamoClient.send(
    new PutItemCommand({
      TableName: CONNECTIONS_TABLE,
      Item: marshall({
        connectionId,
        userId,
        connectedAt: now.toISOString(),
        ttl,
      }),
    })
  );
}

/**
 * Remove a WebSocket connection from DynamoDB.
 */
export async function removeConnection(connectionId: string): Promise<void> {
  await dynamoClient.send(
    new DeleteItemCommand({
      TableName: CONNECTIONS_TABLE,
      Key: marshall({ connectionId }),
    })
  );
}

/**
 * Get all active connection IDs for a user by querying the userId-index GSI.
 */
export async function getConnectionsByUserId(userId: string): Promise<string[]> {
  const response = await dynamoClient.send(
    new QueryCommand({
      TableName: CONNECTIONS_TABLE,
      IndexName: 'userId-index',
      KeyConditionExpression: 'userId = :uid',
      ExpressionAttributeValues: marshall({ ':uid': userId }),
    })
  );

  if (!response.Items || response.Items.length === 0) return [];
  return response.Items.map(
    (item) => (unmarshall(item) as { connectionId: string }).connectionId
  );
}
