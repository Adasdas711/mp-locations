# Bundled offline dependencies

Copied from versioned npm packages, with npm registry integrity verification:

| Package | Version | Files |
| --- | --- | --- |
| jszip | 3.10.1 | jszip.min.js |
| pdfjs-dist | 3.11.174 | pdf.min.js, pdf.worker.min.js |
| three | 0.128.0 | three.min.js |
| jspdf | 2.5.1 | jspdf.umd.min.js |
| tesseract.js | 5.1.1 | tesseract.min.js, worker.min.js |
| tesseract.js-core | 5.1.1 | tesseract-core*.wasm, tesseract-core*.wasm.js |
| @tesseract.js-data/eng | 1.0.0 | 4.0.0_best_int/eng.traineddata.gz |

Licenses are included alongside the files. English language data is from the Tesseract project's Apache-2.0 licensed [tessdata](https://github.com/tesseract-ocr/tessdata) distribution. All core variants are retained so the worker can choose SIMD/LSTM support at runtime. `fonts.css` intentionally leaves the editor's declared system font fallbacks in use.

When refreshing dependencies, preserve signature/integrity/TLS verification, copy the corresponding licenses, run the browser integration checks, and update the service worker cache version. Keep the PDF worker version matched to PDF.js.
