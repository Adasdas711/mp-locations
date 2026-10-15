/* Replay landmarks selected by hand in the supplied real photographs. No synthetic observations are injected. */
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {profiles,openSession,pressAt}=require('./support/fixtures.cjs'),{launchBrowser}=require('./support/browser.cjs');
const cases=require('./support/manual-calibration-cases.json');
const root=process.env.PALACE_REAL_ARCHIVES_DIR;
const scan=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?scan(path.join(dir,e.name)):e.name.endsWith('.3dview')?[path.join(dir,e.name)]:[]);
const files=root?scan(root):[];let browser;before(async()=>{if(files.length)browser=await launchBrowser()});after(async()=>browser?.close());
if(!files.length)test('Manual photographic calibration requires the supplied private archives',{skip:'Set PALACE_REAL_ARCHIVES_DIR'},()=>{});
for(const scenario of cases){const file=files.find(f=>path.basename(f).includes(scenario.panoramaCount+'panoramas'));if(!file)continue;
 for(const[name,options]of profiles)test(`${name}: hand-selected ${scenario.panoramaCount}-panorama ${scenario.features[0].label} four-point solve, preview, apply and reopen`,{timeout:120000},async t=>{
  const {page}=await openSession(browser,t,options,{empty:true});page.setDefaultTimeout(30000);
  // Rendering/calculation must work without downloading a separate worker script.
  await page.route('**/calibration-worker.js',route=>route.abort());
  await page.locator('#fileOpen').setInputFiles(file);await page.waitForFunction(n=>archiveContext?.name===n,path.basename(file));await page.locator('.activity #calibrationTool').click();
  for(const[side,index]of [['left',0],['right',1]])await page.locator('#calibration-'+side+'-picker').selectOption(scenario.cameraIds[index]);
  await page.waitForFunction(()=>['left','right'].every(s=>calibrationUI.views[s]?.readyId===calibrationUIState()[s]));
  assert.equal(await page.evaluate(()=>calibrationUI.session.config.minCorrespondences),4);
  for(const[ordinal,feature]of scenario.features.entries()){
   if(ordinal)await page.locator('#calibrationNewPoint').click();
   for(const[side,index]of [['left',0],['right',1]]){
    const observation=feature.observations.find(o=>o.panoId===scenario.cameraIds[index]);
    await page.evaluate(({side,observation})=>calibrationUI.views[side].setView({yaw:observation.yaw,pitch:observation.pitch,fov:75}),{side,observation});await page.waitForFunction(()=>['left','right'].every(s=>!calibrationUI.views[s].raf));
    const rect=await page.locator('#calibration-'+side+'-canvas').boundingBox();await pressAt(page,options,rect.x+rect.width/2,rect.y+rect.height/2);
    await page.waitForFunction(count=>calibrationUI.session.landmarks.reduce((n,l)=>n+l.observations.length,0)===count,ordinal*2+(index+1));
   }
   if(ordinal<3)assert.equal(await page.locator('#calibrationApply').isDisabled(),true);
  }
  await page.waitForFunction(()=>calibrationUI.session.status==='solved'&&!calibrationUI.session.pending,null,{timeout:30000});
  const result=await page.evaluate(()=>structuredClone(calibrationUI.session));assert.equal(result.landmarks.length,4);assert.equal(result.quality.verifiedCorrespondences,4);assert.equal(result.quality.unregisteredCameraIds.length,0);assert.ok(result.quality.meanAngularErrorDeg<.3);assert.equal(result.quality.metricScale.known,false);assert.equal(await page.locator('#calibrationApply').isDisabled(),false);
  for(const[i,point]of result.landmarks.entries())for(const o of point.observations){const expected=scenario.features[i].observations.find(other=>other.panoId===o.panoId);assert.ok(Math.abs(o.yaw-expected.yaw)<1e-6);assert.ok(Math.abs(o.pitch-expected.pitch)<1e-6);assert.equal(o.verified,true)}
  const original=await page.evaluate(()=>structuredClone(worldData()));await page.locator('#calibrationPreview').click();await page.waitForFunction(()=>!!calibrationUI.spatial);assert.deepEqual(await page.evaluate(()=>worldData()),original);await page.screenshot({path:`/tmp/hand-calibration-${scenario.panoramaCount}-${name}.png`});
  await page.locator('#calibrationApply').click();await page.locator('#askYes').click();await page.waitForFunction(()=>!!calibrationUI.session.applied&&!calibrationUI.busy);assert.deepEqual((await page.evaluate(()=>Object.keys(worldData().cameras))).sort(),[...scenario.cameraIds].sort());assert.deepEqual(await page.evaluate(()=>worldData().objects),original.objects);
  await page.locator('#calibrationRevert').click();await page.waitForFunction(()=>!calibrationUI.session.applied&&!calibrationUI.busy);assert.deepEqual(await page.evaluate(()=>worldData()),original);
  await page.locator('#calibrationApply').click();await page.locator('#askYes').click();await page.waitForFunction(()=>!!calibrationUI.session.applied&&!calibrationUI.busy);
  if(name==='desktop'){
   const download=page.waitForEvent('download');await page.locator('#abSave').click();await page.locator('#saveMpalaceBtn').click();const item=await download,filePath=await item.path();await page.locator('#calibrationClose').click();await page.locator('#fileOpen').setInputFiles(filePath);await page.waitForFunction(name=>archiveContext?.name===name&&!calibrationUI.importing&&!calibrationUI.open,path.basename(filePath));await page.locator('#calibrationTool').click();await page.waitForFunction(()=>calibrationUI.open&&calibrationUI.session?.landmarks.length===4&&!calibrationUI.busy&&['left','right'].every(s=>calibrationUI.views[s]?.readyId===calibrationUIState()[s]));assert.equal(await page.evaluate(()=>calibrationUI.session.status),'solved');assert.equal(await page.evaluate(()=>!!calibrationUI.session.applied),true);
  }else{await page.locator('#calibrationClose').click();await page.locator('#calibrationTool').click();await page.waitForFunction(()=>calibrationUI.session?.landmarks.length===4);assert.equal(await page.evaluate(()=>calibrationUI.session.status),'solved')}
 });
}
// Golden image coordinates were collected by hand after inspecting the actual
// proposed artwork details and frame corners. Only right-side pointer taps create these matches.
const guided=require('./support/guided-photographic-case.json'),guidedFile=files.find(f=>path.basename(f).includes(guided.panoramaCount+'panoramas'));
const M=require('../calibration-math.js'),math=M.math,frameCorners=cases.find(c=>c.panoramaCount===36).features,rows=[];
for(const p of frameCorners){const a=M.ray(p.observations[0].yaw,p.observations[0].pitch),b=M.ray(p.observations[1].yaw,p.observations[1].pitch);rows.push([...a.map(v=>b[1]*v),...a.map(v=>-b[0]*v),0,0,0],[0,0,0,...a.map(v=>b[2]*v),...a.map(v=>-b[1]*v)],[...a.map(v=>b[2]*v),0,0,0,...a.map(v=>-b[0]*v)])}
const h=M.eigen(math.mm(math.transpose(rows),rows))[0].vector,H=[h.slice(0,3),h.slice(3,6),h.slice(6)],frameRays=frameCorners.map(p=>M.ray(p.observations[0].yaw,p.observations[0].pitch)),targetRay=M.ray(frameCorners[0].observations[1].yaw,frameCorners[0].observations[1].pitch),sign=math.dot(math.mv(H,frameRays[0]),targetRay)>0?1:-1,frameCenter=math.unit(frameRays.reduce((sum,p)=>math.add(sum,p),[0,0,0]));

if(guidedFile)for(const[name,options]of profiles)test(`${name}: four automatic reference points in real photographs solve using only connecting-view taps`,{timeout:120000},async t=>{
 const {page}=await openSession(browser,t,options,{empty:true});page.setDefaultTimeout(30000);
 await page.locator('#fileOpen').setInputFiles(guidedFile);await page.waitForFunction(()=>archiveContext&&!calibrationUI.importing);await page.locator('#calibrationTool').click();
 for(const[side,i]of [['left',0],['right',1]])await page.locator('#calibration-'+side+'-picker').selectOption(guided.cameraIds[i]);
 await page.waitForFunction(()=>['left','right'].every(s=>calibrationUI.views[s]?.readyId===calibrationUIState()[s]));
 await page.evaluate(views=>{for(const side of ['left','right'])calibrationUI.views[side].setView(views[side])},guided.views);
 // The previous job must settle before requesting an analysis at these views.
 await page.locator('#calibrationSuggest').click();await page.waitForFunction(()=>calibrationUI.suggestions.completed&&calibrationUI.suggestions.points.length===4,null,{timeout:45000});
 assert.equal(await page.evaluate(()=>calibrationUI.session.landmarks.length),0);const used=new Set();
 for(let i=0;i<4;i++){
  const source=await page.evaluate(()=>calibrationUICurrentSuggestion()),ray=M.ray(source.yaw,source.pitch);
  for(let edge=0;edge<4;edge++){const normal=math.unit(math.cross(frameRays[edge],frameRays[(edge+1)%4])),side=math.dot(normal,frameCenter)>0?1:-1;assert.ok(math.dot(normal,ray)*side>-.01,'Automatically selected details stay on the shared picture plane')}
  assert.equal(used.has(source.id),false);used.add(source.id);
  // Independently project a real feature on the measured planar picture. This
  // handles AVIF decode/feature differences between desktop and mobile without
  // requiring a fixed corner ordering or trusting the detector's target hint.
  const target=M.angles(math.mul(math.mv(H,ray),sign));await page.evaluate(p=>calibrationUI.views.right.setView({...p,fov:34}),target);await page.waitForFunction(()=>!calibrationUI.views.right.raf);const box=await page.locator('#calibration-right-canvas').boundingBox();await pressAt(page,options,box.x+box.width/2,box.y+box.height/2);await page.waitForFunction(n=>calibrationUI.session.landmarks.length===n&&!calibrationUI.busy,i+1);
 }
 await page.waitForFunction(()=>calibrationUI.session.status==='solved'&&!calibrationUI.session.pending,null,{timeout:30000});const result=await page.evaluate(()=>calibrationUI.session);assert.equal(result.quality.inliers,8);assert.equal(result.quality.outliers,0);assert.equal(result.quality.verifiedCorrespondences,4);assert.ok(result.quality.meanAngularErrorDeg<.4);await page.screenshot({path:'/tmp/guided-real-'+name+'.png'});
});
