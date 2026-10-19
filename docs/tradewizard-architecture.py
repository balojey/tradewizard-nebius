"""
TradeWizard V2 - Full System Architecture Diagram
Generated using the Python `diagrams` package.
"""

from diagrams import Diagram, Cluster, Edge
from diagrams.aws.compute import Lambda
from diagrams.aws.database import Aurora, Dynamodb
from diagrams.aws.network import APIGateway, CloudFront
from diagrams.aws.integration import SQS, SNS, Eventbridge
from diagrams.aws.security import Cognito, SecretsManager
from diagrams.aws.storage import S3
from diagrams.aws.management import Cloudwatch
from diagrams.aws.engagement import SES
from diagrams.aws.mobile import APIGateway as MobileGateway
from diagrams.aws.ml import Bedrock
from diagrams.onprem.client import Users
from diagrams.generic.database import SQL
from diagrams.programming.framework import React
from diagrams.custom import Custom

graph_attr = {
    "fontsize": "28",
    "bgcolor": "white",
    "pad": "0.8",
    "nodesep": "0.8",
    "ranksep": "1.2",
    "splines": "ortho",
}

with Diagram(
    "TradeWizard V2 - Platform Architecture",
    filename="/home/balo/hackathons/devpost/tradewizard/docs/tradewizard-architecture",
    show=False,
    direction="TB",
    graph_attr=graph_attr,
):

    # --- Users ---
    users = Users("Users\n(Web/Mobile)")

    # --- Frontend ---
    with Cluster("Frontend (Next.js 16 + React 19)"):
        frontend = React("Next.js App\n(Amplify Hosting)")

    # --- Authentication ---
    with Cluster("Authentication"):
        cognito = Cognito("Cognito\n(Magic Link Auth)")
        auth_triggers = Lambda("Auth Triggers\n(Define/Create/Verify)")

    # --- API Layer ---
    with Cluster("API Layer"):
        rest_api = APIGateway("REST API\nGateway")
        ws_api = APIGateway("WebSocket API\nGateway")

    # --- Request Handling ---
    with Cluster("Request Handling & Orchestration"):
        analysis_request = Lambda("Analysis\nRequest")
        analysis_orchestrator = Lambda("Analysis\nOrchestrator")
        subscription_api = Lambda("Subscription\nAPI")
        results_api = Lambda("Results\nAPI")
        portfolio_dashboard = Lambda("Portfolio\nDashboard API")
        notification_prefs = Lambda("Notification\nPreferences")

    # --- Queue & Events ---
    with Cluster("Queue & Event Bus"):
        sqs_queue = SQS("Analysis Queue\n(FIFO + DLQ)")
        event_bus = Eventbridge("EventBridge\nEvent Bus")
        scheduler = Eventbridge("EventBridge\nScheduler")

    # --- AI Analysis Engine ---
    with Cluster("AI Analysis Engine (Strands SDK)"):
        analysis_lambda = Lambda("Analysis Lambda\n(11-Stage Workflow)")

        with Cluster("14 Intelligence Agents"):
            agents_group_1 = Lambda("Nova Micro Agents\n(Microstructure, Baseline,\nMomentum)")
            agents_group_2 = Lambda("Nova Lite Agents\n(Risk, Polling,\nMean Reversion)")
            agents_group_3 = Lambda("Nemotron Agents\n(News, Events,\nHistorical)")
            agents_group_4 = Lambda("GPT-OSS Agents\n(Media, Social,\nNarrative)")
            agents_group_5 = Lambda("Kimi K2 Agents\n(Catalyst, Tail Risk)")

        with Cluster("Non-Tool Stages (Llama 3.3 70B)"):
            thesis = Lambda("Thesis +\nCross-Exam")
            risk_rec = Lambda("Risk Philosophy +\nRecommendation")

        bedrock = Bedrock("Amazon Bedrock\n(7 Models)")

    # --- Portfolio Manager ---
    with Cluster("Portfolio Manager (Pro/Elite)"):
        portfolio_lambda = Lambda("Portfolio Lambda\n(Persona Agent)")
        trade_executor = Lambda("Trade\nExecutor")
        position_guard = Lambda("Position\nGuard")
        risk_engine = Lambda("Risk\nEngine")
        portfolio_lifecycle = Lambda("Lifecycle\nManager")

    # --- Delivery Layer ---
    with Cluster("Multi-Channel Delivery"):
        sns_topic = SNS("SNS\n(Analysis Complete)")
        ws_delivery = Lambda("WebSocket\nDelivery")
        email_delivery = Lambda("Email\nDelivery (SES)")
        push_delivery = Lambda("Push\nDelivery (SNS)")
        webhook_delivery = Lambda("Webhook\nDelivery")
        ses = SES("Amazon SES")

    # --- Data Layer ---
    with Cluster("Data Layer"):
        aurora = Aurora("Aurora PostgreSQL\nServerless v2")
        dynamodb = Dynamodb("DynamoDB\n(Dedup, Connections,\nRate Limits)")
        s3 = S3("S3\n(Results, Traces)")
        secrets = SecretsManager("Secrets Manager\n(API Keys, DB Creds)")

    # --- External APIs ---
    with Cluster("External APIs"):
        polymarket = SQL("Polymarket\nCLOB + Gamma API")
        newsdata = SQL("NewsData.io")
        serper = SQL("Serper\n(Search + Scrape)")

    # --- Monitoring ---
    with Cluster("Monitoring & Observability"):
        cloudwatch = Cloudwatch("CloudWatch\n(Logs, Metrics,\nAlarms)")

    # ===== CONNECTIONS =====

    # User flow
    users >> Edge(label="HTTPS") >> frontend
    frontend >> Edge(label="REST") >> rest_api
    frontend >> Edge(label="WS") >> ws_api

    # Auth
    frontend >> Edge(label="Auth") >> cognito
    cognito >> auth_triggers

    # REST API routes
    rest_api >> analysis_request
    rest_api >> subscription_api
    rest_api >> results_api
    rest_api >> portfolio_dashboard
    rest_api >> notification_prefs

    # WebSocket
    ws_api >> ws_delivery

    # Analysis flow
    analysis_request >> sqs_queue
    analysis_request >> dynamodb
    sqs_queue >> analysis_orchestrator
    analysis_orchestrator >> analysis_lambda

    # Analysis Lambda internals
    analysis_lambda >> agents_group_1
    analysis_lambda >> agents_group_2
    analysis_lambda >> agents_group_3
    analysis_lambda >> agents_group_4
    analysis_lambda >> agents_group_5
    analysis_lambda >> thesis
    analysis_lambda >> risk_rec

    # Bedrock
    agents_group_1 >> bedrock
    agents_group_2 >> bedrock
    agents_group_3 >> bedrock
    agents_group_4 >> bedrock
    agents_group_5 >> bedrock
    thesis >> bedrock
    risk_rec >> bedrock

    # External tools for agents
    agents_group_3 >> newsdata
    agents_group_3 >> serper
    agents_group_4 >> serper

    # Analysis completion
    analysis_lambda >> sns_topic
    analysis_lambda >> s3
    analysis_lambda >> aurora

    # SNS fan-out delivery
    sns_topic >> ws_delivery
    sns_topic >> email_delivery
    sns_topic >> push_delivery
    sns_topic >> webhook_delivery
    email_delivery >> ses

    # Portfolio Manager flow
    event_bus >> trade_executor
    trade_executor >> portfolio_lambda
    trade_executor >> polymarket
    position_guard >> portfolio_lambda
    scheduler >> position_guard
    risk_engine >> aurora
    portfolio_lifecycle >> aurora

    # Data layer connections
    analysis_request >> aurora
    subscription_api >> aurora
    results_api >> s3
    portfolio_dashboard >> aurora
    analysis_lambda >> aurora

    # DynamoDB uses
    ws_delivery >> dynamodb

    # Secrets
    analysis_lambda >> secrets
    trade_executor >> secrets

    # Polymarket
    analysis_lambda >> polymarket

    # Monitoring
    analysis_lambda >> cloudwatch
    trade_executor >> cloudwatch
    risk_engine >> cloudwatch

    # Scheduling
    scheduler >> analysis_request
