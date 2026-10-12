/* Installation uses the browser's native PWA flow; iOS provides a Share-sheet flow. */
'use strict';
let pwaPrompt=null,pwaInstalling=false,pwaInstalled=false;
const pwaDisplay=matchMedia('(display-mode: standalone)');
const pwaPage=document.createElement('section');
pwaPage.innerHTML="<div class=\"dialog\"><h2>Application</h2><p class=\"settings-description\">Install PALACE for a home screen icon, a standalone window and offline access after the first load.</p><div class=\"pwa-install-card\"><svg class=\"ic\"><use href=\"#i-download\"/></svg><div><strong>PALACE / Memory Mapper</strong><p>Memory palaces, plans and panoramas on your device.</p></div></div><button id=\"pwaInstall\" type=\"button\">Install application</button><p id=\"pwaStatus\" role=\"status\" aria-live=\"polite\"></p><ol id=\"pwaInstructions\"></ol><p class=\"settings-description\">Save your palace as an .mpalace file to open it in the app or on another device.</p></div>";
settingsPage('app','General','user',pwaPage);pwaPage.querySelector('h2').textContent='General';
function pwaRefresh(){
 const installed=pwaInstalled||pwaDisplay.matches||navigator.standalone===true;
 const button=document.querySelector('#pwaInstall'),status=document.querySelector('#pwaStatus'),steps=document.querySelector('#pwaInstructions');
 const ios=/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
 const android=/Android/i.test(navigator.userAgent);
 button.hidden=installed;button.disabled=pwaInstalling;button.textContent=pwaPrompt?"Install application":"How to install";steps.replaceChildren();
 const instructions=ios?["Open this website in Safari.","Tap Share, then Add to Home Screen.","Tap Add and launch PALACE from your home screen."]:android?["Open this website in Chrome.","Choose Install app or Add to Home screen in the browser menu.","Confirm installation and launch PALACE from your home screen."]:["Open this website in Chrome or Edge.","Click the install icon in the address bar or choose Install app from the browser menu."];
 if(!installed&&!pwaPrompt)for(const text of instructions){const li=document.createElement('li');li.textContent=text;steps.append(li)}
 steps.hidden=installed||!!pwaPrompt;
 status.textContent=installed?"Application installed.":!isSecureContext?"Open the website over HTTPS to install it.":pwaPrompt?"Application ready to install.":"Installation is available in the browser menu.";
}
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();pwaPrompt=event;pwaRefresh()});
window.addEventListener('appinstalled',()=>{pwaInstalled=true;pwaPrompt=null;pwaRefresh()});
pwaDisplay.addEventListener?.('change',pwaRefresh);
document.querySelector('#pwaInstall').onclick=async()=>{
 if(!pwaPrompt){document.querySelector('#pwaInstructions').hidden=false;document.querySelector('#pwaInstructions').scrollIntoView({block:'nearest'});return}
 const prompt=pwaPrompt;pwaPrompt=null;pwaInstalling=true;const button=document.querySelector('#pwaInstall');button.disabled=true;
 try{await prompt.prompt();const choice=await prompt.userChoice;pwaInstalling=false;pwaRefresh();if(!pwaInstalled&&!pwaDisplay.matches)document.querySelector('#pwaStatus').textContent=choice.outcome==='accepted'?"Installation started. Wait for the browser notification.":"Installation cancelled. You can install from the browser menu."}
 catch{pwaInstalling=false;pwaRefresh();document.querySelector('#pwaStatus').textContent="Unable to open installation. Use the browser menu."}
};
const pwaStyle=document.createElement('style');pwaStyle.textContent='.pwa-install-card{display:flex;align-items:center;gap:14px;padding:20px 0;border-bottom:1px solid var(--line);margin-bottom:16px}.pwa-install-card>.ic{width:36px;height:36px;color:var(--blue);flex:none}.pwa-install-card p{margin:4px 0;color:var(--muted);font-size:12px}#pwaInstall{background:var(--vscode-button-bg);color:var(--vscode-button-fg,#fff);border:0;padding:9px 14px;border-radius:6px;font:inherit;cursor:pointer}#pwaInstall[hidden],#pwaInstructions[hidden]{display:none!important}#pwaInstall:disabled{opacity:.6;cursor:wait}#pwaInstructions{padding-left:20px}#pwaInstructions li{margin-bottom:8px}#pwaStatus{color:var(--muted);font-size:12px}';document.head.append(pwaStyle);
pwaRefresh();
