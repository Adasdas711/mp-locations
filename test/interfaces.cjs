const {test,before,after}=require('node:test');const assert=require('node:assert/strict');const JSZip=require('../vendor/jszip.min.js');
const {launchBrowser}=require('./support/browser.cjs'),{profiles,openSession}=require('./support/fixtures.cjs');let browser;
before(async()=>{browser=await launchBrowser()});after(async()=>{await browser?.close()});
async function install(page){
 const zip=new JSZip();zip.file('manifest.json',JSON.stringify({id:'test.interfaces',name:'Interface test',version:'1.0.0',apiVersion:1,main:'main.js',permissions:['project.read','plan.read','plan.write','markers.write','tour.read','tour.write','view.control','ui.control','ui.contribute'],contributes:{commands:[{id:'test.interfaces.open',title:"Открыть тест"},{id:'test.interfaces.change',title:"Изменить план"}],panels:[{id:'test.interfaces.panel',title:"Тестовая панель"}],activityBar:[{id:'test.interfaces.activity',title:"Мой значок",icon:'icon.svg',command:'test.interfaces.open'}],toolbars:[{id:'test.interfaces.plan',title:"Инструмент плана",location:'plan',icon:'pin',command:'test.interfaces.change'},{id:'test.interfaces.tour',title:"Инструмент 3D",location:'tour',command:'test.interfaces.open'},{id:'test.interfaces.header',title:"Инструмент заголовка",location:'header',command:'test.interfaces.open'},{id:'test.interfaces.status',title:"Инструмент статуса",location:'status',command:'test.interfaces.open'}]}}));
 zip.file('icon.svg','<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><circle cx="10" cy="10" r="8" fill="#4da3ff"/></svg>');
 zip.file('main.js',`exports.activate=api=>{api.commands.register('test.interfaces.open',()=>api.ui.showPanel('test.interfaces.panel','<h2>Панель интерфейса</h2>'));api.commands.register('test.interfaces.change',async()=>{await api.markers.update({level:0,index:0,patch:{note:'Из интерфейса'}});await api.plan.walls.add({level:0,x1:10,y1:10,x2:100,y2:10});await api.ui.overlay({id:'test.interfaces.overlay',location:'plan',shapes:[{type:'circle',cx:80,cy:80,r:10,stroke:'#ff0000',fill:'none'}]})})}`);
 await page.locator('#toolsSettingsOpen').click();await page.locator('#addonsOpen').click();await page.locator('#addonFile').setInputFiles({name:'interfaces.zip',mimeType:'application/zip',buffer:await zip.generateAsync({type:'nodebuffer'})});await page.locator('#addonInstall').click();await page.waitForFunction(()=>addonHosts.get('test.interfaces')?.ready);await page.locator('#addonsClose').click();
}
for(const [name,options]of profiles)test(`${name}: extension icons, toolbars, plan API, overlays, settings and disable lifecycle`,async t=>{
 const {page}=await openSession(browser,t,options,{offlineCache:true});await install(page);
 const activity=page.locator('[data-palace-tool="addon.test.interfaces.activity"]');assert.equal(await activity.count(),1);assert.equal(await activity.locator('img').count(),1);
 await activity.click();await page.frameLocator('#addonPanelFrames iframe').locator('h2').waitFor();await page.locator('#addonPanelClose').click();
 await page.locator('[data-palace-tool="addon.test.interfaces.plan"]').click();await page.waitForFunction(()=>state.levels[0].markers[0].note==='Из интерфейса'&&state.levels[0].walls.length===1);
 await page.waitForFunction(()=>document.querySelector('[data-overlay-owner="test.interfaces"]'));
 await page.evaluate(()=>render());await page.waitForFunction(()=>document.querySelector('[data-overlay-owner="test.interfaces"]'));
 await page.locator('#toolsSettingsOpen').click();await page.locator('[data-tool-key="system.zoomIn"]').uncheck();await page.locator('[data-tool-key="addon.test.interfaces.plan"]').uncheck();await page.locator('#toolsClose').click();
 assert.equal(await page.locator('#zoomIn').isVisible(),false);assert.equal(await page.locator('[data-palace-tool="addon.test.interfaces.plan"]').isVisible(),false);
 await page.evaluate(()=>render());assert.equal(await page.locator('#zoomIn').isVisible(),false);
 await page.reload({waitUntil:'networkidle'});await page.waitForFunction(()=>addonHosts.get('test.interfaces')?.ready);if(await page.locator('#recoveryModal.show').count())await page.locator('#recoveryClose').click();
 assert.equal(await page.locator('[data-palace-tool="addon.test.interfaces.plan"]').getAttribute('data-palace-hidden'),'true');
 await page.locator('#toolsSettingsOpen').click();await page.locator('#toolsReset').click();await page.locator('#toolsClose').click();assert.equal(await activity.isVisible(),true);
 await page.locator('#toolsSettingsOpen').click();await page.locator('#addonsOpen').click();await page.locator('[data-addon="test.interfaces"] [data-action="toggle"]').click();await page.waitForFunction(()=>!addonHosts.has('test.interfaces'));
 assert.equal(await page.locator('[data-addon-owner="test.interfaces"]').count(),0);assert.equal(await page.locator('[data-overlay-owner="test.interfaces"]').count(),0);
});
test('validated plan/3D interfaces, undo and permission boundaries',async t=>{
 const {page}=await openSession(browser,t,profiles[0][1],{offlineCache:true});await install(page);
 assert.ok(await page.evaluate(()=>PalaceAPI.uiThemes().every(theme=>typeof theme.id==='string')));
 assert.equal(await page.evaluate(()=>{try{PalaceAPI.uiTheme('constructor');return false}catch{return true}}),true);
 const originalFloors=await page.evaluate(()=>state.levels.length);await page.evaluate(async()=>{const source=PalaceAPI.planRead(0);await PalaceAPI.planAdd({name:'API floor',src:source.src,floorId:3})});assert.equal(await page.evaluate(()=>state.levels.length),originalFloors+1);
 await page.evaluate(()=>PalaceAPI.planRemove(state.active));assert.equal(await page.evaluate(()=>state.levels.length),originalFloors);await page.evaluate(()=>undo());assert.equal(await page.evaluate(()=>state.levels.length),originalFloors+1);await page.evaluate(()=>redo());await page.evaluate(()=>PalaceAPI.planSelect(0));
 await page.evaluate(()=>PalaceAPI.markerUpdate({level:0,index:0,patch:{x:90,y:80,note:'Updated'}}));assert.equal(await page.evaluate(()=>state.levels[0].markers[0].x),90);
 await page.evaluate(()=>PalaceAPI.tourUpdate({id:'a',patch:{room:'New camera',navYawOffsetDeg:22}}));await page.evaluate(()=>undo());assert.equal(await page.evaluate(()=>state.panoramas.a.room),'Camera A');
 await page.evaluate(()=>PalaceAPI.tourSelect('a'));await page.waitForFunction(()=>!!localViewer.renderer);await page.evaluate(()=>{localViewer.pendingYaw={id:localViewer.currentId,yaw:5};PalaceAPI.tourPose({yaw:40,pitch:10,fov:80});localViewer.applyPendingYaw()});assert.equal(await page.evaluate(()=>localViewer.yaw),40);assert.equal(await page.evaluate(()=>PalaceAPI.viewRead().fov),80);
 await page.evaluate(()=>PalaceAPI.viewSet({layout:'plan',zoom:1.2}));assert.equal(await page.evaluate(()=>state.layout),'plan');
 assert.equal(await page.evaluate(async()=>{try{await addonRPC(addonHosts.get('test.interfaces'),'plan.add',{src:'javascript:alert(1)'});return false}catch{return true}}),true);
 assert.equal(await page.evaluate(async()=>{const host=addonHosts.get('test.interfaces');host.record.manifest.permissions=[];try{await addonRPC(host,'plan.read',0);return false}catch{return true}}),true);
 await page.locator('#modeBtn').click();assert.equal(await page.evaluate(()=>{try{PalaceAPI.tourUpdate({id:'a',patch:{room:'Blocked'}});return false}catch{return true}}),true);
});
