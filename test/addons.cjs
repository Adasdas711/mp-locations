const {test,before,after}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),JSZip=require('../vendor/jszip.min.js');
const {launchBrowser}=require('./support/browser.cjs'),{profiles,openSession}=require('./support/fixtures.cjs');
let browser;before(async()=>{browser=await launchBrowser()});after(async()=>{await browser?.close()});
async function packageData(manifest,main){const zip=new JSZip();zip.file('manifest.json',JSON.stringify(manifest));zip.file('main.js',main);return zip.generateAsync({type:'nodebuffer'})}
async function install(page,buffer){await page.locator('#toolsSettingsOpen').click();await page.locator('#addonsOpen').click();await page.locator('#addonFile').setInputFiles({name:'example.palace-addon',mimeType:'application/zip',buffer});await page.locator('#addonInstall').click()}
for(const [name,options]of profiles)test(`${name}: addon install, module import, command, panel, toggle, persistence and uninstall`,async t=>{
 const {page}=await openSession(browser,t,options,{offlineCache:true});
 const zip=new JSZip();for(const file of ['manifest.json','main.js','utils.js','icon.svg'])zip.file(file,fs.readFileSync(path.join(__dirname,'../addons/example',file)));
 await install(page,await zip.generateAsync({type:'nodebuffer'}));const card=page.locator('[data-addon="palace.example"]');await page.waitForFunction(()=>addonHosts.get('palace.example')?.ready);
 await page.locator('#addonSearch').fill("несуществующий аддон");assert.equal(await card.count(),0);await page.locator('#addonSearch').fill("Overview");assert.equal(await card.count(),1);await page.locator('#addonSearch').fill('');
 const count=await page.evaluate(()=>state.levels[0].markers.length);await card.locator('[data-command="palace.example.center"]').click();await page.waitForFunction(n=>state.levels[0].markers.length===n+1,count);
 await card.locator('[data-command="palace.example.summary"]').click();const frame=page.frameLocator('#addonPanelFrames iframe');await frame.locator('h2').waitFor();assert.equal(await frame.locator('h2').innerText(),'Functional palace');
 await page.locator('#addonPanelClose').click();await page.locator('#toolsSettingsOpen').click();await page.locator('#addonsOpen').click();await card.locator('[data-action="toggle"]').click();await page.waitForFunction(()=>!addonHosts.has('palace.example'));assert.equal(await page.evaluate(()=>addonHosts.has('palace.example')),false);assert.equal(await card.locator('[data-command="palace.example.center"]').isDisabled(),true);
 await card.locator('[data-action="toggle"]').click();await page.waitForFunction(()=>addonHosts.get('palace.example')?.ready);
 await page.locator('#addonMode').uncheck();assert.equal(await page.evaluate(()=>addonHosts.size),0);await page.locator('#addonMode').check();await page.waitForFunction(()=>addonHosts.get('palace.example')?.ready);
 await page.reload({waitUntil:'networkidle'});await page.waitForFunction(()=>addonHosts.get('palace.example')?.ready);if(await page.locator('#recoveryModal.show').count())await page.locator('#recoveryClose').click();
 await page.locator('#toolsSettingsOpen').click();await page.locator('#addonsOpen').click();await card.locator('[data-action="remove"]').click();await page.waitForFunction(()=>!addonPackages.has('palace.example'));assert.equal(await card.count(),0);await page.reload();await page.waitForFunction(()=>!!document.querySelector('#addonList .addon-empty'));assert.equal(await page.evaluate(()=>addonHosts.size),0);
});
test('addon capability denial, edit protection, isolation, invalid manifests and command failure',async t=>{
 const {page}=await openSession(browser,t,profiles[0][1],{offlineCache:true});
 const manifest={id:'test.denied',name:'Denied',version:'1.0.0',apiVersion:1,main:'main.js',permissions:[],contributes:{commands:[{id:'test.denied.write',title:'Write'},{id:'test.denied.isolation',title:'Isolation'}]}};
 const script=`exports.activate=api=>{api.commands.register('test.denied.write',()=>api.markers.add({level:0,x:10,y:10}));api.commands.register('test.denied.isolation',()=>{let blocked=false;try{parent.document.body.innerHTML='bad'}catch{blocked=true}if(!blocked)throw new Error('Sandbox escaped');return api.ui.showMessage('isolated')})}`;
 await install(page,await packageData(manifest,script));await page.waitForFunction(()=>addonHosts.get('test.denied')?.ready);
 await page.locator('[data-command="test.denied.write"]').click();await page.waitForFunction(()=>document.querySelector('#addonStatus').textContent.includes("Permission denied"));assert.equal(await page.evaluate(()=>state.levels[0].markers.length),2);
 await page.locator('[data-command="test.denied.isolation"]').click();assert.equal(await page.locator('#appRoot').count(),1);
 await page.locator('#addonsClose').click();await page.locator('#modeBtn').click();assert.equal(await page.evaluate(()=>{try{PalaceAPI.addMarker({level:0,x:20,y:20});return false}catch{return true}}),true);
 await page.locator('#toolsSettingsOpen').click();await page.locator('#addonsOpen').click();manifest.apiVersion=99;await page.locator('#addonFile').setInputFiles({name:'invalid.zip',mimeType:'application/zip',buffer:await packageData(manifest,script)});await page.waitForFunction(()=>document.querySelector('#addonStatus').textContent.includes('apiVersion'));assert.equal(await page.locator('#addonInstallPreview').isVisible(),false);
});
