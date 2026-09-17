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

   ⚠️ ZERO DEPENDANCE (17/09/2026, meme jour que la decouverte). Ce script appelait
   `@supabase/supabase-js`, un module npm — et `node_modules` sur l HOTE (par opposition a l IMAGE
   Docker) n avait JAMAIS ete installe : seul le Dockerfile fait `npm ci`, ce qui ne concerne que
   le conteneur. Pire : `npm` lui-meme n etait pas installe sur cette machine. Consequence mesuree :
   la sauvegarde, tout juste debloquee d un premier defaut (droit d execution, puis lecture du
   .env), echouait encore sur « Cannot find module '@supabase/supabase-js' » — une TROISIEME cause
   d echec silencieux empilee sur les deux precedentes, le meme jour.
   `scripts/supabase-keepalive.js`, plus ancien, avait deja resolu ce probleme EN NE L AYANT PAS :
   il ne depend de rien, en parlant directement a l API REST de Supabase (PostgREST) via `fetch`,
   deja natif au Node installe sur cette machine (v18.19.1). Ce script suit desormais la meme
   regle : aucune dependance npm ne doit plus jamais etre necessaire pour qu une tache systemd
   tourne sur l HOTE. `npm ci`/`apt install npm` restent poses en filet (voir scripts/deploy.sh et
   vps-autodeploiement.sh), mais plus AUCUN script d hote n en a besoin pour fonctionner.

   ⚠️ LECTURE SEULE, PAR CONSTRUCTION. Le script n appelle que des GET (`select`). Il ne peut ni
   modifier ni supprimer quoi que ce soit, meme en cas de bug.

   Usage (sur le serveur, depuis /opt/datatradingpro) :  node scripts/vps/dtp-export-bdd.js
   ═══════════════════════════════════════════════════════════════════════════════════════════════ */
'use strict';
const fs = require('fs');
const path = require('path');

try { require('dotenv').config(); } catch (e) { /* les variables peuvent venir de l environnement, et dotenv lui-meme est optionnel */ }

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
  /* ⚠️ AJOUTEES LE 03/09/2026, ET LEUR ABSENCE ETAIT LE TROU LE PLUS COUTEUX DE CETTE LISTE.
     La sauvegarde se disait « la base » et n emportait ni les conversations du support, ni le
     magasin cle-valeur — c est-a-dire ni l historique d echange avec chaque client, ni les MODELES
     DE JOURNAL DE BORD (cle `journal:<compte>`), ni les avatars, ni les recherches recentes, ni
     les reactions du chat. Autrement dit : precisement ce que l utilisateur a cru perdre le 03/09.
     Une archive qui ne porte pas ces deux tables laisse croire que tout est sauvegarde alors que
     le contenu produit PAR LES CLIENTS ne l est pas.
     ⚠️ `ai_cache` porte aussi, depuis le 03/09, la LISTE NOIRE et les PIERRES TOMBALES (cles
     `auth:blacklist` et `auth:tombstones`) : les deux magasins qui ne vivaient que dans un fichier.
     Les exporter ici, c est les mettre a l abri d un volume perdu.
     TAILLES MESUREES sur la base principale le 03/09 : ai_cache 1,4 Mo (428 lignes),
     chat_messages 832 Ko. L accumulation en memoire reste donc sans risque sur un VPS a 512 Mo,
     et le garde-fou des 500 000 lignes couvre la derive. */
  { nom: 'chat_messages',   obligatoire: false, pourquoi: 'conversations du support, dans les deux sens' },
  { nom: 'ai_cache',        obligatoire: false, pourquoi: 'modeles de journal, avatars, liste noire, pierres tombales' },
];

const PAGE = 1000;      // Supabase plafonne une reponse a 1000 lignes : on pagine, sinon on tronque en silence.
const DELAI_MS = 15000; // Une requete qui ne repond jamais ne doit pas bloquer une sauvegarde nocturne.

function log(x) { console.log('  ' + x); }

/* Un appel GET a l API REST de PostgREST, avec pagination par en-tete `Range` — l equivalent
   exact de `.select('*').range(debut, fin)` du SDK, sans la dependance. */
async function supaGet(url, key, table, debut, fin) {
  const controleur = new AbortController();
  const minuteur = setTimeout(() => controleur.abort(), DELAI_MS);
  try {
    const rep = await fetch(url.replace(/\/+$/, '') + '/rest/v1/' + encodeURIComponent(table) + '?select=*', {
      headers: {
        apikey: key,
        Authorization: 'Bearer ' + key,
        'Range-Unit': 'items',
        Range: debut + '-' + fin,
      },
      signal: controleur.signal,
    });
    if (!rep.ok && rep.status !== 206) {
      let detail = '';
      try { detail = JSON.stringify(await rep.json()); } catch { try { detail = await rep.text(); } catch {} }
      throw new Error('HTTP ' + rep.status + (detail ? ' — ' + detail.slice(0, 200) : ''));
    }
    return await rep.json();
  } finally {
    clearTimeout(minuteur);
  }
}

async function exporterTable(url, key, t) {
  const lignes = [];
  for (let debut = 0; ; debut += PAGE) {
    const data = await supaGet(url, key, t.nom, debut, debut + PAGE - 1);
    if (!Array.isArray(data)) throw new Error('reponse inattendue (pas un tableau)');
    if (!data.length) break;
    lignes.push(...data);
    if (data.length < PAGE) break;           // derniere page
    if (lignes.length > 500000) throw new Error('plus de 500 000 lignes : garde-fou, export interrompu');
  }
  return lignes;
}

(async () => {
  if (!NOEUDS.length) { console.error('  X aucune configuration Supabase dans l environnement'); process.exit(1); }
  fs.mkdirSync(SORTIE, { recursive: true });

  let noeud = null;
  for (const [nom, url, key] of NOEUDS) {
    try {
      // Sonde minimale : une seule ligne, pour ne pas payer une lecture complete juste pour tester.
      const data = await supaGet(url, key, 'users', 0, 0);
      if (!Array.isArray(data)) throw new Error('reponse inattendue au sondage');
      noeud = { nom, url, key };
      break;
    } catch (e) { log('noeud ' + nom + ' indisponible (' + String(e.message).slice(0, 80) + ')'); }
  }
  if (!noeud) { console.error('  X aucun noeud Supabase ne repond : AUCUN export produit'); process.exit(1); }
  log('noeud utilise : ' + noeud.nom);

  const bilan = { genereLe: new Date().toISOString(), noeud: noeud.nom, tables: {} };
  let echecObligatoire = false;

  for (const t of TABLES) {
    try {
      const lignes = await exporterTable(noeud.url, noeud.key, t);
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

  fs.writeFileSync(path.join(SORTIE, '_bilan.json'), JSON.stringify(bilan, null, 2));

  if (echecObligatoire) {
    console.error("  X la table « users » n a pas pu etre exportee : cet export N EST PAS une sauvegarde.");
    process.exit(1);
  }
  log('export termine dans ' + SORTIE);
})().catch(e => { console.error('  X export : ' + (e && e.message)); process.exit(1); });
