#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════════════════════════
   EXPORT DE LA BASE SUPABASE  —  le trou le plus grave releve par l audit du 21/08/2026.

   AVANT : les comptes clients, leurs abonnements et les empreintes de leurs mots de passe
   n existaient QU A UN SEUL ENDROIT, chez Supabase. La redondance db2/db3/db4 protege d une PANNE,
   pas d une SUPPRESSION ni d une erreur humaine : trois copies d une ligne effacee, cela fait trois
   lignes effacees. Le depot ne contenait aucun export, aucun dump, nulle part.

   Ce script ecrit un export JSON dans data/app/dump/, que dtp-sauvegarde.sh embarque ensuite dans
   l archive CHIFFREE. Les empreintes de mots de passe y sont donc protegees par le chiffrement de
   l archive, comme le reste.

   ⚠️ ON N EXPORTE PAS TOUT, ET C EST DELIBERE.
   La table `ai_cache` est un CACHE : elle se regenere, elle est volumineuse, et la lire couterait
   du trafic sortant. Ce projet a deja paye un incident d egress de 18 To : sauvegarder ce qui se
   reconstruit tout seul serait payer deux fois pour rien. On exporte ce qui est IRREMPLACABLE.

   ⚠️ LECTURE SEULE, PAR CONSTRUCTION. Le script n appelle que `select`. Il ne peut ni modifier ni
   supprimer quoi que ce soit, meme en cas de bug.

   Usage (sur le serveur, depuis /opt/datatradingpro) :  node scripts/vps/dtp-export-bdd.js
   ═══════════════════════════════════════════════════════════════════════════════════════════════ */
'use strict';
const fs = require('fs');
const path = require('path');

try { require('dotenv').config(); } catch (e) { /* les variables peuvent venir de l environnement */ }

const { createClient } = require('@supabase/supabase-js');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data', 'app');
const SORTIE = path.join(DATA_DIR, 'dump');

/* Les noeuds, dans l ordre de preference. On prend le PREMIER qui repond : inutile d interroger les
   quatre, ce sont des copies de la meme donnee et chaque lecture coute du trafic. */
const NOEUDS = [
  ['primary', process.env.SUPABASE_URL,   process.env.SUPABASE_KEY],
  ['db2',     process.env.SUPABASE_URL_2, process.env.SUPABASE_KEY_2],
  ['db3',     process.env.SUPABASE_URL_3, process.env.SUPABASE_KEY_3],
  ['db4',     process.env.SUPABASE_URL_4, process.env.SUPABASE_KEY_4],
].filter(([, u, k]) => u && k);

/* `obligatoire` : sans cette table, l export N EST PAS une sauvegarde et le script doit echouer.
   `users` porte les comptes, les abonnements et les empreintes : c est LA raison d etre du script. */
const TABLES = [
  { nom: 'users',           obligatoire: true,  pourquoi: 'comptes, abonnements, empreintes de mots de passe' },
  { nom: 'email_log',       obligatoire: false, pourquoi: 'desinscriptions et garde anti-doublon des campagnes' },
  { nom: 'weekly_reports',  obligatoire: false, pourquoi: 'recaps hebdomadaires publies' },
];

const PAGE = 1000;   // Supabase plafonne une reponse a 1000 lignes : on pagine, sinon on tronque en silence.

function log(x) { console.log('  ' + x); }

async function exporterTable(client, t) {
  const lignes = [];
  for (let debut = 0; ; debut += PAGE) {
    const { data, error } = await client.from(t.nom).select('*').range(debut, debut + PAGE - 1);
    if (error) throw new Error(error.message || String(error));
    if (!data || !data.length) break;
    lignes.push(...data);
    if (data.length < PAGE) break;           // derniere page
    if (lignes.length > 500000) throw new Error('plus de 500 000 lignes : garde-fou, export interrompu');
  }
  return lignes;
}

(async () => {
  if (!NOEUDS.length) { console.error('  X aucune configuration Supabase dans l environnement'); process.exit(1); }
  fs.mkdirSync(SORTIE, { recursive: true });

  let client = null, nomNoeud = '';
  for (const [nom, url, key] of NOEUDS) {
    try {
      const c = createClient(url, key, { auth: { persistSession: false } });
      // Sonde minimale : une seule ligne, pour ne pas payer une lecture complete juste pour tester.
      const { error } = await c.from('users').select('id').limit(1);
      if (error) throw new Error(error.message);
      client = c; nomNoeud = nom; break;
    } catch (e) { log('noeud ' + nom + ' indisponible (' + String(e.message).slice(0, 80) + ')'); }
  }
  if (!client) { console.error('  X aucun noeud Supabase ne repond : AUCUN export produit'); process.exit(1); }
  log('noeud utilise : ' + nomNoeud);

  const bilan = { genereLe: new Date().toISOString(), noeud: nomNoeud, tables: {} };
  let echecObligatoire = false;

  for (const t of TABLES) {
    try {
      const lignes = await exporterTable(client, t.nom);
      const fic = path.join(SORTIE, t.nom + '.json');
      fs.writeFileSync(fic, JSON.stringify(lignes));
      /* ⚠️ ON RELIT CE QU ON VIENT D ECRIRE. Un fichier tronque par un disque plein a l air d un
         export et n en est pas : c est exactement le piege deja corrige sur l archive elle-meme. */
      const relu = JSON.parse(fs.readFileSync(fic, 'utf8'));
      if (relu.length !== lignes.length) throw new Error('relecture incoherente');
      bilan.tables[t.nom] = { lignes: lignes.length, octets: fs.statSync(fic).size };
      log('v ' + t.nom.padEnd(16) + lignes.length + ' ligne(s), ' + Math.round(fs.statSync(fic).size / 1024) + ' Ko  (' + t.pourquoi + ')');
    } catch (e) {
      bilan.tables[t.nom] = { erreur: String(e.message).slice(0, 200) };
      log('X ' + t.nom.padEnd(16) + String(e.message).slice(0, 90));
      if (t.obligatoire) echecObligatoire = true;
    }
  }

  bilan.note = "ai_cache n'est PAS exporte : c'est un cache, il se regenere, et le lire couterait du trafic sortant pour rien.";
  fs.writeFileSync(path.join(SORTIE, '_bilan.json'), JSON.stringify(bilan, null, 2));

  if (echecObligatoire) {
    console.error("  X la table « users » n a pas pu etre exportee : cet export N EST PAS une sauvegarde.");
    process.exit(1);
  }
  log('export termine dans ' + SORTIE);
})().catch(e => { console.error('  X export : ' + (e && e.message)); process.exit(1); });
