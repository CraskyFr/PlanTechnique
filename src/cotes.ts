// Lecture des cotes d'un plan Kazaplan pour en déduire l'échelle (logique pure, sans DOM).
// Les cotes y sont écrites en magenta, horizontalement, sous la forme « 438cm », au milieu d'une ligne
// terminée par deux taquets. On lit le nombre, on mesure la ligne, et le rapport donne l'échelle.
import type { Image } from './detection.ts';

type Boite = { x0: number; y0: number; x1: number; y1: number }; // x1 et y1 exclus
export type Glyphe = Boite & { grille: number[] }; // grille COLS × LIGNES : part d'encre de chaque case, 0 à 9
export type Texte = Boite & { chiffres: Glyphe[] }; // chiffres en tête du texte ; la boîte englobe aussi le « cm »

const COLS = 5, LIGNES = 7;

// Modèles des chiffres de la police des cotes Kazaplan (grilles moyennes relevées sur un export réel).
// Relevées sur un PDF A4 rendu à 2525 px de large ; la grille étant normalisée, la taille du texte importe peu.
export const MODELES: Record<string, string> = {
  '0': '16971684768605896049860496827727982',
  '1': '00189158999859920199001990019900199',
  '2': '05882496783504900186028712961079999',
  '3': '17961784860028501793000487615837982',
  '4': '00291007910489129291886965669600091',
  '5': '09997297644955169687010398815828983',
  '6': '05882595669633099686970397825816883',
  '7': '99999666870028200870039200680007600',
  '8': '16972783766817629993870489715837983',
  '9': '17971784869605868489145685617728972',
};

/** Vrai si le pixel tire sur le magenta ; `marge` = écart minimal entre le rouge et le vert. */
const magenta = (d: Image['data'], i: number, marge: number) => d[i] - d[i + 1] > marge && d[i + 2] - d[i + 1] > marge * 0.6;

/** Textes magenta horizontaux de l'image, avec leurs chiffres de tête découpés. */
export function textesCotes({ data, width, height }: Image): Texte[] {
  const n = width * height;
  const masque = new Uint8Array(n);
  for (let p = 0; p < n; p++) masque[p] = +magenta(data, p * 4, 80);

  // Les lignes de cote (longues et fines) sont retirées pour qu'elles ne soudent pas les caractères entre eux.
  const long = Math.max(30, Math.round(width / 60));
  const enLigne = new Uint16Array(n), enColonne = new Uint16Array(n);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      if (!masque[y * width + x]) continue;
      const x0 = x;
      while (x < width && masque[y * width + x]) x++;
      enLigne.fill(x - x0, y * width + x0, y * width + x);
    }
  for (let x = 0; x < width; x++)
    for (let y = 0; y < height; y++) {
      if (!masque[y * width + x]) continue;
      const y0 = y;
      while (y < height && masque[y * width + x]) y++;
      for (let v = y0; v < y; v++) enColonne[v * width + x] = y - y0;
    }
  for (let p = 0; p < n; p++) if ((enLigne[p] >= long && enColonne[p] <= 3) || (enColonne[p] >= long && enLigne[p] <= 3)) masque[p] = 0;

  // Composantes connexes (8 voisins) : un caractère chacune.
  const boites: Boite[] = [];
  const pile: number[] = [];
  const vu = new Uint8Array(n);
  for (let depart = 0; depart < n; depart++) {
    if (!masque[depart] || vu[depart]) continue;
    const b = { x0: width, y0: height, x1: 0, y1: 0 };
    vu[depart] = 1;
    pile.push(depart);
    while (pile.length) {
      const p = pile.pop()!, x = p % width, y = (p - x) / width;
      b.x0 = Math.min(b.x0, x); b.x1 = Math.max(b.x1, x + 1); b.y0 = Math.min(b.y0, y); b.y1 = Math.max(b.y1, y + 1);
      for (let v = Math.max(0, y - 1); v <= Math.min(height - 1, y + 1); v++)
        for (let u = Math.max(0, x - 1); u <= Math.min(width - 1, x + 1); u++) {
          const q = v * width + u;
          if (masque[q] && !vu[q]) (vu[q] = 1, pile.push(q));
        }
    }
    const h = b.y1 - b.y0;
    if (h >= 8 && h <= 80 && b.x1 - b.x0 >= 2 && b.x1 - b.x0 <= 80) boites.push(b);
  }

  // Regroupement en textes : caractères voisins sur une même ligne d'écriture.
  boites.sort((a, b) => a.x0 - b.x0);
  const groupes: Boite[][] = [];
  for (const b of boites) {
    const g = groupes.findLast((g) => {
      const d = g[g.length - 1], H = Math.max(...g.map((c) => c.y1 - c.y0));
      const commun = Math.min(d.y1, b.y1) - Math.max(d.y0, b.y0);
      return commun >= 0.5 * Math.min(d.y1 - d.y0, b.y1 - b.y0) && b.x0 - d.x1 >= -2 && b.x0 - d.x1 <= 0.9 * H;
    });
    if (g) g.push(b);
    else groupes.push([b]);
  }

  return groupes.map((g) => {
    const H = Math.max(...g.map((c) => c.y1 - c.y0));
    // Les chiffres ont la pleine hauteur ; « c » et « m », plus bas, marquent la fin du nombre.
    const fin = g.findIndex((c) => c.y1 - c.y0 < 0.85 * H || c.x1 - c.x0 < 0.2 * H);
    const chiffres = g.slice(0, fin < 0 ? g.length : fin).map((c) => {
      const grille: number[] = [];
      for (let l = 0; l < LIGNES; l++)
        for (let k = 0; k < COLS; k++) {
          const xa = c.x0 + Math.floor((k * (c.x1 - c.x0)) / COLS), xb = Math.max(xa + 1, c.x0 + Math.floor(((k + 1) * (c.x1 - c.x0)) / COLS));
          const ya = c.y0 + Math.floor((l * (c.y1 - c.y0)) / LIGNES), yb = Math.max(ya + 1, c.y0 + Math.floor(((l + 1) * (c.y1 - c.y0)) / LIGNES));
          let encre = 0;
          for (let y = ya; y < yb; y++) for (let x = xa; x < xb; x++) encre += masque[y * width + x];
          grille.push(Math.round((9 * encre) / ((xb - xa) * (yb - ya))));
        }
      return { ...c, grille };
    });
    return { x0: g[0].x0, x1: g[g.length - 1].x1, y0: Math.min(...g.map((c) => c.y0)), y1: Math.max(...g.map((c) => c.y1)), chiffres };
  });
}

/** Nombre écrit par les chiffres, ou null si l'un d'eux ne ressemble franchement à aucun modèle. */
export function lireNombre(chiffres: Glyphe[], modeles = MODELES): number | null {
  let texte = '';
  for (const { grille } of chiffres) {
    let meilleur = '', ecartMin = Infinity;
    for (const [chiffre, modele] of Object.entries(modeles)) {
      let ecart = 0;
      for (let i = 0; i < grille.length; i++) ecart += Math.abs(grille[i] - Number(modele[i]));
      if (ecart < ecartMin) [ecartMin, meilleur] = [ecart, chiffre];
    }
    if (ecartMin > 2 * grille.length) return null; // plus de 2 crans d'écart par case en moyenne : caractère inconnu ou abîmé
    texte += meilleur;
  }
  return texte ? Number(texte) : null;
}

/**
 * Échelle en mètres par pixel, déduite des cotes intérieures lisibles ; null si moins de deux cotes concordent.
 * Chaque cote donne valeur ÷ distance entre les deux murs qu'elle sépare ; on garde le groupe de cotes
 * qui s'accordent à 1,5 % près, ce qui écarte les chiffres mal lus et les cotes qui ne vont pas de mur à mur.
 */
export function echelleDepuisCotes(img: Image, masque: Uint8Array): { metresParPixel: number; cotes: number } | null {
  const echelles = mesuresCotes(img, masque).map((m) => m.valeur / 100 / (m.droite - m.gauche));
  let groupe: number[] = [];
  for (const e of echelles) {
    const proches = echelles.filter((f) => Math.abs(f - e) <= 0.015 * e);
    if (proches.length > groupe.length) groupe = proches;
  }
  if (groupe.length < 2) return null;
  return { metresParPixel: groupe.reduce((s, e) => s + e, 0) / groupe.length, cotes: groupe.length };
}

/**
 * Cotes lues, avec les faces des deux murs entre lesquels elles sont écrites (`masque` vient de masqueMurs).
 * Les cotes extérieures, qui n'ont pas de mur de part et d'autre, sont laissées de côté.
 */
export function mesuresCotes(img: Image, masque: Uint8Array): { valeur: number; y: number; gauche: number; droite: number }[] {
  const { width } = img;
  return textesCotes(img).flatMap((t) => {
    const valeur = lireNombre(t.chiffres);
    if (!valeur) return [];
    const y = Math.round((t.chiffres[0].y0 + t.chiffres[0].y1) / 2);
    let gauche = t.x0, droite = t.x1 - 1;
    while (gauche >= 0 && !masque[y * width + gauche]) gauche--;
    while (droite < width && !masque[y * width + droite]) droite++;
    // gauche + 1 : premier pixel libre après le mur de gauche ; droite : premier pixel du mur de droite.
    return gauche < 0 || droite >= width || gauche >= t.x0 ? [] : [{ valeur, y, gauche: gauche + 1, droite }];
  });
}
