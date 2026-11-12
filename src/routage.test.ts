import test from 'node:test';
import assert from 'node:assert/strict';
import { router } from './routage.ts';

const orthogonal = (p: number[]) => {
  for (let i = 0; i + 3 < p.length; i += 2) assert.ok(p[i] === p[i + 2] || p[i + 1] === p[i + 3], `segment ${i / 2} en biais`);
};

test('routage : angles droits, extrémités exactes ; passe par la porte si elle est proche, perce sinon', () => {
  // Deux pièces de 200 × 200 séparées par un mur en x = 200, ouvert entre y = 80 et 120.
  const murs = [
    { points: [0, 0, 400, 0, 400, 200, 0, 200, 0, 0], epaisseur: 10 },
    { points: [200, 0, 200, 80], epaisseur: 10 },
    { points: [200, 120, 200, 200], epaisseur: 10 },
  ];
  const traversee = (p: number[]) => p[p.findIndex((v, i) => i % 2 === 0 && v > 200) - 1]; // y au passage de x = 200
  const proche = router({ x: 103, y: 68 }, { x: 297, y: 68 }, murs, 10);
  orthogonal(proche);
  assert.deepEqual(proche.slice(0, 2), [103, 68]);
  assert.deepEqual(proche.slice(-2), [297, 68]);
  assert.ok(traversee(proche) > 80 && traversee(proche) < 120, `traverse en y = ${traversee(proche)}`);
  const loin = router({ x: 103, y: 22 }, { x: 297, y: 22 }, [murs[0], { points: [200, 0, 200, 150], epaisseur: 10 }], 10); // porte à 1,3 m
  orthogonal(loin);
  assert.ok(traversee(loin) < 80, 'porte trop loin : la cloison est percée');
});

test('routage : sans mur, un seul coude', () => {
  const p = router({ x: 0, y: 0 }, { x: 100, y: 50 }, [], 10);
  orthogonal(p);
  assert.equal(p.length, 6);
});
