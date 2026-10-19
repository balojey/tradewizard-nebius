import * as cdk from 'aws-cdk-lib';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as ses from 'aws-cdk-lib/aws-ses';
import { Construct } from 'constructs';
import { EnvironmentConfig, resourceName } from './config';

export interface NotificationStackProps extends cdk.StackProps {
  config: EnvironmentConfig;
}

/**
 * Notification stack: SNS topics and SES email identity.
 *
 * Channels:
 * - In-app:  WebSocket (handled by API Gateway WebSocket API in compute-stack)
 * - Push:    Amazon SNS Mobile Push (delivery Lambda lives in compute-stack)
 * - Email:   Resend by default, Amazon SES retained (delivery Lambdas live
 *            in compute-stack: email-delivery, system-email-delivery,
 *            portfolio-notification)
 * - Webhook: HTTP POST (delivery Lambda lives in compute-stack)
 *
 * Each delivery Lambda creates its own narrowly-scoped IAM role inline in
 * compute-stack.ts. This stack therefore only owns the topics and the retained
 * SES identity.
 */
export class NotificationStack extends cdk.Stack {
  public readonly analysisCompleteTopic: sns.Topic;
  public readonly systemNotificationsTopic: sns.Topic;

  constructor(scope: Construct, id: string, props: NotificationStackProps) {
    super(scope, id, props);

    const { config } = props;
    const isProd = config.envName === 'production';

    // SNS topic for analysis completion fan-out (consumed by analysis-delivery,
    // email-delivery, push-delivery, webhook-delivery via Lambda subscriptions
    // declared in compute-stack.ts).
    this.analysisCompleteTopic = new sns.Topic(this, 'AnalysisCompleteTopic', {
      topicName: resourceName(config.envName, 'analysis-complete'),
      displayName: `TradeWizard ${config.envName} - Analysis Complete`,
    });

    // SNS topic for system notifications (account events, credit alerts,
    // subscription renewal reminders, grace-period notices, downgrade
    // notifications). Exposed as a stack property so the renewal Lambda can
    // publish to it.
    this.systemNotificationsTopic = new sns.Topic(this, 'SystemNotificationsTopic', {
      topicName: resourceName(config.envName, 'system-notifications'),
      displayName: `TradeWizard ${config.envName} - System Notifications`,
    });

    // SES email identity (domain verification done manually in console).
    // In production, verify the domain; in dev, verify individual email
    // addresses out of band.
    if (isProd) {
      new ses.EmailIdentity(this, 'EmailIdentity', {
        identity: ses.Identity.domain('tradewizard.io'),
      });
    }

    // ─── Outputs ─────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'AnalysisCompleteTopicArn', {
      value: this.analysisCompleteTopic.topicArn,
      exportName: resourceName(config.envName, 'analysis-complete-topic-arn'),
    });

    new cdk.CfnOutput(this, 'SystemNotificationsTopicArn', {
      value: this.systemNotificationsTopic.topicArn,
      exportName: resourceName(config.envName, 'system-notifications-topic-arn'),
    });
  }
}
