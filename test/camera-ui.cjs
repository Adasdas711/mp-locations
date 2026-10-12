const {test,before,after}=require('node:test'),assert=require('node:assert/strict');
const {profiles,openSession}=require('./support/fixtures.cjs'),{launchBrowser}=require('./support/browser.cjs');let browser;
before(async()=>browser=await launchBrowser());after(async()=>browser?.close());
for(const [name,options]of profiles)test(`${name}: marker controls, full dashed graph, selection and floor filtering`,async t=>{
 const {page}=await openSession(browser,t,options);
 await page.locator('[data-tool="camera"]').click();
 assert.equal(await page.locator('.camera-link-lines line').count(),1,'Each bidirectional transition is drawn once, before selecting a camera');
 await page.evaluate(()=>{
  for(let i=0;i<12;i++){const id='extra'+i;state.panoramas[id]={...state.panoramas.b,room:"Очень длинное название комнаты "+i,floorId:1,planPx:{x:10+(i%4)*45,y:15+Math.floor(i/4)*55},destinations:[{panoId:'a'}]};state.panoramas.a.destinations.push({panoId:id})}
  state.panoramas.b.destinations.push({panoId:'extra0'});state.panoramas.extra0.destinations.push({panoId:'b'});
  state.panoramas.upstairs={...state.panoramas.b,room:"Другой этаж",floorId:2,planPx:{x:50,y:50},destinations:[{panoId:'a'}]};
  state.panoramas.a.destinations.push({panoId:'upstairs'},{panoId:'missing'});drawPlan();resetHistory();
 });
 await page.evaluate(()=>selectCameraForEditing('a'));
 assert.equal(await page.locator('.camera-link-lines line').count(),14);
 assert.equal(await page.locator('.camera-link-lines line.selected').count(),13,'Other cameras’ connections are visible without selection');
 assert.equal(await page.locator('.camera-link-lines line[data-to="upstairs"]').count(),0);
 assert.equal(await page.locator('.camera-link-lines line[data-to="missing"]').count(),0);
 assert.equal(await page.locator('#cameraEditor').count(),0);
 assert.equal(await page.locator('.camera-edit-selected .camera-action').count(),2);
 assert.equal(await page.locator('.camera-edit-connected .camera-action[data-action="remove-link"]').count(),13);
 const dash=await page.locator('.camera-link-lines line').first().evaluate(el=>({dash:getComputedStyle(el).strokeDasharray,pointer:getComputedStyle(el.parentElement).pointerEvents,z:getComputedStyle(el.parentElement).zIndex}));
 assert.notEqual(dash.dash,'none');assert.equal(dash.pointer,'none');assert.equal(dash.z,'1');
 await page.evaluate(()=>{changeCameraTransition('a','b',false)});
 await page.keyboard.press('Control+z');assert.equal(await page.locator('.camera-link-lines line').count(),14);
 await page.locator('#floorOverlay button[data-li="1"]').click();assert.equal(await page.locator('.camera-link-lines line').count(),0);
 await page.locator('#floorOverlay button[data-li="0"]').click();await page.evaluate(()=>selectCameraForEditing('b'));assert.equal(await page.evaluate(()=>editedCameraId),'b');
 await page.locator('[data-tool="select"]').click();assert.equal(await page.locator('#plan .camera-action').count(),0);assert.equal(await page.locator('.camera-edit-selected,.camera-edit-connected').count(),0);

});

test('connection follows camera during a drag and stays below clickable camera markers',async t=>{
 const {page}=await openSession(browser,t,profiles.find(([name])=>name==='desktop')?.[1]||{viewport:{width:1280,height:900}});
 await page.locator('[data-tool="camera"]').click();
 const camera=page.locator('#plan .plan-cam[data-pano="a"]'),box=await camera.boundingBox();
 const original=await page.locator('.camera-link-lines line').getAttribute('x1');
 await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+30,box.y+box.height/2+12,{steps:5});
 await page.waitForFunction(old=>document.querySelector('.camera-link-lines line').getAttribute('x1')!==old,original);
 const coordinates=await camera.evaluate(el=>({x:parseFloat(el.style.left),line:Number(document.querySelector('.camera-link-lines line').getAttribute('x1'))}));assert.equal(coordinates.x,coordinates.line);
 await page.mouse.up();await page.waitForFunction(()=>Number(document.querySelector('.camera-link-lines line').getAttribute('x1'))===state.panoramas.a.planPx.x);
});
