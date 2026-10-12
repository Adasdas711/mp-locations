const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {createHash}=require('node:crypto');
const root=path.resolve(__dirname,'..');
test('all inline and standalone application scripts parse',()=>{
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  let index=0;
  for(const [,source]of html.matchAll(/<script>(.*?)<\/script>/gs))new vm.Script(source,{filename:`index.html inline ${++index}`});
  assert.ok(index>0);
  for(const file of ['app.js','themes.js','theme-picker.js','mobile.js','mobile-controls.js','app-api.js','addons.js','interfaces.js','persistence.js','transitions.js','camera-editor.js','sw.js'])new vm.Script(fs.readFileSync(path.join(root,file),'utf8'),{filename:file});
});
test('offline cache covers existing app assets and has a matching version',()=>{
  const worker=fs.readFileSync(path.join(root,'sw.js'),'utf8');
  const assets=JSON.parse(worker.match(/const ASSETS = (\[.*?\]);/s)[1]);
  for(const required of ['index.html','persistence.js','manifest.webmanifest','vendor/three.min.js','vendor/pdf.worker.min.js','vendor/eng.traineddata.gz'])assert.ok(assets.includes(required));
  const hash=createHash('sha256');
  for(const file of assets)if(file!=='./')hash.update(fs.readFileSync(path.join(root,file)));
  assert.equal(worker.match(/const CACHE = 'palace-offline-([^']+)';/)[1],hash.digest('hex').slice(0,16),'Run npm run update:offline after changing application assets');
});
