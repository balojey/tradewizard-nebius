import * as cdk from 'aws-cdk-lib';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as events from 'aws-cdk-lib/aws-events';
import { Construct } from 'constructs';
import { EnvironmentConfig, resourceName } from './config';

export interface QueueStackProps extends cdk.StackProps {
  config: EnvironmentConfig;
}

/**
 * Queue stack: SQS queues and EventBridge event bus.
 *
 * - Analysis queue: Receives analysis requests for Bedrock execution
 * - Dead letter queue: Failed messages after max retries
 * - EventBridge: Custom event bus for analysis lifecycle events
 */
export class QueueStack extends cdk.Stack {
  public readonly analysisQueue: sqs.Queue;
  public readonly deadLetterQueue: sqs.Queue;
  public readonly eventBus: events.EventBus;

  constructor(scope: Construct, id: string, props: QueueStackProps) {
    super(scope, id, props);

    const { config } = props;
    const isProd = config.envName === 'production';

    // Dead letter queue for failed analysis requests (must be FIFO to match main queue)
    this.deadLetterQueue = new sqs.Queue(this, 'AnalysisDlq', {
      queueName: `${resourceName(config.envName, 'analysis-dlq')}.fifo`,
      fifo: true,
      retentionPeriod: cdk.Duration.days(14),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
    });

    // Main analysis queue (FIFO for per-market ordering)
    this.analysisQueue = new sqs.Queue(this, 'AnalysisQueue', {
      queueName: `${resourceName(config.envName, 'analysis-queue')}.fifo`,
      fifo: true,
      contentBasedDeduplication: true,
      deduplicationScope: sqs.DeduplicationScope.MESSAGE_GROUP,
      fifoThroughputLimit: sqs.FifoThroughputLimit.PER_MESSAGE_GROUP_ID,
      visibilityTimeout: cdk.Duration.minutes(17), // Must be > Lambda timeout (15 min for analysis orchestrator)
      receiveMessageWaitTime: cdk.Duration.seconds(20), // Long polling
      deadLetterQueue: {
        queue: this.deadLetterQueue,
        maxReceiveCount: 3, // 3 retries before DLQ
      },
      encryption: sqs.QueueEncryption.SQS_MANAGED,
    });

    // Notification delivery queue (standard, high throughput)
    const notificationQueue = new sqs.Queue(this, 'NotificationQueue', {
      queueName: resourceName(config.envName, 'notification-queue'),
      visibilityTimeout: cdk.Duration.seconds(30),
      retentionPeriod: cdk.Duration.days(4),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
    });

    // Custom EventBridge event bus for TradeWizard events
    this.eventBus = new events.EventBus(this, 'EventBus', {
      eventBusName: resourceName(config.envName, 'events'),
    });

    // Archive events for replay (production only)
    if (isProd) {
      new events.Archive(this, 'EventArchive', {
        sourceEventBus: this.eventBus,
        archiveName: resourceName(config.envName, 'event-archive'),
        description: 'Archive of all TradeWizard events for replay',
        eventPattern: {
          source: ['tradewizard.analysis', 'tradewizard.credits', 'tradewizard.notifications'],
        },
        retention: cdk.Duration.days(90),
      });
    }

    // Outputs
    new cdk.CfnOutput(this, 'AnalysisQueueUrl', {
      value: this.analysisQueue.queueUrl,
      exportName: resourceName(config.envName, 'analysis-queue-url'),
    });

    new cdk.CfnOutput(this, 'AnalysisQueueArn', {
      value: this.analysisQueue.queueArn,
      exportName: resourceName(config.envName, 'analysis-queue-arn'),
    });

    new cdk.CfnOutput(this, 'DlqUrl', {
      value: this.deadLetterQueue.queueUrl,
      exportName: resourceName(config.envName, 'dlq-url'),
    });

    new cdk.CfnOutput(this, 'NotificationQueueUrl', {
      value: notificationQueue.queueUrl,
      exportName: resourceName(config.envName, 'notification-queue-url'),
    });

    new cdk.CfnOutput(this, 'EventBusArn', {
      value: this.eventBus.eventBusArn,
      exportName: resourceName(config.envName, 'event-bus-arn'),
    });
  }
}
