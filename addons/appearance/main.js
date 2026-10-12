exports.activate=async api=>{
 const bundled=JSON.parse(api.assets.read('catalog.json'));
 let custom=await api.storage.get('catalog')||{themes:[],iconThemes:[]};
 const combined=value=>({themes:[...bundled.themes,...(value.themes||[])],iconThemes:[...bundled.iconThemes,...(value.iconThemes||[])]});
 await api.ui.registerAppearance(combined(custom));
 api.commands.register('palace.appearance.open',async()=>{
  await api.ui.showPanel('palace.appearance.panel',api.assets.read('panel.html'));
  const message=document.querySelector('#appearanceMessage');
  const run=async action=>{try{await action()}catch(error){message.textContent=error.message}};
  const refresh=async()=>{
   const [themes,icons,current]=await Promise.all([api.ui.themes(),api.ui.iconThemes(),api.theme.read()]);
   const themeSelect=document.querySelector('#appearanceTheme'),iconSelect=document.querySelector('#appearanceIcons');
   themeSelect.replaceChildren(...themes.map(t=>new Option(t.title,t.id)));themeSelect.value=current.name;
   iconSelect.replaceChildren(...icons.map(t=>new Option(t.title,t.id)));iconSelect.value=icons.find(t=>t.active)?.id||'system.default';
  };
  await refresh();
  document.querySelector('#appearanceTheme').onchange=e=>run(async()=>{await api.ui.theme(e.target.value);message.textContent="Theme applied"});
  document.querySelector('#appearanceIcons').onchange=e=>run(async()=>{await api.ui.iconTheme(e.target.value);message.textContent="Icons applied"});
  document.querySelector('#appearanceReset').onclick=()=>run(async()=>{await api.ui.theme('darcula');await api.ui.iconTheme('system.default');await refresh();message.textContent="System appearance restored"});
  document.querySelector('#appearanceImport').onchange=e=>run(async()=>{
   const file=e.target.files[0];if(!file)return;if(file.size>80000)throw new Error("JSON must be smaller than 80 KB");
   const input=JSON.parse(await file.text());
   if(!input||!Array.isArray(input.themes||[])||!Array.isArray(input.iconThemes||[])||!(input.themes?.length||input.iconThemes?.length))throw new Error("Provide a nonempty themes or iconThemes collection");
   const next={};
   for(const key of ['themes','iconThemes']){
    const map=new Map((custom[key]||[]).map(t=>[t.id,t]));
    for(const item of input[key]||[]){if(bundled[key].some(t=>t.id===item?.id))throw new Error("Built-in plugin collections cannot be replaced");map.set(item?.id,item)}next[key]=[...map.values()];
   }
   await api.ui.registerAppearance(combined(next));
   try{await api.storage.set('catalog',next)}catch(error){await api.ui.registerAppearance(combined(custom));throw error}
   custom=next;await refresh();message.textContent="Collection installed";e.target.value='';
  });
  document.querySelector('#appearanceRemoveCustom').onclick=()=>run(async()=>{
   const next={themes:[],iconThemes:[]};await api.storage.set('catalog',next);custom=next;await api.ui.registerAppearance(combined(custom));await refresh();message.textContent="Imported collections removed";
  });
  document.querySelector('#appearanceExport').onclick=()=>{
   let example=document.querySelector('#appearanceExample');if(!example){example=document.createElement('textarea');example.id='appearanceExample';example.readOnly=true;example.style.cssText='width:95%;height:150px;margin-top:12px';document.querySelector('#panel').append(example)}
   const sample=structuredClone(bundled);sample.themes[0].id='palace.appearance.my-theme';sample.themes=sample.themes.slice(0,1);sample.iconThemes[0].id='palace.appearance.my-icons';sample.iconThemes=sample.iconThemes.slice(0,1);
   example.value=JSON.stringify(sample,null,2);example.focus();example.select();message.textContent="Copy the JSON to a file and change colors or SVG paths";
  };
 });
};
