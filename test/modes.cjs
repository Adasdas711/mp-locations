const {launchBrowser}=require('./support/browser.cjs');
const {test, before, after} = require('node:test');
const assert = require('node:assert/strict');
const {chromium} = require('playwright-core');
const JSZip = require('../vendor/jszip.min.js');
const fs = require('node:fs');
const path = require('node:path');
const base = process.env.PALACE_TEST_URL || 'http://127.0.0.1:8000';
let browser, fixture;
before(async () => {
  browser = await launchBrowser();
  const png = fs.readFileSync(path.join(__dirname,'../icons/icon-192.png'));
  const zip = new JSZip();
  zip.file('palace.json',JSON.stringify({name:'Regression',layout:'plan',levels:[{name:'Floor',floorId:1,w:192,h:192,image:'images/level-1.png',markers:[{x:50,y:50,note:'one'},{x:100,y:70,note:'two'},{x:130,y:140,note:'three'}]}],panoramas:Object.fromEntries(['p1','p2','p3'].map((id,i)=>[id,{mode:'equirect',file:'panoramas/'+id+'.png',floorId:1,room:'Room '+id,navYawOffsetDeg:0,destinations:[{panoId:id==='p1'?'p2':'p1',room:'Exit',angleDeg:0}]}]))}));
  zip.file('images/level-1.png',png);
  for(const id of ['p1','p2','p3'])zip.file('panoramas/'+id+'.png',png);
  fixture = await zip.generateAsync({type:'nodebuffer'});
});
after(async () => {await browser?.close()});
async function session(t, options, delayedThree=false) {
  const context = await browser.newContext({...options,serviceWorkers:'block'});
  t.after(()=>context.close());
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  t.after(()=>assert.deepEqual(errors,[],'No uncaught JavaScript errors'));
  if(delayedThree)await page.route('**/vendor/three.min.js',async route=>{await new Promise(resolve=>setTimeout(resolve,600));await route.continue()});
  await page.goto(base,{waitUntil:'networkidle'});
  await page.locator('#fileOpen').setInputFiles({name:'regression.mpalace',mimeType:'application/zip',buffer:fixture});
  await page.waitForFunction(()=>archiveContext?.name==='regression.mpalace');
  return page;
}
async function assertNavigation(page) {
  try {
    await page.waitForFunction(()=>localViewer.renderer && localViewer.navMeshes.length && [...document.querySelectorAll('#l3dJumps button')].some(b=>getComputedStyle(b).display!=='none'),null,{timeout:10000});
  } catch(error) {
    console.log('Navigation state:',await page.evaluate(()=>({layout:state.layout,active:activeLocalPano,current:localViewer.currentId,renderer:!!localViewer.renderer,nav:localViewer.navMeshes.length,canvas:document.querySelector('#local3dCanvas').getBoundingClientRect().toJSON(),error:document.querySelector('#l3dErrorMsg').textContent,buttons:document.querySelector('#l3dJumps').innerHTML})));
    throw error;
  }
  const bounds=await page.evaluate(()=>{
    const canvas=document.querySelector('#local3dCanvas').getBoundingClientRect();
    return [...document.querySelectorAll('#l3dJumps button')].filter(b=>getComputedStyle(b).display!=='none').map(b=>{const r=b.getBoundingClientRect();return {inside:r.left>=canvas.left-1&&r.right<=canvas.right+1&&r.top>=canvas.top-1&&r.bottom<=canvas.bottom+1,opacity:Number(getComputedStyle(b).opacity),clickable:!!document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)?.closest('#l3dJumps')}});
  });
  assert.ok(bounds.length>0,'At least one destination stays visible');
  assert.ok(bounds.every(b=>b.inside&&b.opacity>=.5&&b.clickable),'Navigation stays within canvas and readable');
}
for(const [label,options] of [['desktop',{viewport:{width:1280,height:800}}],['mobile',{viewport:{width:390,height:844},isMobile:true,hasTouch:true}]]) {
  test(`${label}: header and edit tools switch without leaving empty slots`,async t=>{
    const page=await session(t,options);
    assert.equal(await page.locator('header #abUploadMenu').count(),0);
    await page.locator('#abPlan').click();
    assert.equal(await page.locator('#planTools [data-tool]').count(),3);
    for(const tool of await page.locator('#planTools [data-tool]').all())assert.equal(await tool.isVisible(),true);
    await page.locator('#modeBtn').click();
    assert.equal(await page.evaluate(()=>state.mode),'view');
    for(const tool of await page.locator('#planTools [data-tool],#planTransparentBg,#planTools .edit-tool-sep').all()) {
      assert.equal(await tool.isVisible(),false);
      assert.equal(await tool.evaluate(el=>el.getBoundingClientRect().height),0);
    }
    assert.equal(await page.locator('#zoomIn').isVisible(),true);
    assert.equal(await page.locator('#planView2d').isVisible(),true);
    await page.locator('#modeBtn').click();
    for(const tool of await page.locator('#planTools [data-tool],#planTransparentBg').all())assert.equal(await tool.isVisible(),true);
  });
  test(`${label}: stopping review restores all loci from placing and checked phases`,async t=>{
    const page=await session(t,options);
    await page.locator('#abPlan').click();
    await page.waitForFunction(()=>document.querySelectorAll('#plan .marker').length===3);
    for(const previousMode of ['edit','view'])for(const checked of [false,true]) {
      if(await page.evaluate(()=>state.mode)!==previousMode)await page.locator('#modeBtn').click();
      await page.locator('#reviewBtn').click();
      await page.waitForFunction(()=>reviewSession?.phase==='placing');
      assert.equal(await page.locator('#plan .marker').count(),0);
      if(checked){
        // Place a guess through the canvas, then use the normal Check action.
        const point=await page.evaluate(()=>{
          const box=document.querySelector('#plan').getBoundingClientRect();
          for(const y of [.8,.5,.2])for(const x of [.5,.8,.2]){
            const point={x:box.left+box.width*x,y:box.top+box.height*y};
            const hit=document.elementFromPoint(point.x,point.y);
            if(hit?.closest('#stage')&&!hit.closest('.review-bar,button,input'))return point;
          }
          throw new Error('No unobstructed canvas position for a review guess');
        });
        await page.mouse.click(point.x,point.y);
        await page.locator('#reviewCheck').click();
        await page.waitForFunction(()=>reviewSession?.phase==='checked');
      }
      await page.locator('#reviewStop').click();
      await page.locator('#askYes').click();
      await page.locator('#reviewSummaryClose').click();
      await page.waitForFunction(()=>reviewSession===null&&document.querySelectorAll('#plan .marker').length===3);
      assert.equal(await page.evaluate(()=>state.mode),previousMode);
      assert.equal(await page.locator('#plan .review-guess-layer,#plan .guess-mark,#plan .review-zone-layer').count(),0);
      assert.equal(await page.locator('#reviewBtn').isEnabled(),true);
    }
  });
  test(`${label}: navigation remains visible after rotations, layout switches and resize`,async t=>{
    const page=await session(t,options);
    if(await page.evaluate(()=>state.layout.startsWith('split')))await page.locator('#btnSplit').click();
    await page.locator('#abTour').click();
    await assertNavigation(page);
    for(const yaw of [0,89.999,90,179,180,-540,-1080,1080]) {
      await page.evaluate(y=>{localViewer.yaw=y;localViewer.updateNavLabels()},yaw);
      await assertNavigation(page);
    }
    // Exercise real destination buttons, including when every exit is behind the camera.
    const next=await page.evaluate(()=>localViewer.navMeshes[0].panoId);
    await page.locator('#l3dJumps button:visible').first().click();
    await page.waitForFunction(id=>activeLocalPano===id&&localViewer.currentId===id,next);
    await assertNavigation(page);
    for(let i=0;i<2;i++) {
      await page.locator('#abPlan').click();await page.locator('#abTour').click();await assertNavigation(page);
    }
    if(label==='desktop'){
      await page.locator('#btnSplit').click();await assertNavigation(page);
      await page.locator('#btnSwapPanes').click();await assertNavigation(page);
      await page.locator('#btnSplit').click();
      assert.equal(await page.evaluate(()=>state.layout),'plan');
      await page.locator('#abTour').click();await assertNavigation(page);
    }
    await page.setViewportSize({width:label==='desktop'?900:844,height:label==='desktop'?600:390});
    await page.evaluate(()=>{localViewer.resize();localViewer.updateNavLabels()});
    await assertNavigation(page);
  });
  test(`${label}: delayed Three.js startup cannot replace the most recently selected panorama`,async t=>{
    const page=await session(t,options,true);
    await page.locator('#abTour').click();
    await page.evaluate(()=>{setActiveLocalPano('p2',false);setActiveLocalPano('p3',false)});
    await page.waitForFunction(()=>localViewer.renderer&&localViewer.currentId==='p3');
    await assertNavigation(page);
    assert.equal(await page.evaluate(()=>activeLocalPano),'p3');
    assert.deepEqual(await page.evaluate(()=>localViewer.navMeshes.map(e=>e.panoId)),['p1']);
  });
}
