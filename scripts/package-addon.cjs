const fs=require('node:fs'),path=require('node:path'),JSZip=require('../vendor/jszip.min.js');
const folder=path.resolve(process.argv[2]||path.join(__dirname,'../addons/example'));
const output=path.resolve(process.argv[3]||'/tmp/palace-example.palace-addon');
const zip=new JSZip();
function add(directory,prefix=''){for(const entry of fs.readdirSync(directory,{withFileTypes:true})){if(entry.isSymbolicLink())throw new Error('Symlinks are not supported');const name=prefix+entry.name;if(entry.isDirectory())add(path.join(directory,entry.name),name+'/');else zip.file(name,fs.readFileSync(path.join(directory,entry.name)))}}
(async()=>{add(folder);fs.writeFileSync(output,await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'}));console.log(output)})().catch(error=>{console.error(error);process.exitCode=1});
