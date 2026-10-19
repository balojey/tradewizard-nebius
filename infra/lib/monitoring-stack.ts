import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import { Construct } from 'constructs';
import { EnvironmentConfig, resourceName } from './config';

export interface MonitoringStackProps extends cdk.StackProps {
  config: EnvironmentConfig;
  analysisQueue: sqs.Queue;
  deadLetterQueue: sqs.Queue;
  tracesBucket: s3.Bucket;
}

/**
 * Monitoring stack: CloudWatch dashboards, alarms, and SNS topics for alerts.
 */
export class MonitoringStack extends cdk.Stack {
  public readonly alarmTopic: sns.Topic;

  constructor(scope: Construct, id: string, props: MonitoringStackProps) {
    super(scope, id, props);

    const { config, analysisQueue, deadLetterQueue, tracesBucket } = props;
    const isProd = config.envName === 'production';

    // SNS topic for alarm notifications
    this.alarmTopic = new sns.Topic(this, 'AlarmTopic', {
      topicName: resourceName(config.envName, 'alarms'),
      displayName: `TradeWizard ${config.envName} Alarms`,
    });

    // DLQ depth alarm (any message in DLQ = investigation needed)
    const dlqAlarm = new cloudwatch.Alarm(this, 'DlqDepthAlarm', {
      alarmName: resourceName(config.envName, 'dlq-depth'),
      alarmDescription: 'Dead letter queue has messages - analysis failures detected',
      metric: deadLetterQueue.metricApproximateNumberOfMessagesVisible({
        period: cdk.Duration.minutes(5),
        statistic: 'Maximum',
      }),
      threshold: 0,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    dlqAlarm.addAlarmAction(new actions.SnsAction(this.alarmTopic));

    // Analysis queue age alarm (messages sitting too long)
    const queueAgeAlarm = new cloudwatch.Alarm(this, 'QueueAgeAlarm', {
      alarmName: resourceName(config.envName, 'queue-age'),
      alarmDescription: 'Analysis queue messages are aging - possible processing bottleneck',
      metric: analysisQueue.metricApproximateAgeOfOldestMessage({
        period: cdk.Duration.minutes(5),
        statistic: 'Maximum',
      }),
      threshold: isProd ? 300 : 600, // 5 min prod, 10 min dev
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 2,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    queueAgeAlarm.addAlarmAction(new actions.SnsAction(this.alarmTopic));

    // CloudWatch Dashboard
    const dashboard = new cloudwatch.Dashboard(this, 'Dashboard', {
      dashboardName: resourceName(config.envName, 'overview'),
    });

    // Queue metrics row
    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Analysis Queue Depth',
        left: [
          analysisQueue.metricApproximateNumberOfMessagesVisible({
            period: cdk.Duration.minutes(1),
          }),
          analysisQueue.metricApproximateNumberOfMessagesNotVisible({
            period: cdk.Duration.minutes(1),
          }),
        ],
        width: 12,
      }),
      new cloudwatch.GraphWidget({
        title: 'Dead Letter Queue',
        left: [
          deadLetterQueue.metricApproximateNumberOfMessagesVisible({
            period: cdk.Duration.minutes(1),
          }),
        ],
        width: 6,
      }),
      new cloudwatch.SingleValueWidget({
        title: 'Queue Age (seconds)',
        metrics: [
          analysisQueue.metricApproximateAgeOfOldestMessage({
            period: cdk.Duration.minutes(1),
          }),
        ],
        width: 6,
      })
    );

    // Bedrock metrics row (custom metrics will be published by the orchestrator)
    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Bedrock Invocations',
        left: [
          new cloudwatch.Metric({
            namespace: 'TradeWizard',
            metricName: 'BedrockInvocations',
            dimensionsMap: { Environment: config.envName },
            period: cdk.Duration.minutes(5),
            statistic: 'Sum',
          }),
        ],
        width: 8,
      }),
      new cloudwatch.GraphWidget({
        title: 'Analysis Duration (ms)',
        left: [
          new cloudwatch.Metric({
            namespace: 'TradeWizard',
            metricName: 'AnalysisDuration',
            dimensionsMap: { Environment: config.envName },
            period: cdk.Duration.minutes(5),
            statistic: 'Average',
          }),
        ],
        width: 8,
      }),
      new cloudwatch.GraphWidget({
        title: 'Cache Hit Rate',
        left: [
          new cloudwatch.Metric({
            namespace: 'TradeWizard',
            metricName: 'CacheHitRate',
            dimensionsMap: { Environment: config.envName },
            period: cdk.Duration.minutes(5),
            statistic: 'Average',
          }),
        ],
        width: 8,
      })
    );

    // Business metrics row
    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Analysis Requests',
        left: [
          new cloudwatch.Metric({
            namespace: 'TradeWizard',
            metricName: 'AnalysisRequests',
            dimensionsMap: { Environment: config.envName },
            period: cdk.Duration.minutes(5),
            statistic: 'Sum',
          }),
        ],
        width: 8,
      }),
      new cloudwatch.GraphWidget({
        title: 'Credits Consumed',
        left: [
          new cloudwatch.Metric({
            namespace: 'TradeWizard',
            metricName: 'CreditsConsumed',
            dimensionsMap: { Environment: config.envName },
            period: cdk.Duration.hours(1),
            statistic: 'Sum',
          }),
        ],
        width: 8,
      }),
      new cloudwatch.GraphWidget({
        title: 'Active Subscribers',
        left: [
          new cloudwatch.Metric({
            namespace: 'TradeWizard',
            metricName: 'ActiveSubscribers',
            dimensionsMap: { Environment: config.envName },
            period: cdk.Duration.hours(1),
            statistic: 'Maximum',
          }),
        ],
        width: 8,
      })
    );

    // ─── Bedrock Model Invocation Logging ─────────────────────────────────────
    // Captures full request/response payloads for all Bedrock calls in this region.
    // Logs tool_use and tool_result blocks so we can verify agents use their tools.

    const bedrockLogGroup = new logs.LogGroup(this, 'BedrockInvocationLogs', {
      logGroupName: `/aws/bedrock/${resourceName(config.envName, 'model-invocations')}`,
      retention: isProd ? logs.RetentionDays.ONE_MONTH : logs.RetentionDays.ONE_WEEK,
      removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });

    // IAM role that Bedrock assumes to write logs
    const bedrockLoggingRole = new iam.Role(this, 'BedrockLoggingRole', {
      roleName: resourceName(config.envName, 'bedrock-logging'),
      assumedBy: new iam.ServicePrincipal('bedrock.amazonaws.com'),
      description: 'Allows Amazon Bedrock to write model invocation logs to CloudWatch and S3',
    });

    bedrockLogGroup.grantWrite(bedrockLoggingRole);
    tracesBucket.grantWrite(bedrockLoggingRole, 'bedrock-invocation-logs/*');

    // Bedrock validates that the S3 bucket policy explicitly allows it to write.
    // The IAM role grant alone is not sufficient - we need a resource-based policy on the bucket.
    tracesBucket.addToResourcePolicy(new iam.PolicyStatement({
      sid: 'AllowBedrockInvocationLogging',
      effect: iam.Effect.ALLOW,
      principals: [new iam.ServicePrincipal('bedrock.amazonaws.com')],
      actions: ['s3:PutObject'],
      resources: [tracesBucket.arnForObjects('bedrock-invocation-logs/*')],
      conditions: {
        StringEquals: {
          'aws:SourceAccount': cdk.Aws.ACCOUNT_ID,
        },
      },
    }));

    // Enable Bedrock model invocation logging via CloudFormation custom resource
    // CDK doesn't have an L2 construct for this yet - use CfnResource with AWS::Bedrock::* or SDK call.
    // The simplest approach: use AwsCustomResource to call PutModelInvocationLoggingConfiguration.
    const bedrockLoggingConfig = new cdk.custom_resources.AwsCustomResource(this, 'BedrockLoggingConfig', {
      onCreate: {
        service: 'Bedrock',
        action: 'putModelInvocationLoggingConfiguration',
        parameters: {
          loggingConfig: {
            cloudWatchConfig: {
              logGroupName: bedrockLogGroup.logGroupName,
              roleArn: bedrockLoggingRole.roleArn,
              largeDataDeliveryS3Config: {
                bucketName: tracesBucket.bucketName,
                keyPrefix: 'bedrock-invocation-logs/large-data',
              },
            },
            s3Config: {
              bucketName: tracesBucket.bucketName,
              keyPrefix: 'bedrock-invocation-logs',
            },
            textDataDeliveryEnabled: true,
            imageDataDeliveryEnabled: false,
            embeddingDataDeliveryEnabled: false,
          },
        },
        physicalResourceId: cdk.custom_resources.PhysicalResourceId.of('bedrock-logging-config'),
      },
      onUpdate: {
        service: 'Bedrock',
        action: 'putModelInvocationLoggingConfiguration',
        parameters: {
          loggingConfig: {
            cloudWatchConfig: {
              logGroupName: bedrockLogGroup.logGroupName,
              roleArn: bedrockLoggingRole.roleArn,
              largeDataDeliveryS3Config: {
                bucketName: tracesBucket.bucketName,
                keyPrefix: 'bedrock-invocation-logs/large-data',
              },
            },
            s3Config: {
              bucketName: tracesBucket.bucketName,
              keyPrefix: 'bedrock-invocation-logs',
            },
            textDataDeliveryEnabled: true,
            imageDataDeliveryEnabled: false,
            embeddingDataDeliveryEnabled: false,
          },
        },
        physicalResourceId: cdk.custom_resources.PhysicalResourceId.of('bedrock-logging-config'),
      },
      onDelete: {
        service: 'Bedrock',
        action: 'deleteModelInvocationLoggingConfiguration',
        parameters: {},
      },
      policy: cdk.custom_resources.AwsCustomResourcePolicy.fromStatements([
        new iam.PolicyStatement({
          actions: [
            'bedrock:PutModelInvocationLoggingConfiguration',
            'bedrock:GetModelInvocationLoggingConfiguration',
            'bedrock:DeleteModelInvocationLoggingConfiguration',
          ],
          resources: ['*'],
        }),
        new iam.PolicyStatement({
          actions: ['iam:PassRole'],
          resources: [bedrockLoggingRole.roleArn],
        }),
      ]),
    });

    bedrockLoggingConfig.node.addDependency(bedrockLogGroup);
    bedrockLoggingConfig.node.addDependency(bedrockLoggingRole);

    new cdk.CfnOutput(this, 'BedrockLogGroupName', {
      value: bedrockLogGroup.logGroupName,
      exportName: resourceName(config.envName, 'bedrock-log-group'),
    });

    // Outputs
    new cdk.CfnOutput(this, 'AlarmTopicArn', {
      value: this.alarmTopic.topicArn,
      exportName: resourceName(config.envName, 'alarm-topic-arn'),
    });

    new cdk.CfnOutput(this, 'DashboardUrl', {
      value: `https://${config.region}.console.aws.amazon.com/cloudwatch/home?region=${config.region}#dashboards:name=${resourceName(config.envName, 'overview')}`,
    });
  }
}
