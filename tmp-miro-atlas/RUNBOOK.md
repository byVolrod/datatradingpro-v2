# Runbook reprise — refonte fond blanc + pose des 16 images (≈55 appels Miro, quota 100/jour)

Board JOT : https://miro.com/app/board/uXjVHsk2EPQ= · Board macro : https://miro.com/app/board/uXjVHsk2b3U=
Si le conteneur est neuf : `git fetch origin claude/miroir-branding-dtp-cwne7b && git checkout claude/miroir-branding-dtp-cwne7b` — tout est dans `tmp-miro-atlas/`.

## Étape 1 — Restyle fond blanc du board JOT (9 appels)
Envoyer chaque fichier `light-*.svg` TEL QUEL via `canvas_update_from_svg` (ils portent les data-miro-id ; ancrage/transform déjà corrects) :
light-entree.svg, light-confluences.svg, light-selection.svg, light-setupaz.svg, light-cloture.svg, light-optimisation.svg, light-stratman.svg, light-setuptypes.svg, light-galerie.svg.
Les croquis recouverts par les images Atlas sont blanchis (fill/stroke #ffffff) = « remplacés » sans consommer le quota de suppression.

## Étape 2 — Le Management (2 appels)
`canvas_read_as_svg` widget_ids=["3458764682168034955"] → sauver le SVG → `python3 recolor.py` avec un cfg : frame_id 3458764682168034955, transform "7000,2200", boxes = [[160,2140,2240,2710],[700,4180,1700,4760]] (zones des 2 images management-01/02) → `canvas_update_from_svg`.

## Étape 3 — Pose des 16 images (32 appels)
Voir PLAN.md (tableau fichier → cadre/x/y/width). Fichiers dans ce dossier. Flux : image_get_upload_url (miro_url `?moveToWidget=<cadre>`, title, x, y, width ; ancrage CENTRE) → curl PUT → image_create (token).

## Étape 4 — Board macro fond blanc (≈6 appels)
`canvas_read_as_svg` du board uXjVHsk2b3U= (entier) → découper par cadre → `recolor.py` (boxes=[] partout, les drapeaux sont des images donc ignorés) → un `canvas_update_from_svg` par cadre. Adapter la table de couleurs si le board macro utilise des teintes absentes du mapping (compléter FILL/STROKE/TXT dans recolor.py).

## Étape 5 — Audit d'alignement sur l'état réel (les light-*.svg sont déjà audités/corrigés hors-ligne)
Après application : relire 2-3 cadres échantillons + le board macro entier, et passer `audit.py` dessus
(adapter le dict IMAGES aux vraies boîtes d'images lues). Critères : aucun texte sur une image, aucun
chevauchement texte/texte, titres et légendes centrés sur leur schéma (tolérance 18 px), rien hors cadre.
Corriger les écarts par canvas_update ciblés. Appliquer les mêmes conventions sur le board macro :
bannières or centrées sur leur section, légendes à ~20 px sous les visuels, colonnes sans chevauchement.

## Étape 6 — Finitions
- Vérifier 2-3 cadres par canvas_read_as_svg ciblé (échantillon).
- `board_show` sur chaque board.
- Supprimer `tmp-miro-atlas/` de la branche (commit + push).
- Prévenir Saïd : refonte blanche des 2 tableaux + 39 schémas Atlas en place.

Palette claire appliquée : fond #ffffff · cartes #f6f7f9/#f3f4f6 bord #e2e3e8 · texte #16181f · secondaire #5f626e · titres or texte #b8860b · pastilles or #e3b23a texte #101014 · zones vertes #e3f7ec / rouges #fde9e2 / bleues #e8effc · vert #00e676, rouge #ff3d00 conservés · croquis restants tracés en #3f434e.
