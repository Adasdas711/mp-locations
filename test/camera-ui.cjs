const {test,before,after}=require('node:test'),assert=require('node:assert/strict');
const {profiles,openSession}=require('./support/fixtures.cjs'),{launchBrowser}=require('./support/browser.cjs');let browser;
before(async()=>browser=await launchBrowser());after(async()=>browser?.close());
for(const [name,options]of profiles)test(`${name}: compact camera panel, full dashed graph, selection, collapse and floor filtering`,async t=>{
 const {page}=await openSession(browser,t,options);
 await page.locator('[data-tool="camera"]').click();
 assert.equal(await page.locator('.camera-link-lines line').count(),1,'Each bidirectional transition is drawn once, before selecting a camera');
 await page.evaluate(()=>{
  for(let i=0;i<12;i++){const id='extra'+i;state.panoramas[id]={...state.panoramas.b,room:'Очень длинное название комнаты '+i,floorId:1,planPx:{x:10+(i%4)*45,y:15+Math.floor(i/4)*55},destinations:[{panoId:'a'}]};state.panoramas.a.destinations.push({panoId:id})}
  state.panoramas.b.destinations.push({panoId:'extra0'});state.panoramas.extra0.destinations.push({panoId:'b'});
  state.panoramas.upstairs={...state.panoramas.b,room:'Другой этаж',floorId:2,planPx:{x:50,y:50},destinations:[{panoId:'a'}]};
  state.panoramas.a.destinations.push({panoId:'upstairs'},{panoId:'missing'});drawPlan();resetHistory();
 });
 await page.locator('#cameraEditorSelect').selectOption('a');
 assert.equal(await page.locator('.camera-link-lines line').count(),14);
 assert.equal(await page.locator('.camera-link-lines line.selected').count(),13,'Other cameras’ connections are visible without selection');
 assert.equal(await page.locator('.camera-link-lines line[data-to="upstairs"]').count(),0);
 assert.equal(await page.locator('.camera-link-lines line[data-to="missing"]').count(),0);
 if(!await page.locator('#cameraEditorConnections').evaluate(el=>el.open))await page.locator('#cameraEditorConnections summary').click();
 const layout=await page.locator('#cameraEditor').evaluate(el=>{const panel=el.getBoundingClientRect(),stage=document.querySelector('#stage').getBoundingClientRect(),links=document.querySelector('#cameraEditorLinks');return {width:panel.width,height:panel.height,stageWidth:stage.width,stageHeight:stage.height,within:panel.left>=stage.left&&panel.right<=stage.right&&panel.top>=stage.top&&panel.bottom<=stage.bottom,direction:getComputedStyle(el).flexDirection,scroll:links.scrollHeight>links.clientHeight,overflow:el.scrollWidth>el.clientWidth}});
 assert.equal(layout.direction,'column');assert.equal(layout.within,true);assert.equal(layout.overflow,false);assert.equal(layout.scroll,true);assert.ok(layout.width<=Math.min(400,layout.stageWidth));assert.ok(layout.height<layout.stageHeight*.55);
 const dash=await page.locator('.camera-link-lines line').first().evaluate(el=>({dash:getComputedStyle(el).strokeDasharray,pointer:getComputedStyle(el.parentElement).pointerEvents,z:getComputedStyle(el.parentElement).zIndex}));
 assert.notEqual(dash.dash,'none');assert.equal(dash.pointer,'none');assert.equal(dash.z,'1');
 await page.locator('#cameraEditorCollapse').click();assert.equal(await page.locator('#cameraEditorContent').isVisible(),false);assert.equal(await page.locator('#cameraEditorCollapse').getAttribute('aria-expanded'),'false');assert.equal(await page.locator('#cameraEditorCollapse').getAttribute('aria-label'),'Развернуть панель');
 await page.locator('#cameraEditorCollapse').click();assert.equal(await page.locator('#cameraEditorContent').isVisible(),true);
 await page.locator('#cameraEditorLink').click();await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>cameraLinkSource),null);
 await page.locator('#cameraEditorConnections summary').click();assert.equal(await page.locator('#cameraEditorLinks').isVisible(),false);await page.locator('#cameraEditorConnections summary').click();
 await page.locator('#cameraEditorLinks button[data-target="b"]').click();assert.equal(await page.locator('.camera-link-lines line').count(),13);
 await page.keyboard.press('Control+z');assert.equal(await page.locator('.camera-link-lines line').count(),14);
 await page.locator('#floorOverlay button[data-li="1"]').click();assert.equal(await page.locator('.camera-link-lines line').count(),0);
 await page.locator('#cameraEditorClose').click();assert.equal(await page.locator('#cameraEditor').isVisible(),false);assert.equal(await page.evaluate(()=>state.tool),'select');
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
