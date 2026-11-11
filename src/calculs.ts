// Calculs d'aide à la conception (logique pure, sans DOM). Règles simplifiées, à faire valider par les artisans :
// NF C 15-100 pour l'électricité, ordres de grandeur usuels pour le chauffage et les diamètres de tuyaux.
import type { Circuit } from './etat.ts';

// ---------- Électricité : protection de chaque circuit et tableau ----------
export type Protection = { calibre: number; section: string; conseil?: string };

/** Disjoncteur et section de câble pour un circuit, avec une piste de correction s'il est hors limites. */
export function protection(c: Circuit): Protection {
  if (c.dedies) {
    const seul = c.dedies === 1 && !c.prises && !c.eclairage;
    if (!seul) return { calibre: 20, section: '2,5 mm²', conseil: 'Isoler chaque prise spécialisée ou 32 A sur son propre circuit.' };
    return c.cuisson ? { calibre: 32, section: '6 mm²' } : { calibre: 20, section: '2,5 mm²' }; // cuisson, ou lave-linge, four…
  }
  if (c.prises > 12) return { calibre: 20, section: '2,5 mm²', conseil: `Scinder en ${Math.ceil(c.prises / 8)} circuits de 8 prises au plus.` };
  if (c.prises > 8) return { calibre: 20, section: '2,5 mm²', conseil: 'Câbler en 2,5 mm² sur un disjoncteur 20 A (12 prises au plus), ou scinder le circuit.' };
  if (c.eclairage > 8) return { calibre: 16, section: '1,5 mm²', conseil: `Scinder en ${Math.ceil(c.eclairage / 8)} circuits de 8 points au plus.` };
  if (c.prises && c.eclairage) return { calibre: 16, section: '1,5 mm²', conseil: "Séparer les prises et l'éclairage sur deux circuits." };
  return { calibre: 16, section: '1,5 mm²' };
}

export type Differentiel = { type: 'A' | 'AC'; calibre: number; circuits: string[] };

/**
 * Répartition des circuits sous interrupteurs différentiels 30 mA : un type A pour les circuits spécialisés
 * (cuisson, lave-linge…), des type AC pour le reste, 8 circuits au plus par différentiel, et au moins
 * 1 (moins de 35 m²), 2 (jusqu'à 100 m²) ou 3 différentiels AC selon la surface du logement.
 */
export function tableau(circuits: Circuit[], surface: number): Differentiel[] {
  const nommes = circuits.filter((c) => c.nom);
  const typeA = nommes.filter((c) => c.dedies).map((c) => c.nom);
  const autres = nommes.filter((c) => !c.dedies).map((c) => c.nom);
  const nbAC = Math.max(Math.ceil(autres.length / 8), surface > 100 ? 3 : surface >= 35 ? 2 : 1);
  const ac: Differentiel[] = Array.from({ length: nbAC }, () => ({ type: 'AC', calibre: surface < 35 && nbAC === 1 ? 25 : 40, circuits: [] }));
  autres.forEach((nom, i) => ac[i % nbAC].circuits.push(nom)); // en alternance : un déclenchement ne coupe pas tout
  const a: Differentiel[] = [];
  for (let i = 0; i < typeA.length; i += 8) a.push({ type: 'A', calibre: 40, circuits: typeA.slice(i, i + 8) });
  return [...a, ...ac];
}

// ---------- Câbles : montées et descentes ----------
/** Longueur verticale (m) pour rejoindre un équipement posé à `hauteur` cm, le câble passant par le plafond. */
export const montee = (hsp: number, hauteur: string | undefined) => {
  const h = Number(hauteur?.replace(',', '.'));
  return h > 0 && h / 100 < hsp ? hsp - h / 100 : 0;
};

// ---------- Chauffage ----------
// Puissance par m³ selon l'isolation : ordres de grandeur pour une pièce chauffée à 19-20 °C.
export const ISOLATIONS: Record<string, { nom: string; wm3: number }> = {
  bonne: { nom: 'Bonne (RT 2012 / RE 2020)', wm3: 25 },
  moyenne: { nom: 'Moyenne (rénovée)', wm3: 35 },
  faible: { nom: 'Faible (peu isolée)', wm3: 45 },
};
/** Puissance de chauffage conseillée (W), arrondie aux 50 W supérieurs. */
export const besoinChauffage = (aire: number, hsp: number, isolation: string) =>
  Math.ceil((aire * hsp * (ISOLATIONS[isolation] ?? ISOLATIONS.moyenne).wm3) / 50) * 50;

// ---------- Plomberie ----------
/** Diamètre d'alimentation conseillé selon le nombre de points d'eau desservis. */
export function diametreConseille(points: number): string {
  if (points <= 1) return 'multicouche 16 mm · cuivre 12 mm';
  if (points <= 3) return 'multicouche 20 mm · cuivre 14/16 mm';
  return 'multicouche 26 mm · cuivre 16/18 mm';
}

// ---------- Volumes de salle de bain ----------
export type Appareil = { x: number; y: number; rot: number; largeur: number; profondeur: number }; // centre, en pixels du plan

/** Volume du point p autour d'une baignoire ou douche : 1 au-dessus, 2 dans la bande de `marge` (60 cm) autour, 0 hors volumes. */
export function volume(p: { x: number; y: number }, a: Appareil, marge: number): 0 | 1 | 2 {
  const r = (-a.rot * Math.PI) / 180, dx = p.x - a.x, dy = p.y - a.y;
  const u = Math.abs(dx * Math.cos(r) - dy * Math.sin(r)), v = Math.abs(dx * Math.sin(r) + dy * Math.cos(r));
  if (u <= a.largeur / 2 && v <= a.profondeur / 2) return 1;
  if (u <= a.largeur / 2 + marge && v <= a.profondeur / 2 + marge) return 2;
  return 0;
}
