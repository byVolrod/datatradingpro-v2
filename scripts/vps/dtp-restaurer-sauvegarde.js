#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════════════════════════
   RESTAURATION DEPUIS LA SAUVEGARDE CHIFFRÉE — journaux ET dispositions, un compte ou tous.

   NÉ DE DEUX INCIDENTS DU 16/09/2026 : le journal du compte Heikilea (37 trades → 0) et la
   disposition « JOT » du compte admin, tous deux réduits à un état pauvre par des enregistrements
   qui écrasaient au lieu de fusionner. CE QUI A ÉTÉ VÉRIFIÉ AVANT D'ÉCRIRE CE SCRIPT (17/09, en
   lisant directement la base primaire) :
     - Heikilea (compte 19) est le SEUL compte dont le journal porte exactement la signature de
       l'incident (0 entrée, colonnes présentes, custom=false) sur cette base.
     - Le filet `wdg:<uid>:hist` posé le 16/09 ne protège personne rétroactivement : pour le
       compte admin comme pour tous les autres, les jalons déjà enregistrés sont EUX-MÊMES déjà
       à l'état pauvre — la disposition riche avait disparu AVANT que le filet ne commence à
       observer. Aucune récupération n'est donc possible depuis la base Supabase elle-même.
     - Le projet Supabase est sur le plan gratuit : aucune sauvegarde ni PITR côté Supabase.
   La SEULE copie qui peut encore porter l'état d'avant collapse est l'archive chiffrée que
   `dtp-sauvegarde.sh` produit chaque nuit sur le VPS (elle exporte `ai_cache`, qui porte
   `journal:<uid>` ET `wdg:<uid>`) — ce que cette session ne peut pas atteindre (pas d'accès VPS).

   POURQUOI PAR LE CHEMIN NORMAL, PAS DU SQL. `journal:<uid>` et `wdg:<uid>` sont dual-écrites sur
   quatre nœuds Supabase (`_multiFrom`/`_runMulti`, auth.js). Une correction en SQL sur une seule
   base serait écrasée au passage suivant. Ce script passe par `auth.aiCacheGet`/`aiCacheSet` —
   EXACTEMENT le chemin que l'application emprunte elle-même.

   SÛRETÉ : n'écrase JAMAIS une valeur LIVE plus riche ou égale à celle de l'archive.
     - journal : richesse = nombre d'entrées.
     - disposition (wdg) : richesse = la même formule que `_wdgHistPush` dans server.js
       (chaque disposition compte 1 + son nombre de widgets) — pour ne jamais restaurer une
       version que le desk lui-même jugerait plus pauvre.

   USAGE (sur le VPS, depuis /opt/datatradingpro) :
     1) Décrypter l'archive PRÉCÉDANT le ou les incidents (la nuit du 16/09, ~04h10 UTC — avant
        20h09 UTC pour la disposition admin, avant 20h31 UTC pour le journal Heikilea) :
          mkdir -p /root/restauration && cd /root/restauration
          gpg --batch --yes --decrypt --passphrase-fd 3 \
              /root/sauvegardes/dtp-20260916-0410.tar.gz.gpg 3<<<"$DTP_BACKUP_PASS" | tar -xzf -
        (adapter le nom exact : `ls -1t /root/sauvegardes/dtp-*.tar.gz.gpg`)
     2) D'ABORD EN LECTURE SEULE (rien n'est écrit sans --appliquer) — sur TOUS les comptes :
          node scripts/vps/dtp-restaurer-sauvegarde.js \
            /root/restauration/dtp-20260916-0410/donnees/dump/ai_cache.json
        Ou un seul compte (Heikilea, ou l'admin lui-même) :
          node scripts/vps/dtp-restaurer-sauvegarde.js <chemin ai_cache.json> --email=heikilea987@gmail.com
          node scripts/vps/dtp-restaurer-sauvegarde.js <chemin ai_cache.json> --email=volrod.dev@gmail.com
     3) Relire la liste affichée. Si elle correspond à ce qui doit être restauré, rejouer LA MÊME
        commande avec --appliquer à la fin. Rien n'est jamais écrasé par une valeur plus pauvre :
        relancer sans risque ne fait rien de plus sur ce qui est déjà à jour.
     4) Vérifier dans le desk, puis supprimer /root/restauration (archive déchiffrée, en clair).
   ═══════════════════════════════════════════════════════════════════════════════════════════════ */
'use strict';
try { require('dotenv').config(); } catch (e) { /* les variables peuvent venir de l'environnement */ }
const fs = require('fs');

const argv = process.argv.slice(2);
const CHEMIN = argv.find(a => !a.startsWith('--'));
const APPLIQUER = argv.includes('--appliquer');
const EMAIL = (argv.find(a => a.startsWith('--email=')) || '').slice('--email='.length).toLowerCase().trim() || null;

if (!CHEMIN) {
  console.error('Usage : node scripts/vps/dtp-restaurer-sauvegarde.js <chemin/ai_cache.json> [--email=<email>] [--appliquer]');
  process.exit(1);
}

const auth = require('../../auth.js');

const poidsLayouts = cfg => (cfg && Array.isArray(cfg.layouts) ? cfg.layouts : [])
  .reduce((n, l) => n + 1 + ((l && Array.isArray(l.items)) ? l.items.length : 0), 0);
const nEntrees = cfg => (cfg && Array.isArray(cfg.entries)) ? cfg.entries.length : 0;

(async () => {
  console.log('[1/4] Lecture de l\'archive ' + CHEMIN + '…');
  let lignes;
  try { lignes = JSON.parse(fs.readFileSync(CHEMIN, 'utf8')); }
  catch (e) { console.error('  X archive illisible : ' + e.message); process.exit(1); }
  if (!Array.isArray(lignes)) { console.error('  X ce fichier n\'est pas un export ai_cache valide (tableau attendu)'); process.exit(1); }

  const candidats = lignes.filter(l => l && typeof l.key === 'string' && /^(journal|wdg):[0-9]+$/.test(l.key) && l.value);
  console.log('  v ' + candidats.length + ' clé(s) journal/disposition dans l\'archive');

  console.log('[2/4] Résolution des comptes…');
  const utilisateurs = await auth.getAllUsers();
  const parId = new Map((utilisateurs || []).map(u => [String(u.id), u]));
  let filtreUid = null;
  if (EMAIL) {
    const u = (utilisateurs || []).find(x => String(x.email || '').toLowerCase().trim() === EMAIL);
    if (!u) { console.error('  X aucun compte ne porte l\'e-mail ' + EMAIL); process.exit(1); }
    filtreUid = String(u.id);
    console.log('  v filtré sur ' + EMAIL + ' (compte ' + filtreUid + ')');
  }

  console.log('[3/4] Comparaison archive ↔ live (lecture, aucune écriture pour l\'instant)…');
  const propositions = [];
  for (const l of candidats) {
    const m = l.key.match(/^(journal|wdg):([0-9]+)$/);
    const type = m[1], uid = m[2];
    if (filtreUid && uid !== filtreUid) continue;
    const richesse = type === 'journal' ? nEntrees : poidsLayouts;
    const rArchive = richesse(l.value);
    if (!rArchive) continue;   // l'archive elle-même est pauvre pour ce compte : rien à proposer
    const live = await auth.aiCacheGet(l.key, 0);   // maxAge=0 → relecture forcée, jamais la RAM
    const rLive = richesse(live);
    if (rArchive > rLive) {
      const u = parId.get(uid);
      propositions.push({ key: l.key, type, uid, email: u && u.email, nom: u && u.name, rLive, rArchive, valeur: l.value });
    }
  }

  if (!propositions.length) {
    console.log('  = aucune régression détectée' + (filtreUid ? ' pour ce compte' : ' sur les comptes de cette archive') + ' : rien à restaurer.');
    process.exit(0);
  }

  console.log('\n  ' + propositions.length + ' régression(s) trouvée(s) :');
  for (const p of propositions) {
    const libelle = p.type === 'journal' ? 'entrée(s)' : '(poids disposition)';
    console.log('    - ' + p.key.padEnd(14) + (p.email || '(compte introuvable)').padEnd(30)
      + ' live=' + p.rLive + ' → archive=' + p.rArchive + ' ' + libelle);
  }

  if (!APPLIQUER) {
    console.log('\n  Mode lecture seule (par défaut). Rejouer la même commande avec --appliquer pour restaurer.');
    process.exit(0);
  }

  console.log('\n[4/4] Restauration (écriture via le chemin normal, diffusion aux quatre bases)…');
  for (const p of propositions) {
    await auth.aiCacheSet(p.key, p.valeur);
    console.log('  v ' + p.key + ' restauré (' + p.rLive + ' → ' + p.rArchive + ')');
  }
  console.log('\nTerminé. Vérifier dans le desk, puis supprimer le dossier de l\'archive déchiffrée.');
})().catch(e => { console.error('  X ' + (e && e.stack || e)); process.exit(1); });
