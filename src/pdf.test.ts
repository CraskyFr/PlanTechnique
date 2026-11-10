import test from 'node:test';
import assert from 'node:assert/strict';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { pdfDepuisJpeg } from './pdf.ts';

const jpeg = new Uint8Array([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9]); // contenu factice : seule la structure est vérifiée ici

test('PDF : table des renvois exacte et image embarquée telle quelle', () => {
  const pdf = pdfDepuisJpeg(jpeg, 300, 200);
  const texte = new TextDecoder('latin1').decode(pdf);
  const [, debut] = texte.match(/startxref\n(\d+)/)!;
  assert.ok(texte.startsWith('xref', Number(debut)));
  const offsets = [...texte.slice(Number(debut)).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
  assert.equal(offsets.length, 5);
  offsets.forEach((o, i) => assert.ok(texte.startsWith(`${i + 1} 0 obj`, o)));
  assert.ok(texte.includes('/Width 300 /Height 200') && texte.includes(`/Length ${jpeg.length}`));
});

test('PDF : relu par pdf.js, A4 paysage pour une image large, portrait sinon', async () => {
  const taille = async (l: number, h: number) => (await (await getDocument({ data: pdfDepuisJpeg(jpeg, l, h) }).promise).getPage(1)).view.map(Math.round);
  assert.deepEqual(await taille(300, 200), [0, 0, 842, 595]);
  assert.deepEqual(await taille(200, 300), [0, 0, 595, 842]);
});
