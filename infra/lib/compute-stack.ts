import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as events from 'aws-cdk-lib/aws-events';
import * as events_targets from 'aws-cdk-lib/aws-events-targets';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as snsSubscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';
import { EnvironmentConfig, resourceName } from './config';

export interface ComputeStackProps extends cdk.StackProps {
  config: EnvironmentConfig;
  analysisQueue: sqs.Queue;
  analysisBucket: s3.Bucket;
  dedupCacheTable: dynamodb.Table;
  connectionsTable: dynamodb.Table;
  rateLimitTable: dynamodb.Table;
  renewalDedupTable: dynamodb.Table;
  dbSecret: secretsmanager.ISecret;
  dbEndpoint: string;
  eventBus: events.EventBus;
  analysisCompleteTopic: sns.Topic;
  systemNotificationsTopic: sns.Topic;
  userPool: cognito.UserPool;
  backendClient: cognito.UserPoolClient;
  frontendClientId: string;
}

/**
 * Compute stack: REST API, WebSocket API, and all Lambda functions.
 *
 * The REST API, routes, authorizer, and Lambda integrations are all defined here
 * (in the same stack) to avoid cross-stack circular dependencies with CDK.
 */
export class ComputeStack extends cdk.Stack {
  public readonly restApi: apigateway.RestApi;
  public readonly webSocketApi: apigatewayv2.CfnApi;
  public readonly requestHandler: lambdaNode.NodejsFunction;
  public readonly orchestratorHandler: lambdaNode.NodejsFunction;
  public readonly wsConnectHandler: lambdaNode.NodejsFunction;
  public readonly wsDisconnectHandler: lambdaNode.NodejsFunction;
  public readonly analysisDeliveryHandler: lambdaNode.NodejsFunction;
  public readonly emailDeliveryHandler: lambdaNode.NodejsFunction;
  public readonly systemEmailDeliveryHandler: lambdaNode.NodejsFunction;
  public readonly pushDeliveryHandler: lambdaNode.NodejsFunction;
  public readonly webhookDeliveryHandler: lambdaNode.NodejsFunction;
  public readonly notificationPrefsHandler: lambdaNode.NodejsFunction;
  public readonly subscriptionApiHandler: lambdaNode.NodejsFunction;
  public readonly resultsApiHandler: lambdaNode.NodejsFunction;
  public readonly subscriptionRenewalHandler: lambdaNode.NodejsFunction;
  public readonly portfolioActivationHandler: lambdaNode.NodejsFunction;
  public readonly portfolioTradeExecutorHandler: lambdaNode.NodejsFunction;
  public readonly portfolioPositionGuardHandler: lambdaNode.NodejsFunction;
  public readonly portfolioRiskEngineHandler: lambdaNode.NodejsFunction;
  public readonly portfolioLifecycleHandler: lambdaNode.NodejsFunction;
  public readonly portfolioInvestmentHandler: lambdaNode.NodejsFunction;
  public readonly portfolioDashboardApiHandler: lambdaNode.NodejsFunction;

  constructor(scope: Construct, id: string, props: ComputeStackProps) {
    super(scope, id, props);

    const { config, analysisQueue, analysisBucket, dedupCacheTable, connectionsTable, rateLimitTable, renewalDedupTable, dbSecret, dbEndpoint, eventBus, analysisCompleteTopic, systemNotificationsTopic, userPool, backendClient, frontendClientId } = props;

    // ─── Scheduler Execution Role ─────────────────────────────────────────────
    // Role assumed by EventBridge Scheduler to send messages to SQS.
    const schedulerRole = new iam.Role(this, 'SchedulerRole', {
      roleName: resourceName(config.envName, 'scheduler-role'),
      assumedBy: new iam.ServicePrincipal('scheduler.amazonaws.com'),
      description: `TradeWizard ${config.envName} - EventBridge Scheduler execution role`,
    });
    schedulerRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['sqs:SendMessage'],
        resources: [analysisQueue.queueArn],
      })
    );
    const isProd = config.envName === 'production';
    const wsStage = isProd ? 'v1' : 'dev';

    // Lambda timeout from environment variable (default: 600 seconds = 10 minutes)
    const lambdaTimeoutSeconds = parseInt(process.env.LAMBDA_TIMEOUT_SECONDS || '600', 10);
    const lambdaTimeout = cdk.Duration.seconds(lambdaTimeoutSeconds);

    // ─── Resend API Key Secret ────────────────────────────────────────────────
    //
    // Transactional email is sent through Resend by default. The secret is
    // created here as an empty shell so IAM and Lambda env vars can reference
    // it; deploy.sh (Step 3) populates the value from RESEND_API_KEY.
    //
    // Expected password shape:
    //   { "apiKey": "re_..." }
    const resendApiKeySecret = new secretsmanager.Secret(this, 'ResendApiKeySecret', {
      secretName: resourceName(config.envName, 'resend-api-key'),
      description: 'Resend API key for TradeWizard transactional email delivery',
      removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });

    const emailProviderEnv: Record<string, string> = {
      EMAIL_PROVIDER: process.env.EMAIL_PROVIDER || 'resend',
      RESEND_API_KEY_SECRET_ARN: resendApiKeySecret.secretArn,
      RESEND_FROM_EMAIL: process.env.RESEND_FROM_EMAIL || 'notifications@tradewizard.live',
      RESEND_REPLY_TO: process.env.RESEND_REPLY_TO || '',
      // Retained so EMAIL_PROVIDER=ses continues to work.
      SES_FROM_EMAIL: process.env.SES_FROM_EMAIL || 'notifications@tradewizard.live',
    };

    // ─── Nebius API Key Secret (optional AI provider) ─────────────────────────
    //
    // AI_PROVIDER=bedrock is the default. When AI_PROVIDER=nebius, analysis and
    // portfolio Lambdas route model calls through Nebius Token Factory using
    // this secret. deploy.sh (Step 3) populates it from NEBIUS_API_KEY.
    //
    // Expected secret shape:
    //   { "apiKey": "..." }
    const nebiusApiKeySecret = new secretsmanager.Secret(this, 'NebiusApiKeySecret', {
      secretName: resourceName(config.envName, 'nebius-api-key'),
      description: 'Nebius Token Factory API key for the optional AI provider',
      removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });

    const nebiusCapabilities = [
      'FAST',
      'ANALYTICAL',
      'AGENTIC',
      'REASONING',
      'DEEP_REASONING',
      'NON_TOOL',
      'DEFAULT',
    ];

    const aiProviderEnv: Record<string, string> = {
      AI_PROVIDER: process.env.AI_PROVIDER || 'bedrock',
      NEBIUS_API_KEY_SECRET_ARN: nebiusApiKeySecret.secretArn,
      NEBIUS_BASE_URL: process.env.NEBIUS_BASE_URL || 'https://api.tokenfactory.nebius.com/v1/',
      NEBIUS_MAX_TOKENS: process.env.NEBIUS_MAX_TOKENS || '30000',
    };

    for (const capability of nebiusCapabilities) {
      aiProviderEnv[`NEBIUS_MODEL_${capability}`] =
        process.env[`NEBIUS_MODEL_${capability}`] || '';
      aiProviderEnv[`NEBIUS_MODEL_${capability}_MAX_TOKENS`] =
        process.env[`NEBIUS_MODEL_${capability}_MAX_TOKENS`] || '';
    }

    // ─── REST API ─────────────────────────────────────────────────────────────

    const accessLogGroup = new logs.LogGroup(this, 'ApiAccessLogs', {
      logGroupName: `/aws/apigateway/${resourceName(config.envName, 'api')}/access`,
      retention: isProd ? logs.RetentionDays.ONE_MONTH : logs.RetentionDays.ONE_WEEK,
      removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });

    this.restApi = new apigateway.RestApi(this, 'RestApi', {
      restApiName: resourceName(config.envName, 'api'),
      description: `TradeWizard ${config.envName} REST API`,
      deployOptions: {
        stageName: isProd ? 'v1' : 'dev',
        throttlingRateLimit: isProd ? 1000 : 100,
        throttlingBurstLimit: isProd ? 2000 : 200,
        accessLogDestination: new apigateway.LogGroupLogDestination(accessLogGroup),
        accessLogFormat: apigateway.AccessLogFormat.jsonWithStandardFields(),
        tracingEnabled: true,
        metricsEnabled: true,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: isProd
          ? ['https://tradewizard.live', 'https://tradewizard-ai-roan.vercel.app']
          : apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'Authorization', 'X-Amz-Date', 'X-Api-Key', 'X-Amz-Security-Token'],
        allowCredentials: false,
      },
      cloudWatchRole: true,
    });

    // Add CORS headers to Gateway error responses (authorizer rejections, etc.)
    // Without these, 401/403 from the Cognito authorizer lack CORS headers,
    // causing the browser to show "CORS error" instead of the actual auth error.
    const gatewayResponseHeaders = {
      'Access-Control-Allow-Origin': "'*'",
      'Access-Control-Allow-Headers': "'Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Amz-Security-Token'",
      'Access-Control-Allow-Methods': "'GET,POST,PUT,DELETE,OPTIONS'",
    };

    this.restApi.addGatewayResponse('Unauthorized', {
      type: apigateway.ResponseType.UNAUTHORIZED,
      responseHeaders: gatewayResponseHeaders,
      templates: { 'application/json': '{"message":"Unauthorized","hint":"Token may be missing or expired"}' },
    });

    this.restApi.addGatewayResponse('AccessDenied', {
      type: apigateway.ResponseType.ACCESS_DENIED,
      responseHeaders: gatewayResponseHeaders,
      templates: { 'application/json': '{"message":"Access denied"}' },
    });

    this.restApi.addGatewayResponse('Default4xx', {
      type: apigateway.ResponseType.DEFAULT_4XX,
      responseHeaders: gatewayResponseHeaders,
    });

    this.restApi.addGatewayResponse('Default5xx', {
      type: apigateway.ResponseType.DEFAULT_5XX,
      responseHeaders: gatewayResponseHeaders,
    });

    // WebSocket API for real-time delivery
    this.webSocketApi = new apigatewayv2.CfnApi(this, 'WebSocketApi', {
      name: resourceName(config.envName, 'ws-api'),
      protocolType: 'WEBSOCKET',
      routeSelectionExpression: '$request.body.action',
      description: `TradeWizard ${config.envName} WebSocket API`,
    });

    new apigatewayv2.CfnStage(this, 'WebSocketStage', {
      apiId: this.webSocketApi.ref,
      stageName: wsStage,
      autoDeploy: true,
    });

    // Shared environment variables
    const sharedEnv: Record<string, string> = {
      ENVIRONMENT: config.envName,
      DEDUP_CACHE_TABLE: dedupCacheTable.tableName,
      CONNECTIONS_TABLE: connectionsTable.tableName,
      RATE_LIMIT_TABLE: rateLimitTable.tableName,
      DB_SECRET_ARN: dbSecret.secretArn,
      DB_HOST: dbEndpoint,
      ANALYSIS_BUCKET: analysisBucket.bucketName,
      EVENT_BUS_NAME: eventBus.eventBusName,
      ANALYSIS_QUEUE_URL: analysisQueue.queueUrl,
    };

    // ─── Analysis Request Lambda ──────────────────────────────────────────────

    this.requestHandler = new lambdaNode.NodejsFunction(this, 'AnalysisRequestHandler', {
      functionName: resourceName(config.envName, 'analysis-request'),
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: 'services/analysis-request/handler.ts',
      handler: 'handler',
      timeout: lambdaTimeout,
      memorySize: 256,
      environment: {
        ...sharedEnv,
        SCHEDULER_ROLE_ARN: schedulerRole.roleArn,
        SCHEDULER_TARGET_ARN: analysisQueue.queueArn,
      },
      bundling: {
        minify: isProd,
        sourceMap: !isProd,
      },
      description: 'Handles analysis requests: credit check, dedup, dispatch to SQS',
    });

    // Grant permissions to request handler
    dedupCacheTable.grantReadWriteData(this.requestHandler);
    rateLimitTable.grantReadWriteData(this.requestHandler);
    dbSecret.grantRead(this.requestHandler);
    analysisQueue.grantSendMessages(this.requestHandler);

    // Allow request handler to manage EventBridge schedules
    this.requestHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'scheduler:CreateSchedule',
          'scheduler:GetSchedule',
          'scheduler:DeleteSchedule',
          'scheduler:UpdateSchedule',
        ],
        resources: ['*'],
      })
    );

    // Allow passing the orchestrator role to scheduler
    this.requestHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['iam:PassRole'],
        resources: [schedulerRole.roleArn],
      })
    );

    // Allow publishing AnalysisCompleted events for cached deliveries so the
    // SNS-bound delivery handlers (email, push, webhook, in-app WS) fire on
    // every chargeable delivery - not just freshly-orchestrated ones.
    this.requestHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['events:PutEvents'],
        resources: [eventBus.eventBusArn],
      })
    );

    // ─── Analysis Orchestrator Lambda ─────────────────────────────────────────

    this.orchestratorHandler = new lambdaNode.NodejsFunction(this, 'AnalysisOrchestratorHandler', {
      functionName: resourceName(config.envName, 'analysis-orchestrator'),
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: 'services/analysis-orchestrator/handler.ts',
      handler: 'handler',
      timeout: cdk.Duration.seconds(900), // 15 min max - must exceed Analysis Lambda timeout (10 min) + post-processing
      memorySize: 512,
      environment: {
        ...sharedEnv,
      },
      bundling: {
        minify: isProd,
        sourceMap: !isProd,
      },
      description: 'Orchestrates analysis workflow: invokes Analysis Lambda, stores results, publishes events',
    });

    // SQS trigger for orchestrator
    this.orchestratorHandler.addEventSource(
      new lambdaEventSources.SqsEventSource(analysisQueue, {
        batchSize: 1, // Process one analysis at a time
        maxConcurrency: isProd ? 10 : 2,
      })
    );

    // Grant permissions to orchestrator
    dedupCacheTable.grantReadWriteData(this.orchestratorHandler);
    analysisBucket.grantReadWrite(this.orchestratorHandler);
    dbSecret.grantRead(this.orchestratorHandler);

    // Allow orchestrator to invoke Bedrock models
    this.orchestratorHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'bedrock:InvokeAgent',
          'bedrock:InvokeModel',
          'bedrock:InvokeModelWithResponseStream',
          'bedrock:ListAgents',
        ],
        resources: ['*'],
      })
    );

    // Allow orchestrator to publish events
    this.orchestratorHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['events:PutEvents'],
        resources: [eventBus.eventBusArn],
      })
    );

    // The orchestrator does NOT push to WebSocket directly - that fans out
    // through SNS → analysis-delivery Lambda. We deliberately omit
    // execute-api:ManageConnections / connections-table permissions here.

    // ─── Analysis Lambda (Strands SDK - self-hosted analysis workflow) ─────────

    const analysisLambda = new lambdaNode.NodejsFunction(this, 'AnalysisLambdaHandler', {
      functionName: resourceName(config.envName, 'analysis-lambda'),
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: 'services/analysis-lambda/handler.ts',
      handler: 'handler',
      timeout: lambdaTimeout,
      memorySize: 1024,
      environment: {
        ENVIRONMENT: config.envName,
        BEDROCK_MODEL_ID: this.node.tryGetContext('bedrockModelId') ?? process.env.BEDROCK_MODEL_ID ?? 'global.amazon.nova-2-lite-v1:0',
        NEWSDATA_API_KEY: this.node.tryGetContext('newsdataApiKey') ?? process.env.NEWSDATA_API_KEY ?? '',
        SERPER_API_KEY: this.node.tryGetContext('serperApiKey') ?? process.env.SERPER_API_KEY ?? '',
        DB_SECRET_ARN: dbSecret.secretArn,
        DB_HOST: dbEndpoint,
        ANALYSIS_HISTORY_DEPTH: this.node.tryGetContext('analysisHistoryDepth') ?? process.env.ANALYSIS_HISTORY_DEPTH ?? '5',
        BEDROCK_MAX_TOKENS: process.env.BEDROCK_MAX_TOKENS ?? '30000',
        NEWS_TOOL_MAX_CALLS: process.env.NEWS_TOOL_MAX_CALLS ?? '5',
        SEARCH_TOOL_MAX_CALLS: process.env.SEARCH_TOOL_MAX_CALLS ?? '10',
        SHELL_TOOL_MAX_CALLS: process.env.SHELL_TOOL_MAX_CALLS ?? '15',
        ANALYSIS_BUCKET: analysisBucket.bucketName,
        EVENT_BUS_NAME: eventBus.eventBusName,
        // Multi-model configuration for parallel agent execution
        MODEL_NOVA_MICRO: process.env.MODEL_NOVA_MICRO ?? 'mistral.devstral-2-123b',
        MODEL_NOVA_MICRO_MAX_TOKENS: process.env.MODEL_NOVA_MICRO_MAX_TOKENS ?? '8192',
        MODEL_NOVA_LITE: process.env.MODEL_NOVA_LITE ?? 'qwen.qwen3-next-80b-a3b',
        MODEL_NOVA_LITE_MAX_TOKENS: process.env.MODEL_NOVA_LITE_MAX_TOKENS ?? '8192',
        MODEL_KIMI_K2: process.env.MODEL_KIMI_K2 ?? 'mistral.mistral-large-3-675b-instruct',
        MODEL_KIMI_K2_MAX_TOKENS: process.env.MODEL_KIMI_K2_MAX_TOKENS ?? '8192',
        MODEL_NEMOTRON: process.env.MODEL_NEMOTRON ?? 'zai.glm-5',
        MODEL_NEMOTRON_MAX_TOKENS: process.env.MODEL_NEMOTRON_MAX_TOKENS ?? '30000',
        MODEL_GPT_OSS: process.env.MODEL_GPT_OSS ?? 'moonshotai.kimi-k2.5',
        MODEL_GPT_OSS_MAX_TOKENS: process.env.MODEL_GPT_OSS_MAX_TOKENS ?? '30000',
        MODEL_NOVA_2_LITE: process.env.MODEL_NOVA_2_LITE ?? 'global.amazon.nova-2-lite-v1:0',
        MODEL_NOVA_2_LITE_MAX_TOKENS: process.env.MODEL_NOVA_2_LITE_MAX_TOKENS ?? '30000',
        MODEL_LLAMA_3_3: process.env.MODEL_LLAMA_3_3 ?? 'us.meta.llama3-3-70b-instruct-v1:0',
        MODEL_LLAMA_3_3_MAX_TOKENS: process.env.MODEL_LLAMA_3_3_MAX_TOKENS ?? '4096',
        // Provider switch (Bedrock default, Nebius optional)
        ...aiProviderEnv,
      },
      bundling: {
        minify: isProd,
        sourceMap: !isProd,
      },
      description: 'Self-hosted analysis orchestrator using Strands SDK - 11-stage workflow with 14 intelligence agents',
    });

    // Grant Analysis Lambda permissions
    analysisLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
        resources: ['*'],
      })
    );
    analysisLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['events:PutEvents'],
        resources: [eventBus.eventBusArn],
      })
    );
    dbSecret.grantRead(analysisLambda);
    analysisBucket.grantReadWrite(analysisLambda);
    dedupCacheTable.grantReadWriteData(analysisLambda);
    nebiusApiKeySecret.grantRead(analysisLambda);

    // ─── Portfolio Lambda (Strands SDK - self-hosted portfolio manager) ────────

    const portfolioLambda = new lambdaNode.NodejsFunction(this, 'PortfolioLambdaHandler', {
      functionName: resourceName(config.envName, 'portfolio-lambda'),
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: 'services/portfolio-lambda/handler.ts',
      handler: 'handler',
      timeout: lambdaTimeout,
      memorySize: 512,
      environment: {
        ENVIRONMENT: config.envName,
        BEDROCK_MODEL_ID: this.node.tryGetContext('bedrockModelId') ?? process.env.BEDROCK_MODEL_ID ?? 'global.amazon.nova-2-lite-v1:0',
        DB_SECRET_ARN: dbSecret.secretArn,
        DB_HOST: dbEndpoint,
        EVENT_BUS_NAME: eventBus.eventBusName,
        ANALYSIS_RESULTS_BUCKET: analysisBucket.bucketName,
        // Provider switch (Bedrock default, Nebius optional)
        ...aiProviderEnv,
      },
      bundling: {
        minify: isProd,
        sourceMap: !isProd,
      },
      description: 'Self-hosted portfolio manager using Strands SDK - persona-based trade decisions',
    });

    // Grant Portfolio Lambda permissions
    portfolioLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
        resources: ['*'],
      })
    );
    portfolioLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['events:PutEvents'],
        resources: [eventBus.eventBusArn],
      })
    );
    dbSecret.grantRead(portfolioLambda);
    analysisBucket.grantRead(portfolioLambda);
    nebiusApiKeySecret.grantRead(portfolioLambda);

    // ─── Cross-Lambda Invoke Permissions ──────────────────────────────────────

    // Grant orchestrator Lambda permission to invoke Analysis_Lambda
    this.orchestratorHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['lambda:InvokeFunction'],
        resources: [analysisLambda.functionArn],
      })
    );

    // Add ANALYSIS_LAMBDA_ARN env var to orchestrator
    this.orchestratorHandler.addEnvironment('ANALYSIS_LAMBDA_ARN', analysisLambda.functionArn);

    // ─── WebSocket Connect Handler ────────────────────────────────────────────

    this.wsConnectHandler = new lambdaNode.NodejsFunction(this, 'WsConnectHandler', {
      functionName: resourceName(config.envName, 'ws-connect'),
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: 'services/ws-connect/handler.ts',
      handler: 'handler',
      timeout: lambdaTimeout,
      memorySize: 128,
      environment: {
        CONNECTIONS_TABLE: connectionsTable.tableName,
        COGNITO_USER_POOL_ID: userPool.userPoolId,
        DB_SECRET_ARN: dbSecret.secretArn,
        DB_HOST: dbEndpoint,
      },
      bundling: {
        minify: isProd,
        sourceMap: !isProd,
      },
      description: 'WebSocket $connect route: validates JWT, translates cognito sub→users.id, stores connection in DynamoDB',
    });

    connectionsTable.grantReadWriteData(this.wsConnectHandler);
    dbSecret.grantRead(this.wsConnectHandler);

    // ─── WebSocket Disconnect Handler ─────────────────────────────────────────

    this.wsDisconnectHandler = new lambdaNode.NodejsFunction(this, 'WsDisconnectHandler', {
      functionName: resourceName(config.envName, 'ws-disconnect'),
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: 'services/ws-disconnect/handler.ts',
      handler: 'handler',
      timeout: lambdaTimeout,
      memorySize: 128,
      environment: {
        CONNECTIONS_TABLE: connectionsTable.tableName,
        COGNITO_USER_POOL_ID: userPool.userPoolId,
      },
      bundling: {
        minify: isProd,
        sourceMap: !isProd,
      },
      description: 'WebSocket $disconnect route: removes connection from DynamoDB',
    });

    connectionsTable.grantReadWriteData(this.wsDisconnectHandler);

    // ─── WebSocket Route Integrations ─────────────────────────────────────────

    // $connect integration → ws-connect Lambda
    const wsConnectIntegration = new apigatewayv2.CfnIntegration(this, 'WsConnectIntegration', {
      apiId: this.webSocketApi.ref,
      integrationType: 'AWS_PROXY',
      integrationUri: `arn:aws:apigateway:${config.region}:lambda:path/2015-03-31/functions/${this.wsConnectHandler.functionArn}/invocations`,
    });

    new apigatewayv2.CfnRoute(this, 'WsConnectRoute', {
      apiId: this.webSocketApi.ref,
      routeKey: '$connect',
      authorizationType: 'NONE',
      target: `integrations/${wsConnectIntegration.ref}`,
    });

    // Grant API Gateway permission to invoke ws-connect Lambda
    this.wsConnectHandler.addPermission('AllowApiGatewayInvoke', {
      principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn: `arn:aws:execute-api:${config.region}:${cdk.Aws.ACCOUNT_ID}:${this.webSocketApi.ref}/*/*`,
    });

    // $disconnect integration → ws-disconnect Lambda
    const wsDisconnectIntegration = new apigatewayv2.CfnIntegration(this, 'WsDisconnectIntegration', {
      apiId: this.webSocketApi.ref,
      integrationType: 'AWS_PROXY',
      integrationUri: `arn:aws:apigateway:${config.region}:lambda:path/2015-03-31/functions/${this.wsDisconnectHandler.functionArn}/invocations`,
    });

    new apigatewayv2.CfnRoute(this, 'WsDisconnectRoute', {
      apiId: this.webSocketApi.ref,
      routeKey: '$disconnect',
      authorizationType: 'NONE',
      target: `integrations/${wsDisconnectIntegration.ref}`,
    });

    // Grant API Gateway permission to invoke ws-disconnect Lambda
    this.wsDisconnectHandler.addPermission('AllowApiGatewayInvoke', {
      principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn: `arn:aws:execute-api:${config.region}:${cdk.Aws.ACCOUNT_ID}:${this.webSocketApi.ref}/*/*`,
    });

    // ─── Analysis Delivery Handler (SNS → WebSocket push) ─────────────────────

    this.analysisDeliveryHandler = new lambdaNode.NodejsFunction(this, 'AnalysisDeliveryHandler', {
      functionName: resourceName(config.envName, 'analysis-delivery'),
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: 'services/analysis-delivery/handler.ts',
      handler: 'handler',
      timeout: lambdaTimeout,
      memorySize: 256,
      environment: {
        CONNECTIONS_TABLE: connectionsTable.tableName,
        WEBSOCKET_ENDPOINT: `https://${this.webSocketApi.ref}.execute-api.${config.region}.amazonaws.com/${wsStage}`,
        DB_SECRET_ARN: dbSecret.secretArn,
        DB_HOST: dbEndpoint,
      },
      bundling: {
        minify: isProd,
        sourceMap: !isProd,
      },
      description: 'Delivers analysis results to connected WebSocket clients via SNS trigger',
    });

    connectionsTable.grantReadWriteData(this.analysisDeliveryHandler);
    dbSecret.grantRead(this.analysisDeliveryHandler);

    // Allow posting to WebSocket connections
    this.analysisDeliveryHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['execute-api:ManageConnections'],
        resources: [`arn:aws:execute-api:${config.region}:${cdk.Aws.ACCOUNT_ID}:${this.webSocketApi.ref}/${wsStage}/POST/@connections/*`],
      })
    );

    // SNS subscription for analysis delivery
    analysisCompleteTopic.addSubscription(
      new snsSubscriptions.LambdaSubscription(this.analysisDeliveryHandler)
    );

    // ─── Email Delivery Handler (SNS → Resend/SES) ───────────────────────────

    this.emailDeliveryHandler = new lambdaNode.NodejsFunction(this, 'EmailDeliveryHandler', {
      functionName: resourceName(config.envName, 'email-delivery'),
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: 'services/email-delivery/handler.ts',
      handler: 'handler',
      timeout: lambdaTimeout,
      memorySize: 256,
      environment: {
        DB_SECRET_ARN: dbSecret.secretArn,
        DB_HOST: dbEndpoint,
        ...emailProviderEnv,
        APP_URL: process.env.APP_URL || (isProd ? 'https://tradewizard.live' : 'http://localhost:3000'),
      },
      bundling: {
        minify: isProd,
        sourceMap: !isProd,
      },
      description: 'Sends analysis email notifications via Resend (SES retained), respects quiet hours',
    });

    dbSecret.grantRead(this.emailDeliveryHandler);
    resendApiKeySecret.grantRead(this.emailDeliveryHandler);

    // Allow the retained SES fallback (EMAIL_PROVIDER=ses)
    this.emailDeliveryHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ses:SendEmail', 'ses:SendTemplatedEmail', 'ses:SendRawEmail'],
        resources: ['*'],
      })
    );

    // SNS subscription for email delivery
    analysisCompleteTopic.addSubscription(
      new snsSubscriptions.LambdaSubscription(this.emailDeliveryHandler)
    );

    // ─── System Email Delivery Handler (SNS → Resend/SES) ────────────────────
    //
    // Consumes the system-notifications topic used by subscription-renewal for
    // trial expiry, renewal reminders/failures, and downgrade notices. These
    // are account-critical transactional emails, so they bypass quiet hours
    // and plan-based channel restrictions.

    this.systemEmailDeliveryHandler = new lambdaNode.NodejsFunction(this, 'SystemEmailDeliveryHandler', {
      functionName: resourceName(config.envName, 'system-email-delivery'),
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: 'services/system-email-delivery/handler.ts',
      handler: 'handler',
      timeout: lambdaTimeout,
      memorySize: 256,
      environment: {
        DB_SECRET_ARN: dbSecret.secretArn,
        DB_HOST: dbEndpoint,
        ...emailProviderEnv,
        APP_URL: process.env.APP_URL || (isProd ? 'https://tradewizard.live' : 'http://localhost:3000'),
      },
      bundling: {
        minify: isProd,
        sourceMap: !isProd,
      },
      description: 'Sends transactional account/billing emails via Resend (SES retained)',
    });

    dbSecret.grantRead(this.systemEmailDeliveryHandler);
    resendApiKeySecret.grantRead(this.systemEmailDeliveryHandler);

    // Allow the retained SES fallback (EMAIL_PROVIDER=ses)
    this.systemEmailDeliveryHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ses:SendEmail', 'ses:SendTemplatedEmail', 'ses:SendRawEmail'],
        resources: ['*'],
      })
    );

    systemNotificationsTopic.addSubscription(
      new snsSubscriptions.LambdaSubscription(this.systemEmailDeliveryHandler)
    );

    // ─── Push Delivery Handler (SNS → SNS Mobile Push) ────────────────────────

    this.pushDeliveryHandler = new lambdaNode.NodejsFunction(this, 'PushDeliveryHandler', {
      functionName: resourceName(config.envName, 'push-delivery'),
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: 'services/push-delivery/handler.ts',
      handler: 'handler',
      timeout: lambdaTimeout,
      memorySize: 256,
      environment: {
        DB_SECRET_ARN: dbSecret.secretArn,
        DB_HOST: dbEndpoint,
        APP_URL: process.env.APP_URL || (isProd ? 'https://tradewizard.live' : 'http://localhost:3000'),
      },
      bundling: {
        minify: isProd,
        sourceMap: !isProd,
      },
      description: 'Sends push notifications via SNS Mobile Push when analysis completes',
    });

    dbSecret.grantRead(this.pushDeliveryHandler);

    // Allow publishing to SNS platform endpoints for push notifications
    this.pushDeliveryHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['sns:Publish'],
        resources: ['*'],
      })
    );

    // SNS subscription for push delivery
    analysisCompleteTopic.addSubscription(
      new snsSubscriptions.LambdaSubscription(this.pushDeliveryHandler)
    );

    // ─── Webhook Delivery Handler (SNS → HTTP webhook) ────────────────────────

    this.webhookDeliveryHandler = new lambdaNode.NodejsFunction(this, 'WebhookDeliveryHandler', {
      functionName: resourceName(config.envName, 'webhook-delivery'),
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: 'services/webhook-delivery/handler.ts',
      handler: 'handler',
      timeout: lambdaTimeout,
      memorySize: 256,
      environment: {
        DB_SECRET_ARN: dbSecret.secretArn,
        DB_HOST: dbEndpoint,
      },
      bundling: {
        minify: isProd,
        sourceMap: !isProd,
      },
      description: 'Delivers analysis results to user-configured webhook URLs',
    });

    dbSecret.grantRead(this.webhookDeliveryHandler);

    // SNS subscription for webhook delivery
    analysisCompleteTopic.addSubscription(
      new snsSubscriptions.LambdaSubscription(this.webhookDeliveryHandler)
    );

    // ─── EventBridge → SNS: Route analysis events to SNS topic for delivery fan-out ──

    // EventBridge rule: route AnalysisCompleted events to SNS topic for delivery fan-out
    const analysisCompletedRule = new events.Rule(this, 'AnalysisCompletedRule', {
      eventBus: eventBus,
      ruleName: resourceName(config.envName, 'analysis-completed'),
      eventPattern: {
        source: ['tradewizard.analysis'],
        detailType: ['AnalysisCompleted'],
      },
    });
    analysisCompletedRule.addTarget(new events_targets.SnsTopic(analysisCompleteTopic));

    // ─── Analysis Sweeper (stale request cleanup) ─────────────────────────────
    // Runs every 5 minutes. Catches orphaned 'active' requests that exceeded
    // the max execution time (Lambda timeout, crash, etc.) and refunds credits.

    const analysisSweeper = new lambdaNode.NodejsFunction(this, 'AnalysisSweeperHandler', {
      functionName: resourceName(config.envName, 'analysis-sweeper'),
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: 'services/analysis-sweeper/handler.ts',
      handler: 'handler',
      timeout: lambdaTimeout,
      memorySize: 256,
      environment: {
        DB_SECRET_ARN: dbSecret.secretArn,
        DB_HOST: dbEndpoint,
        EVENT_BUS_NAME: eventBus.eventBusName,
        ENVIRONMENT: config.envName,
        DEDUP_CACHE_TABLE: dedupCacheTable.tableName,
        STALE_THRESHOLD_MINUTES: '50', // Must exceed maxReceiveCount (3) × orchestrator timeout (15 min)
      },
      bundling: {
        minify: isProd,
        sourceMap: !isProd,
      },
      description: 'Sweeps stale analysis requests every 5 min - refunds credits and notifies users',
    });

    dbSecret.grantRead(analysisSweeper);
    dedupCacheTable.grantReadWriteData(analysisSweeper);
    eventBus.grantPutEventsTo(analysisSweeper);

    // Schedule: every 5 minutes
    const sweeperRule = new events.Rule(this, 'AnalysisSweeperSchedule', {
      ruleName: resourceName(config.envName, 'analysis-sweeper-schedule'),
      schedule: events.Schedule.rate(cdk.Duration.minutes(5)),
      description: 'Triggers analysis sweeper every 5 minutes to clean up stale requests',
    });
    sweeperRule.addTarget(new events_targets.LambdaFunction(analysisSweeper));

    // ─── Recommendation Scorer (TP/SL outcome tracking + agent performance) ──

    const recommendationScorer = new lambdaNode.NodejsFunction(this, 'RecommendationScorerHandler', {
      functionName: resourceName(config.envName, 'recommendation-scorer'),
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: 'services/recommendation-scorer/handler.ts',
      handler: 'handler',
      timeout: lambdaTimeout,
      memorySize: 256,
      environment: {
        DB_SECRET_ARN: dbSecret.secretArn,
        DB_HOST: dbEndpoint,
        ENVIRONMENT: config.envName,
        RECOMMENDATION_EXPIRY_HOURS: '168', // 7 days
      },
      bundling: {
        minify: isProd,
        sourceMap: !isProd,
      },
      description: 'Scores trade recommendations by detecting TP/SL hits and updating agent accuracy',
    });

    dbSecret.grantRead(recommendationScorer);

    // Schedule: every 5 minutes
    const scorerRule = new events.Rule(this, 'RecommendationScorerSchedule', {
      ruleName: resourceName(config.envName, 'recommendation-scorer-schedule'),
      schedule: events.Schedule.rate(cdk.Duration.minutes(5)),
      description: 'Triggers recommendation scorer every 5 minutes to check TP/SL outcomes',
    });
    scorerRule.addTarget(new events_targets.LambdaFunction(recommendationScorer));

    // ─── Notification Preferences API ─────────────────────────────────────────

    this.notificationPrefsHandler = new lambdaNode.NodejsFunction(this, 'NotificationPrefsHandler', {
      functionName: resourceName(config.envName, 'notification-preferences'),
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: 'services/notification-preferences/handler.ts',
      handler: 'handler',
      timeout: lambdaTimeout,
      memorySize: 256,
      environment: {
        DB_SECRET_ARN: dbSecret.secretArn,
        DB_HOST: dbEndpoint,
      },
      bundling: {
        minify: isProd,
        sourceMap: !isProd,
      },
      description: 'CRUD API for user notification channel preferences and quiet hours',
    });

    dbSecret.grantRead(this.notificationPrefsHandler);

    // ─── Renewal Queue (declared before subscription handler so it can reference the ARN) ──

    // SQS Dead Letter Queue for renewal failures
    const renewalDlq = new sqs.Queue(this, 'RenewalDlq', {
      queueName: resourceName(config.envName, 'renewal-dlq'),
      retentionPeriod: cdk.Duration.days(14),
      removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });

    // SQS queue for renewal processing with DLQ
    const renewalQueue = new sqs.Queue(this, 'RenewalQueue', {
      queueName: resourceName(config.envName, 'renewal-queue'),
      visibilityTimeout: cdk.Duration.seconds(lambdaTimeoutSeconds + 30), // Must exceed Lambda timeout
      deadLetterQueue: {
        queue: renewalDlq,
        maxReceiveCount: 3,
      },
      removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });

    // ─── Subscription API ─────────────────────────────────────────────────────

    this.subscriptionApiHandler = new lambdaNode.NodejsFunction(this, 'SubscriptionApiHandler', {
      functionName: resourceName(config.envName, 'subscription-api'),
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: 'services/subscription-api/handler.ts',
      handler: 'handler',
      timeout: lambdaTimeout,
      memorySize: 256,
      environment: {
        DB_SECRET_ARN: dbSecret.secretArn,
        DB_HOST: dbEndpoint,
        PLATFORM_WALLET_ADDRESS: config.platformWalletAddress,
        USDC_CONTRACT_ADDRESS: config.usdcContractAddress,
        POLYGON_RPC_URL: config.polygonRpcUrl,
        SAFE_FACTORY_ADDRESS: config.safeFactoryAddress,
        DEDUP_TABLE: renewalDedupTable.tableName,
        RENEWAL_QUEUE_ARN: renewalQueue.queueArn,
        SCHEDULER_ROLE_ARN: schedulerRole.roleArn,
      },
      bundling: {
        minify: isProd,
        sourceMap: !isProd,
      },
      description: 'Manages wallet-based subscriptions, plan changes, credit purchases, and payment verification',
    });

    dbSecret.grantRead(this.subscriptionApiHandler);

    // Allow subscription handler to manage EventBridge schedules for renewal scheduling
    this.subscriptionApiHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'scheduler:CreateSchedule',
          'scheduler:DeleteSchedule',
        ],
        resources: ['*'],
      })
    );

    // Allow passing the orchestrator role to scheduler
    this.subscriptionApiHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['iam:PassRole'],
        resources: [schedulerRole.roleArn],
      })
    );

    // ─── Subscription Renewal Lambda ──────────────────────────────────────────

    const platformWalletKeyArn = `arn:aws:secretsmanager:${config.region}:${cdk.Aws.ACCOUNT_ID}:secret:${resourceName(config.envName, 'platform-wallet-key')}`;

    this.subscriptionRenewalHandler = new lambdaNode.NodejsFunction(this, 'SubscriptionRenewalHandler', {
      functionName: resourceName(config.envName, 'subscription-renewal'),
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: 'services/subscription-renewal/handler.ts',
      handler: 'handler',
      timeout: lambdaTimeout,
      memorySize: 256,
      environment: {
        DB_SECRET_ARN: dbSecret.secretArn,
        DB_HOST: dbEndpoint,
        PLATFORM_WALLET_ADDRESS: config.platformWalletAddress,
        USDC_CONTRACT_ADDRESS: config.usdcContractAddress,
        POLYGON_RPC_URL: config.polygonRpcUrl,
        SAFE_FACTORY_ADDRESS: config.safeFactoryAddress,
        DEDUP_TABLE: renewalDedupTable.tableName,
        PLATFORM_WALLET_PRIVATE_KEY_ARN: platformWalletKeyArn,
        SNS_NOTIFICATION_TOPIC_ARN: systemNotificationsTopic.topicArn,
      },
      bundling: {
        minify: isProd,
        sourceMap: !isProd,
      },
      description: 'Processes subscription renewals via transferFrom with pre-approved USDC.e allowance',
    });

    // Grant renewal Lambda permissions
    dbSecret.grantRead(this.subscriptionRenewalHandler);
    renewalDedupTable.grantReadWriteData(this.subscriptionRenewalHandler);
    systemNotificationsTopic.grantPublish(this.subscriptionRenewalHandler);

    // Allow renewal Lambda to read platform wallet private key and DB credentials
    this.subscriptionRenewalHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['secretsmanager:GetSecretValue'],
        resources: [
          `${platformWalletKeyArn}*`,
          dbSecret.secretArn,
        ],
      })
    );

    // Allow renewal Lambda to manage EventBridge schedules (create next cycle, delete on cancel)
    this.subscriptionRenewalHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'scheduler:CreateSchedule',
          'scheduler:DeleteSchedule',
        ],
        resources: ['*'],
      })
    );

    // Allow passing the orchestrator role to scheduler
    this.subscriptionRenewalHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['iam:PassRole'],
        resources: [schedulerRole.roleArn],
      })
    );

    // SQS trigger for renewal Lambda (EventBridge Scheduler → SQS → Lambda)
    this.subscriptionRenewalHandler.addEventSource(
      new lambdaEventSources.SqsEventSource(renewalQueue, {
        batchSize: 1,
      })
    );

    // ─── Results API ──────────────────────────────────────────────────────────

    this.resultsApiHandler = new lambdaNode.NodejsFunction(this, 'ResultsApiHandler', {
      functionName: resourceName(config.envName, 'results-api'),
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: 'services/results-api/handler.ts',
      handler: 'handler',
      timeout: lambdaTimeout,
      memorySize: 256,
      environment: {
        DB_SECRET_ARN: dbSecret.secretArn,
        DB_HOST: dbEndpoint,
        ANALYSIS_BUCKET: analysisBucket.bucketName,
      },
      bundling: {
        minify: isProd,
        sourceMap: !isProd,
      },
      description: 'Serves paginated analysis history and full result detail from S3',
    });

    dbSecret.grantRead(this.resultsApiHandler);
    analysisBucket.grantRead(this.resultsApiHandler);

    // ─── Magic → Cognito Sync Lambda ──────────────────────────────────────────

    const magicSyncHandler = new lambdaNode.NodejsFunction(this, 'MagicSyncHandler', {
      functionName: resourceName(config.envName, 'auth-magic-sync'),
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: 'services/auth-magic-sync/handler.ts',
      handler: 'handler',
      timeout: lambdaTimeout,
      memorySize: 256,
      environment: {
        USER_POOL_ID: userPool.userPoolId,
        // Use the FRONTEND client ID so the ID token's 'aud' claim matches
        // what the API Gateway Cognito authorizer expects
        COGNITO_CLIENT_ID: frontendClientId,
        PASSWORD_SALT: `tw-magic-sync-${config.envName}-v1`,
        DB_SECRET_ARN: dbSecret.secretArn,
        DB_HOST: dbEndpoint,
      },
      bundling: {
        minify: isProd,
        sourceMap: !isProd,
      },
      description: 'Syncs Magic SDK auth to Cognito: creates user + returns Cognito tokens',
    });

    // Grant Cognito admin permissions
    magicSyncHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'cognito-idp:AdminCreateUser',
          'cognito-idp:AdminSetUserPassword',
          'cognito-idp:AdminInitiateAuth',
          'cognito-idp:AdminGetUser',
          'cognito-idp:DescribeUserPoolClient',
        ],
        resources: [userPool.userPoolArn],
      })
    );

    // Grant DB secret access for user provisioning
    dbSecret.grantRead(magicSyncHandler);

    // ─── REST API Routes & Lambda Integrations ──────────────────────────────────
    // All routes defined here (same stack as Lambdas) to avoid cross-stack cycles.

    const localAuthorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'ComputeAuthorizer', {
      authorizerName: resourceName(config.envName, 'compute-auth'),
      cognitoUserPools: [userPool],
      identitySource: 'method.request.header.Authorization',
    });

    const authMethodOptions: apigateway.MethodOptions = {
      authorizer: localAuthorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    };

    const mockIntegration = new apigateway.MockIntegration({
      integrationResponses: [{ statusCode: '200', responseTemplates: { 'application/json': JSON.stringify({ message: 'Not yet implemented' }) } }],
      requestTemplates: { 'application/json': '{"statusCode": 200}' },
    });
    const mockMethodOptions: apigateway.MethodOptions = { ...authMethodOptions, methodResponses: [{ statusCode: '200' }] };

    // /health (no auth)
    const health = this.restApi.root.addResource('health');
    health.addMethod('GET', mockIntegration, { methodResponses: [{ statusCode: '200' }] });

    // /markets (mock - frontend fetches from Polymarket directly)
    const markets = this.restApi.root.addResource('markets');
    markets.addMethod('GET', mockIntegration, mockMethodOptions);
    markets.addResource('{marketId}').addMethod('GET', mockIntegration, mockMethodOptions);

    // /analysis
    const analysis = this.restApi.root.addResource('analysis');
    analysis.addMethod('POST', new apigateway.LambdaIntegration(this.requestHandler, { proxy: true }), authMethodOptions);
    analysis.addResource('history').addMethod('GET', new apigateway.LambdaIntegration(this.resultsApiHandler, { proxy: true }), authMethodOptions);
    analysis.addResource('spotlight').addMethod('GET', new apigateway.LambdaIntegration(this.resultsApiHandler, { proxy: true }), authMethodOptions);
    analysis.addResource('agent-accuracy').addMethod('GET', new apigateway.LambdaIntegration(this.resultsApiHandler, { proxy: true }), authMethodOptions);
    analysis.addResource('market-performance').addMethod('GET', new apigateway.LambdaIntegration(this.resultsApiHandler, { proxy: true }), authMethodOptions);
    analysis.addResource('status').addMethod('GET', new apigateway.LambdaIntegration(this.requestHandler, { proxy: true }), authMethodOptions);

    // /analysis/subscriptions - recurring-analysis lifecycle
    const analysisSubscriptionsHandler = new lambdaNode.NodejsFunction(this, 'AnalysisSubscriptionsHandler', {
      functionName: resourceName(config.envName, 'analysis-subscriptions'),
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: 'services/analysis-subscriptions/handler.ts',
      handler: 'handler',
      timeout: lambdaTimeout,
      memorySize: 256,
      environment: {
        DB_SECRET_ARN: dbSecret.secretArn,
        DB_HOST: dbEndpoint,
        EVENT_BUS_NAME: eventBus.eventBusName,
        ENVIRONMENT: config.envName,
      },
      bundling: {
        minify: isProd,
        sourceMap: !isProd,
      },
      description: 'Lists and cancels recurring analysis subscriptions; publishes recurring-analysis.cancelled events',
    });

    dbSecret.grantRead(analysisSubscriptionsHandler);
    analysisSubscriptionsHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['events:PutEvents'],
        resources: [eventBus.eventBusArn],
      })
    );
    analysisSubscriptionsHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['scheduler:DeleteSchedule', 'scheduler:GetSchedule'],
        resources: ['*'],
      })
    );

    const analysisSubscriptionsIntegration = new apigateway.LambdaIntegration(
      analysisSubscriptionsHandler,
      { proxy: true },
    );
    const analysisSubscriptions = analysis.addResource('subscriptions');
    analysisSubscriptions.addMethod('GET', analysisSubscriptionsIntegration, authMethodOptions);
    analysisSubscriptions
      .addResource('{requestId}')
      .addMethod('DELETE', analysisSubscriptionsIntegration, authMethodOptions);

    analysis.addResource('{analysisId}').addMethod('GET', new apigateway.LambdaIntegration(this.resultsApiHandler, { proxy: true }), authMethodOptions);

    // /subscriptions
    const subscriptions = this.restApi.root.addResource('subscriptions');
    const subscriptionIntegration = new apigateway.LambdaIntegration(this.subscriptionApiHandler, { proxy: true });
    subscriptions.addMethod('GET', subscriptionIntegration, authMethodOptions);
    subscriptions.addMethod('POST', subscriptionIntegration, authMethodOptions);
    subscriptions.addResource('{subscriptionId}').addMethod('DELETE', subscriptionIntegration, authMethodOptions);
    subscriptions.addResource('renew').addMethod('POST', subscriptionIntegration, authMethodOptions);
    subscriptions.addResource('trial').addMethod('POST', subscriptionIntegration, authMethodOptions);

    // /wallet
    const wallet = this.restApi.root.addResource('wallet');
    wallet.addResource('balance').addMethod('GET', subscriptionIntegration, authMethodOptions);

    // /payments
    const payments = this.restApi.root.addResource('payments');
    payments.addResource('history').addMethod('GET', subscriptionIntegration, authMethodOptions);

    // /credits
    const credits = this.restApi.root.addResource('credits');
    credits.addMethod('GET', mockIntegration, mockMethodOptions);
    credits.addResource('purchase').addMethod('POST', subscriptionIntegration, authMethodOptions);

    // /auth/magic-sync (no Cognito auth - called before user has Cognito tokens)
    const auth = this.restApi.root.addResource('auth');
    auth.addResource('magic-sync').addMethod('POST', new apigateway.LambdaIntegration(magicSyncHandler, { proxy: true }), {
      authorizationType: apigateway.AuthorizationType.NONE,
    });

    // /user
    const user = this.restApi.root.addResource('user');
    const profile = user.addResource('profile');
    profile.addMethod('GET', mockIntegration, mockMethodOptions);
    profile.addMethod('PUT', mockIntegration, mockMethodOptions);
    const notifications = user.addResource('notifications');
    const notificationIntegration = new apigateway.LambdaIntegration(this.notificationPrefsHandler, { proxy: true });
    notifications.addMethod('GET', notificationIntegration, authMethodOptions);
    notifications.addMethod('PUT', notificationIntegration, authMethodOptions);

    // ─── Portfolio Manager Lambda Functions ───────────────────────────────────

    // Shared portfolio environment variables
    const portfolioSharedEnv: Record<string, string> = {
      ...sharedEnv,
      ANALYSIS_COMPLETE_TOPIC_ARN: analysisCompleteTopic.topicArn,
      WEBSOCKET_ENDPOINT: `https://${this.webSocketApi.ref}.execute-api.${config.region}.amazonaws.com/${wsStage}`,
    };

    // ─── CLOB Credentials Secret ──────────────────────────────────────────────
    //
    // Polymarket CLOB credentials (api key, secret, passphrase) live in a single
    // Secrets Manager secret. The portfolio Lambdas lazy-load it via
    // `shared/clob-credentials.ts`. The secret value itself must be populated
    // out-of-band (deploy.sh / aws cli / console) - CDK only creates the
    // resource shell so we can wire IAM and env consistently.
    //
    // Expected JSON shape:
    //   { "apiUrl": "https://clob.polymarket.com", "apiKey": "...",
    //     "apiSecret": "...", "apiPassphrase": "..." }
    const clobCredentialsSecret = new secretsmanager.Secret(this, 'ClobCredentialsSecret', {
      secretName: resourceName(config.envName, 'clob-credentials'),
      description: 'Polymarket CLOB API credentials for portfolio manager Lambdas',
      removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });

    const clobEnv: Record<string, string> = {
      CLOB_CREDENTIALS_SECRET_ARN: clobCredentialsSecret.secretArn,
      // Sensible default - handlers fall back if secret JSON omits apiUrl
      CLOB_API_URL: 'https://clob.polymarket.com',
    };

    // 1. Portfolio Activation (POST /portfolio/sessions, 30s timeout)
    this.portfolioActivationHandler = new lambdaNode.NodejsFunction(this, 'PortfolioActivationHandler', {
      functionName: resourceName(config.envName, 'portfolio-activation'),
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: 'services/portfolio-activation/handler.ts',
      handler: 'handler',
      timeout: lambdaTimeout,
      memorySize: 256,
      environment: {
        ...portfolioSharedEnv,
        SCHEDULER_ROLE_ARN: schedulerRole.roleArn,
        POSITION_GUARD_LAMBDA_ARN: '', // Will be set after position guard is created
      },
      bundling: {
        minify: isProd,
        sourceMap: !isProd,
      },
      description: 'Creates portfolio manager sessions, validates prerequisites, sets up position guard schedule',
    });

    dbSecret.grantRead(this.portfolioActivationHandler);
    dedupCacheTable.grantReadWriteData(this.portfolioActivationHandler);
    rateLimitTable.grantReadWriteData(this.portfolioActivationHandler);

    this.portfolioActivationHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'scheduler:CreateSchedule',
          'scheduler:GetSchedule',
          'scheduler:DeleteSchedule',
          'scheduler:UpdateSchedule',
        ],
        resources: ['*'],
      })
    );

    this.portfolioActivationHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['iam:PassRole'],
        resources: [schedulerRole.roleArn],
      })
    );

    this.portfolioActivationHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['events:PutEvents'],
        resources: [eventBus.eventBusArn],
      })
    );

    // 2. Portfolio Trade Executor (EventBridge trigger, 60s timeout)
    this.portfolioTradeExecutorHandler = new lambdaNode.NodejsFunction(this, 'PortfolioTradeExecutorHandler', {
      functionName: resourceName(config.envName, 'portfolio-trade-executor'),
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: 'services/portfolio-trade-executor/handler.ts',
      handler: 'handler',
      timeout: lambdaTimeout,
      memorySize: 512,
      environment: {
        ...portfolioSharedEnv,
        ...clobEnv,
      },
      bundling: {
        minify: isProd,
        sourceMap: !isProd,
      },
      description: 'Evaluates analysis results, sizes positions, places orders on Polymarket CLOB',
    });

    dbSecret.grantRead(this.portfolioTradeExecutorHandler);
    dedupCacheTable.grantReadWriteData(this.portfolioTradeExecutorHandler);
    rateLimitTable.grantReadWriteData(this.portfolioTradeExecutorHandler);
    analysisBucket.grantRead(this.portfolioTradeExecutorHandler);
    clobCredentialsSecret.grantRead(this.portfolioTradeExecutorHandler);

    this.portfolioTradeExecutorHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['events:PutEvents'],
        resources: [eventBus.eventBusArn],
      })
    );

    this.portfolioTradeExecutorHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['sns:Publish'],
        resources: [analysisCompleteTopic.topicArn],
      })
    );

    this.portfolioTradeExecutorHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['secretsmanager:GetSecretValue'],
        resources: [dbSecret.secretArn],
      })
    );

    // Grant trade executor permission to invoke Portfolio_Lambda
    this.portfolioTradeExecutorHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['lambda:InvokeFunction'],
        resources: [portfolioLambda.functionArn],
      })
    );

    // Add PORTFOLIO_LAMBDA_ARN env var to trade executor
    this.portfolioTradeExecutorHandler.addEnvironment('PORTFOLIO_LAMBDA_ARN', portfolioLambda.functionArn);

    // 3. Portfolio Position Guard (EventBridge Scheduler trigger, 30s timeout)
    this.portfolioPositionGuardHandler = new lambdaNode.NodejsFunction(this, 'PortfolioPositionGuardHandler', {
      functionName: resourceName(config.envName, 'portfolio-position-guard'),
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: 'services/portfolio-position-guard/handler.ts',
      handler: 'handler',
      timeout: lambdaTimeout,
      memorySize: 256,
      environment: {
        ...portfolioSharedEnv,
        ...clobEnv,
        TRADE_EXECUTOR_FUNCTION_NAME: resourceName(config.envName, 'portfolio-trade-executor'),
      },
      bundling: {
        minify: isProd,
        sourceMap: !isProd,
      },
      description: 'Monitors positions, detects regime shifts, triggers exits via EventBridge Scheduler',
    });

    dbSecret.grantRead(this.portfolioPositionGuardHandler);
    dedupCacheTable.grantReadWriteData(this.portfolioPositionGuardHandler);
    rateLimitTable.grantReadWriteData(this.portfolioPositionGuardHandler);
    analysisBucket.grantRead(this.portfolioPositionGuardHandler);
    clobCredentialsSecret.grantRead(this.portfolioPositionGuardHandler);

    this.portfolioPositionGuardHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['events:PutEvents'],
        resources: [eventBus.eventBusArn],
      })
    );

    this.portfolioPositionGuardHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['lambda:InvokeFunction'],
        resources: [this.portfolioTradeExecutorHandler.functionArn],
      })
    );

    this.portfolioPositionGuardHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['sqs:SendMessage'],
        resources: [analysisQueue.queueArn],
      })
    );

    // Grant position guard permission to invoke Portfolio_Lambda
    this.portfolioPositionGuardHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['lambda:InvokeFunction'],
        resources: [portfolioLambda.functionArn],
      })
    );

    // Add PORTFOLIO_LAMBDA_ARN env var to position guard
    this.portfolioPositionGuardHandler.addEnvironment('PORTFOLIO_LAMBDA_ARN', portfolioLambda.functionArn);

    // Update activation handler with position guard ARN now that it's created
    this.portfolioActivationHandler.addEnvironment(
      'POSITION_GUARD_LAMBDA_ARN',
      this.portfolioPositionGuardHandler.functionArn
    );

    // Allow EventBridge Scheduler to invoke position guard
    this.portfolioPositionGuardHandler.addPermission('AllowSchedulerInvoke', {
      principal: new iam.ServicePrincipal('scheduler.amazonaws.com'),
      sourceAccount: cdk.Aws.ACCOUNT_ID,
    });

    // 4. Portfolio Risk Engine (EventBridge + REST API, 15s timeout)
    this.portfolioRiskEngineHandler = new lambdaNode.NodejsFunction(this, 'PortfolioRiskEngineHandler', {
      functionName: resourceName(config.envName, 'portfolio-risk-engine'),
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: 'services/portfolio-risk-engine/handler.ts',
      handler: 'handler',
      timeout: lambdaTimeout,
      memorySize: 256,
      environment: {
        ...portfolioSharedEnv,
        ...clobEnv,
        TRADE_EXECUTOR_FUNCTION_NAME: resourceName(config.envName, 'portfolio-trade-executor'),
      },
      bundling: {
        minify: isProd,
        sourceMap: !isProd,
      },
      description: 'Enforces loss limits, position caps, cooldowns, and kill switch functionality',
    });

    dbSecret.grantRead(this.portfolioRiskEngineHandler);
    dedupCacheTable.grantReadWriteData(this.portfolioRiskEngineHandler);
    rateLimitTable.grantReadWriteData(this.portfolioRiskEngineHandler);
    clobCredentialsSecret.grantRead(this.portfolioRiskEngineHandler);

    this.portfolioRiskEngineHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['events:PutEvents'],
        resources: [eventBus.eventBusArn],
      })
    );

    this.portfolioRiskEngineHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['lambda:InvokeFunction'],
        resources: [this.portfolioTradeExecutorHandler.functionArn],
      })
    );

    this.portfolioRiskEngineHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'scheduler:DeleteSchedule',
          'scheduler:GetSchedule',
        ],
        resources: ['*'],
      })
    );

    this.portfolioRiskEngineHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['sns:Publish'],
        resources: [analysisCompleteTopic.topicArn],
      })
    );

    // 5. Portfolio Lifecycle (EventBridge Scheduler + REST API, 30s timeout)
    this.portfolioLifecycleHandler = new lambdaNode.NodejsFunction(this, 'PortfolioLifecycleHandler', {
      functionName: resourceName(config.envName, 'portfolio-lifecycle'),
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: 'services/portfolio-lifecycle/handler.ts',
      handler: 'handler',
      timeout: lambdaTimeout,
      memorySize: 256,
      environment: {
        ...portfolioSharedEnv,
        ...clobEnv,
      },
      bundling: {
        minify: isProd,
        sourceMap: !isProd,
      },
      description: 'Handles market resolution, session termination, and daily summaries',
    });

    dbSecret.grantRead(this.portfolioLifecycleHandler);
    dedupCacheTable.grantReadWriteData(this.portfolioLifecycleHandler);
    clobCredentialsSecret.grantRead(this.portfolioLifecycleHandler);

    this.portfolioLifecycleHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['events:PutEvents'],
        resources: [eventBus.eventBusArn],
      })
    );

    this.portfolioLifecycleHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'scheduler:DeleteSchedule',
          'scheduler:GetSchedule',
        ],
        resources: ['*'],
      })
    );

    this.portfolioLifecycleHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['sns:Publish'],
        resources: [analysisCompleteTopic.topicArn],
      })
    );

    // Allow EventBridge Scheduler to invoke lifecycle handler (market resolution check)
    this.portfolioLifecycleHandler.addPermission('AllowSchedulerInvoke', {
      principal: new iam.ServicePrincipal('scheduler.amazonaws.com'),
      sourceAccount: cdk.Aws.ACCOUNT_ID,
    });

    // 6. Portfolio Investment (REST API, 15s timeout)
    this.portfolioInvestmentHandler = new lambdaNode.NodejsFunction(this, 'PortfolioInvestmentHandler', {
      functionName: resourceName(config.envName, 'portfolio-investment'),
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: 'services/portfolio-investment/handler.ts',
      handler: 'handler',
      timeout: lambdaTimeout,
      memorySize: 256,
      environment: {
        ...portfolioSharedEnv,
      },
      bundling: {
        minify: isProd,
        sourceMap: !isProd,
      },
      description: 'Handles investment amount increases and decreases for portfolio sessions',
    });

    dbSecret.grantRead(this.portfolioInvestmentHandler);

    this.portfolioInvestmentHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['events:PutEvents'],
        resources: [eventBus.eventBusArn],
      })
    );

    // 7. Portfolio Dashboard API (REST API, 15s timeout)
    this.portfolioDashboardApiHandler = new lambdaNode.NodejsFunction(this, 'PortfolioDashboardApiHandler', {
      functionName: resourceName(config.envName, 'portfolio-dashboard-api'),
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: 'services/portfolio-dashboard-api/handler.ts',
      handler: 'handler',
      timeout: lambdaTimeout,
      memorySize: 256,
      environment: {
        ...portfolioSharedEnv,
        ...clobEnv,
      },
      bundling: {
        minify: isProd,
        sourceMap: !isProd,
      },
      description: 'Serves portfolio session list, trade history, decisions, stats, and persona settings',
    });

    dbSecret.grantRead(this.portfolioDashboardApiHandler);
    rateLimitTable.grantReadWriteData(this.portfolioDashboardApiHandler);
    clobCredentialsSecret.grantRead(this.portfolioDashboardApiHandler);

    // 8. Portfolio WebSocket Delivery - fans out portfolio events to active connections
    const portfolioWsDeliveryHandler = new lambdaNode.NodejsFunction(this, 'PortfolioWsDeliveryHandler', {
      functionName: resourceName(config.envName, 'portfolio-ws-delivery'),
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: 'services/portfolio-ws-delivery/handler.ts',
      handler: 'handler',
      timeout: lambdaTimeout,
      memorySize: 256,
      environment: {
        CONNECTIONS_TABLE: connectionsTable.tableName,
        WEBSOCKET_ENDPOINT: `https://${this.webSocketApi.ref}.execute-api.${config.region}.amazonaws.com/${wsStage}`,
      },
      bundling: {
        minify: isProd,
        sourceMap: !isProd,
      },
      description: 'Pushes portfolio events to active WebSocket connections for the target user',
    });

    connectionsTable.grantReadWriteData(portfolioWsDeliveryHandler);

    portfolioWsDeliveryHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['execute-api:ManageConnections'],
        resources: [`arn:aws:execute-api:${config.region}:${cdk.Aws.ACCOUNT_ID}:${this.webSocketApi.ref}/${wsStage}/POST/@connections/*`],
      })
    );

    // 9. Portfolio Notification - multi-channel delivery for portfolio events
    const portfolioNotificationHandler = new lambdaNode.NodejsFunction(this, 'PortfolioNotificationHandler', {
      functionName: resourceName(config.envName, 'portfolio-notification'),
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: 'services/portfolio-notification/handler.ts',
      handler: 'handler',
      timeout: lambdaTimeout,
      memorySize: 256,
      environment: {
        DB_SECRET_ARN: dbSecret.secretArn,
        DB_HOST: dbEndpoint,
        CONNECTIONS_TABLE: connectionsTable.tableName,
        WEBSOCKET_ENDPOINT: `https://${this.webSocketApi.ref}.execute-api.${config.region}.amazonaws.com/${wsStage}`,
        ...emailProviderEnv,
        APP_URL: process.env.APP_URL || (isProd ? 'https://tradewizard.live' : 'http://localhost:3000'),
      },
      bundling: {
        minify: isProd,
        sourceMap: !isProd,
      },
      description: 'Multi-channel (WS/email/push) delivery for portfolio events; handles quiet hours and overrides',
    });

    dbSecret.grantRead(portfolioNotificationHandler);
    connectionsTable.grantReadWriteData(portfolioNotificationHandler);
    resendApiKeySecret.grantRead(portfolioNotificationHandler);

    // Allow the retained SES fallback (EMAIL_PROVIDER=ses)
    portfolioNotificationHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ses:SendEmail', 'ses:SendRawEmail'],
        resources: ['*'],
      })
    );
    portfolioNotificationHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['sns:Publish'],
        resources: ['*'],
      })
    );
    portfolioNotificationHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['execute-api:ManageConnections'],
        resources: [`arn:aws:execute-api:${config.region}:${cdk.Aws.ACCOUNT_ID}:${this.webSocketApi.ref}/${wsStage}/POST/@connections/*`],
      })
    );

    // 10. Portfolio Analysis Consumer - pauses sessions when recurring analysis is cancelled
    const portfolioAnalysisConsumerHandler = new lambdaNode.NodejsFunction(this, 'PortfolioAnalysisConsumerHandler', {
      functionName: resourceName(config.envName, 'portfolio-analysis-consumer'),
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: 'services/portfolio-analysis-consumer/handler.ts',
      handler: 'handler',
      timeout: lambdaTimeout,
      memorySize: 256,
      environment: {
        DB_SECRET_ARN: dbSecret.secretArn,
        DB_HOST: dbEndpoint,
        EVENT_BUS_NAME: eventBus.eventBusName,
      },
      bundling: {
        minify: isProd,
        sourceMap: !isProd,
      },
      description: 'Pauses portfolio sessions whose recurring analysis subscription was cancelled or paused',
    });

    dbSecret.grantRead(portfolioAnalysisConsumerHandler);
    portfolioAnalysisConsumerHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['events:PutEvents'],
        resources: [eventBus.eventBusArn],
      })
    );

    // ─── EventBridge Rules for Portfolio Manager ──────────────────────────────

    // Rule: analysis-complete events → portfolio-trade-executor
    // Fires for ALL AnalysisCompleted events (both fresh and cached deliveries).
    // A cached delivery can be a new result from the PM's perspective - e.g., a
    // 4-hour subscriber receiving a 10-min-old result produced by a 1-hour schedule.
    // The trade executor's own idempotency check (session_id, analysis_result_id)
    // prevents duplicate decisions if the PM already acted on the same result.
    const portfolioAnalysisCompleteRule = new events.Rule(this, 'PortfolioAnalysisCompleteRule', {
      eventBus: eventBus,
      ruleName: resourceName(config.envName, 'portfolio-analysis-complete'),
      eventPattern: {
        source: ['tradewizard.analysis'],
        detailType: ['AnalysisCompleted'],
      },
    });
    portfolioAnalysisCompleteRule.addTarget(
      new events_targets.LambdaFunction(this.portfolioTradeExecutorHandler)
    );

    // Rule: portfolio trade/exit events → portfolio-risk-engine
    // The risk engine watches actual trade/exit events to enforce cross-session
    // loss limits, cooldown checks, and position size caps. Publisher is the
    // trade executor / position guard with source 'tradewizard.portfolio-manager'.
    const portfolioTradeEventRule = new events.Rule(this, 'PortfolioTradeEventRule', {
      eventBus: eventBus,
      ruleName: resourceName(config.envName, 'portfolio-trade-event'),
      eventPattern: {
        source: ['tradewizard.portfolio-manager'],
        detailType: [
          'portfolio.trade.executed',
          'portfolio.position.exited',
        ],
      },
    });
    portfolioTradeEventRule.addTarget(
      new events_targets.LambdaFunction(this.portfolioRiskEngineHandler)
    );

    // Rule: ALL portfolio events → portfolio-ws-delivery (real-time WS push)
    const portfolioWsEventRule = new events.Rule(this, 'PortfolioWsEventRule', {
      eventBus: eventBus,
      ruleName: resourceName(config.envName, 'portfolio-ws-events'),
      description: 'Routes portfolio events to the WebSocket fan-out Lambda',
      eventPattern: {
        source: [
          'tradewizard.portfolio-manager',
          'tradewizard.portfolio.risk-engine',
          'tradewizard.portfolio.lifecycle',
        ],
        detailType: [
          'portfolio.session.updated',
          'portfolio.trade.executed',
          'portfolio.position.exited',
          'portfolio.risk.alert',
          'portfolio.risk.loss_warning',
          'portfolio.kill_switch.triggered',
          'portfolio.session.paused',
          'portfolio.session.paused-no-analysis',
          'portfolio.session.terminated',
          'portfolio.daily_summary',
        ],
      },
    });
    portfolioWsEventRule.addTarget(
      new events_targets.LambdaFunction(portfolioWsDeliveryHandler)
    );

    // Rule: ALL portfolio events → portfolio-notification (multi-channel)
    const portfolioNotificationEventRule = new events.Rule(this, 'PortfolioNotificationEventRule', {
      eventBus: eventBus,
      ruleName: resourceName(config.envName, 'portfolio-notification-events'),
      description: 'Routes portfolio events to the multi-channel notification Lambda',
      eventPattern: {
        source: [
          'tradewizard.portfolio-manager',
          'tradewizard.portfolio.risk-engine',
          'tradewizard.portfolio.lifecycle',
        ],
        detailType: [
          'portfolio.trade.executed',
          'portfolio.position.exited',
          'portfolio.kill_switch.triggered',
          'portfolio.session.paused',
          'portfolio.session.paused-no-analysis',
          'portfolio.risk.loss_warning',
          'portfolio.daily_summary',
          'portfolio.session.terminated',
        ],
      },
    });
    portfolioNotificationEventRule.addTarget(
      new events_targets.LambdaFunction(portfolioNotificationHandler)
    );

    // Rule: subscription cancellation events → portfolio-analysis-consumer
    // The analysis-request / subscription-api services publish these when a
    // recurring analysis subscription transitions; the consumer pauses any
    // active portfolio sessions that depend on the analysis stream.
    const portfolioSubscriptionLifecycleRule = new events.Rule(this, 'PortfolioSubscriptionLifecycleRule', {
      eventBus: eventBus,
      ruleName: resourceName(config.envName, 'portfolio-subscription-lifecycle'),
      description: 'Routes recurring-analysis subscription lifecycle changes to portfolio-analysis-consumer',
      eventPattern: {
        source: ['tradewizard.analysis'],
        detailType: [
          'recurring-analysis.cancelled',
          'recurring-analysis.paused',
          'recurring-analysis.resumed',
          'recurring-analysis.created',
        ],
      },
    });
    portfolioSubscriptionLifecycleRule.addTarget(
      new events_targets.LambdaFunction(portfolioAnalysisConsumerHandler)
    );

    // Rule: AnalysisFailed events → SNS analysisCompleteTopic for fan-out.
    // The SNS-bound delivery handlers (analysis-delivery / email / push /
    // webhook) detect the AnalysisFailed detail-type via the EventBridge
    // envelope and render a failure-specific template (or skip cleanly for
    // channels that can't represent failures). The AnalysisFailed payload
    // carries the canonical users.id (set by the orchestrator's failure
    // publisher) so all downstream RDS lookups work without translation.
    const analysisFailedRule = new events.Rule(this, 'AnalysisFailedRule', {
      eventBus: eventBus,
      ruleName: resourceName(config.envName, 'analysis-failed'),
      description: 'Routes AnalysisFailed events to the SNS topic for delivery fan-out',
      eventPattern: {
        source: ['tradewizard.analysis'],
        detailType: ['AnalysisFailed'],
      },
    });
    analysisFailedRule.addTarget(new events_targets.SnsTopic(analysisCompleteTopic));

    // EventBridge rule: route AnalysisProgress events to SNS topic for real-time delivery.
    // Progress events are published by the Python orchestrator at each stage transition
    // and delivered to users via WebSocket so they can see which stage their analysis
    // is currently executing (Market Ingestion → Web Research → Intelligence Agents → etc.)
    const analysisProgressRule = new events.Rule(this, 'AnalysisProgressRule', {
      eventBus: eventBus,
      ruleName: resourceName(config.envName, 'analysis-progress'),
      description: 'Routes AnalysisProgress events to SNS for real-time WebSocket delivery',
      eventPattern: {
        source: ['tradewizard.analysis'],
        detailType: ['AnalysisProgress'],
      },
    });
    analysisProgressRule.addTarget(new events_targets.SnsTopic(analysisCompleteTopic));

    // ─── EventBridge Schedules: Portfolio Lifecycle Tasks ─────────────────────
    //
    // The lifecycle handler dispatches by `event.source === 'aws.scheduler'`
    // and a `'detail-type'` field that mirrors the task name. We use
    // `events.Schedule.rate` rules with a custom RuleTargetInput that supplies
    // the `'detail-type'` the handler expects. The handler reuses the literal
    // `'aws.scheduler'` source string to recognize scheduled events.

    type LifecycleSchedule = {
      idSuffix: string;
      ruleId: string;
      detailType: string;
      schedule: events.Schedule;
      description: string;
    };

    const lifecycleSchedules: LifecycleSchedule[] = [
      {
        idSuffix: 'market-resolution',
        ruleId: 'PortfolioLifecycleResolutionRule',
        detailType: 'portfolio.lifecycle.resolution-check',
        schedule: events.Schedule.rate(cdk.Duration.minutes(5)),
        description: 'Runs every 5 minutes - detects market resolution and closes affected sessions',
      },
      {
        idSuffix: 'capital-check',
        ruleId: 'PortfolioLifecycleCapitalCheckRule',
        detailType: 'portfolio.lifecycle.capital-check',
        schedule: events.Schedule.rate(cdk.Duration.minutes(15)),
        description: 'Runs every 15 minutes - terminates sessions whose available capital fell below the floor',
      },
      {
        idSuffix: 'profit-target-check',
        ruleId: 'PortfolioLifecycleProfitTargetRule',
        detailType: 'portfolio.lifecycle.profit-target-check',
        schedule: events.Schedule.rate(cdk.Duration.minutes(10)),
        description: 'Runs every 10 minutes - terminates sessions that hit their configured profit target',
      },
      {
        idSuffix: 'daily-summary',
        ruleId: 'PortfolioLifecycleDailySummaryRule',
        detailType: 'portfolio.lifecycle.daily-summary',
        schedule: events.Schedule.cron({ minute: '0', hour: '0' }), // 00:00 UTC daily
        description: 'Runs once a day at 00:00 UTC - sends daily summary notifications to active sessions',
      },
    ];

    for (const lc of lifecycleSchedules) {
      const rule = new events.Rule(this, lc.ruleId, {
        ruleName: resourceName(config.envName, `portfolio-lifecycle-${lc.idSuffix}`),
        schedule: lc.schedule,
        description: lc.description,
      });
      rule.addTarget(
        new events_targets.LambdaFunction(this.portfolioLifecycleHandler, {
          // The handler expects { source: 'aws.scheduler', 'detail-type': '...' }
          event: events.RuleTargetInput.fromObject({
            source: 'aws.scheduler',
            'detail-type': lc.detailType,
            detail: { type: lc.detailType },
          }),
        })
      );
    }

    // ─── Portfolio Manager REST API Routes ────────────────────────────────────

    const portfolio = this.restApi.root.addResource('portfolio');
    const portfolioSessions = portfolio.addResource('sessions');
    const portfolioActivationIntegration = new apigateway.LambdaIntegration(this.portfolioActivationHandler, { proxy: true });
    const portfolioDashboardIntegration = new apigateway.LambdaIntegration(this.portfolioDashboardApiHandler, { proxy: true });
    const portfolioLifecycleIntegration = new apigateway.LambdaIntegration(this.portfolioLifecycleHandler, { proxy: true });
    const portfolioInvestmentIntegration = new apigateway.LambdaIntegration(this.portfolioInvestmentHandler, { proxy: true });
    const portfolioRiskEngineIntegration = new apigateway.LambdaIntegration(this.portfolioRiskEngineHandler, { proxy: true });

    // POST /portfolio/sessions → portfolio-activation
    portfolioSessions.addMethod('POST', portfolioActivationIntegration, authMethodOptions);

    // GET /portfolio/sessions → portfolio-dashboard-api
    portfolioSessions.addMethod('GET', portfolioDashboardIntegration, authMethodOptions);

    // /portfolio/sessions/{id}
    const portfolioSessionById = portfolioSessions.addResource('{id}');

    // GET /portfolio/sessions/{id} → portfolio-dashboard-api
    portfolioSessionById.addMethod('GET', portfolioDashboardIntegration, authMethodOptions);

    // DELETE /portfolio/sessions/{id} → portfolio-lifecycle
    portfolioSessionById.addMethod('DELETE', portfolioLifecycleIntegration, authMethodOptions);

    // PUT /portfolio/sessions/{id}/pause → portfolio-dashboard-api
    const portfolioSessionPause = portfolioSessionById.addResource('pause');
    portfolioSessionPause.addMethod('PUT', portfolioDashboardIntegration, authMethodOptions);

    // PUT /portfolio/sessions/{id}/resume → portfolio-dashboard-api
    const portfolioSessionResume = portfolioSessionById.addResource('resume');
    portfolioSessionResume.addMethod('PUT', portfolioDashboardIntegration, authMethodOptions);

    // PUT /portfolio/sessions/{id}/investment → portfolio-investment
    const portfolioSessionInvestment = portfolioSessionById.addResource('investment');
    portfolioSessionInvestment.addMethod('PUT', portfolioInvestmentIntegration, authMethodOptions);

    // GET /portfolio/sessions/{id}/investment → portfolio-investment
    portfolioSessionInvestment.addMethod('GET', portfolioInvestmentIntegration, authMethodOptions);

    // GET /portfolio/sessions/{id}/trades → portfolio-dashboard-api
    const portfolioSessionTrades = portfolioSessionById.addResource('trades');
    portfolioSessionTrades.addMethod('GET', portfolioDashboardIntegration, authMethodOptions);

    // GET /portfolio/sessions/{id}/decisions → portfolio-dashboard-api
    const portfolioSessionDecisions = portfolioSessionById.addResource('decisions');
    portfolioSessionDecisions.addMethod('GET', portfolioDashboardIntegration, authMethodOptions);

    // GET /portfolio/stats → portfolio-dashboard-api
    const portfolioStats = portfolio.addResource('stats');
    portfolioStats.addMethod('GET', portfolioDashboardIntegration, authMethodOptions);

    // /portfolio/preflight
    const portfolioPreflight = portfolio.addResource('preflight');
    const portfolioPreflightRecurring = portfolioPreflight.addResource('recurring-analysis');

    // GET /portfolio/preflight/recurring-analysis → portfolio-dashboard-api
    portfolioPreflightRecurring.addMethod('GET', portfolioDashboardIntegration, authMethodOptions);

    // /portfolio/settings
    const portfolioSettings = portfolio.addResource('settings');
    const portfolioPersona = portfolioSettings.addResource('persona');

    // PUT /portfolio/settings/persona → portfolio-dashboard-api
    portfolioPersona.addMethod('PUT', portfolioDashboardIntegration, authMethodOptions);

    // GET /portfolio/settings/persona → portfolio-dashboard-api
    portfolioPersona.addMethod('GET', portfolioDashboardIntegration, authMethodOptions);

    // /portfolio/kill-switch
    const portfolioKillSwitch = portfolio.addResource('kill-switch');

    // POST /portfolio/kill-switch → portfolio-risk-engine
    portfolioKillSwitch.addMethod('POST', portfolioRiskEngineIntegration, authMethodOptions);

    // DELETE /portfolio/kill-switch → portfolio-risk-engine
    portfolioKillSwitch.addMethod('DELETE', portfolioRiskEngineIntegration, authMethodOptions);

    // ─── Outputs ──────────────────────────────────────────────────────────────

    new cdk.CfnOutput(this, 'ApiUrl', {
      value: this.restApi.url,
      exportName: resourceName(config.envName, 'api-url'),
    });

    new cdk.CfnOutput(this, 'ApiId', {
      value: this.restApi.restApiId,
      exportName: resourceName(config.envName, 'api-id'),
    });

    new cdk.CfnOutput(this, 'WebSocketApiId', {
      value: this.webSocketApi.ref,
      exportName: resourceName(config.envName, 'ws-api-id'),
    });

    new cdk.CfnOutput(this, 'WebSocketUrl', {
      value: `wss://${this.webSocketApi.ref}.execute-api.${config.region}.amazonaws.com/${wsStage}`,
      exportName: resourceName(config.envName, 'ws-url'),
    });

    new cdk.CfnOutput(this, 'RequestHandlerArn', {
      value: this.requestHandler.functionArn,
      exportName: resourceName(config.envName, 'request-handler-arn'),
    });

    new cdk.CfnOutput(this, 'OrchestratorHandlerArn', {
      value: this.orchestratorHandler.functionArn,
      exportName: resourceName(config.envName, 'orchestrator-handler-arn'),
    });
  }
}
