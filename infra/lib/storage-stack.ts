import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { EnvironmentConfig, resourceName } from './config';

export interface StorageStackProps extends cdk.StackProps {
  config: EnvironmentConfig;
}

/**
 * Storage stack: S3 buckets for analysis artifacts, agent traces, and raw payloads.
 */
export class StorageStack extends cdk.Stack {
  public readonly analysisBucket: s3.Bucket;
  public readonly tracesBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: StorageStackProps) {
    super(scope, id, props);

    const { config } = props;
    const isProd = config.envName === 'production';

    // Analysis results bucket (full JSON payloads)
    this.analysisBucket = new s3.Bucket(this, 'AnalysisBucket', {
      bucketName: `${resourceName(config.envName, 'analysis-results')}-${cdk.Aws.ACCOUNT_ID}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      versioned: isProd,
      removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: !isProd,
      lifecycleRules: [
        {
          id: 'transition-to-ia',
          enabled: true,
          transitions: [
            {
              storageClass: s3.StorageClass.INFREQUENT_ACCESS,
              transitionAfter: cdk.Duration.days(30),
            },
          ],
        },
        {
          id: 'transition-to-glacier',
          enabled: isProd,
          transitions: [
            {
              storageClass: s3.StorageClass.GLACIER,
              transitionAfter: cdk.Duration.days(180),
            },
          ],
        },
      ],
      cors: [
        {
          allowedMethods: [s3.HttpMethods.GET],
          allowedOrigins: isProd
            ? ['https://tradewizard.io']
            : ['http://localhost:3000', 'https://dev.tradewizard.io'],
          allowedHeaders: ['*'],
          maxAge: 3600,
        },
      ],
    });

    // Agent traces bucket (debugging, cost analysis)
    this.tracesBucket = new s3.Bucket(this, 'TracesBucket', {
      bucketName: `${resourceName(config.envName, 'agent-traces')}-${cdk.Aws.ACCOUNT_ID}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: !isProd,
      lifecycleRules: [
        {
          id: 'expire-traces',
          enabled: true,
          expiration: cdk.Duration.days(isProd ? 90 : 14),
        },
      ],
    });

    // Outputs
    new cdk.CfnOutput(this, 'AnalysisBucketName', {
      value: this.analysisBucket.bucketName,
      exportName: resourceName(config.envName, 'analysis-bucket'),
    });

    new cdk.CfnOutput(this, 'AnalysisBucketArn', {
      value: this.analysisBucket.bucketArn,
      exportName: resourceName(config.envName, 'analysis-bucket-arn'),
    });

    new cdk.CfnOutput(this, 'TracesBucketName', {
      value: this.tracesBucket.bucketName,
      exportName: resourceName(config.envName, 'traces-bucket'),
    });
  }
}
