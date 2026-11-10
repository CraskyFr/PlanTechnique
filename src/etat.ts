// Modèle du projet : logique pure, sans DOM (testée par etat.test.ts).
import { CALQUES, LIAISONS, SYMBOLES } from './symboles.ts';

export type Point = { x: number; y: number };
export type Props = Record<string, string>; // repere, hauteur, section… (texte libre)
export type Objet = { id: number; type: string; x: number; y: number; rot: number; props: Props };
// points à plat : x0, y0, x1, y1… ; debut / fin : id de l'équipement auquel chaque extrémité est accrochée.
export type Liaison = { id: number; type: string; points: number[]; props: Props; debut?: number; fin?: number };
// Un projet est une liste d'étages ; chacun a son propre plan de fond et sa propre échelle.
export type Etage = {
  nom: string;
  echelle: number | null; // mètres par pixel du plan ; null tant que non calibré
  taille: number; // facteur d'affichage des symboles
  fond: string | null; // image du plan, en data URL
  objets: Objet[];
  liaisons: Liaison[];
  // Type de chaque pièce détectée, mémorisé par un point situé dedans (les pièces sont recalculées à chaque fois).
  pieces?: { x: number; y: number; type: string }[];
};

// ---------- Vérification par pièce (minimums simplifiés de la NF C 15-100, à faire valider par l'électricien) ----------
export const TYPES_PIECES: Record<string, string> = {
  sejour: 'Séjour',
  chambre: 'Chambre',
  cuisine: 'Cuisine',
  sdb: "Salle d'eau / de bain",
  wc: 'WC',
  entree: 'Entrée / dégagement',
  autre: 'Autre',
};
export type Equipement = { prises: number; eclairage: number; rj45: number; prise32: number };

/** Ce qui manque dans une pièce de ce type et de cette surface (m²), d'après ce qui y est posé. */
export function manquesPiece(type: string, aire: number, eq: Equipement): string[] {
  const min: Partial<Equipement> =
    type === 'sejour' ? { prises: Math.min(7, Math.max(5, Math.ceil(aire / 4))), eclairage: 1, rj45: 1 }
    : type === 'chambre' ? { prises: 3, eclairage: 1, rj45: 1 }
    : type === 'cuisine' ? { prises: 6, eclairage: 1, prise32: 1 }
    : type === 'sdb' ? { prises: 1, eclairage: 1 }
    : type === 'wc' || type === 'entree' ? { eclairage: 1 }
    : {};
  const noms: Record<keyof Equipement, string> = { prises: 'prise(s) 16 A', eclairage: "point(s) d'éclairage", rj45: 'prise(s) RJ45', prise32: 'prise 32 A (cuisson)' };
  return (Object.keys(min) as (keyof Equipement)[]).filter((k) => eq[k] < min[k]!).map((k) => `${eq[k]} / ${min[k]} ${noms[k]}`);
}

export const etageVide = (nom = 'Rez-de-chaussée'): Etage => ({ nom, echelle: null, taille: 1.5, fond: null, objets: [], liaisons: [] });

export function echelleDepuis(a: Point, b: Point, metres: number): number {
  const px = Math.hypot(b.x - a.x, b.y - a.y);
  if (!(px > 0) || !(metres > 0)) throw new Error('Calibration invalide : points confondus ou distance incorrecte.');
  return metres / px;
}

/** Longueur d'une polyligne, en pixels du plan. */
export function longueur(points: number[]): number {
  let total = 0;
  for (let i = 2; i < points.length; i += 2) total += Math.hypot(points[i] - points[i - 2], points[i + 1] - points[i - 1]);
  return total;
}

/**
 * Projette p sur le segment de polyligne le plus proche (à moins de `seuil`) ;
 * angle du segment en degrés et indice de la polyligne touchée.
 */
export function aimanter(p: Point, polylignes: number[][], seuil: number): (Point & { angle: number; indice: number }) | null {
  let meilleur: (Point & { angle: number; indice: number }) | null = null;
  for (const [indice, pts] of polylignes.entries())
    for (let i = 2; i < pts.length; i += 2) {
      const ax = pts[i - 2], ay = pts[i - 1], dx = pts[i] - ax, dy = pts[i + 1] - ay;
      const l2 = dx * dx + dy * dy;
      if (!l2) continue;
      const t = Math.min(1, Math.max(0, ((p.x - ax) * dx + (p.y - ay) * dy) / l2));
      const x = ax + t * dx, y = ay + t * dy;
      const d = Math.hypot(p.x - x, p.y - y);
      if (d <= seuil) {
        seuil = d;
        meilleur = { x, y, angle: (Math.atan2(dy, dx) * 180) / Math.PI, indice };
      }
    }
  return meilleur;
}

/** Nomenclature de tous les étages, en CSV pour Excel français (point-virgule, virgule décimale). */
// Familles d'équipements pour le contrôle des circuits (règles simplifiées de la NF C 15-100).
const PRISES = ['prise16', 'priseExt'];
const ECLAIRAGE = ['lumiere', 'spot'];
const DEDIES = ['prise32', 'priseSpe']; // cuisson, lave-linge, four… : un circuit à eux seuls

export type Circuit = { nom: string; prises: number; eclairage: number; dedies: number; autres: number; alertes: string[] };

/** Bilan par circuit (champ « Circuit / repère ») des équipements électriques d'un étage, avec les alertes. */
export function bilanCircuits(objets: Objet[]): Circuit[] {
  const parNom = new Map<string, Circuit>();
  for (const o of objets) {
    if (SYMBOLES[o.type]?.calque !== 'elec') continue;
    const nom = o.props.repere?.trim() || '';
    const c = parNom.get(nom) ?? { nom, prises: 0, eclairage: 0, dedies: 0, autres: 0, alertes: [] };
    if (PRISES.includes(o.type)) c.prises++;
    else if (ECLAIRAGE.includes(o.type)) c.eclairage++;
    else if (DEDIES.includes(o.type)) c.dedies++;
    else c.autres++;
    parNom.set(nom, c);
  }
  for (const c of parNom.values()) {
    if (!c.nom) continue; // « sans circuit » : rien à contrôler
    if (c.prises > 8) c.alertes.push(`${c.prises} prises : 8 au plus en 1,5 mm² / 16 A (12 en 2,5 mm² / 20 A)`);
    if (c.eclairage > 8) c.alertes.push(`${c.eclairage} points d'éclairage : 8 au plus par circuit`);
    if (c.prises && c.eclairage) c.alertes.push('prises et éclairage sur le même circuit');
    if (c.dedies && (c.dedies > 1 || c.prises || c.eclairage)) c.alertes.push('une prise spécialisée ou 32 A doit avoir son propre circuit');
  }
  // Circuits triés par numéro (C2 avant C10), « sans circuit » à la fin.
  return [...parNom.values()].sort((a, b) => (!a.nom ? 1 : !b.nom ? -1 : a.nom.localeCompare(b.nom, 'fr', { numeric: true })));
}

export function nomenclature(etages: Etage[]): string {
  const calque = (id: string) => CALQUES.find((c) => c.id === id)?.nom ?? id;
  const lignes = [['Étage', 'Calque', 'Élément', 'Quantité', 'Longueur (m)']];
  for (const e of etages) {
    for (const [type, s] of Object.entries(SYMBOLES)) {
      const n = e.objets.filter((o) => o.type === type).length;
      if (n) lignes.push([e.nom, calque(s.calque), s.nom, String(n), '']);
    }
    for (const [type, t] of Object.entries(LIAISONS)) {
      const ls = e.liaisons.filter((l) => l.type === type);
      if (!ls.length || t.horsLegende) continue;
      const px = ls.reduce((somme, l) => somme + longueur(l.points), 0);
      lignes.push([e.nom, calque(t.calque), t.nom, String(ls.length), e.echelle ? (px * e.echelle).toFixed(2).replace('.', ',') : 'non calibré']);
    }
  }
  // Un nom d'étage commençant par = + - @ serait exécuté comme formule par un tableur : on le neutralise.
  const cellule = (c: string) => `"${(/^[=+\-@]/.test(c) ? "'" + c : c).replaceAll('"', '""')}"`;
  return lignes.map((l) => l.map(cellule).join(';')).join('\r\n');
}

const fini = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const lireProps = (p: unknown): Props =>
  Object.fromEntries(Object.entries(p && typeof p === 'object' ? p : {}).filter(([, v]) => typeof v === 'string'));

/** Valide un fichier projet : un fichier ouvert n'est pas une donnée de confiance. */
export function lireProjet(texte: string): Etage[] {
  let d: any;
  try {
    d = JSON.parse(texte);
  } catch {
    throw new Error("Ce fichier n'est pas un JSON valide.");
  }
  // Jusqu'à la phase 3, le fichier était un étage unique posé à la racine.
  const bruts: unknown[] = Array.isArray(d?.etages) ? d.etages : [d];
  if (!bruts.length) throw new Error("Ce fichier n'est pas un projet de plan.");
  return bruts.map((e, i) => lireEtage(e, bruts.length > 1 ? `Niveau ${i + 1}` : 'Rez-de-chaussée'));
}

function lireEtage(d: any, nomParDefaut: string): Etage {
  if (!d || !Array.isArray(d.objets)) throw new Error("Ce fichier n'est pas un projet de plan.");
  const objets: Objet[] = d.objets.map((o: any, i: number) => {
    if (!o || !fini(o.id) || !fini(o.x) || !fini(o.y) || !fini(o.rot) || !Object.hasOwn(SYMBOLES, o.type))
      throw new Error(`Objet n°${i + 1} invalide ou de type inconnu.`);
    return { id: o.id, type: o.type, x: o.x, y: o.y, rot: o.rot, props: lireProps(o.props) };
  });
  // Les fichiers de la phase 1 n'ont pas de liaisons.
  const liaisons: Liaison[] = (Array.isArray(d.liaisons) ? d.liaisons : []).map((l: any, i: number) => {
    const pts = l?.points;
    if (!l || !fini(l.id) || !Object.hasOwn(LIAISONS, l.type) || !Array.isArray(pts) || pts.length < 4 || pts.length % 2 || !pts.every(fini))
      throw new Error(`Liaison n°${i + 1} invalide ou de type inconnu.`);
    return { id: l.id, type: l.type, points: pts, props: lireProps(l.props), ...(fini(l.debut) && { debut: l.debut }), ...(fini(l.fin) && { fin: l.fin }) };
  });
  // Seules les images embarquées sont acceptées : jamais d'URL distante.
  if (d.fond != null && !(typeof d.fond === 'string' && d.fond.startsWith('data:image/')))
    throw new Error('Image de fond invalide.');
  const pieces = (Array.isArray(d.pieces) ? d.pieces : []).filter((p: any) => p && fini(p.x) && fini(p.y) && Object.hasOwn(TYPES_PIECES, p.type));
  return {
    ...(pieces.length && { pieces: pieces.map((p: any) => ({ x: p.x, y: p.y, type: p.type })) }),
    nom: typeof d.nom === 'string' && d.nom.trim() ? d.nom.trim().slice(0, 60) : nomParDefaut,
    echelle: fini(d.echelle) && d.echelle > 0 ? d.echelle : null,
    taille: fini(d.taille) && d.taille > 0 ? d.taille : 1.5,
    fond: d.fond ?? null,
    objets,
    liaisons,
  };
}

// ponytail: pile d'instantanés complets et non bornée ; passer à des diffs si les projets deviennent énormes.
export class Historique {
  private pile: string[];
  private i = 0;
  constructor(initial: string) {
    this.pile = [initial];
  }
  commit(s: string) {
    this.pile.length = ++this.i;
    this.pile.push(s);
  }
  annuler(): string | null {
    return this.i > 0 ? this.pile[--this.i] : null;
  }
  refaire(): string | null {
    return this.i < this.pile.length - 1 ? this.pile[++this.i] : null;
  }
}
