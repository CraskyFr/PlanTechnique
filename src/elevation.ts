// Élévations : chaque mur de pièce vu de face, avec ses équipements et ses ouvertures (logique pure, sans DOM).
// Un mur reconnu est stocké en plusieurs cloisons coupées par ses portes et fenêtres : on les regroupe d'abord
// en « alignements », puis chaque face d'alignement est découpée par pièce grâce à `numero` (étiquette de pièce
// au point, ≤ 0 hors pièce, cf. cotesAuto.ts). L'abscisse part de l'angle gauche de la pièce, vu depuis la pièce.

export type Segment = { x1: number; y1: number; x2: number; y2: number; demi: number }; // cloison, en pixels du plan
export type Ouverture = { id: number; x: number; y: number; rot: number; largeur: number }; // porte, fenêtre, passage (px)
export type Equipement = { id: number; x: number; y: number; rot: number }; // rot : celle donnée par la pose contre le mur
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
 * Faces de mur de chaque pièce. `e` : mètres par pixel ; `demiBoite` : demi-côté (px) d'un symbole posé, dont le
 * centre est à cette distance de la face du mur (cf. plaquerAuMur) ; `rayon` : épaississement des murs utilisé
 * pour étiqueter les pièces (les étiquettes s'arrêtent à `rayon` px des faces).
 */
export function elevations(segments: Segment[], ouvertures: Ouverture[], equipements: Equipement[], numero: (x: number, y: number) => number, e: number, demiBoite: number, rayon = 3): Face[] {
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

  // 1. Faces : pour chaque alignement et chaque côté, les tronçons qui bordent une pièce, d'angle à angle.
  type Alignement = { ref: Morceau; dx: number; dy: number; demi: number; t: (x: number, y: number) => number };
  type Brouillon = Face & { al: Alignement; cote: 1 | -1; g: number; h: number; abscisse: (s: number) => number };
  const alignementDe = new Map<Morceau, Alignement>();
  const brouillons: Brouillon[] = [];
  for (const groupe of groupes.values()) {
    const ref = groupe.find((m) => !m.ouverture);
    if (!ref) continue; // ouverture isolée, sans cloison
    const [dx, dy] = dir(ref), [px, py] = [-dy, dx]; // direction de l'alignement et normale
    const t = (x: number, y: number) => (x - ref.ax) * dx + (y - ref.ay) * dy;
    const al: Alignement = { ref, dx, dy, demi: Math.max(...groupe.map((m) => m.demi)), t };
    for (const m of groupe) alignementDe.set(m, al);
    const debut = Math.min(...groupe.flatMap((m) => [t(m.ax, m.ay), t(m.bx, m.by)]));
    const fin = Math.max(...groupe.flatMap((m) => [t(m.ax, m.ay), t(m.bx, m.by)]));

    for (const cote of [1, -1] as const) {
      // Pièces le long de la face : on lit l'étiquette juste devant le mur, un pixel après l'autre.
      const recul = al.demi + rayon + 2, troncons: { k: number; a: number; b: number }[] = [];
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
        brouillons.push({
          al, cote, g, h, abscisse,
          piece: k,
          vue: Math.abs(vy) > Math.abs(vx) ? (vy < 0 ? 'haut' : 'bas') : vx < 0 ? 'gauche' : 'droite',
          longueur: (h - g) * e,
          elements: [],
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

  // 2. Équipements. Le centre d'un symbole posé est à une demi-boîte de la face de son mur : près d'un angle, il
  // peut être plus près de l'axe du mur perpendiculaire. On part donc du point de contact (centre reculé d'une
  // demi-boîte, dans le sens donné par la rotation de pose) et on préfère un mur parallèle à cette rotation.
  // À défaut de face de pièce pour ce mur (poteau en tranches, rotation changée à la main), le mur le plus proche.
  const portee = 3 * demiBoite; // comme plaquerAuMur : au-delà, l'équipement est posé tel quel, loin des murs
  for (const q of equipements) {
    const r = (q.rot * Math.PI) / 180, [nx, ny] = [-Math.sin(r), Math.cos(r)]; // du mur vers le symbole
    const contact = { x: q.x - nx * demiBoite, y: q.y - ny * demiBoite };
    const candidats: { m: Morceau; ordre: number }[] = [];
    for (const m of morceaux) {
      const al = alignementDe.get(m);
      if (!al) continue;
      const [dx, dy] = [m.bx - m.ax, m.by - m.ay], l2 = dx * dx + dy * dy;
      const distance = (p: { x: number; y: number }) => {
        const u = Math.max(0, Math.min(1, ((p.x - m.ax) * dx + (p.y - m.ay) * dy) / l2));
        return Math.hypot(p.x - m.ax - u * dx, p.y - m.ay - u * dy);
      };
      const d = distance(q);
      if (d > al.demi + portee) continue;
      const parallele = Math.abs(al.dx * nx + al.dy * ny) < 0.1; // mur perpendiculaire à la normale de pose
      // Parallèles d'abord, par distance du point de contact à la face ; puis tous, par distance du centre à l'axe.
      candidats.push({ m, ordre: parallele ? Math.abs(distance(contact) - al.demi) : 1e6 + d });
    }
    candidats.sort((a, b) => a.ordre - b.ordre);
    for (const { m } of candidats) {
      const al = alignementDe.get(m)!, t = al.t(q.x, q.y);
      const cote = (q.x - al.ref.ax) * -al.dy + (q.y - al.ref.ay) * al.dx >= 0 ? 1 : -1;
      const f = brouillons.find((b) => b.al === al && b.cote === cote && t >= b.g - rayon && t <= b.h + rayon);
      if (!f) continue;
      f.elements.push({ id: q.id, abscisse: Math.max(0, Math.min(f.longueur, f.abscisse(t))) });
      break;
    }
  }
  return brouillons.map(({ piece, vue, longueur, elements, ouvertures: o }) => ({ piece, vue, longueur, elements: elements.sort((a, b) => a.abscisse - b.abscisse), ouvertures: o }));
}
