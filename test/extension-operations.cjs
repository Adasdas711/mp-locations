const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),JSZip=require('../vendor/jszip.min.js'),fs=require('node:fs'),path=require('node:path');
const {launchBrowser}=require('./support/browser.cjs'),{profiles,openSession}=require('./support/fixtures.cjs');let browser;
before(async()=>browser=await launchBrowser());after(async()=>browser?.close());
async function install(page,permissions=['tour.write','tour.read','archive.read','archive.write','keybindings.write']){
 const zip=new JSZip();zip.file('manifest.json',JSON.stringify({id:'test.operations',name:'Operations',version:'1.0.0',apiVersion:1,main:'main.js',permissions,contributes:{commands:[{id:'test.operations.create',title:'Create camera'},{id:'test.operations.shortcut',title:'Shortcut'}]}}));
 zip.file('pano.png',fs.readFileSync(path.join(__dirname,'../icons/icon-192.png')));
 zip.file('main.js',`exports.activate=async api=>{api.commands.register('test.operations.create',async()=>{const created=await api.tour.add({id:'api-camera',level:0,room:'API camera',planPx:{x:80,y:110}});await api.tour.loadPanorama({id:created.id,src:api.assets.read('pano.png')});await api.archive.meta.write({fromAddon:true});await api.archive.write({path:'addon/info.txt',encoding:'text',data:'Привет из аддона'});return created});api.commands.register('test.operations.shortcut',()=>api.ui.showMessage('addon shortcut fired'));${permissions.includes('keybindings.write')?"await api.keybindings.register({id:'test.operations.auto',command:'test.operations.shortcut',key:'Alt+Shift+F8'});":''}}`);
 await page.locator('#toolsSettingsOpen').click();await page.locator('#addonsOpen').click();await page.locator('#addonFile').setInputFiles({name:'operations.palace-addon',mimeType:'application/zip',buffer:await zip.generateAsync({type:'nodebuffer'})});await page.locator('#addonInstall').click();await page.waitForFunction(()=>addonHosts.get('test.operations')?.ready);
}
for(const [name,options]of profiles)test(`${name}: sandbox camera/panorama, raw archive and metadata APIs, undo, export and recovery`,async t=>{
 const {page}=await openSession(browser,t,options,{offlineCache:true});await install(page);
 await page.locator('[data-command="test.operations.create"]').click();await page.waitForFunction(()=>state.panoramas['api-camera']?.data&&archiveContext.patches?.['addon/info.txt']);
 assert.equal(await page.evaluate(()=>state.panoramas['api-camera'].room),'API camera');
 assert.deepEqual(await page.evaluate(()=>addonRPC(addonHosts.get('test.operations'),'archive.meta.read')), {fromAddon:true});
 assert.equal((await page.evaluate(()=>addonRPC(addonHosts.get('test.operations'),'archive.read',{path:'addon/info.txt'}))).data,"Привет из аддона");
 await page.locator('#addonsClose').click();
 const oldPanorama=await page.evaluate(()=>state.panoramas.a.data);
 await page.evaluate(async()=>{const canvas=document.createElement('canvas');canvas.width=32;canvas.height=16;await addonRPC(addonHosts.get('test.operations'),'tour.loadPanorama',{id:'a',src:canvas.toDataURL('image/png')})});
 assert.notEqual(await page.evaluate(()=>state.panoramas.a.data),oldPanorama);
 await page.keyboard.press('Control+z');assert.equal(await page.evaluate(()=>state.panoramas.a.data),oldPanorama);
 await page.evaluate(()=>{changeCameraTransition('a','api-camera',true);setStartPano('api-camera')});
 const bytes=await page.evaluate(()=>state.panoramas['api-camera'].data);
 await page.evaluate(()=>addonRPC(addonHosts.get('test.operations'),'tour.remove','api-camera'));
 assert.equal(await page.evaluate(()=>!!state.panoramas['api-camera']),false);assert.equal(await page.evaluate(()=>state.startPano),null);
 await page.keyboard.press('Control+z');await page.waitForFunction(()=>state.panoramas['api-camera']?.data&&state.startPano==='api-camera');
 assert.equal(await page.evaluate(()=>state.panoramas['api-camera'].data),bytes);
 assert.ok(await page.evaluate(()=>state.panoramas.a.destinations.some(d=>d.panoId==='api-camera')));
 await page.evaluate(()=>addonRPC(addonHosts.get('test.operations'),'archive.write',{path:'binary/data.bin',encoding:'base64',data:'AAEC/w=='}));
 await page.evaluate(()=>addonRPC(addonHosts.get('test.operations'),'archive.remove','addon/info.txt'));
 await page.keyboard.press('Control+z');
 assert.equal((await page.evaluate(()=>addonRPC(addonHosts.get('test.operations'),'archive.read',{path:'addon/info.txt'}))).data,"Привет из аддона");
 await page.evaluate(()=>addonRPC(addonHosts.get('test.operations'),'archive.meta.write',{changed:true}));await page.keyboard.press('Control+z');
 assert.deepEqual(await page.evaluate(()=>addonRPC(addonHosts.get('test.operations'),'archive.meta.read')),{fromAddon:true});
 const raw=await page.evaluate(()=>addonRPC(addonHosts.get('test.operations'),'archive.export'));const zip=await JSZip.loadAsync(raw.data,{base64:true});
 assert.deepEqual(JSON.parse(await zip.file('meta.json').async('string')),{fromAddon:true});assert.deepEqual(await zip.file('binary/data.bin').async('nodebuffer'),Buffer.from([0,1,2,255]));
 assert.equal(await zip.file('addon/info.txt').async('string'),"Привет из аддона");
 const rawDownload=page.waitForEvent('download');await page.evaluate(()=>addonRPC(addonHosts.get('test.operations'),'archive.download'));const rawFile=await rawDownload;
 const nativeZip=await JSZip.loadAsync(fs.readFileSync(await rawFile.path()));assert.deepEqual(JSON.parse(await nativeZip.file('meta.json').async('string')),{fromAddon:true});

 await page.locator('#abSave').click();const waiting=page.waitForEvent('download');await page.locator('#saveMpalaceBtn').click();const download=await waiting;
 const projectZip=await JSZip.loadAsync(fs.readFileSync(await download.path()));const project=JSON.parse(await projectZip.file('palace.json').async('string'));
 assert.equal(project.startPano,'api-camera');assert.ok(projectZip.file(project.panoramas['api-camera'].file));assert.equal(await projectZip.file('addon/info.txt').async('string'),"Привет из аддона");
 await page.evaluate(async()=>{touch();await saveRecovery()});await page.reload({waitUntil:'networkidle'});
 assert.equal(await page.locator('#recoveryModal').count(),0);
 await page.locator('#abSave').click();await page.locator('#recoveryOpen').click();await page.locator('#recoveryList button').first().click();await page.waitForFunction(()=>!!state.panoramas['api-camera']?.data);
 await page.waitForFunction(()=>addonHosts.get('test.operations')?.ready);
 assert.equal((await page.evaluate(()=>addonRPC(addonHosts.get('test.operations'),'archive.read',{path:'binary/data.bin',encoding:'base64'}))).data,'AAEC/w==');
});
test('addon hotkeys register in settings, reject conflicts, obey text focus and are removed on disable',async t=>{
 const {page}=await openSession(browser,t,profiles[0][1],{offlineCache:true});await install(page);await page.locator('#addonsClose').click();
 await page.evaluate(()=>addonRPC(addonHosts.get('test.operations'),'keybindings.register',{id:'test.operations.binding',command:'test.operations.shortcut',key:'Ctrl+Alt+Shift+KeyU'}));
 await page.keyboard.press('Control+Alt+Shift+u');await page.waitForFunction(()=>document.querySelector('#status').textContent==='addon shortcut fired');
 await page.locator('#toolsSettingsOpen').click();await page.locator('#abHotkeys').click();assert.equal(await page.locator('#hotkeysModal').getByText('Shortcut',{exact:true}).count(),2);await page.locator('#hkClose').click();
 assert.equal(await page.evaluate(async()=>{try{await addonRPC(addonHosts.get('test.operations'),'keybindings.register',{id:'test.operations.conflict',command:'test.operations.shortcut',key:'Ctrl+KeyS'});return false}catch(e){return e.message.includes("already used")}}),true);
 await page.evaluate(()=>{const input=document.createElement('textarea');input.id='typingTest';input.style.cssText='position:fixed;top:100px;left:100px;z-index:9999';document.body.append(input);input.focus()});await page.evaluate(()=>status('typing'));await page.keyboard.press('Control+Alt+Shift+u');assert.equal(await page.locator('#status').innerText(),'typing');await page.locator('#typingTest').evaluate(el=>el.remove());
 await page.locator('#toolsSettingsOpen').click();await page.locator('#addonsOpen').click();await page.locator('[data-addon="test.operations"] [data-action="toggle"]').click();await page.waitForFunction(()=>!addonHosts.has('test.operations'));await page.locator('#addonsClose').click();
 assert.equal(await page.evaluate(()=>HOTKEYS.some(c=>c.id==='test.operations.binding')),false);
 await page.evaluate(()=>status('disabled'));await page.keyboard.press('Control+Alt+Shift+u');assert.equal(await page.locator('#status').innerText(),'disabled');
});
test('new API capabilities reject missing permission, invalid paths/images and view-mode writes',async t=>{
 const {page}=await openSession(browser,t,profiles[0][1],{offlineCache:true});await install(page,[]);
 for(const [method,args]of [['tour.add',{id:'x',level:0}],['archive.meta.read'],['archive.write',{path:'a',encoding:'text',data:'x'}],['keybindings.register',{id:'test.operations.a',command:'test.operations.shortcut',key:'Alt+Shift+KeyU'}]]){
  assert.equal(await page.evaluate(async({method,args})=>{try{await addonRPC(addonHosts.get('test.operations'),method,args);return false}catch(e){return e.message.includes("Permission denied")}},{method,args}),true);
 }
 await page.evaluate(()=>addonHosts.get('test.operations').record.manifest.permissions=['tour.write','archive.write']);
 for(const [method,args]of [['archive.write',{path:'../outside.txt',encoding:'text',data:'x'}],['archive.write',{path:'meta.json',encoding:'text',data:'[]'}],['tour.add',{id:'bad',level:0,src:'https://example.com/photo.jpg'}]])assert.equal(await page.evaluate(async({method,args})=>{try{await addonRPC(addonHosts.get('test.operations'),method,args);return false}catch{return true}},{method,args}),true);
 assert.equal(await page.evaluate(()=>Object.hasOwn(state.panoramas,'bad')),false);
 await page.locator('#addonsClose').click();await page.locator('#modeBtn').click();
 for(const [method,args]of [['tour.add',{id:'view',level:0}],['archive.meta.write',{bad:true}],['archive.remove','meta.json']])assert.equal(await page.evaluate(async({method,args})=>{try{await addonRPC(addonHosts.get('test.operations'),method,args);return false}catch{return true}},{method,args}),true);
});
