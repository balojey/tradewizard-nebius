# Bugfix Requirements Document

## Introduction

This document addresses three critical bugs in the TradeWizard system that impact API integration, agent selection, and LLM resilience:

1. **NewsData API Free Tier Parameter Issues**: The NewsData client passes unsupported parameters (`size` and `timeframe`) that cause API failures for free tier users
2. **Polling Agent Not Used in Analysis**: The polling intelligence agent is incorrectly excluded from most market analyses despite being valuable for all market types
3. **LLM Rate Limit Causes Premature Termination**: Rate limit errors terminate the workflow instead of rotating to alternative LLM models

These bugs reduce system reliability, limit analytical coverage, and create poor user experience for free tier users.

## Bug Analysis

### Current Behavior (Defect)

#### Bug 1: NewsData API Free Tier Parameters

1.1 WHEN the NewsData client makes API requests with free tier credentials THEN the system passes `size` and `timeframe` parameters that are not supported by the free tier plan

1.2 WHEN the NewsData API receives unsupported parameters from free tier accounts THEN the system receives API errors and fails to retrieve news data

#### Bug 2: Polling Agent Selection

1.3 WHEN dynamic agent selection runs for non-election market types THEN the system excludes the polling intelligence agent from analysis

1.4 WHEN market analysis proceeds without the polling agent THEN the system produces incomplete analysis missing polling-based insights

#### Bug 3: LLM Rate Limit Handling

1.5 WHEN an LLM provider returns a rate limit error during workflow execution THEN the system terminates the entire analysis workflow prematurely

1.6 WHEN the workflow terminates due to rate limits THEN the system fails to produce any recommendation despite having alternative LLM models available

### Expected Behavior (Correct)

#### Bug 1: NewsData API Free Tier Parameters

2.1 WHEN the NewsData client makes API requests with free tier credentials THEN the system SHALL exclude the `size` and `timeframe` parameters from the request

2.2 WHEN the NewsData API receives properly formatted free tier requests THEN the system SHALL successfully retrieve news data (10 articles per credit)

#### Bug 2: Polling Agent Selection

2.3 WHEN dynamic agent selection runs for any market type THEN the system SHALL include the polling intelligence agent in the selected agent set

2.4 WHEN market analysis proceeds with the polling agent THEN the system SHALL produce comprehensive analysis including polling-based insights

#### Bug 3: LLM Rate Limit Handling

2.5 WHEN an LLM provider returns a rate limit error during workflow execution THEN the system SHALL automatically rotate to the next available LLM model from the configured model list

2.6 WHEN LLM model rotation occurs THEN the system SHALL continue the analysis workflow without termination and produce a complete recommendation

### Unchanged Behavior (Regression Prevention)

#### Bug 1: NewsData API Free Tier Parameters

3.1 WHEN the NewsData client makes API requests with paid tier credentials THEN the system SHALL CONTINUE TO pass `size` and `timeframe` parameters as configured

3.2 WHEN the NewsData API key rotation logic detects API failures THEN the system SHALL CONTINUE TO rotate to the next available API key

3.3 WHEN the NewsData client processes successful API responses THEN the system SHALL CONTINUE TO parse and return article data correctly

#### Bug 2: Polling Agent Selection

3.4 WHEN dynamic agent selection runs for any market type THEN the system SHALL CONTINUE TO select all other appropriate agents (breaking news, sentiment, risk assessment, etc.)

3.5 WHEN agents execute their analysis THEN the system SHALL CONTINUE TO produce individual agent signals with confidence scores

3.6 WHEN the consensus engine processes agent signals THEN the system SHALL CONTINUE TO calculate unified probability estimates correctly

#### Bug 3: LLM Rate Limit Handling

3.7 WHEN LLM invocations succeed without rate limits THEN the system SHALL CONTINUE TO use the primary configured LLM model

3.8 WHEN LLM responses are received successfully THEN the system SHALL CONTINUE TO parse and process agent outputs correctly

3.9 WHEN the workflow completes successfully THEN the system SHALL CONTINUE TO generate recommendations with proper structure and audit logging
