/* Shared control styles for the application and isolated plugin panels. */
'use strict';
const PALACE_CONTROL_CSS = `
:where(.dialog,.ctx-menu,.arrange-bar,.canvas-ctl,.palace-plugin-surface) select,
:where(.dialog,.palace-plugin-surface) input:where(:not([type]),[type=text],[type=search],[type=url],[type=email],[type=password],[type=number]),
:where(.dialog,.palace-plugin-surface) textarea {
 box-sizing:border-box;max-width:100%;min-width:0;font:inherit;color:var(--text,inherit);
 background:var(--vscode-input-bg,var(--panel,#303030));border:1px solid var(--line,#454545);border-radius:6px;padding:7px 10px;
}
input[type=file]:not([hidden]):not([aria-hidden=true]) {
 box-sizing:border-box;max-width:100%;min-width:0;font:inherit;line-height:1.5;
 color:var(--text,inherit);background:var(--vscode-input-bg,var(--panel,#303030));
 border:1px solid var(--line,#454545);border-radius:6px;padding:5px 7px;cursor:pointer;
}
input[type=file]::file-selector-button {
 font:inherit;line-height:1.5;padding:6px 11px;margin-right:10px;
 color:var(--text,inherit);background:var(--vscode-input-bg,var(--panel,#303030));
 border:1px solid var(--line,#454545);border-radius:6px;cursor:pointer;
}
input[type=file]::-webkit-file-upload-button {
 font:inherit;line-height:1.5;padding:6px 11px;margin-right:10px;
 color:var(--text,inherit);background:var(--vscode-input-bg,var(--panel,#303030));
 border:1px solid var(--line,#454545);border-radius:6px;cursor:pointer;
}
input[type=file]:hover::file-selector-button {background:var(--t-hover,var(--line,#454545))}
input[type=file]:disabled {opacity:.55;cursor:default}
input[type=file]:disabled::file-selector-button {cursor:default}
:where(input,select,textarea,button,summary):focus-visible {outline:2px solid var(--blue,#3592c4);outline-offset:2px}
input:where([type=checkbox],[type=radio],[type=range]) {accent-color:var(--blue,#3592c4)}
.workspace-import {font:inherit;min-width:0;max-width:100%}
#settingsModal {color-scheme:dark}
:where(.dialog) .persistence-actions {align-items:center}
:where(.dialog) select option {background:var(--vscode-input-bg,var(--panel,#303030));color:var(--text,inherit)}
/* Scroll individual control lanes, never the plan/panorama gesture surface. */
html.phone .activity::-webkit-scrollbar {display:none}
html.phone .top {min-width:0;overflow-x:auto;overscroll-behavior-x:contain;scrollbar-width:none}
html.phone .top .menubar,html.phone .top .top-actions {flex-shrink:0}
html.phone .top .title {min-width:60px}
html.phone .top .menu-item,html.phone .top-actions button {font-size:12px;height:32px;line-height:32px;padding-left:7px;padding-right:7px}
html.phone .top #themeBtn {width:32px}
html.phone .title input {height:30px;font-size:12px}
html.phone .dialog {font-size:12px;padding:12px;overscroll-behavior:contain}
html.phone .dialog h2 {font-size:17px}
html.phone #settingsModal>.dialog {font-size:12px}
html.phone #settingsModalTitle {font-size:14px;padding-top:12px;padding-bottom:12px}
html.phone #settingsModal #settingsClose {font-size:22px;top:5px;right:10px;width:32px;height:32px;min-height:32px;padding:0}
html.phone .settings-window-lights {top:18px}
html.phone .dialog :where(button):not(.plugin-icon-button,.settings-switch) {font-size:12px}
html.phone :where(.dialog,.palace-plugin-surface) :where(input,select,textarea) {min-width:0;max-width:100%}
/* iOS must retain a 16px input font to avoid zooming the page on focus. */
html.phone.ios :where(input:not([type=range],[type=checkbox],[type=radio],[type=color],[type=file]),select,textarea) {font-size:max(16px,calc(16px * var(--ui-k,1)))!important}
html.phone :where(.persistence-actions,.workspace-preset>div,.addon-actions,.rv-chips,.rv-actions,.arrange-bar .ab-row2,.tour-toolbar-local,.palette-footer) {
 min-width:0;max-width:100%;flex-wrap:nowrap;overflow-x:auto;overscroll-behavior-x:contain;scrollbar-width:thin;
}
html.phone :where(.persistence-actions,.workspace-preset>div,.addon-actions,.rv-chips,.rv-actions,.arrange-bar .ab-row2,.tour-toolbar-local,.palette-footer)>* {flex-shrink:0}
html.phone :where(.persistence-actions,.workspace-preset>div,.addon-actions,.rv-chips,.rv-actions,.arrange-bar .ab-row2,.tour-toolbar-local) button {white-space:nowrap}
html.phone #workspacePresetName {min-width:140px}
html.phone :where(.dialog,.palace-plugin-surface) pre {max-width:100%;overflow:auto}
html.phone .settings-content {padding:14px 12px;overflow:auto}
html.phone .settings-card {padding:0 12px;margin-bottom:16px;overflow-x:auto}
html.phone #settingsModal .settings-pane h2 {font-size:18px;margin-bottom:16px}
html.phone #settingsModal .settings-row {padding:12px 0;gap:10px}
html.phone #settingsModal .settings-row-title {font-size:13px}
html.phone #settingsModal .settings-row-description {font-size:12px;line-height:1.4}
html.phone #settingsModal .settings-row-control {gap:6px}
html.phone #settingsModal .settings-row-control :where(button,select,input) {padding:6px 8px}
html.phone #settingsModal #settingsNav .settings-nav-item {min-height:32px;padding:5px 10px!important;font-size:12px;gap:8px}
html.phone .settings-nav-item .ic {width:18px;height:18px}
html.phone #settingsModal #toolsList {padding:0 12px}
html.phone #settingsModal .tool-settings-row {padding:10px 0}
html.phone .tool-settings-info>span {font-size:12px}
html.phone #settingsModal .addon-card {padding:12px 0}
/* Floating plugin menus must escape their trigger lane. */
html.phone #settingsModal .addon-card>.persistence-actions {overflow:visible;max-width:none}
html.phone #calibrationWorkspace {font-size:12px;padding:6px;gap:4px}
html.phone #calibrationWorkspace .calibration-header strong {font-size:12px}
html.phone #calibrationWorkspace .calibration-navigation,html.phone #calibrationWorkspace .calibration-result-actions {
 min-width:0;max-width:100%;flex-wrap:nowrap;overflow-x:auto;overscroll-behavior-x:contain;scrollbar-width:thin;
}
html.phone #calibrationWorkspace .calibration-navigation button,html.phone #calibrationWorkspace .calibration-result-actions button {flex:none;white-space:nowrap}
html.phone #calibrationWorkspace .calibration-navigation button {font-size:11px;min-height:30px;padding:4px 7px}
html.phone #calibrationWorkspace .calibration-matchbar {min-width:0}
html.phone #calibrationWorkspace .calibration-details {max-width:calc(100% - 16px)}
html.phone #calibrationWorkspace .calibration-preview-camera,html.phone #calibrationCameraList {min-width:0}
@media(max-width:650px) {
 html.phone .settings-sidebar {padding:10px 12px;flex-basis:170px;max-height:170px;min-height:110px}
 html.phone .settings-nav-group {margin-bottom:12px}
 html.phone .settings-nav-group h3 {font-size:11px;margin-bottom:8px}
 html.phone #settingsSearch {padding:6px 10px 6px 36px;margin-bottom:10px}
 html.phone .settings-sidebar::before {left:24px;top:22px}
 html.phone .settings-sidebar::after {left:34px;top:33px}
}
`;
const sharedControlsStyle = document.createElement('style');
sharedControlsStyle.id = 'palaceSharedControls'; sharedControlsStyle.textContent = PALACE_CONTROL_CSS;
document.head.append(sharedControlsStyle);
const controlsTheme = PalaceAPI.theme;
window.PalaceAPI = Object.freeze({...PalaceAPI,theme(){
 const theme = controlsTheme(),style=getComputedStyle(document.documentElement);
 return {...theme,ui:Object.fromEntries(['--text','--muted','--line','--panel','--bg','--blue','--vscode-input-bg','--vscode-button-bg','--vscode-button-fg','--t-hover','--t-font-ui'].map(key=>[key,style.getPropertyValue(key).trim()])),colorScheme:style.colorScheme};
}});
function styleAddonHostDocument(source){
 const helper = `function applySharedTheme(theme){document.body.style.background=theme.background;document.body.style.color=theme.foreground;for(const [key,value]of Object.entries(theme.ui||{}))if(typeof value==='string')document.documentElement.style.setProperty(key,value);if(['dark','light','normal'].includes(theme.colorScheme))document.documentElement.style.colorScheme=theme.colorScheme;}`;
 return source.replace('<body>','<body class="palace-plugin-surface">').replace('document.body.style.background=theme.background;document.body.style.color=theme.foreground;', 'applySharedTheme(theme);').replace('</head>', '<style id="palaceSharedControls">'+PALACE_CONTROL_CSS+'\nbody{font-family:var(--t-font-ui,system-ui)}\n</style></head>')
  .replace("const modules=new Map();",helper+"window.addEventListener('message',event=>{if(event.source===parent&&event.data?.channel===data.channel&&event.data.type==='themeChanged')applySharedTheme(event.data.theme)});const modules=new Map();");
};
const controlsApplyTheme=applyTheme;
applyTheme=function(...args){const result=controlsApplyTheme(...args),theme=PalaceAPI.theme();for(const host of (typeof addonHosts==='undefined'?[]:addonHosts.values()))host.frame.contentWindow?.postMessage({channel:host.channel,type:'themeChanged',theme},'*');return result;};

function finishSharedControls(){document.head.append(sharedControlsStyle);const theme=PalaceAPI.theme();for(const host of addonHosts.values())host.frame.contentWindow?.postMessage({channel:host.channel,type:'themeChanged',theme},'*');}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',finishSharedControls,{once:true});else finishSharedControls();
