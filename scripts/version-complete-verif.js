#!/usr/bin/env node
/**
 * scripts/version-complete-verif.js — ONGLET ANALYSTES : LA VERSION COMPLÈTE, JAMAIS LA COURTE (24/09)
 * ------------------------------------------------------------------------------------------------
 * Demande user : « pour tous les rapports onglet analystes je veux pas de versions courtes, met la
 * version complète à chaque fois ». Constat en base : le Récap Quotidien du 23/09 stocké en version
 * courte, et rien ne le remplaçait (la guérison ne visait que les replis `_ai:false`).
 * Ce banc tient les quatre règles, sur les deux rapports concernés (Récap Quotidien, Point Marché) :
 *   1. une version courte est traitée comme un repli → la version complète est retentée ;
 *   2. la retentative attend que Gemini Flash ait du quota (la passe complète ne tient que là) ;
 *   3. une nouvelle tentative ne refait PAS de version courte quand une version rédigée existe ;
 *   4. une version courte ne remplace JAMAIS une version complète du même jour.
 *
 *   node scripts/version-complete-verif.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const SRV = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
let ok = 0, ko = 0;
const v = (n, c) => { if (c) { ok++; console.log('  ✓ ' + n); } else { ko++; console.log('  ✗ ' + n); } };

console.log('\n── Récap Quotidien (FX Daily Recap) ──');
v('version courte = à remplacer, retentée quand Flash a du quota', /const _fxrIsFallback = fxrCurrent && fxrCurrent\._fxr && \(fxrCurrent\._fxr\._ai === false \|\| fxrCurrent\._fxr\._court\);\s*\n\s*if \(!fxrCurrent \|\| \(_fxrIsFallback && _flashPret\(\)\)\)/.test(SRV));
v('les jours passés en version courte sont guéris aussi (7,5 j)', /i\._fxr\._ai === false \|\| i\._fxr\._court \|\| \(i\._fxr\.v \|\| 0\) < FXR_VER/.test(SRV) && /if \(_fxrPastFb && _flashPret\(\) && /.test(SRV));
v('pas de nouvelle version courte quand une version rédigée existe', /if \(!fxr && !_fxrDejaRedige\) \{\s*\n\s*const _court = /.test(SRV));
v('une version courte ne remplace jamais la complète', /if \(fxr\._ai && fxr\._court\) \{\s*\n\s*const _complet = allNews\.find\([^\n]*!i\._fxr\._court\);\s*\n\s*if \(_complet\)[^\n]*return _complet;/.test(SRV));
console.log('\n── Point Marché (DTP Daily) ──');
v('version courte = à remplacer, retentée quand Flash a du quota', /\(dtpdCurrent\._dtpd\._ai === false \|\| dtpdCurrent\._dtpd\._court\)[^\n]*\n\s*if \(!dtpdCurrent \|\| \(_dtpdIsFallback && _flashPret\(\)\)\)/.test(SRV));
v('pas de nouvelle version courte quand une version rédigée existe', /\(!dtpd \|\| !dtpd\.sections \|\| !dtpd\.sections\.length\) && !_dtpdDejaRedige\) \{\s*\n\s*const _court = /.test(SRV));
v('une version courte ne remplace jamais la complète', /if \(dtpd\._ai !== false && dtpd\._court\) \{\s*\n\s*const _complet = allNews\.find\([^\n]*!i\._dtpd\._court\);\s*\n\s*if \(_complet\)[^\n]*return _complet;/.test(SRV));
v('_flashPret lit le vrai état de Flash (ai.flashDispo)', /const _flashPret = \(\) => !\(ai\.flashDispo && !ai\.flashDispo\(\)\);/.test(SRV));

console.log('\n' + (ko ? '✗ ' + ko + ' contrôle(s) en échec\n' : '✓ ' + ok + ' contrôles au vert\n'));
process.exit(ko ? 1 : 0);
