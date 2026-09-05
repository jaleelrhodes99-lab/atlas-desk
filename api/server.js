#!/usr/bin/env node

const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const ENV = process.env.NODE_ENV || 'development';

// Middleware
app.use(cors());
app.use(express.json());

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

// Signal app endpoints
app.post('/api/signals/analyze', (req, res) => {
  const { candles, symbol } = req.body;
  
  if (!candles || !Array.isArray(candles)) {
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
      trend: closes[closes.length - 1] > closes[closes.length - 2] ? 'up' : 'down'
    },
    candlePatterns: identifyCandlePatterns(candles),
    quality: 'ready_for_review'
  });
});

app.post('/api/signals/entry', (req, res) => {
  const { pattern, riskPercent, accountSize } = req.body;
  
  const riskAmount = (riskPercent / 100) * accountSize;
  const entryPrice = req.body.entryPrice || 0;
  const stopLoss = req.body.stopLoss || 0;
  const takeProfit = req.body.takeProfit || 0;
  
  res.json({
    entry: entryPrice,
    stopLoss,
    takeProfit,
    riskAmount,
    riskReward: takeProfit > 0 && stopLoss > 0 
      ? ((takeProfit - entryPrice) / (entryPrice - stopLoss)).toFixed(2)
      : 'pending',
    status: 'calculated'
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
app.listen(PORT, () => {
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
    
    if (lowerWick > body * 2 && upperWick < body * 0.5) {
      patterns.push({ type: 'hammer', index: i, strength: 'medium' });
    }
    
    // Engulfing pattern
    if (i > 0) {
      const prev = candles[i - 1];
      const prevBody = Math.abs(prev.close - prev.open);
      const currBody = Math.abs(candle.close - candle.open);
      
      if (currBody > prevBody * 1.5) {
        patterns.push({ type: 'engulfing', index: i, strength: 'high' });
      }
    }
  });
  
  return patterns;
}

module.exports = app;
