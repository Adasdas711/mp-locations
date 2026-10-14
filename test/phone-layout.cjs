const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const {devices}=require('playwright-core');
const {launchBrowser}=require('./support/browser.cjs');
const {openSession}=require('./support/fixtures.cjs');
let browser;
before(async()=>{browser=await launchBrowser()});after(async()=>{await browser?.close()});
const phones=[['Android',devices['Pixel 7']],['iPhone',devices['iPhone 13']],['narrow iPhone',{...devices['iPhone 13'],viewport:{width:320,height:640}}]].filter(([name])=>!process.env.PALACE_PROFILES||process.env.PALACE_PROFILES.split(',').includes(name==='narrow iPhone'?'iPhone':name));
async function swipe(context,page,locator,axis='x'){
 await locator.scrollIntoViewIfNeeded();
 const box=await locator.boundingBox();
 const start={x:box.x+box.width*.85,y:box.y+box.height*.6};
 const end={x:axis==='x'?box.x+box.width*.15:start.x,y:axis==='y'?box.y+box.height*.15:start.y};
 if((process.env.PALACE_BROWSER||'chromium')!=='chromium'){
  // WebKit has no CDP touch driver; exercise the browser's native scroll input.
  await page.mouse.move(start.x,start.y);await page.mouse.wheel(start.x-end.x,start.y-end.y);return;
 }
 const cdp=await context.newCDPSession(page);
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...start,id:0}]});
 for(let i=1;i<=8;i++){
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:start.x+(end.x-start.x)*i/8,y:start.y+(end.y-start.y)*i/8,id:0}]});
  await page.waitForTimeout(20);
 }
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();
}
async function bounded(page){assert.equal(await page.evaluate(()=>document.body.scrollWidth<=innerWidth&&document.documentElement.scrollWidth<=innerWidth),true,'Page itself must not scroll horizontally')}
for(const [name,options]of phones){
 test(`${name}: compact phone chrome, native navigation scrolling and landscape reachability`,async t=>{
  const {page,context}=await openSession(browser,t,options);
  assert.equal(await page.evaluate(()=>PALACE_UI.k),1);
  assert.ok((await page.locator('.top').boundingBox()).height<=38);
  assert.ok((await page.locator('.activity').boundingBox()).height<=46);
  for(const size of [0,1,2]){
   await page.evaluate(size=>PALACE_UI.setSize(size),size);await bounded(page);
   const info=await page.locator('.activity').evaluate(el=>({width:el.clientWidth,scroll:el.scrollWidth}));
   if(info.scroll>info.width){await swipe(context,page,page.locator('.activity'));await page.waitForFunction(()=>document.querySelector('.activity').scrollLeft>0)}
   await page.locator('#toolsSettingsOpen').tap();await page.locator('#settingsModal.show').waitFor();
   assert.equal(await page.locator('#settingsClose').evaluate(el=>el.getBoundingClientRect().bottom<=document.querySelector('#settingsModalTitle').getBoundingClientRect().bottom),true,'Close button fits the compact title bar');
   await page.locator('#settingsClose').tap();
  }
  await page.setViewportSize({width:options.viewport.height,height:options.viewport.width});await page.waitForFunction(()=>document.documentElement.classList.contains('phone-land'));
  const bar=page.locator('.activity');const info=await bar.evaluate(el=>({height:el.clientHeight,scroll:el.scrollHeight}));
  if(info.scroll>info.height){await swipe(context,page,bar,'y');await page.waitForFunction(()=>document.querySelector('.activity').scrollTop>0)}
  await page.locator('#toolsSettingsOpen').tap();await page.locator('#settingsModal.show').waitFor();await bounded(page);
 });
 test(`${name}: overflowing preset actions scroll with touch and remain usable`,async t=>{
  const {page,context}=await openSession(browser,t,options);
  await page.locator('#toolsSettingsOpen').tap();await page.locator('[data-settings-page="workspace-presets"].settings-nav-item').tap();
  const font=await page.locator('#settingsModal>.dialog').evaluate(el=>parseFloat(getComputedStyle(el).fontSize));assert.ok(font<=12);
  await page.locator('#workspacePresetName').fill('Phone workspace');await page.locator('#workspacePresetSave').tap();
  const actions=page.locator('.workspace-preset .persistence-actions');
  const width=await actions.evaluate(el=>({client:el.clientWidth,scroll:el.scrollWidth}));
  if(name==='narrow iPhone')assert.ok(width.scroll>width.client);
  if(width.scroll>width.client){await swipe(context,page,actions);await page.waitForFunction(()=>document.querySelector('.workspace-preset .persistence-actions').scrollLeft>0)}
  await actions.locator('[data-action="delete"]').tap();await actions.locator('[data-action="delete"]').tap();await page.waitForFunction(()=>workspacePresets.length===0);
  await bounded(page);
  if(name.includes('iPhone')){
   assert.ok(await page.locator('#workspacePresetName').evaluate(el=>parseFloat(getComputedStyle(el).fontSize)>=16));
   const search=await page.locator('#settingsSearch').evaluate(el=>({font:parseFloat(getComputedStyle(el).fontSize),padding:parseFloat(getComputedStyle(el).paddingLeft)}));assert.ok(search.font>=16&&search.padding>=36);
  }
 });
 test(`${name}: calibration controls stay bounded and leave both panoramas usable`,async t=>{
  const {page}=await openSession(browser,t,options);await page.locator('#calibrationTool').tap();await page.waitForFunction(()=>calibrationUI.open&&!calibrationUI.busy);
  for(const size of [0,1,2]){
   await page.evaluate(size=>PALACE_UI.setSize(size),size);
   assert.ok(await page.locator('.calibration-viewport').evaluateAll(els=>els.every(el=>el.clientHeight>=85)));
   assert.equal(await page.locator('.calibration-navigation').evaluate(el=>getComputedStyle(el).overflowX),'auto');
   await page.locator('#calibrationCameras').tap();await page.locator('#calibrationCameraPanel').waitFor({state:'visible'});await page.locator('#calibrationCamerasClose').tap();
   await page.locator('#calibrationDetails summary').tap();await page.waitForFunction(()=>document.querySelector('#calibrationDetails').open);
   await page.locator('#calibrationDetails summary').tap();await bounded(page);
  }
  await page.locator('#calibrationClose').tap();await page.waitForFunction(()=>!calibrationUI.open);
 });
}
