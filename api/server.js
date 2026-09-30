#!/usr/bin/env node

const express = require('express');
const cors = require('cors');
require('dotenv').config();
const AtlasSignal = require('../js/signal-engine.js');

const MAX_CANDLES = 50000;
const MAX_MTF_BARS = 120000;
const extent = (arr) => AtlasSignal.extent(arr, 'close', 0);
function validCandle(c) {
  if (!c || typeof c !== 'object') return false;
  const v = [c.open, c.high, c.low, c.close].map(Number);
  if (!v.every(Number.isFinite)) return false;
  [c.open, c.high, c.low, c.close] = v; // coerce numeric strings once
  return c.high >= c.low;
}

const app = express();
const PORT = process.env.PORT || 3000;
const ENV = process.env.NODE_ENV || 'development';

// Middleware
app.use(cors());
app.use(express.json({ limit: '12mb' }));

// Health check endpoint (required by contract)
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    version: 'atlas-3.1.0',
    watch: '24/7',
    broker: false,
    environment: ENV,
    timestamp: new Date().toISOString()
  });
});

// Signal app endpoints (analysis only - this server is not a broker and never places orders)
app.post('/api/signals/analyze', (req, res) => {
  const { candles, symbol } = req.body || {};

  if (!Array.isArray(candles) || candles.length === 0 || candles.length > MAX_CANDLES || !candles.every(validCandle)) {
    return res.status(400).json({ error: 'Invalid candles data' });
  }

  // Market structure analysis (single-array scans: Math.max(...arr) throws RangeError on large inputs)
  const all = extent(candles);
  const recent = extent(candles.slice(-20));
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];

  res.json({
    symbol,
    marketStructure: {
      breakoutHigh: recent.hi,
      breakoutLow: recent.lo,
      resistance: all.hi,
      support: all.lo,
      // needs two candles; a single candle has no direction
      trend: prev ? (last.close > prev.close ? 'up' : last.close < prev.close ? 'down' : 'flat') : 'unknown'
    },
    candlePatterns: identifyCandlePatterns(candles),
    quality: 'ready_for_review',
    broker: false
  });
});

// Top-down multi-timeframe signals from a 5m history: Daily/4H bias -> 1H setup -> 15m/5m trigger.
// Body: { symbol, candles5m: [{t|time, o|open, h|high, l|low, c|close}, ...] } oldest first, CLOSED bars only.
app.post('/api/signals/mtf', (req, res) => {
  const { symbol, candles5m } = req.body || {};
  if (!Array.isArray(candles5m) || candles5m.length < 2000 || candles5m.length > MAX_MTF_BARS) {
    return res.status(400).json({ error: 'candles5m must hold 2000..' + MAX_MTF_BARS + ' closed 5m bars' });
  }
  const out = AtlasSignal.analyze(symbol, candles5m, {});
  res.json({ ...out, broker: false, sendOrder: 'DENIED', note: 'Structure signals for review. Not a broker, never places trades.' });
});

app.post('/api/signals/entry', (req, res) => {
  const { riskPercent, accountSize } = req.body || {};
  const num = (v) => (v === undefined || v === null || v === '' ? NaN : Number(v));
  const entryPrice = num(req.body && req.body.entryPrice);
  const stopLoss = num(req.body && req.body.stopLoss);
  const takeProfit = num(req.body && req.body.takeProfit);
  const risk = num(riskPercent);
  const account = num(accountSize);

  const riskAmount = Number.isFinite(risk) && Number.isFinite(account) && risk >= 0 && account >= 0 ? (risk / 100) * account : null;
  // long or short: sign of (entry - stop) decides the side; a target on the wrong side is rejected, not shown as a negative R:R
  const rr = AtlasSignal.riskReward(entryPrice, stopLoss, takeProfit, 0);

  res.json({
    entry: Number.isFinite(entryPrice) ? entryPrice : 0,
    stopLoss: Number.isFinite(stopLoss) ? stopLoss : 0,
    takeProfit: Number.isFinite(takeProfit) ? takeProfit : 0,
    riskAmount,
    side: rr ? rr.side : null,
    riskReward: rr ? rr.rr.toFixed(2) : 'pending',
    status: 'calculated',
    broker: false
  });
});

// Serve static files
app.use(express.static('public'));
app.use('/js', express.static('js'));
app.use('/plugins', express.static('plugins'));

// Fallback to index.html for SPA
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/../index.html');
});

app.get('/control', (req, res) => {
  res.sendFile(__dirname + '/../control.html');
});

app.get('/security', (req, res) => {
  res.sendFile(__dirname + '/../security.html');
});

// Error handling
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: ENV === 'development' ? err.message : 'An error occurred'
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Start server
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Atlas Desk running on http://localhost:${PORT} (${ENV})`);
  });
}

function identifyCandlePatterns(candles) {
  const patterns = [];
  if (candles.length < 2) return patterns;

  candles.forEach((candle, i) => {
    const body = Math.abs(candle.close - candle.open);
    const range = candle.high - candle.low;
    if (!(range > 0)) return;
    const lowerWick = Math.min(candle.open, candle.close) - candle.low;
    const upperWick = candle.high - Math.max(candle.open, candle.close);

    // Hammer / pin bar: long lower wick, small body near the top, tiny upper wick
    if (lowerWick >= body * 2 && lowerWick >= 0.5 * range && upperWick <= Math.max(body * 0.5, 0.1 * range)) {
      patterns.push({ type: 'hammer', direction: 'bullish', index: i, strength: 'medium' });
    }
    // Shooting star / bearish pin: mirror image
    if (upperWick >= body * 2 && upperWick >= 0.5 * range && lowerWick <= Math.max(body * 0.5, 0.1 * range)) {
      patterns.push({ type: 'shooting-star', direction: 'bearish', index: i, strength: 'medium' });
    }

    // Engulfing: opposite colours and the body fully covers the previous body (size alone is not engulfing)
    if (i > 0) {
      const prev = candles[i - 1];
      const prevBody = Math.abs(prev.close - prev.open);
      if (body > prevBody && prevBody > 0) {
        if (prev.close < prev.open && candle.close > candle.open && candle.open <= prev.close && candle.close >= prev.open) {
          patterns.push({ type: 'engulfing', direction: 'bullish', index: i, strength: 'high' });
        } else if (prev.close > prev.open && candle.close < candle.open && candle.open >= prev.close && candle.close <= prev.open) {
          patterns.push({ type: 'engulfing', direction: 'bearish', index: i, strength: 'high' });
        }
      }
    }
  });

  return patterns;
}

module.exports = app;
