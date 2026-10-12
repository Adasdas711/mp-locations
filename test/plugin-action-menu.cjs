const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {profiles,openSession}=require('./support/fixtures.cjs'),{launchBrowser}=require('./support/browser.cjs');let browser;
before(async()=>browser=await launchBrowser());after(async()=>browser?.close());
for(const [name,options]of profiles)test(`${name}: addon gears and overflow actions are accessible and keep toggle state`,async t=>{
 const {page}=await openSession(browser,t,options,{offlineCache:true});await page.locator('#toolsSettingsOpen').click();
 for(const [id,target]of [['system.history','history'],['system.command-palette','command-palette'],['system.workspace-presets','workspace-presets']]){
  await page.locator('.settings-nav-item[data-settings-page=core]').click();const toggle=page.locator(`[data-system-addon="${id}"]`);const enabled=await toggle.isChecked();await page.locator(`[data-system-addon-settings="${id}"]`).click();assert.equal(await page.locator('#settingsModal').getAttribute('data-page'),target);assert.equal(await toggle.isChecked(),enabled,'Opening settings must not toggle the addon');
 }
 await page.locator('#addonsOpen').click();await page.locator('#addonFile').setInputFiles(path.join(__dirname,'../addons/example.palace-addon'));await page.locator('#addonInstall').click();await page.waitForFunction(()=>addonHosts.get('palace.example')?.ready);
 const card=page.locator('[data-addon="palace.example"]'),menu=card.locator('.addon-action-menu'),trigger=menu.locator('summary');
 assert.equal(await card.locator('[data-action=details]').isVisible(),false);await trigger.focus();await page.keyboard.press('Enter');assert.equal(await card.locator('[data-action=details]').isVisible(),true);
 await page.keyboard.press('Escape');assert.equal(await menu.getAttribute('open'),null);assert.equal(await page.locator('#settingsModal').isVisible(),true);assert.equal(await trigger.evaluate(el=>el===document.activeElement),true);
 await trigger.click();await page.locator('#settingsModalTitle').click();assert.equal(await menu.getAttribute('open'),null);
 await trigger.click();await card.locator('[data-action=details]').click();assert.equal(await page.locator('#addonDetails').isVisible(),true);assert.equal(await page.evaluate(()=>addonPackages.get('palace.example').enabled),true);
 await page.locator('#addonDetailsClose').click();await page.locator('#toolsSettingsOpen').click();await page.locator('#addonsOpen').click();
 const bounds=await page.locator('#settingsModal>.dialog').evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight&&el.scrollWidth<=el.clientWidth});assert.equal(bounds,true);
 await trigger.click();await card.locator('[data-action=remove]').click();await page.waitForFunction(()=>!addonPackages.has('palace.example'));assert.equal(await card.count(),0);
});
