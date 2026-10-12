const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const {launchBrowser}=require('./support/browser.cjs'),{profiles,openSession}=require('./support/fixtures.cjs');
let browser;before(async()=>{browser=await launchBrowser()});after(async()=>{await browser?.close()});
for(const [name,options]of profiles){
 test(`${name}: unavailable local storage does not prevent editing or file export`,async t=>{
  const context=await browser.newContext({...options,serviceWorkers:'block'});t.after(()=>context.close());const page=await context.newPage();page.setDefaultTimeout(10000);
  await context.addInitScript(()=>{Object.defineProperty(window,'indexedDB',{value:{open(){throw new DOMException('Storage unavailable','QuotaExceededError')}}})});
  await page.goto(process.env.PALACE_TEST_URL||'http://127.0.0.1:8000',{waitUntil:'networkidle'});
  await page.locator('#palaceName').fill('Without storage');await page.locator('#palaceName').press('Tab');await page.locator('#abSave').click();
  await page.waitForFunction(()=>document.querySelector('#recoveryStatus').textContent.includes("unavailable"));
  const waiting=page.waitForEvent('download');await page.locator('#saveJsonBtn').click();const download=await waiting;
  const json=JSON.parse(require('node:fs').readFileSync(await download.path(),'utf8'));assert.equal(json.name,'Without storage');
 });
 test(`${name}: route reorder, marker sizing and floor reorder preserve project contents`,async t=>{
  const {page}=await openSession(browser,t,options);
  await page.locator('#route .r[data-l="0"][data-i="0"]').focus();await page.keyboard.press('Alt+ArrowRight');assert.equal(await page.evaluate(()=>state.levels[0].markers[0].note),'second');
  await page.locator('#markerSize').evaluate(el=>{el.value=80;el.dispatchEvent(new Event('input',{bubbles:true}))});
  assert.equal(await page.evaluate(()=>state.markerSize),80);assert.equal(await page.locator('#plan .marker').first().evaluate(el=>parseFloat(el.style.width)),80);
  await page.evaluate(()=>moveLevel(0,1));assert.equal(await page.evaluate(()=>state.levels[1].name),'Floor 1');assert.equal(await page.evaluate(()=>state.levels[1].markers[0].note),'second');
  await page.evaluate(()=>moveLevel(1,0));assert.equal(await page.evaluate(()=>state.levels[0].name),'Floor 1');
 });
}
