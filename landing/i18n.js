/* DataTradingPro — landing i18n (FR par défaut dans le HTML, EN via ce dictionnaire).
   Détection : ?lang= > localStorage(dtp_lang) > langue navigateur (fr → FR, sinon EN).
   Bascule FR/EN dans la nav (#langTog) → mémorise + recharge. Le SWAP se fait sur les
   NŒUDS TEXTE (aucune modif de structure HTML) et SAUTE les maquettes desk (demo.js). */
(function () {
  "use strict";

  // ── Dictionnaire FR → EN (clé = texte français EXACT, espaces normalisés) ──
  var T = {
    // Nav
    "Le terminal": "The terminal",
    "Méthode": "Method",
    "Tarifs": "Pricing",
    "Actualités": "News",
    "Ressources": "Resources",
    "Se connecter": "Log in",
    "Accéder au terminal": "Access the terminal",
    // Hero
    "Terminal macro & forex · en français": "Macro & forex terminal · in French",
    "Tout le marché.": "The whole market.",
    "Un seul écran.": "One single screen.",
    "Le": "The",
    "terminal de trading forex & macro": "forex & macro trading terminal",
    "en français : news en temps réel, Smart Bias, force des devises, calendrier économique et recherche institutionnelle. Agrégés, filtrés et prêts à l'action.": "in French: real-time news, Smart Bias, currency strength, economic calendar and institutional research. Aggregated, filtered and ready to act on.",
    "Explorer les modules": "Explore the modules",
    "Pensé avec": "Built with",
    "des traders qui prennent le contexte au sérieux": "traders who take context seriously",
    "Flux agrégés en continu": "Continuously aggregated feeds",
    "100 % en français": "100% in French",
    "Aucun ordre passé à votre place": "No orders placed for you",
    "Amélioré chaque semaine": "Improved every week",
    // Modules
    "Tout ce qu'il vous faut.": "Everything you need.",
    "Rien de superflu.": "Nothing you don't.",
    "Un aperçu direct de chaque module, exactement ce que vous voyez dans le terminal.": "A direct preview of each module — exactly what you see in the terminal.",
    "Recherche institutionnelle": "Institutional research",
    "Goldman, ING, SocGen… leurs notes FX, droit au but.": "Goldman, ING, SocGen… their FX notes, straight to the point.",
    "Actus en temps réel": "Real-time news",
    "Le flux filtré : ce qui bouge les marchés.": "The filtered feed: what moves the markets.",
    "Radar de Biais": "Bias Radar",
    "Le biais des 8 devises, chaque semaine.": "The bias on all 8 currencies, every week.",
    "Force des devises": "Currency strength",
    "Qui mène, qui décroche, en continu.": "Who leads, who lags — in real time.",
    "Analystes": "Analysts",
    "Le marché résumé pour vous, chaque jour.": "The market summed up for you, every day.",
    // Méthode
    "La méthode": "The method",
    "De l'information à la décision.": "From information to decision.",
    "Sans le bruit.": "Without the noise.",
    "Un fil conducteur clair, du flux brut jusqu'à l'arbitrage que vous prenez en connaissance de cause.": "A clear thread, from the raw feed to the call you make with full awareness.",
    "Agréger": "Aggregate",
    "News, calendrier, force des devises, positionnement et recherche de banques : tout arrive au même endroit, en temps réel.": "News, calendar, currency strength, positioning and bank research: everything lands in one place, in real time.",
    "Valider": "Validate",
    "L'IA résume, traduit le jargon et met en regard les biais, les données et le contexte. Vous voyez ce qui converge, et ce qui s'oppose.": "The AI summarizes, translates the jargon and lines up biases, data and context. You see what aligns, and what conflicts.",
    "Décider": "Decide",
    "Vous arbitrez avec le contexte complet sous les yeux. Le terminal informe ; la décision reste la vôtre.": "You make the call with the full context in front of you. The terminal informs; the decision stays yours.",
    // Pensé en français
    "Pensé en français": "Built in French",
    "Un terminal forex & macro,": "A forex & macro terminal,",
    "dans votre langue.": "in your language.",
    "La donnée de marché est mondiale, mais l'analyse n'a pas à être en anglais. Tout le contexte, les résumés et l'assistant IA vous parlent en français, clairement.": "Market data is global, but the analysis doesn't have to be in English. All the context, the summaries and the AI assistant speak to you in French, clearly.",
    "Résumés et analyses de news rédigés en français clair": "News summaries and analysis written in plain French",
    "Assistant IA macro : posez votre question, réponse en français": "Macro AI assistant: ask your question, get the answer in French",
    "Jargon des banques centrales traduit et expliqué": "Central-bank jargon translated and explained",
    "Le contexte, sans la barrière de la langue": "The context, without the language barrier",
    "Là où les autres terminaux supposent l'anglais, on a fait le choix du français, du flux jusqu'à l'IA.": "Where other terminals assume English, we chose French — from the feed to the AI.",
    "News traduites": "Translated news",
    "Analyses en français": "Analysis in French",
    "IA francophone": "French-speaking AI",
    // La promesse
    "La promesse": "The promise",
    "Une infrastructure sur laquelle": "Infrastructure you can",
    "compter quand le marché bouge.": "rely on when the market moves.",
    "Temps réel": "Real time",
    "Les flux arrivent sans délai, pendant les sessions qui comptent.": "Feeds arrive with no delay, during the sessions that matter.",
    "Méthode transparente": "Transparent method",
    "On explique d'où vient chaque biais. Pas de boîte noire.": "We explain where each bias comes from. No black box.",
    "Support à taille humaine": "Human-scale support",
    "Une vraie personne répond, directement dans le terminal.": "A real person answers, right inside the terminal.",
    "Amélioration continue": "Continuous improvement",
    "De nouvelles fonctionnalités chaque semaine, à l'écoute des retours.": "New features every week, shaped by your feedback.",
    // Tarifs
    "Un prix clair, sans surprise.": "Clear pricing, no surprises.",
    "Tout le terminal, un seul abonnement. Sans engagement, résiliable en un clic.": "The whole terminal, one subscription. No commitment, cancel in one click.",
    "Annuel : 2 mois offerts, 60 € d'économie sur l'année": "Annual: 2 months free, €60 saved over the year",
    "MENSUEL": "MONTHLY",
    "/mois": "/month",
    "Sans engagement": "No commitment",
    "Accès complet au terminal": "Full access to the terminal",
    "News, Smart Bias, force des devises": "News, Smart Bias, currency strength",
    "Calendrier, taux, recherche de banques": "Calendar, rates, bank research",
    "Assistant IA macro en français": "Macro AI assistant in French",
    "Résiliable en un clic": "Cancel in one click",
    "Sans engagement · Résiliation en un clic": "No commitment · Cancel in one click",
    "2 mois offerts": "2 months free",
    "ANNUEL": "ANNUAL",
    "/an": "/year",
    "Soit 20 €/mois, 60 € d'économie": "That's €20/month, €60 saved",
    "Tout le plan mensuel, inclus": "Everything in Monthly, included",
    "2 mois offerts sur l'année": "2 months free over the year",
    "Tarif bloqué tant que l'abonnement court": "Price locked for as long as you stay subscribed",
    "Accès prioritaire aux nouveautés": "Priority access to new features",
    "Paiement sécurisé · Activation immédiate": "Secure payment · Instant activation",
    // FAQ
    "Questions fréquentes": "Frequently asked questions",
    "Tout ce qu'il faut savoir avant de commencer, sans engagement, résiliable en un clic.": "Everything you need to know before getting started — no commitment, cancel in one click.",
    "DataTradingPro passe-t-il des ordres à ma place ?": "Does DataTradingPro place orders for me?",
    "Non, jamais. DataTradingPro est un terminal d'information et d'analyse : il ne se connecte à aucun broker et n'exécute aucun ordre. Vous gardez la main à 100 % sur vos positions.": "No, never. DataTradingPro is an information and analysis terminal: it connects to no broker and executes no orders. You keep 100% control over your positions.",
    "Est-ce un conseil en investissement ?": "Is this investment advice?",
    "Non. C'est un outil d'aide à la décision qui rassemble et clarifie l'information de marché. Nous ne donnons aucun conseil personnalisé et ne sommes pas un conseiller en investissement.": "No. It's a decision-support tool that gathers and clarifies market information. We give no personalized advice and are not an investment advisor.",
    "Faut-il installer un logiciel ?": "Do I need to install any software?",
    "Non : le terminal fonctionne directement dans votre navigateur, sur ordinateur comme sur mobile. Une application de bureau optionnelle est disponible pour Windows et macOS si vous préférez une fenêtre dédiée.": "No: the terminal runs right in your browser, on desktop and mobile. An optional desktop app is available for Windows and macOS if you prefer a dedicated window.",
    "D'où viennent les données ?": "Where does the data come from?",
    "De flux de marché temps réel agrégés : news, calendrier économique, force des devises, positionnement (COT/CFTC), taux des banques centrales et recherche publiée par les grandes banques. Le tout réuni, filtré et mis en contexte.": "From aggregated real-time market feeds: news, economic calendar, currency strength, positioning (COT/CFTC), central-bank rates and research published by the major banks. All brought together, filtered and put in context.",
    "Les biais affichés sont-ils des signaux de trading ?": "Are the biases shown trading signals?",
    "Non. Le Smart Bias est une lecture directionnelle du contexte fondamental, pas un signal d'achat ou de vente. Il sert à cadrer votre analyse. La décision et la gestion du risque restent les vôtres.": "No. Smart Bias is a directional read of the fundamental context, not a buy or sell signal. It's there to frame your analysis. The decision and risk management stay yours.",
    "L'abonnement est-il sans engagement ?": "Is the subscription commitment-free?",
    "Oui. L'abonnement mensuel est sans engagement et résiliable en un clic, à tout moment, sans frais cachés. La formule annuelle vous fait économiser 60 € sur l'année.": "Yes. The monthly plan is commitment-free and cancellable in one click, anytime, with no hidden fees. The annual plan saves you €60 over the year.",
    "Comment j'accède au terminal après paiement ?": "How do I access the terminal after payment?",
    "Immédiatement. Vos identifiants vous sont envoyés par email dès la validation du paiement, et vous vous connectez sur desk.datatradingpro.com. Aucune installation requise.": "Immediately. Your credentials are emailed to you as soon as payment is confirmed, and you log in at desk.datatradingpro.com. No installation required.",
    // CTA final
    "Accédez au terminal complet.": "Access the full terminal.",
    "Le marché ne vous attend pas. Réunissez news, biais, données et recherche sur un seul écran, dès aujourd'hui.": "The market won't wait for you. Bring news, biases, data and research onto a single screen, starting today.",
    "Accéder au terminal · 24,99 €/mois": "Access the terminal · €24.99/month",
    "Sans engagement · résiliable en un clic · accès immédiat": "No commitment · cancel in one click · instant access",
    // Footer
    "Le terminal de news & d'analyse de marché en temps réel, pensé en français pour les traders macro & forex.": "The real-time market news & analysis terminal, built in French for macro & forex traders.",
    "Toutes les actualités": "All news",
    "Banques centrales": "Central banks",
    "Indices boursiers": "Stock indices",
    "Taux & obligations": "Rates & bonds",
    "Énergie & matières premières": "Energy & commodities",
    "Données économiques": "Economic data",
    "Géopolitique": "Geopolitics",
    "Pourquoi DataTradingPro": "Why DataTradingPro",
    "Terminal de trading": "Trading terminal",
    "Meilleur terminal": "Best terminal",
    "Terminal gratuit ?": "Free terminal?",
    "News forex": "Forex news",
    "Calendrier économique": "Economic calendar",
    "Positions des banques": "Bank positions",
    "En savoir plus": "Learn more",
    "Lire le COT / CFTC": "Reading the COT / CFTC",
    "Rapports de banques": "Bank reports",
    "Glossaire macro & forex": "Macro & forex glossary",
    "Trader les news forex": "Trading forex news",
    "Trader le NFP": "Trading the NFP",
    "Sessions du forex": "Forex sessions",
    "Avertissement de risque": "Risk disclaimer",
    "Conditions générales": "Terms & conditions",
    "Avertissement : le trading comporte un risque de perte. DataTradingPro fournit de l'information et des outils d'analyse, pas du conseil en investissement, et n'exécute aucun ordre. Les performances passées ne préjugent pas des performances futures.": "Disclaimer: trading carries a risk of loss. DataTradingPro provides information and analysis tools, not investment advice, and executes no orders. Past performance does not guarantee future results.",
    "© 2026 DataTradingPro. Tous droits réservés.": "© 2026 DataTradingPro. All rights reserved.",
    "Fait avec rigueur, pour les traders qui prennent le contexte au sérieux.": "Built with rigor, for traders who take context seriously."
  };

  // ── Méta / SEO (valeurs EN) ──
  var META = {
    title: "Forex & Macro Trading Terminal | DataTradingPro",
    desc: "The French-language forex & macro trading terminal: prioritized news, economic calendar, Smart Bias, COT and AI analysis. From €24.99/month, no commitment.",
    twDesc: "French-language macro & forex terminal: prioritized news, economic calendar, Smart Bias, COT, bank reports and AI. From €24.99/month."
  };

  // ── Régions maquette (aperçus desk pilotés par demo.js) : JAMAIS traduites ──
  var SKIP_SEL = '.ticker, .term, [class*="hfm"], [class*="dk-"], [class*="tk-"], #feed, #gLbl, #tkTrack, script, style, svg, noscript';

  function getLang() {
    try { var q = new URLSearchParams(location.search).get('lang'); if (q === 'fr' || q === 'en') { try { localStorage.setItem('dtp_lang', q); } catch (e) {} return q; } } catch (e) {}
    try { var s = localStorage.getItem('dtp_lang'); if (s === 'fr' || s === 'en') return s; } catch (e) {}
    var l = (((navigator.languages && navigator.languages[0]) || navigator.language || 'fr') + '').toLowerCase();
    return l.indexOf('fr') === 0 ? 'fr' : 'en';
  }
  function setLang(l) { try { localStorage.setItem('dtp_lang', l); } catch (e) {} location.reload(); }

  var lang = getLang();
  try { document.documentElement.lang = lang; } catch (e) {}

  function setMetaC(sel, val) { if (!val) return; var m = document.querySelector(sel); if (m) m.setAttribute('content', val); }

  function translate() {
    if (lang !== 'en' || !document.body) return;
    if (META.title) { try { document.title = META.title; } catch (e) {} }
    setMetaC('meta[name="description"]', META.desc);
    setMetaC('meta[property="og:title"]', META.title);
    setMetaC('meta[property="og:description"]', META.desc);
    setMetaC('meta[name="twitter:title"]', META.title);
    setMetaC('meta[name="twitter:description"]', META.twDesc || META.desc);
    setMetaC('meta[property="og:locale"]', 'en_US');
    setMetaC('meta[http-equiv="content-language"]', 'en');

    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
    var nodes = [], n;
    while ((n = walker.nextNode())) nodes.push(n);
    nodes.forEach(function (node) {
      var el = node.parentElement;
      if (!el || (el.closest && el.closest(SKIP_SEL))) return;
      var raw = node.nodeValue; if (!raw) return;
      var key = raw.replace(/\s+/g, ' ').trim();
      if (!key || !T[key]) return;
      var lead = (raw.match(/^\s*/) || [''])[0], trail = (raw.match(/\s*$/) || [''])[0];
      node.nodeValue = lead + T[key] + trail;
    });
  }

  function mountToggle() {
    var tog = document.getElementById('langTog');
    if (!tog) return;
    var btns = tog.querySelectorAll('[data-lang]');
    for (var i = 0; i < btns.length; i++) {
      (function (b) {
        if (b.getAttribute('data-lang') === lang) b.classList.add('on');
        b.addEventListener('click', function () { var l = b.getAttribute('data-lang'); if (l !== lang) setLang(l); });
      })(btns[i]);
    }
  }

  function run() { try { translate(); } catch (e) {} try { mountToggle(); } catch (e) {} }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run); else run();
})();
