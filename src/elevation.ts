// Élévations : chaque mur de pièce vu de face, avec ses équipements et ses ouvertures (logique pure, sans DOM).
// Un mur reconnu est stocké en plusieurs cloisons coupées par ses portes et fenêtres : on les regroupe d'abord
// en « alignements », puis chaque face d'alignement est découpée par pièce grâce à `numero` (étiquette de pièce
// au point, ≤ 0 hors pièce, cf. cotesAuto.ts). L'abscisse part de l'angle gauche de la pièce, vu depuis la pièce.

export type Segment = { x1: number; y1: number; x2: number; y2: number; demi: number }; // cloison, en pixels du plan
export type Ouverture = { id: number; x: number; y: number; rot: number; largeur: number }; // porte, fenêtre, passage (px)
export type Equipement = { id: number; x: number; y: number };
export type Vue = 'haut' | 'bas' | 'gauche' | 'droite'; // position du mur dans la pièce, sur le plan
export type Face = {
  piece: number;
  vue: Vue;
  longueur: number; // m, d'angle à angle
  elements: { id: number; abscisse: number }[]; // m depuis l'angle gauche
  ouvertures: { id: number; debut: number; fin: number }[]; // m
};

const COLINEAIRE = 0.02; // écart d'angle toléré (rad) entre morceaux d'un même mur
const PETIT_VIDE = 0.5; // m : interruption traversée (poteau, retour de mur) sans couper le mur de la pièce

/**
 * Faces de mur de chaque pièce. `e` : mètres par pixel ; `portee` : distance (px) au-delà de la demi-épaisseur
 * jusqu'à laquelle un équipement est considéré posé contre le mur ; `rayon` : épaississement des murs utilisé
 * pour étiqueter les pièces (les étiquettes s'arrêtent à `rayon` px des faces).
 */
export function elevations(segments: Segment[], ouvertures: Ouverture[], equipements: Equipement[], numero: (x: number, y: number) => number, e: number, portee: number, rayon = 3): Face[] {
  // Morceaux : cloisons et ouvertures (une ouverture comble le vide entre deux cloisons d'un même mur).
  type Morceau = { ax: number; ay: number; bx: number; by: number; demi: number; ouverture?: Ouverture };
  const morceaux: Morceau[] = segments.filter((s) => Math.hypot(s.x2 - s.x1, s.y2 - s.y1) > 0).map((s) => ({ ax: s.x1, ay: s.y1, bx: s.x2, by: s.y2, demi: s.demi }));
  for (const o of ouvertures) {
    const a = (o.rot * Math.PI) / 180, [ux, uy] = [Math.cos(a), Math.sin(a)];
    morceaux.push({ ax: o.x - (ux * o.largeur) / 2, ay: o.y - (uy * o.largeur) / 2, bx: o.x + (ux * o.largeur) / 2, by: o.y + (uy * o.largeur) / 2, demi: 0, ouverture: o });
  }
  const dir = (m: Morceau) => {
    const L = Math.hypot(m.bx - m.ax, m.by - m.ay);
    let [dx, dy] = [(m.bx - m.ax) / L, (m.by - m.ay) / L];
    if (dx < -1e-9 || (Math.abs(dx) < 1e-9 && dy < 0)) [dx, dy] = [-dx, -dy]; // sens canonique : vers la droite, ou vers le bas
    return [dx, dy];
  };

  // Regroupement en alignements (union-find) : parallèles, sur le même axe, qui se touchent ou se chevauchent.
  const parent = morceaux.map((_, i) => i);
  const racine = (i: number): number => (parent[i] === i ? i : (parent[i] = racine(parent[i])));
  for (let i = 0; i < morceaux.length; i++)
    for (let j = i + 1; j < morceaux.length; j++) {
      const [A, C] = [morceaux[i], morceaux[j]], [dx, dy] = dir(A), [ex, ey] = dir(C);
      if (Math.abs(dx * ey - dy * ex) > COLINEAIRE) continue;
      const tol = Math.max(A.demi, C.demi, 2);
      if (Math.abs((C.ax - A.ax) * -dy + (C.ay - A.ay) * dx) > tol) continue; // axes trop éloignés
      const t = (x: number, y: number) => (x - A.ax) * dx + (y - A.ay) * dy;
      const [a0, a1] = [Math.min(0, t(A.bx, A.by)), Math.max(0, t(A.bx, A.by))];
      const [c0, c1] = [Math.min(t(C.ax, C.ay), t(C.bx, C.by)), Math.max(t(C.ax, C.ay), t(C.bx, C.by))];
      // Un vide de moins de 50 cm entre deux morceaux alignés (poteau reconnu en tranches, petit passage) ne
      // coupe pas le mur : ce sont les pièces, lues plus bas, qui découpent les faces.
      const saut = Math.max(tol, PETIT_VIDE / e);
      if (c0 <= a1 + saut && a0 <= c1 + saut) parent[racine(j)] = racine(i);
    }
  const groupes = new Map<number, Morceau[]>();
  morceaux.forEach((m, i) => groupes.set(racine(i), [...(groupes.get(racine(i)) ?? []), m]));

  // Équipements : rattachés au morceau le plus proche, s'il est à portée (comme à la pose). Une ouverture compte,
  // à l'épaisseur de son mur : une prise sous une fenêtre appartient au mur qui porte la fenêtre.
  const demiMur = new Map<Morceau, number>();
  for (const groupe of groupes.values()) for (const m of groupe) demiMur.set(m, Math.max(...groupe.map((x) => x.demi)));
  const rattache = new Map<Morceau, { id: number; t: number; cote: 1 | -1 }[]>();
  for (const q of equipements) {
    let meilleur: { m: Morceau; d: number } | null = null;
    for (const m of morceaux) {
      const [dx, dy] = [m.bx - m.ax, m.by - m.ay], l2 = dx * dx + dy * dy;
      const u = Math.max(0, Math.min(1, ((q.x - m.ax) * dx + (q.y - m.ay) * dy) / l2));
      const d = Math.hypot(q.x - m.ax - u * dx, q.y - m.ay - u * dy);
      if (d <= demiMur.get(m)! + portee && (!meilleur || d < meilleur.d)) meilleur = { m, d };
    }
    if (!meilleur) continue;
    const m = meilleur.m, [dx, dy] = dir(m);
    rattache.set(m, [...(rattache.get(m) ?? []), { id: q.id, t: (q.x - m.ax) * dx + (q.y - m.ay) * dy, cote: (q.x - m.ax) * -dy + (q.y - m.ay) * dx >= 0 ? 1 : -1 }]);
  }

  const faces: Face[] = [];
  for (const groupe of groupes.values()) {
    const ref = groupe.find((m) => !m.ouverture);
    if (!ref) continue; // ouverture isolée, sans cloison
    const [dx, dy] = dir(ref), [px, py] = [-dy, dx]; // direction de l'alignement et normale
    const t = (x: number, y: number) => (x - ref.ax) * dx + (y - ref.ay) * dy;
    const debut = Math.min(...groupe.flatMap((m) => [t(m.ax, m.ay), t(m.bx, m.by)]));
    const fin = Math.max(...groupe.flatMap((m) => [t(m.ax, m.ay), t(m.bx, m.by)]));
    const demi = Math.max(...groupe.map((m) => m.demi));
    // Équipements de l'alignement, en abscisse de l'alignement (même sens canonique pour tous ses morceaux).
    const equip = groupe.flatMap((m) => (rattache.get(m) ?? []).map((r) => ({ ...r, t: r.t + t(m.ax, m.ay) })));

    for (const cote of [1, -1] as const) {
      // Pièces le long de la face : on lit l'étiquette juste devant le mur, un pixel après l'autre.
      const recul = demi + rayon + 2, troncons: { k: number; a: number; b: number }[] = [];
      for (let s = Math.ceil(debut); s <= fin; s++) {
        const k = numero(ref.ax + dx * s + px * recul * cote, ref.ay + dy * s + py * recul * cote);
        const dernier = troncons.at(-1);
        if (dernier && dernier.k === k) dernier.b = s;
        else troncons.push({ k, a: s, b: s });
      }
      // Même pièce de part et d'autre d'une courte interruption (poteau, gaine) : un seul mur.
      for (let i = 1; i + 1 < troncons.length; i++) {
        const [avant, milieu, apres] = troncons.slice(i - 1, i + 2);
        if (avant.k > 0 && avant.k === apres.k && milieu.k <= 0 && (milieu.b - milieu.a + 1) * e < PETIT_VIDE) {
          troncons.splice(i - 1, 3, { k: avant.k, a: avant.a, b: apres.b });
          i--;
        }
      }
      for (const { k, a, b } of troncons) {
        if (k <= 0 || (b - a) * e < 0.3) continue;
        // Les étiquettes s'arrêtent à `rayon` px des murs qui bordent la pièce : on les rallonge d'autant.
        const [g, h] = [Math.max(debut, a - rayon), Math.min(fin, b + 1 + rayon)];
        const abscisse = (s: number) => (cote === 1 ? s - g : h - s) * e; // vu depuis la pièce, sans effet miroir
        const [vx, vy] = [-px * cote, -py * cote]; // direction du regard, de la pièce vers le mur
        faces.push({
          piece: k,
          vue: Math.abs(vy) > Math.abs(vx) ? (vy < 0 ? 'haut' : 'bas') : vx < 0 ? 'gauche' : 'droite',
          longueur: (h - g) * e,
          elements: equip
            .filter((r) => r.cote === cote && r.t >= g - rayon && r.t <= h + rayon)
            .map((r) => ({ id: r.id, abscisse: Math.max(0, Math.min((h - g) * e, abscisse(r.t))) }))
            .sort((p, q) => p.abscisse - q.abscisse),
          ouvertures: groupe
            .filter((m) => m.ouverture)
            .flatMap((m) => {
              const [o0, o1] = [t(m.ax, m.ay), t(m.bx, m.by)].sort((p, q) => p - q);
              if (o1 <= g || o0 >= h) return [];
              const [x0, x1] = [abscisse(Math.max(o0, g)), abscisse(Math.min(o1, h))].sort((p, q) => p - q);
              return [{ id: m.ouverture!.id, debut: x0, fin: x1 }];
            })
            .sort((p, q) => p.debut - q.debut),
        });
      }
    }
  }
  return faces;
}
