/* Unified camera editing. Selection never navigates away from the plan. */
let editedCameraId = null, cameraLinkSource = null;
const cameraStyle = document.createElement('style');
cameraStyle.textContent = `
.camera-action:focus-visible{outline:2px solid var(--blue);outline-offset:2px}
.tool-camera #plan .plan-cam{cursor:grab}.tool-camera #plan .plan-cam.dragging{cursor:grabbing}
.tool-camera #plan .plan-cam.camera-edit-selected{outline:3px solid var(--blue)!important;outline-offset:4px;background:var(--vscode-button-bg)!important;color:#fff!important;z-index:5}
.tool-camera #plan .plan-cam.camera-edit-connected{outline:2px solid var(--blue)!important;outline-offset:2px;box-shadow:0 0 0 5px color-mix(in srgb,var(--blue) 20%,transparent)!important;z-index:4}
#plan .plan-cam .camera-action{box-sizing:border-box;position:absolute;right:-12%;top:-12%;display:flex;align-items:center;justify-content:center;width:34%;height:34%;min-width:0;min-height:0;padding:0;border:calc(var(--camera-marker-size,68px)*.022) solid var(--panel);border-radius:50%;background:var(--vscode-button-bg);color:#fff;font:700 calc(var(--camera-marker-size,68px)*.24)/1 system-ui;cursor:pointer;z-index:8;transform:rotate(var(--mrot,0deg));transform-origin:center}
#plan .plan-cam .camera-action[data-action=remove-link],#plan .plan-cam .camera-action[data-action=delete-camera]{background:var(--red);color:#fff}
#plan .plan-cam .camera-action[data-action=set-start]{right:auto;top:auto;left:-12%;bottom:-12%}
#plan .plan-cam .camera-action[data-action=set-start][aria-pressed=true]{background:var(--yellow);color:var(--panel)}
#plan .plan-cam .camera-action .ic{width:60%;height:60%}
.camera-link-lines{position:absolute;inset:0;display:block;width:100%;height:100%;max-width:none;overflow:visible;pointer-events:none;z-index:1}
.camera-link-lines line{stroke:var(--blue);stroke-width:2;stroke-dasharray:6 5;opacity:.5;vector-effect:non-scaling-stroke}
.camera-link-lines line.selected{stroke-width:3;opacity:1}
.tool-camera #markerCtl{display:none}
`;
document.head.append(cameraStyle);
async function openCameraEditor(id, link = false) {
  if (!canEditPlan() || !state.panoramas[id]) return false;
  cameraLinkSource = null;
  state.tool = 'camera';
  const floor = state.panoramas[id].floorId;
  const index = state.levels.findIndex(l => String(l.floorId) === String(floor));
  if (index >= 0 && index !== state.active) selectLevel(index);
  state.layout = 'plan';
  await setPlanView('2d');
  applyLayout();syncTools();drawPlan();
  selectCameraForEditing(String(id));
  refreshCameraEditor();
  return true;
}
function selectCameraForEditing(id) {
  if (!canEditPlan() || state.tool !== 'camera' || !state.panoramas[id]) return;
  editedCameraId = id;
  refreshCameraEditor();
}
function refreshCameraEditor() {
  const editing = state.tool === 'camera' && canEditPlan(), panos = state.panoramas || {};
  cameraLinkSource = null;
  if (editing) {
    const ids = level() ? panoramasForLevel(level()) : [];
    if (!panos[editedCameraId] || !ids.includes(editedCameraId)) editedCameraId = ids.includes(activeLocalPano) ? activeLocalPano : ids[0] || null;
  }
  document.querySelectorAll('#plan .plan-cam').forEach(node=>{
    const id=node.dataset.pano,selected=editing&&id===editedCameraId,connected=editing&&!!editedCameraId&&id!==editedCameraId&&(linkedCamera(editedCameraId,id)||linkedCamera(id,editedCameraId));
    node.classList.toggle('camera-edit-selected',selected);node.classList.toggle('camera-edit-connected',connected);node.setAttribute('aria-pressed',String(selected));
    const base=Math.max(20,Math.round(1.24*markerSize()));
    node.style.width=node.style.height=base+'px';
    node.style.setProperty('--camera-marker-size',base+'px');
    node.querySelectorAll('.camera-action').forEach(button=>button.remove());
    if(!editing)return;
    node.title='Камера: '+(panos[id]?.room||id);
    if(!editedCameraId)return;
    const button=document.createElement('button');button.type='button';button.className='camera-action';button.dataset.target=id;
    button.dataset.action=selected?'delete-camera':connected?'remove-link':'add-link';
    if(selected){button.id='cameraEditorDelete';button.title='Удалить камеру';button.innerHTML='<svg class="ic"><use href="#i-trash"/></svg>'}
    else {button.textContent=connected?'−':'+';button.title=(connected?'Удалить переход: ':'Добавить переход: ')+(panos[id]?.room||id)}
    button.setAttribute('aria-label',button.title);
    ['pointerdown','pointerup','mousedown','mouseup','keydown','contextmenu'].forEach(type=>button.addEventListener(type,event=>event.stopPropagation()));
    button.onclick=event=>{event.stopPropagation();if(!canEditPlan())return;if(selected)requestCameraDeletion(id);else{changeCameraTransition(editedCameraId,id,!connected);cameraLinkSource=null;refreshCameraEditor()}};
    node.append(button);
    if(selected){
      const flag=document.createElement('button');flag.type='button';flag.id='cameraEditorStart';flag.className='camera-action';flag.dataset.action='set-start';flag.dataset.target=id;
      flag.title='Сделать начальной камерой';flag.setAttribute('aria-label',flag.title);flag.setAttribute('aria-pressed',String(state.startPano===id));
      flag.innerHTML='<svg class="ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 14V2m0 0h9l-2 3 2 3H3"/></svg>';
      ['pointerdown','pointerup','mousedown','mouseup','keydown','contextmenu'].forEach(type=>flag.addEventListener(type,event=>event.stopPropagation()));
      flag.onclick=event=>{event.stopPropagation();if(canEditPlan()&&state.panoramas[id]){if(state.startPano!==id)setStartPano(id);refreshCameraEditor()}};
      node.append(flag);
    }
  });
  renderCameraPlanLinks();
}
function requestCameraDeletion(id){if(canEditPlan()&&state.panoramas[id])ask('Удалить камеру «'+(state.panoramas[id].room||id)+'» и её переходы?',()=>removeEditedCamera(id),{yes:'Удалить',title:'Удаление камеры'})}
function renderCameraPlanLinks() {
  const plan=document.querySelector('#plan');if(!plan)return;
  plan.querySelector('.camera-link-lines')?.remove();
  if(reviewSession)return;
  const ids=new Set([...plan.querySelectorAll('.plan-cam')].map(node=>node.dataset.pano));
  const panos=state.panoramas||{},seen=new Set();
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.classList.add('camera-link-lines');svg.setAttribute('aria-hidden','true');
  svg.setAttribute('viewBox',`0 0 ${plan.offsetWidth} ${plan.offsetHeight}`);svg.setAttribute('preserveAspectRatio','none');
  for(const id of ids){const from=panos[id];if(!from?.planPx)continue;
    for(const destination of from.destinations||[]){const target=String(destination.panoId),to=panos[target];if(target===id||!ids.has(target)||!to?.planPx||from.floorId!==to.floorId)continue;
      const key=JSON.stringify([id,target].sort());if(seen.has(key))continue;seen.add(key);
      const line=document.createElementNS(svg.namespaceURI,'line');
      line.dataset.from=id;line.dataset.to=target;
      if(state.tool==='camera'&&canEditPlan()&&(id===editedCameraId||target===editedCameraId))line.classList.add('selected');
      Object.entries({x1:from.planPx.x,y1:from.planPx.y,x2:to.planPx.x,y2:to.planPx.y}).forEach(([key,value])=>line.setAttribute(key,value));svg.append(line);
    }
  }
  if(svg.childElementCount)plan.append(svg);
}
function removeEditedCamera(id) {
  if (!canEditPlan() || !state.panoramas[id]) return false;
  flushHistorySoft();
  delete state.panoramas[id];
  Object.values(state.panoramas).forEach(p=>p.destinations=(p.destinations||[]).filter(d=>String(d.panoId)!==String(id)));
  state.levels.forEach(level=>(level.markers||[]).forEach(marker=>{if(String(marker.localPano)===String(id))delete marker.localPano}));
  if(state.startPano===id){state.startPano=null;state.startYaw=null}
  if(activeLocalPano===id)activeLocalPano=null;
  editedCameraId=null;cameraLinkSource=null;touch();render();renderMinimap();refreshCameraEditor();
  status('Камера удалена. Отмена: Ctrl/Cmd+Z');return true;
}
const cameraOriginalRender=renderPlanCameras;
renderPlanCameras=function(...args){cameraOriginalRender(...args);refreshCameraEditor()};
const cameraOriginalSyncTools=syncTools;
syncTools=function(...args){const result=cameraOriginalSyncTools(...args);refreshCameraEditor();return result};
const cameraOriginalApplyMode=applyMode;
applyMode=function(...args){const result=cameraOriginalApplyMode(...args);refreshCameraEditor();return result};
refreshCameraEditor();

window.moveCameraPlanLinks=function(id,point){
  document.querySelectorAll('#plan .camera-link-lines line').forEach(line=>{
    if(line.dataset.from===String(id)){line.setAttribute('x1',point.x);line.setAttribute('y1',point.y)}
    if(line.dataset.to===String(id)){line.setAttribute('x2',point.x);line.setAttribute('y2',point.y)}
  });
};

const cameraApplyLayout=applyLayout;
applyLayout=function(...args){const result=cameraApplyLayout(...args);if(state.layout!=='split'&&state.layout!=='split-rev'){document.querySelectorAll('#plan .plan-view-cone').forEach(node=>node.remove());planCone.el=null;planCone.path=null;}refreshCameraEditor();return result};

window.openCameraTool=async function(){
  if(!canEditPlan())return;
  state.tool='camera';state.layout='plan';
  await setPlanView('2d',true);applyLayout();syncTools();drawPlan();refreshCameraEditor();
};
