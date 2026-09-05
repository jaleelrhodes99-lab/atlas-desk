# Atlas Desk Deployment Guide

## Overview

Atlas Desk deploys to **Vercel** across three environments:
- **Development** (from `develop` branch)
- **Staging** (from `staging` branch)
- **Production** (from `main` branch)

## Prerequisites

### Vercel Setup
1. Link your GitHub account to Vercel
2. Create three separate Vercel projects:
   - `atlas-desk-dev`
   - `atlas-desk-staging`
   - `atlas-desk` (production)

### GitHub Secrets
Configure these secrets in your repository settings:

```
VERCEL_TOKEN           - Personal access token from Vercel dashboard
VERCEL_ORG_ID         - Your Vercel organization ID
VERCEL_PROJECT_ID      - Production project ID
VERCEL_PROJECT_ID_STAGING  - Staging project ID
VERCEL_PROJECT_ID_DEV  - Development project ID
SLACK_WEBHOOK_URL     - (Optional) Slack notifications
```

## Environment-Specific Configuration

### Development (develop branch)
- Auto-deploys on push
- URL: `https://atlas-desk-dev.vercel.app`
- Health check: Not required

### Staging (staging branch)
- Auto-deploys on push
- URL: `https://atlas-desk-staging.vercel.app`
- Health check: Required before production
- Smoke tests: Run automatically

### Production (main branch)
- Auto-deploys on push
- URL: `https://atlas-desk-gamma.vercel.app`
- **AEGIS guardrails enforced**
- Health check: `GET /api/health` returns `ok: true`
- Kill switch active

## Required Environment Variables

### All Environments
```env
NODE_ENV=production|staging|development
PORT=3000
AEGIS_ENABLED=true
AUDIT_LOG=true
KILL_SWITCH=true
ENABLE_LIVE_TRADING=false
ENABLE_PAPER_TRADING=true
MAX_DAILY_LOSS_PERCENT=2
```

### Production Only
```env
BROKER_HEARTBEAT=required
MARKET_DATA_FRESH=required
```

## Deployment Flow

### Automatic Deployment
1. Push to `develop`, `staging`, or `main`
2. GitHub Actions runs tests
3. Build succeeds → Deploy to Vercel
4. Health check passes → Live

### Manual Rollback
```bash
# Via Vercel CLI
vercel rollback atlas-desk --to <deployment-id>

# Via GitHub Actions (Re-run workflow with previous commit)
```

## Health Check Contract

**Endpoint:** `GET /api/health`

**Required Response:**
```json
{
  "ok": true,
  "version": "atlas-3.1.0",
  "watch": "24/7",
  "broker": false,
  "environment": "production",
  "timestamp": "2026-09-05T10:30:00Z"
}
```

**Failure Action:** Automatic rollback to previous deployment

## Signal App Features (Dev → Staging → Prod)

### Market Structure Analysis
- Identify highs/lows across timeframes
- Support/resistance calculation
- Trend confirmation

### Candlestick Patterns
- Hammer detection
- Engulfing patterns
- Pin bars
- Morning/evening stars

### Entry/TP/SL Calculation
- Risk/reward ratio
- Position sizing
- Daily loss limits enforcement
- Account risk per trade

### Paper Trading
- Full signal flow simulation
- No live orders (SEND DENIED)
- Backtest comparison

## Monitoring

### Vercel Analytics
- Deployment duration
- Function cold starts
- Response times
- Error rates

### Health Checks (Production)
- Every 5 minutes
- Slack notifications on failure
- Automatic rollback on 2+ consecutive failures

## Troubleshooting

### Deployment Fails
1. Check GitHub Actions logs
2. Verify all secrets are configured
3. Ensure `npm run build` passes locally

### Health Check Fails
1. Check `/api/health` endpoint manually
2. Verify environment variables in Vercel dashboard
3. Review recent code changes

### Performance Issues
- Check Vercel analytics
- Monitor function execution time
- Scale compute resources if needed

## Rollback Procedure

**Automatic (on health check failure):**
- Vercel redeploys previous successful deployment
- Slack notification sent

**Manual:**
```bash
vercel rollback atlas-desk
```

## Next Steps

1. **Set Vercel secrets** in GitHub repo settings
2. **Create GitHub Action workflow** (copy `.github/workflows/deploy.yml` template)
3. **Configure Vercel projects** with proper environment variables
4. **Test deployment** by pushing to develop branch
5. **Monitor** first production deployment
