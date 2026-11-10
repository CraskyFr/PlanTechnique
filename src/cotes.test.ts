import test from 'node:test';
import assert from 'node:assert/strict';
import { MODELES, lireNombre } from './cotes.ts';

// La lecture complète (repérage du texte, mesure entre murs) a été validée sur un export Kazaplan réel :
// 7 cotes concordantes, échelle à 0,01 % de celle déduite de la largeur hors tout.
const glyphe = (chiffre: string, bruit = 0) => ({ x0: 0, y0: 0, x1: 5, y1: 7, grille: [...MODELES[chiffre]].map((v, i) => Math.min(9, Number(v) + (i % 3 === 0 ? bruit : 0))) });

test('lireNombre : relit les chiffres, même légèrement bruités', () => {
  assert.equal(lireNombre([...'1000'].map((c) => glyphe(c))), 1000);
  assert.equal(lireNombre([...'4382695'].map((c) => glyphe(c, 2))), 4382695);
  assert.equal(lireNombre([]), null);
});

test('lireNombre : un caractère inconnu invalide toute la cote', () => {
  const tache = { x0: 0, y0: 0, x1: 5, y1: 7, grille: new Array(35).fill(9) };
  assert.equal(lireNombre([glyphe('4'), tache]), null);
});
