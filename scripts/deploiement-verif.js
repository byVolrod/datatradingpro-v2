#!/usr/bin/env node
/**
 * scripts/deploiement-verif.js — PUSH = PROD, MAIS JAMAIS SANS SES GARDES
 *
 * HISTORIQUE. 27/08 : « pousser ne déploie pas », déclencheur strictement manuel — ce banc
 * exigeait l'égalité à { workflow_dispatch }. 29/08 : l'utilisateur lève cette règle en toutes
 * lettres (« retrouver le push = prod automatique comme sur Render » → « oui ») : chaque push sur
 * main déploie. La RAISON D'ÊTRE du banc s'inverse avec la règle, elle ne disparaît pas :
 *
 * ⚠️ CE QU'IL SURVEILLE DÉSORMAIS. (1) Le jeu de déclencheurs est EXACTEMENT { push sur main +
 * workflow_dispatch } : retirer `push` réinstallerait l'ancienne règle en silence ; ajouter
 * `schedule` (ou autre) déploierait sans nouveau code ; un push SANS filtre de branche ferait
 * déployer les branches de session. (2) La garde `npm run check` court AVANT tout contact avec le
 * VPS : c'est ELLE qui remplace l'ancienne règle — l'objection historique (« un correctif à moitié
 * fini, poussé pour le sauvegarder, partirait chez les clients ») reste traitée, par le banc
 * plutôt que par la retenue manuelle. La retirer rouvrirait exactement ce trou.
 *
 * IL VÉRIFIE AUSSI QU'IL N'Y A QU'UNE IMPLÉMENTATION. Le workflow APPELLE `scripts/deploy.sh` au
 * lieu de recopier la séquence fetch → reset → build → up. Deux copies divergent toujours, et ici
 * la divergence se paierait sur la machine qui sert les clients.
 *
 *   node scripts/deploiement-verif.js
 *
 * Sans parseur YAML disponible, les contrôles qui en dépendent S'ABSTIENNENT (les autres tournent).
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const RACINE = path.join(__dirname, '..');
const WF = path.join(RACINE, '.github/workflows/deploy-desk.yml');
const SH = path.join(RACINE, 'scripts/deploy.sh');

let ko = 0, abst = 0;
const v = (nom, cond, detail) => {
  if (cond) console.log('  ✓ ' + nom);
  else { ko++; console.log('  ✗ ' + nom + (detail ? '\n      → ' + detail : '')); }
};
const sabstient = (nom, pourquoi) => { abst++; console.log('  ~ ' + nom + ' (abstenu : ' + pourquoi + ')'); };

/* ── Lecture ────────────────────────────────────────────────────────────────────────────────── */
console.log('\n── Le déploiement par bouton : ce qui le déclenche ──');
if (!fs.existsSync(WF)) { console.log('  ✗ .github/workflows/deploy-desk.yml introuvable'); process.exit(1); }
const wf = fs.readFileSync(WF, 'utf8');
const sh = fs.existsSync(SH) ? fs.readFileSync(SH, 'utf8') : '';

/* Le YAML est lu par un VRAI parseur, jamais à la regex : `on:` peut s'écrire en liste, en
   dictionnaire, ou sur une ligne, et une regex qui ne connaîtrait qu'une forme laisserait passer
   les deux autres — un banc qui rate ce qu'il traque est pire que pas de banc. */
let doc = null;
try {
  doc = JSON.parse(execFileSync('python3', ['-c',
    'import yaml,json,sys; print(json.dumps(yaml.safe_load(open(sys.argv[1], encoding="utf-8"))))', WF],
    { encoding: 'utf8' }));
} catch (e) { doc = null; }

if (!doc) {
  sabstient('le workflow est du YAML valide', 'aucun parseur YAML (python3 + PyYAML)');
  sabstient('SEUL le bouton manuel déclenche un déploiement', 'idem');
} else {
  v('le workflow est du YAML valide', typeof doc === 'object' && doc !== null);
  /* ⚠️ `on` EST UN PIÈGE EN YAML 1.1 : la clé nue `on` se lit comme le BOOLÉEN vrai, pas comme la
     chaîne « on ». PyYAML rend donc la clé `True`. Un banc qui chercherait `doc.on` trouverait
     `undefined`, conclurait « aucun déclencheur » et passerait au vert en ne vérifiant RIEN. */
  const declench = doc.on !== undefined ? doc.on : doc['true'];
  const cles = declench && typeof declench === 'object' && !Array.isArray(declench)
    ? Object.keys(declench)
    : (Array.isArray(declench) ? declench : (declench ? [String(declench)] : []));
  v('le bloc des déclencheurs est bien lu', cles.length > 0,
    'clés vues : ' + JSON.stringify(Object.keys(doc)));
  /* LE CONTRÔLE CENTRAL. On exige l'ÉGALITÉ au JEU { push, workflow_dispatch } — pas une liste
     noire, qui laisserait entrer `schedule`, `pull_request`, `release`, `repository_dispatch` :
     un déploiement sans nouveau code serait une violation sous un autre nom. */
  v('les déclencheurs sont EXACTEMENT push + bouton manuel (décision user 29/08 : push = prod)',
    cles.length === 2 && cles.includes('push') && cles.includes('workflow_dispatch'),
    'déclencheurs trouvés : ' + cles.join(', '));
  /* Et le push est FILTRÉ sur main : sans le filtre, pousser une branche de session ou de
     sauvegarde déclencherait aussi — le déploiement fait `reset --hard origin/main`, donc on
     déploierait main sous le nom d'une autre branche, à un moment que personne n'a choisi. */
  const pushCfg = declench && typeof declench === 'object' ? declench.push : null;
  v('… et le push ne déclenche que sur MAIN',
    !!pushCfg && Array.isArray(pushCfg.branches) && pushCfg.branches.length === 1 && pushCfg.branches[0] === 'main',
    'push.branches = ' + JSON.stringify(pushCfg && pushCfg.branches));

  const job = doc.jobs && doc.jobs.deployer;
  v('le job existe', !!job);
  /* LA GARDE QUI REMPLACE L'ANCIENNE RÈGLE : les bancs du dépôt tournent AVANT que la clé ne soit
     même posée. L'ordre compte — un check qui courrait après le déploiement ne bloquerait rien. */
  if (job && Array.isArray(job.steps)) {
    const noms = job.steps.map(st => String(st.name || ''));
    const iCheck = noms.findIndex(n => /npm run check/.test(n));
    const iCle = noms.findIndex(n => /clé est posée/.test(n));
    const stCheck = iCheck >= 0 ? job.steps[iCheck] : null;
    v('npm run check court dans le job, AVANT tout contact avec la clé et le VPS',
      iCheck >= 0 && iCle > iCheck && !!stCheck && /npm run check/.test(String(stCheck.run || '')),
      'étapes vues : ' + noms.join(' → '));
    v('… et son échec BLOQUE (pas de continue-on-error)',
      !!stCheck && stCheck['continue-on-error'] !== true);
  }
  if (job) {
    v('le miroir « backup » ne peut pas déployer',
      String(job.if || '').includes("github.repository == 'byVolrod/datatradingpro-v2'"),
      'condition : ' + (job.if || '(aucune)'));
    v('le job a un plafond de durée', typeof job['timeout-minutes'] === 'number');
  }
  const cc = doc.concurrency;
  v('deux déploiements ne peuvent pas se chevaucher', !!(cc && cc.group));
  /* Interrompre un déploiement à mi-course laisse le VPS entre deux images : pire que d'attendre. */
  v('… et un déploiement en cours n’est jamais interrompu', !!cc && cc['cancel-in-progress'] === false,
    'cancel-in-progress = ' + (cc ? cc['cancel-in-progress'] : '(absent)'));
}

/* ── Une seule implémentation ───────────────────────────────────────────────────────────────── */
console.log('\n── Une seule implémentation du déploiement ──');
v('le workflow APPELLE scripts/deploy.sh', /bash\s+scripts\/deploy\.sh/.test(wf));
/* La séquence distante ne doit exister QUE dans le script. Si elle apparaît aussi dans le YAML,
   les deux copies divergeront — et la divergence se paierait sur la machine qui sert les clients. */
const RECOPIE = [/docker\s+compose\s+build/, /git\s+reset\s+--hard/, /docker\s+compose\s+up/];
const recopiees = RECOPIE.filter(rx => rx.test(wf.replace(/^\s*#.*$/gm, '')));
v('… et ne recopie pas sa séquence distante', recopiees.length === 0,
  recopiees.length + ' morceau(x) de la séquence dupliqué(s) dans le YAML');
v('la séquence vit bien dans le script', RECOPIE.every(rx => rx.test(sh)));

/* ── La couture par variables d'environnement ───────────────────────────────────────────────── */
console.log('\n── Le script accepte bien ce que le workflow lui passe ──');
for (const nom of ['DTP_KEY', 'DTP_HOST', 'DTP_DIR', 'DTP_URL']) {
  /* On éprouve que le script LIT la variable AVEC une valeur par défaut (`${VAR:-…}`) : sans
     défaut, un réglage non posé viderait l'hôte au lieu de retomber sur le VPS de production. */
  v('deploy.sh lit ' + nom + ' avec un repli',
    new RegExp('\\$\\{' + nom + ':-').test(sh));
}
/* ⚠️ ET LE PIÈGE DES VARIABLES DE DÉPÔT NON POSÉES : GitHub les passe comme chaîne VIDE, pas comme
   variable absente. `${DTP_HOST:-défaut}` ne se déclencherait donc JAMAIS et l'hôte serait vide —
   le déploiement partirait vers nulle part. Le workflow doit retirer ce qui est vide. */
v('le workflow retire les variables VIDES avant d’appeler le script',
  /unset\s+\$?v|\bunset\b/.test(wf) && /DTP_HOST\s+DTP_DIR\s+DTP_URL/.test(wf),
  'sans ça, une variable de dépôt non posée vide l’hôte au lieu de laisser le défaut');

/* ── La clé ─────────────────────────────────────────────────────────────────────────────────── */
console.log('\n── La clé de déploiement ──');
v('la clé est écrite en droits 600', /chmod\s+600\s+~\/\.ssh\/dtp_deploy/.test(wf));
v('… et effacée à la fin, même en cas d’échec',
  /if:\s*always\(\)/.test(wf) && /rm\s+-f\s+~\/\.ssh\/dtp_deploy/.test(wf));
/* `printf '%s\n'` et non `echo` : une clé PEM finit par un saut de ligne qu'OpenSSH exige. Écrit
   avec `echo -n`, elle est refusée pour « invalid format » — trente secondes plus tard, avec une
   erreur qui ne dit pas ça. */
v('la clé est écrite avec son saut de ligne final', /printf\s+'%s\\n'\s+"\$CLE"/.test(wf));
/* Le secret ne doit apparaître que là où l'on teste sa PRÉSENCE, jamais dans un `echo`/`run` qui
   l'imprimerait. GitHub masque les secrets dans les journaux, mais on ne s'appuie pas là-dessus. */
const lignesCle = wf.split('\n').filter(l => /secrets\.DTP_SSH_KEY/.test(l));
v('le secret n’est jamais imprimé',
  lignesCle.every(l => /-z\s+"\$\{\{\s*secrets\.DTP_SSH_KEY/.test(l) || /^\s*CLE:/.test(l)),
  lignesCle.filter(l => !/-z|^\s*CLE:/.test(l)).join(' | '));
v('un secret absent est dit tout de suite', /::error::/.test(wf) && /DTP_SSH_KEY/.test(wf));
/* L'empreinte du VPS : épinglable, et son absence doit se VOIR dans le journal plutôt que de
   passer pour normale. */
v('l’absence d’empreinte épinglée est signalée', /::warning::/.test(wf) && /DTP_KNOWN_HOSTS/.test(wf));

console.log(ko
  ? '\n✗ ' + ko + ' CONTRÔLE(S) AU ROUGE\n'
  : '\n✓ ' + (abst ? 'contrôles au vert (' + abst + ' abstenu(s))' : 'tous les contrôles au vert') + '\n');
process.exit(ko ? 1 : 0);
