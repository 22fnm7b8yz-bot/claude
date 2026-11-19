// Einfache lokale Datenhaltung im Browser (localStorage). Alle Daten bleiben auf dem Gerät.

const KEY = 'bonscan:v1';

function empty() {
  return { receipts: [], products: [] };
}

let state = load();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return empty();
    const data = JSON.parse(raw);
    return { receipts: data.receipts || [], products: data.products || [] };
  } catch {
    return empty();
  }
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (e) {
    alert('Speichern fehlgeschlagen: ' + e.message);
  }
}

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export const db = {
  get receipts() {
    return state.receipts;
  },
  get products() {
    return state.products;
  },
  saveReceipt(r) {
    if (!r.id) r.id = uid();
    const i = state.receipts.findIndex((x) => x.id === r.id);
    if (i >= 0) state.receipts[i] = r;
    else state.receipts.push(r);
    state.receipts.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    persist();
    return r;
  },
  deleteReceipt(id) {
    state.receipts = state.receipts.filter((r) => r.id !== id);
    persist();
  },
  saveProduct(p) {
    const i = state.products.findIndex((x) => x.code === p.code);
    if (i >= 0) state.products[i] = { ...state.products[i], ...p };
    else state.products.push(p);
    persist();
    return p;
  },
  deleteProduct(code) {
    state.products = state.products.filter((p) => p.code !== code);
    persist();
  },
  /** Alle Bon-Positionen flach, jeweils mit Händler und Datum. */
  allItems() {
    const out = [];
    for (const r of state.receipts) {
      for (const it of r.items) out.push({ ...it, store: r.store, date: r.date, receiptId: r.id });
    }
    return out;
  },
  exportJSON() {
    return JSON.stringify({ app: 'bonscan', version: 1, exported: new Date().toISOString(), ...state }, null, 2);
  },
  importJSON(text, { merge = true } = {}) {
    const data = JSON.parse(text);
    if (!Array.isArray(data.receipts) || !Array.isArray(data.products)) throw new Error('Ungültige Datei');
    if (!merge) state = empty();
    const ids = new Set(state.receipts.map((r) => r.id));
    for (const r of data.receipts) if (!ids.has(r.id)) state.receipts.push(r);
    const codes = new Set(state.products.map((p) => p.code));
    for (const p of data.products) if (!codes.has(p.code)) state.products.push(p);
    state.receipts.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    persist();
  },
  clear() {
    state = empty();
    persist();
  },
};
