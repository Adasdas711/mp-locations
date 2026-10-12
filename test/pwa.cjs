const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {profiles,openSession}=require('./support/fixtures.cjs'),{launchBrowser}=require('./support/browser.cjs');let browser;
before(async()=>browser=await launchBrowser());after(async()=>browser?.close());
for(const [name,options]of profiles)test(`${name}: PWA install guidance, native prompt, dismissal and installed state`,async t=>{
 const {page}=await openSession(browser,t,options);
 await page.locator('#toolsSettingsOpen').click();await page.locator('.settings-nav-item[data-settings-page="app"]').click();
 assert.equal(await page.locator('#pwaInstructions').isVisible(),true);
 const instructions=await page.locator('#pwaInstructions').innerText();if(name==='iPhone'||name==='iPad')assert.ok(instructions.includes('Safari')&&instructions.includes("Share"));if(name==='Android')assert.ok(instructions.includes('Chrome'));
 await page.evaluate(()=>{window.testPromptCalls=0;const e=new Event('beforeinstallprompt',{cancelable:true});e.prompt=async()=>{testPromptCalls++};e.userChoice=Promise.resolve({outcome:'dismissed'});dispatchEvent(e);window.testPromptPrevented=e.defaultPrevented});
 assert.equal(await page.evaluate(()=>testPromptPrevented),true);assert.equal(await page.locator('#pwaInstall').innerText(),"Install application");
 await page.locator('#pwaInstall').click();assert.equal(await page.evaluate(()=>testPromptCalls),1);assert.ok((await page.locator('#pwaStatus').innerText()).includes("cancelled"));
 await page.evaluate(()=>{const e=new Event('beforeinstallprompt',{cancelable:true});e.prompt=async()=>{testPromptCalls++};e.userChoice=Promise.resolve({outcome:'accepted'});dispatchEvent(e)});
 await page.locator('#pwaInstall').click();await page.evaluate(()=>dispatchEvent(new Event('appinstalled')));
 assert.equal(await page.locator('#pwaInstall').isVisible(),false);assert.equal(await page.locator('#pwaInstructions').isVisible(),false);assert.equal(await page.locator('#pwaStatus').innerText(),"Application installed.");
 assert.equal(await page.evaluate(()=>state.levels.length),2);
});
test('PWA manifest, icon dimensions and offline installation shell are coherent',async()=>{
 const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'../manifest.webmanifest'),'utf8'));
 assert.equal(manifest.display,'standalone');assert.equal(manifest.scope,'./');assert.equal(manifest.start_url,'./');assert.equal(manifest.id,'./');
 for(const icon of manifest.icons){const buffer=fs.readFileSync(path.join(__dirname,'..',icon.src));assert.equal(icon.sizes,buffer.readUInt32BE(16)+'x'+buffer.readUInt32BE(20))}
 const worker=fs.readFileSync(path.join(__dirname,'../sw.js'),'utf8');const assets=JSON.parse(worker.match(/const ASSETS = (\[.*?\]);/s)[1]);assert.ok(assets.includes('pwa.js')&&assets.includes('manifest.webmanifest'));
});
