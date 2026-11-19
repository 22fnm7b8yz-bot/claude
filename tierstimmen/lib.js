// Reine Hilfsfunktionen ohne DOM – testbar mit `node --test`.

/** Sprachen, in denen man suchen kann (Code, Anzeigename). */
export const LANGS = [
  ['auto', 'Automatisch erkennen'],
  ['de', 'Deutsch'],
  ['en', 'English'],
  ['fr', 'Français'],
  ['es', 'Español'],
  ['it', 'Italiano'],
  ['nl', 'Nederlands'],
  ['pt', 'Português'],
  ['pl', 'Polski'],
  ['tr', 'Türkçe'],
  ['sv', 'Svenska'],
  ['da', 'Dansk'],
  ['nb', 'Norsk'],
  ['fi', 'Suomi'],
  ['cs', 'Čeština'],
  ['hu', 'Magyar'],
  ['ro', 'Română'],
  ['hr', 'Hrvatski'],
  ['el', 'Ελληνικά'],
  ['ru', 'Русский'],
  ['uk', 'Українська'],
  ['ar', 'العربية'],
  ['he', 'עברית'],
  ['hi', 'हिन्दी'],
  ['zh', '中文'],
  ['ja', '日本語'],
  ['ko', '한국어'],
];

/** Sprachen, in denen der Name des Tiers zusätzlich angezeigt wird. */
export const LABEL_LANGS = ['de', 'en', 'fr', 'es', 'it', 'nl', 'pt', 'pl', 'tr', 'sv', 'ru', 'el', 'ar', 'zh', 'ja'];

const LATIN_DEFAULT = ['de', 'en', 'fr', 'es', 'it', 'nl', 'pt', 'pl', 'tr', 'sv'];

/** Welche Sprachen kommen für den eingegebenen Text in Frage? (Erkennung über die Schrift) */
export function guessLanguages(text) {
  const t = String(text || '');
  if (/[぀-ヿ]/.test(t)) return ['ja'];
  if (/[가-힯ᄀ-ᇿ]/.test(t)) return ['ko'];
  if (/[一-鿿]/.test(t)) return ['zh', 'ja'];
  if (/[Ѐ-ӿ]/.test(t)) return ['ru', 'uk', 'bg', 'sr'];
  if (/[Ͱ-Ͽ]/.test(t)) return ['el'];
  if (/[֐-׿]/.test(t)) return ['he'];
  if (/[؀-ۿ]/.test(t)) return ['ar', 'fa'];
  if (/[ऀ-ॿ]/.test(t)) return ['hi'];
  if (/[฀-๿]/.test(t)) return ['th'];
  return LATIN_DEFAULT;
}

/** Für Vergleiche: Kleinschreibung, ohne Akzente und überflüssige Leerzeichen. */
export function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Führt die Trefferlisten mehrerer Sprachen zusammen.
 * lists: Array (eine Liste je Sprache, in Prioritätsreihenfolge) von wbsearchentities-Ergebnissen.
 */
export function mergeSearchResults(query, lists) {
  const q = normalize(query);
  const byId = new Map();
  lists.forEach((list, langIndex) => {
    (list || []).forEach((r, rank) => {
      if (!r || !r.id) return;
      let s = 10 - rank - langIndex * 0.3;
      if (r.match && normalize(r.match.text) === q) s += 20;
      if (normalize(r.label) === q) s += 5;
      const prev = byId.get(r.id);
      if (prev) {
        prev.score = Math.max(prev.score, s) + 1;
      } else {
        byId.set(r.id, { id: r.id, label: r.label, description: r.description || '', score: s });
      }
    });
  });
  return [...byId.values()].sort((a, b) => b.score - a.score);
}

/** Werte einer Eigenschaft (Strings oder Item-IDs) aus den Wikidata-Claims. */
export function claimValues(entity, prop) {
  const claims = (entity && entity.claims && entity.claims[prop]) || [];
  const out = [];
  for (const c of claims) {
    const v = c && c.mainsnak && c.mainsnak.datavalue && c.mainsnak.datavalue.value;
    if (v == null) continue;
    if (typeof v === 'string') out.push(v);
    else if (v.id) out.push(v.id);
  }
  return out;
}

// Dinge, die sicher kein Tier sind (Begriffsklärung, Name, Film, Ort, Person, Werk …)
const NOT_ANIMAL = new Set([
  'Q4167410', 'Q101352', 'Q202444', 'Q12308941', 'Q11879590', 'Q11424', 'Q482994', 'Q7366',
  'Q134556', 'Q5', 'Q515', 'Q486972', 'Q532', 'Q3957', 'Q4022', 'Q8502', 'Q5398426',
  'Q215380', 'Q13442814', 'Q571', 'Q7725634', 'Q47461344', 'Q3305213', 'Q15632617',
  'Q95074', 'Q4830453', 'Q783794', 'Q43229', 'Q8436', 'Q15416', 'Q1002697', 'Q7889',
]);

const ANIMAL_WORDS = /\b(tier|tierart|haustier|nutztier|säugetier|vogel|vogelart|insekt|fisch|reptil|amphib|lurch|rasse|unterart|gattung|art der|animal|mammal|bird|insect|fish|reptile|amphibian|breed|species|subspecies|genus|espèce|oiseau|mammifère|especie|ave|mamífero|specie|uccello|mammifero|diersoort|zoogdier|soort|gatunek|ssak|ptak)/i;

/** Wie wahrscheinlich ist dieser Treffer das gesuchte Tier? */
export function scoreEntity(entity, baseScore = 0) {
  let s = baseScore;
  const has = (p) => claimValues(entity, p).length > 0;
  if (has('P225') || has('P171') || has('P105')) s += 8; // Taxon
  if (has('P51')) s += 10; // hat eine Tonaufnahme
  if (has('P18')) s += 4; // hat ein Bild
  const p31 = claimValues(entity, 'P31');
  if (p31.includes('Q16521')) s += 2; // Taxon
  if (p31.includes('Q55983715')) s += 8; // Organismen mit volkstümlichem Namen (z. B. Hund)
  if (p31.includes('Q39367')) s += 6; // Hunderasse
  if (p31.includes('Q38829')) s += 4; // Haustierrasse
  if (p31.some((id) => NOT_ANIMAL.has(id))) s -= 30;
  const desc = Object.values((entity && entity.descriptions) || {}).map((d) => d.value).join(' ');
  if (ANIMAL_WORDS.test(desc)) s += 3;
  return s;
}

/** Ist das ein Tier (und nicht z. B. ein Film oder Familienname)? */
export function looksLikeAnimal(entity) {
  const p31 = claimValues(entity, 'P31');
  if (p31.some((id) => NOT_ANIMAL.has(id))) return false;
  if (claimValues(entity, 'P225').length || claimValues(entity, 'P171').length) return true;
  if (p31.includes('Q55983715') || p31.includes('Q39367') || p31.includes('Q38829')) return true;
  const desc = Object.values((entity && entity.descriptions) || {}).map((d) => d.value).join(' ');
  return ANIMAL_WORDS.test(desc);
}

/** Label in der gewünschten Sprache, sonst Fallback. */
export function pickLabel(entity, langs) {
  const labels = (entity && entity.labels) || {};
  for (const l of langs) if (labels[l]) return labels[l].value;
  const any = Object.values(labels)[0];
  return any ? any.value : (entity && entity.id) || '';
}

export function pickDescription(entity, langs) {
  const d = (entity && entity.descriptions) || {};
  for (const l of langs) if (d[l]) return d[l].value;
  return '';
}

const LANG_PREFIXES = new Set(('af ar ast bar be bg bn br ca cs cy da de el en eo es et eu fa fi fr ga gl gsw he hi hr hu hy id is it ja ka ko la lb lt lv mk ms mt nan nb nds nl nn no oc pl pt ro ru sk sl sq sr sv sw ta th tl tr uk ur vi wuu yue zh').split(' '));

/** Erkennt Aussprache-Aufnahmen (z. B. „De-Hund.ogg“, „LL-Q188 (deu)-…“) und gesprochene Artikel. */
export function isLikelyPronunciation(title) {
  const n = String(title || '').replace(/^(File|Datei):/i, '');
  if (/^LL-Q\d+/i.test(n)) return true;
  if (/pronunc|aussprache|prononciation|pronuncia|pronúncia|uitspraak|wymowa|spoken|gesprochen|wikipedia|artikel|article/i.test(n)) return true;
  const m = n.match(/^([a-z]{2,3})(-[a-z]{2,4})?-/i);
  if (m && LANG_PREFIXES.has(m[1].toLowerCase())) return true;
  return false;
}

export function isAudioMime(mime) {
  const m = String(mime || '').toLowerCase();
  if (m.includes('midi')) return false;
  return m.startsWith('audio/') || m === 'application/ogg';
}

function absUrl(u) {
  if (!u) return '';
  return u.startsWith('//') ? 'https:' + u : u;
}

function cleanType(t) {
  const s = String(t || '');
  return s.replace(/^application\/ogg/i, 'audio/ogg');
}

/**
 * Abspielbare Quellen einer Commons-Datei: MP3-Umwandlung zuerst (läuft auch auf dem iPhone),
 * dann das Original, dann weitere Umwandlungen.
 */
export function buildSources(info) {
  const ders = (info && info.derivatives) || [];
  const isMp3 = (d) => /mpeg|mp3/i.test(d.type || '') || /\.mp3$/i.test(d.src || '');
  const list = [
    ...ders.filter(isMp3).map((d) => ({ src: absUrl(d.src), type: 'audio/mpeg' })),
    ...(info && info.url ? [{ src: absUrl(info.url), type: cleanType(info.mime) }] : []),
    ...ders.filter((d) => !isMp3(d)).map((d) => ({ src: absUrl(d.src), type: cleanType(d.type) })),
  ];
  const seen = new Set();
  return list.filter((s) => s.src && !seen.has(s.src) && seen.add(s.src));
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ' };

/** HTML aus Commons-Metadaten (Urheber, Lizenz) in reinen Text umwandeln. */
export function cleanHtml(html) {
  return String(html || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (_, e) => ENTITIES[e])
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, ' ')
    .trim();
}

/** Bild-URL in passender Breite über Special:FilePath. */
export function commonsImageUrl(fileName, width = 900) {
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(fileName)}?width=${width}`;
}

export function commonsFilePage(fileName) {
  const name = String(fileName).replace(/^(File|Datei):/i, '').replace(/ /g, '_');
  return `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(name)}`;
}
