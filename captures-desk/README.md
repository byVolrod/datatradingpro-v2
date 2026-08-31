# Captures du desk DataTradingPro pour les tableaux Miro

Livraison demandée par la session « JOT - MIRRO » (demande validée par Saïd) : captures d'écran
des widgets du desk, prises dans le banc Chromium du projet (API bouchonnée, thème sombre,
`deviceScaleFactor: 2`). **Aucun fichier du produit n'est modifié par cette branche.**

## Fournies (7 sur 7, rien de sauté)

| Fichier | Contenu |
|---|---|
| `cot.png` | Carte **COT par devise** (EUR · Leveraged Funds) : verdict, donut long/short, positions et position nette. |
| `dmx.png` | **Sentiment particuliers** (DMX) : barres bidirectionnelles long/short par paire, légende. |
| `saisonnalite.png` | **Saisonnalité** EUR/USD : table thermique 2022-2026 + moyenne, mois courant marqué. |
| `force-devises.png` | **Force des Devises** : courbes des 8 majeures (amCharts), étiquettes de fin de courbe, périodes TD→1M. |
| `barometre.png` | **Baromètre des Devises** : égaliseur bidirectionnel segmenté, axe central, valeurs signées. |
| `calendrier.png` | **Calendrier économique** (widget) : filtres d'impact, semaine, lignes avec drapeaux et points d'impact. |
| `radar-biais.png` | Matrice du **Radar de Biais** (onglet BIAIS) : 8 devises × piliers macro, taux directeurs, biais. |

## À savoir avant intégration

- **Données d'essai réalistes**, injectées par le banc — ce ne sont PAS des données de production
  (chiffres plausibles d'août 2026, choisis pour une lecture pédagogique : camps nets, couleurs
  des deux sens visibles).
- Les **drapeaux** sont des SVG simplifiés servis hors ligne (flagcdn est inaccessible depuis le
  banc) : reconnaissables aux petites tailles du desk, mais pas les PNG officiels du produit en
  ligne.
- amCharts est servi localement au banc (CDN inaccessible) : le rendu des courbes est celui du
  produit.
- Échelle 2x : les PNG font le double de leur taille CSS, nets sur Miro même agrandis.
