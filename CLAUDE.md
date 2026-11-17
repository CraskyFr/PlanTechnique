# Plan technique

Éditeur de plans techniques (électricité, réseau, eau, chauffage) pour une rénovation.
Le plan Kazaplan (PDF ou image) sert de fond ; les éléments techniques sont dessinés par-dessus, par calque.

## Stack

Vite + TypeScript sans framework, Konva (canevas), pdfjs-dist (import PDF). Pas de backend : un projet = un fichier JSON (image de fond embarquée en data URL).

```bash
npm run dev    # http://localhost:5173
npm run build  # tsc + vite build
npm test       # node --test (Node ≥ 22.18, exécute le TS directement)
```

## Structure

- `src/symboles.ts` — calques et bibliothèque de symboles (tracés SVG en boîte 24×24). Ajouter un symbole = une ligne.
- `src/etat.ts` — modèle pur sans DOM : types, validation des fichiers ouverts, échelle, historique. Testé par `etat.test.ts`.
- `src/detection.ts` — reconnaissance pure (sans DOM) des murs, portes et fenêtres sur l'image du plan : masque de la teinte des murs, découpe en rectangles, ouvertures entre murs alignés. Mise au point sur un export Kazaplan A4 (image raster, murs gris pleins orthogonaux). Testé par `detection.test.ts`.
- `src/cotes.ts` — échelle automatique : lit les cotes magenta horizontales de Kazaplan (modèles de chiffres `MODELES` propres à cette police) et divise chaque valeur par la distance entre les deux murs qui l'encadrent ; ne retient que les cotes qui concordent à 1,5 %. Repli : saisie de la largeur hors tout.
- `src/pieces.ts` — pièces (zones fermées) d'une grille de murs et leurs traversées mur à mur. `main.ts` (`calculerCotes`) rastérise cloisons + ouvertures refermées, puis dessine les cotes automatiques violettes (calque « Cotes automatiques » ; le calque « Cotes manuelles » contient celles tracées à la main), recalculées seulement quand la structure change.
- `src/calculs.ts` — aides à la conception (pures, testées par `calculs.test.ts`) : protection et section par circuit, répartition sous différentiels (`tableau()`), montées de câbles, puissance de chauffage par pièce, diamètres d'alimentation, volumes de salle de bain. Règles simplifiées, affichées comme telles.
- `src/routage.ts` — tracé automatique (« Relier à… », « Relier au tableau ») : Dijkstra orthogonal sur une grille de 10 cm, qui longe les cloisons, les perce si la porte est loin et limite les coudes. Testé par `routage.test.ts`.
- `src/cotesAuto.ts` — `calculerCotes(cloisons, ouvertures, e)` : pièces et traits de cote à partir de la structure. Sans état, mais utilise un canevas (non testable sous Node).
- `src/unifilaire.ts` — `pdfUnifilaire()` : schéma unifilaire du tableau proposé, en PDF.
- `src/elevation.ts` — `elevations()` : murs de pièce vus de face (pure, testée par `elevation.test.ts`). Regroupe les cloisons alignées en murs (une ouverture ou un vide < 50 cm ne coupe pas le mur), découpe chaque face par pièce avec `numero` de `cotesAuto`, rattache chaque équipement depuis son point de contact avec le mur (centre reculé d'une demi-boîte selon sa rotation de pose, cf. `plaquerAuMur`), au mur parallèle à la pose d'abord ; une prise sous une fenêtre appartient à ce mur. Abscisse depuis l'angle gauche vu depuis la pièce, sans effet miroir.
- `src/dessinElevation.ts` — dessin d'une élévation (A4 paysage) ; `main.ts` : bouton « Élévation du mur » (Propriétés d'un équipement) et « Élévations des murs (PDF) » (Vérifier → Pièces, une page par mur équipé, `pdfDepuisJpegs`). Hors v1 : baignoire, douche, éléments au plafond ; hauteurs de portes et fenêtres = valeurs types affichées comme telles.
- `src/stockage.ts` — ce qui reste dans le navigateur : sauvegarde automatique (IndexedDB), prix du devis (localStorage).
- `src/dialogues.ts` — `annoncer()` (message non bloquant), `demanderTexte()`, `demanderAccord()` : jamais de `alert` / `prompt` / `confirm` natifs.
- `src/main.ts` — interface et canevas Konva. L'état `projet` est la source de vérité ; `rendre()` reconstruit les nœuds (≈ 40 ms pour 460 éléments : pas de rendu partiel tant que ça suffit). Ce qui reste ici dépend de l'état partagé (`projet`, `selection`, `outil`…) ; le découper davantage demande de regrouper cet état dans un objet. `pdfjs-dist` est chargé à la demande dans `importerFond`.

## Déploiement et sauvegarde en ligne

Projet Vercel `plan-technique` (équipe `salamander2`), relié à GitHub : chaque push sur `main` déploie sur https://plan.paulbodin.fr (DNS chez OVH). Usage personnel.

- `api/plans.ts` — fonction Vercel : liste, suppression et adresses signées (5 min) pour lire ou envoyer `plans/<nom>.json` dans le magasin Blob privé `plan-technique-plans`. Protégée par la variable d'environnement `MOT_DE_PASSE` (saisie par l'utilisateur dans Vercel, jamais dans le dépôt). 5 mots de passe faux depuis une IP la bloquent 15 min (compteurs `securite/<empreinte IP>.json` dans le même magasin) ; le pare-feu Vercel n'est pas accessible avec les droits de ce compte.
- `src/enLigne.ts` — côté navigateur ; boutons « ☁ Ouvrir » / « ☁ Enregistrer ». En local (`npm run dev`), `/api` n'existe pas : les boutons répondent que la sauvegarde ne fonctionne que sur le site déployé.

Les imports gardent l'extension `.ts` (nécessaire pour que Node lance les tests sans build).

## Feuille de route

1. **MVP (fait)** : import image/PDF, calibration, zoom/déplacement, calques, pose/rotation/suppression de symboles, annuler/rétablir, enregistrer/ouvrir JSON, export PDF (A4, image JPEG embarquée par `src/pdf.ts`, sans dépendance).
2. **Liaisons (fait)** : câbles et tuyaux en polylignes colorées par type (`LIAISONS` dans `symboles.ts`), propriétés par élément (hauteur de pose, repère, section), légende avec quantités et longueurs. Extrémités accrochées aux équipements du même calque (`Liaison.debut` / `fin` = id d'objet, `suivre()` les recale quand l'équipement bouge), poignées pour déplacer les points (`majPoignees()`).
3. **Structure (fait)** : calque Structure. Cloison, cloison à démolir et masque blanc sont des `LIAISONS` avec `epaisseur` (trait à l'échelle réelle) ; porte et fenêtre sont des `SYMBOLES` avec `mural` (largeur réelle, aimantés aux cloisons tracées via `aimanter()`). Miroir de porte : touche M ou bouton « Inverser les gonds ».
4. **Confort (fait)** : étages multiples (fichier `{ etages: [...] }`, anciens fichiers mono-étage toujours lus ; `projet` dans `main.ts` = étage affiché), cotes (`LIAISONS.cote`), nomenclature CSV (`nomenclature()`), impression à l'échelle via `window.print()` et `@page` (pas de bibliothèque PDF), verrou de calque.

Idées non faites : impression en mosaïque au-delà de l'A3. Export DXF écarté (inutile pour l'utilisateur).

Fait depuis : circuits électriques (`bilanCircuits()` dans `etat.ts`, panneau Circuits, circuit de pose), copier/coller/dupliquer (Ctrl+C/V/D), sauvegarde automatique dans IndexedDB avec reprise au démarrage, vérification par pièce (`manquesPiece()`, type de pièce mémorisé dans `Etage.pieces` par un point), suivi de chantier (`props.fait`, touche F, panneau Avancement), sélection multiple (`groupe` dans `main.ts` : Maj+clic, Maj+glisser, `deplacer()`), raccourcis d'outils (`RACCOURCIS`), bulle de survol, message « Supprimé — Annuler » (`annoncer()`), reprise par bandeau.
