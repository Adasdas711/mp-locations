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
