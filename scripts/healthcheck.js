// One-shot liveness check; it does not create a continuous monitor.
const target=process.argv[2];
if(!target){console.error('Usage: npm run healthcheck -- https://your-atlas-host');process.exit(1);}
(async()=>{
 const url=new URL('/api/health',target);
 if(!['http:','https:'].includes(url.protocol))throw Error('HTTP(S) URL required');
 const response=await fetch(url,{signal:AbortSignal.timeout(10000),redirect:'error'});
 const body=await response.json();
 if(!response.ok||body.ok!==true||body.broker!==false||body.guard?.send_order!==false)throw Error('Health contract failed');
 const expected='atlas-'+require('../package.json').version;
 if(body.version!==expected)throw Error(`Version mismatch: expected ${expected}, received ${body.version}`);
 console.log(JSON.stringify({status:'API ONLINE',version:body.version,security_verified:body.security_verified===true,live_market_data:body.live_market_data===true,checked_at:new Date().toISOString()}));
})().catch(e=>{console.error(e.message);process.exitCode=1;});
