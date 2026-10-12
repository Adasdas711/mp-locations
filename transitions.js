'use strict';
let transitionCameraId = null;
persistenceStyle.textContent += '#cameraTransitionsOpen[hidden]{display:none!important}';
const transitionModal = persistenceModal('cameraTransitions', 'Переходы камеры', `
<p id="transitionSource"></p><p>Переходы соединяют две камеры в обе стороны. Удаление убирает оба направления. Изменения сохраняются в дворце; Ctrl+Z отменяет последнее изменение.</p>
<div class="persistence-actions"><label for="transitionTarget">Камера назначения</label><select id="transitionTarget"></select><button id="transitionAdd" class="primary">Добавить переход</button></div>
<div id="transitionList"></div><p id="transitionMessage" role="status"></p><button id="transitionClose">Закрыть</button>`);
function linkedCamera(a,b) {
  return (state.panoramas[a]?.destinations||[]).some(link=>String(link.panoId)===String(b));
}
function changeCameraTransition(source,target,add) {
  if (!canEditPlan()) return false;
  source=String(source); target=String(target);
  const a=state.panoramas[source],b=state.panoramas[target];
  if(!a||!b||source===target)return false;
  if(add&&linkedCamera(source,target)&&linkedCamera(target,source))return false;
  if(!add&&!linkedCamera(source,target)&&!linkedCamera(target,source))return false;
  for(const [from,to] of [[source,target],[target,source]]) {
    const camera=state.panoramas[from];
    camera.destinations=Array.isArray(camera.destinations)?camera.destinations:[];
    if(add) {
      if(!linkedCamera(from,to))camera.destinations.push({panoId:to,room:state.panoramas[to].room||to,angleDeg:null});
    } else camera.destinations=camera.destinations.filter(link=>String(link.panoId)!==to);
  }
  touch(); render();
  status(add?'Переход добавлен в обе стороны':'Переход удалён в обе стороны');
  return true;
}
function renderCameraTransitions() {
  const camera=state.panoramas[transitionCameraId];
  const editable=canEditPlan()&&!!camera;
  document.querySelector('#transitionSource').textContent=camera?'Камера: '+(camera.room||transitionCameraId):'Камера недоступна';
  const select=document.querySelector('#transitionTarget');
  const selected=select.value;
  select.replaceChildren();
  for(const id of Object.keys(state.panoramas)) {
    if(id===transitionCameraId||linkedCamera(transitionCameraId,id)&&linkedCamera(id,transitionCameraId))continue;
    const option=document.createElement('option');option.value=id;
    const peer=state.panoramas[id];
    option.textContent=(peer.room||id)+(peer.floorId!=null?' · этаж '+peer.floorId:'');
    select.appendChild(option);
  }
  if([...select.options].some(option=>option.value===selected))select.value=selected;
  select.disabled=!editable||!select.options.length;
  document.querySelector('#transitionAdd').disabled=select.disabled;
  const list=document.querySelector('#transitionList');list.replaceChildren();
  const peers=Object.keys(state.panoramas).filter(id=>id!==transitionCameraId&&(linkedCamera(transitionCameraId,id)||linkedCamera(id,transitionCameraId)));
  if(!peers.length)list.textContent='Переходов пока нет.';
  for(const id of peers) {
    const row=document.createElement('div');row.className='recovery-row';
    const label=document.createElement('span');label.textContent=state.panoramas[id].room||id;
    const remove=document.createElement('button');remove.textContent='Удалить переход';remove.dataset.target=id;remove.disabled=!editable;
    remove.addEventListener('click',()=>{changeCameraTransition(transitionCameraId,id,false);renderCameraTransitions()});
    row.append(label,remove);list.appendChild(row);
  }
  document.querySelector('#transitionMessage').textContent=editable?'':'Переходы изменяются в режиме редактирования.';
}
function openCameraTransitions(id) {
  if(!canEditPlan()||!state.panoramas[id])return;
  transitionCameraId=String(id);renderCameraTransitions();showPersistenceModal(transitionModal);
}
document.querySelector('#transitionAdd').addEventListener('click',()=>{changeCameraTransition(transitionCameraId,document.querySelector('#transitionTarget').value,true);renderCameraTransitions()});
document.querySelector('#transitionClose').addEventListener('click',()=>closePersistenceModal(transitionModal));
const transitionButton=document.createElement('button');transitionButton.id='cameraTransitionsOpen';transitionButton.textContent='Переходы';transitionButton.type='button';
document.querySelector('#tourToolbarLocal').appendChild(transitionButton);
transitionButton.addEventListener('click',()=>openCameraTransitions(activeLocalPano));
const transitionApplyMode=applyMode;
applyMode=function(){transitionApplyMode();transitionButton.hidden=!canEditPlan();transitionButton.disabled=!activeLocalPano;if(transitionModal.classList.contains('show'))renderCameraTransitions()};
applyMode();
