// Barcode-Scanner für EAN/UPC: nutzt den eingebauten BarcodeDetector (Chrome/Android),
// sonst die ZXing-Bibliothek (z. B. für iPhone/Safari).

const ZXING_URL = 'https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js';
const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e'];

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (window.ZXing) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Barcode-Bibliothek konnte nicht geladen werden'));
    document.head.appendChild(s);
  });
}

async function nativeSupported() {
  if (!('BarcodeDetector' in window)) return false;
  try {
    const supported = await window.BarcodeDetector.getSupportedFormats();
    return FORMATS.some((f) => supported.includes(f));
  } catch {
    return false;
  }
}

/**
 * Startet die Kamera im <video>-Element und ruft onCode(code) beim ersten Treffer auf.
 * Gibt eine stop()-Funktion zurück.
 */
export async function startScanner(video, onCode) {
  let stopped = false;
  let stream = null;
  let zxingReader = null;

  const stop = () => {
    stopped = true;
    if (zxingReader) zxingReader.reset();
    if (stream) stream.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
  };

  if (await nativeSupported()) {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 } },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();
    const detector = new window.BarcodeDetector({ formats: FORMATS });
    const tick = async () => {
      if (stopped) return;
      try {
        const codes = await detector.detect(video);
        if (codes.length) {
          stop();
          onCode(codes[0].rawValue);
          return;
        }
      } catch { /* Frame noch nicht bereit */ }
      setTimeout(tick, 200);
    };
    tick();
  } else {
    await loadScript(ZXING_URL);
    const hints = new Map();
    hints.set(window.ZXing.DecodeHintType.POSSIBLE_FORMATS, [
      window.ZXing.BarcodeFormat.EAN_13,
      window.ZXing.BarcodeFormat.EAN_8,
      window.ZXing.BarcodeFormat.UPC_A,
      window.ZXing.BarcodeFormat.UPC_E,
    ]);
    zxingReader = new window.ZXing.BrowserMultiFormatReader(hints);
    await zxingReader.decodeFromConstraints(
      { video: { facingMode: 'environment' }, audio: false },
      video,
      (result) => {
        if (result && !stopped) {
          stop();
          onCode(result.getText());
        }
      },
    );
  }
  return stop;
}
