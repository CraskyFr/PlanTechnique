import test from 'node:test';
import assert from 'node:assert/strict';
import { Historique, aimanter, bilanCircuits, manquesPiece, echelleDepuis, lireProjet, longueur, nomenclature } from './etat.ts';

const etage = {
  nom: 'RDC',
  echelle: 0.01,
  taille: 2,
  fond: 'data:image/png;base64,AA',
  objets: [{ id: 1, type: 'prise16', x: 5, y: 6, rot: 90, props: { repere: 'C3', hauteur: '30' } }],
  liaisons: [{ id: 2, type: 'cable', points: [0, 0, 300, 400], props: { section: '3G2,5' }, debut: 1 }], // accroché à la prise 1
};

test('échelle : 500 px pour 5 m donne 1 cm par pixel', () => {
  assert.equal(echelleDepuis({ x: 0, y: 0 }, { x: 300, y: 400 }, 5), 0.01);
  assert.throws(() => echelleDepuis({ x: 1, y: 1 }, { x: 1, y: 1 }, 5));
  assert.throws(() => echelleDepuis({ x: 0, y: 0 }, { x: 1, y: 1 }, NaN));
});

test('longueur : somme des segments de la polyligne', () => {
  assert.equal(longueur([0, 0, 300, 400, 300, 500]), 600);
  assert.equal(longueur([5, 5]), 0);
});

test('aimanter : projection sur le segment le plus proche, rien au-delà du seuil', () => {
  const murs = [[0, 0, 100, 0, 100, 100]];
  assert.deepEqual(aimanter({ x: 40, y: 8 }, murs, 10), { x: 40, y: 0, angle: 0, indice: 0 });
  assert.deepEqual(aimanter({ x: 95, y: 50 }, murs, 10), { x: 100, y: 50, angle: 90, indice: 0 });
  assert.deepEqual(aimanter({ x: -5, y: 3 }, murs, 10), { x: 0, y: 0, angle: 0, indice: 0 }); // bornée à l'extrémité
  assert.equal(aimanter({ x: 40, y: 30 }, murs, 10), null);
  assert.equal(aimanter({ x: 40, y: 58 }, [...murs, [0, 60, 100, 60]], 10)?.indice, 1); // la polyligne la plus proche
});

test('lireProjet : aller-retour multi-étages et rejets', () => {
  const etages = [etage, { ...etage, nom: 'Étage' }];
  assert.deepEqual(lireProjet(JSON.stringify({ etages })), etages);
  assert.throws(() => lireProjet('pas du json'));
  assert.throws(() => lireProjet('{}'));
  assert.throws(() => lireProjet(JSON.stringify({ etages: [] })));
  assert.throws(() => lireProjet(JSON.stringify({ objets: [{ id: 1, type: 'inconnu', x: 0, y: 0, rot: 0 }] })));
  assert.throws(() => lireProjet(JSON.stringify({ objets: [], fond: 'https://exemple.test/a.png' })));
  assert.throws(() => lireProjet(JSON.stringify({ objets: [], liaisons: [{ id: 1, type: 'cable', points: [0, 0, 1] }] })));
});

test('lireProjet : anciens fichiers à un seul étage, sans liaisons ni props', () => {
  const [lu, ...reste] = lireProjet(JSON.stringify({ objets: [{ id: 1, type: 'rj45', x: 0, y: 0, rot: 0, props: { repere: 'R1', bidon: 3 } }] }));
  assert.equal(reste.length, 0);
  assert.equal(lu.nom, 'Rez-de-chaussée');
  assert.deepEqual(lu.liaisons, []);
  assert.deepEqual(lu.objets[0].props, { repere: 'R1' }); // props non textuelles ignorées
  assert.deepEqual(lireProjet(JSON.stringify({ objets: [{ id: 1, type: 'rj45', x: 0, y: 0, rot: 0 }] }))[0].objets[0].props, {});
});

test('nomenclature : quantités, longueurs en mètres, formules neutralisées', () => {
  const csv = nomenclature([etage, { ...etage, nom: '=1+1', echelle: null }]).split('\r\n');
  assert.equal(csv[0], '"Étage";"Calque";"Élément";"Quantité";"Longueur (m)"');
  assert.equal(csv[1], '"RDC";"Électricité";"Prise 16 A";"1";""');
  assert.equal(csv[2], '"RDC";"Électricité";"Câble électrique";"1";"5,00"');
  assert.equal(csv[4], `"'=1+1";"Électricité";"Câble électrique";"1";"non calibré"`);
});

test('bilanCircuits : comptes, tri et alertes', () => {
  const o = (type: string, repere?: string, id = 0) => ({ id, type, x: 0, y: 0, rot: 0, props: repere ? { repere } : {} });
  const bilan = bilanCircuits([
    ...Array.from({ length: 9 }, () => o('prise16', 'C10')),
    o('lumiere', 'C2'), o('spot', 'C2'), o('inter', 'C2'),
    o('prise32', 'C3'), o('prise16', 'C3'),
    o('prise16'), o('rj45', 'R1'), // sans circuit ; RJ45 hors électricité
  ]);
  assert.deepEqual(bilan.map((c) => [c.nom, c.prises, c.eclairage, c.dedies, c.autres]), [
    ['C2', 0, 2, 0, 1], ['C3', 1, 0, 1, 0], ['C10', 9, 0, 0, 0], ['', 1, 0, 0, 0],
  ]);
  assert.deepEqual(bilan.map((c) => c.alertes.length), [0, 1, 1, 0]); // C3 : 32 A partagée ; C10 : trop de prises
  assert.match(bilan[2].alertes[0], /^9 prises/);
});

test('manquesPiece : minimums par type de pièce', () => {
  const vide = { prises: 0, eclairage: 0, rj45: 0, prise32: 0 };
  assert.deepEqual(manquesPiece('sejour', 30, { ...vide, prises: 6, eclairage: 1, rj45: 1 }), ['6 / 7 prise(s) 16 A']); // 1 par 4 m² → 8, plafonné à 7
  assert.deepEqual(manquesPiece('sejour', 12, { ...vide, prises: 5, eclairage: 1, rj45: 1 }), []); // minimum 5
  assert.deepEqual(manquesPiece('cuisine', 10, { ...vide, prises: 6, eclairage: 1 }), ['0 / 1 prise 32 A (cuisson)']);
  assert.deepEqual(manquesPiece('autre', 50, vide), []);
});

test('lireProjet : types de pièces gardés, entrées invalides ignorées', () => {
  const [lu] = lireProjet(JSON.stringify({ objets: [], pieces: [{ x: 1, y: 2, type: 'cuisine' }, { x: 1, y: 2, type: 'grenier' }, { x: 'a', y: 2, type: 'wc' }] }));
  assert.deepEqual(lu.pieces, [{ x: 1, y: 2, type: 'cuisine' }]);
});

test('historique : annuler, rétablir, et une nouvelle action efface le futur', () => {
  const h = new Historique('a');
  h.commit('b');
  assert.equal(h.annuler(), 'a');
  assert.equal(h.annuler(), null);
  assert.equal(h.refaire(), 'b');
  h.annuler();
  h.commit('c');
  assert.equal(h.refaire(), null);
  assert.equal(h.annuler(), 'a');
});
