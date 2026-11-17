import test from 'node:test';
import assert from 'node:assert/strict';
import { elevations } from './elevation.ts';

// Mur horizontal de 4 m (1 px = 1 cm) coupé par une fenêtre de 1 m en son milieu ; une cloison descend du milieu.
// Sous le mur (y > 0) : pièce 1 à gauche de la cloison, pièce 2 à droite ; au-dessus (y < 0) : pièce 3.
// Comme dans cotesAuto, les étiquettes s'arrêtent à 3 px des faces des murs.
const numero = (x: number, y: number) => {
  if (x < 0 || x > 400 || Math.abs(y) <= 5 + 3) return x < 0 || x > 400 ? -1 : 0;
  if (y < 0) return 3;
  return x < 195 - 3 ? 1 : x > 205 + 3 ? 2 : 0;
};
const segments = [
  { x1: 0, y1: 0, x2: 150, y2: 0, demi: 5 },
  { x1: 400, y1: 0, x2: 250, y2: 0, demi: 5 }, // tracé à l'envers : même mur
  { x1: 200, y1: 5, x2: 200, y2: 300, demi: 5 },
];
const fenetre = { id: 9, x: 200, y: 0, rot: 0, largeur: 100 };
const equipements = [
  { id: 1, x: 100, y: 20 }, // pièce 1
  { id: 2, x: 300, y: 20 }, // pièce 2
  { id: 3, x: 100, y: -20 }, // pièce 3, côté gauche du plan
  { id: 4, x: 300, y: -20 }, // pièce 3, côté droit du plan
  { id: 5, x: 170, y: 20 }, // pièce 1, sous la fenêtre (prise sous allège)
];
const faces = elevations(segments, [fenetre], equipements, numero, 0.01, 30);
const face = (piece: number) => faces.find((f) => f.piece === piece && f.vue === (piece === 3 ? 'bas' : 'haut'))!;
const proche = (a: number, b: number) => assert.ok(Math.abs(a - b) < 0.011, `${a} ≠ ${b}`);

test('élévation : la fenêtre relie les deux morceaux du mur, découpé par pièce d\'angle à angle', () => {
  proche(face(1).longueur, 1.95);
  proche(face(2).longueur, 1.95);
  proche(face(3).longueur, 4);
  assert.deepEqual(face(1).elements.map((x) => x.id), [1, 5]);
  assert.deepEqual(face(2).elements.map((x) => x.id), [2]);
  proche(face(1).elements[0].abscisse, 1); // depuis l'angle gauche de la pièce 1
  proche(face(1).elements[1].abscisse, 1.7); // sous la fenêtre : rattachée au mur qui la porte
  proche(face(2).elements[0].abscisse, 0.95); // depuis la face de la cloison
  proche(face(1).ouvertures[0].debut, 1.5);
  proche(face(1).ouvertures[0].fin, 1.95);
  proche(face(3).ouvertures[0].debut, 1.5);
  proche(face(3).ouvertures[0].fin, 2.5);
});

test('élévation : vue depuis l\'autre côté du mur, sans effet miroir', () => {
  // Depuis la pièce 3 (au-dessus sur le plan), on regarde vers le bas : l'est du plan est à gauche.
  assert.deepEqual(face(3).elements.map((x) => x.id), [4, 3]);
  proche(face(3).elements[0].abscisse, 1);
  proche(face(3).elements[1].abscisse, 3);
});

test('élévation : un poteau de 30 cm ne coupe pas le mur de la pièce en deux', () => {
  // Mur de 3 m interrompu par un poteau (vide de 30 cm, occupé par des tranches perpendiculaires) ; pièce 1 dessous.
  const num = (x: number, y: number) => (y > 8 && x >= 0 && x <= 300 ? (x > 120 - 3 && x < 150 + 3 && y < 40 ? 0 : 1) : -1);
  const f = elevations([{ x1: 0, y1: 0, x2: 120, y2: 0, demi: 5 }, { x1: 150, y1: 0, x2: 300, y2: 0, demi: 5 }], [], [{ id: 1, x: 250, y: 20 }], num, 0.01, 30);
  assert.equal(f.length, 1);
  proche(f[0].longueur, 3);
  proche(f[0].elements[0].abscisse, 2.5);
});

test('élévation : la cloison a deux faces, gauche et droite, avec les angles de chaque pièce', () => {
  const vues = faces.filter((f) => f.piece !== 3).map((f) => `${f.piece}:${f.vue}`).sort();
  assert.deepEqual(vues, ['1:droite', '1:haut', '2:gauche', '2:haut']);
});
