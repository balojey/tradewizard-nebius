import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import { EnvironmentConfig, resourceName } from './config';

export interface AuthStackProps extends cdk.StackProps {
  config: EnvironmentConfig;
  dbSecret?: secretsmanager.ISecret;
  dbEndpoint?: string;
}

/**
 * Auth stack: Amazon Cognito user pool with passwordless (Magic Link) support.
 *
 * Configures:
 * - User pool with email-based sign-in
 * - Custom auth flow for Magic Link integration
 * - App client for frontend
 * - App client for backend (server-side)
 */
export class AuthStack extends cdk.Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;
  public readonly backendClient: cognito.UserPoolClient;

  constructor(scope: Construct, id: string, props: AuthStackProps) {
    super(scope, id, props);

    const { config } = props;
    const isProd = config.envName === 'production';

    // Cognito User Pool
    this.userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: resourceName(config.envName, 'user-pool'),
      selfSignUpEnabled: true,
      signInAliases: {
        email: true,
      },
      autoVerify: {
        email: true,
      },
      standardAttributes: {
        email: {
          required: true,
          mutable: true,
        },
        fullname: {
          required: false,
          mutable: true,
        },
      },
      customAttributes: {
        plan: new cognito.StringAttribute({ mutable: true }),
        creditsRemaining: new cognito.NumberAttribute({ mutable: true }),
      },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
        tempPasswordValidity: cdk.Duration.days(7),
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      mfa: isProd ? cognito.Mfa.OPTIONAL : cognito.Mfa.OFF,
      mfaSecondFactor: isProd
        ? { sms: false, otp: true }
        : { sms: false, otp: false },
      email: cognito.UserPoolEmail.withCognito(),
      deletionProtection: config.deletionProtection,
    });

    // Frontend app client (public, PKCE flow)
    this.userPoolClient = new cognito.UserPoolClient(this, 'FrontendClient', {
      userPool: this.userPool,
      userPoolClientName: resourceName(config.envName, 'frontend-client'),
      authFlows: {
        userSrp: true,
        custom: true, // Required for Magic Link custom auth
        adminUserPassword: true, // Required for Magic→Cognito sync via AdminInitiateAuth
      },
      oAuth: {
        flows: {
          authorizationCodeGrant: true,
        },
        scopes: [
          cognito.OAuthScope.EMAIL,
          cognito.OAuthScope.OPENID,
          cognito.OAuthScope.PROFILE,
        ],
        callbackUrls: isProd
          ? ['https://tradewizard.io/auth/callback']
          : ['http://localhost:3000/auth/callback', 'https://dev.tradewizard.io/auth/callback'],
        logoutUrls: isProd
          ? ['https://tradewizard.io']
          : ['http://localhost:3000', 'https://dev.tradewizard.io'],
      },
      preventUserExistenceErrors: true,
      accessTokenValidity: cdk.Duration.hours(1),
      idTokenValidity: cdk.Duration.hours(1),
      refreshTokenValidity: cdk.Duration.days(30),
    });

    // Backend app client (confidential, for server-side operations)
    this.backendClient = new cognito.UserPoolClient(this, 'BackendClient', {
      userPool: this.userPool,
      userPoolClientName: resourceName(config.envName, 'backend-client'),
      generateSecret: true,
      authFlows: {
        adminUserPassword: true,
        custom: true,
      },
      preventUserExistenceErrors: true,
      accessTokenValidity: cdk.Duration.hours(1),
      idTokenValidity: cdk.Duration.hours(1),
      refreshTokenValidity: cdk.Duration.days(30),
    });

    // ─── Post-Confirmation Lambda (User Provisioning) ──────────────────────────
    // Creates user + free subscription in RDS when a new user confirms their account.
    // Defined here (same stack as user pool) to avoid cross-stack circular dependencies.

    if (props.dbSecret && props.dbEndpoint) {
      const postConfirmationHandler = new lambdaNode.NodejsFunction(this, 'PostConfirmationHandler', {
        functionName: resourceName(config.envName, 'post-confirmation'),
        runtime: lambda.Runtime.NODEJS_20_X,
        entry: 'services/post-confirmation/handler.ts',
        handler: 'handler',
        timeout: cdk.Duration.seconds(10),
        memorySize: 256,
        environment: {
          ENVIRONMENT: config.envName,
          DB_SECRET_ARN: props.dbSecret.secretArn,
          DB_HOST: props.dbEndpoint,
          DB_NAME: 'tradewizard',
        },
        bundling: {
          minify: isProd,
          sourceMap: !isProd,
        },
        description: 'Creates user + free subscription in RDS on Cognito sign-up confirmation',
      });

      props.dbSecret.grantRead(postConfirmationHandler);

      this.userPool.addTrigger(cognito.UserPoolOperation.POST_CONFIRMATION, postConfirmationHandler);
    }

    // Outputs
    new cdk.CfnOutput(this, 'UserPoolId', {
      value: this.userPool.userPoolId,
      exportName: resourceName(config.envName, 'user-pool-id'),
    });

    new cdk.CfnOutput(this, 'UserPoolArn', {
      value: this.userPool.userPoolArn,
      exportName: resourceName(config.envName, 'user-pool-arn'),
    });

    new cdk.CfnOutput(this, 'FrontendClientId', {
      value: this.userPoolClient.userPoolClientId,
      exportName: resourceName(config.envName, 'frontend-client-id'),
    });

    new cdk.CfnOutput(this, 'BackendClientId', {
      value: this.backendClient.userPoolClientId,
      exportName: resourceName(config.envName, 'backend-client-id'),
    });
  }
}
