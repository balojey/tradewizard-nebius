#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { NetworkStack } from '../lib/network-stack';
import { DatabaseStack } from '../lib/database-stack';
import { AuthStack } from '../lib/auth-stack';
import { QueueStack } from '../lib/queue-stack';
import { StorageStack } from '../lib/storage-stack';
import { NotificationStack } from '../lib/notification-stack';
import { ComputeStack } from '../lib/compute-stack';
import { MonitoringStack } from '../lib/monitoring-stack';
import { EnvironmentName, getEnvironmentConfig } from '../lib/config';

const app = new cdk.App();

// Determine environment from context or default to development
// deploy.sh passes short names ('dev'/'prod'), map to full names
const rawEnv = app.node.tryGetContext('env') || 'development';
const envName: EnvironmentName = rawEnv === 'prod' || rawEnv === 'production'
  ? 'production'
  : 'development';
const config = getEnvironmentConfig(envName);

const env: cdk.Environment = {
  account: config.account || process.env.CDK_DEFAULT_ACCOUNT,
  region: config.region || process.env.CDK_DEFAULT_REGION || 'us-east-1',
};

console.log(`\n🚀 Deploying TradeWizard infrastructure for: ${envName.toUpperCase()}\n`);

// Stack naming convention: TradeWizard-{Env}-{Service}
const stackPrefix = envName === 'production' ? 'TradeWizard-Prod' : 'TradeWizard-Dev';

// 1. Network (VPC, subnets, security groups)
const networkStack = new NetworkStack(app, `${stackPrefix}-Network`, {
  env,
  config,
  description: `TradeWizard ${envName} - VPC and networking`,
});

// 2. Database (RDS PostgreSQL, DynamoDB)
const databaseStack = new DatabaseStack(app, `${stackPrefix}-Database`, {
  env,
  config,
  vpc: networkStack.vpc,
  databaseSecurityGroup: networkStack.databaseSecurityGroup,
  description: `TradeWizard ${envName} - RDS and DynamoDB`,
});
databaseStack.addDependency(networkStack);

// 3. Auth (Cognito user pool + post-confirmation user provisioning)
const authStack = new AuthStack(app, `${stackPrefix}-Auth`, {
  env,
  config,
  dbSecret: databaseStack.dbSecret,
  dbEndpoint: databaseStack.dbEndpoint,
  description: `TradeWizard ${envName} - Cognito authentication`,
});
authStack.addDependency(databaseStack);

// 4. Storage (S3 buckets)
const storageStack = new StorageStack(app, `${stackPrefix}-Storage`, {
  env,
  config,
  description: `TradeWizard ${envName} - S3 storage`,
});

// 5. Queue (SQS queues, EventBridge)
const queueStack = new QueueStack(app, `${stackPrefix}-Queue`, {
  env,
  config,
  description: `TradeWizard ${envName} - SQS and EventBridge`,
});

// 6. Notifications (SNS topics; email delivery via Resend with SES retained)
const notificationStack = new NotificationStack(app, `${stackPrefix}-Notification`, {
  env,
  config,
  description: `TradeWizard ${envName} - SNS notifications (Resend/SES email delivery)`,
});

// 7. Compute (REST API + WebSocket API + Lambda functions)
// The REST API, routes, authorizer, and all Lambda integrations live in one stack
// to avoid CDK cross-stack circular dependency issues.
const computeStack = new ComputeStack(app, `${stackPrefix}-Compute`, {
  env,
  config,
  analysisQueue: queueStack.analysisQueue,
  analysisBucket: storageStack.analysisBucket,
  dedupCacheTable: databaseStack.dedupCacheTable,
  connectionsTable: databaseStack.connectionsTable,
  rateLimitTable: databaseStack.rateLimitTable,
  renewalDedupTable: databaseStack.renewalDedupTable,
  dbSecret: databaseStack.dbSecret,
  dbEndpoint: databaseStack.dbEndpoint,
  eventBus: queueStack.eventBus,
  analysisCompleteTopic: notificationStack.analysisCompleteTopic,
  systemNotificationsTopic: notificationStack.systemNotificationsTopic,
  userPool: authStack.userPool,
  backendClient: authStack.backendClient,
  frontendClientId: authStack.userPoolClient.userPoolClientId,
  description: `TradeWizard ${envName} - Lambda functions`,
});
computeStack.addDependency(databaseStack);
computeStack.addDependency(queueStack);
computeStack.addDependency(storageStack);
computeStack.addDependency(notificationStack);
computeStack.addDependency(authStack);

// 10. Monitoring (CloudWatch dashboards, alarms)
const monitoringStack = new MonitoringStack(app, `${stackPrefix}-Monitoring`, {
  env,
  config,
  analysisQueue: queueStack.analysisQueue,
  deadLetterQueue: queueStack.deadLetterQueue,
  tracesBucket: storageStack.tracesBucket,
  description: `TradeWizard ${envName} - CloudWatch monitoring`,
});
monitoringStack.addDependency(queueStack);
monitoringStack.addDependency(storageStack);

// 8. Hosting - Managed via AWS Amplify Console (GitHub App integration).
// No CDK stack needed. The amplify.yml in the repo root defines the build spec.
// Connect the repo in the Amplify Console and set up prod + main branches there.

// Tag all resources
cdk.Tags.of(app).add('Project', 'TradeWizard');
cdk.Tags.of(app).add('Environment', envName);
cdk.Tags.of(app).add('ManagedBy', 'CDK');
