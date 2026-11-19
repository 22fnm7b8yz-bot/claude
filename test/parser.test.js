import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseReceipt, parseSize, normalizeName, unitPrice } from '../js/parser.js';

const REWE = `
REWE Markt GmbH
Musterstraße 12
12345 Musterstadt
UID Nr.: DE812706034
                       EUR
MILCH 3,5% 1L          1,19 B
BANANE                 2,46 B
  1,234 kg x 1,99 EUR/kg
JOGHURT NATUR 500G     1,98 B
  2 Stk x 0,99
BUTTER 250G            2,29 B
  Preisvorteil        -0,30 B
PFAND 0,25             0,25 A
--------------------------------
SUMME            EUR   7,87
Geg. EC-Karte    EUR   7,87
Datum: 14.11.2026 Uhrzeit 18:03
`;

test('erkennt Händler, Datum und Summe', () => {
  const r = parseReceipt(REWE);
  assert.equal(r.store, 'REWE');
  assert.equal(r.date, '2026-11-14');
  assert.equal(r.total, 7.87);
});

test('erkennt Positionen, Mengen, Gewicht und Rabatt', () => {
  const r = parseReceipt(REWE);
  const names = r.items.map((i) => i.name);
  assert.deepEqual(names, ['MILCH 3,5% 1L', 'BANANE', 'JOGHURT NATUR 500G', 'BUTTER 250G', 'PFAND 0,25']);
  const banane = r.items[1];
  assert.equal(banane.weightKg, 1.234);
  assert.equal(r.items[2].qty, 2);
  assert.equal(r.items[3].price, 1.99);
  assert.equal(r.items[3].discount, 0.3);
  const sum = r.items.reduce((s, i) => s + i.price, 0);
  assert.equal(Math.round(sum * 100) / 100, 7.87);
});

test('Lidl-Format mit Menge in der Artikelzeile', () => {
  const r = parseReceipt(`LIDL
Haferflocken 500g    0,89 x 3    2,67 A
Tomaten              1,49 A
zu zahlen            4,16
05.11.26`);
  assert.equal(r.store, 'LIDL');
  assert.equal(r.items.length, 2);
  assert.equal(r.items[0].name, 'Haferflocken 500g');
  assert.equal(r.items[0].qty, 3);
  assert.equal(r.total, 4.16);
  assert.equal(r.date, '2026-11-05');
});

test('Packungsgrößen und Grundpreis', () => {
  assert.deepEqual(parseSize('Milch 1,5L'), { amount: 1500, unit: 'ml' });
  assert.deepEqual(parseSize('Käse 200 g'), { amount: 200, unit: 'g' });
  assert.equal(parseSize('Brot'), null);
  assert.deepEqual(unitPrice({ price: 1.19, qty: 1, size: { amount: 1000, unit: 'ml' } }), { value: 1.19, label: '€/l' });
  assert.deepEqual(unitPrice({ price: 1.98, qty: 2, size: { amount: 500, unit: 'g' } }), { value: 1.98, label: '€/kg' });
  assert.deepEqual(unitPrice({ price: 2.46, weightKg: 1.234 }), { value: 1.99, label: '€/kg' });
});

test('Vergleichsschlüssel ignoriert Größe, Fett und Umlaute', () => {
  assert.equal(normalizeName('MILCH 3,5% 1L'), 'milch');
  assert.equal(normalizeName('Müsli Nuss 750g'), 'muesli nuss');
});
