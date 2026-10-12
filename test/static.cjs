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
  for(const file of ['app.js','themes.js','theme-picker.js','mobile.js','mobile-controls.js','app-api.js','addons.js','interfaces.js','appearance.js','extension-operations.js','persistence.js','transitions.js','camera-editor.js','settings.js','pwa.js','addon-management.js','system-addons.js','history-addon.js','command-palette.js','workspace-presets.js','sw.js'])new vm.Script(fs.readFileSync(path.join(root,file),'utf8'),{filename:file});
});
test('offline cache covers existing app assets and has a matching version',()=>{
  const worker=fs.readFileSync(path.join(root,'sw.js'),'utf8');
  const assets=JSON.parse(worker.match(/const ASSETS = (\[.*?\]);/s)[1]);
  for(const required of ['index.html','persistence.js','manifest.webmanifest','vendor/three.min.js','vendor/pdf.worker.min.js','vendor/eng.traineddata.gz'])assert.ok(assets.includes(required));
  const hash=createHash('sha256');
  for(const file of assets)if(file!=='./')hash.update(fs.readFileSync(path.join(root,file)));
  assert.equal(worker.match(/const CACHE = 'palace-offline-([^']+)';/)[1],hash.digest('hex').slice(0,16),'Run npm run update:offline after changing application assets');
});
test('index.html is the reproducible minified build of index.max.html',async()=>{
 const {buildHTML}=require('../scripts/build-html.cjs');
 const source=fs.readFileSync(path.join(root,'index.max.html'),'utf8'),html=fs.readFileSync(path.join(root,'index.html'),'utf8');
 assert.equal(html,await buildHTML()+'\n','Run npm run build after editing index.max.html');
 assert.ok(html.length<source.length);
 let count=0;for(const [,script]of source.matchAll(/<script>(.*?)<\/script>/gs)){new vm.Script(script);count++}assert.ok(count>0);
});
