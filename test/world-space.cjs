const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),Zip=require('../vendor/jszip.min.js');
const {profiles,openSession}=require('./support/fixtures.cjs'),{launchBrowser}=require('./support/browser.cjs');
let browser;before(async()=>browser=await launchBrowser());after(async()=>browser?.close());
async function setup(t,options){
 const session=await openSession(browser,t,options,{offlineCache:true}),{page}=session;
 await page.evaluate(()=>{state.panoramas={...state.panoramas,c:{...structuredClone(state.panoramas.a),room:'Camera C'}};resetHistory();render()});
 const zip=new Zip();zip.file('manifest.json',JSON.stringify({id:'test.world',name:'World regression',version:'1.0.0',apiVersion:1,engines:{palace:'>=1.6.0 <2.0.0'},main:'main.js',permissions:['scene.read','scene.write','anchors.read','anchors.write','camera.control','view.control'],contributes:{commands:[{id:'test.world.noop',title:'Noop'}]}}));
 zip.file('main.js',"exports.activate=async api=>{window.sdk=api;window.events=[];window.subs=[];api.commands.register('test.world.noop',()=>true);for(const e of ['CameraChanged','ObjectCreated','ObjectUpdated','ObjectRemoved','ObjectClicked']){const sub=api.tour.world['on'+e](value=>events.push({event:e,value}));window.subs.push(sub);await sub.ready}}");
 await page.evaluate(()=>openSettingsPage('addons'));await page.locator('#addonFile').setInputFiles({name:'world.palace-addon',mimeType:'application/zip',buffer:await zip.generateAsync({type:'nodebuffer'})});await page.locator('#addonInstall').click();await page.waitForFunction(()=>addonHosts.get('test.world')?.ready);await page.locator('#addonsClose').click();const frame=await(await page.locator('#addonPanelFrames iframe').elementHandle()).contentFrame();
 await frame.evaluate(async()=>{for(const[id,position]of Object.entries({a:{x:0,y:1.6,z:0},b:{x:4,y:1.6,z:0},c:{x:2,y:1.6,z:-4}}))await sdk.tour.world.setCameraTransform(id,{position,rotation:{x:0,y:0,z:0,w:1},fov:75})});
 await select(frame,'a');return {...session,frame};
}
async function select(frame,id){await frame.evaluate(async id=>{await sdk.tour.select(id);await sdk.tour.waitForPanoramaReady(id);await sdk.tour.camera.setPose({yaw:0,pitch:0,roll:0})},id)}
async function projection(frame,position={x:2,y:1.2,z:-6}){return frame.evaluate(p=>sdk.tour.world.project(p),position)}
for(const[name,options]of profiles){
 test(`${name}: one world entity renders from three cameras with perspective, FOV, quaternion and export persistence`,async t=>{
  const {page,frame}=await setup(t,options);
  const object=await frame.evaluate(()=>sdk.tour.world.objects.create({id:'shared',position:{x:2,y:1.2,z:-6},rotation:{x:0,y:0,z:0,w:1},scale:{x:1,y:1,z:1},style:{type:'sphere',size:.4,color:'#ff0000'},metadata:{name:'One sphere'}}));
  const a=await projection(frame);assert.equal(a.visible,true);assert.ok(a.x>.5);
  await select(frame,'b');const b=await projection(frame);assert.equal(b.visible,true);assert.ok(b.x<.5);
  await select(frame,'c');const c=await projection(frame);assert.equal(c.visible,true);assert.ok(Math.abs(c.x-.5)<1e-6);assert.ok(c.depth<a.depth/2);
  assert.equal((await frame.evaluate(()=>sdk.tour.world.objects.list())).length,1);assert.deepEqual(await frame.evaluate(()=>sdk.tour.world.objects.get('shared')),object);
  assert.equal(await page.evaluate(()=>worldRuntime.group.parent===localViewer.scene&&worldRuntime.meshes.size===1&&worldRuntime.meshes.get('shared').children[0].isMesh),true);
  const size=async()=>{const center=await projection(frame),edge=await projection(frame,{x:2.4,y:1.2,z:-6});return Math.abs(edge.x-center.x)};
  const wide=await size();await frame.evaluate(()=>sdk.tour.camera.setPose({fov:35}));assert.ok(await size()>wide*1.8);
  await frame.evaluate(()=>sdk.tour.camera.setPose({yaw:80,pitch:20}));assert.deepEqual((await frame.evaluate(()=>sdk.tour.world.objects.get('shared'))).position,object.position);
  await select(frame,'b');await frame.evaluate(()=>sdk.tour.world.objects.update('shared',{position:{x:1,y:1.3,z:-5},scale:{x:1,y:2,z:1}}));
  await select(frame,'a');assert.deepEqual((await frame.evaluate(()=>sdk.tour.world.objects.get('shared'))).position,{x:1,y:1.3,z:-5});await select(frame,'c');await frame.evaluate(async()=>sdk.tour.camera.lookAt(await sdk.tour.world.worldToLocal({x:1,y:1.3,z:-5})));assert.ok((await projection(frame,{x:1,y:1.3,z:-5})).visible);
  await select(frame,'a');await frame.evaluate(()=>sdk.tour.world.setCameraTransform('a',{rotation:{x:0,y:1,z:0,w:0}}));assert.equal((await projection(frame,{x:1,y:1.3,z:-5})).visible,false);
  await frame.evaluate(()=>sdk.tour.camera.setPose({yaw:180}));assert.equal((await projection(frame,{x:1,y:1.3,z:-5})).visible,true);
  const before=await frame.evaluate(()=>sdk.tour.world.objects.get('shared'));await frame.evaluate(()=>sdk.tour.world.setCameraTransform('a',{position:{x:5,y:1.6,z:1}}));assert.deepEqual(await frame.evaluate(()=>sdk.tour.world.objects.get('shared')),before);
  await page.evaluate(()=>undo());assert.deepEqual((await frame.evaluate(()=>sdk.tour.world.getCameraTransform('a'))).position,{x:0,y:1.6,z:0});await page.evaluate(()=>redo());
  await page.locator('#abSave').click();const download=page.waitForEvent('download');await page.locator('#saveMpalaceBtn').click();const saved=await download,bytes=fs.readFileSync(await saved.path()),zip=await Zip.loadAsync(bytes),data=JSON.parse(await zip.file('palace.json').async('string'));assert.equal(Object.keys(data.worldSpace.objects).length,1);assert.equal(Object.keys(data.worldSpace.cameras).length,3);
  await page.reload({waitUntil:'networkidle'});await page.waitForFunction(()=>addonHosts.get('test.world')?.ready);await page.locator('#fileOpen').setInputFiles({name:'world.mpalace',mimeType:'application/zip',buffer:bytes});await page.waitForFunction(()=>archiveContext?.name==='world.mpalace');assert.deepEqual(await page.evaluate(()=>state.worldSpace),data.worldSpace);
  await page.evaluate(()=>worldRemove('shared'));assert.equal(await page.evaluate(()=>Object.keys(state.worldSpace.objects).length),0);await page.evaluate(()=>undo());assert.equal(await page.evaluate(()=>Object.keys(state.worldSpace.objects).length),1);
 });
 test(`${name}: world geometry and depth hide shared objects; no-depth fallback and placement UI remain honest`,async t=>{
  const {page,frame}=await setup(t,options);await frame.evaluate(()=>sdk.tour.world.objects.create({id:'center',position:{x:0,y:1.6,z:-10},style:{color:'#ff0000',size:1}}));
  await assert.rejects(frame.evaluate(()=>sdk.tour.world.occlusion.setMode('geometry')),/GEOMETRY_UNAVAILABLE/);await assert.rejects(frame.evaluate(()=>sdk.tour.world.occlusion.setMode('depth-map')),/DEPTH_UNAVAILABLE/);
  assert.equal((await frame.evaluate(()=>sdk.tour.world.raycast({screenPosition:{x:.5,y:.5}}))).hit,false);
  const synthetic=await frame.evaluate(()=>sdk.tour.world.raycast({screenPosition:{x:.5,y:.5},distance:4}));assert.equal(synthetic.synthetic,true);assert.ok(Math.abs(synthetic.position.x)<1e-6&&Math.abs(synthetic.position.y-1.6)<1e-6&&Math.abs(synthetic.position.z+4)<1e-6);
  const geometry={positions:[-10,-10,-5,10,-10,-5,10,10,-5,-10,-10,-5,10,10,-5,-10,10,-5],render:'solid',color:'#00ff00'};
  await frame.evaluate(g=>sdk.tour.world.configure({units:'meters',geometry:g}),geometry);await frame.evaluate(()=>sdk.tour.world.occlusion.setMode('geometry'));
  assert.equal((await projection(frame,{x:0,y:1.6,z:-10})).occluded,true);const hit=await frame.evaluate(()=>sdk.tour.world.raycast({screenPosition:{x:.5,y:.5}}));assert.equal(hit.source,'geometry');assert.equal(hit.synthetic,false);assert.ok(Math.abs(hit.position.z+5)<1e-6);
  const pixel=await page.evaluate(()=>{localViewer.requestRender();return new Promise(resolve=>requestAnimationFrame(()=>{const gl=localViewer.renderer.getContext(),p=new Uint8Array(4);gl.readPixels(Math.floor(gl.drawingBufferWidth/2),Math.floor(gl.drawingBufferHeight/2),1,1,gl.RGBA,gl.UNSIGNED_BYTE,p);resolve([...p])}))});assert.ok(pixel[1]>150&&pixel[0]<80,`Wall occludes sphere in GPU: ${pixel}`);
  await frame.evaluate(()=>sdk.tour.world.occlusion.setMode('none'));assert.equal((await projection(frame,{x:0,y:1.6,z:-10})).occluded,false);
  await frame.evaluate(()=>sdk.tour.scene.configure('a',{depthMap:{width:4,height:3,data:Array(12).fill(5)}}));await frame.evaluate(()=>sdk.tour.world.occlusion.setMode('depth-map'));assert.equal((await projection(frame,{x:0,y:1.6,z:-10})).occluded,true);
  await select(frame,'b');assert.equal((await frame.evaluate(()=>sdk.tour.world.getInfo())).effectiveOcclusion,'none','Missing camera depth does not invent walls');
  await frame.evaluate(()=>sdk.tour.world.configure({geometry:null}));await frame.evaluate(()=>sdk.tour.world.occlusion.setMode('none'));await frame.evaluate(()=>sdk.tour.world.objects.remove('center'));
  await page.locator('#worldOpen').click();await page.locator('#tourSettingsBtn').click();assert.equal(await page.locator('#worldControls').isVisible(),false);assert.equal(await page.locator('#tourToolbar').isVisible(),true);await page.locator('#worldOpen').click();assert.equal(await page.locator('#tourToolbar').isVisible(),false);await page.locator('#worldDistance').fill('6');await page.locator('#worldStyle').selectOption('cube');await page.locator('#worldPlace').click();const box=await page.locator('#local3dCanvas').boundingBox();if(options.hasTouch)await page.locator('#local3dCanvas').tap({position:{x:box.width/2,y:box.height/2}});else await page.locator('#local3dCanvas').click({position:{x:box.width/2,y:box.height/2}});
  await page.waitForFunction(()=>Object.keys(state.worldSpace.objects).length===1);const placed=(await frame.evaluate(()=>sdk.tour.world.objects.list()))[0];assert.equal(placed.style.type,'cube');assert.ok(Math.abs(placed.position.x-4)<.03);assert.ok(Math.abs(placed.position.z+6)<.03);assert.equal(placed.metadata.syntheticPlacement,true);
  assert.equal(await page.locator('#worldControls').isVisible(),false);await frame.evaluate(()=>sdk.tour.camera.lookAt({x:0,y:0,z:-6}));await frame.evaluate(id=>sdk.tour.world.objects.update(id,{position:{x:4,y:1.6,z:-6}}),placed.id);
  if(options.hasTouch)await page.locator('#local3dCanvas').tap({position:{x:box.width/2,y:box.height/2}});else await page.locator('#local3dCanvas').click({position:{x:box.width/2,y:box.height/2}});await frame.waitForFunction(()=>events.some(e=>e.event==='ObjectClicked'));
  await page.locator('#worldOpen').click();await page.locator('#worldMove').click();if(options.hasTouch)await page.locator('#local3dCanvas').tap({position:{x:box.width*.65,y:box.height*.4}});else await page.locator('#local3dCanvas').click({position:{x:box.width*.65,y:box.height*.4}});assert.notDeepEqual((await frame.evaluate(id=>sdk.tour.world.objects.get(id),placed.id)).position,placed.position);
 });
}
test('world APIs validate registration, permissions, quaternions, legacy scenes, import rollback and lifecycle',async t=>{
 const {page,frame}=await setup(t,profiles[0][1]);
 await assert.rejects(frame.evaluate(()=>sdk.tour.world.setCameraTransform('a',{rotation:{x:0,y:0,z:0,w:0}})),/INVALID_ARGUMENT/);
 await frame.evaluate(()=>sdk.tour.world.setCameraTransform('a',{fov:55}));await page.evaluate(()=>undo());assert.equal((await frame.evaluate(()=>sdk.tour.camera.getPose())).fov,75);await page.evaluate(()=>redo());assert.equal((await frame.evaluate(()=>sdk.tour.camera.getPose())).fov,55);await frame.evaluate(()=>sdk.tour.world.setCameraTransform('a',{fov:75}));
 await frame.evaluate(()=>sdk.tour.world.removeCameraTransform('c'));await assert.rejects(frame.evaluate(()=>sdk.tour.world.getCameraTransform('c')),/CAMERA_UNREGISTERED/);
 await select(frame,'c');assert.equal(await page.evaluate(()=>worldRuntime.meshes.size),0);await assert.rejects(frame.evaluate(()=>sdk.tour.world.raycast({distance:10,screenPosition:{x:.5,y:.5}})),/CAMERA_UNREGISTERED/);
 await select(frame,'a');await frame.evaluate(()=>sdk.tour.anchors.create({id:'local',position:{x:1,y:0,z:-5}}));await frame.evaluate(()=>sdk.tour.world.objects.create({id:'global',position:{x:0,y:1.6,z:-6},style:{type:'model',model:{positions:[-1,-1,0,1,-1,0,0,1,0]}}}));assert.equal(await page.evaluate(()=>sceneRuntime.meshes.has('local')&&worldRuntime.meshes.has('global')),true);
 await frame.evaluate(()=>sdk.tour.world.objects.update('global',{style:{type:'sprite'}}));assert.equal(await page.evaluate(()=>worldRuntime.meshes.get('global').children[0].isSprite),true);await frame.evaluate(()=>sdk.tour.world.objects.update('global',{style:{type:'billboard'},rotation:{x:0,y:.5,z:0,w:1}}));assert.equal(await page.evaluate(()=>worldRuntime.meshes.get('global').children[0].userData.worldBillboard),true);
 const before=await page.evaluate(()=>structuredClone(state.worldSpace));await page.evaluate(()=>{state.mode='view';applyMode()});await assert.rejects(frame.evaluate(()=>sdk.tour.world.objects.remove('global')),/edit mode/);await assert.rejects(frame.evaluate(()=>sdk.tour.world.setCameraTransform('a',{fov:60})),/edit mode/);await page.evaluate(()=>{state.mode='edit';applyMode()});
 await page.evaluate(()=>addonHosts.get('test.world').record.manifest.permissions=[]);await assert.rejects(frame.evaluate(()=>sdk.tour.world.objects.list()),/PERMISSION_DENIED/);await assert.rejects(frame.evaluate(()=>sdk.tour.world.listCameras()),/PERMISSION_DENIED/);await page.evaluate(()=>addonHosts.get('test.world').record.manifest.permissions=['tour.read','tour.write','view.control']);assert.equal((await frame.evaluate(()=>sdk.tour.world.objects.list())).length,1);
 await page.evaluate(()=>removeEditedCamera('b'));assert.equal(await page.evaluate(()=>!!state.worldSpace.cameras.b),false);assert.equal(await page.evaluate(()=>!!state.worldSpace.objects.global),true);await page.evaluate(()=>undo());assert.deepEqual(await page.evaluate(()=>state.worldSpace),before);
 const malformed=new Zip();malformed.file('palace.json',JSON.stringify({levels:[],panoramas:{},worldSpace:{...before,version:999}}));await assert.rejects(page.evaluate(async bytes=>loadMplaceBuffer(new Uint8Array(bytes).buffer),[...await malformed.generateAsync({type:'nodebuffer'})]),/INVALID_WORLD/);assert.deepEqual(await page.evaluate(()=>state.worldSpace),before);
 await frame.evaluate(()=>{for(const sub of subs)sub.dispose();events=[]});await page.waitForFunction(()=>addonHosts.get('test.world').worldSubscriptions.size===0);await frame.evaluate(()=>sdk.tour.world.objects.update('global',{label:'No listener'}));assert.equal(await frame.evaluate(()=>events.length),0);
 await page.evaluate(()=>stopAddon('test.world'));assert.equal(await page.evaluate(()=>!!state.worldSpace.objects.global),true);
});

test('registered world doorway reveals one object from A and occludes it from B; aspect and coordinate conversion stay consistent',async t=>{
 const {page,frame}=await setup(t,profiles[0][1]);
 await frame.evaluate(()=>sdk.tour.world.objects.create({id:'doorway',position:{x:0,y:1.6,z:-10},style:{color:'#ff0000',size:.8}}));
 const rectangle=(left,right)=>[left,-10,-5,right,-10,-5,right,10,-5,left,-10,-5,right,10,-5,left,10,-5];
 await frame.evaluate(positions=>sdk.tour.world.configure({geometry:{positions,color:'#00ff00',render:'solid'}}),[...rectangle(-10,-1),...rectangle(1,10)]);await frame.evaluate(()=>sdk.tour.world.occlusion.setMode('geometry'));
 assert.equal((await projection(frame,{x:0,y:1.6,z:-10})).occluded,false);assert.equal((await frame.evaluate(()=>sdk.tour.world.raycast({screenPosition:{x:.5,y:.5}}))).hit,false);
 await select(frame,'b');assert.equal((await projection(frame,{x:0,y:1.6,z:-10})).occluded,true);assert.equal(await page.evaluate(()=>Object.keys(state.worldSpace.objects).length),1);
 const p={x:1,y:1,z:-3};const local=await frame.evaluate(p=>sdk.tour.world.worldToLocal(p,'b'),p),back=await frame.evaluate(local=>sdk.tour.world.localToWorld(local,'b'),local);for(const k of ['x','y','z'])assert.ok(Math.abs(back[k]-p[k])<1e-6);
 await frame.evaluate(()=>sdk.tour.world.occlusion.setMode('none'));await select(frame,'a');const before=await projection(frame,{x:2,y:1.6,z:-10});await page.setViewportSize({width:760,height:900});await page.waitForFunction(()=>Math.abs(localViewer.camera.aspect-localViewer.canvas.clientWidth/localViewer.canvas.clientHeight)<.01);const after=await projection(frame,{x:2,y:1.6,z:-10});assert.ok(after.x-.5>before.x-.5);assert.deepEqual((await frame.evaluate(()=>sdk.tour.world.objects.get('doorway'))).position,{x:0,y:1.6,z:-10});
});

test('packaged shared-world addon works with three calibrated synthetic panoramas',async t=>{
 const {page}=await openSession(browser,t,profiles[0][1],{empty:true,offlineCache:true});
 await page.locator('#fileOpen').setInputFiles(require('node:path').join(__dirname,'fixtures/shared-world-demo.mpalace'));await page.waitForFunction(()=>state.name==='Shared World Demo'&&Object.keys(state.panoramas).length===3);
 const zip=new Zip(),root=require('node:path').join(__dirname,'../docs/addons/world-example');for(const name of ['manifest.json','main.js'])zip.file(name,fs.readFileSync(root+'/'+name));
 await page.evaluate(()=>openSettingsPage('addons'));await page.locator('#addonFile').setInputFiles({name:'demo.palace-addon',mimeType:'application/zip',buffer:await zip.generateAsync({type:'nodebuffer'})});await page.locator('#addonInstall').click();await page.waitForFunction(()=>addonHosts.get('example.shared-world')?.ready);await page.locator('#addonsClose').click();
 await page.evaluate(()=>executeAddon('example.shared-world','example.shared-world.create'));for(const camera of ['a','b','c']){await page.evaluate(camera=>executeAddon('example.shared-world','example.shared-world.'+camera),camera);assert.equal(await page.evaluate(()=>worldProject(worldData().objects['demo-locus'].position).visible),true);assert.equal(await page.evaluate(()=>Object.keys(state.worldSpace.objects).length),1)}
 assert.equal(await page.evaluate(()=>addonHosts.get('example.shared-world').error),null);
 if(process.env.PALACE_WORLD_SCREENSHOT)await page.screenshot({path:process.env.PALACE_WORLD_SCREENSHOT});
});

test('No depth keeps real virtual-object depth testing and restores the local renderer state',async t=>{
 const {page,frame}=await setup(t,profiles[0][1]);
 await frame.evaluate(async()=>{await sdk.tour.world.objects.create({id:'near',position:{x:0,y:1.6,z:-5},style:{type:'sphere',size:1,color:'#00ff00'}});await sdk.tour.world.objects.create({id:'far',position:{x:0,y:1.6,z:-10},style:{type:'sphere',size:2,color:'#ff0000'}})});
 const pixel=await page.evaluate(()=>{localViewer.requestRender();return new Promise(resolve=>requestAnimationFrame(()=>{const gl=localViewer.renderer.getContext(),p=new Uint8Array(4);gl.readPixels(Math.floor(gl.drawingBufferWidth/2),Math.floor(gl.drawingBufferHeight/2),1,1,gl.RGBA,gl.UNSIGNED_BYTE,p);resolve([...p])}))});assert.ok(pixel[1]>150&&pixel[0]<80,`Near virtual sphere covers far sphere without real-world depth: ${pixel}`);
 assert.deepEqual(await page.evaluate(()=>({layers:localViewer.camera.layers.mask,autoClear:localViewer.renderer.autoClear})),{layers:1,autoClear:true});
 await frame.evaluate(()=>sdk.tour.world.objects.remove('near'));assert.equal(await page.evaluate(()=>worldRuntime.meshes.size),1);
});
