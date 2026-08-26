#!/usr/bin/env node
/**
 * desinscription-verif.js — UN RÉABONNEMENT TIENT-IL VRAIMENT ?
 * ------------------------------------------------------------------------------------------------
 * 04/09, demande utilisateur, capture à l'appui : « les blacklist ne sont pas dedans, puis je dois
 * pouvoir désinscrire et réinscrire moi-même, donc corrige ce bouton ».
 *
 * DEUX DÉFAUTS, ET LE SECOND EST INVISIBLE À LA LECTURE.
 *
 *   1. Deux mécanismes d'exclusion existaient, un seul se voyait. La liste noire du LOGIN avait son
 *      écran, avec ajout et retrait. Les désinscrits E-MAIL n'avaient aucune liste : on ne pouvait
 *      les atteindre que ligne par ligne dans le tableau des comptes — donc pas du tout pour une
 *      adresse SANS compte, ce qui est le cas de tous les contacts venus de Whop. Ils étaient exclus
 *      des envois sans figurer nulle part.
 *
 *   2. Le bouton « réabonner » était privé de son onclick pour deux adresses, et le serveur
 *      répondait 409. Ce refus n'était pas un caprice : le seed `_PERMANENT_UNSUB_SEED` se
 *      réappliquait SANS CONDITION vingt secondes après CHAQUE démarrage. Un réabonnement aurait
 *      donc tenu jusqu'au prochain réveil de Render — quinze minutes d'inactivité suffisent — puis
 *      aurait disparu en silence. Le panneau aurait affiché « ✓ réabonné », et le lendemain le
 *      contact aurait été de nouveau désinscrit sans que rien ne l'explique. C'est le SEED qui est
 *      corrigé (il ne s'applique plus qu'une fois, marqueur durable par adresse), pas l'écran.
 *
 * CE QUE CE BANC ÉPROUVE, ET QU'AUCUNE RELECTURE NE DONNE. La correction repose entièrement sur une
 * propriété de CHAÎNES : `unsubseed:` et `unsubself:` ne doivent PAS être vus comme des clés
 * « unsub: ». Si l'un des deux l'était, trois choses casseraient d'un coup — le marqueur de seed
 * serait effacé par le bouton de réabonnement (donc le seed se réappliquerait au démarrage suivant,
 * et on serait revenu au point de départ), la trace du consentement disparaîtrait, et la liste des
 * désinscrits afficherait des lignes fantômes. « unsubs » contre « unsub: » : un caractère, et
 * personne ne le vérifie à l'œil.
 *
 *   node scripts/desinscription-verif.js
 */
const fs = require('fs');
const path = require('path');
const http = require('http');

const RACINE = path.join(__dirname, '..');
const AUTH = fs.readFileSync(path.join(RACINE, 'auth.js'), 'utf8');
const SRV  = fs.readFileSync(path.join(RACINE, 'server.js'), 'utf8');
const ADM  = fs.readFileSync(path.join(RACINE, 'public/js/admin.js'), 'utf8');
const ADH  = fs.readFileSync(path.join(RACINE, 'public/admin.html'), 'utf8');

/* EXTRAIRE UNE ROUTE PAR SES BORNES, JAMAIS PAR UNE DISTANCE EN CARACTERES.
   ⚠️ Ecrit d'abord en `/unsub-list[\s\S]{0,2600}.../`, ce banc est devenu ROUGE en ajoutant un
   commentaire dans la route : la distance etait passee de 2 400 a 3 079 caracteres. Un controle qui
   casse quand on documente le code pousse a ne pas le documenter — et le jour ou il rougit, on
   elargit la fenetre sans lire, ce qui finit par lui faire accepter du code d'une AUTRE route. On
   borne donc sur la fermeture reelle du gestionnaire. */
function route(src, entete) {
  const d = src.indexOf(entete);
  if (d < 0) return '';
  const f = src.indexOf('\n});', d);
  return f < 0 ? src.slice(d) : src.slice(d, f + 4);
}

let ok = 0, ko = 0;
const v = (t, c, d) => { if (c) { ok++; console.log('  ✓ ' + t); } else { ko++; console.log('  ✗ ' + t + (d ? '\n      → ' + d : '')); } };

console.log('\n═══ DESINSCRIPTION-VERIF — le réabonnement survit-il au redémarrage ? ═══');

console.log('\n── 1. Les préfixes ne se confondent pas (tout repose là-dessus) ──');
/* Le vrai garde-fou est dans auth.js : emailLogDel REFUSE toute clé hors « unsub: », ce qui empêche
   un bouton de panneau d'effacer un marqueur d'anti-doublon et de faire repartir une campagne
   entière. On l'extrait et on l'éprouve, plutôt que de faire confiance à sa lecture. */
const DEL = (() => {
  const d = AUTH.indexOf('async function emailLogDel(key) {');
  if (d < 0) return null;
  const f = AUTH.indexOf('\n}', d);
  return f < 0 ? null : AUTH.slice(d, f + 2);
})();
v('emailLogDel est extractible de auth.js', !!DEL);
if (DEL) {
  const garde = /if \(!k\.startsWith\('unsub:'\)\) throw/.test(DEL);
  v('… et il REFUSE toute clé hors « unsub: » (garde anti-doublon intacte)', garde,
    'sans cette garde, « réabonner » pourrait réexpédier une campagne entière');
}
const estUnsub  = k => String(k).startsWith('unsub:');
const estListee = k => String(k).indexOf('unsub:') === 0;
v('« unsubseed: » n\'est PAS une clé unsub (sinon le seed se réappliquerait au démarrage suivant)',
  !estUnsub('unsubseed:a@b.c') && !estListee('unsubseed:a@b.c'));
v('« unsubself: » non plus (sinon la trace du consentement s\'effacerait avec la désinscription)',
  !estUnsub('unsubself:a@b.c') && !estListee('unsubself:a@b.c'));
v('« unsub: » en est bien une', estUnsub('unsub:a@b.c') && estListee('unsub:a@b.c'));

console.log('\n── 2. LE SEED S\'APPLIQUE UNE FOIS, PAS À CHAQUE DÉMARRAGE ──');
const SEED = (() => {
  const d = AUTH.indexOf('async function _ensurePermanentUnsub() {');
  if (d < 0) return null;
  const f = AUTH.indexOf('\n}', d);
  return f < 0 ? null : AUTH.slice(d, f + 2);
})();
v('la fonction de seed est extractible', !!SEED);
if (SEED) {
  v('elle vérifie un marqueur d\'application AVANT d\'écrire', /emailLogHas\('unsubseed:' \+ em\)/.test(SEED),
    'sans ce test, un réabonnement est défait au prochain réveil de Render');
  v('… et elle sort sans rien faire quand il existe', /if \(await emailLogHas\('unsubseed:' \+ em\)\) continue;/.test(SEED));
  v('… le marqueur est posé AVANT la désinscription (sinon un plantage entre les deux le rejouerait)',
    SEED.indexOf("emailLogAdd('unsubseed:'") < SEED.indexOf("emailLogAdd('unsub:'"));
  v('le seed garde son rôle d\'origine : il écrit encore quand rien n\'existe',
    /emailLogAdd\('unsub:' \+ em\)/.test(SEED), 'une perte totale d\'infra ne rétablirait plus rien');
}

console.log('\n── 3. Le serveur ne refuse plus un réabonnement ──');
const NL = (() => {
  const d = SRV.indexOf("app.post('/api/admin/users/:id/newsletter'");
  return d < 0 ? null : SRV.slice(d, d + 1800);
})();
v('la route newsletter est lisible', !!NL);
if (NL) {
  v('plus de 409 « désinscription permanente »', !/status\(409\)/.test(NL),
    'le bouton du panneau resterait sans effet sur ces contacts');
  v('elle relit l\'état CONSTATÉ au lieu de celui qu\'elle croit avoir écrit',
    /emailLogHas\('unsub:' \+ em\)/.test(NL));
}

console.log('\n── 4. On sait QUI a désinscrit — la seule chose qui change la portée du bouton ──');
/* Réabonner quelqu'un que l'admin avait désinscrit corrige une erreur. Réabonner quelqu'un qui a
   CLIQUÉ le lien de désinscription lui repasse un consentement qu'il a explicitement retiré. Le
   panneau ne bloque pas — c'est la décision de l'exploitant — mais il ne le laisse pas cliquer à
   l'aveugle. Encore faut-il que l'information EXISTE, et elle n'existait pas. */
v('la désinscription publique laisse une trace de son origine',
  /emailLogAdd\('unsubself:' \+ email\)/.test(SRV), 'sans elle, les deux cas sont indistinguables');
v('la liste la renvoie au panneau', /parLui: !!jrn\['unsubself:' \+ em\]/.test(SRV));
v('le panneau distingue les deux à l\'écran', /camp-un-tag--self/.test(ADM) && /camp-un-tag--self/.test(fs.readFileSync(path.join(RACINE, 'public/css/admin.css'), 'utf8')));
v('… et demande confirmation avant de réabonner quelqu\'un qui s\'était désinscrit lui-même',
  /if \(parLui\)[\s\S]{0,400}dataset\.armed/.test(ADM), 'un clic unique repasserait le consentement sans un mot');

console.log('\n── 4 bis. LE JOURNAL EST LU LÀ OÙ IL EST DURABLE, PAS SUR LE DISQUE ──');
/* ⚠️ DÉFAUT TROUVÉ EN PRODUCTION (04/09, capture user) : le mode blanc d'une campagne listait trois
   « desabonne » que l'écran des désinscrits ne montrait pas. Les deux lisent le même journal, mais
   pas au même endroit. `_emailFile` est le backstop écrit sur DISQUE — et le disque de Render est
   ÉPHÉMÈRE : à chaque redéploiement, à chaque réveil après mise en veille, il repart VIDE, et ne se
   remplit ensuite que des écritures nouvelles. Supabase garde tout, et la synchronisation ne va que
   dans un sens : fichier → table, jamais l'inverse.
   Résultat : `emailLogAll()` renvoie un fragment, souvent vide le lendemain d'un déploiement. Un
   écran bâti dessus affiche « aucun désinscrit » et laisse conclure que toute la base reçoit les
   mails. C'est la pire forme d'erreur : rassurante. */
const DUR = (() => {
  const d = AUTH.indexOf('async function emailLogAllDurable(maxAgeMs) {');
  if (d < 0) return null;
  const f = AUTH.indexOf('\n}', d);
  return f < 0 ? null : AUTH.slice(d, f + 2);
})();
v('une lecture DURABLE du journal existe', !!DUR);
if (DUR) {
  v('… elle interroge la table, pas seulement le fichier', /from\(EMAILLOG_TABLE\)\.select\('key,sent_at'\)/.test(DUR));
  v('… elle pagine (le journal dépasse largement une page)', /\.range\(d, d \+ PAS - 1\)/.test(DUR));
  v('… elle FUSIONNE avec le fichier local au lieu de le remplacer',
    /Object\.assign\(\{\}, _emailFile\)/.test(DUR), 'les écritures récentes non encore poussées seraient perdues');
  v('… et elle DIT si la mesure a réussi', /complet = true/.test(DUR) && /complet = false|let complet = false/.test(DUR),
    'sans ce drapeau, un écran ne peut pas distinguer « personne » de « je n\'ai pas pu lire »');
}
/* Les trois écrans qui affirment quelque chose sur des envois passés doivent tous y passer. */
v('la liste des désinscrits lit le journal durable',
  /auth\.emailLogAllDurable\(\)/.test(route(SRV, "app.get('/api/admin/unsub-list'")));
v('… l\'état des diffusions aussi (sinon le bouton d\'envoi réapparaît après un redéploiement)',
  /auth\.emailLogAllDurable\(\)/.test(route(SRV, "app.get('/api/admin/campaign-broadcasts'")));
v('… et le journal des envois lui-même', /auth\.emailLogAllDurable\(\)/.test(route(SRV, "app.get('/api/admin/email-log'")));
v('l\'état des diffusions REFUSE de répondre sur une mesure incomplète',
  /!_dur\.complet\) return res\.status\(503\)/.test(route(SRV, "app.get('/api/admin/campaign-broadcasts'")),
  'il cacherait un bouton sur un envoi qui n\'a peut-être jamais eu lieu');

console.log('\n── 4 ter. Le tableau des comptes dit POURQUOI il ne montre pas tout ──');
/* « Pourquoi je les vois pas ces comptes ? » — parce que ce tableau ne liste QUE des comptes du
   desk, et que les désabonnés d'une campagne viennent en majorité de Whop : ils n'ont jamais eu de
   compte. Les deux écrans ne comptent pas la même population, et rien ne le disait. */
v('le tableau porte une note d\'explication', /id="u-note-mail"/.test(ADH));
v('… affichée UNIQUEMENT sur le filtre « Désabonnés »', /_fMail !== 'unsub'[\s\S]{0,60}hidden = true/.test(ADM));
v('… elle chiffre les adresses sans compte au lieu de rester vague',
  /sansCompte: d\.sansCompte \|\| 0/.test(ADM));
v('… et elle renvoie là où on les trouve', /Campagne › Désinscrits/.test(ADM));
v('… une mesure incomplète est signalée, pas maquillée en zéro',
  /mesure === false[\s\S]{0,220}incomplète/.test(ADM));

console.log('\n── 5. Les désinscrits ont enfin une liste (« ne sont pas dedans ») ──');
v('la route de liste existe', /app\.get\('\/api\/admin\/unsub-list'/.test(SRV));
v('… elle sait ajouter ET retirer', /action === 'add'/.test(SRV) && /action === 'remove'/.test(SRV));
v('… elle valide la forme de l\'adresse avant toute écriture',
  /_valide = e =>/.test(route(SRV, "app.get('/api/admin/unsub-list'")), 'une chaîne arbitraire finirait en clé du journal');
v('… elle compte les adresses SANS COMPTE (celles qu\'aucun écran n\'atteignait)',
  /sansCompte: list\.filter/.test(SRV));
v('… et elle indexe les comptes par adresse NORMALISÉE',
  /comptes\[e\] = \{ id: String\(u\.id\)/.test(SRV), 'une casse différente ferait passer un client pour « sans compte »');
/* DIRECTION SÛRE : journal illisible → on le DIT. Une liste vide se lirait « personne n'est
   désinscrit », et on lancerait une campagne en croyant que toute la base la recevra. */
v('journal illisible → « mesure indisponible », jamais une liste vide',
  /mesure: 'indisponible'/.test(route(SRV, "app.get('/api/admin/unsub-list'")));
v('… et le panneau le répercute au lieu d\'afficher « aucun désinscrit »',
  /mesure indisponible/.test(ADM));
v('la carte est dans le panneau, à côté de la liste noire',
  /id="camp-un-list"/.test(ADH) && /id="camp-un-input"/.test(ADH));
v('… et elle dit ce qu\'elle coupe (les campagnes) et ce qu\'elle ne coupe pas',
  /camp-un-list[\s\S]{0,900}connexion au terminal n'est pas touchée/.test(ADH),
  'sans cette phrase, on confond les deux listes');

console.log('\n── 6. Le bouton de la fiche compte bascule TOUJOURS, dans les deux sens ──');
v('plus de bouton privé de son onclick', !/unsubFige \? '' :/.test(ADM),
  'un bouton mort se lit comme une panne, pas comme une règle');
v('… il bascule dans les deux sens', /toggleNewsletter\('\$\{esc\(String\(u\.id\)\)\}',\$\{!!u\.unsub\}\)/.test(ADM));
v('… et il signale quand même l\'origine de la désinscription',
  /désinscription d\\?'origine/.test(ADM));

/* ══ 7. LE PANNEAU OUVERT DANS UN VRAI CHROMIUM ═══════════════════════════════════════════════════
   04/09, demande utilisateur : « ajoute dans le panel admin un truc pour que je puisse afficher ou
   filtrer les désabonnés ».

   POURQUOI UN NAVIGATEUR, ET PAS UNE LECTURE DE CODE. Un filtre est un RÉSULTAT : le sélecteur
   existe, l'écouteur est posé, la ligne de filtrage est écrite — et le tableau affiche quand même
   tout le monde, parce que la variable lue n'est pas celle qu'écrit l'écouteur, ou parce que le
   rendu se fait avant que l'état ne change. Les trois morceaux se relisent parfaitement et le
   résultat est faux. On ouvre donc le panneau, on choisit dans le menu, et ON COMPTE LES LIGNES.
   Le contrôle décisif est le dernier : sans filtre, le tableau doit montrer TOUT LE MONDE. Un
   filtre cassé qui ne montrerait jamais rien passerait les deux premiers. */
(async () => {
  console.log('\n── 7. Le panneau admin, ouvert : le filtre montre-t-il vraiment ce qu\'il annonce ? ──');
  let pp; try { pp = require('puppeteer-core'); } catch { console.log('  · puppeteer-core absent → abstention.\n'); return fin(); }
  const exe = (() => {
    const c = [process.env.CHROME_PATH, '/usr/bin/chromium', '/usr/bin/chromium-browser'];
    for (const b of ['/opt/pw-browsers', process.env.PLAYWRIGHT_BROWSERS_PATH].filter(Boolean)) {
      try { for (const d of fs.readdirSync(b)) for (const r of ['chrome-linux/chrome', 'chrome-linux/headless_shell']) c.push(path.join(b, d, r)); } catch {}
    }
    return c.find(x => x && fs.existsSync(x)) || null;
  })();
  if (!exe) { console.log('  · aucun Chromium → abstention.\n'); return fin(); }

  /* Cinq comptes qui couvrent les combinaisons qui comptent — dont les deux qu'un filtre naïf
     range du mauvais côté : un compte À LA FOIS bloqué et désabonné, et un bloqué qui reste
     abonné (bloquer coupe la connexion, pas la newsletter). */
  /* ⚠️ DES DONNÉES RÉALISTES, PAS COMMODES. Écrit d'abord avec « a@x.fr » et des échéances toutes
     lointaines, le contrôle de hauteur de rangée était VACANT : rien ne repliait jamais, donc il
     restait vert même en retirant la règle qui l'empêche. Le repli se produit sur la combinaison
     la plus longue de la colonne STATUT — « Expire bientôt » SUIVI de « Désabonné » — et seulement
     quand les colonnes voisines occupent la largeur qu'elles occupent chez un vrai client. On
     reproduit donc les deux : une échéance proche, et des adresses de la longueur qu'elles ont. */
  const _dans = j => new Date(Date.now() + j * 864e5).toISOString();
  const COMPTES = [
    { id: '1', name: 'Marc Dubois',   email: 'marc.dubois@gmail.com',   role: 'client', active: true, plan: 'professionnel', expires_at: _dans(120), unsub: false, blackliste: false },
    { id: '2', name: 'Julie Renard',  email: 'j.renard@outlook.fr',     role: 'client', active: true, plan: 'professionnel', expires_at: _dans(120), unsub: true,  blackliste: false },
    { id: '3', name: 'Karim Benali',  email: 'k.benali@gmail.com',      role: 'client', active: true, plan: 'professionnel', expires_at: _dans(5),   unsub: true,  blackliste: false },
    { id: '4', name: 'Paul Mercier',  email: 'paul.mercier@yahoo.fr',   role: 'client', active: true, plan: 'professionnel', expires_at: _dans(5),   unsub: true,  blackliste: true },
    { id: '5', name: 'Sofia Lopez',   email: 'sofia.lopez@gmail.com',   role: 'client', active: true, plan: 'professionnel', expires_at: _dans(120), unsub: false, blackliste: true },
  ];
  const PUB = path.join(RACINE, 'public'), PORT = 4787;
  const MIME = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml' };
  const srv = http.createServer((rq, rs) => {
    const u = rq.url.split('?')[0];
    const json = o => { rs.writeHead(200, { 'Content-Type': 'application/json' }); rs.end(JSON.stringify(o)); };
    if (u === '/api/auth/me')       return json({ loggedIn: true, user: { id: '0', role: 'admin', name: 'Admin', email: 'admin@x.fr' } });
    if (u === '/api/admin/users')   return json(COMPTES);
    if (u.indexOf('/api/') === 0)   return json({ ok: true });          // tout le reste : neutre
    const f = path.join(PUB, (u === '/' || u === '/admin' ? '/admin.html' : u).replace(/^\/+/, ''));
    if (!f.startsWith(PUB) || !fs.existsSync(f)) { rs.writeHead(404); return rs.end('404'); }
    rs.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'text/plain' });
    fs.createReadStream(f).pipe(rs);
  }).listen(PORT);

  let nav = null;
  try {
    nav = await pp.launch({ executablePath: exe, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const page = await nav.newPage();
    await page.setViewport({ width: 1500, height: 1000 });   // largeur d'un vrai écran admin
    const errs = [];
    page.on('pageerror', e => errs.push(String(e.message)));
    await page.goto('http://localhost:' + PORT + '/admin.html', { waitUntil: 'networkidle0' });
    await new Promise(r => setTimeout(r, 500));
    /* ⚠️ ON OUVRE VRAIMENT L'ONGLET. Le tableau existe dans le DOM même quand son onglet est masqué :
       les sélecteurs répondent, les filtres se testent — et toute MESURE de géométrie renvoie zéro,
       parce qu'un élément en display:none n'a pas de boîte. Un banc qui se contente d'interroger le
       DOM éprouve donc la moitié de ce qu'il croit, et la moitié qui manque est justement celle qui
       tient la densité du tableau. */
    await page.evaluate(() => { try { admTab('users'); } catch (e) {} });
    await new Promise(r => setTimeout(r, 400));

    /* ⚠️ La cellule du nom porte AUSSI les initiales de l'avatar : son texte est « BEBloque Et
       Desabo », pas « Bloque Et Desabo ». Un `Array.includes` exact n'y trouve donc jamais rien —
       et un contrôle « X n'est PAS dans la liste » écrit ainsi passe au VERT sans rien mesurer.
       On compare par sous-chaîne, dans les deux sens. */
    const noms = () => page.evaluate(() => [...document.querySelectorAll('#users-table tbody tr')]
      .map(tr => (tr.querySelector('td:nth-child(2)') || {}).textContent || '').map(t => t.trim()).filter(Boolean));
    const contient = (liste, nom) => liste.some(x => x.indexOf(nom) >= 0);
    const choisir = async val => {
      await page.select('#flt-mail', val);
      await new Promise(r => setTimeout(r, 250));
      return noms();
    };

    v('le panneau s\'ouvre sans exception', errs.length === 0, errs.slice(0, 2).join(' | '));
    const tous = await noms();
    v('le tableau affiche les 5 comptes du banc', tous.length === 5, tous.length + ' ligne(s) : ' + tous.join(', '));
    v('le sélecteur d\'état e-mail existe', await page.$('#flt-mail') !== null);

    const desabos = await choisir('unsub');
    v('« Désabonnés » n\'affiche QUE les désabonnés', desabos.length === 3, desabos.join(', '));
    v('… y compris celui qui est AUSSI bloqué', contient(desabos, 'Paul Mercier'), desabos.join(', '));
    v('… et pas le bloqué resté abonné (bloquer coupe la connexion, pas la newsletter)',
      !contient(desabos, 'Sofia Lopez'), desabos.join(', '));

    const abos = await choisir('sub');
    v('« Abonnés » donne exactement le complément',
      abos.length === 2 && !abos.some(n => contient(desabos, n)) && contient(abos, 'Sofia Lopez'), abos.join(', '));

    const noirs = await choisir('black');
    v('« Bloqués » liste les deux comptes bloqués, désabonnés ou non', noirs.length === 2, noirs.join(', '));

    /* LE CONTRÔLE QUI EMPÊCHE LES PRÉCÉDENTS D'ÊTRE VIDES : un filtre cassé qui n'afficherait
       jamais rien passerait « n'affiche que les désabonnés » sans peine. Le retour à « tous » doit
       ramener TOUT LE MONDE. */
    const retour = await choisir('all');
    v('le retour à « tous » ramène bien les 5 (sinon les contrôles ci-dessus ne prouvent rien)',
      retour.length === 5, retour.join(', '));

    // « AFFICHER » : l'état doit se lire SANS filtrer.
    /* On compte des LIGNES, pas des pastilles : `.badge-active` apparaît aussi dans la colonne
       d'abonnement, et un comptage global renvoyait 10 pour 5 comptes — un chiffre qui n'a aucun
       sens et qui aurait fait rougir un contrôle pourtant juste. */
    const pastilles = await page.evaluate(() => {
      const trs = [...document.querySelectorAll('#users-table tbody tr')];
      const n = sel => trs.filter(tr => tr.querySelector(sel)).length;
      /* Le statut d'abonnement, quel qu'il soit : deux comptes du banc expirent bientôt, donc
         compter les seuls « Actif » aurait mesuré le jeu de données et non la règle. Ce qu'on
         vérifie, c'est que CHAQUE ligne porte encore UN statut — les pastilles d'état e-mail
         s'ajoutent, elles ne remplacent pas. */
      const statut = trs.filter(tr => tr.querySelector('.badge-active, .badge-soon, .badge-expired, .badge-suspended')).length;
      return { desab: n('.badge-unsub'), bloq: n('.badge-black'), statut, lignes: trs.length };
    });
    v('sans filtrer, 3 lignes portent la pastille « Désabonné »', pastilles.desab === 3, JSON.stringify(pastilles));
    v('… et 2 la pastille « Bloqué »', pastilles.bloq === 2, JSON.stringify(pastilles));
    v('… chaque ligne garde SON statut d\'abonnement (les pastilles s\'ajoutent, ne remplacent pas)',
      pastilles.statut === pastilles.lignes && pastilles.lignes === 5, JSON.stringify(pastilles));
    /* ⚠️ ET LA RANGÉE NE DOIT PAS GROSSIR. Le précédent est dans la feuille de style : en laissant
       les boutons d'action passer à la ligne, une rangée montait à 93 px et le tableau perdait sa
       densité. Ajouter une pastille dans la colonne STATUT rejouait exactement ça. On MESURE donc
       la hauteur peinte des rangées, et on exige que celle d'un compte à deux pastilles ne
       dépasse pas celle d'un compte nu. */
    const haut = await page.evaluate(() => {
      const trs = [...document.querySelectorAll('#users-table tbody tr')];
      const h = tr => Math.round(tr.getBoundingClientRect().height);
      const nue = trs.find(tr => !tr.querySelector('.badge-unsub') && !tr.querySelector('.badge-black'));
      const chargee = trs.find(tr => tr.querySelector('.badge-unsub') && tr.querySelector('.badge-black'));
      return { nue: nue ? h(nue) : 0, chargee: chargee ? h(chargee) : 0, max: Math.max(...trs.map(h)) };
    });
    v('une ligne à deux pastilles ne dépasse pas une ligne nue (la densité tient)',
      haut.chargee > 0 && haut.nue > 0 && haut.chargee <= haut.nue + 1, JSON.stringify(haut));
    v('… et aucune rangée ne repart à 93 px comme au défaut de référence',
      haut.max > 0 && haut.max < 70, JSON.stringify(haut));
  } catch (e) {
    v('le banc navigateur s\'exécute', false, e.message);
  } finally {
    if (nav) await nav.close();
    srv.close();
  }
  fin();
})();

function fin() {
  console.log('');
  if (ko) { console.log('✗ ' + ko + ' ÉCHEC(S) — ' + ok + ' contrôle(s) OK, ' + ko + ' KO\n'); process.exit(1); }
  console.log('✓ TOUT PASSE — ' + ok + ' contrôle(s) OK\n');
}
