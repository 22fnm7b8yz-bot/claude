import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  guessLanguages, mergeSearchResults, scoreEntity, looksLikeAnimal,
  isLikelyPronunciation, buildSources, cleanHtml, isAudioMime,
} from '../tierstimmen/lib.js';
import { createApi } from '../tierstimmen/api.js';

const claim = (v) => ({ mainsnak: { datavalue: { value: v } } });

test('Sprache wird an der Schrift erkannt', () => {
  assert.deepEqual(guessLanguages('лягушка').slice(0, 2), ['ru', 'uk']);
  assert.deepEqual(guessLanguages('ネコ'), ['ja']);
  assert.deepEqual(guessLanguages('猫'), ['zh', 'ja']);
  assert.ok(guessLanguages('chien').includes('fr'));
});

test('genaue Treffer gewinnen beim Zusammenführen', () => {
  const merged = mergeSearchResults('lion', [
    [{ id: 'Q1', label: 'Lionel', match: { text: 'Lionel' } }],
    [{ id: 'Q140', label: 'lion', match: { text: 'lion' } }],
  ]);
  assert.equal(merged[0].id, 'Q140');
});

test('Tiere werden besser bewertet als Familiennamen', () => {
  const dog = { claims: { P225: [claim('Canis familiaris')], P18: [claim('Dog.jpg')], P51: [claim('Bark.ogg')] } };
  const name = { claims: { P31: [claim({ id: 'Q101352' })] }, descriptions: { de: { value: 'Familienname' } } };
  assert.ok(scoreEntity(dog, 0) > scoreEntity(name, 10));
  assert.ok(looksLikeAnimal(dog));
  assert.ok(!looksLikeAnimal(name));
});

test('Aussprache-Dateien werden aussortiert', () => {
  assert.ok(isLikelyPronunciation('File:De-Hund.ogg'));
  assert.ok(isLikelyPronunciation('File:En-us-dog.ogg'));
  assert.ok(isLikelyPronunciation('File:LL-Q150 (fra)-Poslovitch-chien.wav'));
  assert.ok(!isLikelyPronunciation('File:Canis lupus familiaris - barking.ogg'));
  assert.ok(!isLikelyPronunciation('File:Lion raring-sound1TamilNadu178.ogg'));
});

test('MP3-Umwandlung steht vor dem Original', () => {
  const s = buildSources({
    url: 'https://upload.wikimedia.org/a/Bark.ogg', mime: 'application/ogg',
    derivatives: [
      { src: '//upload.wikimedia.org/t/Bark.ogg.mp3', type: 'audio/mpeg' },
      { src: 'https://upload.wikimedia.org/t/Bark.ogg.opus', type: 'audio/ogg; codecs="opus"' },
    ],
  });
  assert.equal(s[0].src, 'https://upload.wikimedia.org/t/Bark.ogg.mp3');
  assert.equal(s[1].type, 'audio/ogg');
  assert.equal(s.length, 3);
});

test('Hilfen für Metadaten und Dateitypen', () => {
  assert.equal(cleanHtml('<a href="x">Max &amp; Moritz</a>'), 'Max & Moritz');
  assert.ok(isAudioMime('audio/x-wav'));
  assert.ok(!isAudioMime('audio/midi'));
  assert.ok(!isAudioMime('image/jpeg'));
});

test('kompletter Ablauf: Suche → Tier → Laute (mit simulierten Antworten)', async () => {
  const calls = [];
  const fakeFetch = async (url) => {
    calls.push(url);
    const u = new URL(url);
    const p = Object.fromEntries(u.searchParams);
    let body;
    if (p.action === 'wbsearchentities') {
      body = { search: p.language === 'fr' ? [
        { id: 'Q144', label: 'chien', match: { text: 'chien' } },
        { id: 'Q999', label: 'Chien (film)', match: { text: 'Chien' } },
      ] : [] };
    } else if (p.action === 'wbgetentities') {
      body = { entities: {
        Q144: {
          id: 'Q144', labels: { de: { value: 'Haushund' }, fr: { value: 'chien' } },
          descriptions: { de: { value: 'Haustier' } },
          claims: { P225: [claim('Canis lupus familiaris')], P18: [claim('Dog.jpg')], P51: [claim('Bark.ogg')] },
          sitelinks: { dewiki: { title: 'Haushund' } },
        },
        Q999: { id: 'Q999', labels: { fr: { value: 'Chien' } }, claims: { P31: [claim({ id: 'Q11424' })] } },
      } };
    } else if (p.action === 'query' && p.titles) {
      body = { query: { pages: [{ title: 'File:Bark.ogg', videoinfo: [{
        url: 'https://upload.wikimedia.org/Bark.ogg', mime: 'application/ogg',
        derivatives: [{ src: 'https://upload.wikimedia.org/Bark.ogg.mp3', type: 'audio/mpeg' }],
        extmetadata: { Artist: { value: '<b>Anna</b>' }, LicenseShortName: { value: 'CC BY-SA 4.0' } },
      }] }] } };
    } else if (p.action === 'query' && p.generator === 'search') {
      body = { query: { pages: [
        { title: 'File:De-Hund.ogg', index: 1, imageinfo: [{ url: 'https://x/De-Hund.ogg', mime: 'application/ogg' }] },
        { title: 'File:Dog growl.wav', index: 2, imageinfo: [{ url: 'https://x/growl.wav', mime: 'audio/wav' }] },
      ] } };
    } else {
      throw new Error('unerwartet ' + url);
    }
    return { ok: true, json: async () => body };
  };

  const api = createApi(fakeFetch);
  const { best, alternatives } = await api.findAnimal('chien', 'auto');
  assert.equal(best.id, 'Q144');
  assert.equal(alternatives.length, 0, 'der Film zählt nicht als Tier');

  const sounds = await api.findSounds(best);
  assert.deepEqual(sounds.map((s) => s.title), ['File:Bark.ogg', 'File:Dog growl.wav']);
  assert.equal(sounds[0].artist, 'Anna');
  assert.equal(sounds[0].sources[0].type, 'audio/mpeg');
  assert.ok(calls.every((c) => c.includes('origin=*')), 'alle Anfragen mit CORS-Parameter');
});
