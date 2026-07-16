// Signature AD-HOC profonde de l'app macOS (hook afterPack electron-builder, exécuté sur le runner mac CI).
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// POURQUOI (bug client 16/07) : sans AUCUNE signature (identity:null), les macOS récents affichent
// « DataTradingPro est endommagé et ne peut pas être ouvert » — un CUL-DE-SAC : seule la commande
// Terminal `xattr -cr` débloquait, inacceptable pour un client. Avec une signature ad-hoc VALIDE et
// cohérente sur tout le bundle, macOS affiche à la place le dialogue standard « développeur non
// vérifié » → clic droit → Ouvrir, ou Réglages Système → Confidentialité et sécurité → « Ouvrir quand
// même » : 100 % graphique, zéro commande, une seule fois.
// (La seule expérience SANS dialogue du tout = certificat Apple Developer + notarisation — payant.)
// afterPack tourne AVANT la création des DMG/ZIP → les installeurs embarquent l'app signée.
'use strict';
const { execSync } = require('child_process');
const path = require('path');

exports.default = async function adhocSign(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const appName = context.packager.appInfo.productFilename + '.app';
  const appPath = path.join(context.appOutDir, appName);
  console.log('[adhoc-sign] signature ad-hoc profonde de', appPath);
  execSync(`codesign --force --deep --sign - "${appPath}"`, { stdio: 'inherit' });
  // Vérification STRICTE : échoue le build si la signature est incohérente (preuve dans les logs CI —
  // on ne republie plus jamais un bundle qui redonnerait « endommagé »).
  execSync(`codesign --verify --deep --strict --verbose=2 "${appPath}"`, { stdio: 'inherit' });
  console.log('[adhoc-sign] OK — bundle signé ad-hoc et vérifié');
};
