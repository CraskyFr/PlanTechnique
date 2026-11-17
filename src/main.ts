import Konva from 'konva';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { CALQUES, LIAISONS, SYMBOLES } from './symboles.ts';
import { blanchir, masqueMurs, ouvertures, rectangles } from './detection.ts';
import { echelleDepuisCotes, effacerCotes } from './cotes.ts';
import { calculerCotes, type Analyse, type Salle, type Trait } from './cotesAuto.ts';
import { pdfDepuisJpeg, pdfDepuisJpegs } from './pdf.ts';
import { elevations, type Face, type Segment } from './elevation.ts';
import { dessinerElevation } from './dessinElevation.ts';
import { pdfUnifilaire } from './unifilaire.ts';
import { ecrirePrix, lirePrix, sauvegarde } from './stockage.ts';
import { annoncer, demanderAccord, demanderTexte } from './dialogues.ts';
import { ErreurEnLigne, enregistrerPlan, lirePlan, listerPlans, motDePasseRetenu, retenirMotDePasse, supprimerPlan } from './enLigne.ts';
import { router } from './routage.ts';
import { ISOLATIONS, besoinChauffage, diametreConseille, montee, protection, tableau, volume } from './calculs.ts';
import { nombre, Historique, TYPES_PIECES, aimanter, bilanCircuits, manquesPiece, reseaux, type Reseau, echelleDepuis, etageVide, lireProjet, longueur, nomenclature, type Etage, type Liaison, type Objet, type Point, type Props } from './etat.ts';


const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const B = 24; // côté de la boîte d'un symbole
const couleurs = Object.fromEntries(CALQUES.map((c) => [c.id, c.couleur]));
const estLiaison = (t: string | null): t is string => !!t && Object.hasOwn(LIAISONS, t);

// Champs du panneau Propriétés : [clé, libellé, valeur par défaut].
function champs(c: Objet | Liaison): string[][] {
  if ('points' in c) {
    if (LIAISONS[c.type].cote) return [];
    const e = LIAISONS[c.type].epaisseur;
    return e ? [['epaisseur', 'Épaisseur (cm)', String(e)]] : [['repere', 'Circuit / repère', ''], ['section', 'Section / diamètre', '']];
  }
  const s = SYMBOLES[c.type];
  if (s.mural) return [['largeur', 'Largeur (cm)', String(s.mural)]];
  if (s.dimensions) return [['largeur', 'Longueur (cm)', String(s.dimensions[0])], ['profondeur', 'Largeur (cm)', String(s.dimensions[1])]];
  return [
    ['hauteur', 'Hauteur de pose (cm)', ''],
    ['repere', 'Circuit / repère', ''],
    ...(s.calque === 'chauffage' && c.type === 'radiateur' ? [['puissance', 'Puissance (W)', '']] : []),
  ];
}

// Baignoire, douche : taille réelle en pixels du plan (null tant que l'échelle est inconnue).
function tailleAppareil(o: Objet): [number, number] | null {
  const d = SYMBOLES[o.type].dimensions, e = projet.echelle;
  return d && e ? [nombre(o.props.largeur, d[0]) / 100 / e, nombre(o.props.profondeur, d[1]) / 100 / e] : null;
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
const groupe = new Set<number>(); // sélection multiple (2 éléments ou plus) ; `selection` vaut alors null
const choisis = () => (groupe.size ? [...groupe] : selection !== null ? [selection] : []);
const RACCOURCIS: Record<string, string> = { p: 'prise16', i: 'inter', l: 'lumiere', c: 'cable', t: 'tuyauEf' }; // touche → outil
let relierDepuis: { id: number; type: string } | null = null; // tracé automatique en attente du clic sur l'équipement d'arrivée
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
  sauvegarderBientot();
}

// ---------- Sauvegarde automatique (IndexedDB du navigateur) ----------
// Une copie du projet est gardée à chaque modification ; au démarrage, un travail non enregistré est proposé à la reprise.
let minuterie = 0;
// ponytail: copie complète (fond compris) à chaque fois ; ne sauver que l'étage modifié si ça devient lent.
const sauvegarderMaintenant = () => (clearTimeout(minuterie), (minuterie = 0), sauvegarde({ texte: JSON.stringify({ etages }), date: Date.now(), enregistre: !modifie }).catch(() => {}));
function sauvegarderBientot() {
  clearTimeout(minuterie);
  minuterie = window.setTimeout(sauvegarderMaintenant, 1500);
}
// Onglet masqué ou fermé avant la fin du délai : la sauvegarde en attente part tout de suite.
document.addEventListener('visibilitychange', () => {
  if (document.hidden && minuterie) sauvegarderMaintenant();
});

function appliquer(s: string | null) {
  if (!s) return;
  // Supprimer un étage réinitialise l'historique : les instantanés restent donc alignés sur `etages`.
  (JSON.parse(s) as object[]).forEach((e, i) => etages[i] && Object.assign(etages[i], e));
  modifie = true;
  sauvegarderBientot();
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
  groupe.clear();
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
const COTES_AUTO = [{ id: 'cotesAuto', nom: 'Cotes automatiques', couleur: VIOLET }];

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
// Fantôme : le symbole suit la souris avant le clic, déjà plaqué au mur comme il sera posé.
const fantome = new Konva.Group({ listening: false, opacity: 0.4 });
const survol = new Konva.Group({ listening: false }); // contour de l'élément survolé, cadre de sélection
layer.add(reperes, fantome, attente, survol, tr);

// Translation de la sélection : les câbles restent accrochés aux équipements qui bougent avec eux, quittent les autres.
function deplacer(ids: number[], dx: number, dy: number) {
  const tenus = new Set(ids);
  for (const o of projet.objets) if (tenus.has(o.id)) (o.x += dx), (o.y += dy);
  for (const l of projet.liaisons) {
    if (!tenus.has(l.id)) continue;
    l.points = l.points.map((v, i) => v + (i % 2 ? dy : dx));
    if (l.debut !== undefined && !tenus.has(l.debut)) delete l.debut;
    if (l.fin !== undefined && !tenus.has(l.fin)) delete l.fin;
  }
  for (const o of projet.objets) if (tenus.has(o.id)) suivre(o);
}
// Pendant le glisser d'un élément du groupe, les autres suivent à l'écran.
function glisserGroupe(tenu: number, dx: number, dy: number) {
  if (!groupe.has(tenu)) return;
  for (const id of groupe) {
    if (id === tenu) continue;
    const o = projet.objets.find((o) => o.id === id);
    layer.findOne<Konva.Group>('#' + id)?.position(o ? { x: o.x + dx, y: o.y + dy } : { x: dx, y: dy });
  }
}
let majPoigneesAuRendu = () => {}; // branché plus bas, une fois le groupe des poignées créé

new ResizeObserver(() => stage.size({ width: conteneur.clientWidth, height: conteneur.clientHeight })).observe(conteneur);

// Dessin d'un symbole posé (ou de son aperçu avant confirmation).
function noeudSymbole(o: Objet): Konva.Group {
  const s = SYMBOLES[o.type];
  const couleur = couleurs[s.calque], k = projet.taille;
  // Élément de mur : la boîte fait sa largeur réelle une fois l'échelle calibrée.
  const appareil = tailleAppareil(o);
  let sc = s.mural && projet.echelle ? nombre(o.props.largeur, s.mural) / 100 / projet.echelle / B : k;
  // Une fenêtre large (baie) ne doit pas épaissir avec sa largeur : son épaisseur est plafonnée à 20 cm.
  let scY = s.mural && !s.ancre && projet.echelle ? Math.min(sc, 0.2 / projet.echelle / 4) : sc;
  if (appareil) [sc, scY] = [appareil[0] / B, appareil[1] / B]; // baignoire, douche : longueur et largeur réelles
  const g = new Konva.Group({ x: o.x, y: o.y, rotation: o.rot, offset: { x: B / 2, y: s.ancre ?? B / 2 }, scale: { x: o.props.miroir ? -sc : sc, y: scY } });
  g.add(new Konva.Rect({ width: B, height: B, fill: 'transparent' })); // zone cliquable pleine
  if (s.masque) g.add(new Konva.Path({ data: s.masque, fill: '#fff' }));
  if (appareil) {
    // Volume 2 de la salle de bain : 60 cm autour de l'appareil (pointillés bleus).
    const [mx, my] = [0.6 / projet.echelle! / sc, 0.6 / projet.echelle! / scY];
    g.add(new Konva.Rect({ x: -mx, y: -my, width: B + 2 * mx, height: B + 2 * my, stroke: '#0ea5e9', strokeWidth: 1.5, strokeScaleEnabled: false, dash: [6, 4], listening: false }));
    g.add(new Konva.Path({ data: s.d, stroke: couleur, strokeWidth: 1.5, strokeScaleEnabled: false }));
  } else g.add(new Konva.Path({ data: s.d, stroke: couleur, strokeWidth: (1.5 * k) / sc, lineCap: 'round', lineJoin: 'round' }));
  // Texte contre-pivoté : « RJ45 » reste lisible quel que soit le mur contre lequel la prise est plaquée.
  if (s.texte) g.add(new Konva.Text({ x: B / 2, y: B / 2, offset: { x: B / 2, y: B / 2 }, rotation: -o.rot, text: s.texte, width: B, height: B, align: 'center', verticalAlign: 'middle', fontSize: 7, fontStyle: 'bold', fill: couleur }));
  const texte = [o.props.repere, o.props.hauteur && `h${o.props.hauteur}`].filter(Boolean).join(' · ');
  // Étiquette contre-pivotée : elle reste horizontale, sous le symbole, quelle que soit sa rotation.
  if (texte) g.add(new Konva.Text({ x: B / 2, y: B / 2, rotation: -o.rot, width: 80, offset: { x: 40, y: -(B / 2 + 1) }, align: 'center', text: texte, fontSize: 5, fontStyle: 'bold', fill: couleur }));
  if (o.props.fait) g.add(pastilleFait(B, 0, (4 * k) / sc)); // même taille quelle que soit l'échelle du symbole
  return g;
}

// Réseaux de l'étage (tronçons reliés) : recalculés à chaque rendu, ils servent au panneau, aux Propriétés et à la surbrillance.
let reseauxCourants: Reseau[] = [];
const reseauDe = (id: number | null) => reseauxCourants.find((r) => id !== null && r.liaisons.includes(id));

function rendre() {
  for (const c of CALQUES) groupes[c.id].destroyChildren();
  tr.nodes([]);
  const k = projet.taille;
  reseauxCourants = reseaux(projet.liaisons, projet.objets, projet.echelle ? 0.03 / projet.echelle : 3); // piquage à 3 cm près
  const reseauSelectionne = reseauDe(selection);

  // Liaisons d'abord : les symboles restent au-dessus des câbles et tuyaux.
  for (const l of projet.liaisons) {
    const t = LIAISONS[l.type];
    const g = new Konva.Group({ name: 'objet', id: String(l.id), draggable: true });
    const style = styleLiaison(l.type, l.props);
    const trait = { points: l.points, ...style, hitStrokeWidth: Math.max(style.strokeWidth, 12 / stage.scaleX()), shadowColor: '#2563eb', shadowBlur: 5 * k, shadowEnabled: l.id === selection || groupe.has(l.id) || !!reseauSelectionne?.liaisons.includes(l.id) }; // tout le réseau en surbrillance
    g.add(t.cote ? new Konva.Arrow({ ...trait, pointerAtBeginning: true, pointerLength: 3 * k, pointerWidth: 3 * k, fill: t.couleur }) : new Konva.Line(trait));
    const texte = t.cote ? (projet.echelle ? `${metres(longueur(l.points))} m` : 'non calibré') : [l.props.repere, l.props.section].filter(Boolean).join(' · ');
    if (texte) g.add(new Konva.Text({ x: (l.points[0] + l.points[2]) / 2 + 2 * k, y: (l.points[1] + l.points[3]) / 2 + 2 * k, text: texte, fontSize: 5 * k, fontStyle: 'bold', fill: t.couleur }));
    if (l.props.fait) g.add(pastilleFait((l.points[0] + l.points[2]) / 2, (l.points[1] + l.points[3]) / 2, 4 * k));
    g.on('dragmove', () => glisserGroupe(l.id, g.x(), g.y()));
    g.on('dragend', () => {
      // Déplacé seul, le câble quitte ses équipements ; en groupe, il reste accroché à ceux qui bougent avec lui.
      deplacer(groupe.has(l.id) ? [...groupe] : [l.id], g.x(), g.y());
      valider();
      setTimeout(rendre);
    });
    groupes[t.calque].add(g);
  }

  for (const o of projet.objets) {
    const g = noeudSymbole(o);
    g.setAttrs({ name: 'objet', id: String(o.id), draggable: true });
    // Pendant le glisser, l'élément se cale en direct comme à la pose : contre le mur, ou dans la cloison
    // pour une porte ou une fenêtre. Ses textes restent à l'horizontale.
    g.on('dragmove', () => {
      if (groupe.has(o.id)) return glisserGroupe(o.id, g.x() - o.x, g.y() - o.y); // en groupe : translation pure, sans calage
      const t = { ...o, x: g.x(), y: g.y() };
      caler(t);
      g.setAttrs({ x: t.x, y: t.y, rotation: t.rot });
      for (const texte of g.find('Text')) texte.rotation(-t.rot);
      suivre(t); // les câbles accrochés suivent en direct
    });
    g.on('dragend transformend', (ev) => {
      if (ev.type === 'dragend' && groupe.has(o.id)) {
        deplacer([...groupe], g.x() - o.x, g.y() - o.y);
        valider();
        return void setTimeout(rendre);
      }
      Object.assign(o, { x: g.x(), y: g.y(), rot: g.rotation() });
      // Une rotation à la poignée est respectée ; seule une porte ou fenêtre se réaligne sur sa cloison.
      if (ev.type === 'dragend') caler(o);
      else aimanterObjet(o);
      suivre(o);
      valider();
      setTimeout(rendre);
    });
    groupes[SYMBOLES[o.type].calque].add(g);
    if (o.id === selection || groupe.has(o.id)) tr.nodes([...tr.nodes(), g]);
  }
  tr.rotateEnabled(!groupe.size); // un groupe se déplace, il ne pivote pas
  survol.destroyChildren();
  $('bulle').hidden = true;

  rendreCotesAuto();
  rendreLegende();
  majPoigneesAuRendu();
  majCircuits();
  majPieces();
  majAvancement();
  majReseaux();
  majMetre();
  // Accueil tant que l'étage est vide ; nombre d'alertes sur l'onglet Vérifier, pour qu'on aille voir.
  $('accueil').hidden = !!projet.fond || !!projet.objets.length || !!projet.liaisons.length;
  const alertes = document.querySelectorAll('#onglet-verifier .alerte').length;
  $('nb-alertes').hidden = !alertes;
  $('nb-alertes').textContent = String(alertes);
  // Prises et commandes interdites dans les volumes de salle de bain : cerclées de rouge.
  for (const { o } of horsVolumes()) groupes.elec.add(new Konva.Circle({ x: o.x, y: o.y, radius: B * k * 0.8, stroke: '#dc2626', strokeWidth: 0.6 * k, listening: false }));
  layer.batchDraw();
  $<HTMLInputElement>('taille').value = String(k);
  layer.draw(); // synchrone : les nouveaux nœuds sont cliquables tout de suite, sans attendre la prochaine frame
  majStatut();
}

// ---------- Cotes automatiques ----------
let cotesCache: ({ cle: string } & Analyse) | null = null;

// Pièces, portes, fenêtres et cloisons, toutes dans le calque « Cotes automatiques ».
function rendreCotesAuto() {
  groupes.cotesAuto.destroyChildren();
  if (!projet.echelle) return void (cotesCache = null); // sans échelle, pas de centimètres à afficher
  const e = projet.echelle;
  const cloisons = projet.liaisons.filter((l) => l.type === 'cloison');
  const ouvertures = projet.objets.filter((o) => SYMBOLES[o.type].mural);
  // Recalcul seulement quand la structure change : poser une prise ne refait pas la détection des pièces.
  const cle = JSON.stringify([e, cloisons, ouvertures]);
  if (cotesCache?.cle !== cle) cotesCache = { cle, ...calculerCotes(cloisons, ouvertures, e) };
  for (const t of cotesCache.traits) dessinerCote(groupes.cotesAuto, t);
  // Repère de chaque pièce (P1, P2…), avec son type s'il est choisi dans le panneau Pièces.
  for (const s of cotesCache.salles) {
    const type = typePiece(s);
    const etiquette = new Konva.Label({ x: s.x, y: s.y + 0.25 / e });
    etiquette.add(
      new Konva.Tag({ fill: VIOLET, cornerRadius: 0.06 / e }),
      new Konva.Text({ text: `P${s.num}${type ? ' · ' + TYPES_PIECES[type] : ''}`, fontSize: 0.16 / e, fontStyle: 'bold', fill: '#fff', padding: 0.04 / e }),
    );
    etiquette.offsetX(etiquette.width() / 2);
    groupes.cotesAuto.add(etiquette);
  }
}

const typePiece = (s: Salle) => projet.pieces?.find((p) => cotesCache?.numero(p.x, p.y) === s.num)?.type;

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
  $('statut').textContent = relierDepuis
    ? `Relier : cliquez l'équipement d'arrivée, le ${LIAISONS[relierDepuis.type].nom.toLowerCase()} sera tracé le long des murs (Échap pour annuler)`
    : calib
    ?`Calibration : cliquez le ${calib.length ? 'second' : 'premier'} point d'une distance connue (Échap pour annuler)`
    : estLiaison(outil)
      ? `Tracé : ${LIAISONS[outil].nom} — cliquez les points (Maj = horizontal/vertical) ; un clic sur un équipement s'y accroche et enchaîne vers le suivant ; Entrée ou re-clic pour terminer`
      : outil
        ? `Pose : ${SYMBOLES[outil].nom}${SYMBOLES[outil].libre || SYMBOLES[outil].mural ? '' : ' (se plaque au mur le plus proche)'} — cliquez, puis ✓, clic sur l'aperçu ou Entrée pour valider · R pivote · Échap annule`
        : 'Sélection — glisser pour déplacer, R pour pivoter, Suppr pour effacer, molette pour zoomer';
  conteneur.style.cursor = calib || outil || relierDepuis ? 'crosshair' : 'default';
  for (const b of $('palette').querySelectorAll('button')) b.classList.toggle('actif', b.dataset.type === outil);
}

function changerMode(nouvelOutil: string | null, calibration = false) {
  outil = nouvelOutil;
  calib = calibration ? [] : null;
  relierDepuis = null;
  trace = [];
  rotPose = 0;
  reperes.destroyChildren();
  annulerAttente();
  majFantome(null);
  majStatut();
}

// ---------- Pose d'un symbole : clic = aperçu, ✓ / clic sur l'aperçu / Entrée = ajout ----------
let enAttente: Objet | null = null;
let rotPose = 0; // rotation choisie avec R pour les symboles posés librement (point lumineux, vanne)

// L'objet tel qu'il serait posé en p : porte et fenêtre sur la cloison, prise, interrupteur, RJ45… contre le mur.
function objetPose(p: Point): Objet {
  const s = SYMBOLES[outil!];
  const o: Objet = { id: 0, type: outil!, x: p.x, y: p.y, rot: rotPose, props: s.hauteur ? { hauteur: String(s.hauteur) } : {} };
  // Circuit choisi dans le panneau Circuits : affecté d'office aux équipements électriques posés.
  const circuit = $<HTMLInputElement>('circuit').value.trim();
  if (circuit && s.calque === 'elec') o.props.repere = circuit;
  caler(o);
  return o;
}

// ---------- Petites aides pour les panneaux ----------
const element = (balise: string, texte = '', classe = '') => {
  const el = document.createElement(balise);
  if (texte) el.textContent = texte;
  if (classe) el.className = classe;
  return el;
};
const hsp = (et: Etage = projet) => et.hsp ?? 2.5;
const surfaceLogement = () => cotesCache?.salles.reduce((s, x) => s + x.aire, 0) || 50;

// Longueur d'un tronçon en mètres, montées et descentes vers ses équipements comprises (câble passant par le plafond).
function metresAvecMontees(l: Liaison, et: Etage = projet): number {
  const e = et.echelle;
  if (!e) return 0;
  const vertical = [l.debut, l.fin].reduce<number>((s, id) => s + (id === undefined ? 0 : montee(hsp(et), et.objets.find((o) => o.id === id)?.props.hauteur)), 0);
  return longueur(l.points) * e + vertical;
}
const m2 = (v: number) => v.toFixed(2).replace('.', ',');

// ---------- Circuits électriques et tableau ----------
// Bilan par circuit de l'étage, protection conseillée, et tableau proposé (différentiels 30 mA).
// Un clic sur un circuit le choisit pour les poses suivantes.
function majCircuits() {
  const circuits = bilanCircuits(projet.objets);
  const lignes = circuits.map((c) => {
    const li = element('li');
    const detail = [c.prises && `${c.prises} prise${c.prises > 1 ? 's' : ''}`, c.eclairage && `${c.eclairage} éclairage${c.eclairage > 1 ? 's' : ''}`, c.dedies && `${c.dedies} spécialisée${c.dedies > 1 ? 's' : ''}`, c.autres && `${c.autres} autre${c.autres > 1 ? 's' : ''}`].filter(Boolean).join(' · ');
    const p = c.nom ? protection(c) : null;
    li.append(element('strong', (c.nom || 'Sans circuit') + (c.nom ? (c.alertes.length ? ' ⚠' : ' ✓') : '')), ` ${detail}`);
    if (p) li.append(element('div', `Disjoncteur ${p.calibre} A · câble ${p.section}`, 'protection'));
    for (const a of c.alertes) li.append(element('div', a, 'alerte'));
    if (p?.conseil) li.append(element('div', `→ ${p.conseil}`, 'conseil'));
    if (c.nom) {
      li.tabIndex = 0;
      li.title = 'Utiliser ce circuit pour les prochaines poses';
      li.onclick = () => (($<HTMLInputElement>('circuit').value = c.nom), afficherOnglet('dessiner'), majFantome(null));
    }
    return li;
  });
  // Sans circuit nommé, pas de tableau à proposer : on explique comment en créer un.
  const nommes = circuits.some((c) => c.nom);
  $('b-unifilaire').hidden = !nommes;
  if (!nommes)
    return $('circuits').replaceChildren(
      ...lignes,
      element('li', 'Pour obtenir le bilan et le tableau : dans l\'onglet Dessiner, saisissez un circuit (ex. C1) puis posez prises et éclairages, ou renseignez « Circuit / repère » dans Propriétés.', 'conseil'),
    );
  const diffs = tableau(circuits, surfaceLogement());
  $('circuits').replaceChildren(
    ...lignes,
    element('li', `Tableau proposé (${Math.round(surfaceLogement())} m²)`, 'titre'),
    ...diffs.map((d) => element('li', `Interrupteur différentiel ${d.calibre} A 30 mA type ${d.type} : ${d.circuits.join(', ') || 'réserve'}`)),
  );
}

// Schéma unifilaire du tableau proposé, en PDF A4 (dessiné sur un canevas, puis embarqué en JPEG).
async function schemaUnifilaire() {
  const circuits = bilanCircuits(projet.objets).filter((c) => c.nom);
  if (!circuits.length) return annoncer('Aucun circuit : renseignez « Circuit / repère » sur les équipements électriques.');
  const pdf = await pdfUnifilaire(circuits, surfaceLogement(), projet.nom);
  if (!pdf) return;
  const url = URL.createObjectURL(pdf);
  telecharger(url, nomFichier('pdf').replace('plan-', 'schema-unifilaire-'));
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- Volumes de salle de bain ----------
const INTERDITS_VOLUMES = ['prise16', 'prise32', 'priseSpe', 'priseExt', 'inter', 'vaetvient', 'voletRoulant', 'tableau'];
// Prises et commandes posées dans le volume 1 ou 2 d'une baignoire ou d'une douche.
function horsVolumes(): { o: Objet; appareil: Objet; volume: 1 | 2 }[] {
  if (!projet.echelle) return [];
  const marge = 0.6 / projet.echelle;
  return projet.objets.flatMap((appareil) => {
    const t = tailleAppareil(appareil);
    if (!t) return [];
    return projet.objets
      .filter((o) => INTERDITS_VOLUMES.includes(o.type))
      .map((o) => ({ o, appareil, volume: volume(o, { x: appareil.x, y: appareil.y, rot: appareil.rot, largeur: t[0], profondeur: t[1] }, marge) }))
      .filter((v): v is { o: Objet; appareil: Objet; volume: 1 | 2 } => v.volume > 0);
  });
}

// ---------- Vérification par pièce ----------
// Pour chaque pièce détectée : type, équipements, ce qui manque d'après la norme, et puissance de chauffage conseillée.
function majPieces() {
  const liste = $('pieces');
  const isolation = projet.isolation ?? 'moyenne';
  const entete = element('li');
  const choixIsolation = document.createElement('select');
  choixIsolation.setAttribute('aria-label', 'Isolation du logement');
  choixIsolation.append(...Object.entries(ISOLATIONS).map(([v, i]) => new Option(i.nom, v, false, v === isolation)));
  choixIsolation.onchange = () => ((projet.isolation = choixIsolation.value), valider(), rendre());
  entete.append('Isolation : ', choixIsolation);
  const daaf = etages.some((et) => et.objets.some((o) => o.type === 'daaf'));
  // Alerte seulement une fois l'électricité commencée : pas de bruit sur un projet vide.
  const elecCommencee = etages.some((et) => et.objets.some((o) => SYMBOLES[o.type].calque === 'elec'));
  const globales = [element('li', daaf ? 'Détecteur de fumée ✓' : 'Aucun détecteur de fumée (1 obligatoire par logement)', daaf || !elecCommencee ? '' : 'alerte')];
  for (const v of horsVolumes())
    globales.push(element('li', `${SYMBOLES[v.o.type].nom} dans le volume ${v.volume} de la ${SYMBOLES[v.appareil.type].nom.toLowerCase()} : interdit, à déplacer (repéré en rouge).`, 'alerte'));
  if (!cotesCache?.salles.length) {
    return liste.replaceChildren(entete, ...globales, element('li', projet.echelle ? 'Aucune pièce fermée détectée.' : 'Échelle inconnue : pièces non détectées.'));
  }
  const { salles, numero } = cotesCache;
  liste.replaceChildren(
    entete,
    ...globales,
    ...salles.map((s) => {
      const dedans = projet.objets.filter((o) => numero(o.x, o.y) === s.num);
      const n = (...types: string[]) => dedans.filter((o) => types.includes(o.type)).length;
      const eq = { prises: n('prise16'), eclairage: n('lumiere', 'spot'), rj45: n('rj45'), prise32: n('prise32') };
      const type = typePiece(s) ?? '';
      const li = element('li');
      const choix = document.createElement('select');
      choix.setAttribute('aria-label', `Type de la pièce P${s.num}`);
      choix.append(new Option('Type…', ''), ...Object.entries(TYPES_PIECES).map(([v, nom]) => new Option(nom, v, false, v === type)));
      choix.onchange = () => {
        projet.pieces = (projet.pieces ?? []).filter((p) => numero(p.x, p.y) !== s.num);
        if (choix.value) projet.pieces.push({ x: s.x, y: s.y, type: choix.value });
        valider();
        rendre();
      };
      const manques = type ? manquesPiece(type, s.aire, eq) : [];
      const besoin = besoinChauffage(s.aire, hsp(), isolation);
      const radiateurs = dedans.filter((o) => o.type === 'radiateur');
      const installe = radiateurs.reduce((t, o) => t + nombre(o.props.puissance, 0), 0);
      li.append(
        element('strong', `P${s.num} · ${s.aire.toFixed(1).replace('.', ',')} m²${type ? (manques.length ? ' ⚠' : ' ✓') : ''}`),
        choix,
        element('div', `${eq.prises} prise(s) · ${eq.eclairage} éclairage(s) · ${eq.rj45} RJ45`),
        element('div', `Chauffage : besoin ≈ ${besoin.toLocaleString('fr-FR')} W${radiateurs.length ? ` · radiateurs ${installe.toLocaleString('fr-FR')} W` : ''}`, radiateurs.length && installe < besoin ? 'alerte' : ''),
        ...manques.map((m) => element('div', `Manque : ${m}`, 'alerte')),
      );
      if (radiateurs.length && installe < besoin) li.append(element('div', '→ Renseignez la puissance des radiateurs (Propriétés) ou ajoutez-en.', 'conseil'));
      return li;
    }),
  );
}

// ---------- Réseaux ----------
// Longueur de chaque réseau (câbles ou tuyaux reliés), à plat et avec les montées vers les équipements,
// et diamètre conseillé pour l'eau. Un clic sélectionne le réseau et le met en surbrillance.
function majReseaux() {
  const liste = $('reseaux');
  const entete = element('li');
  const champ = document.createElement('input');
  Object.assign(champ, { type: 'number', min: '1.8', max: '6', step: '0.05', value: String(hsp()) });
  champ.setAttribute('aria-label', 'Hauteur sous plafond en mètres');
  champ.onchange = () => {
    const v = Number(champ.value);
    if (v >= 1.8 && v <= 6) (projet.hsp = v), valider(), rendre();
  };
  entete.append('Hauteur sous plafond (m) ', champ);
  if (!reseauxCourants.length) return liste.replaceChildren(entete, element('li', 'Aucun câble ni tuyau tracé.'));
  liste.replaceChildren(
    entete,
    ...reseauxCourants.map((r) => {
      const t = LIAISONS[r.type];
      const li = element('li');
      li.tabIndex = 0;
      li.style.color = t.couleur;
      li.classList.toggle('actif', !!reseauDe(selection) && reseauDe(selection) === r);
      const total = r.liaisons.reduce((s, id) => s + metresAvecMontees(projet.liaisons.find((l) => l.id === id)!), 0);
      li.append(
        `${t.nom}${r.circuits.length ? ' · ' + r.circuits.join(', ') : ''} · ${r.liaisons.length} tronçon${r.liaisons.length > 1 ? 's' : ''} · `,
        element('strong', projet.echelle ? `${m2(total)} m` : 'échelle inconnue'),
      );
      if (projet.echelle && total - r.longueur * projet.echelle > 0.005) li.append(element('div', `dont ${m2(total - r.longueur * projet.echelle)} m de montées (à plat : ${metres(r.longueur)} m)`, 'protection'));
      if (t.calque === 'eau' && r.type !== 'tuyauEvac') {
        const points = new Set(projet.liaisons.filter((l) => r.liaisons.includes(l.id)).flatMap((l) => [l.debut, l.fin]).filter((id) => id !== undefined));
        if (points.size) li.append(element('div', `${points.size} point(s) d'eau · Ø conseillé : ${diametreConseille(points.size)}`, 'protection'));
      }
      li.onclick = () => selectionner(r.liaisons[0]);
      return li;
    }),
  );
}

// ---------- Métré et devis ----------
// Quantités de tout le projet (équipements à l'unité, câbles et tuyaux au mètre, montées comprises) ;
// prix unitaires saisis par l'utilisateur, gardés dans ce navigateur.

type LigneMetre = { type: string; nom: string; calque: string; quantite: number; unite: 'u' | 'm' };
function lignesMetre(): LigneMetre[] {
  const lignes = new Map<string, LigneMetre>();
  for (const et of etages) {
    for (const o of et.objets) {
      const s = SYMBOLES[o.type];
      if (s.calque === 'structure') continue; // l'existant du plan importé n'est pas à chiffrer
      const l = lignes.get(o.type) ?? { type: o.type, nom: s.nom, calque: s.calque, quantite: 0, unite: 'u' };
      l.quantite++;
      lignes.set(o.type, l);
    }
    for (const li of et.liaisons) {
      const t = LIAISONS[li.type];
      if (t.calque === 'structure' || t.cote) continue;
      const l = lignes.get(li.type) ?? { type: li.type, nom: t.nom, calque: t.calque, quantite: 0, unite: 'm' };
      l.quantite += metresAvecMontees(li, et);
      lignes.set(li.type, l);
    }
  }
  const ordre = CALQUES.map((c) => c.id);
  return [...lignes.values()].sort((a, b) => ordre.indexOf(a.calque) - ordre.indexOf(b.calque) || a.nom.localeCompare(b.nom));
}

const euros = (v: number) => v.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
function majMetre() {
  const prix = lirePrix();
  const lignes = lignesMetre();
  if (!lignes.length) return $('metre').replaceChildren(element('li', 'Rien à chiffrer pour le moment.'));
  let total = 0;
  const items = lignes.map((l) => {
    const li = element('li', '', 'ligne-metre');
    const champ = document.createElement('input');
    Object.assign(champ, { type: 'number', min: '0', step: '0.01', value: prix[l.type] ? String(prix[l.type]) : '', placeholder: `€/${l.unite}` });
    champ.setAttribute('aria-label', `Prix unitaire : ${l.nom}`);
    champ.onchange = () => {
      const p = lirePrix();
      if (Number(champ.value) > 0) p[l.type] = Number(champ.value);
      else delete p[l.type];
      ecrirePrix(p);
      majMetre();
    };
    const montant = (prix[l.type] ?? 0) * l.quantite;
    total += montant;
    li.append(element('span', `${l.nom} : ${l.unite === 'm' ? m2(l.quantite) + ' m' : l.quantite + ' u'}`), champ, element('span', montant ? euros(montant) : '', 'montant'));
    return li;
  });
  $('metre').replaceChildren(...items, element('li', `Total estimé : ${euros(total)} (tous étages)`, 'titre'));
}

function exporterDevis() {
  const prix = lirePrix();
  const cellule = (c: string) => `"${(/^[=+\-@]/.test(c) ? "'" + c : c).replaceAll('"', '""')}"`;
  const lignes = [['Corps de métier', 'Élément', 'Quantité', 'Unité', 'Prix unitaire (€)', 'Montant (€)']];
  let total = 0;
  for (const l of lignesMetre()) {
    const p = prix[l.type] ?? 0, montant = p * l.quantite;
    total += montant;
    lignes.push([CALQUES.find((c) => c.id === l.calque)?.nom ?? l.calque, l.nom, l.unite === 'm' ? m2(l.quantite) : String(l.quantite), l.unite, p ? m2(p) : '', montant ? m2(montant) : '']);
  }
  lignes.push(['', 'Total', '', '', '', m2(total)]);
  const url = URL.createObjectURL(new Blob(['﻿' + lignes.map((l) => l.map(cellule).join(';')).join('\r\n')], { type: 'text/csv' }));
  telecharger(url, 'devis-estimatif.csv');
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- Suivi de chantier ----------
// Pastille verte sur ce qui est posé (case « Fait » des Propriétés, ou touche F) et avancement par corps de métier.
function pastilleFait(x: number, y: number, r: number) {
  const g = new Konva.Group({ x, y, listening: false });
  g.add(
    new Konva.Circle({ radius: r, fill: '#16a34a', stroke: '#fff', strokeWidth: r * 0.2 }),
    new Konva.Line({ points: [-0.45 * r, 0, -0.1 * r, 0.35 * r, 0.5 * r, -0.35 * r], stroke: '#fff', strokeWidth: r * 0.25, lineCap: 'round', lineJoin: 'round' }),
  );
  return g;
}

function majAvancement() {
  $('avancement').replaceChildren(
    ...CALQUES.filter((c) => !['structure', 'cotes'].includes(c.id)).flatMap((c) => {
      const elements = [...projet.objets.filter((o) => SYMBOLES[o.type].calque === c.id), ...projet.liaisons.filter((l) => LIAISONS[l.type].calque === c.id)];
      if (!elements.length) return [];
      const faits = elements.filter((x) => x.props.fait).length, pct = Math.round((100 * faits) / elements.length);
      const li = document.createElement('li');
      li.style.color = c.couleur;
      li.textContent = `${c.nom} : ${faits} / ${elements.length} (${pct} %)`;
      const barre = document.createElement('progress');
      barre.max = elements.length;
      barre.value = faits;
      li.append(barre);
      return [li];
    }),
  );
}

// ---------- Copier, coller, dupliquer ----------
let pressePapiers: Objet | Liaison | null = null;

// Copie de l'élément posée en p (ou décalée d'un symbole) ; décrochée de ses équipements, puis sélectionnée.
function coller(source: Objet | Liaison, p: Point | null) {
  const copie: Objet | Liaison = structuredClone(source);
  copie.id = nouvelId();
  const pas = B * projet.taille;
  if ('points' in copie) {
    const [dx, dy] = p ? [p.x - copie.points[0], p.y - copie.points[1]] : [pas, pas];
    copie.points = copie.points.map((v, i) => v + (i % 2 ? dy : dx));
    delete copie.debut;
    delete copie.fin;
    projet.liaisons.push(copie);
  } else {
    Object.assign(copie, p ?? { x: copie.x + pas, y: copie.y + pas });
    caler(copie);
    projet.objets.push(copie);
  }
  valider();
  selectionner(copie.id);
}

// Calage commun à la pose et au déplacement.
function caler(o: Objet) {
  const s = SYMBOLES[o.type];
  if (s.mural) aimanterObjet(o);
  else if (!s.libre) plaquerAuMur(o);
}

// Contre la face du mur le plus proche (s'il est à moins d'un symbole et demi), le haut du symbole tourné vers le mur.
function plaquerAuMur(o: Objet) {
  const murs = projet.liaisons.filter((l) => l.type === 'cloison').map((l) => ({ points: l.points, demi: styleLiaison('cloison', l.props).strokeWidth / 2 }));
  // Sous une fenêtre aussi (prise sous allège) : elle prolonge le mur, à l'épaisseur du mur qui la porte.
  const e = projet.echelle;
  if (e)
    for (const f of projet.objets.filter((f) => f.type === 'fenetre')) {
      const L = nombre(f.props.largeur, SYMBOLES.fenetre.mural!) / 100 / e / 2, a = (f.rot * Math.PI) / 180;
      const [ux, uy] = [Math.cos(a), Math.sin(a)];
      const tableau = aimanter({ x: f.x + ux * (L + 2), y: f.y + uy * (L + 2) }, murs.map((m) => m.points), 3);
      murs.push({ points: [f.x - ux * L, f.y - uy * L, f.x + ux * L, f.y + uy * L], demi: tableau ? murs[tableau.indice].demi : 0.1 / e });
    }
  const a = aimanter(o, murs.map((m) => m.points), Infinity);
  if (!a) return;
  const k = projet.taille, demi = murs[a.indice].demi;
  // Baignoire, douche : plaquées par leur grand côté, à leur vraie profondeur.
  const profondeur = tailleAppareil(o)?.[1] ?? B * k;
  if (Math.hypot(o.x - a.x, o.y - a.y) > demi + Math.max(1.5 * B * k, profondeur)) return; // loin des murs : posé tel quel
  const rad = (a.angle * Math.PI) / 180;
  let [nx, ny] = [-Math.sin(rad), Math.cos(rad)]; // normale au mur, orientée du côté du clic
  if ((o.x - a.x) * nx + (o.y - a.y) * ny < 0) [nx, ny] = [-nx, -ny];
  const recul = demi + profondeur / 2;
  Object.assign(o, { x: a.x + nx * recul, y: a.y + ny * recul, rot: ((Math.atan2(-nx, ny) * 180) / Math.PI + 360) % 360 });
}

function majFantome(p: Point | null) {
  fantome.destroyChildren();
  if (p && outil && !estLiaison(outil) && !calib && !enAttente) fantome.add(noeudSymbole(objetPose(p)));
}

function proposer(p: Point) {
  enAttente = objetPose(p);
  majFantome(null);
  afficherAttente();
}

function afficherAttente() {
  attente.destroyChildren();
  if (!enAttente) return;
  const apercu = noeudSymbole(enAttente);
  apercu.setAttrs({ name: 'valider', opacity: 0.6 }); // cliquer l'aperçu le valide aussi : une cible plus grande que ✓
  apercu.on('mouseenter', () => (conteneur.style.cursor = 'pointer'));
  apercu.on('mouseleave', majStatut);
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
  groupe.clear();
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

// q : point visé ; accroche : il tombe sur un équipement (repère vert).
function majApercu(q: Point, accroche: Accroche = false) {
  reperes.destroyChildren();
  // Un masque blanc serait invisible pendant le tracé : aperçu en gris.
  if (trace.length) reperes.add(new Konva.Line({ points: [...trace, q.x, q.y], ...styleLiaison(outil!, {}), ...(outil === 'masque' && { stroke: '#9ca3af' }), opacity: 0.6 }));
  if (trace.length && projet.echelle) {
    // Longueur du segment en cours (et du tracé entier) à côté du curseur.
    const segment = metres(longueur([...trace.slice(-2), q.x, q.y])), s = 1 / stage.scaleX();
    const etiquette = new Konva.Label({ x: q.x + 14 * s, y: q.y + 14 * s, scale: { x: s, y: s } });
    etiquette.add(new Konva.Tag({ fill: '#111827', opacity: 0.85, cornerRadius: 4 }));
    etiquette.add(new Konva.Text({ text: trace.length > 2 ? `${segment} m · total ${metres(longueur([...trace, q.x, q.y]))} m` : `${segment} m`, fontSize: 12, padding: 4, fill: '#fff' }));
    reperes.add(etiquette);
  }
  // Repère vert : sur un équipement ; bleu : sur un tronçon existant (piquage).
  if (accroche) reperes.add(new Konva.Circle({ x: q.x, y: q.y, radius: 9 / stage.scaleX(), stroke: accroche === 'equipement' ? '#16a34a' : '#2563eb', strokeWidth: 3 / stage.scaleX() }));
}

type Accroche = false | 'equipement' | 'reseau';

// Point visé pendant un tracé : centre d'un équipement, sinon point d'un tronçon du même type (dérivation, piquage),
// sinon le point cliqué.
function viser(p: Point, ortho: boolean): { q: Point; accroche: Accroche } {
  const libre = pointTrace(p, ortho);
  const equipement = equipementProche(libre, outil!);
  if (equipement) return { q: { x: equipement.x, y: equipement.y }, accroche: 'equipement' };
  const t = LIAISONS[outil!];
  if (!t.epaisseur && !t.cote) {
    const a = aimanter(libre, projet.liaisons.filter((l) => l.type === outil).map((l) => l.points), 8 / stage.scaleX());
    if (a) return { q: { x: a.x, y: a.y }, accroche: 'reseau' };
  }
  return { q: libre, accroche: false };
}

function terminerTrace() {
  if (trace.length >= 4) {
    // Extrémités posées sur un équipement : la liaison y reste accrochée et le suivra.
    const sur = (x: number, y: number) => projet.objets.find((o) => o.x === x && o.y === y && SYMBOLES[o.type].calque === LIAISONS[outil!].calque)?.id;
    const debut = sur(trace[0], trace[1]), fin = sur(trace[trace.length - 2], trace[trace.length - 1]);
    projet.liaisons.push({ id: nouvelId(), type: outil!, points: trace, props: {}, ...(debut !== undefined && { debut }), ...(fin !== undefined && { fin }) });
    valider();
  }
  trace = [];
  reperes.destroyChildren();
  rendre();
}

// ---------- Accrochage des câbles et tuyaux aux équipements ----------
// Équipement du même corps de métier (câble → électricité, tuyau → eau…) dont le centre est à portée de p.
function equipementProche(p: Point, typeLiaison: string): Objet | null {
  const t = LIAISONS[typeLiaison];
  if (t.calque === 'structure' || t.cote) return null;
  let meilleur: Objet | null = null, dMin = Math.max((B / 2) * projet.taille, 10 / stage.scaleX());
  for (const o of projet.objets) {
    const d = Math.hypot(o.x - p.x, o.y - p.y);
    if (SYMBOLES[o.type].calque === t.calque && d <= dMin) [meilleur, dMin] = [o, d];
  }
  return meilleur;
}

// Recale les extrémités accrochées à cet équipement, et leur dessin s'il est affiché (pendant un glisser).
function suivre(o: Objet) {
  for (const l of projet.liaisons) {
    if (l.debut !== o.id && l.fin !== o.id) continue;
    if (l.debut === o.id) l.points.splice(0, 2, o.x, o.y);
    if (l.fin === o.id) l.points.splice(-2, 2, o.x, o.y);
    layer.findOne<Konva.Group>('#' + l.id)?.findOne<Konva.Line>('Line')?.points(l.points.slice());
  }
}

// Poignées sur chaque point de la liaison sélectionnée : on la reprend sans la retracer.
// Une extrémité lâchée sur un équipement s'y accroche ; ailleurs, elle se décroche.
const poignees = new Konva.Group();
layer.add(poignees);
majPoigneesAuRendu = majPoignees;
function majPoignees() {
  poignees.destroyChildren();
  const l = projet.liaisons.find((l) => l.id === selection);
  if (!l || !groupes[LIAISONS[l.type].calque].listening()) return;
  const r = 6 / stage.scaleX(), n = l.points.length / 2;
  // Entre deux points, une petite poignée : la tirer insère un point (un coude) à cet endroit.
  for (let i = 0; i < n - 1; i++) {
    const [x1, y1, x2, y2] = l.points.slice(2 * i, 2 * i + 4);
    const m = new Konva.Circle({ name: 'poignee', x: (x1 + x2) / 2, y: (y1 + y2) / 2, radius: r * 0.7, fill: '#2563eb', opacity: 0.45, draggable: true });
    m.on('mouseenter', () => (conteneur.style.cursor = 'copy'));
    m.on('mouseleave', majStatut);
    m.on('dragstart', () => l.points.splice(2 * i + 2, 0, m.x(), m.y()));
    m.on('dragmove', () => {
      l.points.splice(2 * i + 2, 2, m.x(), m.y());
      layer.findOne<Konva.Group>('#' + l.id)?.findOne<Konva.Line>('Line')?.points(l.points.slice());
    });
    m.on('dragend', () => (valider(), setTimeout(rendre)));
    poignees.add(m);
  }
  for (let i = 0; i < n; i++) {
    const c = new Konva.Circle({ name: 'poignee', x: l.points[2 * i], y: l.points[2 * i + 1], radius: r, fill: '#fff', stroke: '#2563eb', strokeWidth: 2 / stage.scaleX(), draggable: true });
    const extremite = i === 0 || i === n - 1;
    c.on('mouseenter', () => (conteneur.style.cursor = 'move'));
    c.on('mouseleave', majStatut);
    // Double-clic sur un point intermédiaire : le retire (les extrémités restent).
    if (!extremite) c.on('dblclick dbltap', () => (l.points.splice(2 * i, 2), valider(), setTimeout(rendre)));
    c.on('dragmove', (e) => {
      if (e.evt.shiftKey) {
        // Maj : aligné horizontalement ou verticalement sur le point voisin.
        const j = i ? i - 1 : 1, vx = l.points[2 * j], vy = l.points[2 * j + 1];
        c.position(Math.abs(c.x() - vx) > Math.abs(c.y() - vy) ? { x: c.x(), y: vy } : { x: vx, y: c.y() });
      }
      const o = extremite ? equipementProche(c.position(), l.type) : null;
      if (o) c.position({ x: o.x, y: o.y });
      l.points.splice(2 * i, 2, c.x(), c.y());
      layer.findOne<Konva.Group>('#' + l.id)?.findOne<Konva.Line>('Line')?.points(l.points.slice());
    });
    c.on('dragend', () => {
      if (extremite) {
        const cle = i === 0 ? 'debut' : 'fin', o = equipementProche(c.position(), l.type);
        if (o && o.x === c.x() && o.y === c.y()) l[cle] = o.id;
        else delete l[cle];
      }
      valider();
      setTimeout(rendre);
    });
    poignees.add(c);
  }
}

stage.on('click tap', (e) => {
  const p = layer.getRelativePointerPosition();
  if (!p || cadreFini || (e.evt as MouseEvent).button === 2) return; // clic droit : voir « contextmenu »
  if (calib) {
    calib.push(p);
    reperes.add(new Konva.Circle({ x: p.x, y: p.y, radius: 5 / stage.scaleX(), fill: '#e11d48' }));
    majStatut();
    if (calib.length < 2) return;
    const [a, b] = calib;
    demanderTexte('Distance réelle entre ces deux points, en mètres ?').then((saisie) => {
      if (saisie !== null) {
        try {
          projet.echelle = echelleDepuis(a, b, Number(saisie.replace(',', '.')));
          valider();
        } catch (err) {
          annoncer((err as Error).message);
        }
      }
      changerMode(null);
      rendre(); // la légende affiche les longueurs dès que l'échelle est connue
      majCoords();
    });
  } else if (estLiaison(outil)) {
    const { q, accroche } = viser(p, e.evt.shiftKey);
    const n = trace.length;
    // Re-cliquer le dernier point (ou double-cliquer) termine la liaison.
    if (n && Math.hypot(q.x - trace[n - 2], q.y - trace[n - 1]) * stage.scaleX() < 8) terminerTrace();
    else {
      trace.push(q.x, q.y);
      majApercu(q);
      if (LIAISONS[outil].cote && trace.length === 4) terminerTrace(); // une cote = deux points
      else if (accroche === 'equipement' && trace.length >= 4) {
        // Arrivée sur un équipement : la liaison se termine et la suivante part de lui (prise → prise → prise…).
        terminerTrace();
        trace = [q.x, q.y];
        majApercu(q, 'equipement');
      } else if (accroche === 'reseau' && trace.length >= 4) terminerTrace(); // dérivation raccordée au réseau existant
    }
  } else if (outil) {
    if (e.target.findAncestor('.valider', true)) confirmer();
    else proposer(p); // un nouveau clic déplace l'aperçu
  } else if (relierDepuis) {
    const g = e.target.findAncestor('.objet', true);
    const a = projet.objets.find((o) => o.id === relierDepuis!.id), b = g && projet.objets.find((o) => o.id === Number(g.id()));
    const type = relierDepuis.type;
    relierDepuis = null;
    majStatut();
    if (a && b && a !== b && SYMBOLES[b.type].calque === SYMBOLES[a.type].calque) relier(a, b, type);
  } else if (!e.target.hasName('poignee')) {
    const g = e.target.findAncestor('.objet', true);
    if (g && e.evt.shiftKey) {
      // Maj+clic : ajoute l'élément à la sélection, ou l'en retire.
      const ids = new Set(choisis()), id = Number(g.id());
      if (!ids.delete(id)) ids.add(id);
      choisir([...ids]);
    } else selectionner(g ? Number(g.id()) : null);
  }
});

function choisir(ids: number[]) {
  if (ids.length < 2) return selectionner(ids[0] ?? null);
  selection = null;
  groupe.clear();
  for (const id of ids) groupe.add(id);
  rendre();
  majProps();
}

// Maj + glisser sur le fond : cadre de sélection (sans Maj, glisser déplace la vue).
let cadre: { x: number; y: number; rect: Konva.Rect } | null = null;
let cadreFini = false; // le clic qui suit le relâchement ne doit pas désélectionner
stage.on('mousedown', (e) => {
  const p = layer.getRelativePointerPosition();
  if (!p || !e.evt.shiftKey || e.evt.button !== 0 || outil || calib || relierDepuis || e.target.findAncestor('.objet', true) || e.target.hasName('poignee')) return;
  const s = 1 / stage.scaleX();
  cadre = { ...p, rect: new Konva.Rect({ ...p, stroke: '#2563eb', strokeWidth: s, dash: [4 * s, 3 * s], fill: 'rgb(37 99 235 / 0.08)' }) };
  survol.add(cadre.rect);
});
stage.on('mousemove', () => {
  const p = layer.getRelativePointerPosition();
  if (cadre && p) cadre.rect.setAttrs({ x: Math.min(p.x, cadre.x), y: Math.min(p.y, cadre.y), width: Math.abs(p.x - cadre.x), height: Math.abs(p.y - cadre.y) });
});
stage.on('mouseup', () => {
  if (!cadre) return;
  const r = cadre.rect.getAttrs() as { x: number; y: number; width?: number; height?: number };
  finirCadre();
  if (((r.width ?? 0) + (r.height ?? 0)) * stage.scaleX() < 6) return; // simple clic
  const dedans = (x: number, y: number) => x >= r.x && x <= r.x + r.width! && y >= r.y && y <= r.y + r.height!;
  const libre = (calque: string) => groupes[calque].visible() && groupes[calque].listening(); // ni masqué ni verrouillé
  choisir([
    ...projet.objets.filter((o) => libre(SYMBOLES[o.type].calque) && dedans(o.x, o.y)).map((o) => o.id),
    ...projet.liaisons.filter((l) => libre(LIAISONS[l.type].calque) && l.points.every((v, i) => i % 2 || dedans(v, l.points[i + 1]))).map((l) => l.id),
  ]);
  cadreFini = true;
  setTimeout(() => (cadreFini = false));
});
function finirCadre() {
  cadre?.rect.destroy();
  cadre = null;
}
// Pendant le cadre, la vue ne doit pas glisser avec la souris.
stage.on('dragstart', (e) => {
  if (cadre && e.target === stage) stage.stopDrag();
});
addEventListener('mouseup', finirCadre); // relâché hors du plan

// Survol : contour et bulle (nom, circuit, hauteur ou longueur) avant même de cliquer.
stage.on('mouseover', (e) => {
  const g = e.target.findAncestor('.objet', true) as Konva.Group | null;
  if (!g || outil || calib || cadre) return;
  const id = Number(g.id()), o = projet.objets.find((o) => o.id === id), l = projet.liaisons.find((l) => l.id === id);
  const s = 1 / stage.scaleX(), ptr = stage.getPointerPosition();
  survol.destroyChildren();
  if (o) survol.add(new Konva.Rect({ ...g.findOne<Konva.Rect>('Rect')!.getClientRect({ relativeTo: layer }), stroke: '#2563eb', strokeWidth: 1.5 * s, dash: [4 * s, 3 * s], cornerRadius: 2 * s }));
  else if (l) survol.add(new Konva.Line({ points: l.points, stroke: '#2563eb', strokeWidth: styleLiaison(l.type, l.props).strokeWidth + 6 * s, opacity: 0.25, lineCap: 'round', lineJoin: 'round' }));
  const x = o ?? l;
  if (!x || !ptr) return;
  const bulle = $('bulle');
  bulle.textContent = [
    (o ? SYMBOLES : LIAISONS)[x.type].nom,
    x.props.repere,
    o ? o.props.hauteur && `h ${o.props.hauteur} cm` : l!.props.section,
    l && projet.echelle && !LIAISONS[l.type].cote && `${metres(longueur(l.points))} m`,
  ].filter(Boolean).join(' · ');
  Object.assign(bulle.style, { left: `${ptr.x + 14}px`, top: `${ptr.y + 16}px` });
  bulle.hidden = false;
});
stage.on('mouseout dragstart', () => {
  if (cadre) return;
  survol.destroyChildren();
  $('bulle').hidden = true;
});

// « Annuler » du message affiché après une suppression (voir dialogues.ts).
$('b-message-annuler').onclick = () => {
  $('message').hidden = true;
  appliquer(hist.annuler());
};

// Cadre tout le contenu (plan, structure, équipements, légende) dans la fenêtre.
function ajusterVue() {
  const r = layer.getClientRect({ relativeTo: layer });
  if (!r.width || !r.height) return;
  const k = Math.min(stage.width() / r.width, stage.height() / r.height) * 0.95;
  stage.scale({ x: k, y: k });
  stage.position({ x: (stage.width() - r.width * k) / 2 - r.x * k, y: (stage.height() - r.height * k) / 2 - r.y * k });
}

// Curseur « déplacer » au survol d'un élément déplaçable, hors pose et calibration.
stage.on('mouseover', (e) => {
  if (!outil && !calib && e.target.findAncestor('.objet', true)) conteneur.style.cursor = 'move';
});
stage.on('mouseout', majStatut);

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
  if (p && estLiaison(outil)) {
    const { q, accroche } = viser(p, e.evt.shiftKey);
    majApercu(q, accroche);
  }
  majFantome(p);
});
stage.on('mouseleave', () => majFantome(null));

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
    if (nouveau) reconnaitrePlan().then((cotesLues) => nettoyerFond(cotesLues === true));
  };
  img.onerror = () => annoncer("Impossible de lire l'image du plan.");
  img.src = dataUrl;
  projet.fond = dataUrl;
}

async function importerFond(f: File) {
  try {
    if (f.type === 'application/pdf') {
      const pdfjs = await import('pdfjs-dist'); // chargé seulement ici : le lecteur PDF pèse plus que le reste de l'appli
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
      const pdf = await pdfjs.getDocument({ data: await f.arrayBuffer() }).promise;
      let n = 1;
      if (pdf.numPages > 1) {
        const saisie = await demanderTexte(`Ce PDF contient ${pdf.numPages} pages. Laquelle importer ?`, '1');
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
      lecteur.onerror = () => annoncer('Lecture du fichier impossible.');
      lecteur.readAsDataURL(f);
    }
    modifie = true;
  } catch (err) {
    annoncer(`Import impossible : ${(err as Error).message}`);
  }
}

// ---------- Reconnaissance du plan importé ----------
// Lancée à chaque import : transforme les murs pleins de l'image en cloisons, les vides entre murs alignés
// en portes et fenêtres, et fixe l'échelle d'après les cotes. Si ça échoue, on bascule sur la calibration à deux clics.
const STRUCTURE_RECONNUE = ['cloison', 'porte', 'fenetre', 'passage'];

function calibrerALaMain(raison: string) {
  annoncer(`${raison} Cliquez maintenant deux points dont vous connaissez la distance réelle pour fixer l'échelle.`);
  changerMode(null, true);
}

async function reconnaitrePlan() {
  const source = groupes.fond.findOne<Konva.Image>('Image')?.image() as HTMLImageElement | undefined;
  if (!source) return;
  const existante = [...projet.objets, ...projet.liaisons].filter((x) => STRUCTURE_RECONNUE.includes(x.type));
  if (existante.length) {
    if (!(await demanderAccord(`Cet étage contient déjà ${existante.length} cloison(s), porte(s) ou fenêtre(s). Les remplacer par celles du nouveau plan ?`, 'Remplacer')))
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
    const saisie = await demanderTexte("Murs reconnus, mais les cotes du plan n'ont pas pu être lues. Pour fixer l'échelle : largeur hors tout du bâtiment sur le plan (de la face extérieure du mur le plus à gauche à celle du mur le plus à droite), en mètres ?");
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
  valider();
  rendre();
  majCoords();
  return !!lue; // cotes Kazaplan lues : nettoyerFond les effacera
}

// Fond du plan importé : gris clairs passés en blanc (seuls murs, meubles et textes restent), et cotes violettes
// effacées s'il s'agit d'un plan Kazaplan, puisque l'appli redessine les siennes.
function nettoyerFond(cotesKazaplan: boolean) {
  const noeud = groupes.fond.findOne<Konva.Image>('Image');
  const source = noeud?.image() as HTMLImageElement | HTMLCanvasElement | undefined;
  if (!noeud || !source) return;
  const canvas = document.createElement('canvas');
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, 0, 0);
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  if (cotesKazaplan) effacerCotes(image);
  blanchir(image);
  ctx.putImageData(image, 0, 0);
  noeud.image(canvas);
  projet.fond = canvas.toDataURL('image/png');
  sauvegarderBientot();
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
  sauvegarderBientot(); // marquée « enregistrée » : plus de proposition de reprise
}

/** Remplace le projet par celui de ce texte JSON ; faux si l'utilisateur renonce ou si le texte est invalide. */
async function charger(texte: string): Promise<boolean> {
  if (modifie && !(await demanderAccord('Les modifications non enregistrées seront perdues. Continuer ?', 'Continuer'))) return false;
  try {
    etages = lireProjet(texte);
  } catch (err) {
    annoncer((err as Error).message);
    return false;
  }
  hist = new Historique(instantane());
  modifie = false;
  changerEtage(0);
  return true;
}
async function ouvrir(f: File) {
  if (await charger(await f.text())) nomEnLigne = null; // un fichier local n'est lié à aucun plan en ligne
}

// ---------- Sauvegarde en ligne (site déployé seulement, voir api/plans.ts) ----------
let nomEnLigne: string | null = null; // plan en ligne ouvert ou enregistré en dernier : proposé au prochain enregistrement

/** Lance une action en ligne avec le mot de passe : demandé une fois, retenu s'il est accepté, oublié s'il est refusé. */
async function enLigne<T>(action: (mdp: string) => Promise<T>): Promise<T | undefined> {
  const mdp = motDePasseRetenu() ?? (await demanderTexte('Mot de passe de la sauvegarde en ligne ?', '', true));
  if (!mdp) return;
  try {
    const resultat = await action(mdp);
    retenirMotDePasse(mdp);
    return resultat;
  } catch (err) {
    if (err instanceof ErreurEnLigne && err.status === 401) retenirMotDePasse(null);
    annoncer((err as Error).message);
  }
}

async function enregistrerEnLigne() {
  const nom = (await demanderTexte('Nom du plan en ligne ?', nomEnLigne ?? 'Maison'))?.trim();
  if (!nom) return;
  const fait = await enLigne(async (mdp) => {
    // Un autre plan porte déjà ce nom : on ne l'écrase pas sans accord.
    if (nom !== nomEnLigne && (await listerPlans(mdp)).some((p) => p.nom === nom) && !(await demanderAccord(`Un plan « ${nom} » existe déjà en ligne. Le remplacer ?`, 'Remplacer'))) return false;
    await enregistrerPlan(mdp, nom, JSON.stringify({ etages }));
    return true;
  });
  if (!fait) return;
  nomEnLigne = nom;
  modifie = false;
  sauvegarderBientot();
  annoncer(`Plan « ${nom} » enregistré en ligne.`);
}

async function ouvrirEnLigne() {
  const plans = await enLigne(listerPlans);
  if (!plans) return;
  const fenetre = $<HTMLDialogElement>('plans-en-ligne');
  $('liste-en-ligne').replaceChildren(
    ...(plans.length ? plans : [null]).map((p) => {
      if (!p) return element('li', 'Aucun plan enregistré en ligne pour le moment.');
      const li = element('li');
      const date = new Date(p.date).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
      const b = element('button', `${p.nom} — ${date} · ${m2(p.octets / 1e6)} Mo`);
      b.onclick = async () => {
        fenetre.close();
        const texte = await enLigne((mdp) => lirePlan(mdp, p.nom));
        if (texte !== undefined && (await charger(texte))) nomEnLigne = p.nom;
      };
      const suppr = element('button', 'Supprimer', 'danger');
      suppr.onclick = async () => {
        fenetre.close();
        if (!(await demanderAccord(`Supprimer le plan « ${p.nom} » enregistré en ligne ? Cette action ne peut pas être annulée.`, 'Supprimer'))) return;
        if (await enLigne(async (mdp) => (await supprimerPlan(mdp, p.nom), true))) annoncer(`Plan « ${p.nom} » supprimé en ligne.`);
      };
      li.append(b, suppr);
      return li;
    }),
  );
  fenetre.showModal();
}

const nomFichier = (extension: string) => `plan-${projet.nom.replace(/[^\p{L}\p{N}]+/gu, '-')}.${extension}`;

// ---------- Élévations : chaque mur de pièce vu de face (src/elevation.ts pour la géométrie) ----------
// Équipements posés contre un mur ; v1 sans baignoire ni douche (appareils au sol) ni éléments au plafond.
const contreUnMur = (o: Objet) => {
  const s = SYMBOLES[o.type];
  return !s.libre && !s.mural && !s.dimensions;
};
function facesDuPlan(): Face[] | null {
  const e = projet.echelle;
  if (!e || !cotesCache) return null;
  const segments: Segment[] = [];
  for (const l of projet.liaisons.filter((l) => l.type === 'cloison')) {
    const demi = styleLiaison('cloison', l.props).strokeWidth / 2;
    for (let i = 2; i < l.points.length; i += 2) segments.push({ x1: l.points[i - 2], y1: l.points[i - 1], x2: l.points[i], y2: l.points[i + 1], demi });
  }
  const ouvertures = projet.objets.filter((o) => SYMBOLES[o.type].mural).map((o) => ({ id: o.id, x: o.x, y: o.y, rot: o.rot, largeur: nombre(o.props.largeur, SYMBOLES[o.type].mural!) / 100 / e }));
  // Même portée qu'à la pose (plaquerAuMur) : le centre d'un symbole plaqué est à une demi-boîte de la face du mur.
  return elevations(segments, ouvertures, projet.objets.filter(contreUnMur), cotesCache.numero, e, 1.5 * B * projet.taille);
}
const VUES = { haut: 'mur du haut', bas: 'mur du bas', gauche: 'mur de gauche', droite: 'mur de droite' };
function dessinFace(f: Face) {
  const salle = cotesCache?.salles.find((s) => s.num === f.piece), type = salle && typePiece(salle);
  const titre = `P${f.piece}${type ? ` · ${TYPES_PIECES[type]}` : ''} — ${VUES[f.vue]} sur le plan`;
  const sousTitre = `${projet.nom} · longueur ${m2(f.longueur)} m · hauteur sous plafond ${m2(hsp())} m · vu depuis la pièce`;
  const elements = f.elements.map(({ id, abscisse }) => {
    const o = projet.objets.find((o) => o.id === id)!, s = SYMBOLES[o.type], h = nombre(o.props.hauteur, 0);
    return { abscisse, hauteur: h ? h / 100 : null, nom: s.nom, repere: o.props.repere, couleur: couleurs[s.calque], d: s.d, texte: s.texte };
  });
  const ouv = f.ouvertures.map(({ id, debut, fin }) => {
    const o = projet.objets.find((o) => o.id === id)!;
    return { debut, fin, type: o.type, nom: SYMBOLES[o.type].nom };
  });
  return dessinerElevation(titre, sousTitre, f.longueur, hsp(), elements, ouv);
}
async function pdfFaces(faces: Face[], prefixe: string) {
  const pages = await Promise.all(
    faces.map(async (f) => {
      const c = dessinFace(f);
      const jpeg = await new Promise<Blob | null>((ok) => c.toBlob(ok, 'image/jpeg', 0.9));
      return { jpeg: new Uint8Array(await jpeg!.arrayBuffer()), largeur: c.width, hauteur: c.height };
    }),
  );
  const url = URL.createObjectURL(new Blob([pdfDepuisJpegs(pages)], { type: 'application/pdf' }));
  telecharger(url, nomFichier('pdf').replace('plan-', prefixe));
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
/** Tous les murs de pièce qui portent au moins un équipement, une page chacun, dans l'ordre des pièces. */
function exporterElevations() {
  if (!projet.echelle) return annoncer("Calibrez d'abord l'échelle du plan : les élévations sont cotées en mètres.");
  const faces = facesDuPlan()?.filter((f) => f.elements.length).sort((a, b) => a.piece - b.piece || a.vue.localeCompare(b.vue));
  if (!faces?.length) return annoncer("Aucun équipement posé contre un mur de pièce : rien à mettre en élévation.");
  pdfFaces(faces, 'elevations-');
}
function voirElevation(id: number) {
  if (!projet.echelle) return annoncer("Calibrez d'abord l'échelle du plan : les élévations sont cotées en mètres.");
  const f = facesDuPlan()?.find((f) => f.elements.some((x) => x.id === id));
  if (!f) return annoncer("Cet équipement n'est rattaché à aucun mur de pièce : trop loin d'une cloison, ou pièce non fermée.");
  $<HTMLImageElement>('elevation-img').src = dessinFace(f).toDataURL('image/png');
  $('b-elevation-pdf').onclick = () => pdfFaces([f], 'elevation-');
  $<HTMLDialogElement>('elevation').showModal();
}

// Image de l'étage affiché, en pixels du plan. Seuls les calques visibles y figurent :
// un export par corps de métier se fait en cochant/décochant.
function imagePlan(pixelRatio: number) {
  selectionner(null);
  reperes.destroyChildren();
  annulerAttente();
  const echelle = stage.scale();
  const pos = stage.position();
  stage.scale({ x: 1, y: 1 });
  stage.position({ x: 0, y: 0 });
  const r = layer.getClientRect();
  // Sur fond blanc : en JPEG, les zones transparentes (autour de la légende) sortiraient noires.
  let canvas: HTMLCanvasElement | null = null;
  if (r.width && r.height) {
    const rendu = stage.toCanvas({ ...r, pixelRatio });
    canvas = document.createElement('canvas');
    canvas.width = rendu.width;
    canvas.height = rendu.height;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(rendu, 0, 0);
  }
  stage.scale(echelle);
  stage.position(pos);
  if (!canvas) annoncer('Rien à exporter.');
  return canvas ? { canvas, largeur: r.width, hauteur: r.height } : null;
}

// PDF A4 de l'étage affiché, calques visibles seulement. Pour un plan à l'échelle exacte : « Imprimer à l'échelle ».
async function exporterPdf() {
  const plan = imagePlan(1.5); // ~300 dpi sur une A4 pour un plan Kazaplan importé
  if (!plan) return;
  const jpeg = await new Promise<Blob | null>((ok) => plan.canvas.toBlob(ok, 'image/jpeg', 0.9));
  if (!jpeg) return annoncer("Impossible de générer l'image du plan.");
  const pdf = pdfDepuisJpeg(new Uint8Array(await jpeg.arrayBuffer()), plan.canvas.width, plan.canvas.height);
  const url = URL.createObjectURL(new Blob([pdf], { type: 'application/pdf' }));
  telecharger(url, nomFichier('pdf'));
  setTimeout(() => URL.revokeObjectURL(url), 1000);
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
  if (!projet.echelle) return annoncer("Calibrez d'abord l'échelle du plan.");
  const saisie = await demanderTexte("Échelle d'impression ? Saisissez 50 pour du 1:50 (1 cm sur le papier = 50 cm réels).", '50');
  if (saisie === null) return;
  const n = nombre(saisie.replace(/^\s*1\s*[:/]/, ''), 50);
  const plan = imagePlan(2);
  if (!plan) return;
  const mm = (px: number) => (px * projet.echelle! * 1000) / n;
  const l = mm(plan.largeur);
  const h = mm(plan.hauteur);
  const format = FORMATS.find((f) => l <= f.l && h <= f.h);
  if (!format) return annoncer(`À 1:${n}, le plan mesure ${Math.round(l)} × ${Math.round(h)} mm et dépasse l'A3. Essayez une échelle plus petite, par exemple 1:${n * 2}.`);
  $('page').textContent = `@page { size: ${format.page}; margin: 10mm; }`;
  const img = $<HTMLImageElement>('impression-img');
  img.src = plan.canvas.toDataURL('image/png');
  img.style.width = `${l}mm`;
  $('impression-titre').textContent = `${projet.nom} — échelle 1:${n} — ${format.page.replace('landscape', 'paysage')} — imprimer à 100 %, sans « ajuster à la page »`;
  await img.decode();
  print();
}

// ---------- Interface ----------
// La structure, issue du plan importé, est verrouillée d'office : on ne déplace pas un mur en posant une prise.
const VERROUILLES = ['structure'];
for (const id of VERROUILLES) groupes[id].listening(false);
$('calques').innerHTML = [{ id: 'fond', nom: 'Fond de plan', couleur: '#6b7280' }, ...CALQUES, ...COTES_AUTO, { id: 'legende', nom: 'Légende', couleur: '#6b7280' }]
  .map(
    (c) =>
      `<div class="calque"><label style="color:${c.couleur}"><input type="checkbox" data-calque="${c.id}" checked> ${c.nom}</label>` +
      // Fond et légende ne sont jamais sélectionnables : pas de verrou à proposer.
      (couleurs[c.id] ? `<label title="Verrouiller : les éléments de ce calque ne peuvent plus être sélectionnés ni déplacés"><input type="checkbox" data-verrou="${c.id}"${VERROUILLES.includes(c.id) ? ' checked' : ''}> 🔒</label>` : '') +
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
  `<button data-type="${type}" style="color:${couleur}"><svg viewBox="0 0 ${B} ${B}" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${dessin}</svg><span>${nom}</span>${Object.keys(RACCOURCIS).filter((k) => RACCOURCIS[k] === type).map((k) => `<kbd title="Raccourci clavier">${k.toUpperCase()}</kbd>`).join('')}</button>`;
// Une section repliable par calque : on ne fait défiler que ce qui sert au corps de métier en cours.
$('palette').innerHTML = CALQUES.map(
  (c) =>
    `<details open><summary style="color:${c.couleur}">${c.nom}</summary>` +
    Object.entries(SYMBOLES)
      .filter(([, s]) => s.calque === c.id)
      .map(([type, s]) =>
        bouton(type, c.couleur, s.nom, `<path d="${s.d}"/>` + (s.texte ? `<text x="12" y="12" text-anchor="middle" dominant-baseline="central" font-size="7" font-weight="bold" fill="currentColor" stroke="none">${s.texte}</text>` : '')),
      )
      .join('') +
    Object.entries(LIAISONS)
      .filter(([, t]) => t.calque === c.id)
      .map(([type, t]) => bouton(type, t.couleur === '#ffffff' ? '#9ca3af' : t.couleur, t.nom, `<path d="M2 12 H22" stroke-width="2"${t.tirets ? ` stroke-dasharray="${t.tirets}"` : ''}/>`))
      .join('') +
    '</details>',
).join('');
$('palette').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-type]');
  if (b) changerMode(b.dataset.type === outil ? null : b.dataset.type!);
});

// Panneau Propriétés : reconstruit seulement quand la sélection change, pour ne pas perdre le focus en cours de saisie.
function majProps() {
  const el = $('props');
  if (groupe.size) {
    // Sélection multiple : le circuit se change pour tous, l'ensemble se déplace ou se supprime.
    el.hidden = false;
    el.innerHTML = `<strong>${groupe.size} éléments sélectionnés</strong><label>Circuit / repère (pour tous)<input type="text" data-groupe="repere"></label><p>Glisser l'un d'eux ou flèches du clavier : déplacer l'ensemble. Maj+clic : ajouter ou retirer un élément.</p>`;
    const actions = element('div', '', 'actions'), b = element('button', 'Supprimer', 'danger');
    b.dataset.action = 'supprimer';
    actions.append(b);
    return el.append(actions);
  }
  const c = cible();
  el.hidden = !c;
  if (!c) return;
  const liaison = 'points' in c;
  el.innerHTML =
    `<strong>${(liaison ? LIAISONS : SYMBOLES)[c.type].nom}</strong>` +
    champs(c).map(([cle, nom, defaut]) => `<label>${nom}<input type="text" data-champ="${cle}" placeholder="${defaut}"></label>`).join('') +
    (liaison && projet.echelle ? `<p>Longueur : ${metres(longueur(c.points))} m</p>` : '') +
    (() => {
      const r = liaison && projet.echelle ? reseauDe(c.id) : undefined;
      if (!r || !('points' in c)) return '';
      const total = r.liaisons.reduce((s, id) => s + metresAvecMontees(projet.liaisons.find((l) => l.id === id)!), 0);
      return `<p>Avec montées : ${m2(metresAvecMontees(c))} m</p>` + (r.liaisons.length > 1 ? `<p><strong>Réseau : ${m2(total)} m</strong> (${r.liaisons.length} tronçons, montées comprises)</p>` : '');
    })() +
    (liaison && !LIAISONS[c.type].cote ? `<p>Double-clic sur le tracé : ajouter un point. Tirer un point avec Maj : l'aligner.</p>` : '') +
    (!liaison && SYMBOLES[c.type].mural ? `<p>R : passer de l'autre côté du mur. M : inverser les gonds.</p>` : '') +
    (!projet.echelle && (liaison ? LIAISONS[c.type].epaisseur : SYMBOLES[c.type].mural) ? `<p>Calibrez l'échelle pour un tracé aux dimensions réelles.</p>` : '') +
    `<label class="fait"><input type="checkbox" data-fait> Fait / posé (touche F)</label>`;
  for (const i of el.querySelectorAll<HTMLInputElement>('input[data-champ]')) i.value = c.props[i.dataset.champ!] ?? ''; // via .value : jamais interprété comme du HTML
  el.querySelector<HTMLInputElement>('[data-fait]')!.checked = !!c.props.fait;
  const actions = element('div', '', 'actions');
  const bouton = (action: string, texte: string, titre: string, classe = '') => {
    const b = element('button', texte, classe);
    Object.assign(b.dataset, { action });
    b.title = titre;
    return b;
  };
  actions.append(
    ...(liaison ? [] : [bouton('pivoter', 'Pivoter', 'Pivoter (R)')]),
    ...(!liaison && SYMBOLES[c.type].mural ? [bouton('miroir', 'Inverser les gonds', 'Inverser les gonds (M)')] : []),
    ...(!liaison && contreUnMur(c as Objet) ? [bouton('elevation', 'Élévation du mur', 'Le mur de la pièce vu de face, avec ses équipements')] : []),
    bouton('dupliquer', 'Dupliquer', 'Dupliquer (Ctrl+D)'),
    bouton('supprimer', 'Supprimer', 'Supprimer (Suppr)', 'danger'),
  );
  el.append(actions);
  // Tracé automatique depuis un équipement : vers celui qu'on clique, ou directement vers le tableau / la baie.
  const types = liaison ? [] : typesReliables(SYMBOLES[c.type].calque);
  if (types.length) {
    const relie = element('div', '', 'actions');
    if (types.length > 1) {
      const choix = element('select');
      choix.dataset.relierType = '';
      choix.title = 'Type de tuyau ou de câble à tracer';
      choix.append(...types.map((t) => Object.assign(element('option', LIAISONS[t].nom), { value: t })));
      relie.append(choix);
    }
    relie.append(bouton('relier', 'Relier à…', "Tracer automatiquement, le long des murs, jusqu'à l'équipement cliqué ensuite"));
    const pole = poleDe(c as Objet);
    if (pole) relie.append(bouton('relier-pole', `Relier ${pole.type === 'tableau' ? 'au tableau' : 'à la baie'}`, 'Tracer automatiquement, le long des murs'));
    el.append(relie);
  }
}
$('props').addEventListener('input', (e) => {
  const i = e.target as HTMLInputElement;
  if (groupe.size && i.dataset.groupe) {
    for (const x of [...projet.objets, ...projet.liaisons]) {
      if (!groupe.has(x.id)) continue;
      if (i.value.trim()) x.props.repere = i.value.trim();
      else delete x.props.repere;
    }
    modifie = true;
    return rendre();
  }
  const c = cible();
  if (!c || (!i.dataset.champ && i.type !== 'checkbox')) return; // la liste « type à tracer » n'est pas une propriété
  if (i.type === 'checkbox') basculerFait(c, i.checked);
  else if (i.value.trim()) c.props[i.dataset.champ!] = i.value.trim();
  else delete c.props[i.dataset.champ!];
  modifie = true;
  rendre();
});

function basculerFait(c: Objet | Liaison, fait = !c.props.fait) {
  if (fait) c.props.fait = '1';
  else delete c.props.fait;
}
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
surFichier('f-fond-accueil', importerFond);
surFichier('f-projet-accueil', ouvrir);

// ---------- Ergonomie générale ----------
// Onglets de la colonne de gauche : Dessiner (outils) / Vérifier (bilans, contrôles, devis).
function afficherOnglet(nom: 'dessiner' | 'verifier') {
  for (const n of ['dessiner', 'verifier']) {
    $(`t-${n}`).setAttribute('aria-selected', String(n === nom));
    $(`onglet-${n}`).hidden = n !== nom;
  }
}
$('t-dessiner').onclick = () => afficherOnglet('dessiner');
$('t-verifier').onclick = () => afficherOnglet('verifier');

// Déposer un fichier n'importe où sur le plan : un .json ouvre le projet, une image ou un PDF devient le plan de fond.
const zonePlan = document.querySelector('main')!;
zonePlan.addEventListener('dragover', (e) => {
  if (!e.dataTransfer?.types.includes('Files')) return;
  e.preventDefault();
  zonePlan.classList.add('depot');
});
zonePlan.addEventListener('dragleave', (e) => {
  if (!zonePlan.contains(e.relatedTarget as Node)) zonePlan.classList.remove('depot');
});
zonePlan.addEventListener('drop', (e) => {
  e.preventDefault();
  zonePlan.classList.remove('depot');
  const f = e.dataTransfer?.files[0];
  if (!f) return;
  if (f.name.toLowerCase().endsWith('.json')) ouvrir(f);
  else if (f.type === 'application/pdf' || f.type.startsWith('image/')) importerFond(f);
  else annoncer('Format non reconnu : déposez un PDF, une image ou un projet .json.');
});

// Recherche dans la palette, sans tenir compte des accents ni des majuscules.
const sansAccents = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
$<HTMLInputElement>('recherche').addEventListener('input', (e) => {
  const q = sansAccents((e.target as HTMLInputElement).value.trim());
  for (const d of $('palette').querySelectorAll('details')) {
    let visibles = 0;
    for (const b of d.querySelectorAll<HTMLButtonElement>('button[data-type]')) {
      b.hidden = !!q && !sansAccents(b.textContent ?? '').includes(q);
      visibles += +!b.hidden;
    }
    d.hidden = !visibles;
    if (q) d.open = true;
  }
});

// Zoom au bouton, centré sur la vue.
function zoomer(facteur: number) {
  const centre = { x: stage.width() / 2, y: stage.height() / 2 };
  const avant = stage.scaleX(), apres = Math.min(40, Math.max(0.02, avant * facteur));
  stage.position({ x: centre.x - ((centre.x - stage.x()) * apres) / avant, y: centre.y - ((centre.y - stage.y()) * apres) / avant });
  stage.scale({ x: apres, y: apres });
}
$('b-zoomer').onclick = () => zoomer(1.3);
$('b-dezoomer').onclick = () => zoomer(1 / 1.3);

// Aide : la liste des raccourcis et gestes.
const aide = $<HTMLDialogElement>('aide');
$('b-aide').onclick = () => aide.showModal();

// Actions de l'élément sélectionné, aussi en boutons dans Propriétés (pour qui ne connaît pas les raccourcis).
function supprimerSelection() {
  const ids = new Set(choisis());
  if (!ids.size) return;
  projet.objets = projet.objets.filter((o) => !ids.has(o.id));
  for (const l of projet.liaisons) {
    // Équipement supprimé : ses câbles restent, décrochés.
    if (l.debut !== undefined && ids.has(l.debut)) delete l.debut;
    if (l.fin !== undefined && ids.has(l.fin)) delete l.fin;
  }
  projet.liaisons = projet.liaisons.filter((l) => !ids.has(l.id));
  valider();
  selectionner(null);
  annoncer(ids.size > 1 ? `${ids.size} éléments supprimés` : 'Élément supprimé', true);
}
function pivoterSelection() {
  const o = projet.objets.find((o) => o.id === selection);
  if (!o) return;
  o.rot = (o.rot + (SYMBOLES[o.type].mural ? 180 : 90)) % 360; // porte/fenêtre : bascule de l'autre côté du mur
  valider();
  rendre();
}
$('props').addEventListener('click', (e) => {
  const action = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]')?.dataset.action;
  if (action === 'supprimer') supprimerSelection();
  else if (action === 'dupliquer' && cible()) coller(cible()!, null);
  else if (action === 'pivoter') pivoterSelection();
  else if (action === 'miroir') inverserGonds();
  else if (action === 'elevation' && selection !== null) voirElevation(selection);
  else if (action === 'relier' || action === 'relier-pole') {
    const a = projet.objets.find((o) => o.id === selection);
    if (!a) return;
    const type = $('props').querySelector<HTMLSelectElement>('[data-relier-type]')?.value ?? typesReliables(SYMBOLES[a.type].calque)[0];
    const pole = poleDe(a);
    if (action === 'relier-pole' && pole) return relier(a, pole, type);
    changerMode(null);
    relierDepuis = { id: a.id, type };
    majStatut();
  }
});

// ---------- Tracé automatique ----------
function typesReliables(calque: string) {
  return Object.keys(LIAISONS).filter((t) => LIAISONS[t].calque === calque && !LIAISONS[t].cote && !LIAISONS[t].epaisseur);
}
/** Le tableau (ou la baie) le plus proche de l'équipement, s'il y en a un et que ce n'est pas lui. */
function poleDe(o: Objet): Objet | undefined {
  const type = ({ elec: 'tableau', reseau: 'baie' } as Record<string, string>)[SYMBOLES[o.type].calque];
  return projet.objets
    .filter((p) => p.type === type && p !== o)
    .sort((p, q) => Math.hypot(p.x - o.x, p.y - o.y) - Math.hypot(q.x - o.x, q.y - o.y))[0];
}
function relier(a: Objet, b: Objet, type: string) {
  const murs = projet.liaisons.filter((l) => l.type === 'cloison').map((l) => ({ points: l.points, epaisseur: styleLiaison('cloison', l.props).strokeWidth }));
  const points = router(a, b, murs, projet.echelle ? 0.1 / projet.echelle : 10); // grille de 10 cm
  const id = nouvelId();
  projet.liaisons.push({ id, type, points, props: a.props.repere ? { repere: a.props.repere } : {}, debut: a.id, fin: b.id });
  valider();
  selectionner(id); // poignées affichées : le tracé se retouche aussitôt
}

// Clic droit pendant une pose, un tracé, une calibration ou un « Relier à… » : tout annuler, retour à la sélection.
conteneur.addEventListener('contextmenu', (e) => {
  if (!outil && !calib && !relierDepuis) return;
  e.preventDefault();
  changerMode(null);
});

// Double-clic sur le tracé sélectionné : ajoute un point à cet endroit (à retoucher ensuite avec sa poignée).
conteneur.addEventListener('dblclick', () => {
  const l = projet.liaisons.find((l) => l.id === selection);
  const p = layer.getRelativePointerPosition(), ptr = stage.getPointerPosition();
  if (!l || !p || !ptr || outil || LIAISONS[l.type].cote || stage.getIntersection(ptr)?.hasName('poignee')) return;
  let meilleur = { d: 12 / stage.scaleX(), s: -1, x: 0, y: 0 };
  for (let s = 0; s + 3 < l.points.length; s += 2) {
    const [x1, y1, x2, y2] = l.points.slice(s, s + 4), dx = x2 - x1, dy = y2 - y1;
    const t = Math.max(0, Math.min(1, ((p.x - x1) * dx + (p.y - y1) * dy) / (dx * dx + dy * dy || 1)));
    const x = x1 + t * dx, y = y1 + t * dy, d = Math.hypot(p.x - x, p.y - y);
    if (d < meilleur.d) meilleur = { d, s, x, y };
  }
  if (meilleur.s < 0) return;
  l.points.splice(meilleur.s + 2, 0, meilleur.x, meilleur.y);
  valider();
  rendre();
});
function inverserGonds() {
  const o = projet.objets.find((o) => o.id === selection);
  if (!o || !SYMBOLES[o.type].mural) return;
  if (o.props.miroir) delete o.props.miroir;
  else o.props.miroir = '1';
  valider();
  rendre();
}

$('b-sauver').onclick = enregistrer;
$('b-en-ligne-sauver').onclick = enregistrerEnLigne;
$('b-en-ligne-ouvrir').onclick = ouvrirEnLigne;
$('b-en-ligne-fermer').onclick = () => $<HTMLDialogElement>('plans-en-ligne').close();
$('b-pdf').onclick = exporterPdf;
$('b-csv').onclick = exporterCsv;
$('b-unifilaire').onclick = schemaUnifilaire;
$('b-devis').onclick = exporterDevis;
$('b-elevations').onclick = exporterElevations;
$('b-elevation-fermer').onclick = () => $<HTMLDialogElement>('elevation').close();
$('b-imprimer').onclick = imprimer;

$('etage').onchange = (e) => changerEtage(Number((e.target as HTMLSelectElement).value));
$('b-etage-plus').onclick = async () => {
  const nom = (await demanderTexte('Nom du nouvel étage ?', `Niveau ${etages.length + 1}`))?.trim();
  if (!nom) return;
  etages.push(etageVide(nom.slice(0, 60)));
  valider();
  changerEtage(etages.length - 1);
};
$('b-etage-nom').onclick = async () => {
  const nom = (await demanderTexte("Nouveau nom de l'étage ?", projet.nom))?.trim();
  if (!nom) return;
  projet.nom = nom.slice(0, 60);
  valider();
  majEtages();
};
$('b-etage-suppr').onclick = async () => {
  if (etages.length < 2) return annoncer('Un projet garde au moins un étage.');
  if (!(await demanderAccord(`Supprimer l'étage « ${projet.nom} » et tout son contenu ? Cette action ne peut pas être annulée.`, 'Supprimer'))) return;
  etages = etages.filter((e) => e !== projet);
  hist = new Historique(instantane()); // les anciens instantanés ne correspondent plus aux étages restants
  modifie = true;
  changerEtage(0);
};
$('b-ajuster').onclick = ajusterVue;
$('b-annuler').onclick = () => appliquer(hist.annuler());
$('b-refaire').onclick = () => appliquer(hist.refaire());

let minuterieFleches = 0;
addEventListener('keydown', (e) => {
  const ctrl = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  if (ctrl && k === 's') return void (e.preventDefault(), enregistrer()); // partout, même dans un champ
  if (document.querySelector('dialog[open]')) return; // fenêtre ouverte : aucun raccourci du plan
  // Dans un champ (texte, nombre, recherche, liste), les touches servent à saisir : R, Suppr, Ctrl+Z natif…
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement) return;
  if (k === '?') aide.showModal();
  else if (ctrl && k === 'c' && cible()) pressePapiers = structuredClone(cible()!);
  else if (ctrl && k === 'v' && pressePapiers) (e.preventDefault(), coller(pressePapiers, layer.getRelativePointerPosition()));
  else if (ctrl && k === 'd' && cible()) (e.preventDefault(), coller(cible()!, null));
  else if (ctrl && (k === 'y' || (k === 'z' && e.shiftKey))) (e.preventDefault(), appliquer(hist.refaire()));
  else if (ctrl && k === 'z') (e.preventDefault(), appliquer(hist.annuler()));
  else if (k === '0' && !ctrl) ajusterVue();
  else if (k === 'escape' && enAttente) annulerAttente(); // 1er Échap : retire l'aperçu, l'outil reste actif
  else if (k === 'escape') {
    changerMode(null);
    selectionner(null);
  } else if (k === 'enter' && enAttente) confirmer();
  else if (k === 'enter' && estLiaison(outil)) terminerTrace();
  else if (k === 'backspace' && estLiaison(outil) && trace.length) {
    // Pendant un tracé : retire le dernier point posé, sans tout annuler.
    trace.splice(-2);
    majApercu(layer.getRelativePointerPosition() ?? { x: trace.at(-2) ?? 0, y: trace.at(-1) ?? 0 });
  } else if ((k === 'delete' || k === 'backspace') && choisis().length) supprimerSelection();
  else if (k.startsWith('arrow') && choisis().length && !outil) {
    // Flèches : décale la sélection de 1 cm (10 cm avec Maj) ; une seule entrée d'historique par rafale.
    e.preventDefault();
    const pas = (projet.echelle ? 0.01 / projet.echelle : 1) * (e.shiftKey ? 10 : 1);
    deplacer(choisis(), k === 'arrowleft' ? -pas : k === 'arrowright' ? pas : 0, k === 'arrowup' ? -pas : k === 'arrowdown' ? pas : 0);
    modifie = true;
    rendre();
    clearTimeout(minuterieFleches);
    minuterieFleches = window.setTimeout(valider, 400);
  } else if (!ctrl && RACCOURCIS[k]) changerMode(RACCOURCIS[k] === outil ? null : RACCOURCIS[k]);
  else if (k === 'f' && !ctrl && cible()) {
    basculerFait(cible()!);
    valider();
    rendre();
    majProps();
  } else if (k === 'm' && !ctrl) inverserGonds(); // côté des gonds, sans changer le côté d'ouverture
  else if (k === 'r' && !ctrl && outil && !estLiaison(outil)) {
    // Pendant la pose : pivote l'aperçu (et les suivants) de 90° ; porte et fenêtre basculent de l'autre côté du mur.
    const pas = SYMBOLES[outil].mural ? 180 : 90;
    rotPose = (rotPose + pas) % 360;
    if (enAttente) (enAttente.rot = (enAttente.rot + pas) % 360), afficherAttente();
    majFantome(layer.getRelativePointerPosition());
  } else if (k === 'r' && !ctrl) pivoterSelection();
});

addEventListener('beforeunload', (e) => {
  if (modifie) e.preventDefault();
});

rendre();
majProps();
majCoords();
majEtages();

// Reprise d'un travail non enregistré (fermeture d'onglet, plantage…).
// Proposée par un bandeau dans la page : une boîte native serait bloquée par certains navigateurs embarqués.
sauvegarde()
  .then((s) => {
    if (!s || s.enregistre) return;
    const quand = new Date(s.date).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
    const bandeau = $('reprise');
    bandeau.querySelector('span')!.textContent = `Travail non enregistré du ${quand} retrouvé.`;
    bandeau.hidden = false;
    $('b-ignorer').onclick = () => (bandeau.hidden = true);
    $('b-reprendre').onclick = () => {
      bandeau.hidden = true;
      try {
        etages = lireProjet(s.texte);
      } catch (err) {
        return annoncer((err as Error).message);
      }
      hist = new Historique(instantane());
      modifie = true;
      changerEtage(0);
    };
  })
  .catch(() => {}); // stockage indisponible (navigation privée…) : l'appli fonctionne sans
