const {profiles}=require('./support/fixtures.cjs');
const {launchBrowser}=require('./support/browser.cjs');
const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs');
const {chromium}=require('playwright-core');
const JSZip=require('../vendor/jszip.min.js');
for(const [profile,options]of profiles)test(`${profile}: camera transitions, undo, archive roundtrip and view protection`,async()=>{
  const browser=await launchBrowser();
  try{
    const context=await browser.newContext({...options,serviceWorkers:'block'});const page=await context.newPage();page.setDefaultTimeout(10000);
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(process.env.PALACE_TEST_URL||'http://127.0.0.1:8000',{waitUntil:'networkidle'});
    const image=fs.readFileSync(require('node:path').join(__dirname,'../icons/icon-192.png'));
    const zip=new JSZip();zip.file('images/level-1.png',image);zip.file('panoramas/p.png',image);
    zip.file('palace.json',JSON.stringify({name:'Transitions',levels:[{floorId:1,image:'images/level-1.png',w:192,h:192,markers:[]}],panoramas:{a:{mode:'equirect',file:'panoramas/p.png',room:'Camera A',floorId:1,planPx:{x:50,y:50},destinations:[]},b:{mode:'equirect',file:'panoramas/p.png',room:'Camera B',floorId:1,planPx:{x:140,y:140},destinations:[]}}}));
    await page.locator('#fileOpen').setInputFiles({name:'transitions.mpalace',mimeType:'application/zip',buffer:await zip.generateAsync({type:'nodebuffer'})});
    await page.waitForFunction(()=>archiveContext?.name==='transitions.mpalace');
    await page.locator('#plan .plan-cam').first().click({button:'right'});
    await page.locator('.ctx-item').filter({hasText:'Переходы камеры'}).click();
    await page.locator('#transitionTarget').selectOption('b');await page.locator('#transitionAdd').click();
    assert.deepEqual(await page.evaluate(()=>[state.panoramas.a.destinations.map(x=>x.panoId),state.panoramas.b.destinations.map(x=>x.panoId)]),[['b'],['a']]);
    assert.equal(await page.locator('#transitionAdd').isDisabled(),true);
    await page.locator('#transitionList button').click();
    assert.deepEqual(await page.evaluate(()=>[state.panoramas.a.destinations,state.panoramas.b.destinations]),[[],[]]);
    await page.locator('#transitionClose').click();await page.keyboard.press('Control+z');
    await page.waitForFunction(()=>state.panoramas.a.destinations.length===1&&state.panoramas.b.destinations.length===1);
    await page.locator('#abSave').click();const waiting=page.waitForEvent('download');await page.locator('#saveMpalaceBtn').click();const d=await waiting;
    const saved=fs.readFileSync(await d.path());const savedZip=await JSZip.loadAsync(saved);const palace=JSON.parse(await savedZip.file('palace.json').async('string'));
    assert.equal(palace.panoramas.a.destinations[0].panoId,'b');
    await page.locator('#fileOpen').setInputFiles({name:'saved.mpalace',mimeType:'application/zip',buffer:saved});await page.waitForFunction(()=>archiveContext?.name==='saved.mpalace');
    assert.equal(await page.evaluate(()=>state.panoramas.b.destinations[0].panoId),'a');
    await page.evaluate(()=>openCameraTransitions('a'));await page.locator('#transitionList button').click();await page.locator('#transitionClose').click();
    await page.locator('#abSave').click();const waiting2=page.waitForEvent('download');await page.locator('#saveMpalaceBtn').click();const d2=await waiting2;
    await page.locator('#fileOpen').setInputFiles({name:'deleted.mpalace',mimeType:'application/zip',buffer:fs.readFileSync(await d2.path())});await page.waitForFunction(()=>archiveContext?.name==='deleted.mpalace');
    assert.deepEqual(await page.evaluate(()=>[state.panoramas.a.destinations,state.panoramas.b.destinations]),[[],[]]);
    await page.locator('#modeBtn').click();assert.equal(await page.evaluate(()=>changeCameraTransition('a','b',true)),false);
    assert.deepEqual(errors,[]);
  }finally{await browser.close()}
});
