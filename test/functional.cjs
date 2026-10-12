const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const JSZip=require('../vendor/jszip.min.js');
const {launchBrowser}=require('./support/browser.cjs');
const {profiles,openSession,point,pressAt}=require('./support/fixtures.cjs');
let browser;
before(async()=>{browser=await launchBrowser()});after(async()=>{await browser?.close()});
for(const [profile,options]of profiles){
 test(`${profile}: add, select, move, delete loci and undo/redo`,async t=>{
  const {page}=await openSession(browser,t,options);
  await page.locator('[data-tool="marker"]').click();let p=await point(page,.8,.25);await pressAt(page,options,p.x,p.y);
  await page.waitForFunction(()=>state.levels[0].markers.length===3);
  await page.locator('[data-tool="select"]').click();
  await page.locator('#plan .marker').last().click();
  const before=await page.evaluate(()=>({...level().markers[level().selected]}));
  await page.keyboard.press('ArrowRight');assert.equal(await page.evaluate(()=>level().markers[level().selected].x),before.x+1);
  await page.keyboard.press('Delete');await page.waitForFunction(()=>level().markers.length===2);
  await page.keyboard.press('Control+z');await page.waitForFunction(()=>level().markers.length===3);
  await page.keyboard.press('Control+Shift+z');await page.waitForFunction(()=>level().markers.length===2);

 });
 test(`${profile}: floor rename, change, merge, arrange, split and delete`,async t=>{
  const {page}=await openSession(browser,t,options);
  await page.locator('#floorOverlay button[data-li="0"]').dblclick();const input=page.locator('#floorOverlay input');await input.fill('Renamed floor');await input.press('Enter');
  assert.equal(await page.evaluate(()=>state.levels[0].name),'Renamed floor');
  await page.locator('#floorOverlay button[data-li="1"]').click();assert.equal(await page.evaluate(()=>state.active),1);
  // Invoke the same menu operations with deterministic targets; inspect their rendered effects.
  await page.evaluate(()=>mergeLevels(0,1));await page.waitForFunction(()=>state.levels.length===1&&arrange);
  await page.locator('#arrangeDone').click();assert.equal(await page.evaluate(()=>state.levels[0].parts.length),2);assert.equal(await page.evaluate(()=>state.levels[0].markers.length),4);
  await page.evaluate(()=>startArrange(0));await page.waitForFunction(()=>!!arrange);const positions=await page.evaluate(()=>arrange.parts.map(p=>p.x));
  await page.keyboard.press('ArrowRight');await page.locator('#arrangeCancel').click();assert.deepEqual(await page.evaluate(()=>state.levels[0].parts.map(p=>p.x)),positions);
  await page.evaluate(()=>splitLevel(0));assert.equal(await page.evaluate(()=>state.levels.length),2);assert.equal(await page.evaluate(()=>state.levels.reduce((n,l)=>n+l.markers.length,0)),4);
  await page.evaluate(()=>deleteLevel(1));await page.locator('#askNo').click();assert.equal(await page.evaluate(()=>state.levels.length),2);
  await page.evaluate(()=>deleteLevel(1));await page.locator('#askYes').click();assert.equal(await page.evaluate(()=>state.levels.length),1);
 });
 test(`${profile}: zoom, rotate, dark floor, wall color, theme and UI scale`,async t=>{
  const {page}=await openSession(browser,t,options);
  const z=await page.evaluate(()=>state.zoom);await page.locator('#zoomIn').click();assert.ok(await page.evaluate(()=>state.zoom)>z);await page.locator('#zoomOut').click();
  if(await page.locator('#compassVal').isVisible()){await page.locator('#compassVal').fill('90');await page.locator('#compassVal').press('Tab')}else await page.evaluate(()=>applyRotation(90));assert.equal(await page.evaluate(()=>state.rotation),90);
  await page.locator('#planDarkFloor').click();assert.equal(await page.evaluate(()=>floorMode()),'dark');await page.locator('#planDarkFloor').click();assert.equal(await page.evaluate(()=>floorMode()),'off');
  await page.locator('#wallColor').evaluate(el=>{el.value='#123456';el.dispatchEvent(new Event('input',{bubbles:true}))});assert.equal(await page.evaluate(()=>themeWallColor()),'#123456');
  await page.locator('#wallColorReset').click();assert.equal(await page.evaluate(()=>themeWallColor()),await page.evaluate(()=>themeWallDefault()));
  await page.locator('#themeBtn').click();await page.locator('#themePickFilter').fill('');await page.locator('#themePickList .tp-item').last().click();
  assert.ok(await page.evaluate(()=>document.documentElement.getAttribute('data-theme')));
  const old=await page.evaluate(()=>PALACE_UI.size);await page.evaluate(()=>PALACE_UI.setSize(2));assert.equal(await page.evaluate(()=>PALACE_UI.size),2);await page.evaluate(n=>PALACE_UI.setSize(n),old);
 });
 test(`${profile}: camera placement, start camera, binding and navigation calibration`,async t=>{
  const {page}=await openSession(browser,t,options);
  await page.evaluate(()=>{state.layout='split';applyLayout();selectMarker(0)});
  await page.evaluate(()=>setStartPano('b'));assert.equal(await page.evaluate(()=>state.startPano),'b');
  await page.evaluate(()=>setActiveLocalPano('a',false));await page.evaluate(()=>l3dNudgeNavRotation(15));assert.equal(await page.evaluate(()=>state.panoramas.a.navYawOffsetDeg),105);
  await page.evaluate(()=>l3dResetNavRotation());assert.equal(await page.evaluate(()=>state.panoramas.a.navYawOffsetDeg),90);
  await page.evaluate(()=>{document.querySelector('#l3dPanoPicker').value='b';bindMarkerToLocalPano()});assert.equal(await page.evaluate(()=>state.levels[0].markers[0].localPano),'b');
  await page.evaluate(()=>unbindMarkerFromLocalPano());assert.equal(await page.evaluate(()=>state.levels[0].markers[0].localPano),null);
  await page.evaluate(()=>{setActiveLocalPano('a',false);setPlacingCam(true);state.layout='plan';applyLayout()});const p=await point(page,.85,.2);await pressAt(page,options,p.x,p.y);
  assert.ok(await page.evaluate(()=>Math.abs(state.panoramas.a.planPx.x-163)<3&&Math.abs(state.panoramas.a.planPx.y-38)<3),JSON.stringify(await page.evaluate(()=>({point:state.panoramas.a.planPx,placing:placingCam,tool:state.tool,active:activeLocalPano,floor:state.active}))));
  await page.evaluate(()=>setStartPano(null));assert.equal(await page.evaluate(()=>state.startPano),null);
 });
 test(`${profile}: PNG, all-floor ZIP, PDF and mplace roundtrip`,async t=>{
  const {page}=await openSession(browser,t,options);
  async function download(action){const waiting=page.waitForEvent('download');await action();return fs.readFileSync(await(await waiting).path())}
  await page.locator('#abSave').click();await page.locator('#openExportBtn').click();await page.locator('#pngScope').selectOption('current');
  const png=await download(()=>page.locator('#exportPngBtn').click());assert.deepEqual([...png.subarray(0,8)],[137,80,78,71,13,10,26,10]);
  await page.locator('#abSave').click();await page.locator('#openExportBtn').click();await page.locator('#pngScope').selectOption('all');
  const images=await JSZip.loadAsync(await download(()=>page.locator('#exportPngBtn').click()));assert.equal(images.file(/\.png$/).length,2);
  await page.locator('#abSave').click();await page.locator('#openExportBtn').click();const pdf=await download(()=>page.locator('#exportPdfBtn').click());assert.equal(pdf.subarray(0,4).toString(),'%PDF');
  await page.locator('#abSave').click();const archive=await download(()=>page.locator('#saveProjectBtn').click());assert.deepEqual(JSON.parse(await(await JSZip.loadAsync(archive)).file('meta.json').async('string')),{fixture:true});
  await page.locator('#fileOpen').setInputFiles({name:'roundtrip.mplace',mimeType:'application/zip',buffer:archive});await page.waitForFunction(()=>archiveContext?.name==='roundtrip.mplace');
  assert.equal(await page.evaluate(()=>state.levels.length),2);assert.equal(await page.evaluate(()=>state.levels[0].markers[0].note),'first');
 });
 test(`${profile}: image import, rotate, flip, brightness, crop and PDF import`,async t=>{
  const {page}=await openSession(browser,t,options,{empty:true});
  if(await page.locator('#abUpload').isVisible())await page.locator('#abUpload').click();else if(await page.locator('#uploadBtn').isVisible())await page.locator('#uploadBtn').click();else{await page.locator('#mobileMore').click();await page.locator('.ctx-item').filter({hasText:'Загрузить планы'}).click()};const image=fs.readFileSync(path.join(__dirname,'../icons/icon-192.png'));
  const chooser=page.waitForEvent('filechooser');await page.locator('#drop').click();await(await chooser).setFiles({name:'plan.png',mimeType:'image/png',buffer:image});
  await page.waitForFunction(()=>pending.length===1);
  await page.locator('#pending [data-act="rotate"]').click();await page.waitForFunction(()=>pending[0].rotation===90);
  await page.locator('#pending [data-act="flip"]').click();assert.equal(await page.evaluate(()=>pending[0].flip),true);
  await page.evaluate(()=>pageEdit(0,'brightness',130));assert.equal(await page.evaluate(()=>pending[0].brightness),130);
  await page.locator('#pending [data-act="crop"]').click();await page.locator('#cropBox').waitFor();await page.locator('#cropApply').click();await page.waitForFunction(()=>cropState===null);
  await page.locator('#applyPlans').click();await page.waitForFunction(()=>state.levels.length===1&&state.levels[0].w===154);
  const waiting=page.waitForEvent('download');await page.evaluate(()=>exportPdf());const pdf=fs.readFileSync(await(await waiting).path());
  if(await page.locator('#abUpload').isVisible())await page.locator('#abUpload').click();else if(await page.locator('#uploadBtn').isVisible())await page.locator('#uploadBtn').click();else{await page.locator('#mobileMore').click();await page.locator('.ctx-item').filter({hasText:'Загрузить планы'}).click()};const chooser2=page.waitForEvent('filechooser');await page.locator('#drop').click();await(await chooser2).setFiles({name:'import.pdf',mimeType:'application/pdf',buffer:pdf});
  await page.waitForFunction(()=>pending.length===1);await page.locator('#applyPlans').click();assert.equal(await page.evaluate(()=>state.levels.length),2);
 });
 test(`${profile}: hotkey filtering, rebinding, reset and safe new-project confirmation`,async t=>{
  const {page}=await openSession(browser,t,options);
  if(await page.locator('#abHotkeys').isVisible())await page.locator('#abHotkeys').click();else{await page.locator('#mobileMore').click();await page.locator('.ctx-item').filter({hasText:'Горячие клавиши'}).click()};await page.locator('#hkFilter').fill('Маркер');assert.equal(await page.locator('#hkList .hk-row:not(.fixed)').count(),1);
  await page.locator('.hk-key[data-id="tool.marker"]').click();await page.keyboard.press('Alt+y');assert.equal(await page.evaluate(()=>hkBinding('tool.marker')),'Alt+KeyY');
  await page.locator('.hk-reset[data-id="tool.marker"]').click();assert.equal(await page.evaluate(()=>hkBinding('tool.marker')),'KeyM');await page.locator('#hkClose').click();
  await page.locator('#palaceName').fill('Keep this');await page.locator('#palaceName').press('Tab');await page.locator('#newBtn').click();await page.locator('#askNo').click();assert.equal(await page.evaluate(()=>state.name),'Keep this');
  await page.locator('#newBtn').click();await page.locator('#askYes').click();assert.equal(await page.evaluate(()=>state.levels.length),0);
 });
 for(let mode=1;mode<=5;mode++)test(`${profile}: review mode ${mode} scoring, next round and exit`,async t=>{
  const {page}=await openSession(browser,t,options);
  // Seed randomness only while selecting a mode; the real selection and scoring code still executes.
  await page.evaluate(async mode=>{const random=Math.random;Math.random=()=> (mode-.5)/5;try{await startReview()}finally{Math.random=random}},mode);
  assert.equal(await page.evaluate(()=>reviewSession.modeNum),mode);
  await page.evaluate(()=>{for(const locus of reviewSession.roundLoci){reviewSession.activeNum=locus.num;reviewTogglePlacement({x:locus.x,y:locus.y})}});
  await page.locator('#reviewCheck').click();assert.equal(await page.evaluate(()=>reviewSession.checkResult.correct),await page.evaluate(()=>reviewSession.roundLoci.length));
  await page.locator('#reviewNext').click();assert.equal(await page.evaluate(()=>reviewSession.phase),'placing');
  await page.locator('#reviewStop').click();await page.locator('#askYes').click();await page.locator('#reviewSummaryClose').click();assert.equal(await page.locator('#plan .marker').count(),2);
 });
}
