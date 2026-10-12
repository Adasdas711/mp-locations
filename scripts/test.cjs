// Serve the actual application on an ephemeral loopback port for browser regression tests.
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const {spawn} = require('node:child_process');
const root = path.resolve(__dirname,'..');
const mime = {'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.json':'application/json','.webmanifest':'application/manifest+json','.png':'image/png','.wasm':'application/wasm'};
const server = http.createServer(async (request,response)=>{
  try {
    const pathname=decodeURIComponent(new URL(request.url,'http://localhost').pathname);
    const file=path.resolve(root,'.'+pathname+(pathname.endsWith('/')?'index.html':''));
    if(!file.startsWith(root+path.sep)){response.writeHead(403);response.end();return}
    const data=await fs.readFile(file);
    response.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream'});response.end(data);
  } catch (error) {response.writeHead(error.code==='ENOENT'?404:500);response.end()}
});
server.listen(0,'127.0.0.1',()=>{
  const child=spawn(process.execPath,['--test','--test-reporter=tap','tests/static.cjs','tests/minimap.cjs','tests/modes.cjs','tests/persistence.cjs'],{cwd:root,stdio:'inherit',env:{...process.env,PALACE_TEST_URL:`http://127.0.0.1:${server.address().port}`}});
  child.on('error',error=>{console.error(error);server.close();process.exitCode=1});
  child.on('exit',code=>{server.close();process.exitCode=code??1});
});
