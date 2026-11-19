// Zugriff auf Wikidata, Wikimedia Commons und Wikipedia (alle mit CORS über origin=*).
import {
  guessLanguages, mergeSearchResults, scoreEntity, looksLikeAnimal, claimValues,
  isLikelyPronunciation, isAudioMime, buildSources, cleanHtml, LABEL_LANGS, commonsFilePage,
} from './lib.js';

const WIKIDATA = 'https://www.wikidata.org/w/api.php';
const COMMONS = 'https://commons.wikimedia.org/w/api.php';

function apiUrl(base, params) {
  const u = new URL(base);
  for (const [k, v] of Object.entries({ ...params, format: 'json', formatversion: '2', origin: '*' })) {
    u.searchParams.set(k, String(v));
  }
  return u.toString();
}

export function createApi(fetchFn = (...a) => globalThis.fetch(...a)) {
  async function getJson(url) {
    const res = await fetchFn(url);
    if (!res.ok) throw new Error(`Server antwortet mit ${res.status}`);
    return res.json();
  }

  /** Sucht Wikidata-Einträge zum eingegebenen Namen in einer oder mehreren Sprachen. */
  async function search(query, lang) {
    const langs = lang === 'auto' ? guessLanguages(query) : [lang];
    const lists = await Promise.all(langs.map((l) =>
      getJson(apiUrl(WIKIDATA, {
        action: 'wbsearchentities', search: query, language: l, uselang: l,
        type: 'item', limit: 8, strictlanguage: 'false',
      })).then((d) => d.search || [], () => null)));
    if (lists.every((l) => l === null)) throw new Error('Wikidata ist gerade nicht erreichbar.');
    return mergeSearchResults(query, lists.map((l) => l || []));
  }

  async function getEntities(ids, uiLang) {
    if (!ids.length) return [];
    const languages = [...new Set([uiLang, 'de', 'en', ...LABEL_LANGS])].join('|');
    const d = await getJson(apiUrl(WIKIDATA, {
      action: 'wbgetentities', ids: ids.join('|'),
      props: 'labels|descriptions|claims|sitelinks', languages,
      sitefilter: [...new Set([`${uiLang}wiki`, 'dewiki', 'enwiki'])].join('|'),
    }));
    return ids.map((id) => d.entities && d.entities[id]).filter((e) => e && !('missing' in e));
  }

  /** Findet das wahrscheinlichste Tier zum Suchbegriff. */
  async function findAnimal(query, lang, uiLang = 'de') {
    const hits = (await search(query, lang)).slice(0, 10);
    const entities = await getEntities(hits.map((h) => h.id), uiLang);
    const ranked = entities
      .map((e) => {
        const hit = hits.find((h) => h.id === e.id);
        return { entity: e, score: scoreEntity(e, hit ? hit.score : 0), animal: looksLikeAnimal(e) };
      })
      .sort((a, b) => b.score - a.score);
    const animals = ranked.filter((r) => r.animal);
    const pool = animals.length ? animals : ranked;
    return { best: pool[0] ? pool[0].entity : null, alternatives: pool.slice(1, 6).map((r) => r.entity) };
  }

  /** Datei-Infos (URL, Umwandlungen, Urheber, Lizenz) von Commons holen. */
  async function fileInfos(params) {
    const d = await getJson(apiUrl(COMMONS, {
      action: 'query', prop: 'videoinfo|imageinfo',
      viprop: 'url|mime|derivatives|extmetadata',
      iiprop: 'url|mime|extmetadata',
      iiextmetadatafilter: 'Artist|LicenseShortName|ObjectName',
      viextmetadatafilter: 'Artist|LicenseShortName|ObjectName',
      ...params,
    }));
    const pages = (d.query && d.query.pages) || [];
    return pages
      .filter((p) => !p.missing && !p.invalid)
      .sort((a, b) => (a.index || 0) - (b.index || 0))
      .map((p) => {
        const vi = (p.videoinfo && p.videoinfo[0]) || {};
        const ii = (p.imageinfo && p.imageinfo[0]) || {};
        const info = { ...ii, ...vi, derivatives: vi.derivatives || [] };
        const meta = info.extmetadata || {};
        return {
          title: p.title,
          mime: info.mime || ii.mime || '',
          sources: buildSources(info),
          artist: cleanHtml(meta.Artist && meta.Artist.value),
          license: cleanHtml(meta.LicenseShortName && meta.LicenseShortName.value),
          page: info.descriptionurl || commonsFilePage(p.title),
        };
      })
      .filter((f) => isAudioMime(f.mime) && f.sources.length);
  }

  /** Alle gefundenen Tierlaute: zuerst die von Wikidata (Eigenschaft „Audio“), dann Commons-Suche. */
  async function findSounds(entity) {
    const sounds = [];
    const seen = new Set();
    const add = (list, origin) => {
      for (const s of list) {
        if (seen.has(s.title)) continue;
        seen.add(s.title);
        sounds.push({ ...s, origin });
      }
    };

    const wdFiles = claimValues(entity, 'P51');
    if (wdFiles.length) {
      try {
        add(await fileInfos({ titles: wdFiles.slice(0, 20).map((f) => `File:${f}`).join('|') }), 'wikidata');
      } catch { /* Commons-Suche probieren */ }
    }

    if (sounds.length < 3) {
      const terms = [...new Set([
        ...claimValues(entity, 'P225'),
        entity.labels && entity.labels.en && entity.labels.en.value,
      ].filter(Boolean))].slice(0, 2);
      for (const term of terms) {
        try {
          const found = await fileInfos({
            generator: 'search', gsrnamespace: 6, gsrlimit: 12,
            gsrsearch: `filetype:audio "${term.replace(/"/g, '')}"`,
          });
          add(found.filter((f) => !isLikelyPronunciation(f.title)), 'commons');
        } catch { /* nächster Begriff */ }
        if (sounds.length >= 5) break;
      }
    }
    return sounds.slice(0, 10);
  }

  /** Kurzer Wikipedia-Text (und Ersatzbild) in der Wunschsprache, sonst Deutsch/Englisch. */
  async function summary(entity, langs) {
    const links = entity.sitelinks || {};
    for (const l of langs) {
      const link = links[`${l}wiki`];
      if (!link) continue;
      try {
        const d = await getJson(`https://${l}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(link.title.replace(/ /g, '_'))}`);
        return {
          lang: l,
          extract: d.extract || '',
          image: (d.originalimage && d.originalimage.source) || (d.thumbnail && d.thumbnail.source) || '',
          url: (d.content_urls && d.content_urls.desktop && d.content_urls.desktop.page) || `https://${l}.wikipedia.org/wiki/${encodeURIComponent(link.title)}`,
        };
      } catch { /* nächste Sprache */ }
    }
    return null;
  }

  return { search, getEntities, findAnimal, findSounds, summary };
}
