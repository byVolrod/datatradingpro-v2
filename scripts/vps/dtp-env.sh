#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════════════════════
#  LECTEUR DE .env QUI N'INTERPRÈTE RIEN — à SOURCER, pas à exécuter.
#
#  ⚠️ POURQUOI IL EXISTE (17/09/2026). Les deux tâches de fond lisaient le .env avec
#  `set -a; . /opt/datatradingpro/.env; set +a`. C'est la grammaire du shell appliquée à un fichier
#  de configuration : chaque valeur est RELUE COMME DU CODE. Deux lignes parfaitement banales l'ont
#  fait exploser, et personne ne l'a vu pendant des semaines :
#
#    ligne 38 : GMAIL_APP_PASSWORD=alqz xena odqe fbgx
#               → un mot de passe d'application Google, quatre groupes séparés par des espaces.
#                 bash lit « GMAIL_APP_PASSWORD=alqz » comme une affectation, puis tente d'EXÉCUTER
#                 « xena odqe fbgx » comme une commande. D'où « xena : commande introuvable ».
#    ligne 55 : EMAIL_FROM=DataTradingPro <contact@…>
#               → le « < » est une REDIRECTION pour le shell. Erreur de syntaxe, et le sourcing
#                 s'arrête NET à cette ligne.
#
#  CONSÉQUENCES MESURÉES, toutes silencieuses :
#    · la SAUVEGARDE QUOTIDIENNE : DTP_BACKUP_PASS est déclarée APRÈS la ligne 55 (l'installateur
#      l'ajoute en fin de fichier) → jamais chargée → le script refuse de produire une archive en
#      clair, et sort en erreur. /root/sauvegardes est resté VIDE depuis la pose des minuteurs.
#    · le KEEP-ALIVE : SUPABASE_URL/KEY sont aux lignes 10-11 (avant la casse, donc chargées), mais
#      SUPABASE_URL_2/_3/_4 et SUPABASE_ACCESS_TOKEN viennent APRÈS → db2, db3 et db4 n'étaient
#      PLUS PINGUÉES DU TOUT. C'est exactement ce qui a laissé la base principale en pause du
#      14 juin au 2 septembre ; le filet posé pour que ça ne se reproduise plus était lui-même
#      troué, et affichait pourtant « ping OK » sur la seule base qu'il atteignait encore.
#
#  LA RÈGLE QUI EN DÉCOULE : un fichier de configuration N'EST PAS un script. On le PARSE.
#  Ici, chaque ligne est reconnue par une expression régulière stricte, la valeur est traitée comme
#  une DONNÉE (affectée à une variable shell, jamais réévaluée), et une ligne illisible est IGNORÉE
#  et COMPTÉE au lieu d'interrompre tout le reste. Une faute de frappe dans une clé d'un service ne
#  peut plus éteindre un autre service.
#
#  ⚠️ ET IL NE PEUT PAS EXÉCUTER CE QUE LE FICHIER CONTIENT. `VAR=$(rm -rf /)` ou des accents
#  graves sont chargés comme du TEXTE. Un banc l'éprouve avec un témoin qui essaie réellement de
#  créer un fichier ; si le lecteur repassait au sourcing, ce témoin mordrait.
#
#  Usage (dans une unité systemd ou un script) :
#      . /opt/datatradingpro/scripts/vps/dtp-env.sh /opt/datatradingpro/.env
#  Les variables sont EXPORTÉES dans le shell appelant. Rend 0 si le fichier a été lu (même avec
#  des lignes ignorées), 1 s'il est introuvable ou illisible.
# ═══════════════════════════════════════════════════════════════════════════════════════════════

_dtp_env_charger() {
  local fichier="${1:-}"
  [ -n "$fichier" ] && [ -r "$fichier" ] || {
    echo "[dtp-env] fichier introuvable ou illisible : ${fichier:-<aucun>}" >&2
    return 1
  }

  local ligne cle valeur premier dernier
  local charges=0 ignorees=0

  # IFS vidé + `read -r` : aucune découpe sur les espaces, aucune interprétation des antislashs.
  while IFS= read -r ligne || [ -n "$ligne" ]; do
    ligne="${ligne%$'\r'}"                        # fichier édité sous Windows
    case "$ligne" in
      ''|'#'*) continue ;;                        # ligne vide ou commentaire entier
    esac
    ligne="${ligne#"${ligne%%[![:space:]]*}"}"    # espaces de tête
    case "$ligne" in
      ''|'#'*) continue ;;
      'export '*) ligne="${ligne#export }" ;;     # tolère la forme « export CLE=valeur »
    esac

    cle="${ligne%%=*}"
    # Pas de « = », ou nom de variable invalide → on ignore CETTE ligne, et on continue.
    if [ "$cle" = "$ligne" ] || ! [[ "$cle" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
      ignorees=$((ignorees + 1)); continue
    fi
    valeur="${ligne#*=}"

    # Guillemets ENCADRANTS seulement, et seulement s'ils sont appariés : `MDP="a b"` → `a b`,
    # mais `MDP=Turquie25#` et `MDP=il "cite" ici` gardent leurs caractères tels quels.
    premier="${valeur:0:1}"; dernier="${valeur: -1}"
    if [ ${#valeur} -ge 2 ] && [ "$premier" = "$dernier" ] \
       && { [ "$premier" = '"' ] || [ "$premier" = "'" ]; }; then
      valeur="${valeur:1:${#valeur}-2}"
    fi

    # LE POINT CENTRAL : `export` reçoit la valeur par une VARIABLE déjà construite. Elle n'est
    # jamais réanalysée par le shell — ni substitution de commande, ni redirection, ni glob.
    export "$cle=$valeur"
    charges=$((charges + 1))
  done < "$fichier"

  if [ "$ignorees" -gt 0 ]; then
    # On le DIT. Une ligne ignorée en silence, c'est une clé manquante qu'on découvrira au pire
    # moment — la maladie que ce fichier répare.
    echo "[dtp-env] $charges variable(s) chargée(s), $ignorees ligne(s) ignorée(s) dans $fichier" >&2
  fi
  return 0
}

_dtp_env_charger "${1:-}"
