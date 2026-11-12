// Tracé automatique d'un câble ou d'un tuyau (logique pure, sans DOM) : chemin en angles droits sur une grille,
// qui préfère longer les murs, évite de les percer et limite les coudes.
import type { Point } from './etat.ts';

export type Mur = { points: number[]; epaisseur: number }; // polyligne et épaisseur, en pixels du plan

// ponytail: coûts réglés à l'œil : une cloison est contournée par une porte si le détour fait moins d'environ 1 m, sinon percée.
const LONGE = 1, LIBRE = 4, PERCE = 45, COUDE = 8;
const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];

function distanceSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number) {
  const dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / l2)) : 0;
  return Math.hypot(px - x1 - t * dx, py - y1 - t * dy);
}

/** Points [x0, y0, x1, y1…] d'un chemin orthogonal de a à b, sur une grille de `pas` pixels. */
export function router(a: Point, b: Point, murs: Mur[], pas: number): number[] {
  const xs = [a.x, b.x, ...murs.flatMap((m) => m.points.filter((_, i) => i % 2 === 0))];
  const ys = [a.y, b.y, ...murs.flatMap((m) => m.points.filter((_, i) => i % 2 === 1))];
  const x0 = Math.min(...xs) - 3 * pas, y0 = Math.min(...ys) - 3 * pas;
  const nx = Math.ceil((Math.max(...xs) + 3 * pas - x0) / pas) + 1, ny = Math.ceil((Math.max(...ys) + 3 * pas - y0) / pas) + 1;

  // Coût de chaque case selon sa distance au mur le plus proche : dans le mur (percer), le long, ou au large.
  const cout = new Float32Array(nx * ny).fill(LIBRE);
  for (const m of murs)
    for (let s = 0; s + 3 < m.points.length; s += 2) {
      const [x1, y1, x2, y2] = m.points.slice(s, s + 4), portee = m.epaisseur / 2 + 1.5 * pas;
      const i1 = Math.max(0, Math.floor((Math.min(x1, x2) - portee - x0) / pas)), i2 = Math.min(nx - 1, Math.ceil((Math.max(x1, x2) + portee - x0) / pas));
      const j1 = Math.max(0, Math.floor((Math.min(y1, y2) - portee - y0) / pas)), j2 = Math.min(ny - 1, Math.ceil((Math.max(y1, y2) + portee - y0) / pas));
      for (let j = j1; j <= j2; j++)
        for (let i = i1; i <= i2; i++) {
          const d = distanceSegment(x0 + i * pas, y0 + j * pas, x1, y1, x2, y2), c = j * nx + i;
          if (d <= m.epaisseur / 2) cout[c] = PERCE;
          else if (d <= portee && cout[c] === LIBRE) cout[c] = LONGE;
        }
    }

  // Dijkstra sur (case, direction d'arrivée) : changer de direction coûte un coude.
  const cel = (p: Point) => Math.round((p.y - y0) / pas) * nx + Math.round((p.x - x0) / pas);
  const depart = cel(a), arrivee = cel(b);
  const dist = new Float64Array(nx * ny * 4).fill(Infinity), prec = new Int32Array(nx * ny * 4).fill(-1);
  const tas: [number, number][] = []; // tas binaire de [coût, état]
  const pousser = (c: number, e: number) => {
    tas.push([c, e]);
    for (let i = tas.length - 1; i > 0; ) {
      const p = (i - 1) >> 1;
      if (tas[p][0] <= tas[i][0]) break;
      [tas[p], tas[i]] = [tas[i], tas[p]];
      i = p;
    }
  };
  const extraire = () => {
    const haut = tas[0], dernier = tas.pop()!;
    if (tas.length) {
      tas[0] = dernier;
      for (let i = 0; ; ) {
        const g = 2 * i + 1, d = g + 1;
        let m = i;
        if (g < tas.length && tas[g][0] < tas[m][0]) m = g;
        if (d < tas.length && tas[d][0] < tas[m][0]) m = d;
        if (m === i) break;
        [tas[m], tas[i]] = [tas[i], tas[m]];
        i = m;
      }
    }
    return haut;
  };
  for (let d = 0; d < 4; d++) (dist[depart * 4 + d] = 0), pousser(0, depart * 4 + d);
  let fin = -1;
  while (tas.length) {
    const [c, e] = extraire();
    if (c > dist[e]) continue;
    const k = e >> 2, d = e & 3;
    if (k === arrivee) {
      fin = e;
      break;
    }
    const i = k % nx, j = (k - i) / nx;
    for (let nd = 0; nd < 4; nd++) {
      const ni = i + DIRS[nd][0], nj = j + DIRS[nd][1];
      if (ni < 0 || nj < 0 || ni >= nx || nj >= ny || nd === (d + 2) % 4) continue;
      const nk = nj * nx + ni, ne = nk * 4 + nd, nc = c + cout[nk] + (nd !== d ? COUDE : 0);
      if (nc < dist[ne]) (dist[ne] = nc), (prec[ne] = e), pousser(nc, ne);
    }
  }
  if (fin < 0) return [a.x, a.y, b.x, b.y];

  // Remonte le chemin et ne garde que les coudes.
  const cases: number[] = [];
  for (let e = fin; e >= 0; e = prec[e]) cases.unshift(e >> 2);
  const coins: Point[] = [];
  cases.forEach((k, n) => {
    const bout = n === 0 || n === cases.length - 1;
    if (bout || k - cases[n - 1] !== cases[n + 1] - k) coins.push({ x: x0 + (k % nx) * pas, y: y0 + Math.floor(k / nx) * pas });
  });

  // Extrémités exactement sur a et b, segments toujours horizontaux ou verticaux.
  if (coins.length === 1) coins.push({ ...coins[0] });
  const horiz = (p: Point, q: Point) => Math.abs(p.y - q.y) < Math.abs(p.x - q.x);
  const premierH = horiz(coins[0], coins[1]), dernierH = horiz(coins.at(-2)!, coins.at(-1)!);
  coins[0] = { ...a };
  coins[coins.length - 1] = { ...b };
  if (coins.length === 2) {
    if (a.x !== b.x && a.y !== b.y) coins.splice(1, 0, premierH ? { x: b.x, y: a.y } : { x: a.x, y: b.y });
  } else {
    if (premierH) coins[1].y = a.y;
    else coins[1].x = a.x;
    const av = coins[coins.length - 2];
    if (dernierH) av.y = b.y;
    else av.x = b.x;
  }
  return coins.flatMap((p) => [p.x, p.y]);
}
