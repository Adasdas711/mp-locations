/* Opt-in real archive checks. Private panoramas stay outside the repository. */
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {profiles,openSession,pressAt}=require('./support/fixtures.cjs'),{launchBrowser}=require('./support/browser.cjs');
const archiveRoot=process.env.PALACE_REAL_ARCHIVES_DIR;
function archives(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?archives(path.join(dir,e.name)):e.name.endsWith('.3dview')?[path.join(dir,e.name)]:[])}
const files=archiveRoot?archives(archiveRoot):[];
let browser;before(async()=>{if(files.length)browser=await launchBrowser()});after(async()=>browser?.close());
if(!files.length)test('Real private archive regression requires PALACE_REAL_ARCHIVES_DIR',{skip:'No private archives configured'},()=>{});
for(const file of files)for(const[name,options]of profiles)test(`${name}: real archive ${path.basename(file)} calibration, rapid matching and persistence`,{timeout:180000},async t=>{
 const {page}=await openSession(browser,t,options,{empty:true});page.setDefaultTimeout(30000);
 await page.locator('#fileOpen').setInputFiles(file);await page.waitForFunction(name=>archiveContext?.name===name,path.basename(file),{timeout:60000});
 const available=await page.evaluate(()=>Object.entries(state.panoramas).filter(([,p])=>p.mode==='equirect'&&p.data).map(([id,p])=>({id,order:p.order,room:p.room,neighbors:p.destinations.map(d=>d.panoId||d.id||d.to)})));assert.ok(available.length>=24);
 await page.locator('.activity #calibrationTool').click();
 async function ready(){await page.waitForFunction(()=>['left','right'].every(side=>calibrationUI.views[side]?.readyId===calibrationUIState()[side]&&calibrationUI.views[side]?.texture),null,{timeout:45000})}
 await ready();assert.equal(await page.locator('#planTools').isVisible(),false);assert.equal(await page.locator('#calibrationEmpty').isVisible(),false);
 const layout=await page.locator('.calibration-viewport').evaluateAll(els=>els.map(el=>{const r=el.getBoundingClientRect(),workspace=el.closest('#calibrationWorkspace').getBoundingClientRect();return {h:r.height,top:r.top,bottom:r.bottom,workspaceBottom:workspace.bottom}}));assert.ok(layout.every(r=>r.h>=85&&r.bottom<r.workspaceBottom),JSON.stringify(layout));
 const labels=await page.locator('#calibration-left-picker option').allTextContents();assert.equal(labels.length,available.length);assert.equal(new Set(labels).size,labels.length);const initial=await page.evaluate(()=>[calibrationUIState().left,calibrationUIState().right]);assert.ok(available.find(p=>p.id===initial[0]).neighbors.includes(initial[1]),'Default pair must be linked in the tour');
 // Queue two real pointer taps while the first SDK mutation is intentionally delayed.
 await page.evaluate(()=>{const original=calibrationAddLandmark;window.realAddLandmark=original;calibrationAddLandmark=async(...args)=>{await new Promise(r=>setTimeout(r,160));return original(...args)}});
 for(const side of ['left','right']){const point=await page.locator('#calibration-'+side+'-canvas').evaluate(el=>{const r=el.getBoundingClientRect();return {x:r.left+r.width*.54,y:r.top+r.height*.53}});await pressAt(page,options,point.x,point.y)}
 await page.waitForFunction(()=>calibrationUI.session?.landmarks[0]?.observations.length===2&&!calibrationUI.busy);await page.evaluate(()=>calibrationAddLandmark=window.realAddLandmark);
 assert.equal(await page.evaluate(()=>calibrationUI.session.landmarks.length),1);await page.locator('#calibrationVisibility').check();await page.waitForFunction(()=>calibrationUI.session.landmarks[0].observations.every(o=>o.verified));assert.equal(await page.locator('#calibrationApply').isDisabled(),true);
 const original=await page.evaluate(()=>structuredClone(calibrationUI.session.landmarks[0])),sample=available.filter(p=>p.id!==initial[0]);
 // Desktop decodes every supplied panorama. Mobile repeats camera changes with the real AVIF textures.
 for(const pano of (name==='desktop'?sample:sample.slice(0,3))){await page.locator('#calibration-right-picker').selectOption(pano.id);await ready();assert.ok(await page.evaluate(()=>['left','right'].every(side=>calibrationUI.views[side].texture.image.width>=512)));}
 await page.locator('#calibration-right-picker').selectOption(initial[1]);await ready();
 await page.locator('#calibration-left-fov').evaluate(el=>{el.value='110';el.dispatchEvent(new Event('input',{bubbles:true}))});await page.waitForFunction(()=>calibrationUI.views.left.fov===110);assert.deepEqual(await page.evaluate(()=>calibrationUI.session.landmarks[0]),original);
 await page.screenshot({path:'/tmp/calibration-real-'+available.length+'-'+name+'.png'});
 const group=await page.evaluate(()=>calibrationUIState().sessionId);
 await page.locator('#calibrationNoOverlap').click();await page.waitForFunction(group=>calibrationUIState().sessionId!==group&&!calibrationUI.busy,group);assert.equal(await page.evaluate(()=>calibrationUI.session.landmarks.length),0);assert.deepEqual(await page.evaluate(group=>calibrationSessions()[group].landmarks[0],group),original);
 await page.locator('#calibrationDetails summary').click();await page.locator('#calibrationSession').selectOption(group);await page.waitForFunction(group=>calibrationUIState().sessionId===group&&!calibrationUI.busy,group);await page.locator('#calibrationDetails summary').click();await ready();assert.deepEqual(await page.evaluate(()=>[calibrationUIState().left,calibrationUIState().right]),initial);
 const ui=await page.evaluate(()=>calibrationUICapture());await page.locator('.activity #calibrationTool').click();assert.equal(await page.locator('#calibrationWorkspace').isVisible(),false);await page.locator('.activity #calibrationTool').click();await ready();assert.deepEqual(await page.evaluate(()=>calibrationUI.session.landmarks[0]),original);assert.equal(await page.evaluate(()=>calibrationUIState().left),ui.left);
 const serialized=await page.evaluate(()=>buildSerializableState());assert.equal(serialized.calibrationUI.sessionId,ui.sessionId);assert.deepEqual(Object.values(serialized.calibrationSessions)[0].landmarks[0],original);
 await page.locator('#abPlan').click();assert.equal(await page.locator('#calibrationWorkspace').isVisible(),false);assert.equal(await page.evaluate(()=>calibrationSystemObservers.size),0);
});
