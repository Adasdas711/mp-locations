const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {profiles,openSession}=require('./support/fixtures.cjs'),{launchBrowser}=require('./support/browser.cjs');let browser;
before(async()=>browser=await launchBrowser());after(async()=>browser?.close());
for(const [name,options]of profiles)test(`${name}: inline addon upload, cancel, install and responsive tool filters`,async t=>{
 const {page}=await openSession(browser,t,options,{offlineCache:true});
 await page.locator('#addonsOpen').click();assert.equal(await page.locator('#addonUploader').isVisible(),false);
 await page.locator('#addonUpload').click();assert.equal(await page.locator('#addonUpload').getAttribute('aria-expanded'),'true');assert.equal(await page.locator('#addonsModal .dialog').evaluate(el=>{const r=el.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight}),true,'Open upload stays inside the viewport');assert.equal(await page.locator('#addonsModal #addonFile').isVisible(),true);
 await page.locator('#addonDrop').focus();await page.keyboard.press('Tab');assert.equal(await page.locator('#addonSearch').evaluate(el=>el===document.activeElement),true);
 await page.locator('#addonFile').setInputFiles({name:'appearance.palace-addon',mimeType:'application/zip',buffer:fs.readFileSync('addons/appearance.palace-addon')});await page.locator('#addonInstall').waitFor();
 assert.equal(await page.locator('#addonsModal #addonUploader #addonInstall').isVisible(),true);assert.equal(await page.locator('.modal.show').count(),1);
 await page.locator('#addonUploadClose').click();assert.equal(await page.locator('#addonUploader').isVisible(),false);assert.equal(await page.evaluate(()=>pendingAddon),null);assert.equal(await page.evaluate(()=>addonPackages.size),0);
 await page.locator('#addonUpload').click();await page.locator('#addonFile').setInputFiles({name:'appearance.palace-addon',mimeType:'application/zip',buffer:fs.readFileSync('addons/appearance.palace-addon')});await page.locator('#addonInstall').click();await page.waitForFunction(()=>addonPackages.size===1);
 assert.equal(await page.locator('#addonUploader').isVisible(),false);assert.equal(await page.locator('.addon-card').count(),1);
 const addonLayout=await page.locator('#addonsModal .dialog').evaluate(el=>{const r=el.getBoundingClientRect();return {within:r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight,overflow:el.scrollWidth>el.clientWidth}});assert.deepEqual(addonLayout,{within:true,overflow:false});
 await page.locator('#addonsClose').click();await page.locator('#toolsSettingsOpen').click();await page.locator('#toolsCategory').selectOption('system');assert.ok(await page.locator('[data-tool-key^="system."]').count()>0);assert.equal(await page.locator('[data-tool-key^="addon."]').count(),0);
 await page.locator('#toolsCategory').selectOption('addons');assert.equal(await page.locator('[data-tool-key^="system."]').count(),0);await page.locator('#toolsCategory').selectOption('all');await page.locator('#toolsFilter').fill('Увеличить');assert.ok(await page.locator('[data-tool-key="system.zoomIn"]').count()>0);
 assert.equal(await page.locator('#toolsSettings .dialog').evaluate(el=>el.scrollWidth>el.clientWidth),false);
});
