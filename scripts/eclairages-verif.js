#!/usr/bin/env node
/**
 * eclairages-verif.js — LES OCTETS D'UN RAPPORT ONT UNE SEULE SOURCE.
 * ------------------------------------------------------------------------------------------------
 * Le 16/09, capture client sur « KBC Sunset » : le PDF s'affiche plein cadre, et juste au-dessus
 * « Éclairages desk indisponibles pour ce rapport (contenu non extractible pour le moment) ». Le
 * desk affichait donc le document dont il jurait ne pas pouvoir extraire le texte.
 *
 * CAUSE MESURÉE : deux chemins pour les mêmes octets, et un seul était robuste.
 *   · `/api/pdf-proxy` (l'AFFICHAGE) lit d'abord le PDF déjà posé sur disque par `_pdfWarmDisk`,
 *     puis retente 3 fois, 25 s, 30 Mo, et accepte la signature `%PDF-`.
 *   · `_pdfText` (l'ANALYSE) repartait vers la banque : un seul essai, 12 s, 6 Mo, sans jamais
 *     regarder le fichier posé à côté. Le CDN de KBC refuse l'adresse du centre de données — le
 *     dépôt le sait déjà, c'est pour ça que la LISTE passe par le lecteur jina.
 * Preuve indirecte au passage : les huit clés `pdftxt:` du cache durable (Standard Chartered,
 * Danske, BlackRock) montrent que `pdftotext` fonctionne parfaitement en production. Rien ne
 * manquait à l'extraction ; c'est l'ACCÈS AUX OCTETS qui manquait.
 *
 * CE BANC EXTRAIT ET EXÉCUTE `_pdfOctets` — le vrai code de server.js, pas une copie — avec un
 * `axios` et un disque doublés, pour LIRE ce que la fonction a réellement demandé.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const _crypto = require('crypto');

let ok = 0, ko = 0;
const vert = m => { ok++; console.log('  \x1b[32m✓\x1b[0m ' + m); };
const rouge = (m, d) => { ko++; console.log('  \x1b[31m✗\x1b[0m ' + m + (d ? '\n      ' + d : '')); };
const titre = t => console.log('\n── ' + t + ' ──');

const SRV = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

/* EXTRACTION PAR ÉQUILIBRE D'ACCOLADES, pas par tranche de lignes. Une borne d'extraction est un
   contrat (leçon du 10/09 : `tactile-verif` a fait échouer un déploiement sur du code sain parce
   qu'une fonction avait bougé hors de sa tranche). Ici la borne est le NOM de la fonction, et si
   elle ne se trouve plus, le banc le DIT au lieu d'éprouver un fragment amputé. */
function extraire(nom) {
  const i = SRV.indexOf('async function ' + nom + '(');
  if (i < 0) return null;
  let prof = 0;
  for (let k = SRV.indexOf('{', i); k < SRV.length; k++) {
    if (SRV[k] === '{') prof++;
    else if (SRV[k] === '}') { prof--; if (prof === 0) return SRV.slice(i, k + 1); }
  }
  return null;
}

const PDF_OK = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(2000, 0x20)]);
const URL_KBC = 'https://kbc.com/sunset.pdf';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'dtp-eclairages-'));

/** Monte `_pdfOctets` sur un disque et un réseau doublés. `journal` note ce que le réseau a reçu. */
function monter(src, { surDisque = null, reponses = [] } = {}) {
  const journal = [];
  const dossier = fs.mkdtempSync(path.join(TMP, 'cache-'));
  const _pdfCacheFile = u => path.join(dossier, _crypto.createHash('sha1').update(String(u)).digest('hex') + '.pdf');
  if (surDisque) fs.writeFileSync(_pdfCacheFile(URL_KBC), surDisque);
  let n = 0;
  const axios = {
    get: async (u, cfg) => {
      journal.push({ u, timeout: cfg && cfg.timeout, max: cfg && cfg.maxContentLength, redirects: cfg && cfg.maxRedirects });
      const r = reponses.length ? reponses[Math.min(n++, reponses.length - 1)] : new Error('aucune réponse prévue');
      if (r instanceof Error) throw r;
      return { data: r, headers: {} };
    },
  };
  const fabrique = new Function('axios', 'fs', '_pdfCacheFile', '_disqueFreinActif', 'console',
    src + '\nreturn _pdfOctets;');
  return { appel: fabrique(axios, fs, _pdfCacheFile, () => false, { warn() {} }), journal, _pdfCacheFile };
}

(async () => {
  titre('Le banc tient bien le vrai code');
  const SRC = extraire('_pdfOctets');
  if (!SRC) {
    rouge('`_pdfOctets` introuvable dans server.js',
      "la fonction a été renommée ou déplacée : ce banc n'éprouve plus rien, il faut le recâbler");
    return;
  }
  vert(`\`_pdfOctets\` extrait de server.js (${SRC.length} caractères)`);

  titre("Le PDF déjà affiché n'est jamais retéléchargé");
  {
    const { appel, journal } = monter(SRC, { surDisque: PDF_OK, reponses: [new Error('le réseau ne doit pas être touché')] });
    const buf = await appel(URL_KBC);
    if (buf && buf.slice(0, 5).toString('latin1') === '%PDF-') vert('les octets sortent du disque, signature %PDF- vérifiée');
    else rouge("rien n'est sorti du disque alors que le fichier y était");
    if (journal.length === 0) vert("zéro appel réseau : c'est le chemin que l'affichage emprunte déjà");
    else rouge(`${journal.length} appel(s) réseau alors que le PDF était sur disque`, 'exactement le défaut mesuré le 16/09');
  }

  titre("Sans fichier sur disque, la récupération est celle de l'affichage");
  {
    const { appel, journal, _pdfCacheFile } = monter(SRC, { reponses: [PDF_OK] });
    const buf = await appel(URL_KBC);
    if (buf) vert('le PDF est récupéré au premier essai');
    else rouge("le PDF n'a pas été récupéré alors que la source répondait");
    const c = journal[0] || {};
    if (c.timeout >= 25000) vert(`délai d'attente ${c.timeout} ms (l'affichage accorde 25 000 ms)`);
    else rouge(`délai d'attente ${c.timeout} ms : plus court que celui de l'affichage`, 'une source lente repartira les mains vides');
    if (c.max >= 30 * 1024 * 1024) vert(`plafond de taille ${Math.round(c.max / 1048576)} Mo (l'affichage en accepte 30)`);
    else rouge(`plafond ${Math.round((c.max || 0) / 1048576)} Mo : un rapport plus gros s'affiche mais reste inanalysable`);
    if (c.redirects >= 3) vert(`${c.redirects} redirections suivies, comme l'affichage`);
    else rouge(`${c.redirects} redirection(s) suivie(s)`);
    if (fs.existsSync(_pdfCacheFile(URL_KBC))) vert("le PDF récupéré est mis en cache : l'affichage en profite à son tour");
    else rouge("le PDF récupéré n'est pas mis en cache", 'chaque analyse le retéléchargerait');
  }

  titre("Un hoquet d'egress ne fait plus tomber les éclairages");
  {
    const { appel, journal } = monter(SRC, { reponses: [new Error('ECONNRESET'), new Error('ETIMEDOUT'), PDF_OK] });
    const buf = await appel(URL_KBC);
    if (buf) vert('deux échecs transitoires puis succès : les octets arrivent quand même');
    else rouge('deux échecs transitoires suffisent encore à perdre le rapport');
    if (journal.length === 3) vert('exactement 3 essais, comme /api/pdf-proxy — ni moins, ni une boucle sans fin');
    else rouge(`${journal.length} essais au lieu de 3`);
  }

  titre("Ce qui n'est pas un PDF n'est pas analysé");
  {
    const html = Buffer.concat([Buffer.from('<!doctype html><title>403 Forbidden</title>'), Buffer.alloc(2000, 0x20)]);
    const { appel } = monter(SRC, { reponses: [html, html, html] });
    if (!(await appel(URL_KBC))) vert("une page d'erreur HTML servie à la place du PDF est refusée");
    else rouge('une page HTML est passée pour un PDF', 'les éclairages porteraient sur un message d\'erreur');
  }
  {
    const court = Buffer.from('%PDF-');
    const { appel } = monter(SRC, { reponses: [court, court, court] });
    if (!(await appel(URL_KBC))) vert('un fichier tronqué (sous 1 200 octets) est refusé');
    else rouge('un fichier tronqué est passé');
  }

  titre("La route ne renvoie plus une réponse muette sur une adresse de PDF");
  /* Les octets sont désormais accessibles ; restait que, si l'extraction échouait QUAND MÊME, la
     route tombait dans la suite du code — qui passe un PDF binaire à cheerio — et répondait
     `html: ''`, sans repli. Le bouton « Réessayer » du client rejouait le même chemin et le même
     silence. On vérifie que le repli (PDF rendu, puis lecteur jina) est câblé sur cette branche. */
  {
    const iPdf = SRV.indexOf(".pdf(?:[?#]|$)/i.test(url)");
    const bloc = iPdf < 0 ? '' : SRV.slice(iPdf, SRV.indexOf('if (!_brContentAllowed', iPdf));
    if (!bloc) rouge('branche « adresse de PDF » introuvable dans /api/bank-research-content');
    else {
      if (/_thinInsightsText\(/.test(bloc)) vert('le repli `_thinInsightsText` est câblé sur la branche PDF');
      else rouge("la branche PDF n'a aucun repli", 'une extraction ratée y redevient un panneau muet');
      if (/_thinInsightsText\(\s*url\s*,\s*''/.test(bloc)) vert("et il n'y rejoue pas `_pdfText`, qui vient d'échouer sur cette adresse");
      else rouge("le repli relance l'extraction sur l'adresse qui vient d'échouer", 'trois requêtes de plus pour le même silence');
      const sorties = bloc.match(/return res\.json\(\{[\s\S]{0,260}?\}\)/g) || [];
      const muettes = sorties.filter(s => !/insightsText|html: _html/.test(s));
      if (sorties.length >= 3 && !muettes.length) vert(`les ${sorties.length} sorties de la branche portent toutes du texte ou un état nommé`);
      else if (!sorties.length) rouge('aucune sortie repérée dans la branche PDF');
      else rouge(`${muettes.length} sortie(s) de la branche partent sans rien dire`, muettes[0].slice(0, 140));
    }
  }

  titre("Témoin : rendre à `_pdfOctets` sa faiblesse d'avant doit faire rougir");
  /* Sans témoin, tout ce qui précède pourrait être vert parce qu'il ne mesure rien. On MUTE le vrai
     code — on lui retire son regard vers le disque — et on exige que le premier contrôle tombe. */
  {
    const mute = SRC.replace(/const cf = _pdfCacheFile\(url\);/, 'const cf = _pdfCacheFile(url + "|jamais-sur-disque");');
    if (mute === SRC) {
      rouge("la mutation du témoin n'a rien changé au source", 'la lecture disque a changé de forme : le témoin ne prouve plus rien');
    } else {
      const { appel, journal } = monter(mute, { surDisque: PDF_OK, reponses: [new Error('403 Forbidden')] });
      const buf = await appel(URL_KBC);
      if (!buf && journal.length === 3) vert('privé du disque, le vrai code repart les mains vides sur un 403 — le banc mord bien');
      else rouge('le témoin ne mord pas', `octets=${!!buf}, essais=${journal.length}`);
    }
  }
})().then(() => {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
  console.log(`\n${ko ? '\x1b[31m✗' : '\x1b[32m✓'} ${ok} contrôle${ok > 1 ? 's' : ''} au vert${ko ? `, \x1b[31m${ko} au rouge` : ''}\x1b[0m`);
  process.exit(ko ? 1 : 0);
}).catch(e => {
  console.log(`\n\x1b[31m✗ le banc lui-même a échoué : ${(e && e.message) || e}\x1b[0m`);
  process.exit(1);
});
