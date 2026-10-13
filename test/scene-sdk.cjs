const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),Zip=require('../vendor/jszip.min.js');
const {profiles,openSession,pressAt}=require('./support/fixtures.cjs'),{launchBrowser}=require('./support/browser.cjs');
let browser;before(async()=>browser=await launchBrowser());after(async()=>browser?.close());
async function install(page,permissions=['anchors.read','anchors.write','scene.read','scene.write','camera.control']){
 const zip=new Zip();zip.file('manifest.json',JSON.stringify({id:'test.scene',name:'Scene regression',version:'1.0.0',apiVersion:1,engines:{palace:'>=1.5.0 <2.0.0'},main:'main.js',permissions,contributes:{commands:[{id:'test.scene.noop',title:'Noop'}]}}));
 zip.file('main.js',"exports.activate=async api=>{window.sdk=api;window.events=[];api.commands.register('test.scene.noop',()=>true);window.subscriptions=[];for(const event of ['CameraChanged','PanoramaReady','AnchorClick','AnchorHover','AnchorMoved','PlaybackChanged']){const sub=api.tour['on'+event](data=>window.events.push({event,data}));window.subscriptions.push(sub);try{await sub.ready}catch{}}}");
 await page.evaluate(()=>openSettingsPage('addons'));await page.locator('#addonFile').setInputFiles({name:'scene.palace-addon',mimeType:'application/zip',buffer:await zip.generateAsync({type:'nodebuffer'})});await page.locator('#addonInstall').click();await page.waitForFunction(()=>addonHosts.get('test.scene')?.ready);await page.locator('#addonsClose').click();
 return (await page.locator('#addonPanelFrames iframe').elementHandle()).contentFrame();
}
async function ready(page,frame,id='a'){await page.evaluate(id=>{state.layout='tour';applyLayout();setActiveLocalPano(id,false)},id);return frame.evaluate(id=>sdk.tour.waitForPanoramaReady(id),id)}
for(const[name,options]of profiles){
 test(`${name}: 3D anchors persist, move, interact and remain fixed when the camera rotates`,async t=>{
  const {page}=await openSession(browser,t,options,{offlineCache:true}),frame=await install(page);await ready(page,frame);
  assert.equal(await frame.evaluate(()=>sdk.version),'1.6.0');
  await frame.evaluate(()=>sdk.tour.camera.setPose({yaw:0,pitch:0,roll:0,fov:75}));
  const anchor=await frame.evaluate(()=>sdk.tour.anchors.create({id:'locus-a',panoId:'a',position:{x:0,y:0,z:-10},label:'Anchor A',style:{type:'sphere',color:'#ff0000',size:1},metadata:{nested:{answer:42}}}));assert.equal(anchor.id,'locus-a');
  assert.equal(await page.evaluate(()=>sceneRuntime.group.parent===localViewer.scene&&sceneRuntime.meshes.get('locus-a').children[0].isMesh),true,'Anchor belongs to the Three.js scene');
  const before=await page.evaluate(()=>sceneRuntime.meshes.get('locus-a').position.toArray());await frame.evaluate(()=>sdk.tour.camera.setPose({yaw:45,pitch:10}));assert.deepEqual(await page.evaluate(()=>sceneRuntime.meshes.get('locus-a').position.toArray()),before);
  await frame.evaluate(()=>sdk.tour.camera.focusAnchor('locus-a',{duration:80,easing:'linear'}));
  const box=await page.locator('#local3dCanvas').boundingBox(),point={x:box.x+box.width/2,y:box.y+box.height/2};
  const canvas=page.locator('#local3dCanvas');if(options.hasTouch)await canvas.tap({position:{x:box.width/2,y:box.height/2}});else await canvas.click({position:{x:box.width/2,y:box.height/2}});await frame.waitForFunction(()=>events.some(e=>e.event==='AnchorClick'&&e.data.anchorId==='locus-a'));
  await frame.evaluate(()=>sdk.tour.anchors.update('locus-a',{position:{x:2,y:1,z:-8},rotation:{x:.2,y:.3,z:.4},scale:1.2}));assert.equal(await frame.evaluate(()=>events.some(e=>e.event==='AnchorMoved'&&e.data.reason==='update')),true);
  await page.evaluate(()=>undo());assert.deepEqual(await frame.evaluate(()=>sdk.tour.anchors.get('locus-a').then(a=>a.position)),{x:0,y:0,z:-10});await page.evaluate(()=>redo());
  await page.locator('#abSave').click();const waiting=page.waitForEvent('download');await page.locator('#saveMpalaceBtn').click();const file=await waiting,bytes=fs.readFileSync(await file.path()),zip=await Zip.loadAsync(bytes);assert.deepEqual(JSON.parse(await zip.file('palace.json').async('string')).sceneAnchors['locus-a'].position,{x:2,y:1,z:-8});
  await page.reload({waitUntil:'networkidle'});await page.waitForFunction(()=>addonHosts.get('test.scene')?.ready);await page.locator('#fileOpen').setInputFiles({name:'anchors.mpalace',mimeType:'application/zip',buffer:bytes});await page.waitForFunction(()=>archiveContext?.name==='anchors.mpalace');assert.equal(await page.evaluate(()=>state.sceneAnchors['locus-a'].metadata.nested.answer),42);
  await page.evaluate(()=>PalaceAPI.tourRemove('a'));assert.equal(await page.evaluate(()=>Object.keys(state.sceneAnchors).length),0);await page.evaluate(()=>undo());assert.equal(await page.evaluate(()=>!!state.sceneAnchors['locus-a']),true);
 });
 test(`${name}: projection, synthetic ray placement, calibrated geometry and depth occlude anchors`,async t=>{
  const {page}=await openSession(browser,t,options,{offlineCache:true}),frame=await install(page);await ready(page,frame);await frame.evaluate(()=>sdk.tour.camera.setPose({yaw:0,pitch:0,roll:0,fov:75}));
  const info=await frame.evaluate(()=>sdk.tour.scene.getInfo('a'));assert.equal(info.type,'panorama');assert.equal(info.hasGeometry,false);assert.equal(info.capabilities.translation,false);
  const hit=await frame.evaluate(()=>sdk.tour.scene.raycast({screenPosition:{x:.5,y:.5},distance:10}));assert.equal(hit.synthetic,true);assert.ok(Math.abs(hit.position.z+10)<.001);assert.equal(await frame.evaluate(()=>sdk.tour.scene.raycast({screenPosition:{x:.5,y:.5}})),null);
  const roundtrip=await frame.evaluate(async()=>{const p=await sdk.tour.scene.unproject({x:.3,y:.4},12);return sdk.tour.scene.project(p)});assert.ok(Math.abs(roundtrip.x-.3)<.001&&Math.abs(roundtrip.y-.4)<.001);
  await frame.evaluate(()=>sdk.tour.anchors.create({id:'occluded',panoId:'a',position:{x:0,y:0,z:-10},style:{color:'#ff0000',size:1}}));
  const geometry={positions:[-10,-10,-5,10,-10,-5,10,10,-5,-10,-10,-5,10,10,-5,-10,10,-5],render:'solid',color:'#00ff00'};
  await frame.evaluate(geometry=>sdk.tour.scene.configure('a',{units:'meters',geometry}),geometry);assert.equal(await frame.evaluate(()=>sdk.tour.scene.getInfo('a').then(i=>i.type)),'3d');
  const projected=await frame.evaluate(()=>sdk.tour.scene.project({x:0,y:0,z:-10}));assert.equal(projected.occluded,true);assert.equal(projected.visible,false);
  const realHit=await frame.evaluate(()=>sdk.tour.scene.raycast({screenPosition:{x:.5,y:.5}}));assert.equal(realHit.synthetic,false);assert.ok(Math.abs(realHit.position.z+5)<.001);
  const pixel=await page.evaluate(()=>{sceneCameraMatrices();localViewer.renderer.render(localViewer.scene,localViewer.camera);const gl=localViewer.renderer.getContext(),pixel=new Uint8Array(4);gl.readPixels(Math.floor(gl.drawingBufferWidth/2),Math.floor(gl.drawingBufferHeight/2),1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);return [...pixel]});assert.ok(pixel[1]>150&&pixel[0]<80,'The registered geometry actually occludes the red anchor in WebGL');
  const moved=await frame.evaluate(()=>sdk.tour.camera.moveTo({position:{x:1,y:0,z:0}},{duration:50}));assert.equal(moved.translated,true);assert.equal(moved.pose.position.x,1);
  await frame.evaluate(()=>sdk.tour.camera.setPose({position:{x:0,y:0,z:0}}));await frame.evaluate(()=>sdk.tour.scene.configure('a',{depthMap:{width:4,height:3,data:Array(12).fill(5)}}));assert.equal(await frame.evaluate(()=>sdk.tour.scene.getInfo('a').then(i=>i.hasDepthMap)),true);assert.equal(await frame.evaluate(()=>sdk.tour.scene.project({x:0,y:0,z:-10}).then(p=>p.occluded)),true);
  await frame.evaluate(()=>sdk.tour.scene.configure('a',null));await assert.rejects(frame.evaluate(()=>sdk.tour.camera.setPose({position:{x:1,y:0,z:0}})),/TRANSLATION_UNSUPPORTED/);assert.equal((await frame.evaluate(()=>sdk.tour.camera.moveTo({position:{x:1,y:0,z:-10}},{duration:20}))).translated,false);
 });
 test(`${name}: panorama readiness, cancellable camera animation and automatic tour playback`,async t=>{
  const {page}=await openSession(browser,t,options,{offlineCache:true}),frame=await install(page);await ready(page,frame);
  await frame.evaluate(async()=>{await sdk.tour.anchors.create({id:'stop-a',panoId:'a',position:{x:0,y:0,z:-10}});await sdk.tour.anchors.create({id:'stop-b',panoId:'b',position:{x:10,y:0,z:0}})});
  const cancelled=await frame.evaluate(async()=>{const moving=sdk.tour.camera.setPose({yaw:120,roll:20,fov:60,duration:1000}).then(()=>false,error=>error.message.includes('ANIMATION_CANCELLED'));await new Promise(r=>setTimeout(r,50));await sdk.tour.camera.stopAnimation();return moving});assert.equal(cancelled,true);
  await frame.evaluate(()=>sdk.tour.playback.start({stops:[{panoId:'a',anchorId:'stop-a',duration:100,hold:250},{panoId:'b',anchorId:'stop-b',duration:100,hold:250}],loop:false}));await page.waitForFunction(()=>scenePlayback.phase==='holding'&&scenePlayback.index===0);
  await frame.evaluate(()=>sdk.tour.playback.pause());assert.equal((await frame.evaluate(()=>sdk.tour.playback.getState())).status,'paused');await new Promise(r=>setTimeout(r,350));assert.equal((await frame.evaluate(()=>sdk.tour.playback.getState())).index,0);
  await frame.evaluate(()=>sdk.tour.playback.resume());await page.waitForFunction(()=>scenePlayback.status==='completed',null,{timeout:15000});assert.equal((await frame.evaluate(()=>sdk.tour.camera.getPose())).panoId,'b');
  await frame.waitForFunction(()=>events.some(e=>e.event==='PanoramaReady'&&e.data.panoId==='b'));assert.equal(await frame.evaluate(()=>events.some(e=>e.event==='PlaybackChanged'&&e.data.status==='completed')),true);assert.equal(await frame.evaluate(()=>events.some(e=>e.event==='CameraChanged')),true);
  await frame.evaluate(()=>sdk.tour.playback.previous());await page.waitForFunction(()=>scenePlayback.status==='paused'&&scenePlayback.index===0);await frame.evaluate(()=>sdk.tour.playback.next());await page.waitForFunction(()=>scenePlayback.status==='paused'&&scenePlayback.index===1);
  await frame.evaluate(()=>sdk.tour.playback.start({stops:[{panoId:'a',duration:0,hold:50},{panoId:'b',duration:0,hold:50}],loop:true}));await page.waitForFunction(()=>scenePlayback.index===0&&sceneRuntime.ready?.panoId==='a');await frame.evaluate(()=>sdk.tour.playback.stop());assert.equal((await frame.evaluate(()=>sdk.tour.playback.getState())).status,'stopped');
 });
}
test('scene permission denial, legacy permissions, invalid data, view-mode safety and addon lifecycle',async t=>{
 const {page}=await openSession(browser,t,profiles[0][1],{offlineCache:true}),frame=await install(page,[]);
 await assert.rejects(frame.evaluate(()=>sdk.tour.anchors.list('a')),/PERMISSION_DENIED/);await assert.rejects(frame.evaluate(()=>sdk.tour.camera.getPose()),/PERMISSION_DENIED/);
 await page.evaluate(()=>addonHosts.get('test.scene').record.manifest.permissions.push('tour.read','tour.write','view.control'));await ready(page,frame);
 await frame.evaluate(()=>sdk.tour.anchors.create({id:'legacy-anchor',panoId:'a',position:{x:0,y:0,z:-10}}));
 for(const input of [{id:'__proto__',position:{x:0,y:0,z:-10}},{position:{x:Infinity,y:0,z:0}},{position:{x:0,y:0,z:-10},style:{type:'model'}}])await assert.rejects(frame.evaluate(input=>sdk.tour.anchors.create({...input,panoId:'a'}),input));
 await page.evaluate(()=>{state.mode='view';applyMode()});await assert.rejects(frame.evaluate(()=>sdk.tour.anchors.remove('legacy-anchor')),/edit mode/);await page.evaluate(()=>{state.mode='edit';applyMode()});
 await frame.evaluate(()=>sdk.tour.playback.start({stops:[{panoId:'a',duration:500,hold:5000}],loop:true}));await page.evaluate(()=>stopAddon('test.scene'));assert.equal(await page.evaluate(()=>scenePlayback.status),'stopped');assert.equal(await page.evaluate(()=>sceneCameraAnimation),null);assert.equal(await page.evaluate(()=>!!state.sceneAnchors['legacy-anchor']),true,'Anchors are project data, not temporary addon overlays');
});

test('SDK 1.6 declaration surface, mesh styles, hidden-anchor raycast and failed readiness',async t=>{
 const {page}=await openSession(browser,t,profiles[0][1],{offlineCache:true}),frame=await install(page);await ready(page,frame);
 const methods=await frame.evaluate(()=>{const paths=[];function walk(obj,prefix=''){for(const[k,v]of Object.entries(obj)){const path=prefix?prefix+'.'+k:k;if(typeof v==='function')paths.push(path);else if(v&&typeof v==='object')walk(v,path)}}walk(sdk);return paths.sort()});
 const ast=require('prettier/plugins/typescript').parsers.typescript.parse(fs.readFileSync(require('node:path').join(__dirname,'../docs/addons/palace-sdk.d.ts'),'utf8'));
 const declaration=ast.body.map(n=>n.declaration||n).find(n=>n.id?.name==='PalaceSDK'),declared=[];
 function scan(members,prefix=''){for(const member of members){const name=member.key?.name||member.key?.value;if(!name)continue;const path=prefix?prefix+'.'+name:name;if(member.type==='TSMethodSignature')declared.push(path);else if(member.typeAnnotation?.typeAnnotation?.type==='TSTypeLiteral')scan(member.typeAnnotation.typeAnnotation.members,path)}}scan(declaration.body.body);assert.deepEqual(methods,declared.sort());assert.equal(methods.length,114);
 for(const type of ['billboard','sprite','model'])await frame.evaluate(type=>sdk.tour.anchors.create({id:type,panoId:'a',position:{x:0,y:0,z:-10},label:type,style:{type,...(type==='model'?{model:{positions:[-1,-1,0,1,-1,0,0,1,0]}}:{})}}),type);
 assert.deepEqual(await page.evaluate(()=>Object.fromEntries([...sceneRuntime.meshes].map(([id,root])=>[id,!!root.children.length]))),{billboard:true,sprite:true,model:true});
 await frame.evaluate(()=>sdk.tour.camera.setPose({yaw:0,pitch:0}));assert.equal((await frame.evaluate(()=>sdk.tour.scene.raycast({screenPosition:{x:.5,y:.5},includeAnchors:true}))).synthetic,false);
 for(const id of ['billboard','sprite','model'])await frame.evaluate(id=>sdk.tour.anchors.update(id,{visible:false}),id);
 assert.equal(await frame.evaluate(()=>sdk.tour.scene.raycast({screenPosition:{x:.5,y:.5},includeAnchors:true})),null);
 assert.equal(await frame.evaluate(()=>sdk.tour.anchors.clear('a')),3);assert.deepEqual(await frame.evaluate(()=>sdk.tour.anchors.list('a')),[]);
 await assert.rejects(frame.evaluate(()=>sdk.tour.scene.configure('a',{geometry:{source:'dollhouse',origin:{x:0,y:0,z:0}}})),/GEOMETRY_UNAVAILABLE/);
 await assert.rejects(frame.evaluate(()=>sdk.tour.scene.configure('a',{depthMap:{width:4,height:3,data:[1]}})),/INVALID_DEPTH_MAP/);
 await page.evaluate(()=>{sceneRuntime.ready=null;sceneRuntime.pending=null});await assert.rejects(frame.evaluate(()=>sdk.tour.waitForPanoramaReady('a',{timeout:50})),/PANORAMA_TIMEOUT/);
 await page.evaluate(()=>localViewer.reportError('Broken panorama regression'));await assert.rejects(frame.evaluate(()=>sdk.tour.waitForPanoramaReady('a')),/PANORAMA_LOAD_FAILED/);await page.evaluate(()=>localViewer.clearError());
 await page.evaluate(()=>{window.sceneTextureOriginal=localViewer.applyCanvasTexture;localViewer.applyCanvasTexture=function(...args){window.sceneHeldTexture=args}});
 await page.evaluate(()=>PalaceAPI.tourSelect('b'));await page.waitForFunction(()=>!!window.sceneHeldTexture);
 await frame.evaluate(()=>{window.sceneWaitOutcome='waiting';window.sceneReadiness=sdk.tour.waitForPanoramaReady('b').then(value=>{window.sceneWaitOutcome='ready';return value})});
 await new Promise(resolve=>setTimeout(resolve,60));assert.equal(await frame.evaluate(()=>window.sceneWaitOutcome),'waiting','An old panorama texture must not announce the new panorama as ready');
 await page.evaluate(()=>{localViewer.applyCanvasTexture=window.sceneTextureOriginal;localViewer.applyCanvasTexture(...window.sceneHeldTexture);delete window.sceneHeldTexture});
 assert.equal((await frame.evaluate(()=>window.sceneReadiness)).panoId,'b');
});
