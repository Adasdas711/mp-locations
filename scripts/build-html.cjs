// index.max.html is the editable source; index.html is the deployable artifact.
const fs=require('node:fs/promises'),path=require('node:path');
const {minify}=require('html-minifier-terser');
const root=path.resolve(__dirname,'..');
const options={collapseWhitespace:true,removeComments:true,removeOptionalTags:true,removeAttributeQuotes:true,removeRedundantAttributes:true,removeEmptyAttributes:true,removeScriptTypeAttributes:true,removeStyleLinkTypeAttributes:true,useShortDoctype:true,minifyCSS:{level:1},minifyJS:{mangle:false,compress:{toplevel:false},format:{comments:false}}};
async function buildHTML(){return minify(await fs.readFile(path.join(root,'index.max.html'),'utf8'),options)}
module.exports={buildHTML};
if(require.main===module)buildHTML().then(async html=>{await fs.writeFile(path.join(root,'index.html'),html+'\n');console.log('Built index.html:',Buffer.byteLength(html)+1,'bytes')}).catch(error=>{console.error(error);process.exitCode=1});
