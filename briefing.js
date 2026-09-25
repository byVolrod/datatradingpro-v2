'use strict';
/* ═══ DTP V3 · BRIEFING DU MATIN SOURCÉ (phase 2 de la feuille de route, comptes admin d'abord) ═══════
   « Chaque affirmation dit d'où elle vient. » Le briefing n'est PAS un texte libre de l'IA : le serveur
   assemble d'abord une FICHE DE FAITS à partir des données que le desk affiche déjà (régime de risque,
   force des devises, agenda du jour, pricing des banques centrales, dépêches marquantes), chaque fait
   numéroté (F1, F2…) avec sa source et son heure. L'IA ne fait que RÉDIGER à partir de cette fiche, et
   chaque point qu'elle écrit doit citer ses faits entre crochets.
   Puis le code VÉRIFIE, sans faire confiance au modèle :
     · une citation qui ne renvoie à aucun fait est retirée ; un point sans citation valide est écarté ;
     · tout NOMBRE d'un point doit figurer dans les faits qu'il cite, sinon le point est écarté : un
       chiffre inventé ne peut pas passer, même joliment cité ;
     · une consigne de trading (« achetez », « vendez »…) écarte le point : on décrit, on ne conseille pas.
   Le nombre de points écartés est affiché : la sévérité du contrôle est visible, pas cachée.
   Module PUR (aucun I/O) : le serveur lui passe l'état du desk, le banc l'éprouve sur des cas réels. */

const CCY = ['USD', 'EUR', 'JPY', 'GBP', 'CHF', 'AUD', 'CAD', 'NZD'];
const NOM_BC = { USD: 'Fed', EUR: 'BCE', GBP: 'BoE', JPY: 'BoJ', CAD: 'BoC', AUD: 'RBA', CHF: 'BNS', NZD: 'RBNZ' };
const LIB_RISQUE = { 'STRONG RISK-ON': 'Risk-on marqué', 'RISK-ON': 'Risk-on', 'WEAK RISK-ON': 'Risk-on léger', 'NEUTRAL': 'Neutre',
  'WEAK RISK-OFF': 'Risk-off léger', 'RISK-OFF': 'Risk-off', 'STRONG RISK-OFF': 'Risk-off marqué' };
const SECTIONS = ['Régime de marché', 'Devises à suivre', 'Agenda du jour', 'Banques centrales', 'Points d’attention'];

const _num = x => { const n = typeof x === 'number' ? x : parseFloat(String(x == null ? '' : x).replace(',', '.')); return isFinite(n) ? n : null; };
const _fr = (n, d) => (n < 0 ? '−' : n > 0 ? '+' : '') + Math.abs(n).toFixed(d).replace('.', ',');
const _pct = (n, d) => Math.abs(n).toFixed(d == null ? 2 : d).replace('.', ',').replace(/,00$/, '') + '%';
function heureParis(ts) { try { return new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' }); } catch (e) { return ''; } }
function jourParis(ts) { try { return new Date(ts).toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' }); } catch (e) { return new Date(ts).toISOString().slice(0, 10); } }
const _propre = t => String(t == null ? '' : t).replace(/\s+/g, ' ').replace(/—/g, ':').trim();

/* ── 1. LA FICHE DE FAITS ─────────────────────────────────────────────────────────────────────────
   ctx = { now, risque:{label,score,assets,ts}, force:{series,ts}, calendrier:{items,ts},
           taux:{banks,ts}, titres:[{headline,_titreFr,timestamp,currency,category}] }
   Chaque bloc est facultatif : une source absente ne produit AUCUN fait (jamais un fait vide). */
function ficheDeFaits(ctx) {
  ctx = ctx || {};
  const now = ctx.now || Date.now();
  const faits = [];
  const ajouter = (type, txt, source, at) => { faits.push({ id: 'F' + (faits.length + 1), type, txt: _propre(txt), source, at: at || null }); };

  const r = ctx.risque;
  if (r && r.label) {
    let on = 0, off = 0;
    (r.assets || []).forEach(a => { const s = (_num(a.chg) || 0) * (_num(a.dir) || 0); if (s > 0) on++; else if (s < 0) off++; });
    ajouter('risque', 'Régime de risque : ' + (LIB_RISQUE[r.label] || r.label) + (_num(r.score) != null ? ' (score ' + _num(r.score) + ')' : '')
      + ' · ' + on + ' facteur' + (on > 1 ? 's' : '') + ' risk-on, ' + off + ' risk-off', 'Sentiment de risque (cotations Yahoo Finance)', r.ts);
    const forts = (r.assets || []).map(a => ({ l: a.label, c: _num(a.chg) })).filter(a => a.l && a.c != null)
      .sort((a, b) => Math.abs(b.c) - Math.abs(a.c)).slice(0, 4);
    if (forts.length) ajouter('risque', 'Actifs du régime qui bougent le plus : ' + forts.map(a => a.l + ' ' + _fr(a.c, 2) + '%').join(' · '), 'Sentiment de risque (cotations Yahoo Finance)', r.ts);
  }

  const f = ctx.force;
  if (f && f.series) {
    const fin = CCY.map(c => { const s = f.series[c]; const p = Array.isArray(s) && s.length ? s[s.length - 1] : null; const v = p && _num(p.v != null ? p.v : p.value); return v == null ? null : [c, v]; })
      .filter(Boolean).sort((a, b) => b[1] - a[1]);
    if (fin.length >= 4) {
      ajouter('force', 'Force des devises depuis l’ouverture : ' + fin.map(x => x[0] + ' ' + _fr(x[1], 2)).join(' · '), 'Force des devises (unité TD)', f.ts);
      ajouter('force', 'Devise la plus forte : ' + fin[0][0] + ' (' + _fr(fin[0][1], 2) + ') ; la plus faible : ' + fin[fin.length - 1][0] + ' (' + _fr(fin[fin.length - 1][1], 2) + ')', 'Force des devises (unité TD)', f.ts);
    }
  }

  const cal = ctx.calendrier;
  if (cal && Array.isArray(cal.items)) {
    const jour = jourParis(now);
    const IMP = { High: 0, Medium: 1 };
    const evts = cal.items.filter(e => e && e.timestamp && jourParis(e.timestamp) === jour && IMP[e.impact] != null && CCY.includes(e.currency))
      .sort((a, b) => (IMP[a.impact] - IMP[b.impact]) || (a.timestamp - b.timestamp)).slice(0, 10)
      .sort((a, b) => a.timestamp - b.timestamp);
    evts.forEach(e => {
      const val = e.actual ? 'publié ' + e.actual + (e.forecast ? ' (attendu ' + e.forecast + ')' : '')
        : [e.forecast ? 'attendu ' + e.forecast : '', e.previous ? 'précédent ' + e.previous : ''].filter(Boolean).join(' · ');
      ajouter('agenda', heureParis(e.timestamp) + ' · ' + e.currency + ' · ' + _propre(e.title) + (e.impact === 'High' ? ' (impact fort)' : '') + (val ? ' · ' + val : ''), 'Calendrier économique', cal.ts);
    });
  }

  const t = ctx.taux;
  if (t && Array.isArray(t.banks)) {
    t.banks.filter(b => b && b.code && NOM_BC[b.code] && _num(b.rate) != null).forEach(b => {
      const sc = b.scenario ? 'maintien ' + b.scenario.hold + '% / hausse ' + b.scenario.hike + '% / baisse ' + b.scenario.cut + '%' : '';
      const prov = b.source === 'market' ? (b.provider || 'pricing de marché') : 'estimation DTP (pas de pricing de marché)';
      ajouter('taux', NOM_BC[b.code] + ' : taux ' + _pct(_num(b.rate)) + (b.next ? ' · prochaine réunion ' + b.next + (b.nextDays != null ? ' (dans ' + b.nextDays + ' j)' : '') : '')
        + (sc ? ' · pricing ' + sc : ''), 'Taux des banques · ' + prov, b.srcAt || t.ts);
    });
  }

  (ctx.titres || []).slice(0, 6).forEach(n => {
    const h = _propre(n._titreFr || n.headline);
    if (h.length > 8) ajouter('titre', (n.currency ? '[' + n.currency + '] ' : '') + h.slice(0, 220), 'Fil d’actualité · ' + heureParis(n.timestamp), n.timestamp);
  });
  return faits;
}

/* ── 2. LA CONSIGNE ───────────────────────────────────────────────────────────────────────────── */
function promptBriefing(faits, libelleJour) {
  return `Tu rédiges le « Briefing du matin » de DataTradingPro pour le ${libelleJour}, en FRANÇAIS professionnel.
Tu disposes UNIQUEMENT de la fiche de faits ci-dessous. Chaque fait a un identifiant entre crochets.

RÈGLES ABSOLUES :
- Chaque point se termine par la ou les citations des faits qu'il utilise, au format [F3] ou [F3][F7].
- N'écris AUCUN chiffre qui ne figure pas dans les faits cités par ce point. Aucune donnée extérieure.
- Décris et relie les faits (pourquoi c'est important aujourd'hui, ce qui peut bouger) ; ne donne JAMAIS de consigne de trading (pas d'achat, de vente, de niveau d'entrée).
- Style dense et clair : une idée par point, 1 à 2 phrases, pas de cadratin.

Réponds UNIQUEMENT en JSON valide, sans préambule :
{
  "titre": "<une ligne qui résume la matinée>",
  "synthese": "<2 ou 3 phrases, chacune avec ses citations>",
  "sections": [
    { "titre": "Régime de marché", "points": ["… [F1]"] },
    { "titre": "Devises à suivre", "points": ["…"] },
    { "titre": "Agenda du jour", "points": ["…"] },
    { "titre": "Banques centrales", "points": ["…"] },
    { "titre": "Points d’attention", "points": ["…"] }
  ]
}
2 à 4 points par section ; omets une section si aucun fait ne la nourrit.

FICHE DE FAITS :
${faits.map(f => '[' + f.id + '] ' + f.txt + ' (source : ' + f.source + ')').join('\n')}`;
}

/* ── 3. LA VÉRIFICATION ───────────────────────────────────────────────────────────────────────────
   Rend { titre, synthese, sections:[{titre, points:[{txt, cites}]}], ecartes, motifs } ou null. */
const _RX_CITE = /\[(F\d{1,3})\]/g;
const _RX_CONSIGNE = /\b(achet(?:ez|er)|vend(?:ez|re)\s+(?:le|la|l['’]|du|des)|prenez position|stop[- ]loss|take[- ]profit|objectif de cours|niveau d['’]entrée|entrez (?:à|long|short))\b/i;
// Les nombres sont comparés en VALEUR (« 4% » = « 4,00% », « 0,3 » = « 0,30 ») ; le signe n'est pas lu :
// « recule de 0,21 » cite légitimement « JPY −0,21 ».
const _nombres = s => (String(s).match(/\d+(?:[.,]\d+)?/g) || []).map(x => Math.round(parseFloat(x.replace(',', '.')) * 1e6) / 1e6);
function _pointValide(texte, faitsParId, motifs) {
  const brut = _propre(texte);
  const cites = [];
  let m; _RX_CITE.lastIndex = 0;
  while ((m = _RX_CITE.exec(brut))) if (faitsParId[m[1]] && !cites.includes(m[1])) cites.push(m[1]);
  // Les repères ne s'affichent plus (25/09) : on retire aussi leurs formes libres, « (F3) », « (F3, F7) ».
  const sansCites = brut.replace(/\[F\d{1,3}\]/g, '').replace(/\(\s*F\d{1,3}(?:\s*[,;]\s*F\d{1,3})*\s*\)/g, '').replace(/\s+([.,;:!?])/g, '$1').replace(/\s+/g, ' ').trim();
  if (!sansCites || sansCites.length < 12) { motifs.vide++; return null; }
  if (!cites.length) { motifs.sansSource++; return null; }
  if (_RX_CONSIGNE.test(sansCites)) { motifs.consigne++; return null; }
  const refs = cites.map(id => faitsParId[id].txt).join(' ');
  const dispo = new Set(_nombres(refs));
  const orphelin = _nombres(sansCites).find(n => !dispo.has(n));
  if (orphelin) { motifs.chiffre++; return null; }
  return { txt: sansCites.slice(0, 360), cites };
}
function validerBriefing(brut, faits) {
  let o = brut;
  if (typeof o === 'string') { const mm = o.match(/\{[\s\S]*\}/); if (!mm) return null; try { o = JSON.parse(mm[0]); } catch (e) { return null; } }
  if (!o || typeof o !== 'object') return null;
  const parId = {}; (faits || []).forEach(f => { parId[f.id] = f; });
  const motifs = { sansSource: 0, chiffre: 0, consigne: 0, vide: 0 };
  let total = 0;
  const sections = (Array.isArray(o.sections) ? o.sections : []).slice(0, 6).map(s => {
    const pts = (Array.isArray(s && s.points) ? s.points : []).slice(0, 6).map(p => { total++; return _pointValide(p, parId, motifs); }).filter(Boolean);
    const titre = _propre(s && s.titre).slice(0, 60);
    return { titre: SECTIONS.find(x => x.toLowerCase() === titre.toLowerCase()) || titre, points: pts.slice(0, 4) };
  }).filter(s => s.titre && s.points.length);
  // La synthèse suit la même loi, phrase par phrase : une phrase non sourcée disparaît, pas la synthèse entière.
  const phrases = String(o.synthese || '').split(/(?<=[.!?](?:\s*\[F\d{1,3}\])*)\s+(?=[A-ZÀ-Ý])/).map(x => x.trim()).filter(Boolean);
  const synth = phrases.map(ph => { total++; return _pointValide(ph, parId, motifs); }).filter(Boolean);
  const ecartes = motifs.sansSource + motifs.chiffre + motifs.consigne + motifs.vide;
  const garde = sections.reduce((a, s) => a + s.points.length, 0);
  if (garde < 3) return null;   // trop peu de points vérifiés pour publier : on ne publie pas un briefing creux
  return {
    titre: _propre(o.titre).replace(/\[F\d{1,3}\]/g, '').trim().slice(0, 140) || 'Briefing du matin',
    synthese: synth,
    sections,
    ecartes, motifs, total,
  };
}

module.exports = { ficheDeFaits, promptBriefing, validerBriefing, heureParis, jourParis, SECTIONS };
