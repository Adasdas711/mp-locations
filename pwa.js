/* Installation uses the browser's native PWA flow; iOS provides a Share-sheet flow. */
'use strict';
let pwaPrompt=null,pwaInstalling=false,pwaInstalled=false;
const pwaDisplay=matchMedia('(display-mode: standalone)');
const pwaPage=document.createElement('section');
pwaPage.innerHTML='<div class="dialog"><h2>Приложение</h2><p class="settings-description">Установите PALACE на телефон: отдельный значок, запуск без адресной строки и работа офлайн после первой загрузки.</p><div class="pwa-install-card"><svg class="ic"><use href="#i-download"/></svg><div><strong>PALACE / Memory Mapper</strong><p>Дворцы памяти, планы и панорамы — на вашем устройстве.</p></div></div><button id="pwaInstall" type="button">Установить приложение</button><p id="pwaStatus" role="status" aria-live="polite"></p><ol id="pwaInstructions"></ol><p class="settings-description">Чтобы открыть дворец в приложении или на другом устройстве, сохраните файл .mpalace и загрузите его в приложение.</p></div>';
settingsPage('app','Приложение','download',pwaPage);
function pwaRefresh(){
 const installed=pwaInstalled||pwaDisplay.matches||navigator.standalone===true;
 const button=document.querySelector('#pwaInstall'),status=document.querySelector('#pwaStatus'),steps=document.querySelector('#pwaInstructions');
 const ios=/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
 const android=/Android/i.test(navigator.userAgent);
 button.hidden=installed;button.disabled=pwaInstalling;button.textContent=pwaPrompt?'Установить приложение':'Как установить';steps.replaceChildren();
 const instructions=ios?['Откройте этот сайт в Safari.','Нажмите «Поделиться», затем «На экран „Домой“».','Нажмите «Добавить» и запускайте PALACE с домашнего экрана.']:android?['Откройте этот сайт в Chrome.','В меню браузера выберите «Установить приложение» или «Добавить на главный экран».','Подтвердите установку и запускайте PALACE с домашнего экрана.']:['Откройте этот сайт в Chrome или Edge.','Нажмите значок установки в адресной строке или выберите «Установить приложение» в меню браузера.'];
 if(!installed&&!pwaPrompt)for(const text of instructions){const li=document.createElement('li');li.textContent=text;steps.append(li)}
 steps.hidden=installed||!!pwaPrompt;
 status.textContent=installed?'Приложение установлено.':!isSecureContext?'Для установки откройте сайт через HTTPS.':pwaPrompt?'Приложение готово к установке.':'Установка доступна через меню браузера.';
}
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();pwaPrompt=event;pwaRefresh()});
window.addEventListener('appinstalled',()=>{pwaInstalled=true;pwaPrompt=null;pwaRefresh()});
pwaDisplay.addEventListener?.('change',pwaRefresh);
document.querySelector('#pwaInstall').onclick=async()=>{
 if(!pwaPrompt){document.querySelector('#pwaInstructions').hidden=false;document.querySelector('#pwaInstructions').scrollIntoView({block:'nearest'});return}
 const prompt=pwaPrompt;pwaPrompt=null;pwaInstalling=true;const button=document.querySelector('#pwaInstall');button.disabled=true;
 try{await prompt.prompt();const choice=await prompt.userChoice;pwaInstalling=false;pwaRefresh();if(!pwaInstalled&&!pwaDisplay.matches)document.querySelector('#pwaStatus').textContent=choice.outcome==='accepted'?'Установка началась. Дождитесь уведомления браузера.':'Установка отменена. Можно установить приложение через меню браузера.'}
 catch{pwaInstalling=false;pwaRefresh();document.querySelector('#pwaStatus').textContent='Не удалось открыть установку. Используйте меню браузера.'}
};
const pwaStyle=document.createElement('style');pwaStyle.textContent='.pwa-install-card{display:flex;align-items:center;gap:14px;padding:20px 0;border-bottom:1px solid var(--line);margin-bottom:16px}.pwa-install-card>.ic{width:36px;height:36px;color:var(--blue);flex:none}.pwa-install-card p{margin:4px 0;color:var(--muted);font-size:12px}#pwaInstall{background:var(--vscode-button-bg);color:var(--vscode-button-fg,#fff);border:0;padding:9px 14px;border-radius:6px;font:inherit;cursor:pointer}#pwaInstall[hidden],#pwaInstructions[hidden]{display:none!important}#pwaInstall:disabled{opacity:.6;cursor:wait}#pwaInstructions{padding-left:20px}#pwaInstructions li{margin-bottom:8px}#pwaStatus{color:var(--muted);font-size:12px}';document.head.append(pwaStyle);
pwaRefresh();
