#!/usr/bin/env node

const express = require('express');
const cors = require('cors');
const path = require('node:path');
const ROOT = path.join(__dirname, '..');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const ENV = process.env.NODE_ENV || 'development';

// Middleware
app.use(cors());
app.use(express.json());

app.get('/api/health', require('./health'));
app.all('/api/control', require('./control'));
app.all('/api/memory', require('./memory'));

// Signal app endpoints
app.post('/api/signals/analyze', (req, res) => {
  const { candles, symbol } = req.body || {};
  
  if (typeof symbol !== 'string' || !symbol.trim() || symbol.length > 40 || !Array.isArray(candles) || candles.length < 2 || candles.length > 10000 || candles.some(c => !c || !['open','high','low','close'].every(k => Number.isFinite(c[k]) && c[k] > 0) || c.high < Math.max(c.open,c.close) || c.low > Math.min(c.open,c.close))) {
    return res.status(400).json({ error: 'Invalid candles data' });
  }
  
  // Market structure analysis
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);
  const closes = candles.map(c => c.close);
  
  const currentHigh = Math.max(...highs);
  const currentLow = Math.min(...lows);
  const recentHigh = Math.max(...highs.slice(-20));
  const recentLow = Math.min(...lows.slice(-20));
  
  res.json({
    symbol,
    marketStructure: {
      breakoutHigh: recentHigh,
      breakoutLow: recentLow,
      resistance: currentHigh,
      support: currentLow,
      trend: closes[closes.length - 1] > closes[closes.length - 2] ? 'up' : closes[closes.length - 1] < closes[closes.length - 2] ? 'down' : 'neutral'
    },
    candlePatterns: identifyCandlePatterns(candles),
    quality: 'unverified_input',
    data_source: 'user_supplied_unverified',
    send_order: false
  });
});

app.post('/api/signals/entry', (req, res) => {
  const { riskPercent, accountSize, entryPrice, stopLoss, takeProfit } = req.body || {};
  const values = [riskPercent, accountSize, entryPrice, stopLoss, takeProfit];
  const long = stopLoss < entryPrice && takeProfit > entryPrice;
  const short = stopLoss > entryPrice && takeProfit < entryPrice;
  const riskAmount = (riskPercent / 100) * accountSize;
  const ratio = Math.abs(takeProfit - entryPrice) / Math.abs(entryPrice - stopLoss);
  if (!values.every(v => Number.isFinite(v) && v > 0) || riskPercent > 100 || (!long && !short) || !Number.isFinite(riskAmount) || !Number.isFinite(ratio)) {
    return res.status(400).json({error: 'Provide positive finite inputs, risk up to 100%, and stop and target on opposite sides of entry'});
  }
  res.json({entry: entryPrice, stopLoss, takeProfit, riskAmount, riskReward: ratio.toFixed(2), status: 'calculated', send_order: false});
});

// Serve static files
app.use(express.static(path.join(ROOT, 'public')));
app.use('/js', express.static(path.join(ROOT, 'js')));
app.use('/plugins', express.static(path.join(ROOT, 'plugins')));

// Explicit allowlist: never serve repository source or credentials.
for (const file of ['index.html','control.html','security.html','manifest.json','icon.svg','sw.js','control-contract.json']) {
  app.get('/' + file, (req,res) => res.sendFile(path.join(ROOT,file)));
}

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
  res.status(err.type === 'entity.parse.failed' ? 400 : err.type === 'entity.too.large' ? 413 : 500).json({
    error: 'Internal server error',
    message: ENV === 'development' ? err.message : 'An error occurred'
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Start server
if (require.main === module) app.listen(PORT, () => {
  console.log(`Atlas Desk running on http://localhost:${PORT} (${ENV})`);
});

function identifyCandlePatterns(candles) {
  const patterns = [];
  
  if (candles.length < 2) return patterns;
  
  // Hammer pattern
  candles.forEach((candle, i) => {
    const body = Math.abs(candle.close - candle.open);
    const lowerWick = Math.min(candle.open, candle.close) - candle.low;
    const upperWick = candle.high - Math.max(candle.open, candle.close);
    
    if (body > 0 && lowerWick > body * 2 && upperWick < body * 0.5) {
      patterns.push({ type: 'hammer', index: i, strength: 'medium' });
    }
    
    // Engulfing pattern
    if (i > 0) {
      const prev = candles[i - 1];
      if (prev.close < prev.open && candle.close > candle.open && candle.open <= prev.close && candle.close >= prev.open) {
        patterns.push({ type: 'bullish_engulfing', index: i, strength: 'context_required' });
      } else if (prev.close > prev.open && candle.close < candle.open && candle.open >= prev.close && candle.close <= prev.open) {
        patterns.push({ type: 'bearish_engulfing', index: i, strength: 'context_required' });
      }
    }
  });
  
  return patterns;
}

module.exports = app;
