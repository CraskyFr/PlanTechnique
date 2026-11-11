// Calques techniques et bibliothèque de symboles.
// Chaque symbole est un tracé SVG dans une boîte 24×24, plus un texte centré optionnel.

export type Symbole = {
  calque: string;
  nom: string;
  d: string;
  texte?: string;
  mural?: number; // élément de mur (porte, fenêtre) : largeur par défaut en cm, dessiné à l'échelle et aimanté aux cloisons
  ancre?: number; // ordonnée de la ligne du mur dans la boîte (12 par défaut)
  masque?: string; // tracé rempli de blanc sous le symbole, pour « ouvrir » le mur
  libre?: boolean; // posé où l'on clique ; sinon plaqué contre le mur le plus proche, le haut du symbole côté mur
  hauteur?: number; // hauteur de pose proposée à la pose, en cm (modifiable dans Propriétés)
  dimensions?: [number, number]; // appareil dessiné à l'échelle : largeur et profondeur par défaut en cm
};

export const CALQUES = [
  { id: 'structure', nom: 'Structure', couleur: '#374151' },
  { id: 'elec', nom: 'Électricité', couleur: '#c2410c' },
  { id: 'reseau', nom: 'Réseau', couleur: '#15803d' },
  { id: 'eau', nom: 'Eau', couleur: '#1d4ed8' },
  { id: 'chauffage', nom: 'Chauffage', couleur: '#b91c1c' },
  { id: 'cotes', nom: 'Cotes manuelles', couleur: '#4b5563' },
];

// Câbles et tuyaux : polylignes. Les clés ne doivent pas reprendre celles de SYMBOLES (même palette d'outils).
export type TypeLiaison = {
  calque: string;
  nom: string;
  couleur: string;
  tirets?: number[];
  epaisseur?: number; // trait de structure : épaisseur par défaut en cm, dessinée à l'échelle
  horsLegende?: boolean; // absent de la légende et de la nomenclature
  cote?: boolean; // segment de mesure : deux points, flèches, longueur affichée
};

export const LIAISONS: Record<string, TypeLiaison> = {
  cloison: { calque: 'structure', nom: 'Cloison', couleur: '#374151', epaisseur: 7 },
  demolir: { calque: 'structure', nom: 'Cloison à démolir', couleur: '#dc2626', tirets: [3, 2], epaisseur: 10 },
  // Trait blanc opaque qui efface une partie du plan importé (mur supprimé, ancienne porte…).
  masque: { calque: 'structure', nom: 'Masque (effacer le fond)', couleur: '#ffffff', epaisseur: 25, horsLegende: true },
  cable: { calque: 'elec', nom: 'Câble électrique', couleur: '#c2410c' },
  cableRj: { calque: 'reseau', nom: 'Câble réseau', couleur: '#15803d' },
  tuyauAep: { calque: 'eau', nom: 'Tuyau eau potable', couleur: '#0891b2' },
  tuyauEf: { calque: 'eau', nom: 'Tuyau eau froide', couleur: '#2563eb' },
  tuyauEc: { calque: 'eau', nom: 'Tuyau eau chaude', couleur: '#dc2626' },
  tuyauEvac: { calque: 'eau', nom: "Tuyau d'évacuation", couleur: '#57534e', tirets: [4, 3] },
  chauffAller: { calque: 'chauffage', nom: 'Chauffage aller', couleur: '#b91c1c' },
  chauffRetour: { calque: 'chauffage', nom: 'Chauffage retour', couleur: '#1e40af', tirets: [4, 3] },
  cote: { calque: 'cotes', nom: 'Cote', couleur: '#4b5563', cote: true, horsLegende: true },
};

const CERCLE ='M3 12 a9 9 0 1 0 18 0 a9 9 0 1 0 -18 0';
const RECT = 'M2 6 H22 V18 H2 Z';
const CARRE = 'M3 3 H21 V21 H3 Z';

export const SYMBOLES: Record<string, Symbole> = {
  porte: { calque: 'structure', nom: 'Porte', d: 'M0 24 V0 A24 24 0 0 1 24 24', mural: 83, ancre: 24, masque: 'M0 22 H24 V26 H0 Z' },
  fenetre: { calque: 'structure', nom: 'Fenêtre', d: 'M0 10 H24 V14 H0 Z M0 12 H24', mural: 120, masque: 'M0 10 H24 V14 H0 Z' },
  // Ouverture sans menuiserie : seulement les deux tableaux ; sépare les pièces pour les cotes.
  passage: { calque: 'structure', nom: 'Passage', d: 'M0 8 V16 M24 8 V16', mural: 140 },

  // Hauteurs usuelles (axe du boîtier) : prises 30 cm, commandes 110 cm, thermostat 150 cm.
  prise16: { calque: 'elec', nom: 'Prise 16 A', d: 'M5 16 A7 7 0 0 1 19 16 M12 9 V3', hauteur: 30 },
  prise32: { calque: 'elec', nom: 'Prise 32 A', d: 'M3 15 A9 9 0 0 1 21 15 M12 6 V1', texte: '32' },
  inter: { calque: 'elec', nom: 'Interrupteur', d: 'M5 17 a3 3 0 1 0 6 0 a3 3 0 1 0 -6 0 M9.9 14.7 L18 5 L21 7.5', hauteur: 110 },
  vaetvient: {
    calque: 'elec',
    nom: 'Va-et-vient',
    d: 'M9 12 a3 3 0 1 0 6 0 a3 3 0 1 0 -6 0 M13.9 9.7 L19 3.5 L22 6 M10.1 14.3 L5 20.5 L2 18',
    hauteur: 110,
  },
  lumiere: {
    calque: 'elec',
    nom: 'Point lumineux',
    d: 'M4 12 a8 8 0 1 0 16 0 a8 8 0 1 0 -16 0 M6.3 6.3 L17.7 17.7 M17.7 6.3 L6.3 17.7',
    libre: true, // au plafond
  },
  spot: { calque: 'elec', nom: 'Spot encastré', d: 'M7 12 a5 5 0 1 0 10 0 a5 5 0 1 0 -10 0 M8.5 8.5 L15.5 15.5 M15.5 8.5 L8.5 15.5', libre: true },
  // Lave-linge, lave-vaisselle, four, sèche-linge… : un circuit dédié chacun.
  priseSpe: { calque: 'elec', nom: 'Prise spécialisée', d: 'M5 16 A7 7 0 0 1 19 16 M12 9 V3', texte: 'S', hauteur: 30 },
  priseExt: { calque: 'elec', nom: 'Prise extérieure', d: 'M5 16 A7 7 0 0 1 19 16 M12 9 V3', texte: 'EXT', hauteur: 30 },
  sortieCable: { calque: 'elec', nom: 'Sortie de câble', d: 'M12 2 V10 M6 10 H18 L12 20 Z' },
  voletRoulant: { calque: 'elec', nom: 'Commande volet roulant', d: RECT, texte: 'VR', hauteur: 110 },
  daaf: { calque: 'elec', nom: 'Détecteur de fumée', d: CERCLE, texte: 'DF', libre: true }, // obligatoire, au plafond
  compteur: { calque: 'elec', nom: 'Compteur', d: CARRE, texte: 'CPT' },
  tableau: { calque: 'elec', nom: 'Tableau électrique', d: 'M3 5 H21 V19 H3 Z M3 19 L21 5' },

  rj45: { calque: 'reseau', nom: 'Prise RJ45', d: RECT, texte: 'RJ45', hauteur: 30 },
  tv: { calque: 'reseau', nom: 'Prise TV', d: RECT, texte: 'TV', hauteur: 30 },
  baie: { calque: 'reseau', nom: 'Baie de brassage', d: CARRE, texte: 'BAIE' },
  interphone: { calque: 'reseau', nom: 'Interphone', d: RECT, texte: 'INT', hauteur: 150 },

  // Appareils sanitaires à l'échelle : ils définissent les volumes 1 et 2 de la salle de bain (NF C 15-100).
  baignoire: { calque: 'eau', nom: 'Baignoire', d: 'M0 0 H24 V24 H0 Z M3 3 H21 V21 H3 Z M17 12 a1.5 1.5 0 1 0 3 0 a1.5 1.5 0 1 0 -3 0', dimensions: [170, 70] },
  douche: { calque: 'eau', nom: 'Douche', d: 'M0 0 H24 V24 H0 Z M0 0 L24 24 M24 0 L0 24 M10.5 12 a1.5 1.5 0 1 0 3 0 a1.5 1.5 0 1 0 -3 0', dimensions: [90, 90] },
  // AEP (adduction d'eau potable) : arrivée du réseau public, robinet d'eau potable. « EP » désigne les eaux pluviales.
  aep: { calque: 'eau', nom: 'Eau potable', d: CERCLE, texte: 'AEP' },
  ef: { calque: 'eau', nom: 'Eau froide', d: CERCLE, texte: 'EF' },
  ec: { calque: 'eau', nom: 'Eau chaude', d: CERCLE, texte: 'EC' },
  evac: { calque: 'eau', nom: 'Évacuation', d: CERCLE, texte: 'EU' },
  chauffeeau: { calque: 'eau', nom: 'Chauffe-eau', d: CARRE, texte: 'CE' },
  vanne: { calque: 'eau', nom: 'Vanne', d: 'M4 6 L20 18 V6 L4 18 Z', libre: true }, // sur un tuyau

  radiateur: { calque: 'chauffage', nom: 'Radiateur', d: 'M2 8 H22 V16 H2 Z M7 8 V16 M12 8 V16 M17 8 V16' },
  pac: { calque: 'chauffage', nom: 'Pompe à chaleur', d: CARRE, texte: 'PAC' },
  chaudiere: { calque: 'chauffage', nom: 'Chaudière', d: CARRE, texte: 'CH' },
  thermostat: { calque: 'chauffage', nom: 'Thermostat', d: CERCLE, texte: 'T', hauteur: 150 },
  vmc: { calque: 'chauffage', nom: 'Bouche VMC', d: CERCLE, texte: 'VMC', libre: true }, // au plafond
  // Entrée d'air en haut de menuiserie (pièces sèches) : se plaque sous la fenêtre ou contre le mur.
  mortaise: { calque: 'chauffage', nom: 'Mortaise de ventilation', d: 'M2 9 H22 V15 H2 Z M6 9 V15 M10 9 V15 M14 9 V15 M18 9 V15' },
  // Unité extérieure de la pompe à chaleur : caisson et ventilateur, plaquée contre la façade.
  pacExt: { calque: 'chauffage', nom: 'Unité extérieure PAC', d: 'M2 4 H22 V20 H2 Z M7 12 a5 5 0 1 0 10 0 a5 5 0 1 0 -10 0 M12 7 V17 M7 12 H17' },
};
