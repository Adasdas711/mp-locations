const {chromium,webkit,firefox}=require('playwright-core');
const fs=require('node:fs');
async function launchBrowser(){
  const name=process.env.PALACE_BROWSER||'chromium';
  const type={chromium,webkit,firefox}[name];if(!type)throw new Error('Unknown PALACE_BROWSER: '+name);
  return type.launch(name==='chromium'?{executablePath:process.env.CHROMIUM_PATH||(fs.existsSync('/usr/bin/chromium')?'/usr/bin/chromium':type.executablePath()),args:['--no-sandbox','--enable-unsafe-swiftshader']}:{executablePath:process.env.PALACE_BROWSER_PATH||type.executablePath()});
}
module.exports={launchBrowser};
