# Plan technique

Éditeur de plans techniques pour une rénovation : électricité, réseau, eau et chauffage, dessinés par calques sur un plan Kazaplan importé en PDF ou en image.

Tout se passe dans le navigateur, sans serveur. Un projet est un fichier `.json` que l'on enregistre et rouvre.

## Lancer

Il faut Node 22.18 ou plus récent.

```bash
npm install
npm run dev
```

Puis ouvrir http://localhost:5173.

## Utiliser

1. **Importer un plan** (PDF ou image Kazaplan) : les murs, portes et fenêtres sont reconnus et l'échelle est lue sur les cotes.
2. **Dessiner** : choisir un symbole dans la palette, cliquer sur le plan, valider. Les câbles et tuyaux se tracent point par point, ou automatiquement avec « Relier au tableau ».
3. **Vérifier** : circuits et tableau, longueurs de réseaux, équipement par pièce, métré et devis, avancement du chantier.
4. **Enregistrer** le projet (`.json`), l'exporter en PDF ou l'imprimer à l'échelle.

Le bouton **?** de l'application liste tous les raccourcis. Le travail en cours est sauvegardé automatiquement dans le navigateur et proposé à la reprise au démarrage.

Les règles électriques (NF C 15-100), de chauffage et de plomberie sont simplifiées : elles aident à concevoir, elles ne remplacent pas l'avis d'un artisan.

## Développer

```bash
npm test       # tests de la logique (node --test)
npm run build  # vérification des types et build de production dans dist/
```

L'organisation du code est décrite dans [CLAUDE.md](CLAUDE.md).
