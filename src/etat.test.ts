import test from 'node:test';
import assert from 'node:assert/strict';
import { Historique, aimanter, echelleDepuis, lireProjet, longueur, nomenclature } from './etat.ts';

const etage = {
  nom: 'RDC',
  echelle: 0.01,
  taille: 2,
  fond: 'data:image/png;base64,AA',
  objets: [{ id: 1, type: 'prise16', x: 5, y: 6, rot: 90, props: { repere: 'C3', hauteur: '30' } }],
  liaisons: [{ id: 2, type: 'cable', points: [0, 0, 300, 400], props: { section: '3G2,5' } }],
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
