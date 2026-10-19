import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';
import { EnvironmentConfig, resourceName } from './config';

export interface DatabaseStackProps extends cdk.StackProps {
  config: EnvironmentConfig;
  vpc: ec2.Vpc;
  databaseSecurityGroup: ec2.SecurityGroup;
}

/**
 * Database stack: Standard RDS PostgreSQL + DynamoDB tables.
 *
 * Standard RDS PostgreSQL (db.t4g.micro) chosen for cost efficiency at low traffic:
 * - Fixed ~$12/month (single-AZ, on-demand) vs Aurora Serverless v2 minimum ~$43/month
 * - Same PostgreSQL wire protocol - zero code changes in Lambda handlers
 * - Sufficient for 1-2 users/day (2 vCPU, 1 GB RAM, burstable)
 * - Easy upgrade path: change instance class or switch back to Aurora when traffic grows
 *
 * Cost optimization:
 * - NO ElastiCache (saves $12-48/mo) - DynamoDB with TTL handles dedup/cache
 * - Single-AZ (no standby replica) - acceptable for non-critical/hackathon workloads
 * - db.t4g.micro: ~$12.10/mo on-demand (cheapest Graviton instance)
 * - DynamoDB pay-per-request (pennies at low volume)
 *
 * DynamoDB replaces Redis for:
 * - Deduplication cache (TTL-based expiry)
 * - WebSocket connection tracking
 * - Rate limiting counters
 */
export class DatabaseStack extends cdk.Stack {
  public readonly dbInstance: rds.DatabaseInstance;
  public readonly dbEndpoint: string;
  public readonly dbSecret: secretsmanager.ISecret;
  public readonly connectionsTable: dynamodb.Table;
  public readonly rateLimitTable: dynamodb.Table;
  public readonly dedupCacheTable: dynamodb.Table;
  public readonly renewalDedupTable: dynamodb.Table;

  constructor(scope: Construct, id: string, props: DatabaseStackProps) {
    super(scope, id, props);

    const { config, vpc, databaseSecurityGroup } = props;
    const isProd = config.envName === 'production';

    // Database credentials stored in Secrets Manager
    const dbCredentials = new secretsmanager.Secret(this, 'DbCredentials', {
      secretName: resourceName(config.envName, 'db-credentials'),
      description: `TradeWizard ${config.envName} RDS PostgreSQL credentials`,
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: 'tradewizard' }),
        generateStringKey: 'password',
        excludePunctuation: true,
        passwordLength: 32,
      },
    });

    this.dbSecret = dbCredentials;

    // Standard RDS PostgreSQL instance (cost-optimized for low traffic)
    this.dbInstance = new rds.DatabaseInstance(this, 'PostgresInstance', {
      instanceIdentifier: resourceName(config.envName, 'postgres'),
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_18_3,
      }),
      credentials: rds.Credentials.fromSecret(dbCredentials),
      databaseName: 'tradewizard',
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      securityGroups: [databaseSecurityGroup],
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T4G,
        isProd ? ec2.InstanceSize.MICRO : ec2.InstanceSize.MICRO,
      ),
      allocatedStorage: 20,
      maxAllocatedStorage: 50, // Auto-expand up to 50 GB if needed
      multiAz: false, // Single-AZ for cost savings
      publiclyAccessible: config.rds.publiclyAccessible,
      storageEncrypted: true,
      deletionProtection: config.deletionProtection,
      removalPolicy: isProd ? cdk.RemovalPolicy.SNAPSHOT : cdk.RemovalPolicy.DESTROY,
      backupRetention: isProd ? cdk.Duration.days(7) : cdk.Duration.days(1),
      parameterGroup: new rds.ParameterGroup(this, 'PostgresDbParams', {
        engine: rds.DatabaseInstanceEngine.postgres({
          version: rds.PostgresEngineVersion.VER_18_3,
        }),
        parameters: {
          'rds.force_ssl': '1',
          'shared_preload_libraries': 'pg_stat_statements',
          'log_min_duration_statement': isProd ? '1000' : '500',
        },
      }),
    });

    // Expose the instance endpoint hostname directly
    this.dbEndpoint = this.dbInstance.instanceEndpoint.hostname;

    // ─── DynamoDB Tables (replaces ElastiCache Redis) ───────────────────────────

    // Deduplication cache table (replaces Redis dedup lookups)
    // Key: marketId, Sort: executedAt - TTL auto-expires stale entries
    this.dedupCacheTable = new dynamodb.Table(this, 'DedupCacheTable', {
      tableName: resourceName(config.envName, 'dedup-cache'),
      partitionKey: { name: 'marketId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'executedAt', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      timeToLiveAttribute: 'ttl',
    });

    // WebSocket connection IDs (transient, fast lookups)
    this.connectionsTable = new dynamodb.Table(this, 'ConnectionsTable', {
      tableName: resourceName(config.envName, 'ws-connections'),
      partitionKey: { name: 'connectionId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      timeToLiveAttribute: 'ttl',
    });

    // GSI to look up connections by userId (for targeted delivery)
    this.connectionsTable.addGlobalSecondaryIndex({
      indexName: 'userId-index',
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Rate limiting counters (atomic increments, TTL-based)
    this.rateLimitTable = new dynamodb.Table(this, 'RateLimitTable', {
      tableName: resourceName(config.envName, 'rate-limits'),
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      timeToLiveAttribute: 'ttl',
    });

    // Renewal deduplication table (idempotent subscription renewal processing)
    // Key: {subscription_id}#{billing_cycle_end_iso} - TTL auto-expires after 7 days
    this.renewalDedupTable = new dynamodb.Table(this, 'RenewalDedupTable', {
      tableName: resourceName(config.envName, 'renewal-dedup'),
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      timeToLiveAttribute: 'ttl',
    });

    // ─── Outputs ────────────────────────────────────────────────────────────────

    new cdk.CfnOutput(this, 'DbEndpoint', {
      value: this.dbInstance.instanceEndpoint.hostname,
      exportName: resourceName(config.envName, 'db-endpoint'),
    });

    new cdk.CfnOutput(this, 'DbPort', {
      value: this.dbInstance.instanceEndpoint.port.toString(),
      exportName: resourceName(config.envName, 'db-port'),
    });

    new cdk.CfnOutput(this, 'DbSecretArn', {
      value: dbCredentials.secretArn,
      exportName: resourceName(config.envName, 'db-secret-arn'),
    });

    new cdk.CfnOutput(this, 'DedupCacheTableName', {
      value: this.dedupCacheTable.tableName,
      exportName: resourceName(config.envName, 'dedup-cache-table'),
    });

    new cdk.CfnOutput(this, 'ConnectionsTableName', {
      value: this.connectionsTable.tableName,
      exportName: resourceName(config.envName, 'connections-table'),
    });

    new cdk.CfnOutput(this, 'RateLimitTableName', {
      value: this.rateLimitTable.tableName,
      exportName: resourceName(config.envName, 'rate-limit-table'),
    });

    new cdk.CfnOutput(this, 'RenewalDedupTableName', {
      value: this.renewalDedupTable.tableName,
      exportName: resourceName(config.envName, 'renewal-dedup-table'),
    });

    new cdk.CfnOutput(this, 'RenewalDedupTableArn', {
      value: this.renewalDedupTable.tableArn,
      exportName: resourceName(config.envName, 'renewal-dedup-table-arn'),
    });
  }
}
