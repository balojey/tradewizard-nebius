/**
 * WebSocket $disconnect handler.
 *
 * Removes the connectionId from DynamoDB when a client disconnects.
 *
 * Environment variables:
 * - CONNECTIONS_TABLE: DynamoDB table name for WebSocket connections
 */

import { APIGatewayProxyHandler, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient, DeleteItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';

const dynamoClient = new DynamoDBClient({});
const CONNECTIONS_TABLE = process.env.CONNECTIONS_TABLE || '';

/**
 * WebSocket $disconnect Lambda handler.
 *
 * Deletes the connection record from DynamoDB when a WebSocket client disconnects.
 */
export const handler: APIGatewayProxyHandler = async (event): Promise<APIGatewayProxyResult> => {
  const connectionId = event.requestContext.connectionId!;

  try {
    await dynamoClient.send(
      new DeleteItemCommand({
        TableName: CONNECTIONS_TABLE,
        Key: marshall({ connectionId }),
      })
    );

    console.log(`Connection removed: ${connectionId}`);
  } catch (err) {
    console.error(`Failed to remove connection ${connectionId}:`, err);
  }

  return { statusCode: 200, body: 'Disconnected' };
};
