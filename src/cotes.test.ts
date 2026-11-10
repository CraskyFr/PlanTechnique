import test from 'node:test';
import assert from 'node:assert/strict';
import { MODELES, effacerCotes, lireNombre } from './cotes.ts';

test('effacerCotes : la cote prend la couleur du fond autour, le reste est intact', () => {
  // Ligne : fond gris, cote magenta + son bord anticrénelé, fond gris, mur, nom de pièce vert.
  const px = [[232, 232, 232], [214, 51, 171], [240, 200, 225], [232, 232, 232], [85, 85, 85], [76, 160, 130]];
  const img = { data: new Uint8Array(px.flatMap((p) => [...p, 255])), width: 6, height: 1 };
  effacerCotes(img);
  assert.deepEqual([...img.data], [232, 232, 232, 255, 232, 232, 232, 255, 232, 232, 232, 255, 232, 232, 232, 255, 85, 85, 85, 255, 76, 160, 130, 255]);
});

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
