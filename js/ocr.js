// Texterkennung mit Tesseract.js (läuft komplett im Browser, Bild verlässt das Gerät nicht).

// Alle Dateien kommen versioniert von jsdelivr, damit der Service Worker sie für offline cachen kann.
const CDN = 'https://cdn.jsdelivr.net/npm';
const TESSERACT_URL = `${CDN}/tesseract.js@5.1.1/dist/tesseract.min.js`;
const WORKER_OPTIONS = {
  workerPath: `${CDN}/tesseract.js@5.1.1/dist/worker.min.js`,
  corePath: `${CDN}/tesseract.js-core@5.1.1`,
  langPath: `${CDN}/@tesseract.js-data/deu@1.0.0/4.0.0_best_int`,
};

let workerPromise = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Texterkennung konnte nicht geladen werden (offline?)'));
    document.head.appendChild(s);
  });
}

let progressCb = () => {};

async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      await loadScript(TESSERACT_URL);
      const worker = await window.Tesseract.createWorker('deu', 1, {
        ...WORKER_OPTIONS,
        logger: (m) => progressCb(m),
      });
      await worker.setParameters({ preserve_interword_spaces: '1' });
      return worker;
    })().catch((e) => {
      workerPromise = null;
      throw e;
    });
  }
  return workerPromise;
}

/** Bild verkleinern, in Graustufen umwandeln und Kontrast erhöhen – verbessert die Erkennung deutlich. */
export async function preprocess(file) {
  const bitmap = await createImageBitmap(file);
  const maxSide = 2200;
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  let min = 255;
  let max = 0;
  const gray = new Uint8ClampedArray(w * h);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    gray[j] = g;
    if (g < min) min = g;
    if (g > max) max = g;
  }
  const range = Math.max(1, max - min);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    let v = ((gray[j] - min) / range) * 255;
    v = v < 128 ? v * 0.6 : 255 - (255 - v) * 0.6; // Kontrastkurve
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

export async function recognize(file, onProgress = () => {}) {
  progressCb = (m) => {
    if (m.status === 'recognizing text') onProgress('Text wird erkannt …', m.progress);
    else if (m.status) onProgress('Vorbereitung: ' + m.status, m.progress || 0);
  };
  onProgress('Bild wird vorbereitet …', 0);
  const canvas = await preprocess(file);
  const worker = await getWorker();
  const { data } = await worker.recognize(canvas);
  return data.text;
}
