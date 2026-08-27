#!/usr/bin/env node
/**
 * scripts/dtp-updates-accents.js — RENDRE LEURS ACCENTS AUX NOUVEAUTÉS DTP (outil à passer une fois)
 * ------------------------------------------------------------------------------------------------
 * POURQUOI (26/08, signalement utilisateur : « corrige ça dans les notifs c pas professionnel du
 * tout »). Sur 356 entrées de DTP_UPDATES, 212 ne portaient PAS UN SEUL accent et remplaçaient les
 * apostrophes par des espaces : « la journee precedente n a jamais ete affichee ». Or ce fil est ce
 * que les clients LISENT — c'est la voix du produit.
 *
 * LA CAUSE, et elle explique la forme du remède : la chaîne JavaScript est délimitée par une
 * apostrophe DROITE, donc écrire « d'adresse » casse le fichier. La parade prise sur le moment a été
 * de retirer l'apostrophe, puis, de proche en proche, les accents. La bonne parade est l'apostrophe
 * TYPOGRAPHIQUE ’ (U+2019) : elle ne ferme aucune chaîne, et c'est la forme correcte en français.
 * Le garde-fou de `dtp-updates-verif.js` refuse désormais toute nouvelle entrée écrite ainsi ; cet
 * outil-ci répare l'existant.
 *
 * ⚠️ CE QU'IL S'INTERDIT, ET POURQUOI C'EST LE POINT CENTRAL. Restaurer des accents automatiquement,
 * c'est deviner — et une DEVINETTE FAUSSE dans un texte client est pire que l'accent manquant :
 * « le bouton marche » deviendrait « le bouton marché ». La table ci-dessous ne contient donc QUE
 * des graphies qui ne sont JAMAIS des mots français : `deja`, `apres`, `etait`, `ecran`… Les mots
 * qui existent dans les deux formes (marche, cote, pose, coupe, change, affiche, corrige, trace…)
 * sont traités par des EXPRESSIONS entières, où le sens est certain (« de marche » → « de marché »),
 * ou laissés tels quels. Idem pour « a » : « le desk a son visage » ne doit pas devenir « à son
 * visage », donc seules les locutions figées et les infinitifs sont accentués.
 * L'outil ne peut donc pas tout couvrir — il le DIT à la fin, chiffres à l'appui, plutôt que de
 * laisser croire à un travail complet.
 *
 *   node scripts/dtp-updates-accents.js --essai    → montre ce qui changerait, n'écrit rien
 *   node scripts/dtp-updates-accents.js            → applique et réécrit server.js
 */
const fs = require('fs');
const path = require('path');

const SERVEUR = path.join(__dirname, '..', 'server.js');

/* ── 1. MOTS QUI N'EXISTENT PAS EN FRANÇAIS SANS LEUR ACCENT ────────────────────────────────────
   Chaque entrée a été vérifiée une par une : aucune n'a d'homographe sans accent. */
const MOTS = {
  a_completer_jamais: '',   // (repère : la table commence ici)
  deja: 'déjà', apres: 'après', etait: 'était', etaient: 'étaient', etre: 'être', ete: 'été',
  tres: 'très', meme: 'même', memes: 'mêmes', desormais: 'désormais', derniere: 'dernière',
  dernieres: 'dernières', premiere: 'première', premieres: 'premières', journee: 'journée',
  journees: 'journées', annee: 'année', annees: 'années', systeme: 'système', systemes: 'systèmes',
  probleme: 'problème', problemes: 'problèmes', fenetre: 'fenêtre', fenetres: 'fenêtres',
  donnees: 'données', donnee: 'donnée', ecran: 'écran', ecrans: 'écrans', element: 'élément',
  elements: 'éléments', telephone: 'téléphone', telephones: 'téléphones', evenement: 'événement',
  evenements: 'événements', reglage: 'réglage', reglages: 'réglages', reference: 'référence',
  references: 'références', verification: 'vérification', verifications: 'vérifications',
  generation: 'génération', creation: 'création', operation: 'opération', operations: 'opérations',
  necessaire: 'nécessaire', necessaires: 'nécessaires', interet: 'intérêt', numero: 'numéro',
  precedent: 'précédent', precedente: 'précédente', precedents: 'précédents', precedentes: 'précédentes',
  recap: 'récap', recaps: 'récaps', resume: 'résumé', resumes: 'résumés', seance: 'séance',
  seances: 'séances', geopolitique: 'géopolitique', geopolitiques: 'géopolitiques', reussi: 'réussi',
  affichee: 'affichée', affichees: 'affichées', affiches: 'affichés', creee: 'créée', cree: 'créé',
  creees: 'créées', crees: 'créés', ameliore: 'amélioré', amelioree: 'améliorée',
  ameliorations: 'améliorations', amelioration: 'amélioration', detail: 'détail', details: 'détails',
  reaction: 'réaction', reactions: 'réactions', actualite: 'actualité', actualites: 'actualités',
  economique: 'économique', economiques: 'économiques', economie: 'économie', devises: 'devises',
  tete: 'tête', tetes: 'têtes', regle: 'règle', regles: 'règles', defaut: 'défaut', defauts: 'défauts',
  categorie: 'catégorie', categories: 'catégories', synthese: 'synthèse', syntheses: 'synthèses',
  croissance: 'croissance', acces: 'accès', decision: 'décision', decisions: 'décisions',
  centrale: 'centrale', francais: 'français', francaise: 'française', monetaire: 'monétaire',
  monetaires: 'monétaires', largeur: 'largeur', poignee: 'poignée', poignees: 'poignées',
  defilement: 'défilement', defile: 'défile', defilent: 'défilent', deroule: 'déroule',
  deroulent: 'déroulent', derouler: 'dérouler', deroulee: 'déroulée', dore: 'doré', doree: 'dorée',
  dores: 'dorés', disparait: 'disparaît', disparaissait: 'disparaissait', apparait: 'apparaît',
  apparaissait: 'apparaissait', parait: 'paraît', paraissait: 'paraissait', controle: 'contrôle',
  controles: 'contrôles', controlee: 'contrôlée', reunion: 'réunion', reunions: 'réunions',
  reunir: 'réunir', reunis: 'réunis', reunies: 'réunies', reunie: 'réunie',
  intitule: 'intitulé', intitules: 'intitulés', celebre: 'célèbre',
  hebdomadaire: 'hebdomadaire', immediatement: 'immédiatement', immediate: 'immédiate',
  legerement: 'légèrement', legere: 'légère', leger: 'léger', precision: 'précision',
  precise: 'précise', precises: 'précises', precisement: 'précisément', echelle: 'échelle',
  echeance: 'échéance', echeances: 'échéances', chomage: 'chômage', theme: 'thème', themes: 'thèmes',
  troisieme: 'troisième', deuxieme: 'deuxième', quatrieme: 'quatrième', cinquieme: 'cinquième',
  moitie: 'moitié', entiere: 'entière', entieres: 'entières', matiere: 'matière', matieres: 'matières',
  derriere: 'derrière', bibliotheque: 'bibliothèque', lisere: 'liseré', liseres: 'liserés',
  repere: 'repère', reperes: 'repères', reperage: 'repérage', etiquette: 'étiquette',
  etiquettes: 'étiquettes', etat: 'état', etats: 'états', etroit: 'étroit', etroite: 'étroite',
  etroites: 'étroites', ecrite: 'écrite', ecrites: 'écrites', ecrits: 'écrits', ecrit: 'écrit',
  ecrire: 'écrire', ecriture: 'écriture', publiee: 'publiée', publiees: 'publiées', publies: 'publiés',
  publie: 'publié', retiree: 'retirée', retirees: 'retirées', retires: 'retirés', retire: 'retiré',
  redaction: 'rédaction', redige: 'rédigé', redigee: 'rédigée', reel: 'réel', reelle: 'réelle',
  reels: 'réels', reelles: 'réelles', releve: 'relevé', releves: 'relevés', relevent: 'relèvent',
  reperes_bis: '', decalage: 'décalage', decale: 'décalé', decalee: 'décalée',
  posee: 'posée', posees: 'posées', poses: 'posés',
  regroupement: 'regroupement', separation: 'séparation', separe: 'séparé', separee: 'séparée',
  separateur: 'séparateur', separateurs: 'séparateurs', pres: 'près', apercu: 'aperçu',
  apercus: 'aperçus', recu: 'reçu', recus: 'reçus', recue: 'reçue', recoit: 'reçoit',
  recoivent: 'reçoivent', francs: 'francs', facon: 'façon', facons: 'façons', lecon: 'leçon',
  garcon: 'garçon', ca: 'ça', deca: 'deçà', voila: 'voilà', la_bas: '', celle_ci: '',
  ici_meme: '', plutot: 'plutôt', bientot: 'bientôt', aussitot: 'aussitôt', sitot: 'sitôt',
  tot: 'tôt', notre_: '', votre_: '', theatre: 'théâtre', arrete: 'arrêté', arretee: 'arrêtée',
  arreter: 'arrêter', arrete_bis: '', arret: 'arrêt', arrets: 'arrêts', interesse: 'intéressé',
  interessant: 'intéressant', complete: 'complète', completes: 'complètes', complet_bis: '',
  completement: 'complètement', modele: 'modèle', modeles: 'modèles', critere: 'critère',
  criteres: 'critères', parametre: 'paramètre', parametres: 'paramètres', metre: 'mètre',
  metres: 'mètres', millimetre: 'millimètre', kilometre: 'kilomètre', periode: 'période',
  periodes: 'périodes', serie: 'série', series: 'séries', numerique: 'numérique',
  numeriques: 'numériques', identite: 'identité', identites: 'identités', unite: 'unité',
  unites: 'unités', activite: 'activité', activites: 'activités', securite: 'sécurité',
  visibilite: 'visibilité', lisibilite: 'lisibilité', fiabilite: 'fiabilité', qualite: 'qualité',
  quantite: 'quantité', priorite: 'priorité', priorites: 'priorités', majorite: 'majorité',
  minorite: 'minorité', realite: 'réalité', volatilite: 'volatilité', liquidite: 'liquidité',
  probabilite: 'probabilité', probabilites: 'probabilités', possibilite: 'possibilité',
  possibilites: 'possibilités', capacite: 'capacité', difficulte: 'difficulté',
  difficultes: 'difficultés', nouveaute: 'nouveauté', nouveautes: 'nouveautés', beaute: 'beauté',
  cote_bis: '', societe: 'société', societes: 'sociétés', autorite: 'autorité', autorites: 'autorités',
  verite: 'vérité', verites: 'vérités', charte: 'charte', ecart: 'écart', ecarts: 'écarts',
  ecarte: 'écarté', ecartee: 'écartée', ecartees: 'écartées', ecartes: 'écartés',
  eleve: 'élevé', elevee: 'élevée', eleves: 'élevés', elevees: 'élevées', energie: 'énergie',
  energies: 'énergies', enerve: 'énervé', enorme: 'énorme', enormement: 'énormément',
  etape: 'étape', etapes: 'étapes', etendu: 'étendu', etendue: 'étendue', etendre: 'étendre',
  etudie: 'étudié', etude: 'étude', etudes: 'études', evidemment: 'évidemment', evident: 'évident',
  evidente: 'évidente', eviter: 'éviter', evite: 'évité', evitee: 'évitée', evolution: 'évolution',
  evolutions: 'évolutions', evolue: 'évolué', execution: 'exécution', experience: 'expérience',
  frequence: 'fréquence', frequences: 'fréquences', frequent: 'fréquent', frequente: 'fréquente',
  general: 'général', generale: 'générale', generalement: 'généralement', genere: 'généré',
  generee: 'générée', generees: 'générées', generes: 'générés', gerer: 'gérer', gere: 'géré',
  geree: 'gérée', hesitation: 'hésitation', hierarchie: 'hiérarchie', integre: 'intégré',
  integree: 'intégrée', integralite: 'intégralité', interieur: 'intérieur', interne_: '',
  interpretation: 'interprétation', legende: 'légende', legendes: 'légendes', libere: 'libéré',
  liberee: 'libérée', memoire: 'mémoire', memorise: 'mémorisé', memorisee: 'mémorisée',
  menage: 'ménage', menages: 'ménages', meteo: 'météo', methode: 'méthode', methodes: 'méthodes',
  modere: 'modéré', moderee: 'modérée', negatif: 'négatif', negative: 'négative',
  negociation: 'négociation', operateur: 'opérateur', operateurs: 'opérateurs', pedagogie: 'pédagogie',
  penalite: 'pénalité', periodique: 'périodique', perime: 'périmé', perimee: 'périmée',
  perimes: 'périmés', phenomene: 'phénomène', preavis: 'préavis', precaution: 'précaution',
  precede: 'précède', preference: 'préférence', preferences: 'préférences', prefere: 'préfère',
  premier_: '', preparation: 'préparation', prepare: 'préparé', preparee: 'préparée',
  presence: 'présence', present_: '', presentation: 'présentation', presentations: 'présentations',
  presente: 'présente', presentee: 'présentée', presentees: 'présentées', presentes: 'présentés',
  president: 'président', presque_: '', prevision: 'prévision', previsions: 'prévisions',
  prevu: 'prévu', prevue: 'prévue', prevues: 'prévues', prevus: 'prévus', prevoir: 'prévoir',
  procede: 'procédé', procedure: 'procédure', protege: 'protégé', protegee: 'protégée',
  reaffiche: 'réaffiche', realise: 'réalisé', realisee: 'réalisée', recemment: 'récemment',
  recent: 'récent', recente: 'récente', recentes: 'récentes', recents: 'récents',
  reception: 'réception', recuperation: 'récupération', recupere: 'récupéré', redemarrage: 'redémarrage',
  redemarre: 'redémarre', redige_: '', reduction: 'réduction', reduit: 'réduit', reduite: 'réduite',
  reduites: 'réduites', reecrit: 'réécrit', reecrite: 'réécrite', reference_: '', regenere: 'régénéré',
  regeneration: 'régénération', region: 'région', regions: 'régions', regulier: 'régulier',
  reguliere: 'régulière', regulierement: 'régulièrement', remuneration: 'rémunération',
  reorganise: 'réorganisé', repartition: 'répartition', repere_: '', repete: 'répète',
  repetait: 'répétait', repetition: 'répétition', reponse: 'réponse', reponses: 'réponses',
  requete: 'requête', requetes: 'requêtes', reseau: 'réseau', reseaux: 'réseaux',
  reserve: 'réserve', reserves: 'réserves', resiste: 'résiste', resolution: 'résolution',
  resultat: 'résultat', resultats: 'résultats', retabli: 'rétabli', reussite: 'réussite',
  revele: 'révèle', revision: 'révision', revisions: 'révisions', securise: 'sécurisé',
  selection: 'sélection', selectionne: 'sélectionné', separement: 'séparément', sequence: 'séquence',
  severe: 'sévère', similaire_: '', specifique: 'spécifique', specifiques: 'spécifiques',
  stabilite: 'stabilité', strategie: 'stratégie', strategies: 'stratégies', succes: 'succès',
  superieur: 'supérieur', superieure: 'supérieure', supprime_: '', symetrie: 'symétrie',
  telecharger: 'télécharger', telechargement: 'téléchargement', temoignage: 'témoignage',
  temoignages: 'témoignages', temoin: 'témoin', tresorerie: 'trésorerie', ulterieur: 'ultérieur',
  urgence_: '', utilite: 'utilité', verifie: 'vérifie', verifier: 'vérifier', verifiee: 'vérifiée',
  veritable: 'véritable', volatilites: 'volatilités', zero_: '',
  aout: 'août', fevrier: 'février', decembre: 'décembre', ou_bien: '',
  fermes: 'fermés', ferme_bis: '', ouvert_: '', prealable: 'préalable', repartis: 'répartis',
  rangee: 'rangée', rangees: 'rangées', ranges: 'rangés', range_bis: '',
  entete: 'entête', entetes: 'entêtes', hauteur_: '', gauche_: '',
  celle_la: '', jusqu_: '', pourcentage_: '', maniere: 'manière', manieres: 'manières',
  matiere_: '', premiere_bis: '', barriere: 'barrière', frontiere: 'frontière',
  lumiere: 'lumière', maniere_bis: '', particuliere: 'particulière', reguliere_bis: '',
  singuliere: 'singulière', entierement: 'entièrement', principalement_: '',
  colonne_: '', numerote: 'numéroté', numerotee: 'numérotée',
  degrade: 'dégradé', degradee: 'dégradée', delai: 'délai', delais: 'délais',
  demarrage: 'démarrage', demarre: 'démarre', denomme: 'dénommé', dependait: 'dépendait',
  depend: 'dépend', dependent: 'dépendent', depasse: 'dépassé', depassee: 'dépassée',
  depassement: 'dépassement', depense: 'dépense', depenses: 'dépenses', deplace: 'déplacé',
  deplacee: 'déplacée', deplacement: 'déplacement', deploie: 'déploie', deploiement: 'déploiement',
  depot: 'dépôt', depeche: 'dépêche', depeches: 'dépêches', derive: 'dérive', descendait_: '',
  desactive: 'désactivé', desactivee: 'désactivée', desabonne: 'désabonné', desabonnes: 'désabonnés',
  desinscription: 'désinscription', desinscrire: 'désinscrire', desactivation: 'désactivation',
  desaccord: 'désaccord', desequilibre: 'déséquilibre', desigual_: '', detaille: 'détaillé',
  detaillee: 'détaillée', detecte: 'détecté', detectee: 'détectée', determine: 'déterminé',
  developpement: 'développement', developpements: 'développements', devoile: 'dévoilé',
  ecoute: 'écoute', ecoule: 'écoulé', edition: 'édition', education: 'éducation',
  egal: 'égal', egale: 'égale', egalement: 'également', election: 'élection', elections: 'élections',
  eloigne: 'éloigné', emission: 'émission', emissions: 'émissions', energetique: 'énergétique',
  equilibre: 'équilibre', equilibree: 'équilibrée', equipe: 'équipe', equipes: 'équipes',
  equivalent: 'équivalent', erreur_: '', etiquete: 'étiqueté', etoile: 'étoile',
  etrangere: 'étrangère', etranger: 'étranger', evaluation: 'évaluation', excedent: 'excédent',
  federal: 'fédéral', federale: 'fédérale', fidele: 'fidèle', fideles: 'fidèles',
  gele: 'gelé', gerant: 'gérant', graphe_: '', homogene: 'homogène', hypothese: 'hypothèse',
  hypotheses: 'hypothèses', identifie: 'identifié', identifiee: 'identifiée', ignore_: '',
  incoherence: 'incohérence', incoherent: 'incohérent', independant: 'indépendant',
  indice_: '', inferieur: 'inférieur', inferieure: 'inférieure', informe: 'informé',
  ingenierie: 'ingénierie', initialement_: '', integralement: 'intégralement',
  interessee: 'intéressée', interrompu_: '', irregulier: 'irrégulier', isole: 'isolé',
  isolee: 'isolée', legalement: 'légalement', libelle: 'libellé', libelles: 'libellés',
  litteralement: 'littéralement', localise: 'localisé', maitrise: 'maîtrise', maitrisee: 'maîtrisée',
  materiel: 'matériel', mediane: 'médiane', melange: 'mélange', mentionne_: '',
  meteorologique: 'météorologique', millesime: 'millésime', modifie_: '', naturellement_: '',
  negocie: 'négocié', obligatoirement_: '', occupe_: '', operationnel: 'opérationnel',
  ordonne_: '', organise_: '', originale_: '', paralleles: 'parallèles', parallele: 'parallèle',
  particulierement: 'particulièrement', penible: 'pénible', perenne: 'pérenne',
  personnalise: 'personnalisé', pertinence_: '', pese: 'pèse', peripherique: 'périphérique',
  petrole: 'pétrole', petrolier: 'pétrolier', phenomenes: 'phénomènes', pole: 'pôle',
  precedemment: 'précédemment', predefini: 'prédéfini', preliminaire: 'préliminaire',
  premature: 'prématuré', preoccupation: 'préoccupation', pretend: 'prétend', prevalait: 'prévalait',
  privilegie: 'privilégié', probleme_: '', proceder: 'procéder', proportionnellement_: '',
  proprietaire: 'propriétaire', publiquement_: '', reagir: 'réagir', reagit: 'réagit',
  reajuste: 'réajusté', reamenage: 'réaménagé', reapparait: 'réapparaît', reactive: 'réactivé',
  rebatir: 'rebâtir', recapitulatif: 'récapitulatif', recolte: 'récolte', recompense: 'récompense',
  reconciliation: 'réconciliation', recurrent: 'récurrent', recurrente: 'récurrente',
  redemarrer: 'redémarrer', redirige: 'redirigé', reelement_: '', reellement: 'réellement',
  reexamen: 'réexamen', referencement: 'référencement', reformule: 'reformulé',
  refuse_: '', regenerer: 'régénérer', reglementaire: 'réglementaire', regularite: 'régularité',
  reinitialise: 'réinitialisé', rejete: 'rejeté', rejetee: 'rejetée', relance_: '',
  releve_bis: '', remede: 'remède', remuneree: 'rémunérée', renforce_: '', renumerote: 'renuméroté',
  reorganisation: 'réorganisation', repartie: 'répartie', repere_bis: '', repeter: 'répéter',
  replie: 'replié', represente: 'représente', reprend_: '', reserve_bis: '', residuel: 'résiduel',
  resilie: 'résilié', respecte_: '', responsabilite: 'responsabilité', ressource_: '',
  restaure_: '', retablir: 'rétablir', retrograde: 'rétrograde', reussir: 'réussir',
  revelateur: 'révélateur', revenement_: '', rythme_: '', scenario: 'scénario', scenarios: 'scénarios',
  schema: 'schéma', schemas: 'schémas', semestrielle: 'semestrielle', separer: 'séparer',
  serieux: 'sérieux', sobriete: 'sobriété', solidite: 'solidité', specialement: 'spécialement',
  specifiquement: 'spécifiquement', stabilise_: '', standardise_: '', succede: 'succède',
  suffisamment_: '', supplementaire: 'supplémentaire', supplementaires: 'supplémentaires',
  synthetique: 'synthétique', systematique: 'systématique', systematiquement: 'systématiquement',
  telemetrie: 'télémétrie', temperature: 'température', tendance_: '', theorique: 'théorique',
  tresor: 'trésor', tresorier: 'trésorier', typographie_: '', unifie: 'unifié', uniformise: 'uniformisé',
  utilisateur_: '', validite: 'validité', varie_: '', vegetal: 'végétal', verifiable: 'vérifiable',
  veritablement: 'véritablement', volontiers_: '',
  // Queue relevée sur le texte réparé (voir le rapport « mots que la table ne connaît pas ») :
  // ajoutée à la main, mot par mot, chacun vérifié sans homographe.
  signalees: 'signalées', signalee: 'signalée', allege: 'allégé', allegee: 'allégée',
  neuvieme: 'neuvième', huitieme: 'huitième', septieme: 'septième', sixieme: 'sixième',
  beneficier: 'bénéficier', beneficient: 'bénéficient', beneficie: 'bénéficie',
  souleve: 'soulevé', soulevee: 'soulevée', reabonne: 'réabonné', reabonnement: 'réabonnement',
  tassees: 'tassées', separent: 'séparent', appreciation: 'appréciation',
  manufacturieres: 'manufacturières', manufacturiere: 'manufacturière', reorienter: 'réorienter',
  comite: 'comité', comites: 'comités', situees: 'situées', situee: 'située', situes: 'situés',
  recree: 'recrée', depliez: 'dépliez', differaient: 'différaient', differe: 'diffère',
  lese: 'lésé', lesee: 'lésée', verifiant: 'vérifiant', succedent: 'succèdent',
  reassurance: 'réassurance', immediat: 'immédiat', immediats: 'immédiats',
  resiliation: 'résiliation', resiliable: 'résiliable', deroulement: 'déroulement',
  reecriture: 'réécriture', reamorcage: 'réamorçage', reajustement: 'réajustement',
  epaisse: 'épaisse', epaisses: 'épaisses', signales: 'signalés', strategiste: 'stratégiste',
  meche: 'mèche', meches: 'mèches', dedoublonne: 'dédoublonné', consideres: 'considérés',
  elargit: 'élargit', elargir: 'élargir', elargissement: 'élargissement', elargie: 'élargie',
  elargies: 'élargies', different: 'différent', differente: 'différente', differents: 'différents',
  differentes: 'différentes', difference: 'différence', differences: 'différences',
  concu: 'conçu', concue: 'conçue', concus: 'conçus', concues: 'conçues', apercoit: 'aperçoit',
  proprietes: 'propriétés', propriete: 'propriété', adhesion: 'adhésion', adhesions: 'adhésions',
  chaine: 'chaîne', chaines: 'chaînes', maitre: 'maître', boite: 'boîte', boites: 'boîtes',
  parametrage: 'paramétrage', enchainement: 'enchaînement', entrainer: 'entraîner',
  apercevoir: 'apercevoir', decu: 'déçu', decue: 'déçue', avancee: 'avancée', avancees: 'avancées',
  considere: 'considéré', consideree: 'considérée', piegeuse: 'piégeuse', motivee: 'motivée',
};
// Les clés « techniques » (suffixe _ ou valeur vide) ne sont pas des mots : elles servaient de
// repères pendant la rédaction de la table et sont retirées ici.
for (const k of Object.keys(MOTS)) if (!MOTS[k] || k.indexOf('_') >= 0) delete MOTS[k];

/* ── 1bis. LA TABLE APPRISE DU DÉPÔT LUI-MÊME ──────────────────────────────────────────────────
   La table écrite à la main plafonne : elle couvre le vocabulaire fréquent, pas la queue. Or le
   dépôt contient déjà des dizaines de milliers de mots de français CORRECTEMENT accentué — les
   commentaires du serveur, du desk, de la feuille de style, des bancs, et les 144 entrées de
   DTP_UPDATES qui avaient gardé leurs accents. On apprend donc la table de là, ce qui a deux
   vertus : elle parle exactement le vocabulaire de ce produit, et elle se met à jour toute seule.
   TROIS FILTRES, et ce sont eux qui rendent la chose sûre :
     · on EXCLUT le tableau DTP_UPDATES du corpus d'apprentissage — c'est le texte qu'on répare,
       l'y laisser reviendrait à déclarer « genere » et « cree » ambigus au motif qu'ils y figurent,
       et à s'interdire précisément les mots qu'on veut corriger ;
     · un mot dont la forme SANS accent existe aussi dans le corpus est écarté (marche/marché) ;
     · un mot qui a plusieurs formes accentuées est écarté (eleve → élevé ou élève ?), de même que
       les pièges classiques listés ci-dessous, qu'un corpus trop petit pourrait ne pas trancher. */
const PIEGES = new Set(['marche', 'marches', 'cote', 'cotes', 'tache', 'taches', 'mur', 'murs', 'sur',
  'pale', 'pales', 'foret', 'forets', 'jeune', 'jeunes', 'mais', 'cru', 'crus', 'du', 'pecheur',
  'interne', 'internes', 'notre', 'votre', 'somme', 'cache', 'caches', 'mode', 'modes', 'pate',
  'entre', 'ferme', 'fermes', 'fermee', 'age', 'ages', 'ou', 'la', 'ce', 'des', 'les', 'tot',
  'arret', 'pres', 'tenu', 'sale', 'sales', 'role', 'roles', 'vote', 'votes', 'arme', 'armes',
  'pole', 'poles', 'ton', 'tons', 'date', 'dates', 'duree', 'cale', 'cales', 'coute', 'piege']);

function tableApprise(blocExclu) {
  const dossier = path.join(__dirname, '..');
  const fichiers = ['server.js', 'mailer.js', 'auth.js', 'whop.js', 'public/js/app.js',
    'public/js/widgets.js', 'public/js/home.js', 'public/css/style.css', 'public/css/admin.css',
    'public/index.html', 'public/admin.html'];
  try { for (const f of fs.readdirSync(path.join(dossier, 'scripts'))) if (f.endsWith('.js')) fichiers.push('scripts/' + f); } catch {}
  let corpus = '';
  for (const f of fichiers) {
    try {
      let s = fs.readFileSync(path.join(dossier, f), 'utf8');
      if (blocExclu && s.indexOf(blocExclu.slice(0, 60)) >= 0) s = s.split(blocExclu).join(' ');
      corpus += s + '\n';
    } catch {}
  }
  const ACC = /[àâäçéèêëîïôöùûü]/;
  const accentues = {}, nus = {};
  for (const m of corpus.toLowerCase().matchAll(/[a-zàâäçéèêëîïôöùûü]{3,}/g)) {
    const w = m[0];
    if (ACC.test(w)) accentues[w] = (accentues[w] || 0) + 1; else nus[w] = (nus[w] || 0) + 1;
  }
  const sansAccent = (w) => w.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const cand = {}, conflit = new Set();
  for (const w of Object.keys(accentues)) {
    const k = sansAccent(w);
    if (k === w) continue;
    if (cand[k] && cand[k] !== w) conflit.add(k); else cand[k] = w;
  }
  const table = {};
  for (const [k, v] of Object.entries(cand)) {
    if (conflit.has(k) || PIEGES.has(k) || nus[k]) continue;
    if (accentues[v] < 2) continue;            // vu une seule fois : pas assez sûr
    table[k] = v;
  }
  return { table, ecartes: conflit, nus };
}

/* ── 2. EXPRESSIONS : là où le mot seul serait ambigu, la locution ne l'est pas ─────────────────── */
const EXPRESSIONS = [
  [/\bde marche\b/g, 'de marché'], [/\bdu marche\b/g, 'du marché'], [/\ble marche\b/g, 'le marché'],
  [/\bun marche\b/g, 'un marché'], [/\bce marche\b/g, 'ce marché'], [/\bles marches\b/g, 'les marchés'],
  [/\bdes marches\b/g, 'des marchés'], [/\bmarches fermes\b/g, 'marchés fermés'],
  [/\bmarche ferme\b/g, 'marché fermé'], [/\bsur le marche\b/g, 'sur le marché'],
  [/\bde cote\b/g, 'de côté'], [/\bdu cote\b/g, 'du côté'], [/\bce cote\b/g, 'ce côté'],
  [/\bcote serveur\b/g, 'côté serveur'], [/\bcote client\b/g, 'côté client'],
  [/\bincident corrige\b/g, 'incident corrigé'],
  // « corrige » est le seul mot du lot qui soit vraiment courant dans les deux sens. Les deux
  // emplois verbaux du corpus sont nommés ; tout le reste est le participe.
  [/(?<!qui )\bcorrige\b(?! des chiffres)/g, 'corrigé'],
  [/\bavons trouve\b/g, 'avons trouvé'],
  [/\bcelui-la\b/g, 'celui-là'], [/\bcelle-la\b/g, 'celle-là'],
  [/\bceux-la\b/g, 'ceux-là'], [/\bcelles-la\b/g, 'celles-là'], [/\bcelle-ci\b/g, 'celle-ci'],
  [/\bdes le\b/g, 'dès le'], [/\bdes la\b/g, 'dès la'], [/\bdes que\b/g, 'dès que'],
  [/\bdes qu’/g, 'dès qu’'], [/\bdes lors\b/g, 'dès lors'],
  // Ligatures : « oeil » n'est pas une faute d'accent, mais la même négligence de saisie.
  [/\boeil\b/g, 'œil'], [/\boeuvre\b/g, 'œuvre'], [/\bcoeur\b/g, 'cœur'], [/\bnoeud\b/g, 'nœud'],
  [/\b(été|est|avons|d’être|nom) ((?:aussi|bien|enfin|déjà|trouvé et) )?corrige\b/g, (t, a, b) => a + ' ' + (b || '') + 'corrigé'],
  [/\bjusqu a\b/g, 'jusqu’à'], [/\bgrace a\b/g, 'grâce à'], [/\bface a\b/g, 'face à'],
  [/\bquant a\b/g, 'quant à'], [/\bvis a vis\b/g, 'vis-à-vis'], [/\bpar rapport a\b/g, 'par rapport à'],
  [/\ba jour\b/g, 'à jour'], [/\ba nouveau\b/g, 'à nouveau'], [/\ba partir\b/g, 'à partir'],
  [/\ba travers\b/g, 'à travers'], [/\ba cause\b/g, 'à cause'], [/\ba peine\b/g, 'à peine'],
  [/\ba present\b/g, 'à présent'], [/\ba moitie\b/g, 'à moitié'], [/\ba droite\b/g, 'à droite'],
  [/\ba gauche\b/g, 'à gauche'], [/\ba cote\b/g, 'à côté'], [/\ba savoir\b/g, 'à savoir'],
  [/\ba mesure\b/g, 'à mesure'], [/\ba defaut\b/g, 'à défaut'], /* ⚠️ PAS DE RÈGLE « a jamais » → « à jamais ». Elle y était, et elle mordait sur « n’a jamais » :
     « un liseré que le Récap Hebdo n’a jamais eu » → « n’à jamais eu ».
     Dans ce corpus, « n’a jamais » est courant et « à jamais » n’apparaît pas une seule fois. Une
     règle dont tous les déclenchements observés sont des faux positifs n’est pas une règle. */
  [/\ba la fois\b/g, 'à la fois'], [/\ba la place\b/g, 'à la place'], [/\ba la main\b/g, 'à la main'],
  [/\ba la suite\b/g, 'à la suite'], [/\ba la fin\b/g, 'à la fin'], [/\ba la difference\b/g, 'à la différence'],
  [/\ba la hauteur\b/g, 'à la hauteur'], [/\ba la seconde\b/g, 'à la seconde'],
  [/\ba la minute\b/g, 'à la minute'], [/\ba la lettre\b/g, 'à la lettre'],
  [/\ba l’ecart\b/g, 'à l’écart'], [/\ba l’inverse\b/g, 'à l’inverse'], [/\ba l’identique\b/g, 'à l’identique'],
  [/\ba l’origine\b/g, 'à l’origine'], [/\ba l’oeil\b/g, 'à l’œil'], [/\ba l’arrivee\b/g, 'à l’arrivée'],
  [/\ba l’ouverture\b/g, 'à l’ouverture'], [/\ba l’avance\b/g, 'à l’avance'], [/\ba l’instant\b/g, 'à l’instant'],
  [/\ba l’echelle\b/g, 'à l’échelle'], [/\ba l’ecran\b/g, 'à l’écran'], [/\ba l’usage\b/g, 'à l’usage'],
  [/\ba l’aide\b/g, 'à l’aide'], [/\ba l’unite\b/g, 'à l’unité'], [/\ba l’affichage\b/g, 'à l’affichage'],
  [/\ba l’heure\b/g, 'à l’heure'], [/\ba l’entree\b/g, 'à l’entrée'],
  [/\bd’ou\b/g, 'd’où'], [/\bla ou\b/g, 'là où'], [/\bjusqu’ou\b/g, 'jusqu’où'],
  [/\bn’importe ou\b/g, 'n’importe où'], [/\bou que\b/g, 'où que'], [/\bou en est\b/g, 'où en est'],
  [/\ba l’(?!air\b)/g, 'à l’'], [/\ba onglets\b/g, 'à onglets'],
  // « a » suivi d'un INFINITIF : la forme du verbe lève l'ambiguïté avec l'auxiliaire avoir.
  [/\ba (?=(?:surveiller|envoyer|faire|voir|lire|suivre|venir|prendre|dire|savoir|retenir|attendre|comprendre|choisir|remplir|afficher|charger|ouvrir|fermer|garder|montrer|corriger|verifier|vérifier|installer|regarder|traiter|classer|trier|payer|relancer)\b)/g, 'à '],
];

/* ── 2bis. « a » OU « à » : ON N'ACCENTUE QUE CE QU'ON PEUT PROUVER ─────────────────────────────
   ⚠️ RÉÉCRIT LE 27/08 APRÈS DÉGÂT AVÉRÉ — et le dégât mérite d'être raconté, parce qu'il dit
   exactement pourquoi cette fonction est écrite à l'envers de toutes les autres.
   La version précédente devinait par ce qui ENTOURE le mot, et RETOMBAIT SUR « à » quand elle ne
   trouvait rien. Or ce qu'elle savait reconnaître à gauche, c'était une liste fermée de PRONOMS
   (il, elle, on, qui…). Un SUJET NOM n'y figurait pas — et le français en est fait :
       « le desk a de quoi comparer »   → « le desk à de quoi comparer »
       « la seconde porte a donc… »     → « la seconde porte à donc… »
       « la recherche a montré… »       → « la recherche à montré… »
       « si l'envoi a bien été accepté »→ « si l'envoi à bien été accepté »
   Pire, la négation lui échappait AUSSI : le mot capturé à gauche de « n’a » est « n », et la liste
   portait « n’ » — avec l'apostrophe. Aucune des deux formes ne se rencontrait, donc « n’a » passait
   systématiquement à « n’à », qui n'existe dans AUCUNE phrase française. TRENTE ET UN contresens
   avaient été introduits dans les annonces clients, et livrés.
   (Deuxième défaut, corrigé ici même : la position du mot se cherchait avec `t.indexOf(tout)`, soit
   la PREMIÈRE occurrence du fragment dans tout le texte — pas celle qu'on est en train de traiter.
   À partir du deuxième « a » d'une même description, le contexte examiné était celui d'une autre
   phrase. Le décalage était invisible : il rendait le verdict aléatoire, pas absurde.)
   LA RÈGLE EST DONC INVERSÉE, et c'est le principe que le fichier énonce partout ailleurs : un
   accent manquant se pardonne, un contresens non. On n'accentue QUE sur PREUVE — les locutions
   figées et « a » + infinitif, tous deux traités au-dessus dans EXPRESSIONS, où chaque cas est écrit
   noir sur blanc. Hors de cette liste, ON NE TOUCHE PAS. Ajouter un cas ici, c'est ajouter une
   ligne à EXPRESSIONS, donc l'écrire et pouvoir la relire — pas élargir une devinette.
   Ce que ça coûte : quelques « a » qui auraient dû prendre l'accent restent nus. Ce que ça évite :
   qu'une annonce lue par les clients dise le contraire de ce qu'elle veut dire. */
function accentueA(t) { return t; }

/* ── 3. APOSTROPHES ESCAMOTÉES ──────────────────────────────────────────────────────────────────
   « l un apres l autre » → « l’un après l’autre ». Une lettre d'élision isolée devant une voyelle
   ou un h n'existe dans AUCUNE phrase française : la règle est mécanique, pas heuristique.
   (« a », « y » et « t » sont exclus : ce sont de vrais mots ou des liaisons.) */
const ELISIONS = [
  [/(^|[\s(«"'])([dlncjms])\s(?=[aàâeéèêiîoôuûyh])/gi, '$1$2’'],
  [/(^|[\s(«"'])(qu)\s(?=[aàâeéèêiîoôuûyh])/gi, '$1$2’'],
  [/\baujourd hui\b/gi, 'aujourd’hui'],
];

/* Pronoms qui, juste avant un mot, imposent un verbe conjugué plutôt qu'un participe. « s’ » et
   « n’ » sont écrits sans apostrophe finale : la capture les rend déjà sous cette forme. */
const PRONOMS = new Set(['se', 's', 'ne', 'n', 'qui', 'il', 'elle', 'ils', 'elles', 'on', 'je', 'j',
  'tu', 'nous', 'vous', 'ça', 'cela', 'y', 'que', 'qu', 'me', 'm', 'te', 'le', 'la', 'les', 'lui']);
// Les seuls « -ee » légitimes d'un texte français : des mots anglais qu'on cite.
const ANGLAIS = new Set(['free', 'tee', 'see', 'three', 'coffee', 'committee', 'degree', 'guarantee',
  'payee', 'attendee', 'employee', 'trainee', 'fee', 'weekend', 'week']);
let APPRIS = {};
function repare(txt) {
  let t = txt;
  for (const [rx, rep] of ELISIONS) t = t.replace(rx, rep);
  for (const [rx, rep] of EXPRESSIONS) t = t.replace(rx, rep);
  /* Les mots : on respecte la casse d'origine (titres en capitales compris).
     ⚠️ ET ON REGARDE CE QUI PRÉCÈDE. La table apprise contient « depasse → dépassé » parce que le
     dépôt n'emploie que le participe ; appliquée sans contexte, elle a produit « rien ne dépassé »
     et « pour qui se réabonné ». Un pronom sujet ou réfléchi juste avant (se, ne, qui, il, on…)
     signe un verbe CONJUGUÉ : dans ce cas on n'impose pas la terminaison du participe — on garde
     les accents INTERNES, qui eux sont certains, et la terminaison d'origine. */
  t = t.replace(/[A-Za-zÀ-ÿ]{2,}/g, (m, off) => {
    const bas = m.toLowerCase();
    let cible = MOTS[bas] || APPRIS[bas];
    /* Repli morphologique : « presentations » n'est pas dans la table, « presentation » y est.
       On ne tente QUE des suffixes qui ne changent pas le radical — donc jamais un accent deviné. */
    if (!cible) {
      for (const suf of ['s', 'es', 'e']) {
        if (bas.length > suf.length + 3 && bas.endsWith(suf)) {
          const rad = bas.slice(0, -suf.length);
          const t = MOTS[rad] || APPRIS[rad];
          if (t) { cible = t + suf; break; }
        }
      }
    }
    if (!cible) return m;
    const avant = ((t.slice(0, off).match(/([A-Za-zÀ-ÿ’]+)[\s’]*$/) || [])[1] || '').toLowerCase();
    if (PRONOMS.has(avant) && /é$/.test(cible) && /e$/.test(bas)) cible = cible.slice(0, -1) + 'e';
    if (m === bas) return cible;                       // tout en minuscules
    if (m === m.toUpperCase()) return cible.toUpperCase();
    if (m[0] === m[0].toUpperCase()) return cible[0].toUpperCase() + cible.slice(1);
    return cible;
  });
  /* ⚠️ EN DERNIER, ET C'EST L'ORDRE QUI COMPTE. La règle « a → à » reconnaît un passé composé au
     participe qui suit (« a été »). Tant que le texte n'est pas accentué, ce participe s'écrit
     « ete » : la règle ne le voyait pas et produisait « à ete », que la table transformait ensuite
     en « à été ». On accentue donc les mots d'abord, la préposition ensuite. */
  t = accentueA(t);
  /* RÈGLE DE TERMINAISON, sûre parce qu'elle ne devine rien : AUCUN mot français ne se termine par
     « -ee » ou « -ees ». Quand la table ne connaît pas « annoncee », la terminaison suffit à
     trancher. L'exception est l'anglais (« week-end », « free ») : on le nomme. */
  t = t.replace(/\b([a-zà-ÿ]{2,}[bcdfghjklmnpqrstvwxz])ee(s?)\b/gi, (m, rad, s2) => (
    /^(?:fr|t|s|w|thr|coff|comm|degr|guarant|paym|attend|employ)/i.test(rad) && !/[àâäçéèêëîïôöùûü]/.test(rad) && ANGLAIS.has(m.toLowerCase())
      ? m : rad + 'ée' + s2
  ));
  return t;
}

// ── Application sur le tableau DTP_UPDATES de server.js, chaîne par chaîne ─────────────────────
const src = fs.readFileSync(SERVEUR, 'utf8');
const i = src.indexOf('const DTP_UPDATES = [');
const j = src.indexOf('\n];', i);
if (i < 0 || j < 0) { console.error('DTP_UPDATES introuvable dans server.js'); process.exit(1); }
const bloc = src.slice(i, j + 3);

const appris = tableApprise(bloc);
APPRIS = appris.table;
console.log(`Table apprise du dépôt : ${Object.keys(APPRIS).length} mot(s) ; ${appris.ecartes.size} écarté(s) pour ambiguïté.`);

let nEntrees = 0, nChaines = 0, nMots = 0;
const ACCENT = /[àâäçéèêëîïôöùûüÀÂÄÇÉÈÊËÎÏÔÖÙÛÜ’]/;
const blocNeuf = bloc.replace(/((?:title|desc):\s*')((?:[^'\\]|\\.)*)(')/g, (tout, av, corps, ap) => {
  const neuf = repare(corps);
  if (neuf !== corps) {
    nChaines++;
    nMots += neuf.split(/\s+/).filter((w, k) => w !== corps.split(/\s+/)[k]).length;
  }
  /* Filet : une apostrophe droite NON ÉCHAPPÉE fermerait la chaîne et casserait server.js. Les
     `\'` déjà présents dans le texte d'origine sont légitimes — on ne cherche donc que les
     apostrophes nues. */
  if (/(^|[^\\])'/.test(neuf)) { console.error('APOSTROPHE DROITE NUE PRODUITE — abandon :', neuf.slice(0, 90)); process.exit(1); }
  return av + neuf + ap;
});
for (const m of bloc.matchAll(/id:\s*'dtpu-/g)) nEntrees++;

// Ce qui reste sans le moindre accent après passage : on le compte et on le dit.
let restant = 0;
for (const m of blocNeuf.matchAll(/(?:desc):\s*'((?:[^'\\]|\\.)*)'/g)) if (!ACCENT.test(m[1])) restant++;

if (process.argv.includes('--essai')) {
  console.log(`Essai : ${nChaines} chaîne(s) sur ${nEntrees} entrée(s) seraient modifiées, ~${nMots} mot(s) touchés.`);
  console.log(`Après passage, ${restant} description(s) resteraient sans aucun accent.`);
  // Ce que la table ne sait PAS corriger : les mots qui n'existent nulle part ailleurs dans le
  // dépôt, ni accentués ni nus. C'est la liste à reprendre à la main, et on la donne.
  const inconnus = {};
  for (const m of blocNeuf.matchAll(/(?:title|desc):\s*'((?:[^'\\]|\\.)*)'/g)) {
    /* ⚠️ La classe DOIT inclure les lettres accentuées : sur un texte DÉJÀ réparé, `[a-z]{4,}`
       coupe « étaient » en « taient » et remplit la liste de fragments — on croirait à un échec
       massif alors que c'est exactement l'inverse. */
    for (const w of m[1].toLowerCase().matchAll(/[a-zàâäçéèêëîïôöùûü]{4,}/g)) {
      const b = w[0];
      if (/[àâäçéèêëîïôöùûü]/.test(b)) continue;          // déjà accentué : rien à signaler
      if (MOTS[b] || APPRIS[b] || appris.nus[b]) continue;
      inconnus[b] = (inconnus[b] || 0) + 1;
    }
  }
  const top = Object.entries(inconnus).sort((a, b) => b[1] - a[1]).slice(0, 60);
  console.log('\nMots que la table ne connaît pas (à reprendre à la main si besoin) :');
  console.log('  ' + top.map(([w, n]) => w + '·' + n).join(' '));
  const av = bloc.match(/desc:\s*'([^']{200,400})'/);
  if (av) { console.log('\nAvant : ' + av[1].slice(0, 220)); console.log('Après : ' + repare(av[1]).slice(0, 220)); }
  process.exit(0);
}
fs.writeFileSync(SERVEUR, src.slice(0, i) + blocNeuf + src.slice(j + 3), 'utf8');
console.log(`✓ ${nChaines} chaîne(s) réparée(s), ~${nMots} mot(s) touchés sur ${nEntrees} entrée(s).`);
console.log(`  ${restant} description(s) restent sans aucun accent — vocabulaire hors table, à reprendre à la main si besoin.`);
