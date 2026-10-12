const fs=require('node:fs'),path=require('node:path');
const JSZip=require('../../vendor/jszip.min.js');
const {devices}=require('playwright-core');
const profiles=[['desktop',{viewport:{width:1280,height:900}}],['Android',devices['Pixel 7']],['iPhone',devices['iPhone 13']],['iPad',devices['iPad (gen 7)']]].filter(([name])=>!process.env.PALACE_PROFILES||process.env.PALACE_PROFILES.split(',').includes(name));
let fixture;
async function palace(){
  if(fixture)return fixture;
  const png=fs.readFileSync(path.join(__dirname,'../../icons/icon-192.png'));
  const zip=new JSZip();zip.file('images/level-1.png',png);zip.file('images/level-2.png',png);zip.file('panoramas/p.png',png);
  zip.file('meta.json',JSON.stringify({fixture:true}));
  zip.file('palace.json',JSON.stringify({name:'Functional palace',levels:[1,2].map(id=>({name:'Floor '+id,named:true,floorId:id,w:192,h:192,image:'images/level-'+id+'.png',labels:[],labelsSrc:'svg',markers:[{x:40,y:50,note:'first',localPano:id===1?'a':null},{x:145,y:140,note:'second'}],walls:[]})),panoramas:{a:{mode:'equirect',file:'panoramas/p.png',room:'Camera A',floorId:1,planPx:{x:70,y:70},destinations:[{panoId:'b'}]},b:{mode:'equirect',file:'panoramas/p.png',room:'Camera B',floorId:1,planPx:{x:120,y:100},destinations:[{panoId:'a'}]}}}));
  fixture=await zip.generateAsync({type:'nodebuffer'});return fixture;
}
async function openSession(browser,t,options,{empty=false,offlineCache=false}={}){
 const context=await browser.newContext({...options,serviceWorkers:offlineCache?'allow':'block'});t.after(()=>context.close());
 const page=await context.newPage();page.setDefaultTimeout(10000);page.setDefaultNavigationTimeout(15000);
 const errors=[];page.on('pageerror',error=>errors.push(error.message));t.after(()=>require('node:assert/strict').deepEqual(errors,[]));
 await page.goto(process.env.PALACE_TEST_URL||'http://127.0.0.1:8000',{waitUntil:'networkidle'});
 if(!empty){await page.locator('#fileOpen').setInputFiles({name:'functional.mpalace',mimeType:'application/zip',buffer:await palace()});await page.waitForFunction(()=>archiveContext?.name==='functional.mpalace');
   await page.evaluate(()=>{state.layout='plan';applyLayout()});await page.waitForFunction(()=>document.querySelectorAll('#plan .marker').length===2);
 }
 return {page,context};
}
async function point(page,x=.8,y=.25){return page.locator('#plan').evaluate((el,{x,y})=>{const r=el.getBoundingClientRect();return {x:r.left+r.width*x,y:r.top+r.height*y}},{x,y})}
async function pressAt(page,options,x,y){if(options.hasTouch)await page.touchscreen.tap(x,y);else await page.mouse.click(x,y)}
module.exports={profiles,openSession,point,pressAt,palace};
