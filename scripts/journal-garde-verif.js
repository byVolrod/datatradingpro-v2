#!/usr/bin/env node
/**
 * journal-garde-verif.js — UN ENREGISTREMENT NE PEUT PLUS EFFACER UN JOURNAL PAR OMISSION.
 * ------------------------------------------------------------------------------------------------
 * 16/09, retour user : « je ne trouve plus mon template JOT ». Mesuré dans la base : son journal y
 * était INTACT (37 entrées, 21 colonnes, custom = true, daté du 14/06). Rien n'était perdu ; le desk
 * ne le montrait plus.
 *
 * LA CAUSE, dans `POST /api/journal` : l'objet stocké était reconstruit INTÉGRALEMENT depuis le
 * corps de la requête. Un client qui enregistre avant d'avoir reçu ses données — page rouverte
 * pendant un redémarrage, réseau lent, onglet restauré par le navigateur — écrivait
 * `{ entries: [], custom: false }` par-dessus le journal réel, et sur les QUATRE bases d'un coup
 * puisque `ai_cache` est dual-écrite.
 * ET `custom` EST LE CHAMP QUI FAIT DISPARAÎTRE LE MODÈLE : à `false`, le desk re-propose le gabarit
 * DTP standard au lieu du journal personnalisé. C'est exactement le symptôme décrit.
 *
 * LA RÈGLE appliquée est celle que `auth.js` applique déjà aux comptes depuis le 03/09 : on laisse
 * passer ce qui ÉTEND, on refuse ce qui RETIRE en silence, et on le TRACE.
 *
 * CE BANC EXTRAIT ET EXÉCUTE `_jrFusionSure` — le vrai code de server.js, pas une copie — sur le
 * scénario mesuré et sur ses contre-exemples. Témoin de mutation compris : sans la garde, le journal
 * de la capture est bien écrasé.
 */
const fs = require('fs');
const path = require('path');

let ok = 0, ko = 0;
const vert = m => { ok++; console.log('  \x1b[32m✓\x1b[0m ' + m); };
const rouge = (m, d) => { ko++; console.log('  \x1b[31m✗\x1b[0m ' + m + (d ? '\n      ' + d : '')); };
const titre = t => console.log('\n── ' + t + ' ──');

const SRV = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
function extraire(nom) {
  const i = SRV.indexOf('function ' + nom + '(');
  if (i < 0) return null;
  let prof = 0;
  for (let k = SRV.indexOf('{', i); k < SRV.length; k++) {
    if (SRV[k] === '{') prof++;
    else if (SRV[k] === '}') { prof--; if (prof === 0) return SRV.slice(i, k + 1); }
  }
  return null;
}

titre('Le banc tient bien le vrai code');
const SRC = extraire('_jrFusionSure');
if (!SRC) {
  rouge('`_jrFusionSure` introuvable dans server.js', 'ce banc n\'éprouve plus rien, il faut le recâbler');
  console.log('\n\x1b[31m✗ 0 contrôle au vert, 1 au rouge\x1b[0m');
  process.exit(1);
}
vert('`_jrFusionSure` extrait de server.js (' + SRC.length + ' caractères)');
const monter = src => new Function(src + '\nreturn _jrFusionSure;')();
const fusion = monter(SRC);

/* LE JOURNAL DE LA CAPTURE, dans sa forme mesurée en base. */
const JOURNAL = () => ({
  entries: Array.from({ length: 37 }, (_, i) => ({ id: 'e' + i })),
  cols: Array.from({ length: 21 }, (_, i) => ({ k: 'c' + i })),
  custom: true,
  startCap: 10000,
  comptes: [{ id: 'a', nom: 'Principal' }],
  startCaps: { a: 10000 },
});

titre('Le corps vide d\'un client qui n\'a rien chargé est REFUSÉ');
{
  const r = fusion(JOURNAL(), { entries: [], cols: null, comptes: null, startCaps: null, startCap: undefined, custom: false, customFourni: true });
  if (r.refuse) vert('l\'enregistrement est refusé, pas appliqué');
  else rouge('le journal de 37 entrées a été écrasé par un corps vide', JSON.stringify(r.stored && { e: r.stored.entries.length, custom: r.stored.custom }));
  if (r.refuse && /37 entrée/.test(r.raison || '')) vert('… et le refus DIT ce qu\'il protégeait (traçable dans le journal serveur)');
  else if (r.refuse) rouge('le refus ne dit pas ce qu\'il protégeait', r.raison);
}

titre('Ce qui n\'est pas fourni est PRÉSERVÉ, jamais effacé par omission');
{
  // Le cas ordinaire : le journal enregistre ses entrées, sans renvoyer ses colonnes.
  const r = fusion(JOURNAL(), { entries: [{ id: 'x' }, { id: 'y' }], cols: null, comptes: null, startCaps: null, startCap: undefined, custom: false, customFourni: false });
  if (!r.refuse && r.stored.entries.length === 2) vert('les entrées fournies font autorité (2 entrées enregistrées)');
  else rouge('les entrées fournies ne sont pas enregistrées', JSON.stringify(r));
  if (r.stored && r.stored.cols && r.stored.cols.length === 21) vert('les 21 colonnes sont préservées, bien qu\'absentes du corps');
  else rouge('les colonnes ont été effacées par omission', JSON.stringify(r.stored && r.stored.cols));
  if (r.stored && r.stored.custom === true) vert('`custom` reste à true : le gabarit DTP ne revient pas prendre la place du modèle');
  else rouge('`custom` est retombé à false : le desk re-proposerait le gabarit standard', String(r.stored && r.stored.custom));
  if (r.stored && r.stored.startCap === 10000) vert('le capital de départ est préservé');
  else rouge('le capital de départ a été perdu', String(r.stored && r.stored.startCap));
  if (r.stored && r.stored.comptes && r.stored.startCaps) vert('les comptes et leurs capitaux sont préservés');
  else rouge('les comptes ont été perdus');
  if ((r.preserve || []).includes('cols') && (r.preserve || []).includes('custom')) vert('… et chaque préservation est SIGNALÉE (sans trace, personne n\'apprend que le client envoie mal)');
  else rouge('les préservations ne sont pas signalées', JSON.stringify(r.preserve));
}

titre('Ce qui reste légitime passe toujours');
{
  // Supprimer ses trades un par un jusqu'au dernier : geste réel, le corps porte colonnes ET custom.
  const r = fusion(JOURNAL(), { entries: [], cols: JOURNAL().cols, comptes: null, startCaps: null, startCap: undefined, custom: true, customFourni: true });
  if (!r.refuse && r.stored.entries.length === 0) vert('vider son journal trade par trade reste possible');
  else rouge('un vidage légitime est refusé', JSON.stringify(r));
  if (r.stored && r.stored.custom === true) vert('… et le modèle personnalisé survit au vidage');
  else rouge('le modèle a été perdu en vidant les trades');
}
{
  // Un premier enregistrement sur un journal qui n'existe pas encore.
  const r = fusion(null, { entries: [{ id: 'a' }], cols: null, comptes: null, startCaps: null, startCap: undefined, custom: false, customFourni: true });
  if (!r.refuse && r.stored.entries.length === 1) vert('un tout premier enregistrement passe (aucun journal à protéger)');
  else rouge('le premier enregistrement est refusé', JSON.stringify(r));
  if (r.stored.custom === false) vert('… et n\'invente pas une personnalisation qui n\'existe pas');
  else rouge('`custom` a été inventé à true');
}
{
  // Un corps vide sur un journal vide : rien à protéger, rien à refuser.
  const r = fusion({ entries: [], custom: false }, { entries: [], cols: null, comptes: null, startCaps: null, startCap: undefined, custom: false, customFourni: true });
  if (!r.refuse) vert('un corps vide sur un journal vide ne déclenche aucun refus inutile');
  else rouge('refus inutile sur un journal déjà vide', r.raison);
}
{
  // L'IMPORT d'un journal perso : custom passe de false à true, et les colonnes arrivent.
  const r = fusion({ entries: [{ id: 'z' }], custom: false }, { entries: [{ id: 'z' }], cols: [{ k: 'a' }], comptes: null, startCaps: null, startCap: undefined, custom: true, customFourni: true });
  if (!r.refuse && r.stored.custom === true && r.stored.cols) vert('importer un journal perso fonctionne (custom passe à true)');
  else rouge('un import légitime est bloqué', JSON.stringify(r));
}

titre('Témoin : sans la garde, le journal de la capture EST écrasé');
{
  /* On rejoue l'ancienne écriture, telle qu'elle était avant le 16/09. Elle doit détruire. */
  const avant = (body) => {
    const stored = { entries: body.entries || [], custom: !!body.custom };
    if (body.cols) stored.cols = body.cols;
    return stored;
  };
  const detruit = avant({ entries: [], custom: false });
  if (detruit.entries.length === 0 && detruit.custom === false && !detruit.cols) {
    vert('l\'ancienne écriture rend bien { entries: [], custom: false, sans colonnes } : elle détruisait');
  } else rouge('le témoin ne reproduit pas le défaut');

  // Et la mutation du VRAI code : on retire le refus, le journal doit repasser à zéro entrée.
  const mute = SRC.replace(/if \(apporteRien && \(avaitEntrees \|\| avaitCols \|\| avaitCustom\)\) \{[\s\S]*?\n  \}/, '');
  if (mute === SRC) {
    rouge('la mutation du témoin n\'a rien changé au source', 'la garde a changé de forme : ce témoin ne prouve plus rien');
  } else {
    const r = monter(mute)(JOURNAL(), { entries: [], cols: null, comptes: null, startCaps: null, startCap: undefined, custom: false, customFourni: true });
    if (!r.refuse) vert('(témoin) sans le refus, l\'enregistrement vide passe bien — la garde est donc ce qui l\'arrête');
    else rouge('(témoin) la mutation ne mord pas');
  }
}

(async () => {
/* ══ LES LAYOUTS : UN JALON SE PREND QUAND LES DONNÉES RÉTRÉCISSENT ══════════════════════════════
   16/09, retour user : « mon layout JOT a disparu ». Mesuré en base : ses trois clés (courant,
   sauvegarde, historique) ne portaient plus qu'une disposition, « Vue générale ». Le filet de
   sécurité avait donc enregistré la perte au lieu de la rattraper.
   LA CAUSE : `_wdgHistPush` ne prend un jalon qu'une fois par 24 h. Règle juste pour une session de
   mise en page ordinaire — une dizaine d'enregistrements ne doit pas chasser trois jours de
   sauvegardes. Mais si le PREMIER enregistrement de la journée est déjà celui qui perd des
   dispositions, le jalon fige l'état appauvri et tous les suivants écrasent sans plus rien
   sauvegarder. Le seul instant où une sauvegarde compte était précisément celui que le quota
   écartait. */
{
  const SRC_R = extraire('_wdgRetrecit');
  /* `extraire` borne sur « function <nom>( » : sur une fonction ASYNC elle coupe APRÈS le mot-clé
     et rend un source qui ne compile pas. On le rend ici plutôt que d'élargir la borne pour tout
     le monde : c'est une propriété de CETTE fonction, pas de l'extracteur. */
  const _p = extraire('_wdgHistPush');
  const SRC_P = _p ? ('async ' + _p) : null;
  if (!SRC_R || !SRC_P) {
    rouge('`_wdgRetrecit` / `_wdgHistPush` introuvables dans server.js', 'ce banc n\'éprouve plus les layouts');
  } else {
    vert('`_wdgRetrecit` et `_wdgHistPush` extraits de server.js');
    const L = (n, items) => ({ id: 'l' + n, name: 'L' + n, items: Array.from({ length: items }, (_, i) => ({ id: 'w' + i })) });
    const retrecit = new Function(SRC_R + '\nreturn _wdgRetrecit;')();

    titre('Reconnaître un enregistrement qui RÉTRÉCIT');
    if (retrecit({ layouts: [L(1, 3), L(2, 4)] }, { layouts: [L(1, 3)] })) vert('perdre une disposition est vu comme un rétrécissement');
    else rouge('perdre une disposition passe inaperçu');
    if (retrecit({ layouts: [L(1, 5)] }, { layouts: [L(1, 2)] })) vert('perdre des widgets à nombre de dispositions égal est vu aussi');
    else rouge('un cockpit qui se vide sans perdre de ligne passe inaperçu');
    if (!retrecit({ layouts: [L(1, 3)] }, { layouts: [L(1, 3), L(2, 2)] })) vert('AJOUTER une disposition n\'est pas un rétrécissement');
    else rouge('un ajout est pris pour une perte : un jalon serait forcé à chaque création');
    if (!retrecit({ layouts: [L(1, 3)] }, { layouts: [L(1, 3)] })) vert('un enregistrement identique ne force rien');
    else rouge('un enregistrement sans changement force un jalon');
    if (!retrecit(null, { layouts: [L(1, 3)] })) vert('un tout premier enregistrement ne force rien (rien à protéger)');
    else rouge('le premier enregistrement force un jalon inutile');

    titre('Le jalon est pris MALGRÉ le quota de 24 h quand ça rétrécit');
    const jouer = async (histExistant, courant, forcer) => {
      const kv = new Map(Object.entries(histExistant || {}));
      const auth = {
        aiCacheGet: async k => kv.has(k) ? kv.get(k) : null,
        aiCacheSet: async (k, v) => { kv.set(k, v); },
      };
      kv.set('wdg:u', courant);
      const f = new Function('auth', '_WDG_KV_TTL', '_WDG_HIST_MAX', '_WDG_HIST_MS', '_wdgHistLire',
        SRC_P + '\nreturn _wdgHistPush;');
      const lire = async uid => {
        const h = kv.get('wdg:' + uid + ':hist');
        let v = (h && Array.isArray(h.v)) ? h.v : [];
        return v.sort((a, b) => b.at - a.at).slice(0, 3);
      };
      await f(auth, 1, 3, 24 * 3600e3, lire)('u', forcer);
      return kv.get('wdg:u:hist');
    };
    const jalonDuJour = { 'wdg:u:hist': { v: [{ at: Date.now() - 3600e3, cfg: { layouts: [L(1, 3)] } }] } };

    const sans = await jouer(jalonDuJour, { layouts: [L(1, 3), L(2, 4)] }, false);
    if (sans.v.length === 1) vert('sans rétrécissement, le quota tient : pas de jalon de plus');
    else rouge('le quota des 24 h ne tient plus : l\'historique se remplirait à chaque enregistrement', String(sans.v.length));

    const avec = await jouer(jalonDuJour, { layouts: [L(1, 3), L(2, 4)] }, true);
    if (avec.v.length === 2) vert('avec rétrécissement, le jalon est pris malgré le quota du jour');
    else rouge('le jalon n\'est PAS pris quand ça rétrécit : le filet reste aveugle au seul moment utile', String(avec.v.length));

    titre('Un jalon riche n\'est pas chassé par un jalon pauvre');
    /* Sans cette garde, trois enregistrements qui rétrécissent d'affilée videraient l'historique de
       ce qu'il protège : le filet se retournerait contre lui-même en une minute. */
    const plein = { 'wdg:u:hist': { v: [
      { at: Date.now() - 1000, cfg: { layouts: [L(1, 3), L(2, 4), L(3, 5)] } },   // le RICHE
      { at: Date.now() - 2000, cfg: { layouts: [L(1, 1)] } },
      { at: Date.now() - 3000, cfg: { layouts: [L(1, 1)] } },
    ] } };
    const apres = await jouer(plein, { layouts: [L(1, 1)] }, true);
    const poids = x => (x.cfg.layouts || []).reduce((n, l) => n + 1 + (l.items ? l.items.length : 0), 0);
    if (apres.v.some(x => poids(x) >= 15)) vert('le jalon le plus riche survit à trois rétrécissements d\'affilée');
    else rouge('le jalon riche a été chassé : le filet a effacé ce qu\'il devait protéger',
      apres.v.map(poids).join(' · '));
    if (apres.v.length === 3) vert('… et l\'historique garde bien ses trois places');
    else rouge('l\'historique n\'a plus trois places', String(apres.v.length));

    titre('Témoin : sans le forçage, le scénario du 16/09 se reproduit');
    const mute = SRC_P.replace('if (!forcer && v.length', 'if (v.length');
    if (mute === SRC_P) {
      rouge('la mutation du témoin n\'a rien changé', 'la garde a changé de forme : ce témoin ne prouve plus rien');
    } else {
      const kv = new Map([['wdg:u:hist', { v: [{ at: Date.now() - 3600e3, cfg: { layouts: [L(1, 3)] } }] }],
                          ['wdg:u', { layouts: [L(1, 3), L(2, 4)] }]]);
      const authM = { aiCacheGet: async k => kv.get(k) || null, aiCacheSet: async (k, v) => { kv.set(k, v); } };
      const lireM = async uid => { const h = kv.get('wdg:' + uid + ':hist'); return (h && h.v) ? h.v.slice() : []; };
      await new Function('auth', '_WDG_KV_TTL', '_WDG_HIST_MAX', '_WDG_HIST_MS', '_wdgHistLire',
        mute + '\nreturn _wdgHistPush;')(authM, 1, 3, 24 * 3600e3, lireM)('u', true);
      if (kv.get('wdg:u:hist').v.length === 1) vert('(témoin) sans le forçage, aucun jalon n\'est pris malgré la perte');
      else rouge('(témoin) la mutation ne mord pas');
    }
  }
}

})().then(() => {
console.log(`\n${ko ? '\x1b[31m✗' : '\x1b[32m✓'} ${ok} contrôle${ok > 1 ? 's' : ''} au vert${ko ? `, \x1b[31m${ko} au rouge` : ''}\x1b[0m`);
process.exit(ko ? 1 : 0);
});
