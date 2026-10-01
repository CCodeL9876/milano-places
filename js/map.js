// Leaflet-Karte: Orts-Marker, Airbnb-Marker, Radius-Kreis, Live-Standort und Mailänder Viertel.
/* global L */

import { hasCoords, formatKm, formatReservation, routeUrl, homeRouteUrl } from './geo.js';
import { icon, categoryIcon, categoryStyle } from './icons.js';

export const CITY = { center: [45.4642, 9.19], zoom: 13 };

// Kartenkacheln von OpenStreetMap: kein API-Key nötig. Die Farbanpassung kommt per CSS-Filter
// (.leaflet-tile-pane in styles.css) – dort werden sie zurückgenommen, damit Orange und Grün leuchten. CARTO-Kacheln verlangen inzwischen einen API-Key.
const TILES = {
  url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-Mitwirkende',
  maxZoom: 19,
};

// Nur http(s)-Links in href übernehmen – nie javascript: o. Ä. aus der Datenbank
export const safeHttpUrl = (u) => (/^https?:\/\//i.test(u || '') ? u : '');

export const escapeHtml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Popup-Inhalte – gemeinsam für die OpenStreetMap-Karte (hier) und die Google-Test-Variante (map-google.js)
export function airbnbPopupHtml(airbnb) {
  return `
    <div class="popup">
      <span class="popup-cat" style="--c:#FFD23F;--ci:#16131A">Unser Airbnb</span>
      <strong class="popup-name">${escapeHtml(airbnb.label)}</strong>
      <a class="popup-link" href="${escapeHtml(homeRouteUrl(airbnb))}" target="_blank" rel="noopener">${icon('navigation', { size: 13, stroke: 2.2 })} Route zur Unterkunft ↗</a>
    </div>`;
}

export function popupHtml(p, cat) {
  const dist = p.distance != null ? `<span class="popup-dist">${formatKm(p.distance)} von der Unterkunft</span>` : '';
  return `
    <div class="popup">
      <span class="popup-cat" style="${categoryStyle(cat)}">${escapeHtml(cat.label)}</span>
      <strong class="popup-name">${escapeHtml(p.name)}</strong>
      ${p.address ? `<span class="popup-addr">${escapeHtml(p.address)}</span>` : ''}
      ${p.visited ? `<span class="popup-visited">${icon('check', { size: 13, stroke: 2.6 })} Besucht</span>` : ''}
      ${p.reservation ? `<span class="popup-res">${icon('calendar-check', { size: 13, stroke: 2 })} ${escapeHtml(formatReservation(p.reservation))}</span>` : ''}
      ${p.glutenFree ? `<span class="popup-gf">${icon('wheat-off', { size: 13, stroke: 2 })} Glutenfrei</span>` : ''}
      ${dist}
      <a class="popup-link" href="${escapeHtml(routeUrl(p))}" target="_blank" rel="noopener">${icon('navigation', { size: 13, stroke: 2.2 })} Route in Google Maps ↗</a>
    </div>`;
}

// Ersatz, falls Leaflet nicht geladen werden konnte: Die App läuft ohne Karte weiter,
// statt beim Start komplett abzubrechen (dann fehlte auch die Ortsliste).
function createFallbackMap(el) {
  el.innerHTML = '<div class="map-error"><strong>Karte nicht verfügbar</strong><span>Die Kartenbibliothek konnte nicht geladen werden. Liste und Filter funktionieren trotzdem – Seite neu laden versuchen.</span></div>';
  const noop = () => {};
  const fakeMap = { flyTo: noop, getZoom: () => 9, setView: noop, fitBounds: noop };
  return { map: fakeMap, setPlaces: noop, setAirbnb: noop, setActive: noop, focusPlace: noop, fitTo: noop, centerOn: noop, invalidate: noop };
}

export function createMap(el, { onMapClick, onMarkerClick, getInsets, onLocateMessage }) {
  if (typeof L === 'undefined') return createFallbackMap(el);
  const map = L.map(el, { zoomControl: false, attributionControl: true }).setView(CITY.center, CITY.zoom);
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  L.tileLayer(TILES.url, { attribution: TILES.attribution, maxZoom: TILES.maxZoom }).addTo(map);

  const placeLayer = L.layerGroup().addTo(map);
  const markers = new Map();
  let airbnbMarker = null;
  let activeId = null;

  map.on('click', (e) => onMapClick?.(e.latlng));

  // Seitenleiste, Boxen-Zeile und (auf dem Handy) die Liste unten liegen über der Karte. getInsets
  // liefert, wie viele Pixel davon an jedem Rand verdeckt sind, damit Orte und Routen in der Mitte
  // des sichtbaren Kartenteils landen statt darunter.
  const insets = () => ({ top: 0, right: 0, bottom: 0, left: 0, ...(getInsets?.() || {}) });

  function centerOn(latlng, zoom, { animate = true } = {}) {
    const { top, right, bottom, left } = insets();
    const target = map.unproject(
      map.project(latlng, zoom).subtract([(left - right) / 2, (top - bottom) / 2]),
      zoom,
    );
    if (animate) map.flyTo(target, zoom, { duration: 0.6 });
    else map.setView(target, zoom);
  }

  // --- Live-Standort --------------------------------------------------------------------------
  // Knopf über den Zoom-Knöpfen. 1. Tipp: Standort verfolgen, die Karte läuft beim Gehen mit.
  // Verschiebt man die Karte selbst, hört das Mitlaufen auf; ein Tipp springt dann zurück und
  // läuft wieder mit. Tipp, wenn der Standort schon in der Mitte ist: ausschalten.
  // Die Position bleibt im Browser – sie wird weder gespeichert noch an die Datenbank geschickt.
  let locating = false;
  let firstFix = false;
  let following = false;
  let meLatLng = null;
  let meMarker = null;
  let meCircle = null;
  let locateBtn = null;

  const setLocateState = (state) => {
    if (!locateBtn) return;
    locateBtn.classList.toggle('is-waiting', state === 'waiting');
    locateBtn.setAttribute('aria-pressed', String(state !== 'off'));
    locateBtn.title = state === 'off' ? 'Mein Standort' : 'Standort: nochmals tippen zum Zentrieren bzw. Ausschalten';
  };

  function stopLocate() {
    locating = false;
    following = false;
    meLatLng = null;
    map.stopLocate();
    meMarker?.remove();
    meCircle?.remove();
    meMarker = meCircle = null;
    setLocateState('off');
  }

  function meIsCentered() {
    if (!meLatLng) return false;
    const { top, right, bottom, left } = insets();
    const size = map.getSize();
    const mid = L.point((left + size.x - right) / 2, (top + size.y - bottom) / 2);
    return map.latLngToContainerPoint(meLatLng).distanceTo(mid) < 40;
  }

  function toggleLocate() {
    if (!locating) {
      if (!navigator.geolocation) return onLocateMessage?.('unsupported');
      locating = true;
      firstFix = true;
      setLocateState('waiting');
      map.locate({ watch: true, enableHighAccuracy: true, setView: false, maximumAge: 10000, timeout: 20000 });
      return;
    }
    if (meLatLng && (!following || !meIsCentered())) {
      following = true;
      return centerOn(meLatLng, Math.max(map.getZoom(), 16));
    }
    stopLocate();
  }

  map.on('locationfound', (e) => {
    if (!locating) return;
    meLatLng = e.latlng;
    if (!meMarker) {
      meCircle = L.circle(e.latlng, { radius: e.accuracy, className: 'me-accuracy', interactive: false }).addTo(map);
      meMarker = L.marker(e.latlng, {
        icon: L.divIcon({ className: '', html: '<div class="me-dot"></div>', iconSize: [22, 22], iconAnchor: [11, 11] }),
        interactive: false, keyboard: false, zIndexOffset: 2000,
      }).addTo(map);
    } else {
      meMarker.setLatLng(e.latlng);
      meCircle.setLatLng(e.latlng).setRadius(e.accuracy);
    }
    if (firstFix) {
      firstFix = false;
      following = true;
      setLocateState('on');
      centerOn(e.latlng, Math.max(map.getZoom(), 16));
    } else if (following && !meIsCentered()) {
      centerOn(e.latlng, map.getZoom());
    }
  });
  // Selbst verschoben → nicht mehr mitlaufen (bis zum nächsten Tipp auf den Knopf)
  map.on('dragstart', () => { following = false; });

  map.on('locationerror', (e) => {
    if (!locating) return;
    // Bei laufender Verfolgung kurze Aussetzer (z. B. im Tunnel) ignorieren – nur beim Start melden
    if (!firstFix && meLatLng && e.code !== 1) return;
    stopLocate();
    onLocateMessage?.(e.code === 1 ? 'denied' : 'unavailable', e.message);
  });

  const LocateControl = L.Control.extend({
    options: { position: 'bottomright' },
    onAdd() {
      locateBtn = L.DomUtil.create('button', 'locate-btn');
      locateBtn.type = 'button';
      locateBtn.setAttribute('aria-label', 'Mein Standort');
      locateBtn.innerHTML = icon('locate', { size: 20, stroke: 2.2 });
      setLocateState('off');
      L.DomEvent.disableClickPropagation(locateBtn);
      L.DomEvent.on(locateBtn, 'click', toggleLocate);
      return locateBtn;
    },
  });
  // Unten rechts stapelt Leaflet neue Knöpfe über die bestehenden: Standort liegt also über dem Zoom
  new LocateControl().addTo(map);

  // --- Viertel (NIL) -------------------------------------------------------------------------
  // Die 88 Mailänder Viertel als dezente Flächen mit Namen – zur Orientierung. Daten: data/quartieri.geojson
  // (Comune di Milano, vereinfacht). Namen ab Zoom 13 kurz, ab Zoom 15 vollständig. Knopf über dem Standort.
  const QUARTER_COLORS = ['#FF9FB4', '#69D5B5', '#FFD23F', '#B6A4FF', '#8FD0FF', '#FF8A4C'];
  const QUARTER_PREF = 'milano.quarters';
  const quarterLayer = L.layerGroup();
  const quarterLabels = L.layerGroup();
  let quartersLoaded = false;
  let quartersBtn = null;
  const quartersWanted = () => { try { return localStorage.getItem(QUARTER_PREF) !== 'off'; } catch { return true; } };

  // Schwerpunkt des grössten Rings – genügt für die Beschriftung
  function labelPoint(geometry) {
    const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    let best = null;
    for (const poly of polys) {
      const r = poly[0];
      let a = 0, cx = 0, cy = 0;
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        const f = r[j][0] * r[i][1] - r[i][0] * r[j][1];
        a += f; cx += (r[j][0] + r[i][0]) * f; cy += (r[j][1] + r[i][1]) * f;
      }
      if (a && (!best || Math.abs(a) > best.a)) best = { a: Math.abs(a), lat: cy / (3 * a), lng: cx / (3 * a) };
    }
    return best && [best.lat, best.lng];
  }

  async function loadQuarters() {
    if (quartersLoaded) return;
    quartersLoaded = true;
    try {
      const data = await (await fetch('data/quartieri.geojson')).json();
      L.geoJSON(data, {
        interactive: false,
        attribution: 'Viertel: <a href="https://dati.comune.milano.it/dataset/ds964-nil-vigenti-pgt-2030" target="_blank" rel="noopener">Comune di Milano</a> (CC BY 4.0)',
        style: (f) => ({
          className: 'quarter-area',
          color: '#16131A', weight: 1, opacity: 0.4, dashArray: '3 4',
          fillColor: QUARTER_COLORS[f.properties.id % QUARTER_COLORS.length], fillOpacity: 0.1,
        }),
      }).addTo(quarterLayer);
      for (const f of data.features) {
        const at = labelPoint(f.geometry);
        if (!at) continue;
        const [short, ...rest] = String(f.properties.name).split(' · ');
        const html = `<span class="quarter-name">${escapeHtml(short)}${rest.length ? `<span class="quarter-rest"> · ${escapeHtml(rest.join(' · '))}</span>` : ''}</span>`;
        L.marker(at, {
          icon: L.divIcon({ className: 'quarter-label', html, iconSize: [140, 40], iconAnchor: [70, 20] }),
          interactive: false, keyboard: false, zIndexOffset: -1000,
        }).addTo(quarterLabels);
      }
    } catch (err) {
      quartersLoaded = false;
      console.warn('Viertel konnten nicht geladen werden:', err);
    }
  }

  function updateQuarterZoom() {
    const z = map.getZoom();
    el.classList.toggle('quarters-no-labels', z < 13);
    el.classList.toggle('quarters-short', z < 15);
  }

  function setQuarters(on) {
    try { localStorage.setItem(QUARTER_PREF, on ? 'on' : 'off'); } catch { /* privates Fenster */ }
    quartersBtn?.setAttribute('aria-pressed', String(on));
    if (on) {
      loadQuarters();
      quarterLayer.addTo(map);
      quarterLabels.addTo(map);
    } else {
      quarterLayer.remove();
      quarterLabels.remove();
    }
  }

  const QuartersControl = L.Control.extend({
    options: { position: 'bottomright' },
    onAdd() {
      quartersBtn = L.DomUtil.create('button', 'locate-btn quarters-btn');
      quartersBtn.type = 'button';
      quartersBtn.title = 'Viertel ein-/ausblenden';
      quartersBtn.setAttribute('aria-label', 'Viertel anzeigen');
      quartersBtn.innerHTML = icon('layers', { size: 20, stroke: 2.1 });
      L.DomEvent.disableClickPropagation(quartersBtn);
      L.DomEvent.on(quartersBtn, 'click', () => setQuarters(quartersBtn.getAttribute('aria-pressed') !== 'true'));
      return quartersBtn;
    },
  });
  new QuartersControl().addTo(map);
  map.on('zoomend', updateQuarterZoom);
  updateQuarterZoom();
  setQuarters(quartersWanted());

  function fitPoints(pts, maxZoom) {
    const { top, right, bottom, left } = insets();
    map.fitBounds(pts, {
      paddingTopLeft: [left + 40, top + 40],
      paddingBottomRight: [right + 40, bottom + 40],
      maxZoom,
    });
  }

  function placeIcon(cat, active, reserved, visited) {
    return L.divIcon({
      className: '',
      html: `<div class="pin${active ? ' is-active' : ''}${reserved ? ' is-reserved' : ''}${visited ? ' is-visited' : ''}" style="${categoryStyle(cat)}">${categoryIcon(cat, { size: 14, stroke: 2.3 })}</div>`,
      iconSize: [30, 30],
      iconAnchor: [15, 15],
      popupAnchor: [0, -20],
    });
  }


  function setPlaces(places, catOf, currentId) {
    activeId = currentId;
    placeLayer.clearLayers();
    markers.clear();
    for (const p of places) {
      if (!hasCoords(p)) continue;
      const cat = catOf(p.category);
      const m = L.marker([p.lat, p.lng], {
        icon: placeIcon(cat, p.id === currentId, !!p.reservation, !!p.visited),
        title: p.name,
        zIndexOffset: p.id === currentId ? 1000 : 0,
        riseOnHover: true,
      });
      m.bindPopup(popupHtml(p, cat), { closeButton: false, className: 'llocs-popup' });
      m.on('click', () => onMarkerClick?.(p.id));
      m.addTo(placeLayer);
      markers.set(p.id, { marker: m, cat, reserved: !!p.reservation, visited: !!p.visited });
    }
  }

  function setAirbnb(airbnb) {
    if (airbnbMarker) airbnbMarker.remove();
    airbnbMarker = null;
    if (!airbnb) return;

    airbnbMarker = L.marker([airbnb.lat, airbnb.lng], {
      icon: L.divIcon({
        className: '',
        html: `<div class="home-pin" title="Unser Airbnb">${icon('home', { size: 15, stroke: 2.2 })}</div>`,
        iconSize: [32, 38],
        iconAnchor: [16, 38],
        popupAnchor: [0, -38],
      }),
      zIndexOffset: 2000,
      keyboard: false,
    })
      .bindPopup(airbnbPopupHtml(airbnb), { closeButton: false, className: 'llocs-popup' })
      .addTo(map);
  }

  // Hebt einen Marker hervor, ohne alle Marker neu zu zeichnen (offene Popups bleiben offen).
  function setActive(id) {
    for (const key of [activeId, id]) {
      const entry = markers.get(key);
      if (!entry) continue;
      const on = key === id;
      entry.marker.setIcon(placeIcon(entry.cat, on, entry.reserved, entry.visited));
      entry.marker.setZIndexOffset(on ? 1000 : 0);
    }
    activeId = id;
  }

  function focusPlace(id) {
    const m = markers.get(id)?.marker;
    if (!m) return;
    setActive(id);
    centerOn(m.getLatLng(), Math.max(map.getZoom(), 13));
    m.openPopup();
  }

  function fitTo(places, airbnb) {
    const pts = places.filter(hasCoords).map((p) => [p.lat, p.lng]);
    if (airbnb) pts.push([airbnb.lat, airbnb.lng]);
    if (!pts.length) return map.setView(CITY.center, CITY.zoom);
    if (pts.length === 1) return centerOn(pts[0], 13, { animate: false });
    fitPoints(pts, 14);
  }


  return { map, setPlaces, setAirbnb, setActive, focusPlace, fitTo, centerOn, locate: () => { if (!locating) toggleLocate(); }, invalidate: () => map.invalidateSize() };
}
