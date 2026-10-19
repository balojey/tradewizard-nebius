# Serper API Setup Guide

This guide explains how to set up and configure the Serper API for the Web Research Agent in TradeWizard.

## What is Serper?

Serper is a web search and scraping API that provides:
- Google search results programmatically
- Full webpage content extraction
- Fast response times and reliable service
- Simple REST API interface

The Web Research Agent uses Serper to gather real-world context about prediction markets by searching the web and extracting content from relevant sources.

## Getting Your API Key

1. Visit [https://serper.dev](https://serper.dev)
2. Sign up for an account
3. Navigate to your dashboard
4. Copy your API key from the API Keys section

## Pricing Tiers

Serper offers several pricing tiers:

- **Free Tier**: 100 searches/month (good for testing)
- **Starter**: $50/month for 5,000 searches
- **Pro**: $200/month for 25,000 searches
- **Enterprise**: Custom pricing for higher volumes

Rate limits vary by tier and are typically enforced per minute or per hour.

## Configuration

### Single API Key

For basic usage, add your API key to the `.env` file:

```bash
# tradewizard-agents/.env or doa/.env
SERPER_API_KEY=your_api_key_here
```

### Multiple API Keys (Recommended)

For production use with automatic failover, configure multiple API keys separated by commas:

```bash
SERPER_API_KEY=key1_here,key2_here,key3_here
```

The system will automatically:
- Rotate to the next key when rate limits are hit
- Track usage per key
- Auto-expire rate-limited keys when their limit resets
- Use LRU (Least Recently Used) strategy for key selection

### Optional Configuration

You can customize the Serper endpoints and timeouts:

```bash
# API endpoints (optional - defaults shown)
SERPER_SEARCH_URL=https://google.serper.dev/search
SERPER_SCRAPE_URL=https://scrape.serper.dev

# Request timeout in seconds (optional - default: 30)
SERPER_TIMEOUT=30

# Web Research Agent settings
WEB_RESEARCH_ENABLED=true
WEB_RESEARCH_MAX_TOOL_CALLS=8
WEB_RESEARCH_TIMEOUT=60
```

## Testing Your Setup

### TypeScript (tradewizard-agents)

```bash
# Test the Serper client
npm test -- serper-client.test.ts

# Test the Web Research Agent
npm test -- web-research-agent.test.ts
```

### Python (doa)

```bash
# Test the Serper client
pytest doa/tools/test_serper_client.py

# Test the Web Research Agent
pytest doa/nodes/test_web_research_agent.py
```

## Rate Limit Handling

The system automatically handles rate limits:

1. **Detection**: HTTP 429 responses trigger key rotation
2. **Rotation**: System switches to next available key
3. **Expiry**: Rate-limited keys become available again after the limit resets
4. **Logging**: All rotation events are logged for monitoring

### Rate Limit Headers

Serper returns these headers with rate limit information:

- `Retry-After`: Seconds until rate limit resets
- `X-RateLimit-Reset`: Timestamp when limit resets

The system parses these headers and automatically manages key availability.

## Troubleshooting

### "All API keys exhausted"

**Cause**: All configured keys have hit their rate limits.

**Solutions**:
- Wait for rate limits to reset (typically 15 minutes)
- Add more API keys to your configuration
- Upgrade to a higher pricing tier
- Reduce `WEB_RESEARCH_MAX_TOOL_CALLS` to use fewer API calls per analysis

### "Serper API key not configured"

**Cause**: No API key found in environment variables.

**Solutions**:
- Add `SERPER_API_KEY` to your `.env` file
- Verify the `.env` file is in the correct directory
- Restart your application after adding the key

### "HTTP 401 Unauthorized"

**Cause**: Invalid API key.

**Solutions**:
- Verify your API key is correct
- Check for extra spaces or newlines in the key
- Generate a new API key from the Serper dashboard

### "HTTP 402 Payment Required"

**Cause**: Account quota exhausted.

**Solutions**:
- Upgrade your Serper plan
- Wait for your monthly quota to reset
- Add additional API keys from different accounts

## Best Practices

1. **Use Multiple Keys**: Configure 2-3 API keys for automatic failover
2. **Monitor Usage**: Check key rotation stats in logs
3. **Set Appropriate Limits**: Adjust `WEB_RESEARCH_MAX_TOOL_CALLS` based on your needs
4. **Cache Results**: The system automatically caches results within a session
5. **Test Thoroughly**: Run integration tests before deploying to production

## Security

- **Never commit API keys**: Keep them in `.env` files (gitignored)
- **Use environment variables**: Load keys from secure environment
- **Rotate keys regularly**: Generate new keys periodically
- **Monitor for abuse**: Check usage patterns in Serper dashboard

## Support

- **Serper Documentation**: [https://serper.dev/docs](https://serper.dev/docs)
- **Serper Support**: support@serper.dev
- **TradeWizard Issues**: File an issue in the repository

## Example Usage

The Web Research Agent automatically uses Serper when analyzing markets:

```bash
# TypeScript
npm run cli -- analyze <condition-id>

# Python
python main.py analyze <condition-id>
```

The agent will:
1. Formulate search queries based on the market question
2. Search the web using Serper
3. Scrape relevant URLs for detailed content
4. Synthesize information into a research document
5. Return the document as part of the agent signal

No manual intervention required - the system handles all API interactions automatically.
