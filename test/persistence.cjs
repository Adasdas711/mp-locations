const {test}=require('node:test');
const {profiles}=require('./support/fixtures.cjs');
const {launchBrowser}=require('./support/browser.cjs');
/* Run: NODE_PATH=/path/to/node_modules node test/persistence.cjs */
const {chromium} = require('playwright-core');
const JSZip = require('../vendor/jszip.min.js');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const fsSync = require('node:fs');
const base = process.env.PALACE_TEST_URL || 'http://127.0.0.1:8000';
const root = path.resolve(__dirname, '..');
for(const [profile,options]of profiles)test(`${profile}: recovery, archive metadata and offline workflow`,async () => {
  const browser = await launchBrowser();
  try {
    const context = await browser.newContext({...options,acceptDownloads: true});
    const page = await context.newPage();
    const errors = [], external = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', r => { if (!r.url().startsWith(base) && !r.url().startsWith('blob:') && !r.url().startsWith('data:')) external.push(r.url()); });
    await page.goto(base, {waitUntil: 'networkidle'});
    await page.waitForFunction(() => navigator.serviceWorker.controller, {timeout: 60000});
    await page.waitForFunction(() => document.querySelector('#offlineStatus').textContent.includes('готов'));
    assert.equal(await page.title(), 'PALACE / Memory Mapper');
    const png = await fs.readFile(path.join(root, 'icons/icon-192.png'));
    const zip = new JSZip();
    zip.file('palace.json', JSON.stringify({name:'Fixture palace', levels:[{name:'Floor',image:'images/level-1.png',w:192,h:192,markers:[{x:60,y:70,note:'Remember me'}]}],panoramas:{p1:{mode:'equirect',file:'panoramas/p1.png',floorId:1,room:'Room'}},custom:'keep'}));
    zip.file('meta.json', JSON.stringify({title:'Original', unknown:{keep:true}}));
    const modelBin = Buffer.alloc(72); modelBin.writeFloatLE(1,12); modelBin.writeFloatLE(1,28); modelBin.writeUInt32LE(1,64); modelBin.writeUInt32LE(2,68);
    zip.file('dollhouse.json',JSON.stringify({format:1,bin:'dollhouse.bin',chunks:[{vertices:3,triangles:1,pos:0,uv:36,idx:60,floorId:1}],textures:{one:'texture.png'}}));
    zip.file('dollhouse.bin',modelBin); zip.file('texture.png',png);
    zip.file('images/level-1.png', png); zip.file('panoramas/p1.png', png); zip.file('extra.bin', Buffer.from([0,1,2,255]));
    const original = await zip.generateAsync({type:'nodebuffer'});
    await page.locator('#fileOpen').setInputFiles({name:'fixture.mpalace',mimeType:'application/zip',buffer:original});
    await page.waitForFunction(() => state.name === 'Fixture palace' && archiveContext?.name === 'fixture.mpalace');
    await page.locator('#abSave').click(); await page.locator('#metaOpen').click();
    assert.match(await page.locator('#metaEditor').inputValue(), /Original/);
    await page.locator('#metaEditor').fill('{invalid'); await page.locator('#metaApply').click();
    assert.match(await page.locator('#metaError').innerText(), /Не удалось/);
    assert.equal(await page.evaluate(() => JSON.parse(archiveContext.metaText).title), 'Original');
    const edited = {title:'Updated',unknown:{keep:true},nested:['a',2]};
    await page.locator('#metaEditor').fill(JSON.stringify(edited)); await page.locator('#metaApply').click();
    const downloadPromise = page.waitForEvent('download'); await page.locator('#metaDownload').click();
    const download = await downloadPromise; const result = await JSZip.loadAsync(await fs.readFile(await download.path()));
    assert.deepEqual(JSON.parse(await result.file('meta.json').async('string')), edited);
    for (const file of Object.keys(zip.files).filter(x => x !== 'meta.json' && !zip.files[x].dir)) assert.deepEqual(await result.file(file).async('nodebuffer'), await zip.file(file).async('nodebuffer'));
    await page.locator('#metaClose').click(); await page.locator('#closeSaveModal').click();
    await page.locator('#palaceName').fill('Recovered palace'); await page.locator('#palaceName').press('Tab');
    await page.waitForFunction(() => document.querySelector('#recoveryStatus').textContent.startsWith('Автосохранено'), {timeout:15000});
    await page.reload({waitUntil:'networkidle'});
    await page.locator('#recoveryModal.show').waitFor();
    await page.locator('#recoveryList button').first().click();
    await page.waitForFunction(() => state.name === 'Recovered palace');
    assert.equal(await page.evaluate(() => state.levels[0].markers[0].note), 'Remember me');
    assert.match(await page.evaluate(() => state.levels[0].src), /^data:image\/png/);
    assert.deepEqual(await page.evaluate(() => JSON.parse(archiveContext.metaText)), edited);
    assert.equal(await page.evaluate(() => DHM.bin.byteLength),72);
    assert.match(await page.evaluate(() => DHM.tex.get('texture.png').url),/^data:image\/png/);
    await page.locator('#abSave').click();
    const palaceDownloadPromise = page.waitForEvent('download'); await page.locator('#saveMpalaceBtn').click();
    const palaceDownload = await palaceDownloadPromise;
    const exported = await JSZip.loadAsync(await fs.readFile(await palaceDownload.path()));
    assert.deepEqual(JSON.parse(await exported.file('meta.json').async('string')), edited);
    assert.ok(exported.file('panoramas/p1.png'));
    assert.deepEqual(await exported.file('dollhouse.bin').async('nodebuffer'),modelBin);
    // The retained original archive is also available after recovery.
    await page.locator('#abSave').click(); await page.locator('#metaOpen').click();
    const restoredDownloadPromise = page.waitForEvent('download'); await page.locator('#metaDownload').click();
    const restoredArchive = await restoredDownloadPromise;
    assert.deepEqual(await (await JSZip.loadAsync(await fs.readFile(await restoredArchive.path()))).file('extra.bin').async('nodebuffer'), Buffer.from([0,1,2,255]));
    await page.locator('#metaClose').click(); await page.locator('#closeSaveModal').click();
    for (let i=0;i<7;i++) {
      await page.locator('#palaceName').fill('Version '+i); await page.locator('#palaceName').press('Tab');
      await page.evaluate(() => saveRecovery());
    }
    assert.equal(await page.evaluate(async () => (await recoveryVersions()).length), 5);
    assert.equal(await page.evaluate(async () => (await recoveryVersions())[0].state.name), 'Version 6');
    // Restoring over current edits must show the existing confirmation above the recovery picker.
    await page.locator('#abSave').click(); await page.locator('#recoveryOpen').click();
    await page.locator('#recoveryList button').last().click();
    await page.locator('#askModal.show').waitFor(); assert.equal(await page.locator('#recoveryModal').evaluate(el=>el.classList.contains('show')),false);
    await page.locator('#askNo').click(); await page.locator('#closeSaveModal').click();
    // Unsupported/corrupt imports must leave the active archive unchanged.
    await page.evaluate(async () => { try { await openAnyArchiveBuffer(new Uint8Array([1,2,3]).buffer, 'bad.mpalace'); } catch (_) {} });
    assert.equal(await page.evaluate(() => archiveContext.name), 'fixture.mpalace');
    // Real .3dview import, including initially malformed metadata.
    const tour = new JSZip();
    tour.file('links.json', JSON.stringify([{id:'tour-p1',platform:'zillow',plan_file:'plan.png',file:'pano.png',plan_px:{x:80,y:80},floorId:1,room:'Room'}]));
    tour.file('plan.png',png); tour.file('pano.png',png); tour.file('meta.json','{broken'); tour.file('untouched.txt','original data');
    await page.locator('#fileOpen').setInputFiles({name:'tour.3dview',mimeType:'application/zip',buffer:await tour.generateAsync({type:'nodebuffer'})});
    await page.waitForFunction(() => archiveContext?.name === 'tour.3dview');
    await page.locator('#abSave').click(); await page.locator('#metaOpen').click();
    assert.equal(await page.locator('#metaEditor').inputValue(), '{broken');
    await page.locator('#metaEditor').fill('{"fixed":true}');
    const tourDownloadPromise = page.waitForEvent('download'); await page.locator('#metaDownload').click();
    const tourDownload = await tourDownloadPromise; const fixed = await JSZip.loadAsync(await fs.readFile(await tourDownload.path()));
    assert.equal(await fixed.file('untouched.txt').async('string'),'original data');
    assert.deepEqual(JSON.parse(await fixed.file('meta.json').async('string')), {fixed:true});
    await page.locator('#metaClose').click(); await page.locator('#closeSaveModal').click();
    // Missing meta.json can be created, including inside a nested archive.
    const missing = new JSZip();
    for (const file of ['links.json','plan.png','pano.png','untouched.txt']) missing.file(file, await tour.file(file).async('nodebuffer'));
    const outer = new JSZip(); outer.file('nested.3dview',await missing.generateAsync({type:'nodebuffer'}));
    await page.locator('#fileOpen').setInputFiles({name:'outer.zip',mimeType:'application/zip',buffer:await outer.generateAsync({type:'nodebuffer'})});
    await page.waitForFunction(()=>archiveContext?.name==='nested.3dview');
    await page.locator('#abSave').click(); await page.locator('#metaOpen').click();
    assert.equal(await page.locator('#metaEditor').inputValue(),'{}');
    await page.locator('#metaEditor').fill('{"created":true}'); await page.locator('#metaApply').click();
    await page.locator('#metaClose').click(); await page.locator('#closeSaveModal').click();
    await page.evaluate(() => saveRecovery());
    await context.setOffline(true);
    await page.reload({waitUntil:'networkidle'});
    await page.locator('#recoveryModal.show').waitFor(); await page.locator('#recoveryList button').first().click();
    await page.waitForFunction(() => archiveContext?.name === 'nested.3dview');
    assert.equal(await page.evaluate(async () => { await ensureThreeLoaded(); return !!THREE; }), true);
    await page.locator('#abSave').click(); await page.locator('#openExportBtn').click();
    const pdfPromise = page.waitForEvent('download'); await page.locator('#exportPdfBtn').click();
    const pdf = await pdfPromise; const pdfBytes = await fs.readFile(await pdf.path());
    assert.equal(pdfBytes.subarray(0,4).toString(), '%PDF');
    const ocr = await page.evaluate(async () => {
      await loadTesseract();
      const worker = await Tesseract.createWorker('eng',1,{workerPath:TESS_CDN+'worker.min.js',corePath:TESS_CDN,langPath:TESS_CDN});
      try { const canvas=document.createElement('canvas'); canvas.width=500;canvas.height=100;const c=canvas.getContext('2d');c.fillStyle='white';c.fillRect(0,0,500,100);c.fillStyle='black';c.font='40px Arial';c.fillText('Bedroom',20,60);return (await worker.recognize(canvas)).data.text; }
      finally { await worker.terminate(); }
    });
    assert.match(ocr,/Bedroom/i);
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    console.log('PASS: metadata validation and archive byte preservation (.mpalace/.3dview), metadata export, 5-version recovery with images/panoramas/original archive, failed-import safety, offline reload, Three.js, PDF export and OCR; no external requests or uncaught errors.');
  } finally { await browser.close(); }
});
