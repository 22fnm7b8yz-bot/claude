// Produktdaten (Zutaten, Nährwerte, Allergene, Zusatzstoffe) aus der freien Datenbank Open Food Facts.

const BASE = 'https://world.openfoodfacts.org';
const FIELDS = [
  'code', 'product_name', 'product_name_de', 'generic_name_de', 'brands', 'quantity',
  'image_front_small_url', 'image_front_url', 'ingredients_text_de', 'ingredients_text',
  'allergens_tags', 'traces_tags', 'additives_tags', 'nutriscore_grade', 'nova_group',
  'ecoscore_grade', 'labels_tags', 'nutriments', 'categories_tags', 'product_quantity',
].join(',');

export const NUTRIENTS = [
  { key: 'energy-kcal_100g', label: 'Energie', unit: 'kcal', better: 'low' },
  { key: 'fat_100g', label: 'Fett', unit: 'g', better: 'low' },
  { key: 'saturated-fat_100g', label: '– davon gesättigt', unit: 'g', better: 'low' },
  { key: 'carbohydrates_100g', label: 'Kohlenhydrate', unit: 'g', better: null },
  { key: 'sugars_100g', label: '– davon Zucker', unit: 'g', better: 'low' },
  { key: 'fiber_100g', label: 'Ballaststoffe', unit: 'g', better: 'high' },
  { key: 'proteins_100g', label: 'Eiweiß', unit: 'g', better: 'high' },
  { key: 'salt_100g', label: 'Salz', unit: 'g', better: 'low' },
];

const ALLERGENS_DE = {
  gluten: 'Gluten', milk: 'Milch', eggs: 'Eier', nuts: 'Schalenfrüchte', peanuts: 'Erdnüsse',
  soybeans: 'Soja', fish: 'Fisch', crustaceans: 'Krebstiere', molluscs: 'Weichtiere', celery: 'Sellerie',
  mustard: 'Senf', 'sesame-seeds': 'Sesam', 'sulphur-dioxide-and-sulphites': 'Sulfite', lupin: 'Lupinen',
};

function tagLabel(tag) {
  const raw = String(tag).replace(/^[a-z]{2}:/, '');
  return ALLERGENS_DE[raw] || raw.replace(/-/g, ' ');
}

function mapProduct(p) {
  const nutr = {};
  for (const n of NUTRIENTS) {
    const v = p.nutriments?.[n.key];
    if (v !== undefined && v !== '') nutr[n.key] = Number(v);
  }
  return {
    code: p.code,
    name: p.product_name_de || p.product_name || p.generic_name_de || `Produkt ${p.code}`,
    brand: (p.brands || '').split(',')[0].trim(),
    quantity: p.quantity || '',
    productQuantity: Number(p.product_quantity) || null,
    image: p.image_front_small_url || p.image_front_url || '',
    ingredients: p.ingredients_text_de || p.ingredients_text || '',
    allergens: (p.allergens_tags || []).map(tagLabel),
    traces: (p.traces_tags || []).map(tagLabel),
    additives: (p.additives_tags || []).map((t) => tagLabel(t).toUpperCase()),
    labels: (p.labels_tags || []).map(tagLabel).slice(0, 8),
    nutriscore: (p.nutriscore_grade || '').toLowerCase(),
    nova: p.nova_group || null,
    ecoscore: (p.ecoscore_grade || '').toLowerCase(),
    nutriments: nutr,
    fetched: new Date().toISOString(),
  };
}

export async function fetchByBarcode(code) {
  const res = await fetch(`${BASE}/api/v2/product/${encodeURIComponent(code)}.json?fields=${FIELDS}`);
  if (!res.ok && res.status !== 404) throw new Error(`Open Food Facts: HTTP ${res.status}`);
  const data = await res.json();
  if (data.status !== 1 || !data.product) return null;
  return mapProduct({ ...data.product, code: data.product.code || code });
}

export async function searchProducts(query) {
  const url = `${BASE}/cgi/search.pl?search_terms=${encodeURIComponent(query)}` +
    `&search_simple=1&action=process&json=1&page_size=15&fields=${FIELDS}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open Food Facts: HTTP ${res.status}`);
  const data = await res.json();
  return (data.products || []).filter((p) => p.code).map(mapProduct);
}

/** Zutatenliste in einzelne, vergleichbare Zutaten zerlegen. */
export function splitIngredients(text) {
  if (!text) return [];
  // Klammerinhalte auf oberster Ebene entfernen, damit "Schokolade (Zucker, Kakao)" eine Zutat bleibt
  let depth = 0;
  let flat = '';
  for (const ch of text) {
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
    else if (depth === 0) flat += ch;
  }
  return [...new Set(
    flat
      .split(/[,;•]|\s-\s|\.(?=\s|$)/)
      .map((s) => s.replace(/_/g, '').replace(/\d+([.,]\d+)?\s*%/g, '').replace(/[*:]/g, '').trim().toLowerCase())
      .filter((s) => s.length > 1 && !/^zutaten$/.test(s)),
  )];
}
