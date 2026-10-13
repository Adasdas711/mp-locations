/* SDK 1.5: persistent objects in the panorama renderer, not screen overlays. */
'use strict';
const SCENE_ANCHOR_LIMIT=500,SCENE_JSON_LIMIT=8*1024*1024;
const sceneRuntime={group:null,geometry:null,meshes:new Map(),key:null,model:null,ready:null,pending:null,hover:null,selected:null};
state.sceneAnchors={};state.sceneConfigurations={};
function sceneError(code,message){const error=new Error(code+': '+message);error.code=code;return error}
function scenePoint(value,name='position',limit=100000){
 if(!value||typeof value!=='object'||['x','y','z'].some(k=>!Number.isFinite(value[k])||Math.abs(value[k])>limit))throw sceneError('INVALID_ARGUMENT',name+' requires finite x/y/z within ±'+limit+'.');
 return {x:value.x,y:value.y,z:value.z};
}
function sceneNumber(value,name,min,max){if(!Number.isFinite(value)||value<min||value>max)throw sceneError('INVALID_ARGUMENT',name+' must be between '+min+' and '+max+'.');return value}
function sceneId(id){if(typeof id!=='string'||!/^[a-zA-Z0-9._-]{1,100}$/.test(id)||['__proto__','constructor','prototype'].includes(id))throw sceneError('INVALID_ARGUMENT','Invalid anchor ID.');return id}
function scenePano(id=activeLocalPano){if(typeof id!=='string'||!Object.hasOwn(state.panoramas,id))throw sceneError('PANORAMA_NOT_FOUND','Choose an existing panorama.');return id}
function sceneJSON(value,limit=16384){
 let text;try{text=JSON.stringify(value,(key,v)=>{if(typeof v==='function'||typeof v==='bigint'||typeof v==='symbol'||typeof v==='number'&&!Number.isFinite(v))throw new Error();return v})}catch{throw sceneError('INVALID_ARGUMENT','Metadata must be finite JSON data.')}
 if(!text||text.length>limit)throw sceneError('LIMIT_EXCEEDED','JSON data is too large.');return JSON.parse(text);
}
function sceneGeometryData(value,maxVertices=30000){
 if(!value||!Array.isArray(value.positions)||!value.positions.length||value.positions.length%9&& !value.indices||value.positions.length%3||value.positions.length>maxVertices*3||Array.from(value.positions).some(n=>!Number.isFinite(n)||Math.abs(n)>100000))throw sceneError('INVALID_GEOMETRY','Provide finite triangle positions.');
 const count=value.positions.length/3,result={positions:[...value.positions]};
 if(value.indices!=null){if(!Array.isArray(value.indices)||!value.indices.length||value.indices.length%3||value.indices.length>180000||Array.from(value.indices).some(i=>!Number.isInteger(i)||i<0||i>=count))throw sceneError('INVALID_GEOMETRY','Invalid triangle indices.');result.indices=[...value.indices]}
 if(value.uvs!=null){if(!Array.isArray(value.uvs)||value.uvs.length!==count*2||Array.from(value.uvs).some(n=>!Number.isFinite(n)||Math.abs(n)>10000))throw sceneError('INVALID_GEOMETRY','Invalid UV coordinates.');result.uvs=[...value.uvs]}
 return result;
}
function sceneStyle(value={}){
 if(!value||typeof value!=='object'||Array.isArray(value))throw sceneError('INVALID_ARGUMENT','Invalid style.');
 const style={type:value.type||'sphere',color:value.color||'#3592c4',size:value.size??.35,opacity:value.opacity??1};
 if(!['sphere','billboard','sprite','model'].includes(style.type)||!/^#[0-9a-f]{6}$/i.test(style.color))throw sceneError('INVALID_ARGUMENT','Invalid style type or #RRGGBB color.');
 sceneNumber(style.size,'size',.01,100);sceneNumber(style.opacity,'opacity',0,1);
 if(value.icon!=null){if(typeof value.icon!=='string'||value.icon.length>512*1024||!/^data:image\/(png|jpeg|webp|avif);base64,[A-Za-z0-9+/=]+$/.test(value.icon))throw sceneError('INVALID_ARGUMENT','icon must be a local raster image data URL, up to 512 KiB characters.');style.icon=value.icon}
 if(style.type==='model')style.model=sceneGeometryData(value.model,2048);
 return style;
}
function sceneAnchor(value,panos=state.panoramas){
 if(!value||typeof value!=='object'||Array.isArray(value))throw sceneError('INVALID_ARGUMENT','An anchor object is required.');
 const id=sceneId(value.id),panoId=value.panoId;if(typeof panoId!=='string'||!Object.hasOwn(panos,panoId))throw sceneError('PANORAMA_NOT_FOUND','Anchor panorama does not exist.');
 const anchor={id,panoId,position:scenePoint(value.position),rotation:scenePoint(value.rotation||{x:0,y:0,z:0},'rotation',Math.PI*100),scale:sceneNumber(value.scale??1,'scale',.001,100),label:value.label??'',visible:value.visible??true,interactive:value.interactive??true,style:sceneStyle(value.style)};
 if(typeof anchor.label!=='string'||anchor.label.length>500||typeof anchor.visible!=='boolean'||typeof anchor.interactive!=='boolean')throw sceneError('INVALID_ARGUMENT','Invalid label/visibility/interactivity.');
 if(value.metadata!=null){if(typeof value.metadata!=='object'||Array.isArray(value.metadata))throw sceneError('INVALID_ARGUMENT','metadata must be a JSON object.');anchor.metadata=sceneJSON(value.metadata)}
 return anchor;
}
function sceneConfiguration(value){
 if(!value||typeof value!=='object'||Array.isArray(value))throw sceneError('INVALID_ARGUMENT','A scene configuration is required.');
 const config={units:value.units||'scene-units'};if(!['scene-units','meters','model-units'].includes(config.units))throw sceneError('INVALID_ARGUMENT','Unknown units.');
 if(value.geometry){
  const g=value.geometry;
  config.geometry=g.source==='dollhouse'?{source:'dollhouse',origin:scenePoint(g.origin,'geometry.origin'),rotation:scenePoint(g.rotation||{x:0,y:0,z:0},'geometry.rotation',Math.PI*100)}:sceneGeometryData(g);
  if(g.source==='dollhouse')config.geometry.scale=sceneNumber(g.scale??1,'geometry.scale',.000001,1000000);
  config.geometry.render=g.render||'solid';if(!['solid','occlusion'].includes(config.geometry.render))throw sceneError('INVALID_ARGUMENT','Geometry render must be solid or occlusion.');
  config.geometry.color=g.color||'#777777';if(!/^#[0-9a-f]{6}$/i.test(config.geometry.color))throw sceneError('INVALID_ARGUMENT','Geometry color must be #RRGGBB.');
 }
 if(value.depthMap){
  const d=value.depthMap;if(!Number.isInteger(d.width)||!Number.isInteger(d.height)||d.width<4||d.height<3||d.width>256||d.height>128||!Array.isArray(d.data)||d.data.length!==d.width*d.height||Array.from(d.data).some(n=>!Number.isFinite(n)||n<0||n>100000))throw sceneError('INVALID_DEPTH_MAP','Depth map requires width/height and finite radial distances; zero means missing.');
  config.depthMap={width:d.width,height:d.height,data:[...d.data]};
 }
 sceneJSON(config,4*1024*1024);return config;
}
function sceneNormalizeProject(anchors={},configurations={},panos=state.panoramas){
 if(!anchors||typeof anchors!=='object'||Array.isArray(anchors)||Object.keys(anchors).length>SCENE_ANCHOR_LIMIT||!configurations||typeof configurations!=='object'||Array.isArray(configurations)||Object.keys(configurations).length>500)throw sceneError('INVALID_PROJECT','Invalid scene data.');
 const result={anchors:{},configurations:{}};
 for(const [id,value]of Object.entries(anchors)){if(id!==value?.id)throw sceneError('INVALID_PROJECT','Anchor ID does not match its key.');result.anchors[id]=sceneAnchor(value,panos)}
 for(const [id,value]of Object.entries(configurations)){if(!Object.hasOwn(panos,id))throw sceneError('INVALID_PROJECT','Scene panorama is missing.');result.configurations[id]=sceneConfiguration(value)}
 sceneJSON(result,SCENE_JSON_LIMIT);return result;
}
function sceneCommit(anchors=state.sceneAnchors,configurations=state.sceneConfigurations){
 requireEditing();sceneJSON({anchors,configurations},SCENE_JSON_LIMIT);flushHistorySoft();state.sceneAnchors=anchors;state.sceneConfigurations=configurations;touch();sceneSync(true);return true;
}
function sceneCreate(input){
 requireEditing();const anchor=sceneAnchor({...input,id:input?.id||crypto.randomUUID(),panoId:input?.panoId||activeLocalPano});
 if(Object.hasOwn(state.sceneAnchors,anchor.id))throw sceneError('ANCHOR_EXISTS','Anchor ID already exists.');if(Object.keys(state.sceneAnchors).length>=SCENE_ANCHOR_LIMIT)throw sceneError('LIMIT_EXCEEDED','Maximum 500 anchors per project.');
 sceneCommit({...state.sceneAnchors,[anchor.id]:anchor});sceneEmit('AnchorMoved',{panoId:anchor.panoId,anchorId:anchor.id,anchor:structuredClone(anchor),reason:'create'});return structuredClone(anchor);
}
function sceneGet(id){sceneId(id);const anchor=state.sceneAnchors[id];if(!anchor)throw sceneError('ANCHOR_NOT_FOUND','Anchor does not exist.');return structuredClone(anchor)}
function sceneUpdate(id,patch){
 requireEditing();const previous=sceneGet(id);if(!patch||typeof patch!=='object'||Array.isArray(patch)||Object.keys(patch).some(k=>!['panoId','position','rotation','scale','label','visible','interactive','style','metadata'].includes(k)))throw sceneError('INVALID_ARGUMENT','Invalid anchor patch.');
 const anchor=sceneAnchor({...previous,...patch,id,style:patch.style?{...previous.style,...patch.style}:previous.style});sceneCommit({...state.sceneAnchors,[id]:anchor});
 if(JSON.stringify(previous.position)!==JSON.stringify(anchor.position)||previous.panoId!==anchor.panoId)sceneEmit('AnchorMoved',{panoId:anchor.panoId,anchorId:id,anchor:structuredClone(anchor),previousPosition:previous.position,reason:'update'});
 return structuredClone(anchor);
}
function sceneRemove(id){requireEditing();sceneId(id);if(!Object.hasOwn(state.sceneAnchors,id))return false;const next={...state.sceneAnchors};delete next[id];sceneCommit(next);if(sceneRuntime.selected===id)sceneRuntime.selected=null;return true}
function sceneList(panoId=activeLocalPano){scenePano(panoId);return structuredClone(Object.values(state.sceneAnchors).filter(a=>a.panoId===panoId))}
function sceneClear(panoId){requireEditing();scenePano(panoId);const next=Object.fromEntries(Object.entries(state.sceneAnchors).filter(([,a])=>a.panoId!==panoId));const count=Object.keys(state.sceneAnchors).length-Object.keys(next).length;if(count)sceneCommit(next);return count}
function sceneConfigure(panoId,input){requireEditing();scenePano(panoId);const next={...state.sceneConfigurations};if(input===null)delete next[panoId];else {next[panoId]=sceneConfiguration(input);if(next[panoId].geometry?.source==='dollhouse'&&!DHM)throw sceneError('GEOMETRY_UNAVAILABLE','No imported dollhouse model is available.');}if(panoId===localViewer.currentId){if(typeof sceneCancelAnimation==='function')sceneCancelAnimation('Scene geometry changed.');if(localViewer.camera&&(!next[panoId]?.geometry||next[panoId].geometry.render!=='solid'))localViewer.camera.position.set(0,0,0)}sceneCommit(state.sceneAnchors,next);return sceneInfo(panoId)}
function sceneEmit(event,payload){
 for(const host of addonHosts.values())if(!host.error)for(const [id,name]of host.sceneSubscriptions||[])if(name===event&&sceneEventAllowed(host,event))host.frame.contentWindow?.postMessage({channel:host.channel,type:'tourEvent',id,event,payload},'*');
}
function sceneHasPermission(host,permission){const legacy={'anchors.read':'tour.read','anchors.write':'tour.write','scene.read':'tour.read','scene.write':'tour.write','camera.control':'view.control'};return host.record.manifest.permissions.includes(permission)||host.record.manifest.permissions.includes(legacy[permission])}
function sceneRequire(host,permission){if(!sceneHasPermission(host,permission))throw sceneError('PERMISSION_DENIED','Permission denied: '+permission+'.')}
function sceneEventAllowed(host,event){return sceneHasPermission(host,['AnchorClick','AnchorHover','AnchorMoved'].includes(event)?'anchors.read':event==='PanoramaReady'?'scene.read':'camera.control')}
function sceneActive(){scenePano();if(!localViewer.renderer||!localViewer.camera||localViewer.currentId!==activeLocalPano||sceneRuntime.ready?.panoId!==activeLocalPano)throw sceneError('PANORAMA_NOT_READY','Wait for onPanoramaReady or waitForPanoramaReady.');return localViewer}
function scenePose(){const v=sceneActive();return {panoId:v.currentId,position:{x:v.camera.position.x,y:v.camera.position.y,z:v.camera.position.z},yaw:v.yaw,pitch:v.pitch,roll:v.sceneRoll||0,fov:v.fov}}
function sceneInfo(panoId=activeLocalPano){
 scenePano(panoId);const config=state.sceneConfigurations[panoId]||{},geometry=!!config.geometry&&(config.geometry.source!=='dollhouse'||!!DHM),depth=!!config.depthMap;
 return {panoId,type:geometry&&config.geometry.render==='solid'?'3d':'panorama',coordinateSystem:{handedness:'right',axes:{x:'right',y:'up',z:'backward'},origin:'panorama capture point',rotationUnits:'radians',cameraAngleUnits:'degrees',units:config.units||'scene-units'},camera:panoId===activeLocalPano&&sceneRuntime.ready?.panoId===panoId?scenePose():{panoId,position:{x:0,y:0,z:0},yaw:0,pitch:0,roll:0,fov:75},ready:sceneRuntime.ready?.panoId===panoId&&localViewer.currentId===panoId,hasGeometry:geometry,hasDepthMap:depth,unregisteredDollhouseAvailable:!!DHM,panoramaRadius:500,capabilities:{anchors:true,raycast:geometry||depth,syntheticDistancePlacement:true,translation:geometry&&config.geometry.render==='solid',occlusion:geometry||depth,styles:['sphere','billboard','sprite','model']}};
}
function sceneBufferGeometry(data){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(data.positions,3));if(data.indices)g.setIndex(data.indices);if(data.uvs)g.setAttribute('uv',new THREE.Float32BufferAttribute(data.uvs,2));g.computeVertexNormals();g.computeBoundingSphere();return g}
function sceneDepthGeometry(depth){
 const positions=[],indices=[],{width:w,height:h,data}=depth;
 for(let y=0;y<h;y++)for(let x=0;x<=w;x++){const d=data[y*w+(x%w)],yaw=x/w*Math.PI*2,pitch=(y/(h-1)-.5)*Math.PI;positions.push(-Math.sin(yaw)*Math.cos(pitch)*d,-Math.sin(pitch)*d,-Math.cos(yaw)*Math.cos(pitch)*d)}
 for(let y=0;y<h-1;y++)for(let x=0;x<w;x++){const a=y*(w+1)+x,b=a+1,c=a+w+1,d=c+1;const valid=(xx,yy)=>data[yy*w+(xx%w)]>0;if(valid(x,y)&&valid(x+1,y)&&valid(x,y+1))indices.push(a,c,b);if(valid(x+1,y)&&valid(x+1,y+1)&&valid(x,y+1))indices.push(b,c,d)}
 return sceneBufferGeometry({positions,indices});
}
function sceneDisposeGroup(group){if(!group)return;group.parent?.remove(group);group.traverse(node=>{node.geometry?.dispose();for(const m of Array.isArray(node.material)?node.material:node.material?[node.material]:[]){m.map?.dispose();m.dispose()}})}
function sceneLabelTexture(anchor){
 const canvas=document.createElement('canvas');canvas.width=512;canvas.height=128;const c=canvas.getContext('2d');c.fillStyle=anchor.style.color;c.beginPath();c.roundRect?c.roundRect(2,2,508,124,20):c.rect(2,2,508,124);c.fill();c.fillStyle='#ffffff';c.font='bold 36px system-ui';c.textAlign='center';c.textBaseline='middle';c.fillText(anchor.label||'●',256,64,480);return new THREE.CanvasTexture(canvas);
}
function sceneSync(force=false){
 if(!window.THREE||!localViewer.scene||!localViewer.camera)return;
 const id=localViewer.currentId,anchors=Object.values(state.sceneAnchors||{}).filter(a=>a.panoId===id&&a.visible),config=state.sceneConfigurations?.[id]||{},key=JSON.stringify([id,anchors,config,sceneRuntime.selected]);
 if(!force&&sceneRuntime.key===key&&sceneRuntime.model===DHM&&sceneRuntime.group?.parent===localViewer.scene)return;
 sceneDisposeGroup(sceneRuntime.group);sceneDisposeGroup(sceneRuntime.geometry);sceneRuntime.meshes.clear();sceneRuntime.key=key;sceneRuntime.model=DHM;
 const group=sceneRuntime.group=new THREE.Group();group.name='palace-scene-anchors';localViewer.scene.add(group);
 const geometry=sceneRuntime.geometry=new THREE.Group();geometry.name='palace-scene-geometry';localViewer.scene.add(geometry);
 const geometryMaterial=solid=>new THREE.MeshBasicMaterial({color:config.geometry?.color||'#777777',side:THREE.DoubleSide,colorWrite:solid,depthWrite:true,depthTest:true});
 if(config.geometry){
  const g=config.geometry,solid=g.render==='solid';
  if(g.source==='dollhouse'&&DHM){const inverse=new THREE.Matrix4().compose(new THREE.Vector3(g.origin.x,g.origin.y,g.origin.z),new THREE.Quaternion().setFromEuler(new THREE.Euler(g.rotation.x,g.rotation.y,g.rotation.z)),new THREE.Vector3(1,1,1)).invert();inverse.premultiply(new THREE.Matrix4().makeScale(g.scale||1,g.scale||1,g.scale||1));for(let i=0;i<DHM.meta.chunks.length;i++){const mesh=new THREE.Mesh(dhmGeometry(i,false).clone(),geometryMaterial(solid));mesh.applyMatrix4(inverse);geometry.add(mesh)}}
  else if(g.positions)geometry.add(new THREE.Mesh(sceneBufferGeometry(g),geometryMaterial(solid)));
 }
 if(config.depthMap)geometry.add(new THREE.Mesh(sceneDepthGeometry(config.depthMap),geometryMaterial(false)));
 geometry.renderOrder=0;geometry.children.forEach(mesh=>mesh.renderOrder=-9999);
 for(const anchor of anchors){
  const root=new THREE.Group();root.userData.anchorId=anchor.id;root.position.set(anchor.position.x,anchor.position.y,anchor.position.z);root.rotation.set(anchor.rotation.x,anchor.rotation.y,anchor.rotation.z);root.scale.setScalar(anchor.scale);group.add(root);
  const style=anchor.style,material=new THREE.MeshBasicMaterial({color:style.color,transparent:style.opacity<1,opacity:style.opacity,depthTest:true});let mesh;
  if(style.type==='sphere')mesh=new THREE.Mesh(new THREE.SphereGeometry(style.size,16,12),material);
  else if(style.type==='model'){mesh=new THREE.Mesh(sceneBufferGeometry(style.model),material);mesh.scale.setScalar(style.size)}
  else if(style.type==='sprite'){material.dispose();mesh=new THREE.Sprite(new THREE.SpriteMaterial({map:sceneLabelTexture(anchor),color:'#ffffff',transparent:true,opacity:style.opacity,depthTest:true,depthWrite:false,sizeAttenuation:true}));mesh.scale.set(style.size*4,style.size,1)}
  else {mesh=new THREE.Mesh(new THREE.PlaneGeometry(style.size*4,style.size),material);material.side=THREE.DoubleSide;material.transparent=true;material.map=sceneLabelTexture(anchor);mesh.userData.billboard=true}
  root.add(mesh);sceneRuntime.meshes.set(anchor.id,root);
  if(style.icon){const image=new Image(),expectedRoot=root;image.onload=()=>{if(sceneRuntime.meshes.get(anchor.id)!==expectedRoot||!image.naturalWidth||!image.naturalHeight)return;const scale=Math.min(1,512/image.naturalWidth,512/image.naturalHeight),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);mesh.material.map?.dispose();mesh.material.map=new THREE.CanvasTexture(canvas);mesh.material.needsUpdate=true;localViewer.requestRender()};image.src=style.icon}
  if(anchor.label&&['sphere','model'].includes(style.type)){const label=new THREE.Sprite(new THREE.SpriteMaterial({map:sceneLabelTexture(anchor),depthTest:true,depthWrite:false,opacity:style.opacity,transparent:true}));label.position.y=style.size*1.8;label.scale.set(style.size*4,style.size,1);root.add(label)}
  if(sceneRuntime.selected===anchor.id){const halo=new THREE.Mesh(new THREE.SphereGeometry(style.size*1.2,12,8),new THREE.MeshBasicMaterial({color:'#ffd740',wireframe:true,depthTest:true}));root.add(halo)}
 }
 localViewer.mesh.material.depthWrite=false;localViewer.mesh.material.depthTest=false;localViewer.mesh.renderOrder=-10000;localViewer.camera.far=200000;localViewer.camera.updateProjectionMatrix();localViewer.requestRender();
}
function sceneCameraMatrices(){const v=sceneActive();v.camera.rotation.set(THREE.MathUtils.degToRad(v.pitch),THREE.MathUtils.degToRad(v.yaw),THREE.MathUtils.degToRad(v.sceneRoll||0),'YXZ');v.camera.updateMatrixWorld(true);v.scene.updateMatrixWorld(true);return v}
function sceneScreenPoint(point){if(!point||!Number.isFinite(point.x)||!Number.isFinite(point.y)||point.space!=null&&!['normalized','pixels'].includes(point.space))throw sceneError('INVALID_ARGUMENT','A screen position is required.');const rect=localViewer.canvas.getBoundingClientRect();if(point.space==='pixels'&&(!rect.width||!rect.height))throw sceneError('PANORAMA_NOT_VISIBLE','Pixel coordinates require a visible canvas.');const result=point.space==='pixels'?{x:point.x/rect.width,y:point.y/rect.height}:{x:point.x,y:point.y};if(result.x<0||result.x>1||result.y<0||result.y>1)throw sceneError('INVALID_ARGUMENT','Screen position must lie inside the canvas.');return result}
function sceneRay(input){
 const v=sceneCameraMatrices(),ray=new THREE.Raycaster();
 if(input?.screenPosition){const p=sceneScreenPoint(input.screenPosition);ray.setFromCamera(new THREE.Vector2(p.x*2-1,1-p.y*2),v.camera)}
 else {const origin=scenePoint(input?.origin,'origin'),direction=scenePoint(input?.direction,'direction'),d=new THREE.Vector3(direction.x,direction.y,direction.z);if(d.length()<1e-8)throw sceneError('INVALID_ARGUMENT','Ray direction cannot be zero.');ray.set(new THREE.Vector3(origin.x,origin.y,origin.z),d.normalize())}
 return ray;
}
function sceneRaycast(input){
 const ray=sceneRay(input),hits=ray.intersectObject(sceneRuntime.geometry,true);if(input?.includeAnchors)hits.push(...ray.intersectObject(sceneRuntime.group,true));hits.sort((a,b)=>a.distance-b.distance);const hit=hits[0];
 if(hit)return {panoId:activeLocalPano,position:{x:hit.point.x,y:hit.point.y,z:hit.point.z},distance:hit.distance,synthetic:false,source:hit.object.parent===sceneRuntime.geometry?'geometry':'anchor',anchorId:sceneObjectAnchor(hit.object)};
 if(input?.distance!=null){const distance=sceneNumber(input.distance,'distance',.1,400),p=ray.ray.at(distance,new THREE.Vector3());return {panoId:activeLocalPano,position:{x:p.x,y:p.y,z:p.z},distance,synthetic:true,source:'reference-distance',anchorId:null}}
 return null;
}
function sceneProject(position){
 const v=sceneCameraMatrices(),p=scenePoint(position),world=new THREE.Vector3(p.x,p.y,p.z),ndc=world.clone().project(v.camera),distance=world.distanceTo(v.camera.position),direction=world.clone().sub(v.camera.position).normalize(),ray=new THREE.Raycaster(v.camera.position,direction),obstacle=ray.intersectObject(sceneRuntime.geometry,true)[0],occluded=!!obstacle&&obstacle.distance<distance-.001;
 return {panoId:activeLocalPano,x:(ndc.x+1)/2,y:(1-ndc.y)/2,depth:distance,visible:ndc.z>=-1&&ndc.z<=1&&Math.abs(ndc.x)<=1&&Math.abs(ndc.y)<=1&&!occluded,occluded};
}
function sceneUnproject(screenPosition,depth){const ray=sceneRay({screenPosition}),p=ray.ray.at(sceneNumber(depth,'depth',.01,100000),new THREE.Vector3());return {x:p.x,y:p.y,z:p.z}}
function sceneObjectAnchor(object){while(object){if(object.userData?.anchorId)return object.userData.anchorId;object=object.parent}return null}
function sceneHit(event){
 if(!sceneRuntime.ready||sceneRuntime.ready.panoId!==localViewer.currentId||!localViewer.canvas)return null;
 const box=localViewer.canvas.getBoundingClientRect();if(!box.width||!box.height)return null;
 const input={screenPosition:{x:(event.clientX-box.left)/box.width,y:(event.clientY-box.top)/box.height}},ray=sceneRay(input),hits=ray.intersectObject(sceneRuntime.group,true);const obstacle=ray.intersectObject(sceneRuntime.geometry,true)[0];
 for(const hit of hits){const id=sceneObjectAnchor(hit.object),anchor=state.sceneAnchors[id];if(anchor?.interactive&&(!obstacle||obstacle.distance>=hit.distance-.001))return {id,position:{x:hit.point.x,y:hit.point.y,z:hit.point.z}}}return null;
}
function sceneBindPointer(canvas){
 if(canvas.dataset.sceneAnchorBound)return;canvas.dataset.sceneAnchorBound='true';let press=null,suppressClick=false;
 const activate=(hit,event)=>{if(!hit||!state.sceneAnchors[hit.id]?.interactive)return false;event.preventDefault();event.stopImmediatePropagation();localViewer.dragging=false;localViewer.velYaw=localViewer.velPitch=0;canvas.parentNode?.classList.remove('dragging');sceneRuntime.selected=hit.id;sceneSync(true);sceneEmit('AnchorClick',{panoId:activeLocalPano,anchorId:hit.id,anchor:sceneGet(hit.id),position:hit.position});return true};
 canvas.addEventListener('pointerdown',event=>{if(event.button&&event.pointerType==='mouse')return;suppressClick=false;press={id:event.pointerId,x:event.clientX,y:event.clientY,panoId:activeLocalPano,hit:sceneHit(event)}},true);
 canvas.addEventListener('pointermove',event=>{if(event.buttons||press)return;const hit=sceneHit(event),id=hit?.id||null;if(id!==sceneRuntime.hover){const previous=sceneRuntime.hover;sceneRuntime.hover=id;if(previous)sceneEmit('AnchorHover',{panoId:activeLocalPano,anchorId:previous,hovered:false});if(id)sceneEmit('AnchorHover',{panoId:activeLocalPano,anchorId:id,hovered:true,anchor:sceneGet(id)})}});
 canvas.addEventListener('pointerleave',()=>{if(sceneRuntime.hover)sceneEmit('AnchorHover',{panoId:activeLocalPano,anchorId:sceneRuntime.hover,hovered:false});sceneRuntime.hover=null});
 canvas.addEventListener('pointerup',event=>{const p=press;press=null;if(!p||p.id!==event.pointerId)return;if(p.panoId!==activeLocalPano||Math.hypot(event.clientX-p.x,event.clientY-p.y)>6){suppressClick=true;return}const hit=sceneHit(event)||p.hit;if(hit&&hit.id===p.hit?.id)suppressClick=activate(hit,event)},true);
 canvas.addEventListener('click',event=>{if(suppressClick){suppressClick=false;return}const p=press;press=null;if(p&&(p.panoId!==activeLocalPano||Math.hypot(event.clientX-p.x,event.clientY-p.y)>6))return;activate(sceneHit(event)||p?.hit,event)},true);
 canvas.addEventListener('pointercancel',()=>{press=null;suppressClick=true});
}
const sceneBlankState=blankState;blankState=function(){return {...sceneBlankState(),sceneAnchors:{},sceneConfigurations:{}}};
const sceneSerialize=buildSerializableState;buildSerializableState=function(...args){return {...sceneSerialize(...args),sceneAnchors:structuredClone(state.sceneAnchors||{}),sceneConfigurations:structuredClone(state.sceneConfigurations||{})}};
const sceneSnapshot=snapshotState;snapshotState=function(...args){return {...sceneSnapshot(...args),sceneAnchors:structuredClone(state.sceneAnchors||{}),sceneConfigurations:state.sceneConfigurations||{}}};
const sceneRestoreSnapshot=restoreSnapshot;restoreSnapshot=function(snapshot,...args){state.sceneAnchors=structuredClone(snapshot.sceneAnchors||{});state.sceneConfigurations=snapshot.sceneConfigurations||{};const result=sceneRestoreSnapshot(snapshot,...args);sceneSync(true);return result};
const sceneLoadPalace=loadMplaceBuffer;loadMplaceBuffer=async function(buffer){const zip=await JSZip.loadAsync(buffer),file=zip.file('palace.json'),data=file?JSON.parse(await file.async('string')):null;const normalized=data?sceneNormalizeProject(data.sceneAnchors||{},data.sceneConfigurations||{},data.panoramas||{}):null;await sceneLoadPalace(buffer);if(normalized){state.sceneAnchors=normalized.anchors;state.sceneConfigurations=normalized.configurations;resetHistory();sceneSync(true)}};
const sceneRemoveCamera=removeEditedCamera;removeEditedCamera=function(id){if(canEditPlan()&&state.panoramas[id]){flushHistorySoft();state.sceneAnchors=Object.fromEntries(Object.entries(state.sceneAnchors||{}).filter(([,a])=>a.panoId!==id));state.sceneConfigurations={...state.sceneConfigurations};delete state.sceneConfigurations[id]}return sceneRemoveCamera(id)};
const sceneRender=render;render=function(...args){const result=sceneRender(...args);sceneSync();return result};
const sceneRendererShow=localViewer.show;localViewer.show=function(canvas,id,pano,...args){
 if(id!==this.currentId){sceneRuntime.ready=null;sceneRuntime.pending=null;sceneRuntime.hover=null;sceneRuntime.selected=null;this.sceneRoll=0;if(this.camera)this.camera.position.set(0,0,0)}
 const result=sceneRendererShow.call(this,canvas,id,pano,...args);if(this.scene){sceneSync();sceneBindPointer(canvas);sceneWrapRenderer();if(pano?.mode!=='equirect'||!pano.data){sceneRuntime.pending={panoId:id};this.requestRender()}}return result;
};
const sceneImageRequested=localViewer.setImage;localViewer.setImage=function(...args){sceneRuntime.ready=null;sceneRuntime.pending=null;return sceneImageRequested.apply(this,args)};
const sceneTextureApplied=localViewer.applyCanvasTexture;localViewer.applyCanvasTexture=function(...args){const result=sceneTextureApplied.apply(this,args);sceneRuntime.pending={panoId:this.currentId};sceneSync(true);return result};
function sceneWrapRenderer(){
 const renderer=localViewer.renderer;if(!renderer||renderer.sceneSDKWrapped)return;renderer.sceneSDKWrapped=true;const renderFrame=renderer.render;
 renderer.render=function(scene,camera){
  if(scene===localViewer.scene&&camera===localViewer.camera){camera.rotation.z=THREE.MathUtils.degToRad(localViewer.sceneRoll||0);camera.updateMatrixWorld(true);if(sceneInfoSafeTranslation())localViewer.mesh.position.copy(camera.position);for(const root of sceneRuntime.meshes.values())for(const child of root.children)if(child.userData.billboard)child.quaternion.copy(camera.quaternion).premultiply(root.quaternion.clone().invert());}
  const result=renderFrame.call(this,scene,camera);
  const pending=sceneRuntime.pending;if(pending&&scene===localViewer.scene&&pending.panoId===localViewer.currentId&&pending.panoId===activeLocalPano){sceneRuntime.pending=null;sceneRuntime.ready={panoId:pending.panoId,ready:true,hasImage:!!localViewer.texture};sceneEmit('PanoramaReady',{...sceneRuntime.ready,scene:sceneInfo(pending.panoId)})}
  return result;
 };
}
function sceneInfoSafeTranslation(){const config=state.sceneConfigurations?.[localViewer.currentId];return !!config?.geometry&&config.geometry.render==='solid'}
const sceneDisposeViewer=localViewer.dispose;localViewer.dispose=function(...args){sceneDisposeGroup(sceneRuntime.group);sceneDisposeGroup(sceneRuntime.geometry);sceneRuntime.group=sceneRuntime.geometry=null;sceneRuntime.meshes.clear();sceneRuntime.key=sceneRuntime.ready=sceneRuntime.pending=null;return sceneDisposeViewer.apply(this,args)};
