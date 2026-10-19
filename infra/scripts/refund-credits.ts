/**
 * Quick script to refund credits to a user.
 * Usage: npx tsx scripts/refund-credits.ts <email> <amount>
 */

import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import pg from 'pg';

const email = process.argv[2];
const amount = parseInt(process.argv[3] || '3', 10);

if (!email) {
  console.error('Usage: npx tsx scripts/refund-credits.ts <email> <amount>');
  process.exit(1);
}

const secretsClient = new SecretsManagerClient({ region: 'us-east-2' });

async function main() {
  // Get DB credentials
  const secretResp = await secretsClient.send(
    new GetSecretValueCommand({
      SecretId: 'arn:aws:secretsmanager:us-east-2:800762439770:secret:tw-dev-db-credentials-qIq8Sd',
    })
  );
  const creds = JSON.parse(secretResp.SecretString || '{}');

  const client = new pg.Client({
    host: 'tw-dev-postgres.cdi6qwmya0qp.us-east-2.rds.amazonaws.com',
    port: 5432,
    database: 'tradewizard',
    user: creds.username,
    password: creds.password,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  const result = await client.query(
    `UPDATE subscriptions SET credits_remaining = credits_remaining + $1
     WHERE user_id = (SELECT id FROM users WHERE email = $2)
     RETURNING credits_remaining`,
    [amount, email]
  );

  if (result.rows.length > 0) {
    console.log(`✅ Refunded ${amount} credits to ${email}. New balance: ${result.rows[0].credits_remaining}`);
  } else {
    console.log(`❌ No subscription found for ${email}`);
  }

  await client.end();
}

main().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
