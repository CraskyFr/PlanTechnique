// Cotes automatiques : à partir des cloisons et des ouvertures, les pièces (zones fermées) et les traits de cote
// à dessiner, à la manière des cotes violettes de Kazaplan. Sans état : tout vient des paramètres.
import { LIAISONS, SYMBOLES } from './symboles.ts';
import { pieces as trouverPieces } from './pieces.ts';
import { nombre, type Liaison, type Objet } from './etat.ts';

export type Trait = [number, number, number, number]; // x0, y0, x1, y1 en pixels du plan
// Pièce détectée : numéro, point d'ancrage dedans (pour son repère « P1 »), surface en m².
export type Salle = { num: number; x: number; y: number; aire: number };
export type Analyse = { traits: Trait[]; salles: Salle[]; numero: (x: number, y: number) => number }; // numero : pièce au point, ≤ 0 hors pièce

/** Analyse de la structure d'un étage ; `e` est l'échelle en mètres par pixel. */
export function calculerCotes(cloisons: Liaison[], ouvertures: Objet[], e: number): Analyse {
  const traits: Trait[] = [];
  const salles: Salle[] = [];
  if (!cloisons.length) return { traits, salles, numero: () => 0 };
  const epaisseur = (l: Liaison) => nombre(l.props.epaisseur, LIAISONS.cloison.epaisseur!) / 100 / e;
  const largeur = (o: Objet) => nombre(o.props.largeur, SYMBOLES[o.type].mural!) / 100 / e;

  // Morceaux de cloison : rectangles pour les segments horizontaux ou verticaux, à part pour les obliques.
  type Rect = { x0: number; y0: number; x1: number; y1: number; horizontal: boolean };
  const morceaux: Rect[] = [], obliques: number[][] = [];
  for (const l of cloisons)
    for (let i = 2; i < l.points.length; i += 2) {
      const [ax, ay, bx, by] = l.points.slice(i - 2, i + 2), d = epaisseur(l) / 2;
      if (Math.abs(ay - by) < 0.5) morceaux.push({ x0: Math.min(ax, bx), x1: Math.max(ax, bx), y0: ay - d, y1: ay + d, horizontal: true });
      else if (Math.abs(ax - bx) < 0.5) morceaux.push({ x0: ax - d, x1: ax + d, y0: Math.min(ay, by), y1: Math.max(ay, by), horizontal: false });
      else obliques.push([ax, ay, bx, by, d]);
    }

  // Grille des murs : cloisons à leur épaisseur, ouvertures refermées par un trait fin, sur l'emprise du bâtiment.
  const xs = cloisons.flatMap((l) => l.points.filter((_, i) => i % 2 === 0));
  const ys = cloisons.flatMap((l) => l.points.filter((_, i) => i % 2 === 1));
  const marge = Math.ceil(1 / e);
  const ox = Math.floor(Math.min(...xs)) - marge, oy = Math.floor(Math.min(...ys)) - marge;
  const W = Math.ceil(Math.max(...xs)) - ox + marge, H = Math.ceil(Math.max(...ys)) - oy + marge;
  let murs: Uint8Array = new Uint8Array(0), etiquettes: Int32Array = new Int32Array(0);
  // ponytail: grille au pixel du plan ; au-delà de 30 Mpx (plan démesuré), pas de pièces, à sous-échantillonner si besoin.
  if (W * H <= 30e6) {
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.translate(-ox, -oy);
    ctx.lineCap = 'butt';
    ctx.lineJoin = 'miter';
    for (const l of cloisons) {
      ctx.lineWidth = epaisseur(l);
      ctx.beginPath();
      for (let i = 0; i < l.points.length; i += 2) ctx.lineTo(l.points[i], l.points[i + 1]);
      ctx.stroke();
    }
    // Ouvertures bouchées sur toute l'épaisseur du mur voisin : l'embrasure ne rallonge pas la pièce.
    for (const o of ouvertures) {
      const L = largeur(o) / 2 + 2, a = (o.rot * Math.PI) / 180;
      const tableau = (s: number) => morceaux.find((r) => {
        const x = o.x + s * Math.cos(a) * (L + 2), y = o.y + s * Math.sin(a) * (L + 2);
        return x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;
      });
      const mur = tableau(1) ?? tableau(-1);
      ctx.lineWidth = mur ? Math.min(mur.x1 - mur.x0, mur.y1 - mur.y0) : 3;
      ctx.beginPath();
      ctx.moveTo(o.x - Math.cos(a) * L, o.y - Math.sin(a) * L);
      ctx.lineTo(o.x + Math.cos(a) * L, o.y + Math.sin(a) * L);
      ctx.stroke();
    }
    // Ouverture sans élément posé (passage non reconnu, porte pas encore placée) : on la referme pour séparer
    // les pièces. Depuis chaque bout de cloison, on regarde le premier morceau rencontré dans le prolongement :
    // - même épaisseur, dans l'alignement, de 40 cm à 2,5 m : ouverture dans une cloison ;
    // - mur épais (≥ 15 cm) qui bute sur un autre mur qui le barre entièrement : ouverture dans un angle.
    // Une cloison fine qui s'arrête face à un mur (meuble, retour de douche) n'est pas refermée, ni un bloc
    // presque carré (jonction de murs reconnue à part), qui n'indique aucune direction.
    const repere = (r: Rect, horizontal: boolean) => (horizontal ? [r.x0, r.x1, r.y0, r.y1] : [r.y0, r.y1, r.x0, r.x1]);
    for (const A of morceaux) {
      const [a0A, a1A, b0A, b1A] = repere(A, A.horizontal), ep = b1A - b0A, tol = Math.max(3, 0.35 * ep);
      if (a1A - a0A < 2 * ep) continue;
      for (const sens of [1, -1]) {
        let plusProche: { C: Rect; vide: number } | null = null;
        for (const C of morceaux) {
          if (C === A) continue;
          const [a0C, a1C, b0C, b1C] = repere(C, A.horizontal);
          if (b0C >= b1A || b1C <= b0A) continue; // hors du prolongement
          const vide = sens > 0 ? a0C - a1A : a0A - a1C;
          if (vide >= -1 && (!plusProche || vide < plusProche.vide)) plusProche = { C, vide };
        }
        if (!plusProche || plusProche.vide * e < 0.4 || plusProche.vide * e > 2.5) continue;
        const [, , b0C, b1C] = repere(plusProche.C, A.horizontal);
        const aligne = plusProche.C.horizontal === A.horizontal && Math.abs(b0C - b0A) <= tol && Math.abs(b1C - b1A) <= tol;
        const barre = ep * e >= 0.15 && b0C <= b0A + tol && b1C >= b1A - tol;
        if (!aligne && !barre) continue;
        const debut = sens > 0 ? a1A - 2 : a0A + 2 - plusProche.vide - 4;
        if (A.horizontal) ctx.fillRect(debut, b0A, plusProche.vide + 4, ep);
        else ctx.fillRect(b0A, debut, ep, plusProche.vide + 4);
      }
    }
    const alpha = ctx.getImageData(0, 0, W, H).data;
    murs = new Uint8Array(W * H);
    for (let p = 0; p < W * H; p++) murs[p] = +(alpha[p * 4 + 3] > 127);
    // Pièces d'au moins 0,5 m² ; rayon de 3 px : les murs reconnus sont des tranches séparées de quelques pixels.
    const resultat = trouverPieces(murs, W, H, Math.round(0.5 / e / e), 3);
    etiquettes = resultat.etiquettes;
    resultat.pieces.forEach(({ aire, largeur: l }, i) => salles.push({ num: i + 1, x: ox + (l.b0 + l.b1) / 2, y: oy + l.a + 0.5, aire: aire * e * e }));
    for (const { largeur: l, hauteur: h } of resultat.pieces) {
      traits.push([ox + l.b0, oy + l.a + 0.5, ox + l.b1, oy + l.a + 0.5]);
      traits.push([ox + h.a + 0.5, oy + h.b0, ox + h.a + 0.5, oy + h.b1]);
    }
  }
  const lire = (tab: Uint8Array | Int32Array, x: number, y: number) => {
    const u = Math.round(x - ox), v = Math.round(y - oy);
    return u < 0 || v < 0 || u >= W || v >= H || !tab.length ? -1 : tab[v * W + u];
  };
  // Cote parallèle à un élément de mur (centre c, direction u, longueur L), décalée vers l'intérieur d'une pièce.
  const aCote = (cx: number, cy: number, ux: number, uy: number, L: number, demi: number): Trait => {
    const d = demi + 0.2 / e;
    const s = lire(etiquettes, cx - uy * d, cy + ux * d) > 0 ? 1 : lire(etiquettes, cx + uy * d, cy - ux * d) > 0 ? -1 : 1;
    const px = cx - uy * d * s, py = cy + ux * d * s;
    return [px - (ux * L) / 2, py - (uy * L) / 2, px + (ux * L) / 2, py + (uy * L) / 2];
  };

  for (const o of ouvertures) {
    const a = (o.rot * Math.PI) / 180, ux = Math.cos(a), uy = Math.sin(a), L = largeur(o);
    // Demi-épaisseur du mur : on la mesure dans le tableau (le mur juste à côté de l'ouverture).
    const jx = o.x + ux * (L / 2 + 2), jy = o.y + uy * (L / 2 + 2);
    let demi = 0;
    while (demi < 1 / e && lire(murs, jx - uy * demi, jy + ux * demi) === 1 && lire(murs, jx + uy * demi, jy - ux * demi) === 1) demi++;
    traits.push(aCote(o.x, o.y, ux, uy, L, demi));
  }

  for (const [ax, ay, bx, by, d] of obliques) {
    const L = Math.hypot(bx - ax, by - ay);
    if (L * e >= 0.3) traits.push(aCote((ax + bx) / 2, (ay + by) / 2, (bx - ax) / L, (by - ay) / L, L, d));
  }
  // Cloisons : les morceaux alignés qui se touchent (mur reconnu en plusieurs tranches) forment une seule cloison.
  const rects = morceaux.map((r) => ({ ...r }));
  const touche = (r: Rect, s: Rect) => r.horizontal === s.horizontal && r.x0 <= s.x1 + 3 && s.x0 <= r.x1 + 3 && r.y0 <= s.y1 + 3 && s.y0 <= r.y1 + 3;
  // ponytail: fusion en O(n³) au pire, instantanée pour quelques centaines de cloisons.
  for (let i = 0; i < rects.length; i++)
    for (let j = i + 1; j < rects.length; j++)
      if (touche(rects[i], rects[j])) {
        const [r, s] = [rects[i], rects.splice(j, 1)[0]];
        Object.assign(r, { x0: Math.min(r.x0, s.x0), y0: Math.min(r.y0, s.y0), x1: Math.max(r.x1, s.x1), y1: Math.max(r.y1, s.y1) });
        j = i; // le rectangle agrandi peut maintenant en toucher d'autres
      }
  for (const r of rects) {
    const L = r.horizontal ? r.x1 - r.x0 : r.y1 - r.y0, demi = (r.horizontal ? r.y1 - r.y0 : r.x1 - r.x0) / 2;
    if (L * e >= 0.3) traits.push(aCote((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2, +r.horizontal, +!r.horizontal, L, demi));
  }
  return { traits, salles, numero: (x, y) => lire(etiquettes, x, y) };
}
