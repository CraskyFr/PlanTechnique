import Konva from 'konva';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { CALQUES, LIAISONS, SYMBOLES } from './symboles.ts';
import { masqueMurs, ouvertures, rectangles } from './detection.ts';
import { echelleDepuisCotes, effacerCotes } from './cotes.ts';
import { pieces as trouverPieces } from './pieces.ts';
import { Historique, aimanter, echelleDepuis, etageVide, lireProjet, longueur, nomenclature, type Etage, type Liaison, type Objet, type Point, type Props } from './etat.ts';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const B = 24; // côté de la boîte d'un symbole
const couleurs = Object.fromEntries(CALQUES.map((c) => [c.id, c.couleur]));
const estLiaison = (t: string | null): t is string => !!t && Object.hasOwn(LIAISONS, t);
const nombre = (s: string | undefined, defaut: number) => {
  const n = Number(s?.replace(',', '.'));
  return n > 0 ? n : defaut;
};

// Champs du panneau Propriétés : [clé, libellé, valeur par défaut].
function champs(c: Objet | Liaison): string[][] {
  if ('points' in c) {
    if (LIAISONS[c.type].cote) return [];
    const e = LIAISONS[c.type].epaisseur;
    return e ? [['epaisseur', 'Épaisseur (cm)', String(e)]] : [['repere', 'Circuit / repère', ''], ['section', 'Section / diamètre', '']];
  }
  const m = SYMBOLES[c.type].mural;
  return m ? [['largeur', 'Largeur (cm)', String(m)]] : [['hauteur', 'Hauteur de pose (cm)', ''], ['repere', 'Circuit / repère', '']];
}

// ---------- État ----------
let etages: Etage[] = [etageVide()];
let projet = etages[0]; // l'étage affiché ; tout le reste du fichier travaille dessus
// Les images de fond sont trop lourdes pour l'historique : elles restent en place, étage par étage.
const instantane = () => JSON.stringify(etages.map(({ fond, ...reste }) => reste));
let hist = new Historique(instantane());
let modifie = false;
let outil: string | null = null; // clé de SYMBOLES ou de LIAISONS en cours de pose
let selection: number | null = null; // id de l'objet ou de la liaison sélectionné
let calib: Point[] | null = null; // points cliqués pendant la calibration
let trace: number[] = []; // points de la liaison en cours de tracé
let largeurFond = 0;

const cible = () => projet.objets.find((o) => o.id === selection) ?? projet.liaisons.find((l) => l.id === selection);
const nouvelId = () => Math.max(0, ...projet.objets.map((o) => o.id), ...projet.liaisons.map((l) => l.id)) + 1;
const metres = (px: number) => (px * projet.echelle!).toFixed(2).replace('.', ',');

// Les traits de structure (cloisons, masques) ont une épaisseur réelle dès que l'échelle est calibrée.
function styleLiaison(type: string, props: Props) {
  const t = LIAISONS[type];
  const k = projet.taille;
  const cm = nombre(props.epaisseur, t.epaisseur ?? 0);
  const strokeWidth = t.cote ? 0.6 * k : !t.epaisseur ? 1.2 * k : projet.echelle ? cm / 100 / projet.echelle : (cm / 7) * 2.5 * k;
  return { stroke: t.couleur, strokeWidth, dash: t.tirets?.map((v) => v * k), lineCap: t.epaisseur ? 'butt' : 'round', lineJoin: t.epaisseur ? 'miter' : 'round' } as const;
}

// Porte ou fenêtre : se pose sur la cloison tracée la plus proche et s'aligne dessus.
function aimanterObjet(o: Objet) {
  if (!SYMBOLES[o.type].mural) return;
  const a = aimanter(o, projet.liaisons.filter((l) => l.type === 'cloison').map((l) => l.points), 25 / stage.scaleX());
  if (!a) return;
  const ecart = (((o.rot - a.angle) % 360) + 360) % 360; // garde le côté d'ouverture le plus proche de l'orientation actuelle
  Object.assign(o, { x: a.x, y: a.y, rot: (a.angle + (ecart > 90 && ecart < 270 ? 180 : 0) + 360) % 360 });
}

function valider() {
  hist.commit(instantane());
  modifie = true;
}

function appliquer(s: string | null) {
  if (!s) return;
  // Supprimer un étage réinitialise l'historique : les instantanés restent donc alignés sur `etages`.
  (JSON.parse(s) as object[]).forEach((e, i) => etages[i] && Object.assign(etages[i], e));
  modifie = true;
  rendre();
  majProps();
  majCoords();
  majEtages();
}

function majEtages() {
  $<HTMLSelectElement>('etage').replaceChildren(...etages.map((e, i) => new Option(e.nom, String(i), false, e === projet)));
}

function changerEtage(i: number) {
  projet = etages[i];
  changerMode(null);
  selection = null;
  groupes.fond.destroyChildren();
  largeurFond = 0;
  if (projet.fond) poserFond(projet.fond);
  rendre();
  majProps();
  majCoords();
  majEtages();
}

// Cotes calculées automatiquement à partir de la structure, à la manière des cotes violettes de Kazaplan.
const VIOLET = '#cc2aa6';
const COTES_AUTO = [
  { id: 'cotesPieces', nom: 'Cotes des pièces', couleur: VIOLET },
  { id: 'cotesOuvertures', nom: 'Cotes portes et fenêtres', couleur: VIOLET },
  { id: 'cotesCloisons', nom: 'Cotes des cloisons', couleur: VIOLET },
];

// ---------- Canevas ----------
const conteneur = $<HTMLDivElement>('plan');
const stage = new Konva.Stage({ container: conteneur, width: conteneur.clientWidth, height: conteneur.clientHeight, draggable: true });
const layer = new Konva.Layer();
stage.add(layer);
const groupes: Record<string, Konva.Group> = {};
for (const id of ['fond', ...CALQUES.map((c) => c.id), ...COTES_AUTO.map((c) => c.id), 'legende']) layer.add((groupes[id] = new Konva.Group()));
for (const id of ['legende', ...COTES_AUTO.map((c) => c.id)]) groupes[id].listening(false);
const reperes = new Konva.Group({ listening: false });
const tr = new Konva.Transformer({ resizeEnabled: false, rotationSnaps: [0, 45, 90, 135, 180, 225, 270, 315], rotationSnapTolerance: 8 });
// Symbole en attente de confirmation : aperçu + bouton ✓ (seul élément cliquable du groupe).
const attente = new Konva.Group();
layer.add(reperes, attente, tr);

new ResizeObserver(() => stage.size({ width: conteneur.clientWidth, height: conteneur.clientHeight })).observe(conteneur);

// Dessin d'un symbole posé (ou de son aperçu avant confirmation).
function noeudSymbole(o: Objet): Konva.Group {
  const s = SYMBOLES[o.type];
  const couleur = couleurs[s.calque], k = projet.taille;
  // Élément de mur : la boîte fait sa largeur réelle une fois l'échelle calibrée.
  const sc = s.mural && projet.echelle ? nombre(o.props.largeur, s.mural) / 100 / projet.echelle / B : k;
  // Une fenêtre large (baie) ne doit pas épaissir avec sa largeur : son épaisseur est plafonnée à 20 cm.
  const scY = s.mural && !s.ancre && projet.echelle ? Math.min(sc, 0.2 / projet.echelle / 4) : sc;
  const g = new Konva.Group({ x: o.x, y: o.y, rotation: o.rot, offset: { x: B / 2, y: s.ancre ?? B / 2 }, scale: { x: o.props.miroir ? -sc : sc, y: scY } });
  g.add(new Konva.Rect({ width: B, height: B, fill: 'transparent' })); // zone cliquable pleine
  if (s.masque) g.add(new Konva.Path({ data: s.masque, fill: '#fff' }));
  g.add(new Konva.Path({ data: s.d, stroke: couleur, strokeWidth: (1.5 * k) / sc, lineCap: 'round', lineJoin: 'round' }));
  if (s.texte) g.add(new Konva.Text({ text: s.texte, width: B, height: B, align: 'center', verticalAlign: 'middle', fontSize: 7, fontStyle: 'bold', fill: couleur }));
  const texte = [o.props.repere, o.props.hauteur && `h${o.props.hauteur}`].filter(Boolean).join(' · ');
  // Étiquette contre-pivotée : elle reste horizontale, sous le symbole, quelle que soit sa rotation.
  if (texte) g.add(new Konva.Text({ x: B / 2, y: B / 2, rotation: -o.rot, width: 80, offset: { x: 40, y: -(B / 2 + 1) }, align: 'center', text: texte, fontSize: 5, fontStyle: 'bold', fill: couleur }));
  return g;
}

function rendre() {
  for (const c of CALQUES) groupes[c.id].destroyChildren();
  tr.nodes([]);
  const k = projet.taille;

  // Liaisons d'abord : les symboles restent au-dessus des câbles et tuyaux.
  for (const l of projet.liaisons) {
    const t = LIAISONS[l.type];
    const g = new Konva.Group({ name: 'objet', id: String(l.id), draggable: true });
    const style = styleLiaison(l.type, l.props);
    const trait = { points: l.points, ...style, hitStrokeWidth: Math.max(style.strokeWidth, 12 / stage.scaleX()), shadowColor: '#2563eb', shadowBlur: 5 * k, shadowEnabled: l.id === selection };
    g.add(t.cote ? new Konva.Arrow({ ...trait, pointerAtBeginning: true, pointerLength: 3 * k, pointerWidth: 3 * k, fill: t.couleur }) : new Konva.Line(trait));
    const texte = t.cote ? (projet.echelle ? `${metres(longueur(l.points))} m` : 'non calibré') : [l.props.repere, l.props.section].filter(Boolean).join(' · ');
    if (texte) g.add(new Konva.Text({ x: (l.points[0] + l.points[2]) / 2 + 2 * k, y: (l.points[1] + l.points[3]) / 2 + 2 * k, text: texte, fontSize: 5 * k, fontStyle: 'bold', fill: t.couleur }));
    g.on('dragend', () => {
      l.points = l.points.map((v, i) => v + (i % 2 ? g.y() : g.x()));
      valider();
      setTimeout(rendre);
    });
    groupes[t.calque].add(g);
  }

  for (const o of projet.objets) {
    const g = noeudSymbole(o);
    g.setAttrs({ name: 'objet', id: String(o.id), draggable: true });
    g.on('dragend transformend', () => {
      Object.assign(o, { x: g.x(), y: g.y(), rot: g.rotation() });
      aimanterObjet(o);
      valider();
      setTimeout(rendre);
    });
    groupes[SYMBOLES[o.type].calque].add(g);
    if (o.id === selection) tr.nodes([g]);
  }

  rendreCotesAuto();
  rendreLegende();
  $<HTMLInputElement>('taille').value = String(k);
  layer.draw(); // synchrone : les nouveaux nœuds sont cliquables tout de suite, sans attendre la prochaine frame
  majStatut();
}

// ---------- Cotes automatiques ----------
type Trait = [number, number, number, number]; // x0, y0, x1, y1 en pixels du plan
let cotesCache: { cle: string; traits: Record<string, Trait[]> } | null = null;

function rendreCotesAuto() {
  for (const c of COTES_AUTO) groupes[c.id].destroyChildren();
  if (!projet.echelle) return; // sans échelle, pas de centimètres à afficher
  const cloisons = projet.liaisons.filter((l) => l.type === 'cloison');
  const ouvertures = projet.objets.filter((o) => SYMBOLES[o.type].mural);
  // Recalcul seulement quand la structure change : poser une prise ne refait pas la détection des pièces.
  const cle = JSON.stringify([projet.echelle, cloisons, ouvertures]);
  if (cotesCache?.cle !== cle) cotesCache = { cle, traits: calculerCotes(cloisons, ouvertures) };
  for (const [id, traits] of Object.entries(cotesCache.traits)) for (const t of traits) dessinerCote(groupes[id], t);
}

function calculerCotes(cloisons: Liaison[], ouvertures: Objet[]): Record<string, Trait[]> {
  const e = projet.echelle!;
  const traits: Record<string, Trait[]> = { cotesPieces: [], cotesOuvertures: [], cotesCloisons: [] };
  if (!cloisons.length) return traits;
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
    etiquettes = resultat.etiquettes;    for (const { largeur: l, hauteur: h } of resultat.pieces) {
      traits.cotesPieces.push([ox + l.b0, oy + l.a + 0.5, ox + l.b1, oy + l.a + 0.5]);
      traits.cotesPieces.push([ox + h.a + 0.5, oy + h.b0, ox + h.a + 0.5, oy + h.b1]);
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
    traits.cotesOuvertures.push(aCote(o.x, o.y, ux, uy, L, demi));
  }

  for (const [ax, ay, bx, by, d] of obliques) {
    const L = Math.hypot(bx - ax, by - ay);
    if (L * e >= 0.3) traits.cotesCloisons.push(aCote((ax + bx) / 2, (ay + by) / 2, (bx - ax) / L, (by - ay) / L, L, d));
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
    if (L * e >= 0.3) traits.cotesCloisons.push(aCote((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2, +r.horizontal, +!r.horizontal, L, demi));
  }
  return traits;
}

// Cote façon Kazaplan : trait violet fin, taquets aux deux bouts, valeur en centimètres au milieu sur fond blanc.
function dessinerCote(g: Konva.Group, [x0, y0, x1, y1]: Trait) {
  const e = projet.echelle!, L = Math.hypot(x1 - x0, y1 - y0);
  if (!L) return;
  const ux = (x1 - x0) / L, uy = (y1 - y0) / L, t = 0.06 / e, trait = { stroke: VIOLET, strokeWidth: 0.012 / e };
  g.add(new Konva.Line({ points: [x0, y0, x1, y1], ...trait }));
  for (const [x, y] of [[x0, y0], [x1, y1]]) g.add(new Konva.Line({ points: [x + uy * t, y - ux * t, x - uy * t, y + ux * t], ...trait }));
  let angle = (Math.atan2(uy, ux) * 180) / Math.PI; // texte toujours lisible : de gauche à droite ou de bas en haut
  if (angle >= 90) angle -= 180;
  if (angle < -90) angle += 180;
  const etiquette = new Konva.Label({ x: (x0 + x1) / 2, y: (y0 + y1) / 2, rotation: angle });
  etiquette.add(new Konva.Tag({ fill: '#fff' }), new Konva.Text({ text: `${Math.round(L * e * 100).toLocaleString('fr-FR')}cm`, fontSize: 0.16 / e, fontStyle: 'bold', fill: VIOLET, padding: 0.02 / e }));
  etiquette.offset({ x: etiquette.width() / 2, y: etiquette.height() / 2 });
  g.add(etiquette);
}

// Légende : ce qui est réellement posé sur les calques visibles, à droite du plan (donc incluse dans l'export PNG).
function rendreLegende() {
  groupes.legende.destroyChildren();
  const visible = (calque: string) => groupes[calque].visible();
  const g = new Konva.Group({ scale: { x: projet.taille, y: projet.taille } });
  let y = 26;
  const libelle = (text: string) => g.add(new Konva.Text({ x: 40, y: y + 7, text, fontSize: 10, fill: '#1f2937' }));
  for (const [type, s] of Object.entries(SYMBOLES)) {
    const n = projet.objets.filter((o) => o.type === type).length;
    if (!n || !visible(s.calque)) continue;
    const c = couleurs[s.calque];
    g.add(new Konva.Path({ x: 8, y, data: s.d, stroke: c, strokeWidth: 1.5, lineCap: 'round', lineJoin: 'round' }));
    if (s.texte) g.add(new Konva.Text({ x: 8, y, text: s.texte, width: B, height: B, align: 'center', verticalAlign: 'middle', fontSize: 7, fontStyle: 'bold', fill: c }));
    libelle(`${s.nom} × ${n}`);
    y += 28;
  }
  for (const [type, t] of Object.entries(LIAISONS)) {
    const total = projet.liaisons.filter((l) => l.type === type).reduce((somme, l) => somme + longueur(l.points), 0);
    if (!total || !visible(t.calque) || t.horsLegende) continue;
    g.add(new Konva.Line({ points: [8, y + 12, 32, y + 12], stroke: t.couleur, strokeWidth: t.epaisseur ? 3 : 1.5, dash: t.tirets }));
    libelle(t.nom + (projet.echelle ? ` — ${metres(total)} m` : ''));
    y += 28;
  }
  if (y === 26) return; // rien à lister
  g.add(new Konva.Rect({ width: 215, height: y + 4, fill: '#fff', stroke: '#9ca3af', strokeWidth: 0.5 }), new Konva.Text({ x: 8, y: 8, text: 'Légende', fontSize: 11, fontStyle: 'bold', fill: '#1f2937' }));
  g.findOne('Rect')!.moveToBottom();
  const droite = largeurFond || Math.max(0, ...projet.objets.map((o) => o.x), ...projet.liaisons.flatMap((l) => l.points.filter((_, i) => i % 2 === 0)));
  g.x(droite + 12 * projet.taille);
  groupes.legende.add(g);
}

function majStatut() {
  $('statut').textContent = calib
    ? `Calibration : cliquez le ${calib.length ? 'second' : 'premier'} point d'une distance connue (Échap pour annuler)`
    : estLiaison(outil)
      ? `Tracé : ${LIAISONS[outil].nom} — cliquez les points (Maj = horizontal/vertical), re-cliquez le dernier point ou Entrée pour terminer`
      : outil
        ? `Placement : ${SYMBOLES[outil].nom} — cliquez sur le plan, puis sur ✓ (ou Entrée) pour l'ajouter ; Échap pour arrêter`
        : 'Sélection — glisser pour déplacer, R pour pivoter, Suppr pour effacer, molette pour zoomer';
  conteneur.style.cursor = calib || outil ? 'crosshair' : 'default';
  for (const b of $('palette').querySelectorAll('button')) b.classList.toggle('actif', b.dataset.type === outil);
}

function changerMode(nouvelOutil: string | null, calibration = false) {
  outil = nouvelOutil;
  calib = calibration ? [] : null;
  trace = [];
  reperes.destroyChildren();
  annulerAttente();
  majStatut();
}

// ---------- Pose d'un symbole : clic = aperçu, ✓ (ou Entrée) = ajout ----------
let enAttente: Objet | null = null;

function proposer(p: Point) {
  const o: Objet = { id: 0, type: outil!, x: p.x, y: p.y, rot: 0, props: {} };
  aimanterObjet(o);
  enAttente = o;
  attente.destroyChildren();
  const apercu = noeudSymbole(o);
  apercu.setAttrs({ opacity: 0.5, listening: false });
  attente.add(apercu);
  // Bouton de taille constante à l'écran, en haut à droite de l'aperçu.
  const r = 11 / stage.scaleX(), boite = apercu.getClientRect({ relativeTo: layer });
  const bouton = new Konva.Group({ name: 'valider', x: boite.x + boite.width + r, y: boite.y - r / 2 });
  bouton.add(
    new Konva.Circle({ radius: r, fill: '#16a34a', stroke: '#fff', strokeWidth: 0.15 * r, shadowColor: '#000', shadowBlur: 0.3 * r, shadowOpacity: 0.3 }),
    new Konva.Line({ points: [-0.45 * r, 0, -0.1 * r, 0.35 * r, 0.5 * r, -0.35 * r], stroke: '#fff', strokeWidth: 0.22 * r, lineCap: 'round', lineJoin: 'round' }),
  );
  bouton.on('mouseenter', () => (conteneur.style.cursor = 'pointer'));
  bouton.on('mouseleave', majStatut);
  attente.add(bouton);
}

function confirmer() {
  if (!enAttente) return;
  projet.objets.push({ ...enAttente, id: nouvelId() });
  annulerAttente();
  valider();
  rendre();
}

function annulerAttente() {
  enAttente = null;
  attente.destroyChildren();
}

function selectionner(id: number | null) {
  selection = id;
  rendre();
  majProps();
}

// ---------- Tracé des liaisons ----------
// Avec Maj, le point est aligné horizontalement ou verticalement sur le précédent.
function pointTrace(p: Point, ortho: boolean): Point {
  if (!ortho || !trace.length) return p;
  const [x, y] = trace.slice(-2);
  return Math.abs(p.x - x) > Math.abs(p.y - y) ? { x: p.x, y } : { x, y: p.y };
}

function majApercu(q: Point) {
  reperes.destroyChildren();
  // Un masque blanc serait invisible pendant le tracé : aperçu en gris.
  reperes.add(new Konva.Line({ points: [...trace, q.x, q.y], ...styleLiaison(outil!, {}), ...(outil === 'masque' && { stroke: '#9ca3af' }), opacity: 0.6 }));
}

function terminerTrace() {
  if (trace.length >= 4) {
    projet.liaisons.push({ id: nouvelId(), type: outil!, points: trace, props: {} });
    valider();
  }
  trace = [];
  reperes.destroyChildren();
  rendre();
}

stage.on('click tap', (e) => {
  const p = layer.getRelativePointerPosition();
  if (!p) return;
  if (calib) {
    calib.push(p);
    reperes.add(new Konva.Circle({ x: p.x, y: p.y, radius: 5 / stage.scaleX(), fill: '#e11d48' }));
    majStatut();
    if (calib.length < 2) return;
    const [a, b] = calib;
    // Laisse le second repère s'afficher avant la boîte de dialogue bloquante.
    setTimeout(() => {
      const saisie = prompt('Distance réelle entre ces deux points, en mètres ?');
      if (saisie !== null) {
        try {
          projet.echelle = echelleDepuis(a, b, Number(saisie.replace(',', '.')));
          valider();
        } catch (err) {
          alert((err as Error).message);
        }
      }
      changerMode(null);
      rendre(); // la légende affiche les longueurs dès que l'échelle est connue
      majCoords();
    }, 50);
  } else if (estLiaison(outil)) {
    const q = pointTrace(p, e.evt.shiftKey);
    const n = trace.length;
    // Re-cliquer le dernier point (ou double-cliquer) termine la liaison.
    if (n && Math.hypot(q.x - trace[n - 2], q.y - trace[n - 1]) * stage.scaleX() < 8) terminerTrace();
    else {
      trace.push(q.x, q.y);
      majApercu(q);
      if (LIAISONS[outil].cote && trace.length === 4) terminerTrace(); // une cote = deux points
    }
  } else if (outil) {
    if (e.target.findAncestor('.valider', true)) confirmer();
    else proposer(p); // un nouveau clic déplace l'aperçu
  } else {
    const g = e.target.findAncestor('.objet', true);
    selectionner(g ? Number(g.id()) : null);
  }
});

stage.on('wheel', (e) => {
  e.evt.preventDefault();
  const ptr = stage.getPointerPosition();
  if (!ptr) return;
  const avant = stage.scaleX();
  const apres = Math.min(40, Math.max(0.02, avant * (e.evt.deltaY < 0 ? 1.15 : 1 / 1.15)));
  stage.position({ x: ptr.x - ((ptr.x - stage.x()) * apres) / avant, y: ptr.y - ((ptr.y - stage.y()) * apres) / avant });
  stage.scale({ x: apres, y: apres });
});

function majCoords() {
  const p = layer.getRelativePointerPosition();
  const e = projet.echelle;
  $('coords').textContent = !e
    ? 'Échelle non calibrée'
    : `1 px = ${(e * 100).toFixed(2)} cm` + (p ? ` · x ${(p.x * e).toFixed(2)} m, y ${(p.y * e).toFixed(2)} m` : '');
}
stage.on('mousemove', (e) => {
  majCoords();
  const p = layer.getRelativePointerPosition();
  if (p && estLiaison(outil) && trace.length) majApercu(pointTrace(p, e.evt.shiftKey));
});

// ---------- Fond de plan ----------
function poserFond(dataUrl: string, nouveau = false) {
  const img = new Image();
  const etage = projet;
  img.onload = () => {
    if (etage !== projet) return; // l'utilisateur a changé d'étage pendant le chargement
    groupes.fond.destroyChildren();
    // Papier blanc opaque sous l'image : l'opacité n'estompe que le plan, et les masques blancs se fondent dedans.
    groupes.fond.add(new Konva.Rect({ width: img.width, height: img.height, fill: '#fff' }), new Konva.Image({ image: img, opacity: Number(opacite.value) }));
    largeurFond = img.width;
    // Premier import : symboles à ~1/30 du plan, sinon ils sont illisibles sur un grand scan. Réglable au curseur.
    if (nouveau && !projet.objets.length && !projet.liaisons.length) projet.taille = Math.round((Math.max(img.width, img.height) / 30 / B) * 10) / 10;
    const k = Math.min(stage.width() / img.width, stage.height() / img.height) * 0.95;
    stage.scale({ x: k, y: k });
    stage.position({ x: (stage.width() - img.width * k) / 2, y: (stage.height() - img.height * k) / 2 });
    if (nouveau) projet.echelle = null; // nouvelle image : l'ancienne échelle ne s'applique plus
    rendre();
    if (nouveau) reconnaitrePlan();
  };
  img.onerror = () => alert("Impossible de lire l'image du plan.");
  img.src = dataUrl;
  projet.fond = dataUrl;
}

async function importerFond(f: File) {
  try {
    if (f.type === 'application/pdf') {
      const pdf = await pdfjs.getDocument({ data: await f.arrayBuffer() }).promise;
      let n = 1;
      if (pdf.numPages > 1) {
        const saisie = prompt(`Ce PDF contient ${pdf.numPages} pages. Laquelle importer ?`, '1');
        if (saisie === null) return;
        n = Math.min(pdf.numPages, Math.max(1, Math.round(Number(saisie)) || 1));
      }
      const page = await pdf.getPage(n);
      const viewport = page.getViewport({ scale: 3 }); // ~216 dpi : lisible en zoomant, fichier raisonnable
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvas, viewport }).promise;
      poserFond(canvas.toDataURL('image/png'), true);
    } else {
      const lecteur = new FileReader();
      lecteur.onload = () => poserFond(lecteur.result as string, true);
      lecteur.onerror = () => alert('Lecture du fichier impossible.');
      lecteur.readAsDataURL(f);
    }
    modifie = true;
  } catch (err) {
    alert(`Import impossible : ${(err as Error).message}`);
  }
}

// ---------- Reconnaissance du plan importé ----------
// Lancée à chaque import : transforme les murs pleins de l'image en cloisons, les vides entre murs alignés
// en portes et fenêtres, et fixe l'échelle d'après les cotes. Si ça échoue, on bascule sur la calibration à deux clics.
const STRUCTURE_RECONNUE = ['cloison', 'porte', 'fenetre', 'passage'];

function calibrerALaMain(raison: string) {
  alert(`${raison}\nCliquez maintenant deux points dont vous connaissez la distance réelle pour fixer l'échelle.`);
  changerMode(null, true);
}

function reconnaitrePlan() {
  const source = groupes.fond.findOne<Konva.Image>('Image')?.image() as HTMLImageElement | undefined;
  if (!source) return;
  const existante = [...projet.objets, ...projet.liaisons].filter((x) => STRUCTURE_RECONNUE.includes(x.type));
  if (existante.length) {
    if (!confirm(`Cet étage contient déjà ${existante.length} cloison(s), porte(s) ou fenêtre(s). Les remplacer par celles du nouveau plan ?`))
      return calibrerALaMain('Structure existante conservée.');
    projet.objets = projet.objets.filter((o) => !STRUCTURE_RECONNUE.includes(o.type));
    projet.liaisons = projet.liaisons.filter((l) => !STRUCTURE_RECONNUE.includes(l.type));
  }
  const canvas = document.createElement('canvas');
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#fff'; // un PNG transparent serait lu comme noir
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, 0, 0);
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);

  const masque = masqueMurs(image);
  const murs = masque ? rectangles(masque, image.width, image.height) : [];
  if (!masque || !murs.length) {
    rendre(); // la structure remplacée a pu être retirée
    return calibrerALaMain("Aucun mur reconnu sur ce plan (la reconnaissance attend des murs pleins, d'une teinte sombre uniforme, horizontaux ou verticaux).");
  }

  // Échelle : d'abord les cotes écrites sur le plan ; à défaut, on demande la largeur hors tout.
  const lue = projet.echelle ? null : echelleDepuisCotes(image, masque);
  if (lue) projet.echelle = lue.metresParPixel;
  if (!projet.echelle) {
    // Plus précis que deux clics : l'échelle est calée sur les faces extérieures des murs détectés.
    const gauche = Math.min(...murs.map((m) => m.x0));
    const droite = Math.max(...murs.map((m) => m.x1));
    const saisie = prompt("Murs reconnus, mais les cotes du plan n'ont pas pu être lues. Pour fixer l'échelle : largeur hors tout du bâtiment sur le plan (de la face extérieure du mur le plus à gauche à celle du mur le plus à droite), en mètres ?");
    try {
      if (saisie === null) throw new Error('Largeur non saisie.');
      projet.echelle = echelleDepuis({ x: gauche, y: 0 }, { x: droite, y: 0 }, Number(saisie.replace(',', '.')));
    } catch (err) {
      rendre();
      return calibrerALaMain(`${(err as Error).message} Murs non créés.`);
    }
  }
  const e = projet.echelle;
  const cm = (px: number) => String(Math.round(px * e * 1000) / 10);

  for (const m of murs) {
    const l = m.x1 - m.x0, h = m.y1 - m.y0, cx = (m.x0 + m.x1) / 2, cy = (m.y0 + m.y1) / 2;
    projet.liaisons.push({ id: nouvelId(), type: 'cloison', points: l >= h ? [m.x0, cy, m.x1, cy] : [cx, m.y0, cx, m.y1], props: { epaisseur: cm(Math.min(l, h)) } });
  }
  for (const o of ouvertures(image, masque, murs, e)) {
    const props: Props = { largeur: cm(o.largeur) };
    let rot = o.horizontal ? 0 : 90;
    if (o.nature === 'porte') {
      // Le symbole a ses gonds à gauche et s'ouvre vers le haut : rotation pour le côté, miroir pour les gonds.
      rot = o.horizontal ? (o.cote < 0 ? 0 : 180) : o.cote > 0 ? 90 : 270;
      if (rot < 180 ? o.gond === 'fin' : o.gond === 'debut') props.miroir = '1';
    }
    projet.objets.push({ id: nouvelId(), type: o.nature, x: o.x, y: o.y, rot, props });
  }
  // Plan Kazaplan (cotes lues) : ses cotes violettes sont effacées du fond, l'appli redessine les siennes.
  if (lue) {
    effacerCotes(image);
    ctx.putImageData(image, 0, 0);
    groupes.fond.findOne<Konva.Image>('Image')?.image(canvas);
    projet.fond = canvas.toDataURL('image/png');
  }
  valider();
  rendre();
  majCoords();
}

// ---------- Fichiers ----------
function telecharger(href: string, nom: string) {
  const a = document.createElement('a');
  a.href = href;
  a.download = nom;
  a.click();
}

function enregistrer() {
  const url = URL.createObjectURL(new Blob([JSON.stringify({ etages })], { type: 'application/json' }));
  telecharger(url, 'plan-technique.json');
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  modifie = false;
}

async function ouvrir(f: File) {
  if (modifie && !confirm('Les modifications non enregistrées seront perdues. Continuer ?')) return;
  try {
    etages = lireProjet(await f.text());
  } catch (err) {
    alert((err as Error).message);
    return;
  }
  hist = new Historique(instantane());
  modifie = false;
  changerEtage(0);
}

const nomFichier = (extension: string) => `plan-${projet.nom.replace(/[^\p{L}\p{N}]+/gu, '-')}.${extension}`;

// Image de l'étage affiché, en pixels du plan. Seuls les calques visibles y figurent :
// un export par corps de métier se fait en cochant/décochant.
function imagePlan() {
  selectionner(null);
  reperes.destroyChildren();
  const echelle = stage.scale();
  const pos = stage.position();
  stage.scale({ x: 1, y: 1 });
  stage.position({ x: 0, y: 0 });
  const r = layer.getClientRect();
  const url = r.width && r.height ? stage.toDataURL({ ...r, pixelRatio: 2 }) : null;
  stage.scale(echelle);
  stage.position(pos);
  if (!url) alert('Rien à exporter.');
  return url ? { url, largeur: r.width, hauteur: r.height } : null;
}

function exporterPng() {
  const plan = imagePlan();
  if (plan) telecharger(plan.url, nomFichier('png'));
}

function exporterCsv() {
  // BOM : sans lui, Excel lit les accents de travers.
  const url = URL.createObjectURL(new Blob(['﻿' + nomenclature(etages)], { type: 'text/csv' }));
  telecharger(url, 'nomenclature.csv');
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Impression à l'échelle : l'image est dimensionnée en millimètres et la boîte d'impression du navigateur
// fait le reste (« Enregistrer au format PDF » pour obtenir un PDF).
const FORMATS = [
  // zone utile en mm : marges de 10 mm, 8 mm réservés au cartouche
  { page: 'A4 portrait', l: 190, h: 269 },
  { page: 'A4 landscape', l: 277, h: 182 },
  { page: 'A3 portrait', l: 277, h: 392 },
  { page: 'A3 landscape', l: 400, h: 269 },
];
async function imprimer() {
  if (!projet.echelle) return alert("Calibrez d'abord l'échelle du plan.");
  const saisie = prompt("Échelle d'impression ? Saisissez 50 pour du 1:50 (1 cm sur le papier = 50 cm réels).", '50');
  if (saisie === null) return;
  const n = nombre(saisie.replace(/^\s*1\s*[:/]/, ''), 50);
  const plan = imagePlan();
  if (!plan) return;
  const mm = (px: number) => (px * projet.echelle! * 1000) / n;
  const l = mm(plan.largeur);
  const h = mm(plan.hauteur);
  const format = FORMATS.find((f) => l <= f.l && h <= f.h);
  if (!format) return alert(`À 1:${n}, le plan mesure ${Math.round(l)} × ${Math.round(h)} mm et dépasse l'A3. Essayez une échelle plus petite, par exemple 1:${n * 2}.`);
  $('page').textContent = `@page { size: ${format.page}; margin: 10mm; }`;
  const img = $<HTMLImageElement>('impression-img');
  img.src = plan.url;
  img.style.width = `${l}mm`;
  $('impression-titre').textContent = `${projet.nom} — échelle 1:${n} — ${format.page.replace('landscape', 'paysage')} — imprimer à 100 %, sans « ajuster à la page »`;
  await img.decode();
  print();
}

// ---------- Interface ----------
$('calques').innerHTML = [{ id: 'fond', nom: 'Fond de plan', couleur: '#6b7280' }, ...CALQUES, ...COTES_AUTO, { id: 'legende', nom: 'Légende', couleur: '#6b7280' }]
  .map(
    (c) =>
      `<div class="calque"><label style="color:${c.couleur}"><input type="checkbox" data-calque="${c.id}" checked> ${c.nom}</label>` +
      // Fond et légende ne sont jamais sélectionnables : pas de verrou à proposer.
      (couleurs[c.id] ? `<label title="Verrouiller : les éléments de ce calque ne peuvent plus être sélectionnés ni déplacés"><input type="checkbox" data-verrou="${c.id}"> 🔒</label>` : '') +
      `</div>`,
  )
  .join('');
$('calques').addEventListener('change', (e) => {
  const el = e.target as HTMLInputElement;
  if (el.dataset.verrou) groupes[el.dataset.verrou].listening(!el.checked);
  else groupes[el.dataset.calque!].visible(el.checked);
  selectionner(null);
});

const bouton = (type: string, couleur: string, nom: string, dessin: string) =>
  `<button data-type="${type}" style="color:${couleur}"><svg viewBox="0 0 ${B} ${B}" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${dessin}</svg><span>${nom}</span></button>`;
$('palette').innerHTML = CALQUES.map(
  (c) =>
    `<h3 style="color:${c.couleur}">${c.nom}</h3>` +
    Object.entries(SYMBOLES)
      .filter(([, s]) => s.calque === c.id)
      .map(([type, s]) =>
        bouton(type, c.couleur, s.nom, `<path d="${s.d}"/>` + (s.texte ? `<text x="12" y="12" text-anchor="middle" dominant-baseline="central" font-size="7" font-weight="bold" fill="currentColor" stroke="none">${s.texte}</text>` : '')),
      )
      .join('') +
    Object.entries(LIAISONS)
      .filter(([, t]) => t.calque === c.id)
      .map(([type, t]) => bouton(type, t.couleur === '#ffffff' ? '#9ca3af' : t.couleur, t.nom, `<path d="M2 12 H22" stroke-width="2"${t.tirets ? ` stroke-dasharray="${t.tirets}"` : ''}/>`))
      .join(''),
).join('');
$('palette').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-type]');
  if (b) changerMode(b.dataset.type === outil ? null : b.dataset.type!);
});

// Panneau Propriétés : reconstruit seulement quand la sélection change, pour ne pas perdre le focus en cours de saisie.
function majProps() {
  const el = $('props');
  const c = cible();
  if (!c) {
    el.textContent = 'Sélectionnez un élément pour modifier ses propriétés.';
    return;
  }
  const liaison = 'points' in c;
  el.innerHTML =
    `<strong>${(liaison ? LIAISONS : SYMBOLES)[c.type].nom}</strong>` +
    champs(c).map(([cle, nom, defaut]) => `<label>${nom}<input type="text" data-champ="${cle}" placeholder="${defaut}"></label>`).join('') +
    (liaison && projet.echelle ? `<p>Longueur : ${metres(longueur(c.points))} m</p>` : '') +
    (!liaison && SYMBOLES[c.type].mural ? `<p>R : passer de l'autre côté du mur. M : inverser les gonds.</p>` : '') +
    (!projet.echelle && (liaison ? LIAISONS[c.type].epaisseur : SYMBOLES[c.type].mural) ? `<p>Calibrez l'échelle pour un tracé aux dimensions réelles.</p>` : '');
  for (const i of el.querySelectorAll('input')) i.value = c.props[i.dataset.champ!] ?? ''; // via .value : jamais interprété comme du HTML
}
$('props').addEventListener('input', (e) => {
  const i = e.target as HTMLInputElement;
  const c = cible();
  if (!c) return;
  if (i.value.trim()) c.props[i.dataset.champ!] = i.value.trim();
  else delete c.props[i.dataset.champ!];
  modifie = true;
  rendre();
});
$('props').addEventListener('change', valider);

const opacite = $<HTMLInputElement>('opacite');
opacite.addEventListener('input', () => groupes.fond.findOne('Image')?.opacity(Number(opacite.value)));

const taille = $<HTMLInputElement>('taille');
taille.addEventListener('input', () => {
  projet.taille = Number(taille.value);
  rendre();
});
taille.addEventListener('change', valider);

const surFichier = (id: string, f: (fichier: File) => void) =>
  $<HTMLInputElement>(id).addEventListener('change', (e) => {
    const input = e.target as HTMLInputElement;
    if (input.files?.[0]) f(input.files[0]);
    input.value = ''; // permet de re-sélectionner le même fichier
  });
surFichier('f-fond', importerFond);
surFichier('f-projet', ouvrir);

$('b-sauver').onclick = enregistrer;
$('b-png').onclick = exporterPng;
$('b-csv').onclick = exporterCsv;
$('b-imprimer').onclick = imprimer;

$('etage').onchange = (e) => changerEtage(Number((e.target as HTMLSelectElement).value));
$('b-etage-plus').onclick = () => {
  const nom = prompt('Nom du nouvel étage ?', `Niveau ${etages.length + 1}`)?.trim();
  if (!nom) return;
  etages.push(etageVide(nom.slice(0, 60)));
  valider();
  changerEtage(etages.length - 1);
};
$('b-etage-nom').onclick = () => {
  const nom = prompt("Nouveau nom de l'étage ?", projet.nom)?.trim();
  if (!nom) return;
  projet.nom = nom.slice(0, 60);
  valider();
  majEtages();
};
$('b-etage-suppr').onclick = () => {
  if (etages.length < 2) return alert('Un projet garde au moins un étage.');
  if (!confirm(`Supprimer l'étage « ${projet.nom} » et tout son contenu ? Cette action ne peut pas être annulée.`)) return;
  etages = etages.filter((e) => e !== projet);
  hist = new Historique(instantane()); // les anciens instantanés ne correspondent plus aux étages restants
  modifie = true;
  changerEtage(0);
};
$('b-annuler').onclick = () => appliquer(hist.annuler());
$('b-refaire').onclick = () => appliquer(hist.refaire());

addEventListener('keydown', (e) => {
  // Dans un champ texte, les touches servent à écrire (R, Suppr, Ctrl+Z natif…).
  if (e.target instanceof HTMLInputElement && e.target.type === 'text') return;
  const ctrl = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  if (ctrl && k === 's') (e.preventDefault(), enregistrer());
  else if (ctrl && (k === 'y' || (k === 'z' && e.shiftKey))) (e.preventDefault(), appliquer(hist.refaire()));
  else if (ctrl && k === 'z') (e.preventDefault(), appliquer(hist.annuler()));
  else if (k === 'escape') {
    changerMode(null);
    selectionner(null);
  } else if (k === 'enter' && enAttente) confirmer();
  else if (k === 'enter' && estLiaison(outil)) terminerTrace();
  else if ((k === 'delete' || k === 'backspace') && cible()) {
    projet.objets = projet.objets.filter((o) => o.id !== selection);
    projet.liaisons = projet.liaisons.filter((l) => l.id !== selection);
    valider();
    selectionner(null);
  } else if (k === 'm' && !ctrl) {
    // Miroir d'une porte ou d'une fenêtre : change le côté des gonds sans changer le côté d'ouverture.
    const o = projet.objets.find((o) => o.id === selection);
    if (!o || !SYMBOLES[o.type].mural) return;
    if (o.props.miroir) delete o.props.miroir;
    else o.props.miroir = '1';
    valider();
    rendre();
  } else if (k === 'r' && !ctrl) {
    const o = projet.objets.find((o) => o.id === selection);
    if (!o) return;
    o.rot = (o.rot + (SYMBOLES[o.type].mural ? 180 : 90)) % 360; // porte/fenêtre : bascule de l'autre côté du mur
    valider();
    rendre();
  }
});

addEventListener('beforeunload', (e) => {
  if (modifie) e.preventDefault();
});

rendre();
majProps();
majCoords();
majEtages();
