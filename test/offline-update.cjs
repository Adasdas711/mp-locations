const {test}=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path');
const {launchBrowser}=require('./support/browser.cjs');
const {palace}=require('./support/fixtures.cjs');
test('old offline cache updates without closing tabs; saved versions stay closed and recover manually',async t=>{
 const root=path.resolve(__dirname,'..');let legacy=true;
 const html=await fs.readFile(path.join(root,'index.html'),'utf8');
 const persistence=await fs.readFile(path.join(root,'persistence.js'),'utf8');
 const oldWorker=`self.addEventListener('install',e=>e.waitUntil((async()=>{const c=await caches.open('palace-offline-legacy');await c.put('./index.html',new Response(${JSON.stringify(html)},{headers:{'Content-Type':'text/html'}}));await c.put('./persistence.js',new Response(${JSON.stringify(persistence+'\nshowRecovery(true);')},{headers:{'Content-Type':'text/javascript'}}));await self.skipWaiting()})()));self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));self.addEventListener('fetch',e=>{if(e.request.method==='GET')e.respondWith((async()=>{const c=await caches.open('palace-offline-legacy');return await c.match(e.request.mode==='navigate'?'./index.html':e.request)||fetch(e.request)})())});`;
 const server=http.createServer(async(req,res)=>{
  try{const name=new URL(req.url,'http://localhost').pathname.slice(1)||'index.html';
   if(name==='sw.js'&&legacy){res.setHeader('Content-Type','text/javascript');res.end(oldWorker);return}
   const file=path.resolve(root,name);if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return}
   res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.html')?'text/html':'application/octet-stream');res.end(await fs.readFile(file));
  }catch{res.writeHead(404);res.end()}
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const browser=await launchBrowser();t.after(()=>browser.close());
 const context=await browser.newContext({serviceWorkers:'allow'});t.after(()=>context.close());const page=await context.newPage();page.setDefaultTimeout(15000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`http://127.0.0.1:${server.address().port}`,{waitUntil:'networkidle'});
 await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
 await page.locator('#fileOpen').setInputFiles({name:'saved.mpalace',mimeType:'application/zip',buffer:await palace()});
 await page.waitForFunction(()=>archiveContext?.name==='saved.mpalace');
 await page.evaluate(async()=>{state.name='Retained recovery';touch();await saveRecovery()});
 await page.reload({waitUntil:'networkidle'});
 await page.locator('#recoveryModal.show').waitFor(); // Reproduces a cached older startup.
 legacy=false;
 await page.evaluate(async()=>{const r=await navigator.serviceWorker.getRegistration();await r.update()});
 await page.waitForFunction(async()=>!(await caches.keys()).includes('palace-offline-legacy'),null,{timeout:30000});
 await page.waitForFunction(()=>document.querySelector('#recoveryModal')?.hidden===true,null,{timeout:30000});
 assert.equal(await page.locator('#recoveryModal').isVisible(),false);
 await page.locator('#abSave').click();await page.locator('#recoveryOpen').click();await page.locator('#recoveryList button').first().click();
 await page.waitForFunction(()=>state.name==='Retained recovery');
 // A controller update must preserve an open project with unsaved edits.
 legacy=true;
 await page.evaluate(async()=>{const r=await navigator.serviceWorker.getRegistration();await r.update()});
 await page.waitForFunction(async()=>{const r=await navigator.serviceWorker.getRegistration();return (await caches.keys()).includes('palace-offline-legacy')&&!r.installing&&!r.waiting});
 legacy=false;
 await page.evaluate(async()=>{const r=await navigator.serviceWorker.getRegistration();await r.update()});
 await page.waitForFunction(async()=>!(await caches.keys()).includes('palace-offline-legacy'),null,{timeout:30000});
 assert.equal(await page.evaluate(()=>state.name),'Retained recovery');
 assert.equal(await page.evaluate(()=>state.dirty),true);
 assert.equal(await page.locator('#recoveryModal').isVisible(),false);
 assert.deepEqual(errors,[]);
});
