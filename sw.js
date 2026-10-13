/* Bump the cache version whenever any app-shell asset changes. */
'use strict';
const CACHE = 'palace-offline-6a9cea8ad1be4c49';
const ASSETS = [
  "./",
  "addon-management.js",
  "addons.js",
  "addons/appearance.palace-addon",
  "addons/example.palace-addon",
  "app-api.js",
  "app.js",
  "appearance.js",
  "calibration-addon.js",
  "calibration-core.js",
  "calibration-math.js",
  "calibration-preview.js",
  "calibration-worker.js",
  "camera-editor.js",
  "command-palette.js",
  "extension-operations.js",
  "history-addon.js",
  "icons/apple-touch-icon.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "index.html",
  "interfaces.js",
  "manifest.webmanifest",
  "mobile-controls.js",
  "mobile.js",
  "panorama-surface.js",
  "persistence.js",
  "pwa.js",
  "scene-camera.js",
  "scene-sdk.js",
  "settings.js",
  "system-addons.js",
  "theme-picker.js",
  "themes.js",
  "transitions.js",
  "ui-controls.js",
  "vendor/README.md",
  "vendor/eng-LICENSE",
  "vendor/eng.traineddata.gz",
  "vendor/fonts.css",
  "vendor/jspdf-LICENSE",
  "vendor/jspdf.umd.min.js",
  "vendor/jszip-LICENSE.markdown",
  "vendor/jszip.min.js",
  "vendor/pdf.min.js",
  "vendor/pdf.worker.min.js",
  "vendor/pdfjs-dist-LICENSE",
  "vendor/tesseract-core-lstm.wasm",
  "vendor/tesseract-core-lstm.wasm.js",
  "vendor/tesseract-core-simd-lstm.wasm",
  "vendor/tesseract-core-simd-lstm.wasm.js",
  "vendor/tesseract-core-simd.wasm",
  "vendor/tesseract-core-simd.wasm.js",
  "vendor/tesseract-core.wasm",
  "vendor/tesseract-core.wasm.js",
  "vendor/tesseract.js-LICENSE.md",
  "vendor/tesseract.js-core-LICENSE",
  "vendor/tesseract.min.js",
  "vendor/three-LICENSE",
  "vendor/three.min.js",
  "vendor/worker.min.js",
  "workspace-presets.js",
  "world-space.js",
  "world-ui.js"
];
const assetURLs = new Set(ASSETS.map(path => new URL(path, self.registration.scope).href));
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(ASSETS.map(path => new Request(new URL(path, self.registration.scope), {cache: 'reload'})));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith('palace-offline-') && key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  const scope = new URL(self.registration.scope);
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
  const canonical = url.origin + url.pathname;
  if (event.request.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      return await cache.match(new URL('index.html', self.registration.scope)) || fetch(event.request);
    })());
  } else if (assetURLs.has(canonical)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      return await cache.match(canonical) || fetch(event.request);
    })());
  }
});
