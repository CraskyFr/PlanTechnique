import test from 'node:test';
import assert from 'node:assert/strict';
import { besoinChauffage, diametreConseille, montee, protection, tableau, volume } from './calculs.ts';

const circuit = (nom: string, prises = 0, eclairage = 0, dedies = 0, cuisson = dedies) => ({ nom, prises, eclairage, dedies, cuisson, autres: 0, alertes: [] });

test('protection : calibre, section et conseil selon le contenu du circuit', () => {
  assert.deepEqual(protection(circuit('C1', 6)), { calibre: 16, section: '1,5 mm²' });
  assert.equal(protection(circuit('C2', 10)).calibre, 20);
  assert.match(protection(circuit('C3', 14)).conseil!, /Scinder en 2 circuits/);
  assert.deepEqual(protection(circuit('C4', 0, 0, 1)), { calibre: 32, section: '6 mm²' }); // plaque de cuisson
  assert.deepEqual(protection(circuit('C6', 0, 0, 1, 0)), { calibre: 20, section: '2,5 mm²' }); // lave-linge, four…
  assert.match(protection(circuit('C5', 2, 3)).conseil!, /Séparer/);
});

test('tableau : type A pour les spécialisés, 8 circuits au plus par différentiel, minimum selon la surface', () => {
  const circuits = [circuit('C1', 5), circuit('C2', 0, 4), circuit('C3', 0, 0, 1), circuit('', 2)];
  assert.deepEqual(tableau(circuits, 80), [
    { type: 'A', calibre: 40, circuits: ['C3'] },
    { type: 'AC', calibre: 40, circuits: ['C1'] },
    { type: 'AC', calibre: 40, circuits: ['C2'] },
  ]);
  const beaucoup = Array.from({ length: 20 }, (_, i) => circuit(`C${i + 1}`, 4));
  assert.ok(tableau(beaucoup, 120).every((d) => d.circuits.length <= 8));
  assert.equal(tableau([], 20)[0].calibre, 25);
});

test('montée : du plafond à la hauteur de pose', () => {
  assert.equal(montee(2.5, '30'), 2.2);
  assert.equal(montee(2.5, undefined), 0);
  assert.equal(montee(2.5, '300'), 0); // au-dessus du plafond : ignoré
});

test('chauffage et diamètres : ordres de grandeur', () => {
  assert.equal(besoinChauffage(12, 2.5, 'moyenne'), 1050); // 12 × 2,5 × 35 = 1 050 W
  assert.equal(besoinChauffage(12, 2.5, 'inconnue'), 1050);
  assert.match(diametreConseille(1), /16 mm/);
  assert.match(diametreConseille(5), /26 mm/);
});

test('volume : au-dessus de la baignoire, dans la bande de 60 cm, ou dehors', () => {
  const bain = { x: 100, y: 100, rot: 90, largeur: 170, profondeur: 70 }; // tournée : 70 de large en x, 170 en y
  assert.equal(volume({ x: 100, y: 180 }, bain, 60), 1);
  assert.equal(volume({ x: 180, y: 100 }, bain, 60), 2);
  assert.equal(volume({ x: 200, y: 100 }, bain, 60), 0);
});
