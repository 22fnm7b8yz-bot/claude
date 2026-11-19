// Zerlegt den OCR-Text eines Kassenbons in Händler, Datum, Summe und Positionen.
// Reine Funktionen ohne DOM-Zugriff, damit sie mit Node getestet werden können.

export const KNOWN_STORES = [
  'ALDI SÜD', 'ALDI NORD', 'ALDI', 'LIDL', 'REWE', 'EDEKA', 'PENNY', 'NETTO', 'KAUFLAND',
  'NORMA', 'GLOBUS', 'MARKTKAUF', 'TEGUT', 'DM', 'ROSSMANN', 'MÜLLER', 'BUDNI', 'REAL',
  'HIT', 'FAMILA', 'COMBI', 'NAH & FRISCH', 'DENNS', 'ALNATURA', 'BIOCOMPANY',
  'SPAR', 'BILLA', 'HOFER', 'MERKUR', 'MPREIS', 'MIGROS', 'COOP', 'DENNER', 'METRO',
];

// Zeilen, die keine Artikel sind (Summen, Zahlungsart, Steuer, Fußzeilen …)
const NON_ITEM = new RegExp(
  [
    'summe', 'gesamt', 'zwischensumme', 'zu\\s*zahlen', 'total', 'betrag',
    'mwst', 'm\\s*w\\s*st', 'ust', 'steuer', 'netto', 'brutto',
    '\\bbar\\b', 'gegeben', 'r[üu]e?ckgeld', 'wechselgeld',
    'ec[-\\s]?karte', 'karten?zahlung', 'girocard', 'visa', 'mastercard', 'maestro',
    'kreditkarte', 'kontaktlos', 'paypal', 'tse', 'transaktion', 'terminal', 'trace',
    'autorisierung', 'genehmigung', 'payback', 'punkte', 'kassierer', 'kasse\\s*\\d',
    'bon[-\\s]?nr', 'beleg[-\\s]?nr', 'uhrzeit', 'datum', 'danke', 'vielen dank',
    'st\\.?[-\\s]?nr', 'ust[-\\s]?id', 'steuernummer', '\\bposten\\b', 'anzahl\\s+artikel',
    '\\bsatz\\b', 'filiale', '\\btel\\b', 'www\\.', 'öffnungszeiten',
  ].join('|'),
  'i',
);

const DISCOUNT = /(rabatt|preisvorteil|coupon|gutschein|aktion|nachlass|sofort|reduziert|ersparnis|-\s*\d+\s*%)/i;

// Preis am Zeilenende, optional gefolgt von Steuerkennzeichen (A, B, 1, 2, *) oder Währung
const PRICE_AT_END =
  /(-?\s?\d{1,4}[.,]\s?\d{2})\s*(-)?\s*(?:€|eur)?\s*(?:[a-c]|[12]|\*|[a-c]\s*\*)?\s*$/i;
const QTY_TIMES_PRICE = /(\d{1,3})\s*(?:stk\.?|st\.?)?\s*[x×*]\s*(\d{1,4}[.,]\d{2})/i;
const PRICE_TIMES_QTY = /(\d{1,4}[.,]\d{2})\s*(?:€|eur)?\s*[x×*]\s*(\d{1,3})(?!\s*[.,]\d)/i;
const WEIGHT_LINE =
  /(\d{1,3}[.,]\d{1,3})\s*kg\s*[x×*]\s*(\d{1,4}[.,]\d{2})\s*(?:€|eur)?\s*\/?\s*kg/i;
const DATE = /\b(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})\b/;
const SIZE = /(\d+(?:[.,]\d+)?)\s*(kg|g|gr|l|ltr|ml|cl|stk|st)\b\.?/i;

export function toNumber(str) {
  if (str == null) return NaN;
  const s = String(str).replace(/\s/g, '').replace(',', '.');
  return Number.parseFloat(s);
}

export function round2(n) {
  return Math.round(n * 100) / 100;
}

/** Erkennt eine Packungsgröße im Artikelnamen und rechnet sie in g, ml oder Stück um. */
export function parseSize(name) {
  const m = SIZE.exec(name || '');
  if (!m) return null;
  const value = toNumber(m[1]);
  if (!value) return null;
  const u = m[2].toLowerCase();
  switch (u) {
    case 'kg': return { amount: value * 1000, unit: 'g' };
    case 'g': case 'gr': return { amount: value, unit: 'g' };
    case 'l': case 'ltr': return { amount: value * 1000, unit: 'ml' };
    case 'cl': return { amount: value * 10, unit: 'ml' };
    case 'ml': return { amount: value, unit: 'ml' };
    default: return { amount: value, unit: 'stk' };
  }
}

/** Grundpreis (pro kg, l oder Stück) für einen Artikel – oder null, wenn unbekannt. */
export function unitPrice(item) {
  const total = item.price;
  if (!(total > 0)) return null;
  if (item.weightKg) return { value: round2(total / item.weightKg), label: '€/kg' };
  const size = item.size;
  if (!size || !size.amount) return null;
  const qty = item.qty || 1;
  if (size.unit === 'g') return { value: round2((total / qty / size.amount) * 1000), label: '€/kg' };
  if (size.unit === 'ml') return { value: round2((total / qty / size.amount) * 1000), label: '€/l' };
  return { value: round2(total / qty / size.amount), label: '€/Stk' };
}

/** Vereinheitlichter Vergleichsschlüssel für einen Artikelnamen. */
export function normalizeName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(new RegExp(SIZE.source, 'gi'), ' ')
    .replace(/\d+([.,]\d+)?\s*%/g, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\b\d+\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanName(raw) {
  return raw
    .replace(/^\s*\d{4,}\s+/, '') // führende Artikelnummer
    .replace(/[|_~]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/[\s.:*-]+$/, '')
    .trim();
}

export function detectStore(lines) {
  const head = lines.slice(0, 8).join(' ').toUpperCase();
  for (const s of KNOWN_STORES) {
    const re = new RegExp(`(^|[^A-ZÄÖÜ])${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^A-ZÄÖÜ]|$)`);
    if (re.test(head)) return s.replace(/ (SÜD|NORD)$/, (m) => m);
  }
  const first = lines.find((l) => /[a-zäöü]{3,}/i.test(l) && !/^\d/.test(l));
  return first ? first.trim().slice(0, 40) : '';
}

export function detectDate(text) {
  const m = DATE.exec(text);
  if (!m) return '';
  let [, d, mo, y] = m;
  if (y.length === 2) y = `20${y}`;
  const dd = Number(d);
  const mm = Number(mo);
  if (dd < 1 || dd > 31 || mm < 1 || mm > 12) return '';
  return `${y}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

function parseQuantityInfo(line) {
  const w = WEIGHT_LINE.exec(line);
  if (w) return { weightKg: toNumber(w[1]), unitPriceRaw: toNumber(w[2]) };
  const a = QTY_TIMES_PRICE.exec(line);
  if (a) return { qty: Number(a[1]), unitPriceRaw: toNumber(a[2]) };
  const b = PRICE_TIMES_QTY.exec(line);
  if (b) return { qty: Number(b[2]), unitPriceRaw: toNumber(b[1]) };
  return null;
}

function matchesPrice(item, info) {
  if (!item || !info) return false;
  const expected = info.weightKg ? info.weightKg * info.unitPriceRaw : info.qty * info.unitPriceRaw;
  return Math.abs(expected - (item.price + (item.discount || 0))) < 0.02;
}

function applyQuantity(item, info) {
  if (!item || !info) return;
  if (info.weightKg) item.weightKg = info.weightKg;
  if (info.qty) item.qty = info.qty;
}

/**
 * Hauptfunktion: OCR-Text → { store, date, total, items[] }
 * items: { name, price, qty, weightKg?, size?, key }
 */
export function parseReceipt(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((l) => l.replace(/\t/g, ' ').trim())
    .filter(Boolean);

  const result = { store: detectStore(lines), date: detectDate(text), total: null, items: [] };
  let pendingQty = null;
  let reachedTotal = false;

  for (const line of lines) {
    const priceMatch = PRICE_AT_END.exec(line);
    const isTotal = /(summe|gesamt|zu\s*zahlen|total)/i.test(line) && !/zwischen/i.test(line);

    if (isTotal && priceMatch && result.total == null) {
      result.total = Math.abs(toNumber(priceMatch[1]));
      reachedTotal = true;
      continue;
    }
    if (reachedTotal) continue; // nach der Summe folgen nur noch Zahlungsinfos
    if (NON_ITEM.test(line)) continue;

    const qtyInfo = parseQuantityInfo(line);

    // Mengeninfo herausschneiden, danach den Preis am Zeilenende suchen
    const stripped = line
      .replace(WEIGHT_LINE, ' ')
      .replace(QTY_TIMES_PRICE, ' ')
      .replace(PRICE_TIMES_QTY, ' ');
    const rest = qtyInfo ? PRICE_AT_END.exec(stripped) : priceMatch;
    const namePart = rest ? stripped.slice(0, rest.index) : stripped;
    const name = cleanName(namePart);
    const hasName = /[a-zäöüß]{2,}/i.test(name.replace(/\b(stk|st|kg|eur|x)\b\.?/gi, ''));

    if (!hasName || !rest) {
      if (!qtyInfo) continue;
      // Reine Mengenzeile: gehört zum vorherigen Artikel, wenn der Betrag passt,
      // sonst zum nächsten Artikel.
      const prev = result.items[result.items.length - 1];
      if (prev && matchesPrice(prev, qtyInfo)) applyQuantity(prev, qtyInfo);
      else pendingQty = qtyInfo;
      continue;
    }

    let price = toNumber(rest[1]);
    if (rest[2] === '-') price = -Math.abs(price);

    if ((price < 0 || DISCOUNT.test(name)) && result.items.length && !/pfand|leergut/i.test(name)) {
      const prev = result.items[result.items.length - 1];
      prev.price = round2(prev.price - Math.abs(price));
      prev.discount = round2((prev.discount || 0) + Math.abs(price));
      continue;
    }

    const item = { name, price: round2(price), qty: 1 };
    const size = parseSize(name);
    if (size) item.size = size;
    if (qtyInfo) applyQuantity(item, qtyInfo);
    else if (pendingQty) applyQuantity(item, pendingQty);
    pendingQty = null;
    item.key = normalizeName(name);
    result.items.push(item);
  }

  return result;
}
