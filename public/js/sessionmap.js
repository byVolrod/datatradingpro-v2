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

    var CITIES = (typeof MAP_CITIES !== 'undefined') ? MAP_CITIES : [
      { id: 'london', name: 'London', tz: 'Europe/London', lon: -0.12, lat: 51.5, open: 8, close: 17 },
      { id: 'newyork', name: 'New York', tz: 'America/New_York', lon: -74.0, lat: 40.7, open: 9, close: 17 },
      { id: 'tokyo', name: 'Tokyo', tz: 'Asia/Tokyo', lon: 139.7, lat: 35.7, open: 9, close: 15 },
      { id: 'sydney', name: 'Sydney', tz: 'Australia/Sydney', lon: 151.2, lat: -33.9, open: 9, close: 17 },
      { id: 'dubai', name: 'Dubai', tz: 'Asia/Dubai', lon: 55.3, lat: 25.2, open: 8, close: 14 },
      { id: 'hongkong', name: 'HK', tz: 'Asia/Hong_Kong', lon: 114.2, lat: 22.3, open: 9, close: 16 }
    ];
    function cityOpen(city, now) {
      if (typeof isCityOpen === 'function') { try { return isCityOpen(city, now); } catch (e) {} }
      var local = new Date(now.toLocaleString('en-US', { timeZone: city.tz }));
      var h = local.getHours() + local.getMinutes() / 60, dow = local.getDay();
      if (dow === 0 || dow === 6) return false;
      return h >= city.open && h < city.close;
    }

    try { if (window._dtpLfMap) { window._dtpLfMap.remove(); window._dtpLfMap = null; } } catch (e) {}
    try { if (window._dtpLfClock) { clearInterval(window._dtpLfClock); window._dtpLfClock = null; } } catch (e) {}
    try { if (window._dtpLfNight) { clearInterval(window._dtpLfNight); window._dtpLfNight = null; } } catch (e) {}
    el.innerHTML = '';
    el.style.background = '#0b0c0f';

    var map = L.map(el, {
      center: [22, 12], zoom: 2, minZoom: 1, maxZoom: 7,
      zoomControl: false, attributionControl: true,
      worldCopyJump: true, dragging: false, scrollWheelZoom: false, doubleClickZoom: false, boxZoom: false, keyboard: false
    });
    window._dtpLfMap = map;
    try { map.attributionControl.setPrefix(''); } catch (e) {}

    // Carte VECTORIELLE on-brand (PAS de tuiles) : continents slate + bordures dorées sur fond charcoal en dégradé.
    // Réutilise le geodata amCharts worldLow déjà chargé (window.am5geodata_worldLow) comme couche GeoJSON Leaflet.
    el.style.background = 'radial-gradient(125% 105% at 55% 32%, #16181f 0%, #0b0c10 52%, #07080a 100%)';
    var hasVector = false;
    try {
      if (typeof am5geodata_worldLow !== 'undefined' && am5geodata_worldLow && am5geodata_worldLow.features) {
        var gj = L.geoJSON(am5geodata_worldLow, {
          interactive: false,
          style: { fillColor: '#272c37', fillOpacity: 1, color: '#5a4f2e', weight: 0.5, opacity: 0.65 }
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
        var term = L.terminator({ fillColor: '#000814', fillOpacity: 0.48, color: '#0a1020', weight: 0, interactive: false });
        term.addTo(map);
        window._dtpLfNight = setInterval(function () { try { term.setTime(new Date()); } catch (e) {} }, 60000);
      } catch (e) {}
    }

    function cityHtml(city, now) {
      var open = cityOpen(city, now);
      var t = now.toLocaleTimeString('en-GB', { timeZone: city.tz, hour: '2-digit', minute: '2-digit' });
      return '<div class="lf-city ' + (open ? 'lf-open' : 'lf-closed') + '"><span class="lf-dot"></span><b>' + t + '</b><span class="lf-name">' + city.name + '</span></div>';
    }
    function mkIcon(city, now) {
      return L.divIcon({ className: 'lf-city-wrap', html: cityHtml(city, now), iconSize: [0, 0], iconAnchor: [0, 0] });
    }
    CITIES.forEach(function (city) {
      city._lfm = L.marker([city.lat, city.lon], { icon: mkIcon(city, new Date()), interactive: false, keyboard: false }).addTo(map);
    });
    window._dtpLfClock = setInterval(function () {
      var now = new Date();
      CITIES.forEach(function (city) { if (city._lfm) city._lfm.setIcon(mkIcon(city, now)); });
    }, 30000);

    setTimeout(function () { try { map.invalidateSize(); } catch (e) {} }, 250);
    setTimeout(function () { try { map.invalidateSize(); } catch (e) {} }, 900);
  };
})();
