# Reprise Miro — 16 images restantes (branche temporaire, à supprimer ensuite)

Tableau : https://miro.com/app/board/uXjVHsk2EPQ= (Méthode JOT — Playbook de trading)
Méthode : `image_get_upload_url` (avec miro_url `?moveToWidget=<frame>`, title, x, y, width) → `curl PUT` du PNG → `image_create` avec le token. Ancrage = CENTRE, coordonnées relatives au coin haut-gauche du cadre.

## Cadre « L'entrée » — 3458764682163242249 (0,2200 · 1900×8650)
| fichier | x | y | width |
|---|---|---|---|
| entree-break-pair.png | 950 | 1875 | 1300 |
| entree-reject-pair.png | 950 | 2590 | 1300 |
| entree-fakeout-pair.png | 950 | 3295 | 1300 |
| entree-retest-pair.png | 950 | 3990 | 1300 |
| entree-02.png (retest éclair/cloche) | 970 | 5310 | 1240 |
| entree-03.png (2R/4R/-0.5R) | 950 | 6395 | 1440 |
| entree-04.png (jumelle 1) | 950 | 7460 | 1290 |
| entree-05.png (jumelle 2) | 950 | 8280 | 1290 |

## Cadre « Le Management » — 3458764682168034955 (7000,2200 · 2400×5400)
| fichier | x | y | width |
|---|---|---|---|
| management-01.png (double graphique BE/trailing) | 1200 | 2425 | 2080 |
| management-02.png (graphique zone) | 1200 | 4470 | 1000 |

## Cadre « La clôture » — 3458764682167868698 (12380,2200 · 1920×4030)
| fichier | x | y | width |
|---|---|---|---|
| cloture-L-chart.png | 475 | 2665 | 650 |
| cloture-R.png | 1490 | 2475 | 620 |
| cloture-01.png (news & data) | 960 | 3635 | 900 |

## Cadre « Setup de A à Z » — 3458764682167788627 (24440,2200 · 2230×1460)
| fichier | x | y | width |
|---|---|---|---|
| setupaz-00-chart.png | 1830 | 270 | 660 |
| setupaz-01.png | 1830 | 740 | 475 |
| setupaz-02-chart.png | 1830 | 1210 | 531 |

## Cadre « Confluences & Filtres » — 3458764682163156267 (2300,2200 · 4300×2260)
| fichier | x | y | width |
|---|---|---|---|
| banques.png (capture desk, 3840×2010, dans ce dossier) | 3200 | 1530 | 600 |

Le light-confluences.svg supprime déjà l'image Atlas « Bank Trades » (3458764682169244712) et pose la légende (3458764682163156339 → « Banques du desk » à 2900,1710). Appliquer light-confluences.svg AVANT de poser banques.png.

Déjà posées (ne pas refaire) : Confluences (5 images Atlas sombres), Stratégie de management (7), Optimisation (6), Setup types (5), plus 7 captures du desk (3 Confluences + 4 galerie « Les outils du desk DTP » 3458764682168659508 à (27000,2200)).
Après pose : vérifier avec canvas_read_as_svg, faire board_show, puis SUPPRIMER ce dossier tmp-miro-atlas/ de la branche.
