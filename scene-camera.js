/* SDK 1.5 camera readiness, cancellable animation and automatic panorama tours. */
'use strict';
let sceneCameraAnimation=null,sceneCameraSignature='',sceneCameraEventAt=0,sceneCameraRequest=0,sceneProgrammaticSelection=null;
const sceneWaiters=new Set();
const scenePlayback={status:'idle',index:-1,phase:'idle',stops:[],loop:false,error:null,owner:null,token:0,timer:null,remaining:0,deadline:0,project:null,manual:false};
function sceneOwnerGuard(owner){
 if(reviewSession)throw sceneError('REVIEW_ACTIVE','Stop reviewing first.');
 if(owner&&(addonHosts.get(owner.record.id)!==owner||owner.error||!owner.record.enabled||!addonMode))throw sceneError('ADDON_STOPPED','The addon is no longer active.');
}
function sceneWaitReady(panoId=activeLocalPano,options={},owner=null){
 scenePano(panoId);const timeout=sceneNumber(options.timeout??8000,'timeout',1,20000),project=state.panoramas,start=performance.now();
 return new Promise((resolve,reject)=>{
  const waiter={timer:null,reject};sceneWaiters.add(waiter);
  const finish=(error,value)=>{clearTimeout(waiter.timer);sceneWaiters.delete(waiter);error?reject(error):resolve(value)};
  const poll=()=>{try{
   sceneOwnerGuard(owner);if(state.panoramas!==project)throw sceneError('PROJECT_CHANGED','The palace changed while waiting.');
   if(activeLocalPano!==panoId)throw sceneError('PANORAMA_CHANGED','Select the requested panorama before waiting.');
   if(sceneRuntime.ready?.panoId===panoId&&localViewer.currentId===panoId&&localViewer.renderer){finish(null,{...sceneRuntime.ready,scene:sceneInfo(panoId)});return}
   if(document.querySelector('#l3dError.show'))throw sceneError('PANORAMA_LOAD_FAILED',document.querySelector('#l3dErrorMsg').textContent||'Panorama loading failed.');
   if(performance.now()-start>=timeout)throw sceneError('PANORAMA_TIMEOUT','Panorama did not become ready in time.');
   waiter.timer=setTimeout(poll,25);
  }catch(error){finish(error)}};poll();
 });
}
async function sceneSelectReady(id,owner){sceneOwnerGuard(owner);scenePano(id);sceneProgrammaticSelection=id;try{if(activeLocalPano!==id||!['tour','split','split-rev'].includes(state.layout))PalaceAPI.tourSelect(id);const result=await sceneWaitReady(id,{},owner);sceneOwnerGuard(owner);return result}finally{if(sceneProgrammaticSelection===id)sceneProgrammaticSelection=null}}
function sceneCameraOptions(options={}){
 if(!options||typeof options!=='object'||Array.isArray(options))throw sceneError('INVALID_ARGUMENT','Camera options must be an object.');
 const result={duration:sceneNumber(options.duration??0,'duration',0,8000),easing:options.easing||'easeInOut'};
 if(!['linear','easeInOut','easeOut'].includes(result.easing))throw sceneError('INVALID_ARGUMENT','Unknown easing.');return result;
}
function scenePoseTarget(input){
 const previous=scenePose();if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['position','yaw','pitch','roll','fov','duration','easing'].includes(k)))throw sceneError('INVALID_ARGUMENT','Invalid camera pose.');
 const target={...previous,position:input.position?scenePoint(input.position):previous.position};
 for(const key of ['yaw','pitch','roll','fov'])if(input[key]!=null){if(!Number.isFinite(input[key]))throw sceneError('INVALID_ARGUMENT',key+' must be finite.');target[key]=input[key]}
 target.yaw=((target.yaw%360)+360)%360;target.pitch=Math.max(-85,Math.min(85,target.pitch));target.roll=((target.roll+180)%360+360)%360-180;target.fov=Math.max(30,Math.min(150,target.fov));
 if(!sceneInfo().capabilities.translation&&Math.hypot(target.position.x,target.position.y,target.position.z)>.000001)throw sceneError('TRANSLATION_UNSUPPORTED','A photo panorama has no calibrated 6DoF geometry. Use moveTo with a panorama or anchor.');
 return target;
}
function sceneApplyPose(pose){
 const v=localViewer;v.yaw=pose.yaw;v.pitch=pose.pitch;v.sceneRoll=pose.roll;v.fov=pose.fov;v.fovTarget=pose.fov;v.velYaw=v.velPitch=0;v.pendingYaw=null;v.camera.position.set(pose.position.x,pose.position.y,pose.position.z);v.camera.fov=pose.fov;v.camera.updateProjectionMatrix();v.requestRender();
}
function sceneCancelAnimation(reason='Camera animation stopped.',keepRequests=false){
 if(!keepRequests)sceneCameraRequest++;
 const animation=sceneCameraAnimation;if(!animation)return false;sceneCameraAnimation=null;animation.reject(sceneError('ANIMATION_CANCELLED',reason));localViewer.fovTarget=localViewer.fov;return true;
}
function sceneEase(t,name){return name==='linear'?t:name==='easeOut'?1-Math.pow(1-t,3):t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2}
function sceneAnimateCamera(target,options,owner,internal=false){
 sceneOwnerGuard(owner);const parsed=sceneCameraOptions(options),end=scenePoseTarget(target);
 if(!internal&&scenePlayback.status==='playing')scenePlaybackStop('Camera controlled manually.');
 sceneCancelAnimation('Replaced by another camera animation.');
 if(!parsed.duration){sceneApplyPose(end);sceneCameraNotify(true);return Promise.resolve(scenePose())}
 const start=scenePose(),delta=((end.yaw-start.yaw+540)%360)-180;
 return new Promise((resolve,reject)=>{sceneCameraAnimation={start,end,delta,options:parsed,owner,project:state.panoramas,panoId:activeLocalPano,at:performance.now(),resolve,reject};localViewer.velYaw=localViewer.velPitch=0;localViewer.requestRender()});
}
function sceneCameraStep(now){
 const a=sceneCameraAnimation;if(!a)return;
 try{sceneOwnerGuard(a.owner);if(a.project!==state.panoramas||a.panoId!==activeLocalPano||localViewer.currentId!==a.panoId)throw sceneError('PANORAMA_CHANGED','Camera scene changed during animation.');
 const time=Math.min(1,(now-a.at)/a.options.duration),t=sceneEase(time,a.options.easing),pose={...a.end,position:{}};
 for(const key of ['x','y','z'])pose.position[key]=a.start.position[key]+(a.end.position[key]-a.start.position[key])*t;
 for(const key of ['pitch','roll','fov'])pose[key]=a.start[key]+(a.end[key]-a.start[key])*t;pose.yaw=a.start.yaw+a.delta*t;
 sceneApplyPose(pose);if(time===1){sceneCameraAnimation=null;sceneApplyPose(a.end);a.resolve(scenePose())}
 }catch(error){sceneCameraAnimation=null;a.reject(error)}
}
function sceneCameraNotify(force=false){
 if(sceneRuntime.ready?.panoId!==activeLocalPano||!localViewer.camera)return;
 const now=performance.now();if(!force&&now-sceneCameraEventAt<50)return;
 const pose=scenePose(),signature=JSON.stringify(pose);if(!force&&signature===sceneCameraSignature)return;
 sceneCameraSignature=signature;sceneCameraEventAt=now;sceneEmit('CameraChanged',pose);
}
function sceneLookTarget(target){
 const p=scenePoint(target),pose=scenePose(),d=new THREE.Vector3(p.x-pose.position.x,p.y-pose.position.y,p.z-pose.position.z),length=d.length();
 if(length<.000001)throw sceneError('INVALID_ARGUMENT','The target cannot coincide with the camera.');return {yaw:Math.atan2(-d.x,-d.z)*180/Math.PI,pitch:Math.asin(d.y/length)*180/Math.PI};
}
async function sceneFocusAnchor(id,options={},owner=null,internal=false){
 const anchor=sceneGet(id),project=state.panoramas;if(!internal&&scenePlayback.status==='playing')scenePlaybackStop('Camera controlled manually.');sceneCancelAnimation('Camera focus requested.');const request=sceneCameraRequest;await sceneSelectReady(anchor.panoId,owner);
 if(request!==sceneCameraRequest)throw sceneError('ANIMATION_CANCELLED','Camera focus was cancelled.');
 if(project!==state.panoramas||!state.sceneAnchors[id])throw sceneError('ANCHOR_NOT_FOUND','Anchor disappeared during navigation.');
 const current=sceneGet(id);sceneRuntime.selected=id;sceneSync(true);return sceneAnimateCamera(sceneLookTarget(current.position),options,owner,internal);
}
async function sceneMoveTo(target,options={},owner=null){
 if(!target||typeof target!=='object')throw sceneError('INVALID_ARGUMENT','A camera target is required.');
 const parsed=sceneCameraOptions(options),anchor=target.anchorId?sceneGet(target.anchorId):null,id=target.panoId||anchor?.panoId||activeLocalPano,switched=id!==activeLocalPano;
 if(target.panoId&&anchor&&anchor.panoId!==target.panoId)throw sceneError('INVALID_ARGUMENT','Anchor belongs to another panorama.');
 if(scenePlayback.status==='playing')scenePlaybackStop('Camera controlled manually.');
 sceneCancelAnimation('Camera movement requested.');const request=sceneCameraRequest;await sceneSelectReady(id,owner);if(request!==sceneCameraRequest)throw sceneError('ANIMATION_CANCELLED','Camera movement was cancelled.');const position=target.position||anchor?.position||(Number.isFinite(target.x)?target:null);
 if(sceneInfo().capabilities.translation&&position){const pose=await sceneAnimateCamera({position},parsed,owner);return {pose,mode:'translation',translated:true}}
 const pose=position?await sceneAnimateCamera(sceneLookTarget(position),parsed,owner):await sceneAnimateCamera(target.pose||{},parsed,owner);
 return {pose,mode:switched?'panorama-switch':'rotation-only',translated:false};
}
function scenePlaybackState(){const stop=scenePlayback.stops[scenePlayback.index];return {status:scenePlayback.status,index:scenePlayback.index,phase:scenePlayback.phase,panoId:stop?.panoId||null,anchorId:stop?.anchorId||null,stops:structuredClone(scenePlayback.stops),loop:scenePlayback.loop,error:scenePlayback.error}}
function scenePlaybackNotify(){sceneEmit('PlaybackChanged',scenePlaybackState())}
function scenePlaybackResetTimer(){clearTimeout(scenePlayback.timer);scenePlayback.timer=null}
function scenePlaybackStop(reason=null){
 scenePlayback.token++;scenePlaybackResetTimer();sceneCancelAnimation(reason||'Playback stopped.');scenePlayback.status='stopped';scenePlayback.phase='idle';scenePlayback.error=reason;scenePlaybackNotify();return scenePlaybackState();
}
function scenePlaybackPause(){
 if(scenePlayback.status!=='playing')return scenePlaybackState();
 scenePlayback.remaining=scenePlayback.phase==='holding'?Math.max(0,scenePlayback.deadline-performance.now()):sceneCameraAnimation?Math.max(0,sceneCameraAnimation.options.duration-(performance.now()-sceneCameraAnimation.at)):scenePlayback.stops[scenePlayback.index]?.duration||0;
 scenePlayback.token++;scenePlaybackResetTimer();sceneCancelAnimation('Playback paused.');scenePlayback.status='paused';scenePlaybackNotify();return scenePlaybackState();
}
function scenePlaybackComplete(){scenePlayback.status='completed';scenePlayback.phase='idle';scenePlaybackNotify()}
async function scenePlaybackGo(index,resume=null){
 const token=++scenePlayback.token;scenePlaybackResetTimer();sceneCancelAnimation('Playback changed stop.');scenePlayback.index=index;scenePlayback.status='playing';scenePlayback.phase='loading';scenePlayback.error=null;scenePlaybackNotify();
 const stop=scenePlayback.stops[index],owner=scenePlayback.owner,valid=()=>token===scenePlayback.token&&scenePlayback.status==='playing';
 try{
  sceneOwnerGuard(owner);if(scenePlayback.project!==state.panoramas)throw sceneError('PROJECT_CHANGED','Palace changed during playback.');
  await sceneSelectReady(stop.panoId,owner);if(!valid())return;
  scenePlayback.phase='moving';scenePlaybackNotify();
  const options={duration:resume?.phase==='holding'?0:resume?.remaining??stop.duration,easing:stop.easing};
  if(stop.anchorId){const anchor=sceneGet(stop.anchorId);if(anchor.panoId!==activeLocalPano)throw sceneError('ANCHOR_NOT_FOUND','Playback anchor panorama changed.');sceneRuntime.selected=anchor.id;sceneSync(true);await sceneAnimateCamera(sceneLookTarget(anchor.position),options,owner,true)}else await sceneAnimateCamera(stop.pose||{},options,owner,true);
  if(!valid())return;scenePlayback.phase='holding';const hold=resume?.phase==='holding'?resume.remaining:stop.hold;scenePlayback.deadline=performance.now()+hold;scenePlaybackNotify();
  if(scenePlayback.manual){scenePlayback.manual=false;scenePlaybackPause();return}
  scenePlayback.timer=setTimeout(()=>{if(!valid())return;const next=index+1;if(next<scenePlayback.stops.length)scenePlaybackGo(next);else if(scenePlayback.loop)scenePlaybackGo(0);else scenePlaybackComplete()},hold);
 }catch(error){if(!valid())return;scenePlayback.status='error';scenePlayback.phase='idle';scenePlayback.error=error.message;scenePlaybackNotify()}
}
function scenePlaybackStart(config,owner){
 sceneOwnerGuard(owner);if(!config||!Array.isArray(config.stops)||!config.stops.length||config.stops.length>200||config.loop!=null&&typeof config.loop!=='boolean')throw sceneError('INVALID_ARGUMENT','Playback needs 1–200 stops and an optional boolean loop.');
 const stops=Array.from(config.stops).map(stop=>{if(!stop||typeof stop!=='object')throw sceneError('INVALID_ARGUMENT','Invalid playback stop.');const panoId=scenePano(stop.panoId),result={panoId,duration:sceneNumber(stop.duration??2000,'duration',0,8000),hold:sceneNumber(stop.hold??3000,'hold',0,600000),easing:sceneCameraOptions(stop).easing};if(stop.anchorId){const a=sceneGet(stop.anchorId);if(a.panoId!==panoId)throw sceneError('INVALID_ARGUMENT','Playback anchor belongs to another panorama.');result.anchorId=a.id}if(stop.pose){for(const key of Object.keys(stop.pose))if(!['yaw','pitch','roll','fov'].includes(key)||!Number.isFinite(stop.pose[key]))throw sceneError('INVALID_ARGUMENT','Playback pose supports finite yaw/pitch/roll/fov.');result.pose={...stop.pose}}return result});
 scenePlaybackStop();scenePlayback.stops=stops;scenePlayback.loop=!!config.loop;scenePlayback.owner=owner;scenePlayback.project=state.panoramas;scenePlayback.manual=false;scenePlaybackGo(0);return scenePlaybackState();
}
function scenePlaybackResume(){if(scenePlayback.status!=='paused')throw sceneError('PLAYBACK_NOT_PAUSED','Only paused playback can resume.');const resume={phase:scenePlayback.phase,remaining:scenePlayback.remaining};scenePlaybackGo(scenePlayback.index,resume);return scenePlaybackState()}
function scenePlaybackNext(direction){
 if(!scenePlayback.stops.length)throw sceneError('PLAYBACK_EMPTY','Start a tour first.');
 let index=scenePlayback.index+direction;if(scenePlayback.loop)index=(index+scenePlayback.stops.length)%scenePlayback.stops.length;else index=Math.max(0,Math.min(scenePlayback.stops.length-1,index));
 scenePlayback.manual=scenePlayback.status!=='playing';scenePlaybackGo(index);return scenePlaybackState();
}
const sceneCameraTick=localViewer.tick;localViewer.tick=function(...args){sceneCameraStep(performance.now());const result=sceneCameraTick.apply(this,args);sceneCameraNotify();return result};
const sceneCameraAnimating=localViewer.isAnimating;localViewer.isAnimating=function(...args){return !!sceneCameraAnimation||sceneCameraAnimating.apply(this,args)};
const sceneCameraDispose=localViewer.dispose;localViewer.dispose=function(...args){if(!this.renderer)return sceneCameraDispose.apply(this,args);sceneCancelAnimation('Renderer was disposed.');if(['playing','paused'].includes(scenePlayback.status))scenePlaybackStop('Renderer was disposed.');for(const waiter of sceneWaiters){clearTimeout(waiter.timer);waiter.reject(sceneError('PANORAMA_CHANGED','Renderer was disposed.'))}sceneWaiters.clear();return sceneCameraDispose.apply(this,args)};
const sceneCameraLayout=applyLayout;applyLayout=function(...args){if(state.layout==='plan'&&scenePlayback.status==='playing')scenePlaybackStop('Panorama view was closed.');return sceneCameraLayout.apply(this,args)};
const sceneCameraStopAddon=stopAddon;stopAddon=function(id){if(sceneCameraAnimation?.owner?.record.id===id)sceneCancelAnimation('Addon was stopped.');if(scenePlayback.owner?.record.id===id&&['playing','paused'].includes(scenePlayback.status))scenePlaybackStop('Addon was stopped.');return sceneCameraStopAddon(id)};
document.addEventListener('pointerdown',event=>{if(event.target===localViewer.canvas){if(scenePlayback.status==='playing')scenePlaybackPause();sceneCancelAnimation('Camera controlled by the user.')}},true);
document.addEventListener('wheel',event=>{if(event.target===localViewer.canvas){if(scenePlayback.status==='playing')scenePlaybackPause();sceneCancelAnimation('Camera controlled by the user.')}},{capture:true,passive:true});
const sceneCameraShow=localViewer.show;localViewer.show=function(canvas,id,...args){if(id!==this.currentId){sceneCancelAnimation('Panorama changed.',id===sceneProgrammaticSelection);if(scenePlayback.status==='playing'&&scenePlayback.stops[scenePlayback.index]?.panoId!==id)scenePlaybackStop('Panorama selected manually.')}return sceneCameraShow.call(this,canvas,id,...args)};

const sceneHostDocument=addonHostDocument;
addonHostDocument=function(record,channel){
 const source=sceneHostDocument(record,channel),subscribe=`function subscribeTourEvent(event,handler){if(typeof handler!=='function')throw new Error('Event handler must be a function');const id='tour-'+(++seq);let active=true;const listener=e=>{if(active&&e.source===parent&&e.data?.channel===data.channel&&e.data.type==='tourEvent'&&e.data.id===id)try{const result=handler(e.data.payload);if(result&&typeof result.catch==='function')result.catch(error=>send('error',{message:error.message}))}catch(error){send('error',{message:error.message})}};window.addEventListener('message',listener);const ready=rpc('tour.events.subscribe',{id,event});ready.catch(()=>{});return {ready,dispose(){active=false;window.removeEventListener('message',listener);rpc('tour.events.unsubscribe',id).catch(()=>{})}}};`;
 const extras=`anchors:{create:input=>rpc('tour.anchors.create',input),update:(id,patch)=>rpc('tour.anchors.update',{id,patch}),remove:id=>rpc('tour.anchors.remove',id),get:id=>rpc('tour.anchors.get',id),list:panoId=>rpc('tour.anchors.list',panoId),clear:panoId=>rpc('tour.anchors.clear',panoId)},scene:{getInfo:panoId=>rpc('tour.scene.getInfo',panoId),raycast:input=>rpc('tour.scene.raycast',input),project:position=>rpc('tour.scene.project',position),unproject:(screenPosition,depth)=>rpc('tour.scene.unproject',{screenPosition,depth}),configure:(panoId,input)=>rpc('tour.scene.configure',{panoId,input})},camera:{getPose:()=>rpc('tour.camera.getPose'),setPose:pose=>rpc('tour.camera.setPose',pose,30000),lookAt:(target,options)=>rpc('tour.camera.lookAt',{target,options},30000),moveTo:(target,options)=>rpc('tour.camera.moveTo',{target,options},30000),focusAnchor:(anchorId,options)=>rpc('tour.camera.focusAnchor',{anchorId,options},30000),stopAnimation:()=>rpc('tour.camera.stopAnimation')},playback:{start:config=>rpc('tour.playback.start',config),pause:()=>rpc('tour.playback.pause'),resume:()=>rpc('tour.playback.resume'),stop:()=>rpc('tour.playback.stop'),next:()=>rpc('tour.playback.next'),previous:()=>rpc('tour.playback.previous'),getState:()=>rpc('tour.playback.getState')},waitForPanoramaReady:(panoId,options)=>rpc('tour.waitForPanoramaReady',{panoId,options},30000),...Object.fromEntries(['CameraChanged','PanoramaReady','AnchorClick','AnchorHover','AnchorMoved','PlaybackChanged'].map(event=>['on'+event,handler=>subscribeTourEvent(event,handler)])),`;
 const adjusted=source.split('\n').map(line=>line.startsWith('function rpc(method,args){')?line.replace('function rpc(method,args){','function rpc(method,args,timeoutMs=10000){').replace("new Error('API timeout'))},10000)","new Error('API timeout'))},timeoutMs)"):line).join('\n');return rewriteAddonHostApi(adjusted,api=>api.replace('const api=Object.freeze({',subscribe+'\nconst api=Object.freeze({').replace('tour:{','tour:{'+extras));
};
const sceneAddonRPC=addonRPC;
addonRPC=async function(host,method,args){
 if(typeof method!=='string')throw sceneError('INVALID_ARGUMENT','Invalid API method.');
 if(method.startsWith('tour.events.')){
  host.sceneSubscriptions??=new Map();if(method==='tour.events.unsubscribe')return host.sceneSubscriptions.delete(args);
  if(!args||typeof args.id!=='string'||!/^tour-\d+$/.test(args.id)||!['CameraChanged','PanoramaReady','AnchorClick','AnchorHover','AnchorMoved','PlaybackChanged'].includes(args.event))throw sceneError('INVALID_ARGUMENT','Invalid event subscription.');
  if(!sceneEventAllowed(host,args.event))throw sceneError('PERMISSION_DENIED','Permission denied for '+args.event+'.');if(host.sceneSubscriptions.size>=60&&!host.sceneSubscriptions.has(args.id))throw sceneError('LIMIT_EXCEEDED','Maximum 60 tour event subscriptions.');host.sceneSubscriptions.set(args.id,args.event);return {id:args.id,event:args.event};
 }
 if(method.startsWith('tour.anchors.')){
  const name=method.slice('tour.anchors.'.length);sceneRequire(host,['create','update','remove','clear'].includes(name)?'anchors.write':'anchors.read');
  if(name==='create')return sceneCreate(args);if(name==='update')return sceneUpdate(args?.id,args?.patch);if(name==='remove')return sceneRemove(args);if(name==='get')return sceneGet(args);if(name==='list')return sceneList(args);if(name==='clear')return sceneClear(args);
 }
 if(method.startsWith('tour.scene.')){
  const name=method.slice('tour.scene.'.length);sceneRequire(host,name==='configure'?'scene.write':'scene.read');
  if(name==='getInfo')return sceneInfo(args);if(name==='configure')return sceneConfigure(args?.panoId,args?.input);if(name==='raycast')return sceneRaycast(args);if(name==='project')return sceneProject(args);if(name==='unproject')return sceneUnproject(args?.screenPosition,args?.depth);
 }
 if(method==='tour.waitForPanoramaReady'){sceneRequire(host,'scene.read');return sceneWaitReady(args?.panoId,args?.options||{},host)}
 if(method.startsWith('tour.camera.')){
  sceneRequire(host,'camera.control');sceneOwnerGuard(host);const name=method.slice('tour.camera.'.length);
  if(name==='getPose')return scenePose();if(name==='setPose')return sceneAnimateCamera(args,args,host);if(name==='lookAt')return sceneAnimateCamera(sceneLookTarget(args?.target),args?.options||{},host);
  if(name==='moveTo'){if(args?.target?.anchorId)sceneRequire(host,'anchors.read');return sceneMoveTo(args?.target,args?.options||{},host)}
  if(name==='focusAnchor'){sceneRequire(host,'anchors.read');return sceneFocusAnchor(args?.anchorId,args?.options||{},host)}
  if(name==='stopAnimation'){const active=!!sceneCameraAnimation;if(scenePlayback.status==='playing')scenePlaybackPause();return sceneCancelAnimation()||active}
 }
 if(method.startsWith('tour.playback.')){
  sceneRequire(host,'camera.control');sceneOwnerGuard(host);const name=method.slice('tour.playback.'.length);
  if(name==='start'){sceneRequire(host,'scene.read');if(args?.stops?.some(stop=>stop.anchorId))sceneRequire(host,'anchors.read');return scenePlaybackStart(args,host)}
  if(name==='getState')return scenePlaybackState();
  if(scenePlayback.owner&&scenePlayback.owner!==host)throw sceneError('PLAYBACK_OWNED','Another addon owns the active tour.');
  if(name==='pause')return scenePlaybackPause();if(name==='resume')return scenePlaybackResume();if(name==='stop')return scenePlaybackStop();if(name==='next')return scenePlaybackNext(1);if(name==='previous')return scenePlaybackNext(-1);
 }
 if(['tour.pose','tour.select'].includes(method)){if(scenePlayback.status==='playing')scenePlaybackStop('Camera controlled manually.');sceneCancelAnimation('Legacy camera command.');}
 if(/^tour\.(anchors|scene|camera|playback)\./.test(method))throw sceneError('UNKNOWN_METHOD','Unknown scene API method.');
 return sceneAddonRPC(host,method,args);
};
