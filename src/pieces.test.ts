import test from 'node:test';
import assert from 'node:assert/strict';
import { pieces } from './pieces.ts';

test('deux pièces séparées par une cloison : dimensions mur à mur', () => {
  // Grille 40 × 20 : murs de 2 cases sur le pourtour, cloison verticale en x = 20..21.
  const w = 40, h = 20, murs = new Uint8Array(w * h);
  const mur = (x0: number, y0: number, x1: number, y1: number) => {
    for (let y = y0; y < y1; y++) murs.fill(1, y * w + x0, y * w + x1);
  };
  mur(2, 2, 38, 4);
  mur(2, 16, 38, 18);
  mur(2, 2, 4, 18);
  mur(36, 2, 38, 18);
  mur(20, 4, 22, 16);
  mur(10, 9, 11, 10); // poussière : ne coupe pas les mesures prises plus haut

  const { etiquettes, pieces: trouvees } = pieces(murs, w, h, 4);
  assert.equal(etiquettes[0], -1); // extérieur
  assert.equal(trouvees.length, 2);
  const [gauche, droite] = trouvees;
  assert.equal(gauche.largeur.b1 - gauche.largeur.b0, 16); // de x = 4 à 20
  assert.equal(gauche.hauteur.b1 - gauche.hauteur.b0, 12); // de y = 4 à 16
  assert.equal(droite.largeur.b1 - droite.largeur.b0, 14); // de x = 22 à 36
  assert.ok(gauche.largeur.a < 9); // prise près du haut, au-dessus de la poussière
});

test('fente de 2 cases dans un mur : refermée par le rayon, mesures inchangées', () => {
  const w = 30, h = 20, murs = new Uint8Array(w * h);
  const mur = (x0: number, y0: number, x1: number, y1: number) => {
    for (let y = y0; y < y1; y++) murs.fill(1, y * w + x0, y * w + x1);
  };
  mur(2, 2, 13, 4); // mur du haut en deux morceaux, fente en x = 13..14
  mur(15, 2, 28, 4);
  mur(2, 16, 28, 18);
  mur(2, 2, 4, 18);
  mur(26, 2, 28, 18);
  assert.equal(pieces(murs, w, h, 4).pieces.length, 0); // la pièce fuit par la fente
  const [piece] = pieces(murs, w, h, 4, 1).pieces;
  assert.equal(piece.largeur.b1 - piece.largeur.b0, 22); // de x = 4 à 26
  assert.equal(piece.hauteur.b1 - piece.hauteur.b0, 12); // de y = 4 à 16
});

test("embrasure de fenêtre : la largeur courante l'emporte sur la plus longue", () => {
  const w = 30, h = 30, murs = new Uint8Array(w * h);
  const mur = (x0: number, y0: number, x1: number, y1: number) => {
    for (let y = y0; y < y1; y++) murs.fill(1, y * w + x0, y * w + x1);
  };
  mur(2, 2, 28, 4);
  mur(2, 26, 28, 28);
  mur(2, 2, 4, 28);
  mur(24, 2, 28, 10); // mur droit épais avec une embrasure de 4 lignes (y = 10..13) refermée au fond
  mur(26, 10, 28, 14);
  mur(24, 14, 28, 28);
  const [piece] = pieces(murs, w, h, 4).pieces;
  assert.equal(piece.largeur.b1 - piece.largeur.b0, 20); // de x = 4 à 24, pas 22 dans l'embrasure
  assert.ok(piece.largeur.a < 10 || piece.largeur.a > 13);
});

test('bâtiment ouvert : pas de pièce, tout est extérieur', () => {
  const w = 10, h = 10, murs = new Uint8Array(w * h);
  for (let x = 2; x < 8; x++) murs[2 * w + x] = 1;
  const { pieces: trouvees } = pieces(murs, w, h, 1);
  assert.equal(trouvees.length, 0);
});
