#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════════════════════════
   RESTAURATION D'UN JOURNAL DEPUIS LA SAUVEGARDE CHIFFRÉE — incident du 16/09/2026 (compte
   Heikilea, journal réduit à zéro en production par la faille refermée le 17/09 dans server.js).

   POURQUOI CE SCRIPT ET PAS DU SQL DIRECT. Une correction en SQL sur une seule base serait écrasée
   au passage suivant : `journal:<uid>` est dual-écrite sur les quatre nœuds Supabase via
   `_multiFrom`/`_runMulti` dans auth.js, et rien ne relit ni ne propage une écriture faite en
   dehors de ce chemin. Ce script passe donc par `auth.aiCacheGet`/`auth.aiCacheSet`, EXACTEMENT le
   chemin que l'application utilise elle-même — la donnée restaurée est diffusée aux quatre bases
   comme n'importe quel enregistrement normal.

   SÛRETÉ : ce script N'ÉCRASE JAMAIS UN JOURNAL PLUS RICHE que celui de l'archive. Il compare le
   nombre d'entrées en base LIVE contre celui de l'archive et refuse si le live est égal ou plus
   riche — protection contre l'aléa du choix de version d'archive et contre un compte qui aurait
   déjà retrouvé ses trades entre-temps (import manuel, nouvelle saisie).

   USAGE (sur le VPS, depuis /opt/datatradingpro) :
     1) Décrypter l'archive PRÉCÉDANT l'incident (nuit du 16/09, ~04h10 UTC — avant 20h31 UTC) :
          mkdir -p /root/restauration && cd /root/restauration
          gpg --batch --yes --decrypt --passphrase-fd 3 \
              /root/sauvegardes/dtp-20260916-0410.tar.gz.gpg 3<<<"$DTP_BACKUP_PASS" | tar -xzf -
        (adapter le nom exact de l'archive : `ls -1t /root/sauvegardes/dtp-*.tar.gz.gpg`)
     2) Repérer le dossier extrait (dtp-AAAAMMJJ-HHMM/donnees/dump/ai_cache.json) et lancer :
          node scripts/vps/dtp-restaurer-journal.js \
            heikilea987@gmail.com \
            /root/restauration/dtp-20260916-0410/donnees/dump/ai_cache.json
        Ajouter --forcer en dernier argument pour repasser outre le refus « le live est déjà aussi
        riche » (jamais nécessaire dans le cas normal — à n'utiliser qu'en connaissance de cause).
     3) Vérifier dans le desk (panneau Récupération, ou connexion du client) que le journal est de
        retour, puis supprimer /root/restauration (il contient l'archive déchiffrée, en clair).
   ═══════════════════════════════════════════════════════════════════════════════════════════════ */
'use strict';
try { require('dotenv').config(); } catch (e) { /* les variables peuvent venir de l'environnement */ }
const fs = require('fs');

const [, , EMAIL, CHEMIN_AI_CACHE, DRAPEAU] = process.argv;
const FORCER = DRAPEAU === '--forcer';

if (!EMAIL || !CHEMIN_AI_CACHE) {
  console.error('Usage : node scripts/vps/dtp-restaurer-journal.js <email> <chemin/ai_cache.json> [--forcer]');
  process.exit(1);
}

const auth = require('../../auth.js');

(async () => {
  console.log('[1/4] Recherche du compte ' + EMAIL + '…');
  const utilisateurs = await auth.getAllUsers();
  const compte = (utilisateurs || []).find(u => String(u.email || '').toLowerCase().trim() === EMAIL.toLowerCase().trim());
  if (!compte) { console.error('  X aucun compte ne porte cet e-mail (getAllUsers)'); process.exit(1); }
  const uid = String(compte.id);
  console.log('  v compte trouvé : id=' + uid + (compte.username ? ' (' + compte.username + ')' : ''));

  console.log('[2/4] Lecture de l\'archive ' + CHEMIN_AI_CACHE + '…');
  let lignes;
  try { lignes = JSON.parse(fs.readFileSync(CHEMIN_AI_CACHE, 'utf8')); }
  catch (e) { console.error('  X archive illisible : ' + e.message); process.exit(1); }
  if (!Array.isArray(lignes)) { console.error('  X ce fichier n\'est pas un export ai_cache valide (tableau attendu)'); process.exit(1); }
  const cle = 'journal:' + uid;
  const ligne = lignes.find(l => l && l.key === cle);
  if (!ligne || !ligne.value) { console.error('  X aucune entrée « ' + cle + ' » dans cette archive'); process.exit(1); }
  const archive = ligne.value;
  const nArchive = Array.isArray(archive.entries) ? archive.entries.length : 0;
  console.log('  v trouvé dans l\'archive : ' + nArchive + ' entrée(s), '
    + (Array.isArray(archive.cols) ? archive.cols.length : 0) + ' colonne(s), custom=' + !!archive.custom
    + ' (datée ' + (ligne.created_at || '?') + ')');
  if (!nArchive) { console.error('  X l\'archive elle-même est vide pour ce compte : rien à restaurer depuis CETTE version'); process.exit(1); }

  console.log('[3/4] Lecture du journal LIVE (les quatre bases, via le chemin normal)…');
  const live = await auth.aiCacheGet(cle, 0);   // maxAge=0 → on force la relecture, jamais la RAM
  const nLive = (live && Array.isArray(live.entries)) ? live.entries.length : 0;
  console.log('  v en base actuellement : ' + nLive + ' entrée(s)');

  if (nLive >= nArchive && !FORCER) {
    console.log('  = le journal LIVE (' + nLive + ') est déjà aussi riche ou plus riche que l\'archive (' + nArchive + ') : rien fait.');
    console.log('    (relancer avec --forcer pour écraser malgré tout — à ne faire qu\'en connaissance de cause)');
    process.exit(0);
  }

  console.log('[4/4] Restauration : écriture via le chemin normal (diffusion aux quatre bases)…');
  await auth.aiCacheSet(cle, archive);
  console.log('  v ' + cle + ' réécrit : ' + nArchive + ' entrée(s) (était ' + nLive + ')');
  console.log('\nTerminé. Vérifier dans le desk, puis supprimer le dossier de l\'archive déchiffrée.');
})().catch(e => { console.error('  X ' + (e && e.stack || e)); process.exit(1); });
