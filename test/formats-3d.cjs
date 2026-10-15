const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');const JSZip=require('../vendor/jszip.min.js');
const {launchBrowser}=require('./support/browser.cjs'),{profiles,openSession}=require('./support/fixtures.cjs');
let browser;before(async()=>{browser=await launchBrowser()});after(async()=>{await browser?.close()});
for(const [name,options]of profiles){
 test(`${name}: dollhouse renders floors, switches photo/schematic, zooms and returns to 2D`,async t=>{
  const {page}=await openSession(browser,t,options);
  await page.locator('#planView3d').click();await page.waitForFunction(()=>planView==='3d'&&DH.ready&&DH.root&&DH.root.children.length>0,null,{timeout:20000});
  assert.ok(await page.locator('#dollhouseCanvas').isVisible());
  const r=await page.evaluate(()=>DH.ctl.r);await page.locator('#zoomIn').click();await page.waitForFunction(r=>DH.ctl.r<r,r);
  const photo=await page.evaluate(()=>DH.photo);await page.locator('#planPhoto3d').click();assert.notEqual(await page.evaluate(()=>DH.photo),photo);
  await page.locator('#floorOverlay button[data-li="1"]').click();assert.equal(await page.evaluate(()=>state.active),1);
  // This button changes an animated canvas mode, not the document. Wait for
  // that observable result instead of Playwright's unrelated navigation wait.
  const documentURL=page.url();await page.locator('#planView2d').click({noWaitAfter:true});await page.waitForFunction(()=>planView==='2d'&&document.querySelectorAll('#plan .marker').length===2,null,{timeout:20000});
  assert.equal(page.url(),documentURL);assert.equal(await page.locator('#dollhouseCanvas').isVisible(),false);
 });
 test(`${name}: imports Zillow and Matterport 3dview, rejects corrupt archives without losing project`,async t=>{
  const {page}=await openSession(browser,t,options);const png=fs.readFileSync(path.join(__dirname,'../icons/icon-192.png'));
  for(const platform of ['zillow','matterport']){
   const zip=new JSZip();const file=platform==='matterport'?'p_equirect.png':'p.png';zip.file(file,png);zip.file('plan.png',png);
   zip.file('links.json',JSON.stringify([{id:'p1',platform,plan_file:'plan.png',files:[file],floor:{id:1,label:'Ground'},room:'Fixture room',plan_px:{x:100,y:100},neighbors:[],extra:{panoYawDeg:45}}]));
   await page.locator('#fileOpen').setInputFiles({name:platform+'.3dview',mimeType:'application/zip',buffer:await zip.generateAsync({type:'nodebuffer'})});await page.waitForFunction(platform=>archiveContext?.name===platform+'.3dview',platform);
   assert.equal(await page.evaluate(()=>Object.keys(state.panoramas).length),1);assert.equal(await page.evaluate(()=>state.panoramas.p1.platform),platform);
   assert.equal(await page.evaluate(()=>state.levels[0].floorId),1);
  }
  const before=await page.evaluate(()=>JSON.stringify(buildSerializableState()));
  await page.locator('#fileOpen').setInputFiles({name:'broken.mpalace',mimeType:'application/zip',buffer:Buffer.from('corrupt')});await page.locator('#askModal.show').waitFor();await page.locator('#askYes').click();
  const after=await page.evaluate(()=>{const s=buildSerializableState();return JSON.stringify(s)});
  assert.deepEqual(JSON.parse(after).levels,JSON.parse(before).levels);assert.equal(await page.evaluate(()=>archiveContext.name),'matterport.3dview');
 });
 test(`${name}: external tour URL normalization and provider failure fallback`,async t=>{
  const {page}=await openSession(browser,t,options,{empty:true});
  assert.equal(await page.evaluate(()=>normalizeTourUrl('<iframe src="https://my.matterport.com/show/?m=abc123"></iframe>')),'https://my.matterport.com/show/?m=abc123');
  assert.match(await page.evaluate(()=>normalizeTourUrl('https://youriguide.com/house')),/\/embed\/house\//);
  assert.equal(await page.evaluate(()=>{try{normalizeTourUrl('https://my.matterport.com/show/');return false}catch{return true}}),true);
  await page.route('https://my.matterport.com/**',route=>route.fulfill({status:403,body:'Provider refused embedding'}));
  await page.evaluate(()=>{state.layout='tour';state.tour='https://my.matterport.com/show/?m=fixture';render()});
  await page.waitForFunction(()=>document.querySelector('#tourFrame')?.src.includes('fixture'));
  assert.ok(await page.locator('#tourPanel').isVisible());
  await page.evaluate(()=>{state.tour='https://www.zillow.com/view-3d-home/fixture';render()});
  await page.locator('#tourWinAgain').waitFor();assert.equal(await page.evaluate(()=>cannotEmbed(state.tour)),true);
 });
}
