import { createApi } from './api.js';
import { LANGS, LABEL_LANGS, claimValues, pickLabel, pickDescription, commonsImageUrl, commonsFilePage } from './lib.js';

const api = createApi();
const UI = 'de';
const $ = (id) => document.getElementById(id);

const EXAMPLES = [
  ['Hund', 'de'], ['chat', 'fr'], ['lion', 'en'], ['vaca', 'es'], ['gallo', 'it'],
  ['Kuckuck', 'de'], ['olifant', 'nl'], ['лягушка', 'ru'], ['wolf', 'en'], ['ネコ', 'ja'],
];

const langName = (() => {
  try {
    const dn = new Intl.DisplayNames([UI], { type: 'language' });
    return (code) => dn.of(code) || code;
  } catch {
    return (code) => code;
  }
})();

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* egal */ } },
};

// ---------- Aufbau ----------
for (const [code, name] of LANGS) $('lang').append(new Option(name, code));
$('lang').value = store.get('tierstimmen.lang') || 'auto';

for (const [word, lang] of EXAMPLES) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'chip';
  b.innerHTML = '<span></span><small></small>';
  b.firstChild.textContent = word;
  b.lastChild.textContent = lang;
  b.addEventListener('click', () => {
    $('q').value = word;
    $('lang').value = lang;
    run(word, lang);
  });
  $('examples').append(b);
}

$('search').addEventListener('submit', (e) => {
  e.preventDefault();
  const q = $('q').value.trim();
  if (q) run(q, $('lang').value);
});
$('lang').addEventListener('change', () => store.set('tierstimmen.lang', $('lang').value));

// ---------- Suche ----------
let token = 0;

async function run(query, lang) {
  const my = ++token;
  stop();
  setStatus(`Suche „${query}“ …`, 'busy');
  $('go').disabled = true;
  try {
    const { best, alternatives } = await api.findAnimal(query, lang, UI);
    if (my !== token) return;
    if (!best) {
      $('result').hidden = true;
      $('alts').hidden = true;
      setStatus(`Zu „${query}“ wurde nichts gefunden. Prüfe die Schreibweise oder wähle die Sprache der Eingabe aus.`, 'error');
      return;
    }
    updateUrl(query, lang);
    await show(best, lang, my);
    renderAlternatives(alternatives, lang);
  } catch (err) {
    if (my !== token) return;
    setStatus(`Die Suche hat nicht geklappt: ${err.message} Bitte Internetverbindung prüfen und nochmal versuchen.`, 'error');
  } finally {
    if (my === token) $('go').disabled = false;
  }
}

async function show(entity, lang, my) {
  const inputLang = lang === 'auto' ? UI : lang;
  const name = pickLabel(entity, [UI, 'en', inputLang]);
  const sci = claimValues(entity, 'P225')[0] || '';

  $('name').textContent = name;
  $('sci').textContent = sci;
  $('sci').hidden = !sci || sci.toLowerCase() === name.toLowerCase();
  $('desc').textContent = pickDescription(entity, [UI, 'en']);
  $('kind').textContent = 'Wikidata ' + entity.id;
  renderNames(entity, inputLang);

  // Bild
  const imgFile = claimValues(entity, 'P18')[0];
  const img = $('photo');
  img.alt = name;
  img.onerror = null;
  if (imgFile) {
    img.src = commonsImageUrl(imgFile, 1000);
    setCredit(imgFile);
  } else {
    img.removeAttribute('src');
    $('photo-credit').textContent = '';
  }
  $('result').hidden = false;
  $('wiki').hidden = true;
  setSounds(null);
  setStatus('Suche Tierlaute …', 'busy');

  const [sounds, sum] = await Promise.all([
    api.findSounds(entity).catch(() => []),
    api.summary(entity, [UI, 'en']).catch(() => null),
  ]);
  if (my !== token) return;

  if (sum && sum.extract) {
    $('extract').textContent = sum.extract;
    $('wiki-link').href = sum.url;
    $('wiki').hidden = false;
  }
  if (!imgFile && sum && sum.image) {
    img.src = sum.image;
    $('photo-credit').textContent = 'Bild: Wikipedia';
  }
  img.onerror = () => {
    if (sum && sum.image && img.src !== sum.image) img.src = sum.image;
  };

  setSounds(sounds);
  setStatus(sounds.length ? '' : `Für „${name}“ gibt es leider keine freie Tonaufnahme.`, sounds.length ? '' : 'info');
}

function setCredit(file) {
  const el = $('photo-credit');
  el.textContent = '';
  const a = document.createElement('a');
  a.href = commonsFilePage(file);
  a.target = '_blank';
  a.rel = 'noopener';
  a.textContent = 'Bild: Wikimedia Commons';
  el.append(a);
}

function renderNames(entity, highlight) {
  const dl = $('names');
  dl.textContent = '';
  const langs = [...new Set([highlight, ...LABEL_LANGS])];
  for (const l of langs) {
    const label = entity.labels && entity.labels[l];
    if (!label) continue;
    const row = document.createElement('div');
    if (l === highlight) row.className = 'hl';
    const dt = document.createElement('dt');
    dt.textContent = langName(l);
    const dd = document.createElement('dd');
    dd.textContent = label.value;
    dd.lang = l;
    row.append(dt, dd);
    dl.append(row);
  }
}

function renderAlternatives(list, lang) {
  const box = $('alt-list');
  box.textContent = '';
  for (const e of list) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.innerHTML = '<span></span><small></small>';
    b.firstChild.textContent = pickLabel(e, [UI, 'en']);
    b.lastChild.textContent = pickDescription(e, [UI, 'en']).slice(0, 40);
    b.addEventListener('click', () => {
      const my = ++token;
      stop();
      show(e, lang, my);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    box.append(b);
  }
  $('alts').hidden = list.length === 0;
}

// ---------- Abspielen ----------
let sounds = [];
let current = 0;
const audio = new Audio();
audio.preload = 'none';
let candidates = [];

function setSounds(list) {
  sounds = list || [];
  current = 0;
  const loading = list === null;
  $('play').disabled = loading || sounds.length === 0;
  $('play-label').textContent = loading ? 'Suche Tierlaut …' : sounds.length ? 'Ruf anhören' : 'Kein Tierlaut gefunden';
  $('next').hidden = sounds.length < 2;
  renderSoundMeta();
}

function renderSoundMeta() {
  const s = sounds[current];
  const el = $('sound-meta');
  el.textContent = '';
  if (!s) return;
  const parts = [s.artist, s.license].filter(Boolean).join(' · ');
  const a = document.createElement('a');
  a.href = s.page;
  a.target = '_blank';
  a.rel = 'noopener';
  a.textContent = sounds.length > 1 ? `Aufnahme ${current + 1} von ${sounds.length}` : 'Aufnahme';
  el.append(a);
  if (parts) el.append(` – ${parts}`);
}

function play() {
  const s = sounds[current];
  if (!s) return;
  candidates = s.sources.filter((src) => !src.type || audio.canPlayType(src.type.split(';')[0]) !== '');
  if (!candidates.length) candidates = s.sources.slice();
  tryNextSource();
}

function tryNextSource() {
  const src = candidates.shift();
  if (!src) {
    playing(false);
    // Diese Aufnahme lässt sich nicht abspielen – zur nächsten springen, wenn vorhanden.
    if (sounds.length > 1 && current < sounds.length - 1) {
      current++;
      renderSoundMeta();
      play();
    } else {
      setStatus('Die Aufnahme lässt sich in diesem Browser nicht abspielen.', 'error');
    }
    return;
  }
  audio.src = src.src;
  audio.play().then(() => playing(true), (err) => {
    if (err && err.name === 'NotAllowedError') {
      playing(false);
      setStatus('Der Browser hat das Abspielen blockiert. Bitte nochmal auf den Knopf tippen.', 'info');
    }
    // Andere Fehler laufen über das error-Event
  });
}

function stop() {
  audio.pause();
  playing(false);
}

function playing(on) {
  $('play').classList.toggle('is-playing', on);
  $('play').setAttribute('aria-label', on ? 'Anhalten' : 'Ruf anhören');
  if (sounds.length) $('play-label').textContent = on ? 'Läuft … zum Anhalten tippen' : 'Ruf anhören';
}

audio.addEventListener('error', () => { if (audio.src) tryNextSource(); });
audio.addEventListener('ended', () => playing(false));

$('play').addEventListener('click', () => {
  if (!audio.paused) stop();
  else play();
});
$('next').addEventListener('click', () => {
  if (!sounds.length) return;
  stop();
  current = (current + 1) % sounds.length;
  renderSoundMeta();
  play();
});

// ---------- Hilfen ----------
function setStatus(text, kind = '') {
  const el = $('status');
  el.textContent = text;
  el.dataset.kind = kind;
  el.hidden = !text;
}

function updateUrl(q, lang) {
  try {
    const u = new URL(location.href);
    u.searchParams.set('tier', q);
    u.searchParams.set('sprache', lang);
    history.replaceState(null, '', u);
  } catch { /* egal */ }
}

// Start: Tier aus der Adresse oder ein Beispiel
const params = new URLSearchParams(location.search);
const startQ = params.get('tier') || 'Hund';
const startLang = params.get('sprache') || (params.get('tier') ? $('lang').value : 'de');
$('q').value = startQ;
if (LANGS.some(([c]) => c === startLang)) $('lang').value = startLang;
run(startQ, $('lang').value);
