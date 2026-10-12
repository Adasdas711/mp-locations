const {test,before,after}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs');
const JSZip=require('../vendor/jszip.min.js');
const {profiles,openSession,palace}=require('./support/fixtures.cjs');
const {launchBrowser}=require('./support/browser.cjs');
let browser;
before(async()=>browser=await launchBrowser());
after(async()=>browser?.close());
async function installStoragePlugin(page){
 const zip=new JSZip();
 zip.file('manifest.json',JSON.stringify({id:'test.audit',name:'Audit plugin',version:'1.0.0',apiVersion:1,main:'main.js',permissions:[],contributes:{commands:[],settings:[{key:'first',title:'First',type:'boolean',default:false},{key:'second',title:'Second',type:'boolean',default:false}]}}));
 zip.file('main.js','exports.activate=api=>{window.api=api};');
 await page.evaluate(()=>openSettingsPage('addons'));
 await page.locator('#addonFile').setInputFiles({name:'audit.palace-addon',mimeType:'application/zip',buffer:await zip.generateAsync({type:'nodebuffer'})});
 await page.locator('#addonInstall').click();
 await page.waitForFunction(()=>addonHosts.get('test.audit')?.ready);
}
for(const [name,options]of profiles){
 test(`${name}: palette shortcuts preserve typing and active metadata dialogs`,async t=>{
  const {page}=await openSession(browser,t,options);
  await page.evaluate(()=>{hkOverrides['system.command-palette.open']='KeyP';hkSave();openSettingsPage('workspace-presets')});
  await page.locator('#workspacePresetName').focus();await page.keyboard.type('preset');
  assert.equal(await page.locator('#workspacePresetName').inputValue(),'preset');
  assert.equal(await page.locator('#commandPalette').isVisible(),false);
  await page.evaluate(()=>{hkOverrides['system.command-palette.open']='Ctrl+KeyP';hkSave();closeSettings()});
  await page.locator('#abSave').click();await page.locator('#metaOpen').click();
  const before=await page.locator('#metaEditor').inputValue();
  await page.keyboard.press('Control+p');
  assert.equal(await page.locator('#commandPalette').isVisible(),false);
  assert.equal(await page.locator('#metaModal').isVisible(),true);
  assert.equal(await page.locator('#metaEditor').inputValue(),before);
  await page.locator('#metaClose').click();await page.locator('#closeSaveModal').click();
  await page.keyboard.press('Control+p');assert.equal(await page.locator('#commandPalette').isVisible(),true);
 });
 test(`${name}: failed plugin writes preserve the committed settings and storage`,async t=>{
  const {page}=await openSession(browser,t,options,{offlineCache:true});await installStoragePlugin(page);
  const result=await page.evaluate(async()=>{
   const host=addonHosts.get('test.audit');await addonRPC(host,'storage.set',{key:'saved',value:'committed'});
   const original=storeAddon;storeAddon=async()=>{throw new DOMException('Storage is full','QuotaExceededError')};
   let storageRejected=false,settingsRejected=false;
   try{await addonRPC(host,'storage.set',{key:'saved',value:'unsaved'})}catch{storageRejected=true}
   try{await saveAddonSettings(host.record,{first:true})}catch{settingsRejected=true}
   storeAddon=original;
   return {storageRejected,settingsRejected,value:await addonRPC(host,'storage.get','saved'),settings:addonSettings(host.record)};
  });
  assert.deepEqual(result,{storageRejected:true,settingsRejected:true,value:'committed',settings:{first:false,second:false}});
  await page.reload({waitUntil:'networkidle'});await page.waitForFunction(()=>addonHosts.get('test.audit')?.ready);
  assert.equal(await page.evaluate(()=>addonRPC(addonHosts.get('test.audit'),'storage.get','saved')),'committed');
 });
 test(`${name}: concurrent plugin writes retain every field after a browser reload`,async t=>{
  const {page}=await openSession(browser,t,options,{offlineCache:true});await installStoragePlugin(page);
  const hostFrame=await (await page.locator('#addonPanelFrames iframe').elementHandle()).contentFrame();
  const result=await hostFrame.evaluate(async()=>{
   await Promise.all([api.settings.update({first:true}),api.storage.set('one',1),api.settings.update({second:true}),api.storage.set('two',2)]);
   return {settings:await api.settings.read(),storage:{one:await api.storage.get('one'),two:await api.storage.get('two')}};
  });
  const expected={settings:{first:true,second:true},storage:{one:1,two:2}};
  assert.deepEqual(result,expected);
  await page.reload({waitUntil:'networkidle'});await page.waitForFunction(()=>addonHosts.get('test.audit')?.ready);
  assert.deepEqual(await page.evaluate(()=>{const record=addonPackages.get('test.audit');return {settings:addonSettings(record),storage:record.storage}}),expected);
 });
 test(`${name}: 3D can retry a failed engine download without reloading the project`,async t=>{
  const {page}=await openSession(browser,t,options,{empty:true});
  await page.evaluate(src=>PalaceAPI.planAdd({src,name:'Retry floor'}),'data:image/png;base64,'+fs.readFileSync(require('node:path').join(__dirname,'../icons/icon-192.png')).toString('base64'));
  let requests=0;
  await page.route('**/vendor/three.min.js',async route=>{requests++;if(requests===1)await route.abort();else await route.continue()});
  await page.locator('#planView3d').click();await page.locator('#askModal.show').waitFor();await page.locator('#askYes').click();
  assert.equal(await page.evaluate(()=>planView),'2d');
  await page.locator('#planView3d').click();await page.waitForFunction(()=>planView==='3d'&&DH.ready&&DH.root?.children.length,null,{timeout:20000});
  assert.equal(requests,2);assert.equal(await page.evaluate(()=>state.levels[0].name),'Retry floor');
  await page.locator('#planView2d').click();await page.waitForFunction(()=>planView==='2d');
 });
 test(`${name}: switching palaces cancels pending plan additions and merges`,async t=>{
  const {page}=await openSession(browser,t,options);
  const zip=await JSZip.loadAsync(await palace()),data=JSON.parse(await zip.file('palace.json').async('string'));
  data.name='Replacement palace';data.levels.forEach((floor,i)=>floor.name='Replacement floor '+i);
  zip.file('palace.json',JSON.stringify(data));
  const replacement=await zip.generateAsync({type:'base64'});
  for(const operation of ['add','merge']){
   const result=await page.evaluate(async({replacement,operation})=>{
    const original=loadImage,src=state.levels[0].src;let release;
    const gate=new Promise(resolve=>release=resolve);
    loadImage=async source=>{await gate;return original(source)};
    const task=(operation==='add'?PalaceAPI.planAdd({src,name:'Stale floor'}):mergeLevels(0,1)).then(()=>null,error=>error.message);
    loadImage=original;
    try{
     const bytes=Uint8Array.from(atob(replacement),c=>c.charCodeAt(0)).buffer;
     await openAnyArchiveBuffer(bytes,'replacement.mpalace');
     // Serialization stamps export time; compare the editor's actual edit time.
     const fingerprint=()=>JSON.stringify({...buildSerializableState(),edited:state.edited,dirty:state.dirty});
     const before=fingerprint();release();const error=await task;
     return {unchanged:fingerprint()===before,error,archive:archiveContext.name,arranging:!!arrange,busy:mergeBusy};
    }finally{release();loadImage=original}
   },{replacement,operation});
   assert.equal(result.unchanged,true,'A pending operation must not alter the replacement palace');
   assert.equal(result.archive,'replacement.mpalace');assert.equal(result.arranging,false);assert.equal(result.busy,false);
   if(operation==='add')assert.match(result.error,/Project changed/);
  }
 });
}
test('re-enabling the palette does not take a shortcut assigned while it was disabled',async t=>{
 const {page}=await openSession(browser,t,profiles[0][1]);
 await page.evaluate(()=>{hkOverrides['system.command-palette.open']='Ctrl+Alt+KeyP';setSystemAddonEnabled('system.command-palette',false);hkOverrides['file.save']='Ctrl+Alt+KeyP';hkSave();setSystemAddonEnabled('system.command-palette',true)});
 await page.keyboard.press('Control+Alt+p');await page.locator('#saveModal.show').waitFor();
 assert.equal(await page.locator('#commandPalette').isVisible(),false);
 assert.equal(await page.evaluate(()=>hkBinding('system.command-palette.open')),'');
});
