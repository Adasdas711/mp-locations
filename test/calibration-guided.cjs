const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),Zip=require('../vendor/jszip.min.js');
const {profiles,openSession,pressAt}=require('./support/fixtures.cjs'),{launchBrowser}=require('./support/browser.cjs');
let browser;before(async()=>{browser=await launchBrowser()});after(async()=>{await browser?.close()});
async function photographicFixture(page){
 const images=await page.evaluate(()=>{
  const corners=[[-.9,1,-4],[.9,1,-4],[.9,-1,-4],[-.9,-1,-4]],poses=[{C:[0,0,0],yaw:0},{C:[.8,.05,.15],yaw:12}];
  const images=poses.map(pose=>{
   const canvas=document.createElement('canvas');canvas.width=2048;canvas.height=1024;const ctx=canvas.getContext('2d'),image=ctx.createImageData(canvas.width,canvas.height),ca=Math.cos(pose.yaw*Math.PI/180),sa=Math.sin(pose.yaw*Math.PI/180);
   for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++){
    const theta=(y+.5)/canvas.height*Math.PI,phi=(x+.5)/canvas.width*2*Math.PI,lx=Math.cos(phi)*Math.sin(theta),ly=Math.cos(theta),lz=Math.sin(phi)*Math.sin(theta),dx=ca*lx+sa*lz,dz=-sa*lx+ca*lz,t=(-4-pose.C[2])/dz,wx=pose.C[0]+t*dx,wy=pose.C[1]+t*ly,v=t>0&&Math.abs(wx)<=.9&&Math.abs(wy)<=1?238:30,i=(y*canvas.width+x)*4;
    image.data[i]=image.data[i+1]=image.data[i+2]=v;image.data[i+3]=255;
   }
   ctx.putImageData(image,0,0);return canvas.toDataURL('image/png');
  });
  const bearings=poses.map(pose=>corners.map(p=>{const dx=p[0]-pose.C[0],dy=p[1]-pose.C[1],dz=p[2]-pose.C[2],a=pose.yaw*Math.PI/180;return PalaceCalibrationMath.angles([Math.cos(a)*dx-Math.sin(a)*dz,dy,Math.sin(a)*dx+Math.cos(a)*dz])}));
  return {images,bearings};
 });
 const zip=new Zip();images.images.forEach((url,i)=>zip.file(`p${i}.png`,url.split(',')[1],{base64:true}));zip.file('palace.json',JSON.stringify({name:'Guided corners',levels:[],panoramas:{a:{mode:'equirect',file:'p0.png',room:'Reference'},b:{mode:'equirect',file:'p1.png',room:'Connecting'}}}));
 await page.locator('#fileOpen').setInputFiles({name:'guided.mpalace',mimeType:'application/zip',buffer:await zip.generateAsync({type:'nodebuffer'})});await page.waitForFunction(()=>archiveContext?.name==='guided.mpalace'&&!calibrationUI.importing);return images.bearings;
}
for(const[name,options]of profiles)test(`${name}: automatically proposed reference corners need only four right-side clicks to solve`,async t=>{
 const {page}=await openSession(browser,t,options,{empty:true}),bearings=await photographicFixture(page);
 await page.locator('#calibrationTool').click();await page.waitForFunction(()=>calibrationUI.suggestions?.points.length===4&&!calibrationUI.suggestions.detecting).catch(async error=>{await page.screenshot({path:'/tmp/guided-'+name+'.png'});throw new Error(error.message+' '+JSON.stringify(await page.evaluate(()=>({suggestions:calibrationUI.suggestions,message:document.querySelector('#calibrationMessage').textContent,view:{yaw:calibrationUI.views.left.yaw,pitch:calibrationUI.views.left.pitch,fov:calibrationUI.views.left.fov,aspect:calibrationUI.views.left.camera.aspect}}))))});
 assert.equal(await page.evaluate(()=>calibrationUI.session.landmarks.length),0,'Unmatched suggestions are not saved observations');const used=new Set();
 for(let i=0;i<4;i++){
  const point=await page.evaluate(()=>calibrationUICurrentSuggestion());assert.ok(point,JSON.stringify(await page.evaluate(()=>({auto:calibrationUI.suggestions,session:calibrationUI.session?.landmarks,state:calibrationUIState()}))));const distances=bearings[0].map(p=>Math.hypot(((p.yaw-point.yaw+540)%360)-180,p.pitch-point.pitch));const index=distances.indexOf(Math.min(...distances));assert.ok(distances[index]<.7,JSON.stringify({point,distances}));assert.equal(used.has(index),false);used.add(index);
  await page.evaluate(pose=>calibrationUI.views.right.setView({...pose,fov:75}),bearings[1][index]);await page.waitForFunction(()=>!calibrationUI.views.right.raf);const rect=await page.locator('#calibration-right-canvas').boundingBox();await pressAt(page,options,rect.x+rect.width/2,rect.y+rect.height/2);await page.waitForFunction(n=>calibrationUI.session.landmarks.length===n&&!calibrationUI.busy,i+1);
 }
 await page.waitForFunction(()=>calibrationUI.session.status==='solved'&&!calibrationUI.session.pending,null,{timeout:30000});const result=await page.evaluate(()=>calibrationUI.session);assert.equal(result.quality.verifiedCorrespondences,4);assert.ok(result.quality.meanAngularErrorDeg<.4);assert.equal(result.quality.registeredCameraIds.length,2);assert.equal(await page.locator('#calibrationSkip').isVisible(),false);
 await page.locator('#calibrationClose').click();await page.locator('#calibrationTool').click();await page.waitForFunction(()=>calibrationUI.session?.landmarks.length===4);assert.equal(await page.evaluate(()=>calibrationUI.session.status),'solved');
});
test('Guided matching skips unseen details, preserves observations, switches pairs and cancels stale analysis',async t=>{
 const {page}=await openSession(browser,t,{viewport:{width:1280,height:900}},{empty:true});await photographicFixture(page);await page.locator('#calibrationTool').click();await page.waitForFunction(()=>calibrationUI.suggestions?.points.length===4);
 const previous=await page.evaluate(()=>calibrationUICurrentSuggestion().id);await page.locator('#calibrationSkip').click();assert.notEqual(await page.evaluate(()=>calibrationUICurrentSuggestion()?.id),previous);assert.equal(await page.evaluate(()=>calibrationUI.session.landmarks.length),0);
 await page.locator('#calibrationSuggest').click();await page.locator('#calibrationNewPoint').click();await page.waitForFunction(()=>!calibrationUI.suggestions.detecting);assert.equal(await page.evaluate(()=>calibrationUI.suggestions.points.length),0);assert.equal(await page.evaluate(()=>calibrationUI.suggestions.disabled),true);
 await page.locator('#calibrationSuggest').click();await page.locator('#calibrationClose').click();await page.waitForTimeout(250);assert.equal(await page.evaluate(()=>calibrationUI.open),false);assert.equal(await page.evaluate(()=>calibrationUI.suggestions?.points.length||0),0);
});
