const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
let child, base;
before(async () => {
  child = spawn(process.execPath, ['-e', `const app=require('./api/server');const s=app.listen(0,'127.0.0.1',()=>console.log('TEST_PORT='+s.address().port));`], { cwd: require('node:path').join(__dirname, '..'), env: {...process.env,PORT:'0'}, stdio:['ignore','pipe','pipe'] });
  base = await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('startup timeout')),10000);child.stdout.on('data',x=>{const m=String(x).match(/TEST_PORT=(\d+)/);if(m){clearTimeout(timer);resolve('http://127.0.0.1:'+m[1]);}});child.once('exit',code=>{clearTimeout(timer);reject(Error('server exited '+code));});});
});
after(()=>child?.kill());
async function post(path,body){return fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});}
const bar={open:100,high:103,low:98,close:101};
test('health is uncached liveness, not proof of security or live prices',async()=>{const r=await fetch(base+'/api/health'),j=await r.json();assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');assert.equal(j.version,'atlas-'+require('../package.json').version);assert.equal(j.broker,false);assert.equal(j.guard.send_order,false);assert.equal(j.scope,'liveness');assert.equal(j.security_verified,false);assert.equal(j.live_market_data,false);});
test('reject empty, malformed, short and impossible candle sets',async()=>{for(const candles of [[],[bar],[null,bar],[{...bar,high:90},bar],[{...bar,close:'101'},bar]]){assert.equal((await post('/api/signals/analyze',{symbol:'EURUSD',candles})).status,400);}});
test('large same-color candle is not engulfing; flat close is neutral',async()=>{const r=await post('/api/signals/analyze',{symbol:'EURUSD',candles:[bar,{open:98,high:104,low:97,close:101}]});const j=await r.json();assert.equal(r.status,200);assert.equal(j.marketStructure.trend,'neutral');assert.deepEqual(j.candlePatterns,[]);assert.equal(j.send_order,false);assert.equal(j.data_source,'user_supplied_unverified');});
test('engulfing requires opposite bodies and complete body coverage',async()=>{const r=await post('/api/signals/analyze',{symbol:'EURUSD',candles:[{open:102,high:103,low:98,close:100},{open:99,high:104,low:98,close:103}]});assert.equal((await r.json()).candlePatterns[0].type,'bullish_engulfing');});
test('entry rejects invalid risk and stop/target geometry',async()=>{const good={riskPercent:.25,accountSize:2500,entryPrice:100,stopLoss:99,takeProfit:102};for(const change of [{stopLoss:100},{takeProfit:98},{riskPercent:-1},{accountSize:'2500'},{entryPrice:0},{riskPercent:101}])assert.equal((await post('/api/signals/entry',{...good,...change})).status,400);});
test('long and short risk calculations remain finite',async()=>{for(const prices of [{entryPrice:100,stopLoss:99,takeProfit:102},{entryPrice:100,stopLoss:101,takeProfit:98}]){const r=await post('/api/signals/entry',{...prices,riskPercent:.25,accountSize:2500});const j=await r.json();assert.equal(r.status,200);assert.equal(j.riskReward,'2.00');assert.equal(j.riskAmount,6.25);assert.equal(j.send_order,false);}});
test('mobile assets, desks and local API routes resolve',async()=>{for(const path of ['/control.html','/security.html','/manifest.json','/icon.svg','/sw.js','/control-contract.json','/api/control','/api/memory'])assert.equal((await fetch(base+path)).status,200,path);});
test('malformed JSON is a client error',async()=>{const r=await fetch(base+'/api/signals/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:'{'});assert.equal(r.status,400);});
test('memory writes and order placement remain denied',async()=>{assert.equal((await post('/api/memory',{action:'write',text:'test'})).status,401);assert.equal((await post('/api/orders',{})).status,404);});
