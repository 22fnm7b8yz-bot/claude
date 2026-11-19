import { db, uid } from './db.js';
import { parseReceipt, normalizeName, parseSize, unitPrice, round2 } from './parser.js';
import { recognize } from './ocr.js';
import { startScanner } from './barcode.js';
import { fetchByBarcode, searchProducts, splitIngredients, NUTRIENTS } from './off.js';

const $view = document.getElementById('view');
const $dialog = document.getElementById('dialog');
const $dialogBody = document.getElementById('dialog-body');

// ---------- Hilfsfunktionen ----------

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const eur = (n) => (n == null || Number.isNaN(n) ? '–' : n.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' }));
const num = (n, d = 1, min = 0) => (n == null || Number.isNaN(n) ? '–' : n.toLocaleString('de-DE', { minimumFractionDigits: min, maximumFractionDigits: d }));
const dateDE = (iso) => (iso ? new Date(iso + 'T12:00:00').toLocaleDateString('de-DE') : 'ohne Datum');
const parseNum = (v) => {
  const n = Number.parseFloat(String(v).replace(',', '.'));
  return Number.isNaN(n) ? 0 : n;
};

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}

function openDialog(html, onMount) {
  $dialogBody.innerHTML = html;
  $dialog.showModal();
  onMount?.($dialogBody);
}
function closeDialog() {
  $dialog.close();
}
$dialog.addEventListener('click', (e) => {
  if (e.target === $dialog) closeDialog();
});

function gradeBadge(g, title) {
  const v = g && /^[a-e]$/.test(g) ? g : 'x';
  return `<span class="grade ${v}" title="${esc(title)}">${v === 'x' ? '?' : v}</span>`;
}

function updateStats() {
  const n = db.receipts.length;
  const total = db.receipts.reduce((s, r) => s + (r.total ?? sumItems(r.items)), 0);
  document.getElementById('stats').textContent = n ? `${n} Belege · ${eur(total)}` : '';
}

const sumItems = (items) => round2(items.reduce((s, i) => s + (Number(i.price) || 0), 0));

// ---------- Router ----------

const routes = { scan: renderScan, belege: renderReceipts, preise: renderPrices, produkte: renderProducts };
let cleanup = null;

function route() {
  cleanup?.();
  cleanup = null;
  const [tab, arg] = (location.hash.slice(1) || 'scan').split('/');
  document.querySelectorAll('.tabbar a').forEach((a) => a.classList.toggle('active', a.dataset.tab === tab));
  (routes[tab] || renderScan)(arg ? decodeURIComponent(arg) : undefined);
  updateStats();
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);

// ---------- Scannen ----------

function renderScan() {
  $view.innerHTML = `
    <div class="card stack">
      <h2>Kassenbon oder Rechnung scannen</h2>
      <p class="muted small">Bon flach hinlegen, gut ausleuchten und möglichst gerade von oben fotografieren.
      Die Texterkennung läuft direkt auf deinem Gerät.</p>
      <label class="btn primary btn-big" for="cam">📷 Foto aufnehmen</label>
      <input id="cam" type="file" accept="image/*" capture="environment" hidden>
      <div class="row">
        <label class="btn grow" for="pick" style="margin:0">🖼️ Bild aus Galerie</label>
        <input id="pick" type="file" accept="image/*" hidden>
        <button class="grow" id="manual">⌨️ Text eingeben</button>
      </div>
      <div id="ocr-status" hidden>
        <div class="small" id="ocr-msg"></div>
        <div class="progress"><div id="ocr-bar"></div></div>
        <img id="ocr-preview" class="preview" alt="Vorschau">
      </div>
    </div>
    <div id="editor"></div>`;

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const status = $view.querySelector('#ocr-status');
    const msg = $view.querySelector('#ocr-msg');
    const bar = $view.querySelector('#ocr-bar');
    const img = $view.querySelector('#ocr-preview');
    status.hidden = false;
    img.src = URL.createObjectURL(file);
    $view.querySelector('#editor').innerHTML = '';
    try {
      const text = await recognize(file, (m, p) => {
        msg.textContent = m;
        bar.style.width = `${Math.round((p || 0) * 100)}%`;
      });
      msg.textContent = 'Fertig – bitte Positionen prüfen.';
      bar.style.width = '100%';
      const parsed = parseReceipt(text);
      showEditor({ id: null, ...parsed, rawText: text });
    } catch (err) {
      msg.innerHTML = `<span class="warn">Fehler: ${esc(err.message)}</span>`;
    }
    e.target.value = '';
  };
  $view.querySelector('#cam').addEventListener('change', onFile);
  $view.querySelector('#pick').addEventListener('change', onFile);
  $view.querySelector('#manual').addEventListener('click', () => {
    openDialog(`
      <h2>Bontext einfügen</h2>
      <p class="muted small">Z. B. aus einer E-Mail-Rechnung, einem PDF oder einem digitalen Kassenbon.
      Je Zeile ein Artikel mit Preis am Ende.</p>
      <textarea id="raw" placeholder="REWE\nMILCH 1L      1,19 B\nBROT          2,49 B\nSUMME         3,68"></textarea>
      <div class="row" style="margin-top:10px;justify-content:flex-end">
        <button id="cancel">Abbrechen</button>
        <button class="primary" id="ok">Übernehmen</button>
      </div>`, (root) => {
      root.querySelector('#cancel').onclick = closeDialog;
      root.querySelector('#ok').onclick = () => {
        const text = root.querySelector('#raw').value;
        closeDialog();
        showEditor({ id: null, ...parseReceipt(text), rawText: text });
      };
    });
  });
}

/** Bearbeitungsformular für einen (neuen oder gespeicherten) Beleg */
function showEditor(receipt, container = $view.querySelector('#editor') || $view) {
  const r = structuredClone(receipt);
  r.items = r.items || [];
  const knownStores = [...new Set(db.receipts.map((x) => x.store).filter(Boolean))];
  const knownKeys = [...new Set(db.allItems().map((i) => i.key).filter(Boolean))].sort();

  container.innerHTML = `
    <div class="card stack">
      <h2>${r.id ? 'Beleg bearbeiten' : 'Erkannter Beleg'}</h2>
      <div class="row">
        <div class="field"><label for="store">Händler</label><input id="store" list="stores" value="${esc(r.store)}"></div>
        <div class="field"><label for="date">Datum</label><input id="date" type="date" value="${esc(r.date)}"></div>
        <div class="field"><label for="total">Summe laut Bon</label><input id="total" inputmode="decimal" value="${r.total != null ? esc(String(r.total).replace('.', ',')) : ''}"></div>
      </div>
      <datalist id="stores">${knownStores.map((s) => `<option value="${esc(s)}">`).join('')}</datalist>
      <datalist id="keys">${knownKeys.map((s) => `<option value="${esc(s)}">`).join('')}</datalist>
      <h3>Positionen</h3>
      <p class="muted small" style="margin-top:-6px">Je Position: Name · Menge (oder z. B. 0,5kg) · Gesamtpreis · Vergleichsname.
      Artikel mit gleichem Vergleichsnamen werden im Preisvergleich zusammengefasst.</p>
      <div class="items" id="items"></div>
      <button id="add" class="small">＋ Position hinzufügen</button>
      <div class="sumline"><span>Summe Positionen</span><span id="sum"></span></div>
      <div class="small" id="diff"></div>
      ${r.rawText ? `<details><summary>Erkannter Rohtext</summary><textarea readonly>${esc(r.rawText)}</textarea></details>` : ''}
      <div class="row" style="justify-content:flex-end">
        ${r.id ? '<button class="danger" id="del">Löschen</button>' : ''}
        <button id="cancel">Verwerfen</button>
        <button class="primary" id="save">Speichern</button>
      </div>
    </div>`;

  const $items = container.querySelector('#items');
  const renderItems = () => {
    $items.innerHTML = r.items.length ? r.items.map((it, i) => `
      <div class="item-row" data-i="${i}">
        <input class="name" data-f="name" value="${esc(it.name)}" aria-label="Artikelname" placeholder="Artikel">
        <button class="icon danger" data-del="${i}" aria-label="Entfernen">✕</button>
        <input data-f="qty" inputmode="decimal" value="${esc(it.weightKg ? String(it.weightKg).replace('.', ',') + 'kg' : it.qty || 1)}" aria-label="Menge" title="Menge oder Gewicht (z. B. 2 oder 0,5kg)">
        <input data-f="price" inputmode="decimal" class="right" value="${esc(String(it.price).replace('.', ','))}" aria-label="Preis" placeholder="€">
        <input class="key" data-f="key" list="keys" value="${esc(it.key)}" placeholder="Vergleichsname" aria-label="Vergleichsname" title="Artikel mit gleichem Vergleichsnamen werden im Preisvergleich zusammengefasst">
      </div>`).join('') : '<p class="muted small">Keine Positionen erkannt – füge sie manuell hinzu.</p>';
    updateSum();
  };
  const updateSum = () => {
    const s = sumItems(r.items);
    container.querySelector('#sum').textContent = eur(s);
    const total = parseNum(container.querySelector('#total').value);
    const diff = container.querySelector('#diff');
    if (total && Math.abs(total - s) > 0.009) {
      diff.innerHTML = `<span class="warn">Abweichung zur Bonsumme: ${eur(round2(total - s))} – bitte Positionen prüfen.</span>`;
    } else diff.textContent = total ? '✓ Stimmt mit der Bonsumme überein' : '';
  };

  $items.addEventListener('input', (e) => {
    const row = e.target.closest('.item-row');
    if (!row) return;
    const it = r.items[Number(row.dataset.i)];
    const f = e.target.dataset.f;
    const v = e.target.value;
    if (f === 'name') {
      const oldAuto = normalizeName(it.name);
      it.name = v;
      it.size = parseSize(v) || undefined;
      if (!it.key || it.key === oldAuto) {
        it.key = normalizeName(v);
        row.querySelector('[data-f=key]').value = it.key;
      }
    } else if (f === 'price') it.price = parseNum(v);
    else if (f === 'qty') {
      if (/kg/i.test(v)) { it.weightKg = parseNum(v); it.qty = 1; } else { it.qty = parseNum(v) || 1; delete it.weightKg; }
    } else if (f === 'key') it.key = normalizeName(v) || v.trim().toLowerCase();
    updateSum();
  });
  $items.addEventListener('click', (e) => {
    const i = e.target.dataset.del;
    if (i === undefined) return;
    r.items.splice(Number(i), 1);
    renderItems();
  });
  container.querySelector('#total').addEventListener('input', updateSum);
  container.querySelector('#add').onclick = () => {
    r.items.push({ name: '', price: 0, qty: 1, key: '' });
    renderItems();
    $items.querySelector('.item-row:last-child .name')?.focus();
  };
  container.querySelector('#cancel').onclick = () => {
    if (r.id) location.hash = 'belege';
    else container.innerHTML = '';
  };
  container.querySelector('#del')?.addEventListener('click', () => {
    if (!confirm('Diesen Beleg wirklich löschen?')) return;
    db.deleteReceipt(r.id);
    toast('Beleg gelöscht');
    location.hash = 'belege';
  });
  container.querySelector('#save').onclick = () => {
    r.store = container.querySelector('#store').value.trim();
    r.date = container.querySelector('#date').value;
    const t = container.querySelector('#total').value.trim();
    r.total = t ? parseNum(t) : null;
    r.items = r.items.filter((it) => it.name.trim());
    for (const it of r.items) if (!it.key) it.key = normalizeName(it.name);
    if (!r.items.length) return alert('Bitte mindestens eine Position angeben.');
    r.created = r.created || new Date().toISOString();
    db.saveReceipt(r);
    toast('Beleg gespeichert');
    location.hash = 'belege';
  };
  renderItems();
  container.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---------- Belege ----------

function renderReceipts(id) {
  if (id) {
    const r = db.receipts.find((x) => x.id === id);
    if (r) {
      $view.innerHTML = '<div id="editor"></div>';
      showEditor(r);
      return;
    }
  }
  const rs = db.receipts;
  const byStore = {};
  for (const r of rs) byStore[r.store || 'Unbekannt'] = (byStore[r.store || 'Unbekannt'] || 0) + (r.total ?? sumItems(r.items));
  const maxStore = Math.max(1, ...Object.values(byStore));

  $view.innerHTML = `
    <div class="card">
      <h2>Belege</h2>
      ${rs.length ? `<ul class="list">${rs.map((r) => `
        <li data-id="${esc(r.id)}">
          <div><div class="title">${esc(r.store || 'Unbekannter Händler')}</div>
          <div class="muted small">${dateDE(r.date)} · ${r.items.length} Positionen</div></div>
          <div class="nowrap"><strong>${eur(r.total ?? sumItems(r.items))}</strong> ›</div>
        </li>`).join('')}</ul>`
      : '<div class="empty-state">Noch keine Belege. <a href="#scan">Jetzt den ersten Bon scannen</a>.</div>'}
    </div>
    ${rs.length ? `<div class="card">
      <h3 style="margin-top:0">Ausgaben pro Händler</h3>
      <table>${Object.entries(byStore).sort((a, b) => b[1] - a[1]).map(([s, v]) => `
        <tr><td>${esc(s)}</td><td style="width:45%"><div class="bar" style="width:${(v / maxStore) * 100}%"></div></td>
        <td class="num">${eur(v)}</td></tr>`).join('')}</table>
    </div>` : ''}
    <div class="card stack">
      <h3 style="margin-top:0">Daten</h3>
      <p class="muted small">Alle Daten liegen nur auf diesem Gerät. Mach regelmäßig eine Sicherung.</p>
      <div class="row">
        <button id="export">⬇️ Sicherung exportieren</button>
        <button id="csv">📊 Positionen als CSV</button>
        <label class="btn" for="import" style="margin:0">⬆️ Sicherung importieren</label>
        <input type="file" id="import" accept="application/json,.json" hidden>
        <button class="danger" id="wipe">Alles löschen</button>
      </div>
    </div>`;

  $view.querySelectorAll('.list li').forEach((li) => {
    li.onclick = () => { location.hash = `belege/${encodeURIComponent(li.dataset.id)}`; };
  });
  const download = (name, content, type) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([content], { type }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const today = new Date().toISOString().slice(0, 10);
  $view.querySelector('#export').onclick = () => download(`bonscan-${today}.json`, db.exportJSON(), 'application/json');
  $view.querySelector('#csv').onclick = () => {
    const q = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
    const rows = [['Datum', 'Händler', 'Artikel', 'Vergleichsname', 'Menge', 'Gewicht kg', 'Preis', 'Grundpreis', 'Einheit']];
    for (const it of db.allItems()) {
      const up = unitPrice(it);
      rows.push([it.date, it.store, it.name, it.key, it.qty, it.weightKg ?? '', String(it.price).replace('.', ','),
        up ? String(up.value).replace('.', ',') : '', up?.label ?? '']);
    }
    download(`bonscan-positionen-${today}.csv`, '﻿' + rows.map((r) => r.map(q).join(';')).join('\n'), 'text/csv');
  };
  $view.querySelector('#import').onchange = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      db.importJSON(await f.text());
      toast('Sicherung importiert');
      route();
    } catch (err) {
      alert('Import fehlgeschlagen: ' + err.message);
    }
  };
  $view.querySelector('#wipe').onclick = () => {
    if (confirm('Wirklich ALLE Belege und Produkte löschen? Das kann nicht rückgängig gemacht werden.')) {
      db.clear();
      route();
    }
  };
}

// ---------- Preisvergleich ----------

function groupByKey() {
  const groups = new Map();
  for (const it of db.allItems()) {
    if (!it.key || !(it.price > 0) || /pfand|leergut/.test(it.key)) continue;
    if (!groups.has(it.key)) groups.set(it.key, []);
    groups.get(it.key).push(it);
  }
  return groups;
}

/** Vergleichbarer Preis: Grundpreis, falls bekannt, sonst Stückpreis */
function comparablePrice(it) {
  const up = unitPrice(it);
  if (up) return { value: up.value, label: up.label };
  return { value: round2(it.price / (it.qty || 1)), label: '€/Stk' };
}

function summarize(items) {
  const withCp = items.map((it) => ({ ...it, cp: comparablePrice(it) }));
  // die häufigste Einheit bestimmt den Vergleich
  const labels = {};
  for (const i of withCp) labels[i.cp.label] = (labels[i.cp.label] || 0) + 1;
  const label = Object.entries(labels).sort((a, b) => b[1] - a[1])[0][0];
  const comparable = withCp.filter((i) => i.cp.label === label);
  const prices = comparable.map((i) => i.cp.value);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const cheapest = comparable.find((i) => i.cp.value === min);
  const latest = [...withCp].sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0];
  const stores = new Set(items.map((i) => i.store));
  const byStore = {};
  for (const i of comparable) {
    const s = i.store || 'Unbekannt';
    (byStore[s] ||= []).push(i.cp.value);
  }
  const storeAvg = Object.entries(byStore)
    .map(([s, v]) => ({ store: s, avg: round2(v.reduce((a, b) => a + b, 0) / v.length), n: v.length }))
    .sort((a, b) => a.avg - b.avg);
  return { items: withCp, label, min, max, cheapest, latest, stores, storeAvg, saving: round2(max - min) };
}

function renderPrices(key) {
  const groups = groupByKey();
  if (key && groups.has(key)) return renderPriceDetail(key, groups.get(key));

  const all = [...groups.entries()].map(([k, items]) => ({ key: k, ...summarize(items) }));
  $view.innerHTML = `
    <div class="card">
      <h2>Preise vergleichen</h2>
      <input id="q" type="search" placeholder="Artikel suchen, z. B. Milch …" autocomplete="off">
      <div class="row small muted" style="margin-top:8px">
        <label style="margin:0;display:flex;gap:6px;align-items:center;color:inherit">
          <input type="checkbox" id="multi" style="width:auto"> nur mehrfach gekaufte Artikel
        </label>
      </div>
    </div>
    <div class="card"><ul class="list" id="plist"></ul></div>
    <div class="card" id="tips"></div>`;

  const $list = $view.querySelector('#plist');
  const draw = () => {
    const q = normalizeName($view.querySelector('#q').value);
    const multi = $view.querySelector('#multi').checked;
    const rows = all
      .filter((g) => (!q || g.key.includes(q)) && (!multi || g.items.length > 1))
      .sort((a, b) => b.items.length - a.items.length || b.saving - a.saving);
    $list.innerHTML = rows.length ? rows.map((g) => `
      <li data-key="${esc(g.key)}">
        <div><div class="title">${esc(g.latest.name)}</div>
          <div class="muted small">${g.items.length}× gekauft · ${g.stores.size} ${g.stores.size === 1 ? 'Händler' : 'Händler'}
          ${g.stores.size > 1 ? ` · günstigst bei <strong>${esc(g.cheapest.store)}</strong>` : ''}</div></div>
        <div class="right nowrap"><div><strong>${num(g.min, 2, 2)}</strong>${g.max > g.min ? `–${num(g.max, 2, 2)}` : ''} ${esc(g.label)}</div>
          ${g.saving > 0 ? `<div class="small" style="color:var(--good)">bis ${num(g.saving, 2, 2)} ${esc(g.label)} sparen</div>` : ''}</div>
      </li>`).join('')
      : `<div class="empty-state">${all.length ? 'Nichts gefunden.' : 'Noch keine Preise – scanne zuerst ein paar Bons.'}</div>`;
    $list.querySelectorAll('li').forEach((li) => {
      li.onclick = () => { location.hash = `preise/${encodeURIComponent(li.dataset.key)}`; };
    });
  };
  $view.querySelector('#q').addEventListener('input', draw);
  $view.querySelector('#multi').addEventListener('change', draw);
  draw();

  // Händler-Ranking über alle mehrfach gekauften Artikel
  const storeWins = {};
  for (const g of all) {
    if (g.storeAvg.length < 2) continue;
    const best = g.storeAvg[0].store;
    storeWins[best] = (storeWins[best] || 0) + 1;
  }
  const wins = Object.entries(storeWins).sort((a, b) => b[1] - a[1]);
  $view.querySelector('#tips').innerHTML = wins.length
    ? `<h3 style="margin-top:0">Wer ist am günstigsten?</h3>
       <p class="muted small">Anzahl Artikel, bei denen der Händler den niedrigsten Durchschnittspreis hat.</p>
       <table>${wins.map(([s, n]) => `<tr><td>${esc(s)}</td><td class="num">${n} Artikel</td></tr>`).join('')}</table>`
    : '<p class="muted small" style="margin:0">💡 Tipp: Damit Artikel verglichen werden, müssen sie denselben <em>Vergleichsnamen</em> haben. Den kannst du beim Bearbeiten eines Belegs anpassen (z. B. „Vollmilch“ und „Milch 3,5%“ → „milch“).</p>';
}

function renderPriceDetail(key, items) {
  const s = summarize(items);
  const products = db.products.filter((p) => p.key === key);
  const rows = [...s.items].sort((a, b) => a.cp.value - b.cp.value);
  $view.innerHTML = `
    <p><a href="#preise">‹ Alle Artikel</a></p>
    <div class="card">
      <h2>${esc(s.latest.name)}</h2>
      <p class="muted small">Vergleichsname: <code>${esc(key)}</code> · ${items.length} Käufe</p>
      ${s.storeAvg.length > 1 ? `<h3>Durchschnitt pro Händler (${esc(s.label)})</h3>
      <table>${s.storeAvg.map((x, i) => `<tr class="${i === 0 ? 'best' : ''}"><td>${esc(x.store)}</td><td class="muted small">${x.n}×</td><td class="num">${num(x.avg, 2, 2)} ${esc(s.label)}</td></tr>`).join('')}</table>` : ''}
      <h3>Alle Käufe</h3>
      <div class="table-wrap"><table>
        <tr><th>Datum</th><th>Händler</th><th>Artikel</th><th class="num">Preis</th><th class="num">${esc(s.label)}</th></tr>
        ${rows.map((it) => `<tr class="${it.cp.value === s.min && rows.length > 1 ? 'best' : ''}">
          <td class="nowrap">${dateDE(it.date)}</td><td>${esc(it.store)}</td>
          <td>${esc(it.name)}${it.qty > 1 ? ` <span class="muted">×${it.qty}</span>` : ''}${it.weightKg ? ` <span class="muted">${num(it.weightKg, 3)} kg</span>` : ''}</td>
          <td class="num">${eur(it.price)}</td><td class="num">${it.cp.label === s.label ? num(it.cp.value, 2, 2) : '–'}</td></tr>`).join('')}
      </table></div>
    </div>
    <div class="card">
      <h3 style="margin-top:0">Inhaltsstoffe</h3>
      ${products.length ? products.map(productCard).join('') : '<p class="muted small">Noch kein Produkt verknüpft. Scanne im Tab „Inhalt“ den Barcode und wähle diesen Vergleichsnamen.</p>'}
      <a class="btn" href="#produkte">🥫 Produkt scannen</a>
    </div>`;
  bindProductCards();
}

// ---------- Produkte & Inhaltsstoffe ----------

const selected = new Set();

function productCard(p) {
  return `
    <div class="card product-card" data-code="${esc(p.code)}">
      ${p.image ? `<img src="${esc(p.image)}" alt="" loading="lazy">` : '<div class="thumb empty">🥫</div>'}
      <div data-open="${esc(p.code)}" style="cursor:pointer">
        <div class="title"><strong>${esc(p.name)}</strong></div>
        <div class="muted small">${esc([p.brand, p.quantity].filter(Boolean).join(' · '))}</div>
        <div class="small">${p.additives.length ? `<span class="pill bad">${p.additives.length} Zusatzstoffe</span>` : '<span class="pill good">keine Zusatzstoffe</span>'}
        ${p.allergens.length ? `<span class="pill">${p.allergens.length} Allergene</span>` : ''}
        ${p.key ? `<span class="pill">€ ${esc(p.key)}</span>` : ''}</div>
      </div>
      <div class="row" style="flex-direction:column;gap:6px">
        ${gradeBadge(p.nutriscore, 'Nutri-Score')}
        <input type="checkbox" class="check" data-sel="${esc(p.code)}" ${selected.has(p.code) ? 'checked' : ''} aria-label="Zum Vergleich auswählen">
      </div>
    </div>`;
}

function bindProductCards(root = $view, onChange) {
  root.querySelectorAll('[data-open]').forEach((el) => {
    el.onclick = () => showProduct(db.products.find((p) => p.code === el.dataset.open) || null);
  });
  root.querySelectorAll('[data-sel]').forEach((el) => {
    el.onchange = () => {
      if (el.checked) selected.add(el.dataset.sel);
      else selected.delete(el.dataset.sel);
      onChange?.();
    };
  });
}

function latestPriceFor(p) {
  if (!p.key) return null;
  const items = db.allItems().filter((i) => i.key === p.key && i.price > 0)
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  if (!items.length) return null;
  const s = summarize(items);
  return { latest: items[0], min: s.min, label: s.label, cheapestStore: s.cheapest.store };
}

function showProduct(p, { isNew = false } = {}) {
  if (!p) return;
  const keys = [...new Set(db.allItems().map((i) => i.key).filter(Boolean))].sort();
  const price = latestPriceFor(p);
  const n = p.nutriments || {};
  openDialog(`
    <div class="row" style="align-items:flex-start;flex-wrap:nowrap">
      ${p.image ? `<img class="thumb" src="${esc(p.image)}" alt="" style="width:80px;height:80px">` : ''}
      <div class="grow"><h2 style="margin:0">${esc(p.name)}</h2>
        <div class="muted small">${esc([p.brand, p.quantity, 'EAN ' + p.code].filter(Boolean).join(' · '))}</div>
        <div class="row" style="margin-top:6px">${gradeBadge(p.nutriscore, 'Nutri-Score')}
          <span class="small muted">Nutri-Score</span>
          ${p.nova ? `<span class="pill ${p.nova >= 4 ? 'bad' : p.nova <= 2 ? 'good' : ''}">NOVA ${p.nova}</span>` : ''}</div>
      </div>
    </div>
    <h3>Mit Preisen verknüpfen</h3>
    <input id="pkey" list="pkeys" value="${esc(p.key || '')}" placeholder="Vergleichsname aus deinen Belegen, z. B. milch">
    <datalist id="pkeys">${keys.map((k) => `<option value="${esc(k)}">`).join('')}</datalist>
    ${price ? `<p class="small">Zuletzt ${eur(price.latest.price)} bei ${esc(price.latest.store)} · günstigst ${num(price.min, 2, 2)} ${esc(price.label)} bei ${esc(price.cheapestStore)}</p>` : ''}
    <h3>Nährwerte pro 100 g/ml</h3>
    <table>${NUTRIENTS.map((x) => `<tr><td>${x.label}</td><td class="num">${n[x.key] != null ? num(n[x.key]) + ' ' + x.unit : '–'}</td></tr>`).join('')}</table>
    <h3>Zutaten</h3>
    <p class="small">${esc(p.ingredients) || '<span class="muted">Keine Zutatenliste hinterlegt.</span>'}</p>
    ${p.allergens.length ? `<h3>Allergene</h3>${p.allergens.map((a) => `<span class="pill bad">${esc(a)}</span>`).join('')}` : ''}
    ${p.traces.length ? `<p class="small muted">Kann Spuren enthalten von: ${esc(p.traces.join(', '))}</p>` : ''}
    ${p.additives.length ? `<h3>Zusatzstoffe</h3>${p.additives.map((a) => `<span class="pill">${esc(a)}</span>`).join('')}` : ''}
    ${p.labels.length ? `<h3>Siegel</h3>${p.labels.map((a) => `<span class="pill good">${esc(a)}</span>`).join('')}` : ''}
    <p class="small muted">Daten: <a href="https://world.openfoodfacts.org/product/${encodeURIComponent(p.code)}" target="_blank" rel="noopener">Open Food Facts</a> (ODbL)</p>
    <div class="row" style="justify-content:flex-end;margin-top:12px">
      ${isNew ? '' : '<button class="danger" id="pdel">Entfernen</button>'}
      <button id="pclose">${isNew ? 'Verwerfen' : 'Schließen'}</button>
      <button class="primary" id="psave">Speichern</button>
    </div>`, (root) => {
    root.querySelector('#pclose').onclick = closeDialog;
    root.querySelector('#pdel')?.addEventListener('click', () => {
      db.deleteProduct(p.code);
      selected.delete(p.code);
      closeDialog();
      route();
    });
    root.querySelector('#psave').onclick = () => {
      const k = root.querySelector('#pkey').value.trim();
      db.saveProduct({ ...p, key: k ? normalizeName(k) || k.toLowerCase() : '' });
      closeDialog();
      toast('Produkt gespeichert');
      if (location.hash.startsWith('#produkte') || location.hash.startsWith('#preise')) route();
    };
  });
}

async function lookupBarcode(code) {
  code = String(code).replace(/\D/g, '');
  if (code.length < 8) return toast('Ungültiger Barcode');
  const existing = db.products.find((p) => p.code === code);
  if (existing) return showProduct(existing);
  toast('Suche Produkt …');
  try {
    const p = await fetchByBarcode(code);
    if (!p) {
      alert(`Produkt ${code} ist nicht in Open Food Facts erfasst. Du kannst es dort selbst eintragen: https://world.openfoodfacts.org`);
      return;
    }
    showProduct(p, { isNew: true });
  } catch (e) {
    alert('Abfrage fehlgeschlagen: ' + e.message);
  }
}

function renderProducts(view) {
  if (view === 'vergleich') return renderComparison();
  $view.innerHTML = `
    <div class="card stack">
      <h2>Inhaltsstoffe</h2>
      <p class="muted small">Scanne den Barcode (EAN) auf der Verpackung, um Zutaten, Nährwerte, Allergene und Zusatzstoffe zu laden.</p>
      <button class="primary btn-big" id="scanbc">▥ Barcode scannen</button>
      <div id="scanner-wrap" hidden>
        <div class="scanner"><video id="video" playsinline muted></video></div>
        <button id="stopbc" style="margin-top:8px;width:100%">Abbrechen</button>
      </div>
      <form class="row" id="eanform">
        <input class="grow" id="ean" inputmode="numeric" placeholder="EAN eingeben, z. B. 4006040009045">
        <button>Suchen</button>
      </form>
      <form class="row" id="searchform">
        <input class="grow" id="sq" type="search" placeholder="…oder nach Produktname suchen">
        <button>Suchen</button>
      </form>
      <div id="results"></div>
    </div>
    <div id="cmpbar"></div>
    <div id="plist"></div>`;

  const drawList = () => {
    const ps = db.products;
    $view.querySelector('#plist').innerHTML = ps.length
      ? `<h3>Meine Produkte (${ps.length})</h3>` + ps.map(productCard).join('')
      : '<div class="empty-state">Noch keine Produkte gespeichert.</div>';
    bindProductCards($view.querySelector('#plist'), drawCmp);
    drawCmp();
  };
  const drawCmp = () => {
    for (const c of [...selected]) if (!db.products.some((p) => p.code === c)) selected.delete(c);
    $view.querySelector('#cmpbar').innerHTML = db.products.length > 1 ? `
      <div class="card row" style="justify-content:space-between">
        <span class="small">${selected.size ? `${selected.size} ausgewählt` : 'Wähle Produkte per Häkchen zum Vergleich'}</span>
        <button class="primary" id="cmp" ${selected.size < 2 ? 'disabled' : ''}>Vergleichen</button>
      </div>` : '';
    const btn = $view.querySelector('#cmp');
    if (btn) btn.onclick = () => { location.hash = 'produkte/vergleich'; };
  };

  let stop = null;
  const stopScan = () => {
    stop?.();
    stop = null;
    $view.querySelector('#scanner-wrap').hidden = true;
  };
  cleanup = stopScan;
  $view.querySelector('#scanbc').onclick = async () => {
    $view.querySelector('#scanner-wrap').hidden = false;
    try {
      stop = await startScanner($view.querySelector('#video'), (code) => {
        stopScan();
        navigator.vibrate?.(80);
        lookupBarcode(code);
      });
    } catch (e) {
      stopScan();
      alert('Kamera nicht verfügbar: ' + e.message + '\nDu kannst die EAN auch manuell eingeben.');
    }
  };
  $view.querySelector('#stopbc').onclick = stopScan;
  $view.querySelector('#eanform').onsubmit = (e) => {
    e.preventDefault();
    lookupBarcode($view.querySelector('#ean').value);
  };
  $view.querySelector('#searchform').onsubmit = async (e) => {
    e.preventDefault();
    const q = $view.querySelector('#sq').value.trim();
    if (!q) return;
    const $r = $view.querySelector('#results');
    $r.innerHTML = '<p class="muted small">Suche …</p>';
    try {
      const list = await searchProducts(q);
      $r.innerHTML = list.length ? `<ul class="list">${list.map((p, i) => `
        <li data-i="${i}">
          <div class="row" style="flex-wrap:nowrap">${p.image ? `<img class="thumb" src="${esc(p.image)}" alt="" loading="lazy">` : '<div class="thumb empty">🥫</div>'}
          <div><div class="title">${esc(p.name)}</div><div class="muted small">${esc([p.brand, p.quantity].filter(Boolean).join(' · '))}</div></div></div>
          ${gradeBadge(p.nutriscore, 'Nutri-Score')}
        </li>`).join('')}</ul>` : '<p class="muted small">Keine Treffer.</p>';
      $r.querySelectorAll('li').forEach((li) => {
        li.onclick = () => {
          const p = list[Number(li.dataset.i)];
          const existing = db.products.find((x) => x.code === p.code);
          showProduct(existing || p, { isNew: !existing });
        };
      });
    } catch (err) {
      $r.innerHTML = `<p class="warn small">Suche fehlgeschlagen: ${esc(err.message)}</p>`;
    }
  };
  drawList();
}

function renderComparison() {
  const ps = db.products.filter((p) => selected.has(p.code));
  if (ps.length < 2) {
    location.hash = 'produkte';
    return;
  }
  const cell = (vals, better) => {
    const nums = vals.filter((v) => v != null);
    const best = better === 'low' ? Math.min(...nums) : better === 'high' ? Math.max(...nums) : null;
    const worst = better === 'low' ? Math.max(...nums) : better === 'high' ? Math.min(...nums) : null;
    return (v, fmt) => {
      if (v == null) return '<td class="num muted">–</td>';
      const cls = nums.length > 1 && best !== worst ? (v === best ? 'best' : v === worst ? 'worst' : '') : '';
      return `<td class="num ${cls}">${fmt(v)}</td>`;
    };
  };
  const gradeVal = (g) => (/^[a-e]$/.test(g || '') ? 'abcde'.indexOf(g) : null);
  const prices = ps.map(latestPriceFor);
  const pricePer100 = ps.map((p, i) => {
    const pr = prices[i];
    if (!pr) return null;
    if (pr.label === '€/kg' || pr.label === '€/l') return round2(pr.min / 10);
    if (p.productQuantity) return round2((pr.latest.price / (pr.latest.qty || 1) / p.productQuantity) * 100);
    return null;
  });

  const ingr = ps.map((p) => splitIngredients(p.ingredients));
  const common = ingr.length ? ingr[0].filter((x) => ingr.every((list) => list.includes(x))) : [];

  const row = (label, vals, better, fmt) => {
    const c = cell(vals, better);
    return `<tr><th>${label}</th>${vals.map((v) => c(v, fmt)).join('')}</tr>`;
  };

  $view.innerHTML = `
    <p><a href="#produkte">‹ Zurück</a></p>
    <div class="card">
      <h2>Produktvergleich</h2>
      <p class="muted small">Grün = besserer Wert, rot = schlechterer Wert in der jeweiligen Zeile. Nährwerte pro 100 g/ml.</p>
      <div class="table-wrap"><table>
        <tr><th></th>${ps.map((p) => `<th style="min-width:120px">${p.image ? `<img class="thumb" src="${esc(p.image)}" alt=""><br>` : ''}${esc(p.name)}<div class="muted small">${esc(p.brand)}</div></th>`).join('')}</tr>
        <tr><th>Nutri-Score</th>${(() => { const c = cell(ps.map((p) => gradeVal(p.nutriscore)), 'low'); return ps.map((p) => c(gradeVal(p.nutriscore), () => gradeBadge(p.nutriscore, ''))).join(''); })()}</tr>
        ${row('NOVA (Verarbeitung)', ps.map((p) => p.nova), 'low', (v) => v)}
        ${row('Preis / 100 g·ml', pricePer100, 'low', (v) => eur(v))}
        ${row('Zuletzt bezahlt', prices.map((x) => x?.latest.price ?? null), null, (v) => eur(v))}
        ${NUTRIENTS.map((n) => row(n.label, ps.map((p) => p.nutriments?.[n.key] ?? null), n.better, (v) => `${num(v)} ${n.unit}`)).join('')}
        ${row('Zusatzstoffe', ps.map((p) => p.additives.length), 'low', (v) => v)}
        ${row('Zutaten (Anzahl)', ingr.map((l) => l.length || null), 'low', (v) => v)}
        <tr><th>Allergene</th>${ps.map((p) => `<td class="small">${p.allergens.map((a) => `<span class="pill bad">${esc(a)}</span>`).join('') || '–'}</td>`).join('')}</tr>
        <tr><th>Zusatzstoffe</th>${ps.map((p) => `<td class="small">${esc(p.additives.join(', ')) || '–'}</td>`).join('')}</tr>
      </table></div>
    </div>
    <div class="card">
      <h3 style="margin-top:0">Zutaten im Vergleich</h3>
      ${common.length ? `<p class="small"><strong>Gemeinsam:</strong> ${common.map((x) => `<span class="pill">${esc(x)}</span>`).join('')}</p>` : ''}
      <div class="ingredients-cols">
        ${ps.map((p, i) => {
          const only = ingr[i].filter((x) => !common.includes(x));
          return `<div><strong>${esc(p.name)}</strong>
            <p class="small">${only.length ? `Nur hier: ${only.map((x) => `<span class="pill bad">${esc(x)}</span>`).join('')}` : '<span class="muted">keine zusätzlichen Zutaten</span>'}</p>
            <details><summary class="small">Komplette Zutatenliste</summary><p class="small">${esc(p.ingredients) || '–'}</p></details></div>`;
        }).join('')}
      </div>
    </div>`;
}

// ---------- Start ----------

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
route();

// Für Tests/Debugging
window.bonscan = { db, parseReceipt, uid };
