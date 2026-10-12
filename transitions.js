'use strict';
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
// Legacy entry points now open the on-plan editor; there is no transition dialog.
function openCameraTransitions(id) {
  return openCameraEditor(id, true);
}
const transitionButton=document.createElement('button');transitionButton.id='cameraTransitionsOpen';transitionButton.textContent='Переходы на плане';transitionButton.type='button';
document.querySelector('#tourToolbarLocal').appendChild(transitionButton);
transitionButton.addEventListener('click',()=>openCameraTransitions(activeLocalPano));
function syncTransitionButton(){transitionButton.hidden=!canEditPlan();transitionButton.disabled=!canEditPlan()||!state.panoramas[activeLocalPano]}
const transitionRenderTour=renderTour;
renderTour=function(...args){const result=transitionRenderTour(...args);syncTransitionButton();return result};
const transitionApplyMode=applyMode;
applyMode=function(){transitionApplyMode();syncTransitionButton()};
applyMode();
