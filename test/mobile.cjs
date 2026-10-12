const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const {launchBrowser}=require('./support/browser.cjs');
const {profiles,openSession,point}=require('./support/fixtures.cjs');
let browser;before(async()=>{browser=await launchBrowser()});after(async()=>{await browser?.close()});
async function touchGesture(context,page,points){
 if((process.env.PALACE_BROWSER||'chromium')==='chromium'){
  const session=await context.newCDPSession(page);
  for(const step of points){await session.send('Input.dispatchTouchEvent',{...step,touchPoints:step.touchPoints.map(p=>({...p,id:p.id-1}))});if(step.type==='touchMove')await page.evaluate(()=>new Promise(requestAnimationFrame))}
  await session.detach();
 }else{
  // WebKit lacks CDP: deliver the same pointer sequence through its browser event system.
  await page.evaluate(steps=>{for(const step of steps){for(const p of step.touchPoints){const target=document.elementFromPoint(p.x,p.y);target?.dispatchEvent(new PointerEvent(step.type==='touchStart'?'pointerdown':'pointermove',{pointerType:'touch',pointerId:p.id,clientX:p.x,clientY:p.y,button:0,buttons:1,bubbles:true}))}if(step.type==='touchEnd')for(const id of [1,2])document.querySelector('#stage').dispatchEvent(new PointerEvent('pointerup',{pointerType:'touch',pointerId:id,button:0,bubbles:true}))}},points);
 }
}
for(const [name,options]of profiles.filter(([,options])=>options.hasTouch)){
 test(`${name}: native taps create/select loci, pinch zoom and orientation preserve content`,async t=>{
  const {page,context}=await openSession(browser,t,options);
  await page.locator('[data-tool="marker"]').tap();const p=await point(page,.85,.2);await page.touchscreen.tap(p.x,p.y);await page.waitForFunction(()=>level().markers.length===3);
  await page.locator('[data-tool="select"]').tap();await page.locator('#plan .marker').last().tap();assert.equal(await page.evaluate(()=>level().selected),2);
  const center=await point(page,.6,.5),zoom=await page.evaluate(()=>state.zoom);
  await touchGesture(context,page,[{type:'touchStart',touchPoints:[{id:1,x:center.x-18,y:center.y},{id:2,x:center.x+18,y:center.y}]},{type:'touchMove',touchPoints:[{id:1,x:center.x-38,y:center.y},{id:2,x:center.x+38,y:center.y}]},{type:'touchEnd',touchPoints:[]}]);
  await page.waitForFunction(z=>state.zoom>z,zoom);
  const count=await page.evaluate(()=>level().markers.length);
  await page.setViewportSize({width:options.viewport.height,height:options.viewport.width});await page.waitForFunction(()=>innerWidth>innerHeight);
  assert.equal(await page.evaluate(()=>level().markers.length),count);
  await page.locator('#abSave').tap();assert.equal(await page.locator('#saveModal').evaluate(el=>el.classList.contains('show')),true);
 });
 test(`${name}: touch dragging moves a marker and 3D panorama without accidental edits`,async t=>{
  const {page,context}=await openSession(browser,t,options);
  const marker=page.locator('#plan .marker').first(),box=await marker.boundingBox(),old=await page.evaluate(()=>({...level().markers[0]}));
  await touchGesture(context,page,[{type:'touchStart',touchPoints:[{id:1,x:box.x+box.width/2,y:box.y+box.height/2}]},{type:'touchMove',touchPoints:[{id:1,x:box.x+box.width/2+35,y:box.y+box.height/2+20}]},{type:'touchEnd',touchPoints:[]}]);
  assert.ok(await page.evaluate(old=>Math.hypot(level().markers[0].x-old.x,level().markers[0].y-old.y)>5,old));
  await page.locator('#abTour').tap();try{await page.waitForFunction(()=>!!localViewer.renderer)}catch(error){console.log('Mobile 3D state',await page.evaluate(()=>({layout:state.layout,active:activeLocalPano,error:document.querySelector('#l3dErrorMsg').textContent,modal:document.querySelector('.modal.show')?.id,panoramas:Object.keys(state.panoramas)})));throw error;}
  const canvas=await page.locator('#local3dCanvas').boundingBox(),yaw=await page.evaluate(()=>localViewer.yaw);
  await touchGesture(context,page,[{type:'touchStart',touchPoints:[{id:1,x:canvas.x+canvas.width*.65,y:canvas.y+canvas.height*.4}]},{type:'touchMove',touchPoints:[{id:1,x:canvas.x+canvas.width*.65+45,y:canvas.y+canvas.height*.4}]},{type:'touchEnd',touchPoints:[]}]);
  assert.notEqual(await page.evaluate(()=>localViewer.yaw),yaw);assert.equal(await page.evaluate(()=>state.levels.reduce((n,l)=>n+l.markers.length,0)),4);
 });
}
