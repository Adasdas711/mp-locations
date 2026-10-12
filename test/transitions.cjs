const {profiles,openSession}=require('./support/fixtures.cjs');
const {launchBrowser}=require('./support/browser.cjs');
const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs');
const JSZip=require('../vendor/jszip.min.js');
for(const [profile,options]of profiles)test(`${profile}: camera editor selection, links, start, delete, undo and archive`,async t=>{
 const browser=await launchBrowser();t.after(()=>browser.close());
 const {page,context}=await openSession(browser,t,options);
 // The 3D toolbar must enter plan editing, never a transition popup.
 await page.locator('#abTour').click();
 await page.waitForFunction(()=>!!activeLocalPano);
 await page.locator('#tourSettingsBtn').click();
 await page.locator('#cameraTransitionsOpen').click();
 await page.waitForFunction(()=>state.layout==='plan'&&state.tool==='camera'&&cameraLinkSource==='a');
 assert.equal(await page.locator('#cameraTransitions').count(),0);
 await page.locator('#cameraEditorLink').click(); // cancel pending link
 await page.locator('#plan .plan-cam[data-pano="a"]').click();
 assert.equal(await page.locator('#cameraEditorSelect').inputValue(),'a');
 assert.equal(await page.evaluate(()=>state.layout),'plan');
 await page.locator('#plan .plan-cam[data-pano="a"]').click({button:'right'});
 await page.locator('.ctx-item').filter({hasText:'Добавить переход на плане'}).click();
 await page.waitForFunction(()=>cameraLinkSource==='a');
 assert.equal(await page.locator('.modal.show').count(),0);
 await page.locator('#cameraEditorLink').click();
 const old=await page.evaluate(()=>({...state.panoramas.a.planPx}));
 const box=await page.locator('#plan .plan-cam[data-pano="a"]').boundingBox();
 const x=box.x+box.width/2,y=box.y+box.height/2;
 if(options.hasTouch && (process.env.PALACE_BROWSER||'chromium')==='chromium'){
   const session=await context.newCDPSession(page);
   await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:0}]});
   await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+25,y:y-20,id:0}]});
   await page.evaluate(()=>new Promise(requestAnimationFrame));
   await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await session.detach();
 }else {await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+25,y-20,{steps:5});await page.mouse.up()}
 await page.waitForFunction(old=>Math.hypot(state.panoramas.a.planPx.x-old.x,state.panoramas.a.planPx.y-old.y)>3,old);
 await page.keyboard.press('Control+z');await page.waitForFunction(old=>state.panoramas.a.planPx.x===old.x&&state.panoramas.a.planPx.y===old.y,old);
 // Select through the accessible list after undo; no panorama navigation.
 await page.locator('#cameraEditorSelect').selectOption('a');

 await page.locator('#cameraEditorLinks button[data-target="b"]').click();
 assert.deepEqual(await page.evaluate(()=>[state.panoramas.a.destinations,state.panoramas.b.destinations]),[[],[]]);
 await page.locator('#cameraEditorLink').click();
 await page.locator('#plan .plan-cam[data-pano="b"]').click();
 assert.deepEqual(await page.evaluate(()=>[state.panoramas.a.destinations.map(d=>d.panoId),state.panoramas.b.destinations.map(d=>d.panoId)]),[['b'],['a']]);
 assert.equal(await page.locator('#plan .camera-link-lines line').count(),1);
 await page.locator('#cameraEditorStart').click();
 assert.equal(await page.evaluate(()=>state.startPano),'a');
 await page.locator('#cameraEditorDelete').click();await page.locator('#askNo').click();
 assert.equal(await page.evaluate(()=>!!state.panoramas.a),true);
 await page.locator('#cameraEditorDelete').click();await page.locator('#askYes').click();
 assert.deepEqual(await page.evaluate(()=>[!!state.panoramas.a,state.startPano,state.panoramas.b.destinations.length,state.levels[0].markers[0].localPano||null]),[false,null,0,null]);
 await page.keyboard.press('Control+z');
 await page.waitForFunction(()=>!!state.panoramas.a&&state.startPano==='a');
 assert.equal(await page.evaluate(()=>state.levels[0].markers[0].localPano),'a');
 assert.equal(await page.evaluate(()=>state.panoramas.b.destinations[0].panoId),'a');
 await page.keyboard.press('Control+Shift+z');await page.waitForFunction(()=>!state.panoramas.a);
 await page.keyboard.press('Control+z');await page.waitForFunction(()=>!!state.panoramas.a&&state.startPano==='a');
 await page.locator('#abSave').click();const waiting=page.waitForEvent('download');await page.locator('#saveMpalaceBtn').click();const download=await waiting;
 const saved=fs.readFileSync(await download.path());const zip=await JSZip.loadAsync(saved);const data=JSON.parse(await zip.file('palace.json').async('string'));
 assert.equal(data.startPano,'a');assert.equal(data.panoramas.b.destinations[0].panoId,'a');
 await page.locator('#fileOpen').setInputFiles({name:'saved.mpalace',mimeType:'application/zip',buffer:saved});await page.waitForFunction(()=>archiveContext?.name==='saved.mpalace');
 assert.equal(await page.evaluate(()=>state.panoramas.b.destinations[0].panoId),'a');
 await page.locator('#modeBtn').click();await page.waitForFunction(()=>state.mode==='view');
 assert.equal(await page.locator('#cameraEditor').isVisible(),false);
 assert.equal(await page.evaluate(()=>removeEditedCamera('a')),false);
 assert.equal(await page.evaluate(()=>changeCameraTransition('a','b',false)),false);
});
