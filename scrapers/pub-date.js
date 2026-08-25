/**
 * Date de publication RÉELLE des rapports de banques.
 * ------------------------------------------------------------------------------------------------
 * Le desk affichait, pour les sources qui ne datent pas leurs listes, l'heure à laquelle il avait
 * DÉCOUVERT le lien, présentée comme une date de publication. Ce module va chercher la vraie date
 * à la source, une fois par publication (le résultat est ensuite mémorisé durablement par server.js).
 *
 * Ce qui a été MESURÉ le 17/08/2026 et qu'il ne faut pas refaire :
 *
 *  · `Last-Modified` est un FAUX AMI, sans exception. HSBC renvoie trois heures du jour même pour
 *    trois articles anciens (régénération de cache), Nordea la même seconde pour trois articles
 *    différents (déploiement), Natixis trois valeurs à 23 s d'intervalle, UniCredit deux valeurs
 *    différentes pour LE MÊME fichier à 25 s d'écart (nœuds CDN distincts). Jamais utilisé ici.
 *    (Seule exception ailleurs dans le code : les documents bluematrix de Wells Fargo, qui SONT le
 *    fichier publié ; c'est traité dans server.js, pas ici.)
 *  · `dateModified` du JSON-LD est une retouche CMS, pas une publication : SocGen expose
 *    datePublished=2024-05-31 / dateModified=2026-03-24 sur le même article. On ne lit jamais
 *    `dateModified`.
 *  · Chez SocGen, le JSON-LD lui-même n'est PAS la référence : mesuré sur 18 articles, la date
 *    affichée par le site (`div.sgnews_single_date`) concorde 18/18 avec la liste, le JSON-LD
 *    seulement 10/18. La date du site passe donc en premier, le JSON-LD en dernier recours.
 *  · KBC écrit `datePublished` en **JJ-MM-AAAA**, pas en ISO : `Date.parse("01-07-2026")` rendrait
 *    janvier. Le parseur ci-dessous est explicite, jamais un `new Date(chaîne)` naïf.
 *  · HSBC sépare le jour du mois par une insécable ENCODÉE (`12&nbsp;August 2026`) : il faut décoder
 *    l'entité AVANT de chercher, sinon `\s` ne matche rien.
 */

const MOIS_EN = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
const MOIS_RX = 'January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept|Sep|Oct|Nov|Dec';
/* Les mois FRANÇAIS, pour les notes rédigées en français (Natixis, SocGen, KBC…). Sans eux,
   « 25 août 2026 » imprimé en tête d'un document ne se lit pas, et la publication reste « n.d. ».
   « juillet » AVANT « juin », « mars » AVANT « mai » : l'alternance rend la PREMIÈRE qui répond. */
const MOIS_FR = { jan: 0, fév: 1, fev: 1, mar: 2, avr: 3, mai: 4, jui: 5, jul: 6, aoû: 7, aou: 7, sep: 8, oct: 9, nov: 10, déc: 11, dec: 11 };
const MOIS_FR_RX = 'janvier|février|fevrier|mars|avril|juillet|juin|août|aout|septembre|octobre|novembre|décembre|decembre|mai';
function moisFr(mot) {
  const m = String(mot || '').toLowerCase();
  if (/^juil/.test(m)) return 6;      // juillet, avant « juin » (les trois premières lettres se confondent)
  if (/^juin/.test(m)) return 5;
  if (/^mai$/.test(m)) return 4;
  if (/^mars/.test(m)) return 2;
  const v = MOIS_FR[m.slice(0, 3)];
  return v == null ? null : v;
}
const MIN_TS = Date.UTC(2015, 0, 1);

/** Date de publication plausible : passée, postérieure à 2015, jamais dans le futur. */
function plausible(ts) { return typeof ts === 'number' && !isNaN(ts) && ts > MIN_TS && ts <= Date.now() + 864e5; }

/**
 * Parse une date sans jamais confier une chaîne ambiguë à `new Date()`.
 * Couvre : ISO, JJ-MM-AAAA, JJ/MM/AAAA, JJ.MM.AAAA, JJ/MM/AA, « 6 August 2026 », « August 6, 2026 ».
 */
function parseDate(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  let m;
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) {
    const t = Date.UTC(+m[1], +m[2] - 1, +m[3], 12); return plausible(t) ? t : null;
  }
  if ((m = s.match(/^(\d{1,2})[-./](\d{1,2})[-./](\d{4})\b/))) {          // jour en tête (Europe)
    const t = Date.UTC(+m[3], +m[2] - 1, +m[1], 12); return plausible(t) ? t : null;
  }
  if ((m = s.match(/^(\d{1,2})[-./](\d{1,2})[-./](\d{2})\b/))) {          // Natixis : 17/08/26
    const t = Date.UTC(2000 + +m[3], +m[2] - 1, +m[1], 12); return plausible(t) ? t : null;
  }
  if ((m = s.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{2,4})\b/))) { // « 6 August 2026 »
    const mo = MOIS_EN[m[2].slice(0, 3).toLowerCase()]; if (mo == null) return null;
    const an = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    const t = Date.UTC(an, mo, +m[1], 12); return plausible(t) ? t : null;
  }
  if ((m = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})\b/))) {   // « August 6, 2026 »
    const mo = MOIS_EN[m[1].slice(0, 3).toLowerCase()]; if (mo == null) return null;
    const t = Date.UTC(+m[3], mo, +m[2], 12); return plausible(t) ? t : null;
  }
  return null;
}

/** HTML -> texte, entités d'espace décodées et balises devenues des sauts de ligne. */
function texteDe(html) {
  return String(html || '')
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/&nbsp;|&#160;|&#xa0;/gi, ' ')
    .replace(/<[^>]+>/g, '\n');
}

/** `datePublished` du JSON-LD (parcourt @graph et les tableaux). `dateModified` volontairement ignoré. */
function dateJsonLd(html) {
  for (const bloc of String(html || '').matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let j; try { j = JSON.parse(bloc[1].trim()); } catch { continue; }
    let hit = null;
    (function parcours(o, prof) {
      if (hit || !o || typeof o !== 'object' || prof > 10) return;
      if (Array.isArray(o)) { o.forEach(x => parcours(x, prof + 1)); return; }
      for (const cle of ['datePublished', 'dateCreated']) { const t = parseDate(o[cle]); if (t) { hit = t; return; } }
      for (const k of Object.keys(o)) parcours(o[k], prof + 1);
    })(j, 0);
    if (hit) return hit;
  }
  return null;
}

/** Balises meta de publication, puis clés de date dans un JSON embarqué (Next.js et consorts). */
function dateMeta(html) {
  const H = String(html || '');
  const METAS = ['article:published_time', 'article:published', 'publishdate', 'publish-date', 'pubdate',
    'parsely-pub-date', 'DC.date.issued', 'dcterms.issued', 'sailthru.date', 'datePublished'];
  for (const nom of METAS) {
    const tag = H.match(new RegExp('<meta[^>]+(?:property|name|itemprop)=["\']' + nom.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '["\'][^>]*>', 'i'));
    if (!tag) continue;
    const t = parseDate((tag[0].match(/content=["']([^"']+)["']/i) || [])[1]);
    if (t) return t;
  }
  for (const cle of ['publishDate', 'publishedDate', 'publicationDate', 'firstPublishedAt', 'publishedAt', 'publishTime']) {
    const m = H.match(new RegExp('"' + cle + '"\\s*:\\s*"([^"]{8,40})"', 'i'));
    const t = m && parseDate(m[1]); if (t) return t;
  }
  return null;
}

/**
 * Date « J Mois AAAA » affichée sous le titre, pour les pages SANS aucune métadonnée (HSBC).
 *
 * On n'accepte QUE les nœuds dont le texte entier EST la date (ancrage ^…$). Une page HSBC contient
 * aussi des dates CITÉES en pleine phrase (« effective 24 July 2026 », « Latest data: June 2026 »)
 * et un « This report is dated as at 07 August 2026 » en pied de page, qui précède la mise en ligne
 * de 1 à 3 jours. Prendre la première date rencontrée dans le texte attraperait ces faux amis.
 */
function dateVisible(html, cheerio) {
  // Les deux ordres rencontrés : « 12 August 2026 » (HSBC) et « Jul 29, 2026 » (MUFG).
  const RX = new RegExp('^(?:([0-3]?\\d)\\s+(' + MOIS_RX + ')\\.?\\s+(20\\d\\d)'
                      + '|(' + MOIS_RX + ')\\.?\\s+([0-3]?\\d),?\\s+(20\\d\\d))$');
  const lire = m => (m[1] ? parseDate(m[1] + ' ' + m[2] + ' ' + m[3]) : parseDate(m[4] + ' ' + m[5] + ', ' + m[6]));
  const propre = t => String(t || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
  if (cheerio) {
    let $; try { $ = cheerio.load(html); } catch { $ = null; }
    if ($) {
      $('script,style,noscript').remove();
      // On garde les nœuds dont le texte ENTIER est la date, puis on retient le plus INTÉRIEUR.
      // (Exiger zéro enfant serait trop strict : HSBC écrit « <p>10&nbsp;August 2026<br></p> », et le
      // bloc parent qui ne contient que ce paragraphe passe le même test.)
      let trouve = null, profondeur = Infinity;
      $('p,div,span,time,h2,h3,li').each((_, el) => {
        const m = propre($(el).text()).match(RX);
        if (!m) return;
        const n = $(el).find('*').length;
        if (n >= profondeur) return;
        const t = lire(m);
        if (t) { trouve = t; profondeur = n; }
      });
      if (trouve) return trouve;
    }
  }
  // Repli sans cheerio : une ligne dont le contenu entier est la date.
  for (const ligne of texteDe(html).split('\n')) {
    const m = propre(ligne).match(RX);
    if (m) { const t = lire(m); if (t) return t; }
  }
  return null;
}

/**
 * LA DATE ÉCRITE DANS L'ADRESSE (28/08, capture à l'appui : « ici on a pas de date corrige fixe et
 * vérifie bien pr les futurs rapports d'avoir la date »).
 *
 * C'est la piste la moins chère et la plus sûre : une date placée dans une URL y est mise PAR
 * L'ÉDITEUR, et elle ne bouge plus. Elle ne coûte aucune requête, elle vaut donc d'être tentée avant
 * d'aller chercher la page — et de nouveau en dernier recours quand la page n'a rien dit.
 *
 * ⚠️ ON N'ACCEPTE QU'UNE DATE COMPLÈTE, ou un mois entier explicitement nommé. Un simple « 2026 »
 * traînant dans un slug ne dit pas quel jour, et le 1er janvier serait une date inventée.
 */
function dateURL(url) {
  const u = String(url || '');
  let m;
  // /2026/08/25/ · 2026-08-25 · 2026_08_25
  if ((m = u.match(/(?:^|[^\d])(20\d\d)[-/_.](\d{1,2})[-/_.](\d{1,2})(?![\d])/))) {
    const t = Date.UTC(+m[1], +m[2] - 1, +m[3], 12); if (plausible(t)) return t;
  }
  // 20260825 (huit chiffres collés, très courant dans les noms de PDF)
  if ((m = u.match(/(?:^|[^\d])(20\d\d)(\d{2})(\d{2})(?![\d])/))) {
    const t = Date.UTC(+m[1], +m[2] - 1, +m[3], 12); if (plausible(t) && +m[2] >= 1 && +m[2] <= 12 && +m[3] >= 1 && +m[3] <= 31) return t;
  }
  // 25-august-2026 · 25_aug_2026
  if ((m = u.match(new RegExp('(?:^|[^a-z0-9])([0-3]?\\d)[-_]?(' + MOIS_RX + ')[a-z]*[-_](20\\d\\d)(?![0-9])', 'i')))) {
    const mo = MOIS_EN[m[2].slice(0, 3).toLowerCase()];
    const t = mo == null ? null : Date.UTC(+m[3], mo, +m[1], 12); if (plausible(t)) return t;
  }
  // august-25-2026 · aug-25-2026
  if ((m = u.match(new RegExp('(?:^|[^a-z0-9])(' + MOIS_RX + ')[a-z]*[-_]([0-3]?\\d)[-_](20\\d\\d)(?![0-9])', 'i')))) {
    const mo = MOIS_EN[m[1].slice(0, 3).toLowerCase()];
    const t = mo == null ? null : Date.UTC(+m[3], mo, +m[2], 12); if (plausible(t)) return t;
  }
  // Mensuel nommé : august-2026 → le 1er. Le jour n'existe pas dans la publication elle-même.
  if ((m = u.match(new RegExp('(?:^|[^a-z0-9])(' + MOIS_RX + ')[a-z]*[-_](20\\d\\d)(?![0-9])', 'i')))) {
    const mo = MOIS_EN[m[1].slice(0, 3).toLowerCase()];
    const t = mo == null ? null : Date.UTC(+m[2], mo, 1, 12); if (plausible(t)) return t;
  }
  return null;
}

/* Une ligne dont le contenu ENTIER est une date — anglais ou français, avec ou sans étiquette. */
const _ETIQ = /^(?:published(?:\s+on)?|publication\s+date|date\s+of\s+publication|date|publié\s+le|paru\s+le|le)\s*[:\-–]?\s*/i;
const _LIGNE_DATE = new RegExp('^(?:([0-3]?\\d)(?:er)?\\s+(' + MOIS_FR_RX + ')\\s+(20\\d\\d)'
  + '|([0-3]?\\d)\\s+(' + MOIS_RX + ')\\.?,?\\s+(20\\d\\d)'
  + '|(' + MOIS_RX + ')\\.?\\s+([0-3]?\\d),?\\s+(20\\d\\d)'
  + '|([0-3]?\\d)[-/.]([0-1]?\\d)[-/.](20\\d\\d)'
  + '|(20\\d\\d)-([0-1]\\d)-([0-3]\\d))$', 'i');
function _ligneDate(ligne) {
  const t0 = String(ligne || '').replace(/[\u00a0\u202f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[.,;]$/, '');
  const t = t0.replace(_ETIQ, '').trim();
  if (!t || t.length > 32) return null;
  const m = _LIGNE_DATE.exec(t);
  if (!m) return null;
  if (m[1]) { const mo = moisFr(m[2]); return mo == null ? null : (x => plausible(x) ? x : null)(Date.UTC(+m[3], mo, +m[1], 12)); }
  if (m[4]) return parseDate(m[4] + ' ' + m[5] + ' ' + m[6]);
  if (m[7]) return parseDate(m[7] + ' ' + m[8] + ', ' + m[9]);
  if (m[10]) return parseDate(m[10] + '/' + m[11] + '/' + m[12]);
  if (m[13]) return parseDate(m[13] + '-' + m[14] + '-' + m[15]);
  return null;
}

/**
 * LA DATE IMPRIMÉE EN TÊTE DU DOCUMENT (28/08, même demande).
 *
 * Quand ni la liste, ni les métadonnées, ni la page ne datent une publication, il reste le document
 * lui-même : une note institutionnelle porte presque toujours sa date sous son titre. On la lit sur
 * le TEXTE déjà extrait pour le lecteur — aucune requête de plus.
 *
 * ⚠️ SEULEMENT DANS L'EN-TÊTE, ET SEULEMENT UNE LIGNE ENTIÈRE. Plus loin dans le corps, une date en
 * ligne propre est une date de RÉUNION, de publication de chiffre ou d'échéance (« 18 septembre
 * 2026 » sous un titre « Prochaine réunion »), pas la date du document. On s'arrête donc aux
 * premières lignes, et on n'accepte jamais une date citée à l'intérieur d'une phrase.
 */
const _ENTETE_LIGNES = 25;
function dateEnTete(texte) {
  const lignes = String(texte || '').split('\n').map(l => l.trim()).filter(Boolean).slice(0, _ENTETE_LIGNES);
  for (const l of lignes) { const t = _ligneDate(l); if (t) return t; }
  return null;
}

/**
 * La date visible d'une page INCONNUE, acceptée seulement si elle est SANS AMBIGUÏTÉ.
 *
 * `dateVisible` est réservée aux sources dont on a mesuré la page (HSBC, MUFG). Sur une source
 * quelconque, le même relevé ramasserait aussi les vignettes « publications liées », chacune datée :
 * on ne saurait pas laquelle est celle de l'article. La règle est donc binaire — si tous les nœuds
 * datés de la page portent LA MÊME date, c'est celle de l'article ; s'il y en a plusieurs, on
 * s'abstient. Une date fausse serait pire que pas de date : c'est le défaut qu'on corrige.
 */
function dateVisibleUnique(html, cheerio) {
  const vues = new Set();
  const RX = new RegExp('^(?:([0-3]?\\d)\\s+(' + MOIS_RX + ')\\.?\\s+(20\\d\\d)'
                      + '|(' + MOIS_RX + ')\\.?\\s+([0-3]?\\d),?\\s+(20\\d\\d))$');
  const lire = m => (m[1] ? parseDate(m[1] + ' ' + m[2] + ' ' + m[3]) : parseDate(m[4] + ' ' + m[5] + ', ' + m[6]));
  const propre = t => String(t || '').replace(/[\u00a0\u202f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (cheerio) {
    let $; try { $ = cheerio.load(html); } catch { $ = null; }
    if ($) {
      $('script,style,noscript').remove();
      $('p,div,span,time,h2,h3,h4,li,td').each((_, el) => {
        const m = propre($(el).text()).match(RX);
        if (!m) return;
        const t = lire(m);
        if (t) vues.add(t);
      });
    }
  }
  if (!vues.size) for (const ligne of texteDe(html).split('\n')) {
    const m = propre(ligne).match(RX);
    if (m) { const t = lire(m); if (t) vues.add(t); }
  }
  return vues.size === 1 ? [...vues][0] : null;
}

/** Date affichée par un sélecteur donné (premier nœud non vide qui parse). */
function dateSelecteur(cheerio, html, selecteurs) {
  let $; try { $ = cheerio.load(html); } catch { return null; }
  for (const sel of selecteurs) {
    let trouve = null;
    $(sel).each((_, el) => {
      if (trouve) return;
      const brut = ($(el).attr('datetime') || $(el).text() || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
      const t = parseDate(brut);
      if (t) trouve = t;
    });
    if (trouve) return trouve;
  }
  return null;
}

/* ── Sources à API : un seul appel date TOUTES leurs publications ──────────────────────────────── */

/** Nordea : GET/POST publics, `publishTime` par article. Clé = identifiant numérique de l'URL. */
async function lotNordea(axios, UA) {
  const out = new Map();
  try {
    const r = await axios.post('https://corporate.nordea.com/api/research/item/query', { count: 50 }, {
      timeout: 15000, validateStatus: s => s < 500,
      headers: { 'User-Agent': UA, 'Content-Type': 'application/json', Accept: 'application/json' },
    });
    const arr = Array.isArray(r.data) ? r.data : ((r.data && (r.data.items || r.data.results || r.data.data)) || []);
    for (const x of arr) { const t = parseDate(x && x.publishTime); if (t && x.id != null) out.set(String(x.id), t); }
  } catch {}
  return out;
}
function cleNordea(url) { const m = String(url || '').match(/\/article\/(\d+)/); return m ? m[1] : null; }

/**
 * Repli Nordea par article. La requête en lot est plafonnée à 50 côté serveur (en demander 100 en
 * rend 50) : les publications plus anciennes en sortent. L'endpoint unitaire, lui, répond toujours.
 */
async function dateNordeaUnitaire(axios, UA, id) {
  try {
    const r = await axios.get('https://corporate.nordea.com/api/research/item/' + encodeURIComponent(id), {
      timeout: 12000, validateStatus: s => s < 500,
      headers: { 'User-Agent': UA, Accept: 'application/json' },
    });
    return parseDate(r.data && r.data.publishTime);
  } catch { return null; }
}

/**
 * Natixis : SPA Angular, mais l'API des publications répond en anonyme.
 *
 * L'appariement se fait par TITRE, pas par identifiant : le jeton présent dans l'URL d'article
 * (« /publication/0F_7UDGPxfRtmk3Hx7e0Yw== ») n'est PAS le `tokenId` de l'API. Mesuré : 620 jetons
 * collectés sur six univers, zéro correspondance avec les trois URL du desk. Ce jeton est propre à
 * la session de consultation.
 *
 * Le filtre qui compte est `publicationTypeName: 'MORNING_LINE'` : c'est la série que le desk
 * collecte. Sans lui, l'API rend un tout autre corpus (« Cross-Expertise Research », « Market
 * Insights APAC ») où aucun titre du desk n'apparaît.
 */
async function lotNatixis(axios, UA) {
  const out = new Map();
  for (let page = 1; page <= 4; page++) {
    let r;
    try {
      r = await axios.post('https://www.research.natixis.com/Site/api/Publications',
        { publicationTypeName: 'MORNING_LINE', culture: 'English',
          pagination: { orderBy: 'ByDateHighest', pageNumber: page, pageSize: 100 } },
        { timeout: 15000, validateStatus: s => s < 500,
          headers: { 'User-Agent': UA, 'Content-Type': 'application/json-patch+json', Accept: 'application/json' } });
    } catch { break; }
    const arr = (r.data && (r.data.items || r.data.Items)) || [];
    for (const x of arr) {
      const t = parseDate(x && (x.publishedAt || x.PublishedAt));
      const k = normTitre(x && x.title);
      if (t && k && !out.has(k)) out.set(k, t);
    }
    if (arr.length < 100) break;
  }
  return out;
}

/** Comparaison de titres insensible à la casse, aux apostrophes courbes et à la ponctuation. */
function normTitre(t) {
  return String(t || '').toLowerCase()
    .replace(/[‘’“”]/g, "'")
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

/* ── Résolution unitaire ───────────────────────────────────────────────────────────────────────── */

/**
 * Stratégie par source, dans l'ordre de fiabilité MESURÉ (et non supposé).
 * Chaque entrée reçoit (html, cheerio) et rend un timestamp ou null.
 */
const STRATEGIES = {
  // La date du site fait foi (18/18) ; le JSON-LD ne concorde que 10/18 -> dernier recours.
  socgen: (h, ch) => dateSelecteur(ch, h, ['div.sgnews_single_date', '.sgnews_single_date']) || dateJsonLd(h),
  // JSON-LD en JJ-MM-AAAA ; la date visible de l'article est ancrée sur .blog--detail (les autres
  // <time> de la page sont les vignettes « publications liées »).
  kbc: (h, ch) => dateJsonLd(h) || dateSelecteur(ch, h, ['.blog--detail time', '.blog--detail .date']),
  // Aucune métadonnée : l'unique porteur est le texte visible sous le titre.
  hsbc: (h, ch) => dateVisible(h, ch),
  goldman: h => dateJsonLd(h) || dateMeta(h),
  qcam: h => dateJsonLd(h) || dateMeta(h),
  // Westpac : JSON-LD présent et propre (mesuré : trois articles, trois dates distinctes, cohérentes
  // avec leur contenu). Le desk n en tirait rien parce qu il ne lisait que la carte de la liste.
  westpac: h => dateJsonLd(h) || dateMeta(h),
  // MUFG : aucune métadonnée, mais la date est affichée seule, au format « Jul 29, 2026 ». Elle
  // recoupe le contenu : le calendrier de la semaine du 17 août est daté du 14, celui du 3 au 7 du 31
  // juillet. Le desk la manquait quand l adresse ne portait pas de date, et posait l heure courante.
  mufg: (h, ch) => dateVisible(h, ch),
};

/**
 * Résout la date de publication d'une URL. `lots` porte les réponses d'API déjà obtenues
 * (une par rafraîchissement) pour les sources qui en ont une.
 * Rend un timestamp, ou null si la source ne publie réellement pas de date.
 */
async function resoudreDate(item, deps, lots) {
  const { axios, cheerio, UA } = deps;
  const url = item && item.url;
  const source = item && item._source;
  if (!url) return null;
  lots = lots || {};

  if (source === 'nordea') {
    const c = cleNordea(url);
    if (!c) return null;
    return (lots.nordea && lots.nordea.get(c)) || await dateNordeaUnitaire(axios, UA, c);
  }
  if (source === 'natixis') { const c = normTitre(item.title); return (c && lots.natixis && lots.natixis.get(c)) || null; }

  // UniCredit publie des PDF mensuels : le mois est dans le nom du fichier (DEF_ENG_MO_JUN26).
  if (/\.pdf($|\?)/i.test(url)) {
    const m = String(url).match(/_(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(\d{2})\b/i);
    if (m) {
      const t = Date.UTC(2000 + +m[2], MOIS_EN[m[1].slice(0, 3).toLowerCase()], 1, 12);
      if (plausible(t)) return t;
    }
    return dateURL(url);   // on ne télécharge pas un PDF entier pour une date : reste l'adresse
  }

  /* L'ADRESSE D'ABORD, PARCE QU'ELLE NE COÛTE RIEN (28/08). Une date écrite dans une URL y est mise
     par l'éditeur : elle est aussi fiable qu'une métadonnée, et elle évite la requête. Seule réserve,
     et elle est réelle : un slug ment parfois (mesuré à 3 % chez MUFG, où la carte de la liste fait
     foi). On ne l'interroge donc en tête QUE pour les sources dont la page a déjà été mesurée SANS
     stratégie propre — les autres gardent leur chaîne, et l'adresse leur sert de dernier recours. */
  if (!STRATEGIES[source]) { const tu = dateURL(url); if (tu) return tu; }

  let html;
  try {
    const r = await axios.get(url, {
      timeout: 15000, validateStatus: s => s < 500, responseType: 'text', maxContentLength: 6e6,
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' },
    });
    if (r.status !== 200) return null;
    html = String(r.data);
  } catch { return null; }

  const strat = STRATEGIES[source];
  const t = strat ? strat(html, cheerio) : null;
  /* Chaîne générique pour toute source non listée : métadonnées d'abord.
     `dateVisible` n'est PAS ici volontairement : lire la première date du corps marche pour HSBC,
     dont la page n'en contient qu'une, mais sur une source inconnue elle attraperait aussi bien une
     date CITÉE dans le texte (« depuis le 15 mars 2026… »). Une date fausse serait pire que pas de
     date : c'est exactement le défaut qu'on est en train de corriger.
     `dateVisibleUnique`, elle, tranche ce cas : elle n'accepte que si TOUTE la page s'accorde sur une
     seule date. Plusieurs dates (les vignettes « publications liées ») → elle s'abstient.
     Et l'adresse ferme la marche : elle vaut mieux qu'un « n.d. » définitif. */
  return t || dateJsonLd(html) || dateMeta(html) || dateVisibleUnique(html, cheerio) || dateURL(url);
}

/** Les lots d'API à récupérer une seule fois par rafraîchissement, si des items les concernent. */
async function prechargerLots(sources, deps) {
  const { axios, UA } = deps;
  const lots = {};
  if (sources.has('nordea')) lots.nordea = await lotNordea(axios, UA);
  if (sources.has('natixis')) lots.natixis = await lotNatixis(axios, UA);
  return lots;
}

module.exports = {
  parseDate, plausible, texteDe, dateJsonLd, dateMeta, dateVisible, dateVisibleUnique, dateSelecteur,
  dateURL, dateEnTete, moisFr,
  resoudreDate, prechargerLots, lotNordea, lotNatixis, cleNordea, normTitre, dateNordeaUnitaire,
};
