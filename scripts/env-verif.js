#!/usr/bin/env node
/**
 * scripts/env-verif.js — UN FICHIER DE CONFIGURATION N'EST PAS UN SCRIPT, ET UN ÉCHEC DOIT CRIER.
 *
 * POURQUOI CE BANC (17/09/2026). En cherchant à restaurer le journal perdu d'un client, on a
 * ouvert /root/sauvegardes sur le VPS : VIDE. Pas « incomplet » — vide, depuis la pose des
 * minuteurs. Deux causes empilées, toutes deux silencieuses :
 *
 *   1. `dtp-sauvegarde.sh` n'avait pas le bit +x (l'installateur chmod deux scripts sur trois, et
 *      son mode git était 100644) → « Permission denied » à chaque passage. Corrigé, et couvert
 *      par resilience-verif.js § 8.
 *   2. LE .env ÉTAIT SOURCÉ PAR BASH (`set -a; . .env; set +a`), c'est-à-dire relu COMME DU CODE :
 *        · ligne 38, `GMAIL_APP_PASSWORD=alqz xena odqe fbgx` → un mot de passe d'application
 *          Google, quatre groupes séparés par des espaces. bash affecte « alqz », puis tente
 *          d'EXÉCUTER « xena odqe fbgx ». D'où « xena : commande introuvable ».
 *        · ligne 55, `EMAIL_FROM=DataTradingPro <contact@…>` → le « < » est une REDIRECTION.
 *          Erreur de syntaxe, et le sourcing s'ARRÊTE NET à cette ligne.
 *      Conséquence : TOUT ce qui est déclaré plus bas n'était jamais chargé. Donc
 *      `DTP_BACKUP_PASS` (que l'installateur ajoute en fin de fichier) — la sauvegarde refusait
 *      alors de produire une archive en clair et sortait en erreur. Et, découvert dans la foulée,
 *      `SUPABASE_URL_2/_3/_4` + `SUPABASE_ACCESS_TOKEN` pour le KEEP-ALIVE : il ne pinguait plus
 *      que la base principale, laissant db2/db3/db4 exposées au sommeil de 2,5 mois que ce
 *      minuteur existe précisément pour empêcher.
 *
 * CE BANC EXÉCUTE LE VRAI `dtp-env.sh` sur un .env qui reproduit les deux lignes fautives, et le
 * VRAI `dtp-sauvegarde.sh` avec des doublures, pour lire ce qui part réellement. Témoins compris :
 * remettre le sourcing, ou retirer l'alerte, doit faire rougir.
 *
 *   node scripts/env-verif.js
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const RACINE = path.join(__dirname, '..');
const LECTEUR = path.join(RACINE, 'scripts/vps/dtp-env.sh');
const SAUV = path.join(RACINE, 'scripts/vps/dtp-sauvegarde.sh');
const lire = p => { try { return fs.readFileSync(path.join(RACINE, p), 'utf8'); } catch { return ''; } };

let ok = 0, ko = 0;
const v = (n, c, d) => { if (c) { ok++; console.log('  ✓ ' + n); } else { ko++; console.log('  ✗ ' + n + (d ? '\n      → ' + d : '')); } };
const titre = t => console.log('\n── ' + t + ' ──');

const bac = fs.mkdtempSync(path.join(os.tmpdir(), 'dtp-env-'));
/* ⚠️ On capture stdout ET stderr. Le lecteur signale ses lignes ignorées sur la SORTIE D'ERREUR
   (c'est sa place : ce n'est pas une donnée, c'est un avertissement) — une première écriture de ce
   banc ne lisait que stdout et concluait que l'avertissement n'existait pas. Un banc qui ne
   regarde pas au bon endroit rend un faux rouge, ce qui use la confiance aussi sûrement qu'un
   faux vert. */
const sh = (code, env) => {
  const r = spawnSync('/bin/bash', ['-c', code], { encoding: 'utf8', env: { ...process.env, ...(env || {}) } });
  return { code: r.status, sortie: String(r.stdout || '') + String(r.stderr || '') };
};

/* LE .env DE LA PRODUCTION, dans sa forme mesurée : les deux lignes fautives, et — c'est tout
   l'enjeu — des clés indispensables déclarées APRÈS elles. */
const ENV_REEL = [
  'NODE_ENV=production',
  'SUPABASE_URL=https://exemple.supabase.co',
  'SUPABASE_KEY=eyJhbGciOiJIUzI1NiJ9.charge',
  'GMAIL_APP_PASSWORD=alqz xena odqe fbgx',            // ligne fautive nº1 (espaces)
  'MFB_PASS=Turquie25#',                                // un « # » qui n'est PAS un commentaire
  'EMAIL_FROM=DataTradingPro <contact@datatradingpro.com>', // ligne fautive nº2 (redirection)
  'CITATION="valeur entre guillemets"',
  'SUPABASE_URL_2=https://db2.supabase.co',             // ← APRÈS la casse : jamais chargée avant
  'SUPABASE_ACCESS_TOKEN=sbp_jeton_de_gestion',         // ← idem
  'DTP_BACKUP_PASS=laPhraseSecreteEnFinDeFichier',      // ← idem, et c'est ELLE qui bloquait tout
].join('\n') + '\n';
const FIC_ENV = path.join(bac, 'reel.env');
fs.writeFileSync(FIC_ENV, ENV_REEL);

titre('Le lecteur charge ce que le sourcing perdait');
{
  const r = sh(`. ${JSON.stringify(LECTEUR)} ${JSON.stringify(FIC_ENV)}
    printf 'GMAIL=[%s]\\nFROM=[%s]\\nMFB=[%s]\\nCIT=[%s]\\nURL2=[%s]\\nJETON=[%s]\\nPASS=[%s]\\n' \\
      "$GMAIL_APP_PASSWORD" "$EMAIL_FROM" "$MFB_PASS" "$CITATION" "$SUPABASE_URL_2" "$SUPABASE_ACCESS_TOKEN" "$DTP_BACKUP_PASS"`);
  const lit = c => (new RegExp('^' + c + '=\\[(.*)\\]$', 'm').exec(r.sortie) || [])[1];

  v('le lecteur ne sort pas en erreur sur le .env réel', r.code === 0, 'code ' + r.code + ' · ' + r.sortie.slice(0, 200));
  v('le mot de passe Gmail garde ses espaces (la ligne 38 de la production)',
    lit('GMAIL') === 'alqz xena odqe fbgx', JSON.stringify(lit('GMAIL')));
  v('EMAIL_FROM garde ses chevrons (la ligne 55 de la production)',
    lit('FROM') === 'DataTradingPro <contact@datatradingpro.com>', JSON.stringify(lit('FROM')));
  v('un « # » en fin de valeur n\'est pas pris pour un commentaire',
    lit('MFB') === 'Turquie25#', JSON.stringify(lit('MFB')));
  v('les guillemets ENCADRANTS sont retirés, pas gardés', lit('CIT') === 'valeur entre guillemets', JSON.stringify(lit('CIT')));

  /* ⚠️ LES TROIS CONTRÔLES QUI COMPTENT LE PLUS : ces clés sont déclarées APRÈS les lignes
     fautives. Avec le sourcing, elles étaient TOUTES vides — d'où zéro archive et un keep-alive
     borgne. Si l'un de ces trois rougit, la panne du 17/09 est de retour. */
  v('DTP_BACKUP_PASS, déclarée APRÈS la casse, est chargée (sans elle : zéro archive)',
    lit('PASS') === 'laPhraseSecreteEnFinDeFichier', JSON.stringify(lit('PASS')));
  v('SUPABASE_URL_2, déclarée APRÈS la casse, est chargée (sans elle : db2 jamais pinguée)',
    lit('URL2') === 'https://db2.supabase.co', JSON.stringify(lit('URL2')));
  v('SUPABASE_ACCESS_TOKEN, déclarée APRÈS la casse, est chargée (sans elle : aucune reprise de pause)',
    lit('JETON') === 'sbp_jeton_de_gestion', JSON.stringify(lit('JETON')));
}

titre('Témoin : avec l\'ANCIEN sourcing, ces mêmes clés sont perdues');
{
  /* On rejoue littéralement `set -a; . .env; set +a` sur le MÊME fichier. Il doit échouer. Si ce
     témoin cessait de mordre, c'est que le .env de test ne reproduit plus la panne réelle — et le
     banc ci-dessus ne prouverait plus rien. */
  const r = sh(`set -a; . ${JSON.stringify(FIC_ENV)} 2>/dev/null; set +a
    printf 'PASS=[%s]\\nURL2=[%s]\\n' "\${DTP_BACKUP_PASS:-}" "\${SUPABASE_URL_2:-}"`);
  const vide = c => (new RegExp('^' + c + '=\\[(.*)\\]$', 'm').exec(r.sortie) || [])[1] === '';
  v('(témoin) le sourcing perd bien DTP_BACKUP_PASS — c\'est la panne mesurée', vide('PASS'), r.sortie.slice(0, 200));
  v('(témoin) le sourcing perd bien SUPABASE_URL_2 — d\'où le keep-alive borgne', vide('URL2'), r.sortie.slice(0, 200));
}

titre('Le lecteur ne peut RIEN exécuter de ce que le fichier contient');
{
  /* Une clé d'API mal collée peut contenir n'importe quoi. Le sourcing exécutait. On le prouve en
     demandant au fichier de créer un fichier : s'il apparaît, le lecteur est redevenu dangereux. */
  const piege = path.join(bac, 'PWNED');
  const ficPiege = path.join(bac, 'piege.env');
  fs.writeFileSync(ficPiege, [
    'AVANT=ok',
    'MECHANT=$(touch ' + piege + ')',
    'MECHANT2=`touch ' + piege + '2`',
    'GLOB=*',
    'APRES=ok',
  ].join('\n') + '\n');
  const r = sh(`. ${JSON.stringify(LECTEUR)} ${JSON.stringify(ficPiege)}
    printf 'AVANT=[%s]\\nAPRES=[%s]\\nGLOB=[%s]\\nMECHANT=[%s]\\n' "$AVANT" "$APRES" "$GLOB" "$MECHANT"`);
  v('aucune substitution de commande n\'est exécutée', !fs.existsSync(piege) && !fs.existsSync(piege + '2'),
    'un fichier a été créé par le .env : le lecteur exécute son contenu');
  v('… et la valeur est gardée comme du TEXTE',
    /^MECHANT=\[\$\(touch /m.test(r.sortie), (/^MECHANT=.*$/m.exec(r.sortie) || [''])[0]);
  v('une étoile n\'est pas développée en liste de fichiers', /^GLOB=\[\*\]$/m.test(r.sortie),
    (/^GLOB=.*$/m.exec(r.sortie) || [''])[0]);
  v('une ligne piégée n\'empêche pas les suivantes de charger', /^APRES=\[ok\]$/m.test(r.sortie));
}

titre('Une ligne illisible est ignorée et SIGNALÉE, jamais fatale');
{
  const ficBoiteux = path.join(bac, 'boiteux.env');
  fs.writeFileSync(ficBoiteux, ['A=1', 'ceci nest pas une affectation', '2MAUVAIS_NOM=x', 'B=2'].join('\n') + '\n');
  const r = sh(`. ${JSON.stringify(LECTEUR)} ${JSON.stringify(ficBoiteux)}; printf 'A=[%s] B=[%s]\\n' "$A" "$B"`);
  v('les lignes valides autour d\'une ligne cassée sont chargées', /A=\[1\] B=\[2\]/.test(r.sortie), r.sortie.slice(0, 200));
  v('… et les lignes ignorées sont COMPTÉES à voix haute (pas de clé perdue en silence)',
    /ligne\(s\) ignorée\(s\)/.test(r.sortie), r.sortie.slice(0, 200));
  v('un fichier introuvable rend une erreur nette', sh(`. ${JSON.stringify(LECTEUR)} /rien/du/tout`).code !== 0);
}

titre('Les deux unités systemd utilisent le lecteur, plus le sourcing');
{
  /* ⚠️ ON N'INSPECTE QUE LES LIGNES ExecStart=, PAS LE FICHIER ENTIER. Les deux unités EXPLIQUENT
     en commentaire l'ancienne écriture fautive (« set -a; . …/.env; set +a ») pour que personne ne
     la remette par ignorance. Une première version de ce contrôle balayait tout le fichier et
     rougissait sur cette explication : il accusait le commentaire qui protège justement contre le
     défaut. Un banc doit viser le CODE, sinon documenter un piège devient impossible. */
  for (const [nom, fic] of [['sauvegarde', 'scripts/dtp-sauvegarde.service'], ['keep-alive', 'scripts/dtp-keepalive.service']]) {
    const u = lire(fic);
    const execs = (u.match(/^ExecStart=.*$/gm) || []).join('\n');
    v(`${nom} : l'unité déclare bien un ExecStart`, execs.length > 0, 'aucune ligne ExecStart= : ce contrôle ne prouve plus rien');
    v(`${nom} : plus aucun « . /opt/datatradingpro/.env » dans l'ExecStart`,
      !/(^|\s|;)\.\s+\/opt\/datatradingpro\/\.env/.test(execs),
      'le sourcing est de retour : la panne du 17/09 peut se reproduire à la première valeur contenant un espace');
    v(`${nom} : l'ExecStart appelle bien dtp-env.sh`, /dtp-env\.sh\s+\/opt\/datatradingpro\/\.env/.test(execs));
  }
}

titre('Une sauvegarde qui échoue ENVOIE une alerte (elle se taisait)');
{
  /* ON EXÉCUTE LE VRAI SCRIPT, sans DTP_BACKUP_PASS — le cas exact qui a échoué en silence chaque
     nuit. `docker` est une doublure qui note ce qu'on lui a demandé. */
  const trace = path.join(bac, 'docker.trace');
  const faux = path.join(bac, 'bin');
  fs.mkdirSync(faux, { recursive: true });
  fs.writeFileSync(path.join(faux, 'docker'), [
    '#!/usr/bin/env bash',
    // `docker ps` doit nommer le conteneur pour que le script se croie en production.
    'if [ "$1" = "ps" ]; then echo datatradingpro; exit 0; fi',
    // `docker exec` : on capture le corps reçu sur l\'entrée standard.
    'if [ "$1" = "exec" ]; then cat >> ' + JSON.stringify(trace) + '; echo "EXEC $*" >> ' + JSON.stringify(trace) + '; exit 0; fi',
    'exit 0',
  ].join('\n') + '\n', { mode: 0o755 });

  const r = sh(`export PATH=${JSON.stringify(faux)}:$PATH
    unset DTP_BACKUP_PASS
    ${JSON.stringify(SAUV)} 2>&1 || true`, { DTP_ALERTE_EMAILS: 'admin@exemple.fr' });

  const envoye = fs.existsSync(trace) ? fs.readFileSync(trace, 'utf8') : '';
  v('le script refuse toujours de produire une archive en clair', /DTP_BACKUP_PASS n'est pas defini/.test(r.sortie),
    r.sortie.slice(0, 200));
  v('… et il ENVOIE désormais une alerte au lieu de se taire', /sendAdminAlert/.test(envoye),
    envoye ? envoye.slice(0, 200) : '(aucun docker exec : rien n\'est parti)');
  v('… l\'alerte dit que la sauvegarde a échoué', /ECHOUE/.test(envoye));
  v('… et elle part à l\'adresse configurée', /admin@exemple\.fr/.test(envoye) || /DEST_MAIL/.test(envoye));
  v('le journal confirme l\'envoi', /alerte d'echec envoyee/.test(r.sortie), r.sortie.slice(-200));

  /* ⚠️ LE CONTRÔLE QUI A RATTRAPÉ UN DÉFAUT DE CE CORRECTIF MÊME. La première écriture de
     `_alerter_echec` ne faisait RIEN quand aucune variable d'adresse n'était posée — or il n'y en
     a aucune sur la machine de production. L'alerte aurait donc été muette là précisément où elle
     doit parler, et on aurait cru le trou bouché. On rejoue ici SANS aucune variable. */
  fs.writeFileSync(trace, '');
  const sansVar = sh(`export PATH=${JSON.stringify(faux)}:$PATH
    unset DTP_BACKUP_PASS DTP_ALERTE_EMAILS DISK_ALERT_EMAILS
    ${JSON.stringify(SAUV)} 2>&1 || true`);
  const envoyeSansVar = fs.readFileSync(trace, 'utf8');
  v('… et l\'alerte part MÊME sans adresse configurée (repli garanti)', /sendAdminAlert/.test(envoyeSansVar),
    'sans repli, la production reste silencieuse : le correctif ne corrige rien là où il compte · ' + sansVar.sortie.slice(-160));

  /* TÉMOIN DE MUTATION : sans l'appel à l'alerte, l'échec redevient muet.
     ⚠️ FORME CHANGÉE LE 17/09 : le `[ "$code" -ne 0 ] && _alerter_echec …` court est devenu un bloc
     `if … fi` (il porte désormais AUSSI `_ecrire_etat`, pour le panel admin — voir sauvegarde-verif.js
     et taux-verif.js pour ce second effet). Le témoin vise donc l'appel lui-même, pas la ponctuation
     qui l'entoure — même principe que le témoin `quarSince` de bases-verif.js. */
  const src = fs.readFileSync(SAUV, 'utf8');
  const mute = src.replace(/_alerter_echec "code de sortie \$code[^\n]*/, ':');
  v('(témoin) la mutation change bien le source', mute !== src,
    'la garde a changé de forme : ce témoin ne prouve plus rien');
  if (mute !== src) {
    const ficMute = path.join(bac, 'sauvegarde-mute.sh');
    fs.writeFileSync(ficMute, mute, { mode: 0o755 });
    fs.writeFileSync(trace, '');
    sh(`export PATH=${JSON.stringify(faux)}:$PATH; unset DTP_BACKUP_PASS; ${JSON.stringify(ficMute)} 2>&1 || true`,
      { DTP_ALERTE_EMAILS: 'admin@exemple.fr' });
    const apres = fs.readFileSync(trace, 'utf8');
    v('(témoin) sans l\'appel, plus aucune alerte ne part — c\'est bien lui qui la déclenche',
      !/sendAdminAlert/.test(apres), apres.slice(0, 200));
  }
}

try { fs.rmSync(bac, { recursive: true, force: true }); } catch {}
console.log('\n──────────────────────────────────────────────────────────────────────');
if (ko) { console.log(`❌ env-verif : ${ko} échec(s) sur ${ok + ko}.`); process.exit(1); }
console.log(`✅ env-verif : ${ok} contrôle(s) au vert.`);
