/* Validated theme tokens and SVG paths supplied by installed extensions. */
'use strict';
const appearanceOwners=new Map(),palaceIconThemes=new Map([['system.default',{id:'system.default',title:'Системные иконки',icons:{}}]]),originalInterfaceIcons=new Map();
let activeIconTheme='system.default';
const appearanceColorKeys=['chrome','editor','widget','dialog','border','widgetBorder','fg','fgStrong','fgDim','fgMute','input','inputBorder','btn','btnHover','btnFg','btn2','btn2Hover','accent','focus','sel','status','statusFg','statusItem','statusItemFg','activityFg','activityInactive','hover'];
function appearanceId(host,id){if(typeof id!=='string'||!id.startsWith(host.record.id+'.')||!/^[-a-z0-9.]{3,120}$/.test(id))throw new Error('ID оформления должен начинаться с ID аддона и точки.');return id}
function appearanceTitle(title){if(typeof title!=='string'||!title.trim()||title.length>100)throw new Error('Укажите название оформления.');return title}
function appearanceColors(input,keys){if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Нужен объект цветов.');const result={};for(const [key,value]of Object.entries(input)){if(!keys.includes(key)||typeof value!=='string'||!/^#[0-9a-f]{6}$/i.test(value))throw new Error('Цвет должен иметь формат #RRGGBB: '+key);result[key]=value}return result}
function validateAppearance(host,input){
 if(!input||!Array.isArray(input.themes||[])||!Array.isArray(input.iconThemes||[])||(input.themes||[]).length+(input.iconThemes||[]).length>30)throw new Error('Не более 30 тем и наборов иконок.');
 const ids=new Set(),unique=id=>{appearanceId(host,id);const owner=[...appearanceOwners.entries()].find(([,entry])=>entry.themes.includes(id)||entry.iconThemes.includes(id))?.[0];if(owner&&owner!==host.record.id||!owner&&(palaceIconThemes.has(id)||PALACE_THEMES.some(t=>t.id===id)))throw new Error('Нельзя заменять системное оформление или набор другого аддона.');if(ids.has(id))throw new Error('Повторяющийся ID оформления.');ids.add(id);return id};
 const themes=(input.themes||[]).map(item=>{
  const id=unique(item?.id),name=appearanceTitle(item.title),base=PALACE_THEMES.find(t=>t.id===item.base&&!appearanceOwnersHasTheme(t.id));
  if(!base)throw new Error('Базовая системная тема не найдена.');
  if(item.mode!=null&&!['dark','light'].includes(item.mode))throw new Error('Режим темы: dark или light.');
  const theme=structuredClone(base);theme.id=id;theme.name=name;theme.source=host.record.manifest.name;theme.mode=item.mode||'dark';
  Object.assign(theme.ui,appearanceColors(item.colors||{},appearanceColorKeys));Object.assign(theme.canvas,appearanceColors(item.canvas||{},['bg','walls']));
  theme.camera.bg=theme.ui.widget;theme.camera.fg=theme.ui.fg;theme.camera.border=theme.ui.border;theme.camera.activeBg=theme.ui.focus;
  return theme;
 });
 const iconThemes=(input.iconThemes||[]).map(item=>{
  const id=unique(item?.id),title=appearanceTitle(item.title);if(!item.icons||typeof item.icons!=='object'||Array.isArray(item.icons)||Object.keys(item.icons).length>100)throw new Error('Не более 100 иконок.');
  const icons={};for(const [name,paths]of Object.entries(item.icons)){
   if(!/^i-[a-z0-9-]+$/.test(name)||document.getElementById(name)?.tagName.toLowerCase()!=='symbol'||!Array.isArray(paths)||!paths.length||paths.length>12)throw new Error('Неизвестная иконка или неверные пути: '+name);
   icons[name]=paths.map(p=>{if(!p||typeof p.d!=='string'||!p.d.trim()||p.d.length>4000||!/^[-+.,\s0-9MmLlHhVvCcSsQqTtAaZzEe]+$/.test(p.d)||p.filled!=null&&typeof p.filled!=='boolean')throw new Error('Недопустимый SVG-путь.');return {d:p.d,filled:!!p.filled}});
  }return {id,title,icons};
 });return {themes,iconThemes};
}
function appearanceOwnersHasTheme(id){return [...appearanceOwners.values()].some(data=>data.themes.includes(id))}
function setInterfaceIconTheme(id,persist=true){
 const pack=palaceIconThemes.get(id);if(!pack)throw new Error('Набор иконок не найден.');
 if(persist)localStorage.setItem('palace.iconTheme',id);
 for(const [name,nodes]of originalInterfaceIcons){const symbol=document.getElementById(name);if(symbol)symbol.replaceChildren(...nodes.map(n=>n.cloneNode(true)))}
 for(const [name,paths]of Object.entries(pack.icons)){
  const symbol=document.getElementById(name);if(!originalInterfaceIcons.has(name))originalInterfaceIcons.set(name,[...symbol.childNodes].map(n=>n.cloneNode(true)));
  symbol.replaceChildren(...paths.map(p=>{const node=document.createElementNS('http://www.w3.org/2000/svg','path');node.setAttribute('d',p.d);node.setAttribute('fill',p.filled?'currentColor':'none');return node}));
 }
 activeIconTheme=id;document.documentElement.dataset.iconTheme=id;return id;
}
function removeAddonAppearance(owner){
 const entry=appearanceOwners.get(owner);if(!entry)return;
 const restoreTheme=entry.themes.includes(getTheme());
 for(const id of entry.themes)unregisterPalaceTheme(id);
 if(restoreTheme&&PALACE_THEMES.some(t=>t.id===entry.restoreTheme))applyTheme(entry.restoreTheme);
 if(entry.iconThemes.includes(activeIconTheme))setInterfaceIconTheme(palaceIconThemes.has(entry.restoreIcons)?entry.restoreIcons:'system.default');
 for(const id of entry.iconThemes)palaceIconThemes.delete(id);
 appearanceOwners.delete(owner);
}
function registerAddonAppearance(host,input){
 const prepared=validateAppearance(host,input),previous=appearanceOwners.get(host.record.id)||{themes:[],iconThemes:[],restoreTheme:getTheme(),restoreIcons:activeIconTheme};
 const themeIds=prepared.themes.map(t=>t.id),iconIds=prepared.iconThemes.map(t=>t.id);
 for(const id of previous.themes)if(!themeIds.includes(id))unregisterPalaceTheme(id);
 for(const id of previous.iconThemes)if(!iconIds.includes(id)){if(activeIconTheme===id)setInterfaceIconTheme('system.default');palaceIconThemes.delete(id)}
 prepared.themes.forEach(registerPalaceTheme);prepared.iconThemes.forEach(t=>palaceIconThemes.set(t.id,t));appearanceOwners.set(host.record.id,{themes:themeIds,iconThemes:iconIds,restoreTheme:previous.restoreTheme,restoreIcons:previous.restoreIcons});
 let theme,icons;try{theme=localStorage.getItem('palace.theme');icons=localStorage.getItem('palace.iconTheme')}catch{}
 if(themeIds.includes(theme))applyTheme(theme);
 if(iconIds.includes(icons))setInterfaceIconTheme(icons,false);else if(iconIds.includes(activeIconTheme))setInterfaceIconTheme(activeIconTheme,false);
 return {themes:themeIds,iconThemes:iconIds};
}
const appearanceAddonRPC=addonRPC;
addonRPC=async function(host,method,args){
 if(['ui.appearance.register','ui.appearance.remove'].includes(method)){if(!host.record.manifest.permissions.includes('ui.contribute'))throw new Error('Нет разрешения: ui.contribute');return method.endsWith('register')?registerAddonAppearance(host,args):(removeAddonAppearance(host.record.id),true)}
 if(method==='ui.iconThemes')return [...palaceIconThemes.values()].map(t=>({id:t.id,title:t.title,active:t.id===activeIconTheme}));
 if(method==='ui.iconTheme'){if(!host.record.manifest.permissions.includes('ui.control'))throw new Error('Нет разрешения: ui.control');return setInterfaceIconTheme(args)}
 return appearanceAddonRPC(host,method,args);
};
const appearanceStopAddon=stopAddon;stopAddon=function(id){removeAddonAppearance(id);appearanceStopAddon(id)};
window.PalaceAPI=Object.freeze({...PalaceAPI,version:'1.2.0',uiIconThemes(){return [...palaceIconThemes.values()].map(t=>({id:t.id,title:t.title,active:t.id===activeIconTheme}))},uiIconTheme:setInterfaceIconTheme});
document.documentElement.dataset.iconTheme=activeIconTheme;

const appearanceRenderAddons=renderAddons;renderAddons=function(...args){for(const host of addonHosts.values())if(host.error)removeAddonAppearance(host.record.id);return appearanceRenderAddons(...args)};
