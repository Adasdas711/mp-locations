const {launchBrowser}=require('./support/browser.cjs');
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const {chromium}=require('playwright-core');
const fs=require('node:fs');
const base=process.env.PALACE_TEST_URL||'http://127.0.0.1:8000';
let browser;
before(async()=>{browser=await launchBrowser()});
after(async()=>{await browser?.close()});
async function fit(page,w,h){
  await page.waitForFunction(()=>mm.geo&&document.querySelector('#minimapBody').clientHeight>0);
  // ResizeObserver and image decoding update asynchronously; wait for the actual containment invariant.
  await page.waitForFunction(()=>{
    const map=document.querySelector('#minimap'),body=document.querySelector('#minimapBody'),panel=map.parentElement;
    const m=map.getBoundingClientRect(),b=body.getBoundingClientRect(),p=panel.getBoundingClientRect(),g=mm.geo;
    const cameras=[...document.querySelectorAll("#minimapSvg .mm-dot")];
    const camerasFit=cameras.length===2&&cameras.every(el=>{const r=el.getBoundingClientRect();return r.left>=b.left&&r.right<=b.right&&r.top>=b.top&&r.bottom<=b.bottom});
    return camerasFit&&g&&g.ox>=1&&g.oy>=1&&g.ox+g.dw<body.clientWidth-1&&g.oy+g.dh<body.clientHeight-1&&m.top>=p.top-1&&m.bottom<=p.bottom+1&&b.bottom<=m.bottom;
  },null,{timeout:10000});
  const info=await page.evaluate(()=>({geo:mm.geo,w:document.querySelector('#minimapBody').clientWidth,h:document.querySelector('#minimapBody').clientHeight,svg:document.querySelector('#minimapSvg').viewBox.baseVal.height,canvasHeight:document.querySelector('#minimapCanvas').height/Math.min(window.devicePixelRatio||1,2)}));
  assert.ok(Math.abs(info.geo.dw/info.geo.dh-w/h)<.001,'Full source aspect ratio is preserved');
  assert.equal(info.svg,info.h,'Overlay matches the actual body height');
  const cameras=await page.locator('#minimapSvg .mm-cam').evaluateAll(elements=>elements.map(el=>{const r=el.querySelector('.mm-dot').getBoundingClientRect(),b=document.querySelector('#minimapBody').getBoundingClientRect();return r.left>=b.left&&r.right<=b.right&&r.top>=b.top&&r.bottom<=b.bottom}));
  assert.ok(cameras.length===2&&cameras.every(Boolean),'Cameras on both extreme corners remain visible');
}
for(const [viewportName,options]of [['desktop',{viewport:{width:1280,height:800}}],['phone',{viewport:{width:390,height:844},isMobile:true,hasTouch:true}],['landscape phone',{viewport:{width:844,height:390},isMobile:true,hasTouch:true}]]){
  for(const [planName,w,h]of [['wide',1800,200],['tall',200,1800],['standard',600,400]]){
    test(`${viewportName}: entire ${planName} plan fits compact and expanded minimap`,async t=>{
      const context=await browser.newContext({...options,serviceWorkers:'block'});t.after(()=>context.close());
      const page=await context.newPage();page.setDefaultTimeout(10000);
      const errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.goto(base,{waitUntil:'networkidle'});
      await page.evaluate(async({w,h})=>{
        const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
        const c=canvas.getContext('2d');c.fillStyle='white';c.fillRect(0,0,w,h);c.strokeStyle='black';c.lineWidth=3;c.strokeRect(2,2,w-4,h-4);
        const image=canvas.toDataURL('image/png').split(',')[1];
        const zip=new JSZip();zip.file('images/level-1.png',image,{base64:true});zip.file('panoramas/p.png',image,{base64:true});
        zip.file('palace.json',JSON.stringify({name:'Minimap',layout:'tour',levels:[{name:'Очень длинное название этажа — проверка компактного заголовка',floorId:1,image:'images/level-1.png',w,h,markers:[]}],panoramas:{start:{mode:'equirect',file:'panoramas/p.png',floorId:1,planPx:{x:0,y:0},room:'Начало длинного плана',destinations:[{panoId:'end'}]},end:{mode:'equirect',file:'panoramas/p.png',floorId:1,planPx:{x:w,y:h},room:'Конец',destinations:[{panoId:'start'}]}}}));
        await openAnyArchiveBuffer(await zip.generateAsync({type:'arraybuffer'}),'minimap.mpalace');
      },{w,h});
      await fit(page,w,h);
      await page.locator('#minimapExpand').click();assert.equal(await page.locator('#minimapExpand').getAttribute('aria-expanded'),'true');
      await fit(page,w,h);
      await page.locator('#minimapSvg .mm-cam[data-pano="end"] .mm-dot').click();
      await page.waitForFunction(()=>activeLocalPano==='end');await fit(page,w,h);
      await page.locator('#minimapExpand').click();await fit(page,w,h);
      await page.setViewportSize({width:options.viewport.width,height:Math.max(280,options.viewport.height-120)});
      await fit(page,w,h);
      assert.deepEqual(errors,[]);
    });
  }
}
