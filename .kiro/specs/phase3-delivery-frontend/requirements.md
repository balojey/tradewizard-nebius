# Requirements Document

## Introduction

Phase 3 of the TradeWizard V2 platform migration covers the delivery layer and frontend integration. This phase connects the backend analysis pipeline (built in Phases 1-2) to end users through real-time WebSocket delivery, email/push notifications, and a complete Next.js frontend that replaces the existing Supabase-based auth and data layer with Cognito + API Gateway. It also includes subscription management via Stripe and a full analysis results viewer.

## Glossary

- **WebSocket_Handler**: Lambda function that manages WebSocket connect/disconnect lifecycle events, storing and removing connection IDs in DynamoDB
- **Delivery_Lambda**: Lambda function triggered by SNS that pushes analysis results to connected WebSocket clients
- **Email_Delivery_Lambda**: Lambda function triggered by SNS that sends analysis notification emails via SES templates
- **Push_Delivery_Lambda**: Lambda function triggered by SNS that sends mobile push notifications via Amazon SNS Mobile Push
- **Webhook_Delivery**: EventBridge rule that delivers analysis results to user-configured webhook URLs via HTTP target
- **Notification_Preferences_API**: REST API endpoints for reading and updating per-user notification channel settings
- **Subscription_API**: REST API endpoints for managing Stripe subscriptions, plan changes, and credit purchases
- **Results_API**: REST API endpoints for fetching historical analysis results for a user
- **Auth_Module**: Frontend module that integrates Amazon Cognito with Magic Link custom auth flow, replacing Supabase auth
- **Analysis_Request_Modal**: Frontend modal component for requesting one-time or recurring analysis on a market
- **WebSocket_Client**: Frontend service that maintains a persistent WebSocket connection for real-time analysis delivery
- **Results_Viewer**: Frontend page and components for browsing and viewing historical analysis results
- **Subscription_Page**: Frontend page for managing subscription plans, credit balance, and billing via Stripe
- **Notification_Settings_UI**: Frontend component for configuring notification channel preferences and quiet hours
- **Credit_Display**: Frontend component showing current credit balance in the header and account area
- **Connections_Table**: DynamoDB table storing active WebSocket connection IDs keyed by connectionId with a userId GSI
- **Analysis_Complete_Topic**: SNS topic that fans out analysis completion events to delivery Lambdas

## Requirements

### Requirement 1: WebSocket Connection Management

**User Story:** As a user, I want to receive analysis results in real-time without refreshing the page, so that I get immediate feedback when my requested analysis completes.

#### Acceptance Criteria

1. WHEN a client establishes a WebSocket connection, THE WebSocket_Handler SHALL extract the user identity from the connection request and store the connectionId with the associated userId in the Connections_Table
2. WHEN a client disconnects from the WebSocket, THE WebSocket_Handler SHALL remove the connectionId entry from the Connections_Table
3. THE WebSocket_Handler SHALL set a TTL of 24 hours on each connection entry to automatically clean up stale connections
4. IF the WebSocket connection request lacks valid authentication, THEN THE WebSocket_Handler SHALL reject the connection with a 401 status
5. WHEN a user has multiple active connections (multiple tabs or devices), THE WebSocket_Handler SHALL store each connectionId independently and deliver to all active connections

### Requirement 2: Real-Time Analysis Delivery

**User Story:** As a user, I want to receive my analysis results pushed to my browser as soon as they are ready, so that I do not have to poll or refresh to see new results.

#### Acceptance Criteria

1. WHEN the Analysis_Complete_Topic receives a completion event, THE Delivery_Lambda SHALL query the Connections_Table for all connectionIds associated with the target userId
2. WHEN active connections exist for the target user, THE Delivery_Lambda SHALL post the analysis result payload to each connectionId via the API Gateway Management API
3. IF posting to a connectionId returns a 410 Gone status, THEN THE Delivery_Lambda SHALL delete that stale connectionId from the Connections_Table
4. THE Delivery_Lambda SHALL include the analysisId, marketId, recommendation, consensusProbability, and confidence in the WebSocket message payload
5. WHEN no active connections exist for the target user, THE Delivery_Lambda SHALL skip WebSocket delivery without raising an error

### Requirement 3: Email Notification Delivery

**User Story:** As a user, I want to receive email notifications when my analysis results are ready, so that I can review them even when I am not actively using the application.

#### Acceptance Criteria

1. WHEN the Analysis_Complete_Topic receives a completion event and the user has email notifications enabled, THE Email_Delivery_Lambda SHALL send a templated email via SES to the user's registered email address
2. THE Email_Delivery_Lambda SHALL use pre-defined SES templates that include the market question, recommendation, consensus probability, and a link to view the full result
3. IF the user has quiet hours configured and the current time falls within quiet hours, THEN THE Email_Delivery_Lambda SHALL skip the email delivery and record the skipped attempt in the analysis_deliveries table with delivery_channel 'email' and a skipped status
4. IF SES returns a delivery failure, THEN THE Email_Delivery_Lambda SHALL log the failure and record the delivery attempt with a failed status in the analysis_deliveries table
5. WHEN the user has email notifications disabled in notification_preferences, THE Email_Delivery_Lambda SHALL skip email delivery for that user

### Requirement 4: Push Notification Delivery

**User Story:** As a user on a Starter plan or above, I want to receive push notifications on my mobile device when my analysis results are ready, so that I am alerted even when not using the web application.

#### Acceptance Criteria

1. WHEN the Analysis_Complete_Topic receives a completion event and the user has push notifications enabled, THE Push_Delivery_Lambda SHALL publish a push notification via Amazon SNS Mobile Push to the user's registered device endpoints
2. THE Push_Delivery_Lambda SHALL include the market question, recommendation, and a deep link to the analysis result in the push notification payload
3. IF the user has quiet hours configured and the current time falls within quiet hours, THEN THE Push_Delivery_Lambda SHALL skip the push delivery
4. WHEN the user has push notifications disabled in notification_preferences or is on the free plan, THE Push_Delivery_Lambda SHALL skip push delivery for that user

### Requirement 5: Webhook Delivery

**User Story:** As a Pro or Elite user, I want analysis results delivered to my configured webhook URL, so that I can integrate TradeWizard intelligence into my own trading systems.

#### Acceptance Criteria

1. WHEN the Analysis_Complete_Topic receives a completion event and the user has webhook delivery enabled, THE Webhook_Delivery SHALL send the full analysis result payload as a POST request to the user's configured webhook_url via Amazon EventBridge HTTP target
2. THE Webhook_Delivery SHALL include the full analysis result payload (same as the S3 payload) in the POST body with a Content-Type of application/json
3. IF the webhook delivery fails (non-2xx response), THEN THE Webhook_Delivery SHALL retry up to 3 times with exponential backoff and record the failure in analysis_deliveries
4. WHEN the user has webhook delivery disabled in notification_preferences or is on a plan below Pro, THE Webhook_Delivery SHALL skip webhook delivery for that user

### Requirement 6: Notification Preferences Management

**User Story:** As a user, I want to configure which notification channels I receive alerts on and set quiet hours, so that I control how and when I am notified.

#### Acceptance Criteria

1. WHEN a user requests their notification preferences via GET /user/notifications, THE Notification_Preferences_API SHALL return the current channel settings (in_app, email, push, webhook), quiet hours, and minimum probability shift threshold
2. WHEN a user updates their notification preferences via PUT /user/notifications, THE Notification_Preferences_API SHALL persist the updated settings to the notification_preferences table
3. THE Notification_Preferences_API SHALL validate that webhook_url is a valid HTTPS URL when channel_webhook is enabled
4. THE Notification_Preferences_API SHALL enforce plan-based channel restrictions: free plan allows only in_app, starter allows in_app, email, and push, pro and elite allow all channels
5. IF a user attempts to enable a channel not permitted by their plan, THEN THE Notification_Preferences_API SHALL return a 403 error with a message indicating the required plan upgrade

### Requirement 7: Subscription and Billing Management

**User Story:** As a user, I want to manage my subscription plan, purchase additional credits, and view my billing history, so that I can control my spending and access level.

#### Acceptance Criteria

1. WHEN a user requests their subscription details via GET /subscriptions, THE Subscription_API SHALL return the current plan, status, credits remaining, credits monthly limit, and billing cycle dates
2. WHEN a user initiates a plan change via POST /subscriptions, THE Subscription_API SHALL create a Stripe Checkout session for the selected plan and return the session URL
3. WHEN Stripe sends a webhook event for subscription creation or update, THE Subscription_API SHALL update the subscriptions table with the new plan, stripe_subscription_id, and reset credits_remaining to the new plan limit
4. WHEN a user purchases a credit pack via POST /credits/purchase, THE Subscription_API SHALL create a Stripe Checkout session for the credit pack and return the session URL
5. WHEN Stripe sends a webhook event for a successful credit pack payment, THE Subscription_API SHALL add the purchased credits to credits_remaining and record a credit_transaction entry
6. WHEN a user cancels their subscription via DELETE /subscriptions/{subscriptionId}, THE Subscription_API SHALL cancel the Stripe subscription at period end and update the subscription status to cancelled
7. WHEN a billing cycle renews, THE Subscription_API SHALL reset credits_remaining to the plan's monthly limit and record a credit_transaction entry for the renewal

### Requirement 8: Analysis Results History

**User Story:** As a user, I want to browse my past analysis results and view full details of any previous analysis, so that I can track recommendations over time and review historical insights.

#### Acceptance Criteria

1. WHEN a user requests their analysis history via GET /analysis/history, THE Results_API SHALL return a paginated list of analysis deliveries for that user, ordered by delivered_at descending
2. THE Results_API SHALL include for each result: analysisId, marketId, market question, recommendation, consensusProbability, confidence, executedAt, and whether it was a cached delivery
3. WHEN a user requests a specific analysis via GET /analysis/{analysisId}, THE Results_API SHALL fetch the full result payload from S3 using the result_payload_s3_key and return the complete analysis detail
4. THE Results_API SHALL only return results that belong to the requesting user, verified by matching user_id in analysis_deliveries
5. IF the requested analysisId does not exist or does not belong to the user, THEN THE Results_API SHALL return a 404 error

### Requirement 9: Frontend Authentication with Cognito

**User Story:** As a user, I want to sign in using a Magic Link sent to my email, so that I can access the platform without remembering a password.

#### Acceptance Criteria

1. WHEN a user enters their email and submits the login form, THE Auth_Module SHALL initiate the Cognito custom auth flow by calling InitiateAuth with the CUSTOM_AUTH challenge
2. WHEN Cognito responds with a custom challenge (Magic Link sent), THE Auth_Module SHALL display a message instructing the user to check their email
3. WHEN the user clicks the Magic Link, THE Auth_Module SHALL complete the authentication by responding to the Cognito challenge and store the resulting JWT tokens (id, access, refresh) in secure storage
4. THE Auth_Module SHALL attach the JWT access token as a Bearer token in the Authorization header for all API Gateway requests
5. WHEN the access token expires, THE Auth_Module SHALL use the refresh token to obtain new tokens without requiring the user to re-authenticate
6. WHEN the refresh token is invalid or expired, THE Auth_Module SHALL redirect the user to the login page

### Requirement 10: Analysis Request UI

**User Story:** As a user, I want to request an AI analysis for any market I am viewing, choosing between a one-time or recurring analysis with interval selection, so that I can get intelligent trading recommendations.

#### Acceptance Criteria

1. WHEN a user clicks the "Get Analysis" button on a market page, THE Analysis_Request_Modal SHALL open displaying the market name, current credit balance, and request type options (one-time or recurring)
2. WHEN the user selects recurring analysis, THE Analysis_Request_Modal SHALL display interval options filtered by the user's plan (free: none, starter: 1 day, pro/elite: 1h, 4h, 12h, 1d)
3. WHEN the user confirms the analysis request, THE Analysis_Request_Modal SHALL call POST /v2/analysis with the marketId, requestType, and intervalSeconds, then display a confirmation with the estimated delivery time
4. IF the API returns a 402 (insufficient credits), THEN THE Analysis_Request_Modal SHALL display a message prompting the user to purchase more credits or upgrade their plan
5. WHEN the API returns a 200 with cached: true, THE Analysis_Request_Modal SHALL immediately navigate the user to the analysis result detail view
6. WHEN the API returns a 202 (queued or pending), THE Analysis_Request_Modal SHALL close and display a toast notification indicating the analysis is in progress

### Requirement 11: Real-Time WebSocket Client

**User Story:** As a user, I want the application to maintain a live connection to the server so that analysis results appear automatically without any action from me.

#### Acceptance Criteria

1. WHEN the user is authenticated, THE WebSocket_Client SHALL establish a WebSocket connection to the API Gateway WebSocket endpoint with the user's JWT token
2. WHEN the WebSocket connection drops unexpectedly, THE WebSocket_Client SHALL attempt reconnection with exponential backoff (1s, 2s, 4s, 8s, max 30s)
3. WHEN a message is received on the WebSocket, THE WebSocket_Client SHALL parse the payload and update the TanStack Query cache to reflect the new analysis result
4. WHEN the user logs out, THE WebSocket_Client SHALL close the WebSocket connection cleanly
5. WHILE the WebSocket connection is active, THE WebSocket_Client SHALL send a ping every 5 minutes to keep the connection alive

### Requirement 12: Analysis Results Viewer

**User Story:** As a user, I want to browse my analysis history and view the full detail of any past analysis, so that I can review recommendations, agent signals, and reasoning.

#### Acceptance Criteria

1. WHEN the user navigates to the history page, THE Results_Viewer SHALL fetch and display a paginated list of past analyses with market name, recommendation, probability, confidence, and date
2. WHEN the user clicks on an analysis in the list, THE Results_Viewer SHALL fetch the full result from GET /analysis/{analysisId} and display the complete detail including agent signals, thesis, cross-examination results, and position sizing guidance
3. WHEN new results arrive via WebSocket while the history page is open, THE Results_Viewer SHALL prepend the new result to the list without requiring a page refresh
4. THE Results_Viewer SHALL support infinite scroll pagination, loading additional results as the user scrolls down
5. THE Results_Viewer SHALL display a visual indicator distinguishing cached deliveries from fresh analyses

### Requirement 13: Subscription Management UI

**User Story:** As a user, I want to view my current plan, upgrade or downgrade, purchase credit packs, and see my billing history, so that I can manage my account spending.

#### Acceptance Criteria

1. WHEN the user navigates to the subscription page, THE Subscription_Page SHALL display the current plan name, credits remaining, credits monthly limit, and billing cycle end date
2. THE Subscription_Page SHALL display all available plans (Free, Starter, Pro, Elite) with pricing, credit limits, and allowed intervals, highlighting the current plan
3. WHEN the user selects a different plan and confirms, THE Subscription_Page SHALL redirect to the Stripe Checkout session URL returned by POST /subscriptions
4. THE Subscription_Page SHALL display credit pack purchase options (20 credits for $9, 50 credits for $19) and redirect to Stripe Checkout on selection
5. WHEN the user returns from Stripe Checkout with a success status, THE Subscription_Page SHALL refresh the subscription data and display a success confirmation
6. WHEN the user clicks cancel subscription, THE Subscription_Page SHALL confirm the action and call DELETE /subscriptions/{subscriptionId}, then display the updated status showing cancellation at period end

### Requirement 14: Credit Balance Display

**User Story:** As a user, I want to see my current credit balance at all times, so that I know how many analyses I can request before needing to purchase more.

#### Acceptance Criteria

1. THE Credit_Display SHALL show the current credits remaining in the application header, visible on all pages
2. WHEN an analysis request is submitted successfully, THE Credit_Display SHALL decrement the displayed balance by one immediately (optimistic update)
3. WHEN the subscription data is refreshed (after purchase, plan change, or billing cycle reset), THE Credit_Display SHALL update to reflect the new balance
4. WHEN credits remaining reaches zero, THE Credit_Display SHALL show a visual warning indicator prompting the user to purchase more credits or upgrade

### Requirement 15: Notification Settings UI

**User Story:** As a user, I want to configure my notification preferences from the account settings, so that I receive alerts only through channels I choose and at times I prefer.

#### Acceptance Criteria

1. WHEN the user navigates to notification settings, THE Notification_Settings_UI SHALL fetch and display the current preferences from GET /user/notifications
2. THE Notification_Settings_UI SHALL display toggle switches for each notification channel (in-app, email, push, webhook) with disabled channels grayed out based on the user's plan
3. WHEN the user modifies a setting and saves, THE Notification_Settings_UI SHALL call PUT /user/notifications and display a success confirmation
4. THE Notification_Settings_UI SHALL provide time pickers for quiet hours start and end times
5. THE Notification_Settings_UI SHALL provide a numeric input for minimum probability shift threshold (0.01 to 1.00)
6. IF the save request returns a 403 (plan restriction), THEN THE Notification_Settings_UI SHALL display a message indicating which plan is required to enable the selected channel
