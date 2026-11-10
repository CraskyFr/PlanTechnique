import test from 'node:test';
import assert from 'node:assert/strict';
import { blanchir, masqueMurs, ouvertures, rectangles, type Image } from './detection.ts';

test('pièce de synthèse : murs, fenêtre vitrée et porte avec son battant', () => {
  const img: Image = { data: new Uint8Array(400 * 240 * 4).fill(255), width: 400, height: 240 };
  const peindre = (x0: number, y0: number, x1: number, y1: number, gris: number) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) img.data.fill(gris, (y * 400 + x) * 4, (y * 400 + x) * 4 + 3);
  };
  // Pièce de 320 × 160 px, murs gris de 20 px.
  peindre(40, 40, 360, 60, 85);
  peindre(40, 180, 360, 200, 85);
  peindre(40, 40, 60, 200, 85);
  peindre(340, 40, 360, 200, 85);
  // Mur du haut : fenêtre de 100 px avec trois traits de vitrage.
  peindre(150, 40, 250, 60, 255);
  for (const y of [46, 50, 54]) peindre(150, y, 250, y + 1, 170);
  // Mur du bas : porte de 60 px ; le battant part du tableau droit vers l'intérieur (vers le haut).
  peindre(170, 180, 230, 200, 255);
  peindre(227, 125, 229, 180, 60);

  const masque = masqueMurs(img)!;
  const murs = rectangles(masque, 400, 240);
  assert.equal(murs.length, 6); // deux murs coupés en deux par leur ouverture, deux murs entiers
  assert.ok(murs.every((m) => Math.min(m.x1 - m.x0, m.y1 - m.y0) === 20)); // l'épaisseur est mesurée au pixel près

  const trouvees = ouvertures(img, masque, murs, 1 / 80); // 80 px par mètre
  assert.deepEqual(trouvees, [
    { x: 200, y: 50, largeur: 100, horizontal: true, nature: 'fenetre', cote: -1, gond: 'debut' },
    { x: 200, y: 190, largeur: 60, horizontal: true, nature: 'porte', cote: -1, gond: 'fin' },
  ]);
});

test('blanchir : gris clairs en blanc, murs, traits de meubles et couleurs intacts', () => {
  const px = [[232, 232, 232], [253, 253, 253], [85, 85, 85], [160, 160, 160], [76, 160, 130], [214, 51, 171]];
  const img: Image = { data: new Uint8Array(px.flatMap((p) => [...p, 255])), width: 6, height: 1 };
  blanchir(img);
  assert.deepEqual([...img.data], [255, 255, 255, 255, 255, 255, 255, 255, 85, 85, 85, 255, 160, 160, 160, 255, 76, 160, 130, 255, 214, 51, 171, 255]);
});

test("pas de murs pleins : rien n'est reconnu", () => {
  assert.equal(masqueMurs({ data: new Uint8Array(100 * 100 * 4).fill(255), width: 100, height: 100 }), null);
});
