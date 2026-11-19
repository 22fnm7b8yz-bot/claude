import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseChord, transposeChord, transposeText, extractChords, chordNotes, guitarChord, isChordLine,
} from '../akkorde/chords.js';

const names = (t, o) => chordNotes(t, o).notes.map((n) => n.name).join(' ');

test('erkennt Akkorde in deutscher und internationaler Schreibweise', () => {
  assert.equal(parseChord('H7').root, 11);
  assert.equal(parseChord('B').root, 10);
  assert.equal(parseChord('B', { german: false }).root, 11);
  assert.equal(parseChord('Bb').root, 10);
  assert.equal(parseChord('Fis').root, 6);
  assert.equal(parseChord('Es7').root, 3);
  assert.equal(parseChord('Asus4').root, 9);
  assert.equal(parseChord('Asus4').suffix, 'sus4');
  assert.deepEqual(parseChord('C/E'), { root: 0, flat: false, suffix: '', bass: 4 });
  assert.equal(parseChord('And'), null);
  assert.equal(parseChord('Hallo'), null);
});

test('transponiert einzelne Akkorde', () => {
  assert.equal(transposeChord('C', 2), 'D');
  assert.equal(transposeChord('Am', 2), 'Hm');
  assert.equal(transposeChord('Am', 2, { german: false }), 'Bm');
  assert.equal(transposeChord('G', 1), 'Ab');
  assert.equal(transposeChord('G', 1, { spelling: 'sharp' }), 'G#');
  assert.equal(transposeChord('Em', 4), 'G#m');
  assert.equal(transposeChord('C/E', 2), 'D/F#');
  assert.equal(transposeChord('F/C', 1), 'F#/C#');
  assert.equal(transposeChord('Cmaj7', -1), 'Hmaj7');
  assert.equal(transposeChord('C', 12), 'C');
  assert.equal(transposeChord('C', -13), 'H');
});

test('berechnet die Töne', () => {
  assert.equal(names('C'), 'C E G');
  assert.equal(names('Am7'), 'A C E G');
  assert.equal(names('H7'), 'H D# F# A');
  assert.equal(names('Bb', { german: false }), 'Bb D F');
  assert.equal(names('Dm7b5'), 'D F Ab C');
});

test('transponiert Akkordzeilen und lässt Liedtext in Ruhe', () => {
  const text = 'C          G\nEs war einmal ein Lied\n| Am  F  | C  G |';
  assert.equal(transposeText(text, 1, { spelling: 'sharp' }), 'C#         G#\nEs war einmal ein Lied\n| A#m F# | C# G# |');
  assert.ok(!isChordLine('Es war einmal ein Lied'));
  assert.deepEqual(extractChords('Intro: C G Am F\n[Refrain]\nF C'), ['C', 'G', 'Am', 'F']);
});

test('findet Gitarrengriffe', () => {
  assert.deepEqual(guitarChord('C').frets, [null, 3, 2, 0, 1, 0]);
  assert.deepEqual(guitarChord('F').frets, [1, 3, 3, 2, 1, 1]);
  assert.deepEqual(guitarChord('F').barre, { fret: 1, from: 0, to: 5 });
  assert.deepEqual(guitarChord('Hm').frets, [null, 2, 4, 4, 3, 2]);
  assert.deepEqual(guitarChord('Am/G').frets, [3, 0, 2, 2, 1, 0]);
  assert.deepEqual(guitarChord('G/H').frets, [null, 2, 0, 0, 0, 3]);
});
