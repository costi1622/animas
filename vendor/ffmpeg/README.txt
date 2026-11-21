FFmpeg.wasm pentru Montaj AI (Animas 1.9.0), local în telefon, fără server:
- ffmpeg.js + 814.ffmpeg.js: @ffmpeg/ffmpeg 0.12.15 (MIT), varianta UMD
- ffmpeg-core.js + ffmpeg-core.wasm.0–6: @ffmpeg/core 0.12.10 (FFmpeg, GPL, cu x264), un singur fir (fără SharedArrayBuffer)
  wasm-ul are 32.232.419 octeți și e tăiat în bucăți de 5.000.000 (limita GitHub de 25 MB); se lipesc la încărcare (videoMerger.js).
Se descarcă doar la primul export și rămân în copia telefonului (service worker, cache „animas-lib”).
