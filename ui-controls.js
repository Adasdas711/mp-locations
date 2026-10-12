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
