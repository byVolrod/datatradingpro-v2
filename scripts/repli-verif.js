#!/usr/bin/env node
/**
 * scripts/repli-verif.js — UN RAPPORT PROVISOIRE DOIT DIRE POURQUOI, PAS SEULEMENT QU'IL L'EST
 *
 * POURQUOI CE BANC EXISTE (16/09).
 * Le 11/09, sur la capture d'un client, le desk a appris à DIRE au lecteur qu'un Récap Quotidien
 * est une version de secours : le bandeau « Version provisoire ». Cinq jours plus tard le rapport
 * était toujours en anglais, et le signalement est revenu à l'identique. C'est le signal que ce
 * dépôt connaît par cœur : « un symptôme borné deux fois de suite est le signal qu'on n'a pas
 * atteint la cause ». Sauf qu'ici la cause était INOBSERVABLE, par construction.
 *
 * LES TROIS CHEMINS MUETS, mesurés dans le code d'alors. Les deux générateurs (FX Daily Recap,
 * DTP Daily) faisaient tous les deux, mot pour mot :
 *     const m = text.match(/\{[\s\S]*\}/);
 *     const parsed = m ? JSON.parse(m[0]) : null;
 *     if (parsed && …) fxr = …;
 *   } catch (e) { console.warn('… IA échec → repli déterministe:', e.message); }
 * Seule l'EXCEPTION écrivait quelque chose. Trois échecs sur quatre ne laissaient AUCUNE trace :
 *   · `ai.backoffActive()` vrai → la branche entière était sautée, pas une ligne de journal ;
 *   · une réponse sans accolade (refus du modèle, préambule, page d'erreur HTML) → `m` null ;
 *   · un JSON valide mais sans les champs attendus → condition fausse, silence.
 * Et la ligne finale disait « fallback » sans jamais dire de quoi elle était le repli.
 *
 * CE QUE CE BANC ÉPROUVE. Le VRAI `_aiJsonOuRaison` est EXTRAIT de server.js et EXÉCUTÉ (jamais
 * une copie : une copie dériverait, et un banc qui récite sa propre copie est vert par
 * construction). Puis on vérifie que les deux générateurs sont bien branchés dessus, et que la
 * cause atteint un écran — un champ enregistré que personne n'affiche ne vaut pas mieux que le
 * silence qu'on vient de supprimer.
 *
 *   node scripts/repli-verif.js
 */
const fs = require('fs');
const path = require('path');

const RACINE = path.join(__dirname, '..');
const SRV = fs.readFileSync(path.join(RACINE, 'server.js'), 'utf8');
const ADMJS = fs.readFileSync(path.join(RACINE, 'public/js/admin.js'), 'utf8');
const ADMHTML = fs.readFileSync(path.join(RACINE, 'public/admin.html'), 'utf8');

let ok = 0, ko = 0;
const v = (n, c, d) => { if (c) { ok++; console.log('  ✓ ' + n); } else { ko++; console.log('  ✗ ' + n + (d ? '\n      → ' + d : '')); } };

/* ══ 1. LE VRAI HELPER, EXTRAIT ET EXÉCUTÉ ════════════════════════════════════════════════════ */
console.log('\n── La raison du repli, jouée sur le vrai code ──');
const RX_FN = /function _aiJsonOuRaison\(text, exploitable\) \{[\s\S]*?\n\}/;
const SRC = (RX_FN.exec(SRV) || [])[0] || null;
v('_aiJsonOuRaison est extractible de server.js', !!SRC);

const monter = (src) => new Function(src + '\nreturn _aiJsonOuRaison;')();
const utile = p => !!(p && (p.summary || p.title));

if (SRC) {
  const F = monter(SRC);

  // Le cas NOMINAL d'abord : un banc qui ne sait que refuser refuserait aussi le bon cas.
  const bon = F('Voici le rapport :\n{"title":"Le dollar recule","summary":"Séance calme."}\nFin.', utile);
  v('une réponse exploitable rend le JSON, sans raison', !!(bon && bon.parsed && bon.parsed.title === 'Le dollar recule' && !bon.raison), JSON.stringify(bon));

  const vide = F('   \n  ', utile);
  v('réponse vide → raison nommée', !!(vide.raison && /vide/i.test(vide.raison)) && !vide.parsed, JSON.stringify(vide));

  const refus = F('Je ne peux pas produire ce rapport.', utile);
  v('réponse sans accolade → raison + début de la réponse', !!(refus.raison && /sans JSON/i.test(refus.raison) && refus.raison.includes('Je ne peux pas')), refus.raison);

  /* LE CAS QUI COMPTE LE PLUS, et celui qu'on confondait. Une réponse coupée par un plafond de
     jetons n'a pas d'accolade FERMANTE : la regex ne matche pas, et l'ancien code tombait au repli
     exactement comme pour un refus. Or les deux se réparent à des endroits opposés (le plafond
     d'un côté, le prompt ou le fournisseur de l'autre). */
  const tronq = F('{"title":"Le dollar recule","geopolitics":["Le Moyen-Orient', utile);
  v('réponse TRONQUÉE → raison distincte, qui nomme le plafond de jetons',
    !!(tronq.raison && /TRONQU/i.test(tronq.raison) && /jetons/i.test(tronq.raison)), tronq.raison);
  v('… et elle ne se confond pas avec « sans JSON »', !!(tronq.raison && !/sans JSON/i.test(tronq.raison)), tronq.raison);

  const casse = F('{"title":"a", "summary":}', utile);
  v('JSON illisible → raison + longueurs (de quoi reconnaître une coupe)',
    !!(casse.raison && /illisible/i.test(casse.raison) && /caract/i.test(casse.raison)), casse.raison);

  const maigre = F('{"foo":1,"bar":2,"baz":3}', utile);
  v('JSON valide mais inexploitable → raison + clés REÇUES',
    !!(maigre.raison && /inexploitable/i.test(maigre.raison) && /foo/.test(maigre.raison)), maigre.raison);

  // Le prédicat d'exploitabilité du DTP Daily n'est PAS celui du FX Recap : on l'éprouve aussi.
  const sections = p => !!(p && Array.isArray(p.sections) && p.sections.length);
  v('le prédicat du Point Marché est respecté (sections vides = inexploitable)',
    !!F('{"sections":[]}', sections).raison && !!F('{"sections":[{"t":"x"}]}', sections).parsed);

  // Le cadratin est banni du desk : une raison s'affiche dans le panneau admin, elle y est soumise.
  const toutes = [vide, refus, tronq, casse, maigre].map(r => r.raison || '').join(' ');
  v('aucune raison ne porte de tiret cadratin', !/—/.test(toutes), toutes.slice(0, 120));

  /* ── TÉMOIN ── Sans lui, les deux contrôles de la TRONCATURE pourraient être verts en ne
     mesurant rien. On retire du VRAI source la branche qui distingue les deux échecs : le cas
     tronqué doit alors retomber sur « sans JSON », et le contrôle mord. */
  /* Chirurgie PAR LIGNE plutôt que par expression : la ligne visée contient des accolades, des
     apostrophes et un gabarit de chaîne. Une expression qui les échappe toutes serait plus fragile
     que ce qu'elle éprouve, et un témoin qui cesse de mordre en silence est pire que pas de témoin. */
  const mutant = SRC.split('\n').filter(l => !/return \{ raison: .r.{0,8}ponse TRONQU/.test(l)).join('\n');
  v('(témoin) la branche de troncature est bien retirable du source', mutant !== SRC);
  if (mutant !== SRC) {
    const T = monter(mutant);
    const t2 = T('{"title":"Le dollar recule","geopolitics":["Le Moyen-Orient', utile);
    v('(témoin) sans elle, la troncature se confond avec « sans JSON » → le contrôle mord',
      !!(t2.raison && /sans JSON/i.test(t2.raison) && !/TRONQU/i.test(t2.raison)), t2.raison);
  }
}

/* ══ 2. LES DEUX GÉNÉRATEURS SONT BRANCHÉS DESSUS ═════════════════════════════════════════════
   Corriger un jumeau et laisser l'autre muet ne fait que décaler le prochain signalement. */
console.log('\n── Les deux rapports quotidiens, pas seulement celui qui a été signalé ──');
/* `function _aiJsonOuRaison(text,` matche le même motif que ses appels : sans l'exclusion, la
   DÉFINITION comptait pour un appel. Un banc qui compte faux est pire qu'un banc absent. */
const appels = (SRV.match(/(?<!function )_aiJsonOuRaison\(text,/g) || []).length;
v('les TROIS générateurs de rapport passent par le helper', appels === 3, appels + ' appel(s) trouvé(s)');
v('… dont le rapport hebdo, que ce banc a trouvé muet le jour de son écriture', /\[GEW\] REPLI/.test(SRV));
/* Le motif muet d'avant : un JSON.parse local sur le bloc capturé, sans raison. S'il revient,
   c'est qu'un générateur a repris son chemin silencieux. */
v('plus aucun JSON.parse muet sur un bloc capturé', !/const parsed = m \? JSON\.parse\(m\[0\]\) : null;/.test(SRV));
for (const [nom, motif] of [['FX Daily Recap', 'fxr'], ['Point Marché', 'dtpd']]) {
  v(`${nom} : le repli porte sa raison`, new RegExp('\\b' + motif + '\\._raison = _' + motif + 'Raison \\|\\|').test(SRV));
  v(`${nom} : le backoff n'est plus une sortie muette`, new RegExp('_' + motif + "Raison = 'cha\\\\u00eene IA en pause").test(SRV));
  v(`${nom} : le repli s'écrit au journal, avec la taille du prompt`, new RegExp('\\[' + (motif === 'fxr' ? 'FX Recap' : 'DTP Daily') + '\\] REPLI').test(SRV));
}

/* ══ 3. LA CAUSE ATTEINT UN ÉCRAN ═════════════════════════════════════════════════════════════
   ⚠️ UN CHAMP ENREGISTRÉ QUE PERSONNE N'AFFICHE NE VAUT PAS MIEUX QUE LE SILENCE. Le trou d'origine
   n'était pas l'absence de donnée (`_ai:false` voyageait depuis toujours) mais l'absence de
   lecteur. Trois maillons, donc : le calcul, l'endpoint, et les DEUX moitiés du panneau — un id
   dans le HTML sans personne pour l'écrire est une carte vide, et l'inverse est du code mort. */
console.log('\n── De la cause à l\'écran ──');
v('le serveur sait décrire l\'état des deux rapports', /function _etatRapportsQuotidiens\(\)/.test(SRV));
v('… et le moniteur IA le sert', /rapports: _etatRapportsQuotidiens\(\)/.test(SRV));
v('… en nommant le jour couvert par CHAQUE rapport (jamais un jour pour deux)',
  /_fxrTargetDayKey\(\)\)/.test(SRV) && /_dtpdTodayKey\(\)\)/.test(SRV));
v('le panneau admin porte la carte', /id="aim-rapports"/.test(ADMHTML));
v('… et quelqu\'un l\'écrit', /getElementById\('aim-rapports'\)/.test(ADMJS));
v('… avec la raison ET l\'heure ET la taille du prompt', /r\.raison/.test(ADMJS) && /r\.raisonTs/.test(ADMJS) && /r\.promptLen/.test(ADMJS));
v('… et un repli antérieur au 16/09 le dit au lieu de mentir', /repli ant\\u00e9rieur au 16\/09/.test(SRV));

console.log(`\n${ko === 0 ? '✅' : '❌'} repli-verif : ${ok} contrôle(s) vert(s), ${ko} échec(s).`);
process.exit(ko === 0 ? 0 : 1);
