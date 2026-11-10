// Reconnaissance des murs et des ouvertures sur une image de plan (logique pure, sans DOM).
// Hypothèses : murs pleins d'une teinte grise ou noire uniforme, horizontaux ou verticaux (cas des exports Kazaplan).

export type Image = { data: Uint8ClampedArray | Uint8Array; width: number; height: number }; // RGBA
export type Mur = { x0: number; y0: number; x1: number; y1: number }; // rectangle plein, x1 et y1 exclus
export type Ouverture = {
  x: number; // centre, sur l'axe du mur
  y: number;
  largeur: number; // en pixels
  horizontal: boolean; // sens du mur
  nature: 'fenetre' | 'porte' | 'passage';
  cote: 1 | -1; // porte : côté où s'ouvre le battant (vers +y ou -y pour un mur horizontal, ±x pour un vertical)
  gond: 'debut' | 'fin'; // porte : extrémité de l'ouverture qui porte les gonds (début = gauche ou haut)
};

/** Masque des pixels « mur » : la teinte neutre sombre la plus fréquente, bords d'anticrénelage compris. */
export function masqueMurs({ data, width, height }: Image): Uint8Array | null {
  const n = width * height;
  const neutre = (i: number) => Math.max(data[i], data[i + 1], data[i + 2]) - Math.min(data[i], data[i + 1], data[i + 2]) < 24;
  const clarte = (i: number) => (data[i] + data[i + 1] + data[i + 2]) / 3;
  const histo = new Uint32Array(150);
  let sombres = 0;
  for (let p = 0; p < n; p++) {
    const l = clarte(p * 4) | 0;
    if (l < 150 && neutre(p * 4)) (histo[l]++, sombres++);
  }
  if (sombres < n * 0.002) return null; // pas de murs pleins dans cette image
  const teinte = histo.indexOf(Math.max(...histo));
  // Seuil à mi-chemin du blanc : un pixel de bord à moitié couvert compte, les cotes mesurées ne sont pas biaisées.
  const haut = (teinte + 255) / 2;
  const masque = new Uint8Array(n);
  for (let p = 0; p < n; p++) {
    const l = clarte(p * 4);
    masque[p] = +(l >= teinte - 40 && l < haut && neutre(p * 4));
  }
  // Ouverture : efface les traits fins (mobilier, texte). Fermeture : rebouche ce qui passe par-dessus un mur (cotes, volets).
  const fin = Math.max(1, Math.round(width / 2500));
  const trou = Math.max(2, Math.round(width / 500)); // rebouche jusqu'à ~7 cm sur un plan de maison en A4
  const ouvert = boite(boite(masque, width, height, fin, true), width, height, fin, false);
  return boite(boite(ouvert, width, height, trou, false), width, height, trou, true);
}

/** Érosion (tous = true) ou dilatation par un carré de rayon r, en deux passes séparables. */
function boite(src: Uint8Array, w: number, h: number, r: number, tous: boolean): Uint8Array {
  const passe = (entree: Uint8Array, longueur: number, lignes: number, indice: (ligne: number, k: number) => number) => {
    const sortie = new Uint8Array(w * h);
    const cumul = new Uint32Array(longueur + 1);
    for (let l = 0; l < lignes; l++) {
      for (let k = 0; k < longueur; k++) cumul[k + 1] = cumul[k] + entree[indice(l, k)];
      for (let k = 0; k < longueur; k++) {
        const a = Math.max(0, k - r), b = Math.min(longueur, k + r + 1);
        const somme = cumul[b] - cumul[a];
        sortie[indice(l, k)] = +(tous ? somme === b - a : somme > 0);
      }
    }
    return sortie;
  };
  return passe(passe(src, w, h, (y, x) => y * w + x), h, w, (x, y) => y * w + x);
}

/** Découpe le masque en rectangles pleins (fusion des segments identiques d'une ligne à la suivante). */
export function rectangles(masque: Uint8Array, width: number, height: number): Mur[] {
  const finis: Mur[] = [];
  let actifs: (Mur | null)[] = [];
  for (let y = 0; y <= height; y++) {
    const suivants: Mur[] = [];
    for (let x = 0; y < height && x < width; x++) {
      if (!masque[y * width + x]) continue;
      const x0 = x;
      while (x < width && masque[y * width + x]) x++;
      const k = actifs.findIndex((r) => r && Math.abs(r.x0 - x0) <= 1 && Math.abs(r.x1 - x) <= 1); // ±1 px de tolérance
      const r = k >= 0 ? actifs[k]! : { x0, x1: x, y0: y, y1: y };
      if (k >= 0) actifs[k] = null;
      r.y1 = y + 1;
      suivants.push(r);
    }
    for (const r of actifs) if (r) finis.push(r);
    actifs = suivants;
  }
  const mini = Math.max(4, Math.round(width / 500)); // plus fin qu'une cloison : résidu, pas un mur
  const murs = finis.filter((r) => Math.min(r.x1 - r.x0, r.y1 - r.y0) >= mini);
  // Un petit pavé qui ne touche aucun vrai mur est un meuble sombre (radiateur…), pas un morceau de mur.
  const petit = (r: Mur) => Math.max(r.x1 - r.x0, r.y1 - r.y0) < 3 * mini;
  return murs.filter((r) => !petit(r) || murs.some((o) => !petit(o) && o.x0 <= r.x1 + 2 && o.x1 >= r.x0 - 2 && o.y0 <= r.y1 + 2 && o.y1 >= r.y0 - 2));
}

/** Pixels atteignables depuis le bord de l'image sans traverser la barrière : l'extérieur du bâtiment. */
function inonder(barriere: Uint8Array, w: number, h: number): Uint8Array {
  const vu = new Uint8Array(w * h);
  const file = new Int32Array(w * h);
  let tete = 0, queue = 0;
  const pousser = (p: number) => {
    if (barriere[p] || vu[p]) return;
    vu[p] = 1;
    file[queue++] = p;
  };
  for (let x = 0; x < w; x++) (pousser(x), pousser((h - 1) * w + x));
  for (let y = 0; y < h; y++) (pousser(y * w), pousser(y * w + w - 1));
  while (tete < queue) {
    const p = file[tete++], x = p % w;
    if (x > 0) pousser(p - 1);
    if (x < w - 1) pousser(p + 1);
    if (p >= w) pousser(p - w);
    if (p < w * (h - 1)) pousser(p + w);
  }
  return vu;
}

/**
 * Ouvertures : vide de 0,5 à 5 m entre deux murs alignés de même épaisseur, sans autre mur dans l'intervalle.
 * - fenêtre : donne sur l'extérieur et des traits (le vitrage) la traversent dans le sens du mur ;
 * - porte : les autres ouvertures jusqu'à 1,2 m ; au-delà, simple passage.
 */
export function ouvertures({ data, width, height }: Image, masque: Uint8Array, murs: Mur[], metresParPixel: number): Ouverture[] {
  const clair = (x: number, y: number, seuil: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return 0;
    const i = (y * width + x) * 4;
    return +(data[i] + data[i + 1] + data[i + 2] < seuil * 3);
  };
  // On raisonne en (a, b) = (le long du mur, en travers) : le cas vertical s'obtient en échangeant x et y.
  type Bande = { a0: number; a1: number; b0: number; b1: number };
  const candidates: { horizontal: boolean; A: Bande; B: Bande; b0: number; b1: number }[] = [];
  for (const horizontal of [true, false]) {
    const tous: Bande[] = murs.map((m) => (horizontal ? { a0: m.x0, a1: m.x1, b0: m.y0, b1: m.y1 } : { a0: m.y0, a1: m.y1, b0: m.x0, b1: m.x1 }));
    for (const A of tous)
      for (const B of tous) {
        const tol = Math.max(2, 0.25 * (A.b1 - A.b0));
        const vide = (B.a0 - A.a1) * metresParPixel;
        if (vide < 0.5 || vide > 5 || Math.abs(A.b0 - B.b0) > tol || Math.abs(A.b1 - B.b1) > tol) continue;
        if ((A.b1 - A.b0) * metresParPixel > 0.6) continue; // deux murs face à face de part et d'autre d'une pièce, pas une ouverture
        const b0 = Math.max(A.b0, B.b0), b1 = Math.min(A.b1, B.b1);
        if (tous.some((C) => C !== A && C !== B && C.a0 < B.a0 && C.a1 > A.a1 && C.b0 < b1 && C.b1 > b0)) continue;
        candidates.push({ horizontal, A, B, b0, b1 });
      }
  }

  // Extérieur : on bouche les ouvertures (en mordant de 2 px sur les murs) puis on inonde depuis le bord de l'image.
  const barriere = Uint8Array.from(masque);
  for (const { horizontal, A, B, b0, b1 } of candidates)
    for (let a = A.a1 - 2; a < B.a0 + 2; a++) for (let b = b0; b < b1; b++) barriere[horizontal ? b * width + a : a * width + b] = 1;
  const dehors = inonder(barriere, width, height);

  return candidates.map(({ horizontal, A, B, b0, b1 }) => {
    const vide = B.a0 - A.a1, milieu = Math.round((A.a1 + B.a0) / 2);
    const pt = (a: number, b: number): [number, number] => (horizontal ? [a, b] : [b, a]);
    const estDehors = (b: number) => {
      const [x, y] = pt(milieu, b);
      return x >= 0 && y >= 0 && x < width && y < height && dehors[y * width + x] === 1;
    };
    // Vitrage : somme, sur l'épaisseur du mur, de la part de chaque ligne couverte par un trait (même pâle).
    let vitrage = 0;
    for (let b = b0 + 2; b < b1 - 2; b++) {
      let n = 0;
      for (let a = A.a1 + 1; a < B.a0 - 1; a++) n += clair(...pt(a, b), 242);
      vitrage += n / (vide - 2);
    }
    const nature = vitrage >= 1.5 && (estDehors(b0 - 3) || estDehors(b1 + 2)) ? 'fenetre' : vide * metresParPixel <= 1.2 ? 'porte' : 'passage';

    // Battant : on cherche le trait du vantail, perpendiculaire au mur, contre l'un des deux tableaux, d'un côté ou de l'autre.
    let cote: 1 | -1 = -1, gond: 'debut' | 'fin' = 'debut', meilleur = 0;
    const bande = Math.max(4, Math.round(0.12 * vide)), portee = Math.round(0.9 * vide);
    for (const c of [-1, 1] as const)
      for (const g of ['debut', 'fin'] as const) {
        const a0 = g === 'debut' ? A.a1 : B.a0 - bande;
        let n = 0;
        for (let i = 0; i < portee; i++) for (let a = a0; a < a0 + bande; a++) n += clair(...pt(a, c < 0 ? b0 - 1 - i : b1 + i), 215);
        if (n > meilleur) [meilleur, cote, gond] = [n, c, g];
      }
    const [x, y] = pt((A.a1 + B.a0) / 2, (b0 + b1) / 2);
    return { x, y, largeur: vide, horizontal, nature, cote, gond };
  });
}
