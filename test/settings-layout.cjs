const {test,before,after}=require('node:test'),assert=require('node:assert/strict');
const path=require('node:path');
const {profiles,openSession}=require('./support/fixtures.cjs'),{launchBrowser}=require('./support/browser.cjs');
let browser;before(async()=>browser=await launchBrowser());after(async()=>browser?.close());
const section=page=>id=>page.locator(`.settings-nav-item[data-settings-page="${id}"]`).click();
for(const [name,options]of profiles){
 test(`${name}: settings groups, English pages, appearance persistence and editor controls`,async t=>{
  const {page}=await openSession(browser,t,options);
  assert.equal(await page.locator('html').getAttribute('lang'),'en');
  assert.equal(/[А-Яа-яЁё]/.test(await page.locator('#appRoot').innerText()),false);
  assert.deepEqual(await page.evaluate(()=>[1,2,5,21].map(n=>plural(n,'locus','loci','loci'))),['1 locus','2 loci','5 loci','21 loci']);
  await page.locator('#toolsSettingsOpen').click();
  assert.deepEqual(await page.locator('.settings-nav-group>h3').allTextContents(),['Options','Core plugins','Community plugins']);
  assert.deepEqual(await page.locator('.settings-nav-group').first().locator('.settings-nav-item span').allTextContents(),['General','Appearance','Interface','Editor','Files and links','Hotkeys','Core plugins','Community plugins']);
  assert.equal(await page.locator('#settingsNav').evaluate(el=>getComputedStyle(el).display),'flex','Navigation remains a vertical list on every screen');
  for(const id of ['app','appearance','tools','editor','files','hotkeys','core','addons','canvas','cameras','viewer','minimap']){
   await section(page)(id);
   const text=await page.locator(`.settings-pane[data-settings-page="${id}"]`).innerText();assert.equal(/[А-Яа-яЁё]/.test(text),false,`${id} uses English`);
   assert.equal(await page.getByRole('dialog').count(),1);
  }
  await section(page)('appearance');
  assert.equal(await page.locator('#settingsFont').isVisible(),true);assert.equal(await page.locator('.settings-section-title').innerText(),'Font');
  await page.locator('#settingsAccent').evaluate(el=>{el.value='#aaccff';el.dispatchEvent(new Event('input',{bubbles:true}))});
  await page.locator('#settingsFont').selectOption('ui-monospace, monospace');
  await page.locator('#settingsTheme').selectOption('borealis');
  assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--blue').trim()),'#aaccff');
  await section(page)('editor');await page.locator('#settingsMarkerSize').fill('64');await page.locator('#settingsMarkerSize').press('Tab');
  assert.equal(await page.evaluate(()=>state.markerSize),64);await page.locator('#settingsFloorMode').selectOption('dark');assert.equal(await page.evaluate(()=>floorMode()),'dark');
  await section(page)('minimap');const toggle=page.locator('.settings-pane[data-settings-page="minimap"] [data-core-tool="system.minimap"]');await toggle.uncheck();assert.equal(await page.evaluate(()=>toolPreferences['system.minimap']),false);await toggle.check();
  const bounds=await page.locator('#settingsModal>.dialog').evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight&&el.scrollWidth<=el.clientWidth});assert.equal(bounds,true);
  await page.locator('#settingsClose').click();await page.reload({waitUntil:'networkidle'});
  assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--blue').trim()),'#aaccff');
  assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--t-font-ui').trim()),'ui-monospace, monospace');
  await page.locator('#toolsSettingsOpen').click();await section(page)('appearance');await page.locator('#settingsAccentReset').click();
  assert.equal(await page.evaluate(()=>document.documentElement.style.getPropertyValue('--blue')),'');
 });
 test(`${name}: installed plugins appear in the settings tree; user text keeps its original language`,async t=>{
  const {page}=await openSession(browser,t,options,{offlineCache:true});
  await page.evaluate(()=>{PalaceAPI.planRename({level:0,name:'Русский этаж'});PalaceAPI.markerUpdate({level:0,index:0,patch:{note:'Моя заметка'}});PalaceAPI.tourUpdate({id:'a',patch:{room:'Моя камера'}})});
  assert.equal(await page.locator('.floor-overlay .fl-name').filter({hasText:'Русский этаж'}).count(),1);
  assert.deepEqual(await page.evaluate(()=>({floor:state.levels[0].name,note:state.levels[0].markers[0].note,camera:state.panoramas.a.room})),{floor:'Русский этаж',note:'Моя заметка',camera:'Моя камера'});
  await page.locator('#toolsSettingsOpen').click();await section(page)('addons');await page.locator('#addonFile').setInputFiles(path.join(__dirname,'../addons/example.palace-addon'));await page.locator('#addonInstall').click();await page.waitForFunction(()=>addonHosts.get('palace.example')?.ready);
  const plugin=page.locator('.settings-plugin-item[data-plugin-id="palace.example"]');assert.equal(await plugin.innerText(),'Palace overview');await plugin.click();assert.equal(await page.locator('#addonSearch').inputValue(),'palace.example');
  await page.locator('[data-addon="palace.example"] [data-action="remove"]').click();await page.waitForFunction(()=>!addonPackages.has('palace.example'));assert.equal(await plugin.count(),0);
 });
}
