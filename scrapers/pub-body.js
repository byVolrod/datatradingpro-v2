/**
 * Corps d'article des rapports de banques, pour les sources dont la page ne le livre PAS.
 * ------------------------------------------------------------------------------------------------
 * Symptôme côté client : « Éclairages IA indisponibles pour ce rapport (contenu non extractible pour
 * le moment) ». Le panneau ne peut rien produire quand l'extraction rend moins de 80 caractères.
 *
 * Mesuré le 17/08/2026 :
 *
 *  · NORDEA. La page d'article est une coquille Angular : 0 caractère de texte en HTTP simple, quel
 *    que soit le sélecteur. Mais l'API que le desk interroge DÉJÀ pour la date expose aussi le corps :
 *    GET /api/research/item/{id} renvoie `body` (7 543 caractères sur « Riksbank Preview »). Aucune
 *    requête supplémentaire n'est nécessaire par rapport à ce qui existe.
 *
 *  · GOLDMAN SACHS. La page rend 23 à 30 paragraphes, mais les premiers sont le PIED DE PAGE du site
 *    (« We harness every resource… », « Goldman Sachs' weekly newsletter… ») : une extraction par
 *    conteneur en tire 139 caractères de boilerplate, et une extraction « tous les <p> » produirait
 *    des éclairages sur la plaquette institutionnelle plutôt que sur le rapport. Le vrai corps est
 *    dans le bloc __NEXT_DATA__ (6 513 et 10 861 caractères sur les deux articles testés), propre et
 *    propre à l'article.
 */

/** Le plus long texte de prose trouvé dans un bloc JSON embarqué (Next.js). */
function _plusLongTexte(json, minLong) {
  let best = '';
  (function parcours(o, prof) {
    if (!o || typeof o !== 'object' || prof > 14) return;
    if (Array.isArray(o)) { o.forEach(x => parcours(x, prof + 1)); return; }
    for (const v of Object.values(o)) {
      // Un corps d'article, pas un libellé : plusieurs phrases, donc au moins une ponctuation suivie
      // d'une espace, et une longueur qui exclut les titres et les fils d'Ariane.
      if (typeof v === 'string') { if (v.length > best.length && v.length >= minLong && /[.!?]\s/.test(v)) best = v; }
      else parcours(v, prof + 1);
    }
  })(json, 0);
  return best;
}

/** Goldman : corps de l'article lu dans __NEXT_DATA__. Rend du HTML simple, ou ''. */
function corpsGoldman(html) {
  const m = String(html || '').match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return '';
  let j; try { j = JSON.parse(m[1]); } catch { return ''; }
  const brut = _plusLongTexte(j, 400);
  if (!brut) return '';
  return enParagraphes(brut);
}

/** Nordea : corps de l'article via l'API déjà utilisée pour la date. Rend du HTML simple, ou ''. */
async function corpsNordea(axios, UA, url) {
  const m = String(url || '').match(/\/article\/(\d+)/);
  if (!m) return '';
  try {
    const r = await axios.get('https://corporate.nordea.com/api/research/item/' + m[1], {
      timeout: 12000, validateStatus: s => s < 500,
      headers: { 'User-Agent': UA, Accept: 'application/json' },
    });
    const d = r.data || {};
    const brut = [d.body, d.content, d.text, d.summary].find(x => typeof x === 'string' && x.length > 200) || '';
    return brut ? enParagraphes(brut) : '';
  } catch { return ''; }
}

/** Texte brut ou HTML partiel -> paragraphes HTML échappés, sans balise résiduelle. */
function enParagraphes(brut) {
  const txt = String(brut)
    // Le champ de Goldman arrive DOUBLEMENT échappé : il contient les deux caractères « \ » et « n »
    // au lieu d'un saut de ligne, et il est entouré de guillemets. Sans ce nettoyage, les éclairages
    // seraient produits sur un texte parsemé de « \r\n ».
    .replace(/^\s*"|"\s*$/g, '')
    .replace(/\\r\\n|\\n|\\r/g, '\n')
    .replace(/\\t/g, ' ')
    .replace(/\\"/g, '"')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (txt.length < 80) return '';
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return txt.split(/\n{2,}/).map(p => p.trim()).filter(p => p.length > 1)
    .map(p => '<p>' + esc(p) + '</p>').join('');
}

/**
 * Point d'entrée : rend le corps d'un rapport pour les sources traitées ici, ou '' sinon.
 * `html` peut être vide (Nordea n'en a pas besoin).
 */
async function corpsDeRapport(url, html, deps) {
  const u = String(url || '');
  let hote = '';
  try { hote = new URL(u).hostname.toLowerCase(); } catch { return ''; }
  if (/(^|\.)nordea\.com$/.test(hote)) return await corpsNordea(deps.axios, deps.UA, u);
  if (/(^|\.)goldmansachs\.com$/.test(hote)) return corpsGoldman(html);
  return '';
}

module.exports = { corpsDeRapport, corpsGoldman, corpsNordea, enParagraphes };
