const {readdirSync}=require('node:fs');
const {join}=require('node:path');
const {spawnSync}=require('node:child_process');
for(const dir of ['api','api/signals','js','scripts','tests']) for(const name of readdirSync(dir)) {
 if(!name.endsWith('.js'))continue;
 const result=spawnSync(process.execPath,['--check',join(dir,name)],{stdio:'inherit'});
 if(result.status!==0)process.exit(result.status||1);
}
console.log('JavaScript syntax checks passed');
