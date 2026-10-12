const {test,before,after}=require('node:test'),assert=require('node:assert/strict');
const {profiles,openSession}=require('./support/fixtures.cjs'),{launchBrowser}=require('./support/browser.cjs');let browser;
before(async()=>browser=await launchBrowser());after(async()=>browser?.close());
for(const [name,options]of profiles)test(`${name}: zoom on 200 cameras retains controls and graph without DOM rebuilds`,async t=>{
 const {page}=await openSession(browser,t,options);
 await page.locator('[data-tool="camera"]').click();
 await page.evaluate(()=>{
  const template=state.panoramas.a;state.panoramas={};
  for(let i=0;i<200;i++)state.panoramas['cam'+i]={...template,room:'Camera '+i,planPx:{x:10+i%20*8,y:10+Math.floor(i/20)*16},destinations:[{panoId:'cam'+(i+1)%200}]};
  drawPlan();selectCameraForEditing('cam0');applyZoom(2);
 });
 const result=await page.evaluate(async()=>{
  const plan=document.querySelector('#plan'),buttons=[...plan.querySelectorAll('.camera-action')],graph=plan.querySelector('.camera-link-lines');
  let mutations=0;const observer=new MutationObserver(records=>mutations+=records.length);observer.observe(plan,{childList:true,subtree:true});
  const start=performance.now();for(let i=0;i<120;i++)applyZoom(i%2?2:1.5);const duration=performance.now()-start;
  applyZoom(1);await new Promise(requestAnimationFrame);observer.disconnect();
  return {mutations,duration,buttonsRetained:buttons.every(button=>button.isConnected),graphRetained:graph===plan.querySelector('.camera-link-lines'),lines:graph.childElementCount,scale:getComputedStyle(plan).getPropertyValue('--camera-action-scale').trim(),zoom:state.zoom};
 });
 assert.equal(result.mutations,0,'Zoom must not rebuild buttons or graph');assert.equal(result.buttonsRetained,true);assert.equal(result.graphRetained,true);assert.equal(result.lines,200);assert.equal(Number(result.scale),1/result.zoom);
 t.diagnostic(`120 zoom updates with 200 cameras: ${result.duration.toFixed(1)} ms`);
 await page.evaluate(()=>selectCameraForEditing('cam1'));
 assert.equal(await page.locator('[data-pano="cam1"] #cameraEditorDelete').count(),1);
 assert.equal(await page.locator('[data-pano="cam0"] [data-action="remove-link"]').count(),1);
});
