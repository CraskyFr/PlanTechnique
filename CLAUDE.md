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
- `src/main.ts` — interface et canevas Konva. L'état `projet` est la source de vérité ; `rendre()` reconstruit les nœuds.

Les imports gardent l'extension `.ts` (nécessaire pour que Node lance les tests sans build).

## Feuille de route

1. **MVP (fait)** : import image/PDF, calibration, zoom/déplacement, calques, pose/rotation/suppression de symboles, annuler/rétablir, enregistrer/ouvrir JSON, export PDF (A4, image JPEG embarquée par `src/pdf.ts`, sans dépendance).
2. **Liaisons (fait)** : câbles et tuyaux en polylignes colorées par type (`LIAISONS` dans `symboles.ts`), propriétés par élément (hauteur de pose, repère, section), légende avec quantités et longueurs. Extrémités accrochées aux équipements du même calque (`Liaison.debut` / `fin` = id d'objet, `suivre()` les recale quand l'équipement bouge), poignées pour déplacer les points (`majPoignees()`).
3. **Structure (fait)** : calque Structure. Cloison, cloison à démolir et masque blanc sont des `LIAISONS` avec `epaisseur` (trait à l'échelle réelle) ; porte et fenêtre sont des `SYMBOLES` avec `mural` (largeur réelle, aimantés aux cloisons tracées via `aimanter()`). Pas encore : miroir de porte (sens des gonds), aimantation aux murs de l'image importée.
4. **Confort (fait)** : étages multiples (fichier `{ etages: [...] }`, anciens fichiers mono-étage toujours lus ; `projet` dans `main.ts` = étage affiché), cotes (`LIAISONS.cote`), nomenclature CSV (`nomenclature()`), impression à l'échelle via `window.print()` et `@page` (pas de bibliothèque PDF), verrou de calque.

Idées non faites : ajout/suppression de points sur une liaison existante, impression en mosaïque au-delà de l'A3. Export DXF écarté (inutile pour l'utilisateur).

Fait depuis : circuits électriques (`bilanCircuits()` dans `etat.ts`, panneau Circuits, circuit de pose), copier/coller/dupliquer (Ctrl+C/V/D), sauvegarde automatique dans IndexedDB avec reprise au démarrage, vérification par pièce (`manquesPiece()`, type de pièce mémorisé dans `Etage.pieces` par un point), suivi de chantier (`props.fait`, touche F, panneau Avancement).
