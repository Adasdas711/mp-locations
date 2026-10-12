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
  let mutations=0;const observer=new MutationObserver(records=>mutations+=records.length);observer.observe(plan,{childList:true,attributes:true,subtree:true});
  const start=performance.now();for(let i=0;i<120;i++)applyZoom(i%2?2:1.5);const duration=performance.now()-start;
  applyZoom(1);await new Promise(requestAnimationFrame);observer.disconnect();
  return {mutations,duration,buttonsRetained:buttons.every(button=>button.isConnected),graphRetained:graph===plan.querySelector('.camera-link-lines'),lines:graph.childElementCount};
 });
 assert.equal(result.mutations,0,'Zoom must not mutate the camera DOM, styles or graph');assert.equal(result.buttonsRetained,true);assert.equal(result.graphRetained,true);assert.equal(result.lines,200);
 t.diagnostic(`120 zoom updates with 200 cameras: ${result.duration.toFixed(1)} ms`);
 const proportions=await page.evaluate(()=>{
  const marker=document.querySelector('[data-pano="cam1"]'),button=marker.querySelector('.camera-action');
  const measure=()=>({marker:marker.getBoundingClientRect().width,button:button.getBoundingClientRect().width,font:parseFloat(getComputedStyle(button).fontSize)});
  applyZoom(2);const large=measure();applyZoom(1);const small=measure();
  state.markerSize=90;drawPlan();const resized=document.querySelector('[data-pano="cam1"]'),resizedButton=resized.querySelector('.camera-action');
  return {large,small,resized:{marker:resized.getBoundingClientRect().width,button:resizedButton.getBoundingClientRect().width,font:parseFloat(getComputedStyle(resizedButton).fontSize)}};
 });
 assert.ok(Math.abs(proportions.large.button/proportions.small.button-2)<.02,'Badge scales with the plan');
 assert.ok(Math.abs(proportions.large.marker/proportions.small.marker-2)<.02);
 for(const dimensions of Object.values(proportions))assert.ok(Math.abs(dimensions.button/dimensions.marker-.34)<.02,'Badge-to-marker ratio stays fixed');
 assert.ok(proportions.resized.font>proportions.small.font,'Symbol size follows marker size');
 const graph=await page.locator('.camera-link-lines').elementHandle(),before=await page.evaluate(()=>state.zoom);
 await page.locator('#zoomOut').click();await page.waitForFunction(old=>state.zoom<old,before);
 assert.equal(await graph.evaluate(el=>el===document.querySelector('.camera-link-lines')),true);
 await page.evaluate(()=>selectCameraForEditing('cam1'));
 assert.equal(await page.locator('[data-pano="cam1"] #cameraEditorDelete').count(),1);
 assert.equal(await page.locator('[data-pano="cam0"] [data-action="remove-link"]').count(),1);
});
