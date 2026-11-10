// Pièces d'un plan et leurs dimensions mur à mur (logique pure, sans DOM).
// Entrée : une grille où 1 = mur (cloisons tracées, ouvertures refermées), 0 = vide.

export type Mesure = { a: number; b0: number; b1: number }; // sur la ligne (ou colonne) a, de b0 inclus à b1 exclu
export type Piece = { aire: number; largeur: Mesure; hauteur: Mesure }; // largeur : ligne y = a ; hauteur : colonne x = a

/**
 * Étiquette chaque case : 0 mur, -1 extérieur (relié au bord de la grille), -2 recoin trop petit, k ≥ 1 pièce k.
 * Pour chaque pièce, sa traversée horizontale et verticale principale (largeur courante, mur à mur),
 * prise près du haut (resp. de la gauche) de la pièce, comme les cotes de Kazaplan.
 * `rayon` épaissit d'abord les murs pour boucher les fentes entre morceaux de mur (murs reconnus en tranches) ;
 * les mesures sont ensuite rallongées d'autant, elles restent donc prises entre les vraies faces des murs.
 */
export function pieces(brut: Uint8Array, w: number, h: number, aireMin: number, rayon = 0): { etiquettes: Int32Array; pieces: Piece[] } {
  const murs = epaissir(brut, w, h, rayon);
  const etiquettes = new Int32Array(w * h);
  const file = new Int32Array(w * h);
  const remplir = (depart: number, valeur: number) => {
    let tete = 0, queue = 0;
    const pousser = (p: number) => {
      if (murs[p] || etiquettes[p]) return;
      etiquettes[p] = valeur;
      file[queue++] = p;
    };
    pousser(depart);
    while (tete < queue) {
      const p = file[tete++], x = p % w;
      if (x > 0) pousser(p - 1);
      if (x < w - 1) pousser(p + 1);
      if (p >= w) pousser(p - w);
      if (p < w * (h - 1)) pousser(p + w);
    }
    return file.subarray(0, queue); // cases remplies
  };
  for (let x = 0; x < w; x++) (remplir(x, -1), remplir((h - 1) * w + x, -1));
  for (let y = 0; y < h; y++) (remplir(y * w, -1), remplir(y * w + w - 1, -1));

  const aires: number[] = [];
  for (let p = 0; p < w * h; p++) {
    if (murs[p] || etiquettes[p]) continue;
    const cases = remplir(p, aires.length + 1);
    if (cases.length >= aireMin) aires.push(cases.length);
    else for (const q of cases) etiquettes[q] = -2;
  }

  const n = aires.length;
  // Une même fonction pour les deux sens : (a, b) = (y, x) pour la largeur, (x, y) pour la hauteur.
  const traverser = (nA: number, nB: number, idx: (a: number, b: number) => number) => {
    const aMin = new Int32Array(n + 1).fill(nA), aMax = new Int32Array(n + 1);
    const frequences = Array.from({ length: n + 1 }, () => new Map<number, number>());
    const parcourir = (rappel: (k: number, a: number, b0: number, b1: number) => void) => {
      for (let a = 0; a < nA; a++)
        for (let b = 0; b < nB; ) {
          const k = etiquettes[idx(a, b)];
          const b0 = b;
          while (b < nB && etiquettes[idx(a, b)] === k) b++;
          if (k > 0) rappel(k, a, b0, b);
        }
    };
    parcourir((k, a, b0, b1) => {
      frequences[k].set(b1 - b0, (frequences[k].get(b1 - b0) ?? 0) + 1);
      aMin[k] = Math.min(aMin[k], a);
      aMax[k] = Math.max(aMax[k], a);
    });
    // Longueur qui couvre le plus de surface (fréquence × longueur, à 1 case près) : la dimension principale
    // de la pièce (la grande branche d'un L), pas un renfoncement qui la rallonge sur quelques lignes.
    const courante = frequences.map((f) => {
      let meilleure = 0, score = -1;
      for (const l of f.keys()) {
        const s = l * ((f.get(l - 1) ?? 0) + f.get(l)! + (f.get(l + 1) ?? 0));
        if (s > score || (s === score && l > meilleure)) [meilleure, score] = [l, s];
      }
      return meilleure;
    });
    // Parmi les traversées de cette longueur, celle la plus proche du quart de la pièce.
    const choix: (Mesure & { ecart: number })[] = [];
    parcourir((k, a, b0, b1) => {
      if (Math.abs(b1 - b0 - courante[k]) > 1) return;
      const ecart = Math.abs(a - (aMin[k] + 0.25 * (aMax[k] - aMin[k])));
      if (!choix[k] || ecart < choix[k].ecart) choix[k] = { a, b0, b1, ecart };
    });
    return choix;
  };
  const largeurs = traverser(h, w, (y, x) => y * w + x);
  const hauteurs = traverser(w, h, (x, y) => y * w + x);
  return {
    etiquettes,
    pieces: aires.map((aire, i) => {
      const l = largeurs[i + 1], v = hauteurs[i + 1];
      return { aire, largeur: { a: l.a, b0: l.b0 - rayon, b1: l.b1 + rayon }, hauteur: { a: v.a, b0: v.b0 - rayon, b1: v.b1 + rayon } };
    }),
  };
}

/** Dilatation par un carré de rayon r (deux passes séparables). */
function epaissir(src: Uint8Array, w: number, h: number, r: number): Uint8Array {
  if (!r) return src;
  const passe = (entree: Uint8Array, dx: number, dy: number) => {
    const sortie = new Uint8Array(w * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        if (!entree[y * w + x]) continue;
        for (let k = -r; k <= r; k++) {
          const u = x + k * dx, v = y + k * dy;
          if (u >= 0 && v >= 0 && u < w && v < h) sortie[v * w + u] = 1;
        }
      }
    return sortie;
  };
  return passe(passe(src, 1, 0), 0, 1);
}
