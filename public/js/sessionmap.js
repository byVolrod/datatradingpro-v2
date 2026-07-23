/* ===================================================================
   DataTradingPro — Carte des sessions : VRAIE carte SATELLITE (Leaflet + tuiles Esri).
   Redéfinit window.buildSessionMap() (remplace la version amCharts de charts.js).
   Chargé APRÈS charts.js. Réutilise MAP_CITIES + isCityOpen (scope global partagé).
   Réversible : retirer ce <script> → la version amCharts reprend.
=================================================================== */
(function () {
  'use strict';

  window.buildSessionMap = function buildSessionMapLeaflet() {
    if (typeof L === 'undefined') { setTimeout(window.buildSessionMap, 600); return; }
    var el = document.getElementById('am5-map');
    if (!el) return;
    // Carte VECTORIELLE (geodata LOCAL, sans CDN) = la plus fiable. Si le geodata amCharts n'est pas
    // ENCORE chargé au moment de bâtir, on RÉESSAIE (retry borné ~6 s) AU LIEU de basculer tout de suite
    // sur les tuiles CARTO (CDN qui peut échouer → carte VIDE, le bug signalé). Au pire on tombe sur les
    // tuiles après l'attente. → "la carte des sessions ne doit plus jamais être vide".
    if (typeof am5geodata_worldLow === 'undefined' || !am5geodata_worldLow || !am5geodata_worldLow.features) {
      window._dtpMapWait = (window._dtpMapWait || 0) + 1;
      if (window._dtpMapWait <= 12) { setTimeout(window.buildSessionMap, 500); return; }
    }

    // 4 SESSIONS FX MAJEURES uniquement (demande user 03/07 : « je veux voir uniquement les sessions »
    // — Dubaï/HK retirés, ce ne sont pas des sessions majeures). Noms FR, heures locales de place inchangées.
    var CITIES = [
      { id: 'sydney',  name: 'Sydney',   tz: 'Australia/Sydney', lon: 151.2, lat: -33.9, open: 9, close: 17 },
      { id: 'tokyo',   name: 'Tokyo',    tz: 'Asia/Tokyo',       lon: 139.7, lat: 35.7,  open: 9, close: 15 },
      { id: 'london',  name: 'Londres',  tz: 'Europe/London',    lon: -0.12, lat: 51.5,  open: 8, close: 17 },
      { id: 'newyork', name: 'New York', tz: 'America/New_York', lon: -74.0, lat: 40.7,  open: 9, close: 17 }
    ];
    // État complet d'une session : ouverte ? + minutes avant la clôture / la prochaine ouverture
    // (week-end sauté). Calcul dans le référentiel LOCAL de la place (DST géré par Intl/timeZone).
    function cityState(city, now) {
      var local = new Date(now.toLocaleString('en-US', { timeZone: city.tz }));
      var h = local.getHours() + local.getMinutes() / 60, dow = local.getDay();
      if (dow >= 1 && dow <= 5 && h >= city.open && h < city.close) {
        return { open: true, soon: false, mins: Math.max(1, Math.round((city.close - h) * 60)) };
      }
      for (var d = 0; d < 8; d++) {   // prochaine ouverture un jour OUVRÉ (lun-ven)
        var cand = new Date(local); cand.setDate(local.getDate() + d); cand.setHours(city.open, 0, 0, 0);
        if (cand > local && cand.getDay() >= 1 && cand.getDay() <= 5) {
          var mins = Math.max(1, Math.round((cand - local) / 60000));
          return { open: false, soon: mins <= 45, mins: mins };
        }
      }
      return { open: false, soon: false, mins: 0 };
    }
    function frDur(mins) {
      var h = Math.floor(mins / 60), m = mins % 60;
      if (h <= 0) return m + ' min';
      if (h >= 24) return Math.floor(h / 24) + ' j ' + (h % 24) + ' h';
      return h + ' h' + (m ? ' ' + (m < 10 ? '0' + m : m) : '');
    }

    try { if (window._dtpLfMap) { window._dtpLfMap.remove(); window._dtpLfMap = null; } } catch (e) {}
    try { if (window._dtpLfClock) { clearInterval(window._dtpLfClock); window._dtpLfClock = null; } } catch (e) {}
    try { if (window._dtpLfNight) { clearInterval(window._dtpLfNight); window._dtpLfNight = null; } } catch (e) {}
    el.innerHTML = '';
    el.style.background = '#0b0c0f';

    var map = L.map(el, {
      center: [18, 6], zoom: 1.4, minZoom: 1, maxZoom: 7, zoomSnap: 0,
      zoomControl: false, attributionControl: true,
      // worldCopyJump retiré + maxBounds : un SEUL monde affiché → fini la réplication latérale
      // qui étirait le terminateur jour/nuit en bandes horizontales vertes parasites.
      worldCopyJump: false, maxBounds: [[-74, -180], [84, 180]], maxBoundsViscosity: 1.0,
      dragging: false, scrollWheelZoom: false, doubleClickZoom: false, boxZoom: false, keyboard: false
    });
    window._dtpLfMap = map;
    try { map.attributionControl.setPrefix(''); } catch (e) {}

    // Carte VECTORIELLE on-brand (PAS de tuiles) : continents slate + bordures dorées sur fond charcoal en dégradé.
    // Réutilise le geodata amCharts worldLow déjà chargé (window.am5geodata_worldLow) comme couche GeoJSON Leaflet.
    el.style.background = 'radial-gradient(125% 105% at 55% 32%, #16181f 0%, #0b0c10 52%, #07080a 100%)';
    // Retire les anneaux de polygones qui CROISENT l'antiméridien (±180°) → fin du "smear"
    // (bande verte horizontale tracée en travers, ex. pointe est de la Russie rejoignant -180°).
    function _clipDateline(geo) {
      function crosses(ring) {
        var e = false, w = false;
        for (var i = 0; i < ring.length; i++) { if (ring[i][0] > 150) e = true; else if (ring[i][0] < -150) w = true; }
        return e && w;
      }
      var feats = [];
      (geo.features || []).forEach(function (f) {
        if (!f.geometry) return;
        var g = f.geometry, coords;
        if (g.type === 'Polygon') {
          coords = g.coordinates.filter(function (r) { return !crosses(r); });
        } else if (g.type === 'MultiPolygon') {
          coords = g.coordinates.map(function (poly) { return poly.filter(function (r) { return !crosses(r); }); })
                                .filter(function (poly) { return poly.length; });
        } else { feats.push(f); return; }
        if (coords.length) feats.push({ type: f.type || 'Feature', properties: f.properties, geometry: { type: g.type, coordinates: coords } });
      });
      return { type: geo.type || 'FeatureCollection', features: feats };
    }
    var hasVector = false;
    try {
      if (typeof am5geodata_worldLow !== 'undefined' && am5geodata_worldLow && am5geodata_worldLow.features) {
        var gj = L.geoJSON(_clipDateline(am5geodata_worldLow), {
          interactive: false,
          style: { fillColor: '#237a42', fillOpacity: 1, color: '#164d2b', weight: 0.5, opacity: 0.7 }
        });
        if (gj.getLayers().length > 5) { gj.addTo(map); hasVector = true; }
      }
    } catch (e) {}
    if (!hasVector) {
      // Filet de sécurité : si le geodata vectoriel manque, tuiles sombres CARTO (jamais de carte vide)
      try { L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { subdomains: 'abcd', maxZoom: 19, attribution: '&copy; OpenStreetMap, &copy; CARTO' }).addTo(map); } catch (e) {}
    }

    // Terminateur jour/nuit (si le plugin a chargé)
    if (typeof L.terminator === 'function') {
      try {
        var term = L.terminator({ fillColor: '#070b14', fillOpacity: 0.5, color: '#070b14', weight: 0, interactive: false, className: 'lf-terminator' });
        term.addTo(map);
        window._dtpLfNight = setInterval(function () { try { term.setTime(new Date()); } catch (e) {} }, 60000);
      } catch (e) {}
    }

    // Badge 2 lignes : [dot] HH:MM Ville / « ferme dans 2 h 05 » (ouverte) ou « ouvre dans 11 h 20 » (fermée).
    // Ouverte = badge allumé (bordure verte) ; imminente (<45 min) = dot ambre ; fermée = badge éteint.
    function cityHtml(city, now, st) {
      var t = now.toLocaleTimeString('fr-FR', { timeZone: city.tz, hour: '2-digit', minute: '2-digit' });
      var cls = st.open ? 'lf-open' : (st.soon ? 'lf-closed lf-soon' : 'lf-closed');
      var sub = st.open ? 'ferme dans ' + frDur(st.mins) : 'ouvre dans ' + frDur(st.mins);
      return '<div class="lf-city ' + cls + '">'
        + '<div class="lf-row"><span class="lf-dot"></span><b>' + t + '</b><span class="lf-name">' + city.name + '</span></div>'
        + '<div class="lf-sub">' + sub + '</div>'
        + '</div>';
    }
    function mkIcon(city, now, st) {
      return L.divIcon({ className: 'lf-city-wrap', html: cityHtml(city, now, st), iconSize: [0, 0], iconAnchor: [0, 0] });
    }
    CITIES.forEach(function (city) {
      // Halo géographique STATIQUE (zone de session active) — jamais d'animation clignotante.
      city._halo = L.circle([city.lat, city.lon], { radius: 2200000, stroke: false, fillColor: '#00e676', fillOpacity: 0, interactive: false }).addTo(map);
      city._lfm = L.marker([city.lat, city.lon], { icon: mkIcon(city, new Date(), cityState(city, new Date())), interactive: false, keyboard: false }).addTo(map);
    });
    // Rafraîchit badges + halos + résumé d'en-tête (« Londres · New York ouvertes »)
    function refreshSessions(now) {
      var openNames = [];
      var nextUp = null;
      CITIES.forEach(function (city) {
        var st = cityState(city, now);
        if (city._lfm) city._lfm.setIcon(mkIcon(city, now, st));
        if (city._halo) { try { city._halo.setStyle({ fillOpacity: st.open ? 0.09 : 0 }); } catch (e) {} }
        if (st.open) openNames.push(city.name);
        else if (!nextUp || st.mins < nextUp.mins) nextUp = { name: city.name, mins: st.mins };
      });
      var lab = document.getElementById('active-sessions-label');
      if (lab) {
        if (openNames.length) { lab.textContent = openNames.join(' · ') + (openNames.length > 1 ? ' ouvertes' : ' ouverte'); lab.style.color = '#00e676'; }
        else if (nextUp) { lab.textContent = 'Fermé · ' + nextUp.name + ' ouvre dans ' + frDur(nextUp.mins); lab.style.color = '#8a8f98'; }
      }
    }
    refreshSessions(new Date());
    window._dtpLfClock = setInterval(function () { refreshSessions(new Date()); }, 30000);

    // Cadrage initial UNE fois, puis on FIGE la vue (center+zoom) → toute revisite d'onglet se contente de
    // recalculer la taille SANS refit, ce qui supprime le « dézoom puis zoom » signalé (fitBounds recalcule un
    // zoom fractionnaire légèrement différent à chaque appel → flottement). On mémorise la vue obtenue.
    function _dtpFit(){
      try {
        map.invalidateSize();
        map.fitBounds([[-56, -168], [74, 178]], { animate: false, padding: [3, 3] });
        window._dtpLfView = { center: map.getCenter(), zoom: map.getZoom() };
      } catch (e) {}
    }
    setTimeout(_dtpFit, 250);
    setTimeout(_dtpFit, 900);
    // Recadrage LÉGER sur revisite d'onglet (appelé par initRightTab) : recalcule la taille et RESTAURE la vue
    // figée SANS refit → aucun re-zoom visible. Repli sur _dtpFit si la vue n'a pas encore été mémorisée.
    window._dtpLfRefit = function () {
      try {
        map.invalidateSize();
        if (window._dtpLfView) map.setView(window._dtpLfView.center, window._dtpLfView.zoom, { animate: false });
        else map.fitBounds([[-56, -168], [74, 178]], { animate: false, padding: [3, 3] });
      } catch (e) {}
    };
  };
})();
