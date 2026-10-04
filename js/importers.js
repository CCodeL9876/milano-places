// Parser für die verschiedenen Exportformate von Google Maps.
//
// Unterstützt:
//  - Google Takeout "Maps (Meine Orte)": Gespeicherte Orte.json / Saved Places.json (GeoJSON, neues + altes Format)
//  - Google Takeout "Gespeichert": eine CSV pro Liste (Title, Note, URL, …) – meist ohne Koordinaten
//  - KML aus Google My Maps (Ordnername dient als Kategorie-Hinweis)
//  - eigene CSVs mit Spalten wie name/lat/lng/category
//  - Backups dieser App
//  - eingefügter Text: ein Google-Maps-Link oder "lat, lng" pro Zeile

import { parseCoords, nameFromUrl } from './geo.js';
import { classify, categoryFromHint, FALLBACK_CATEGORY } from './categories.js';

// Ergebnis jedes Parsers: Liste von Roh-Orten
// { name, address, lat, lng, url, note, category?, listName }

export function parseFile(fileName, text) {
  const listName = fileName.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
  const ext = (fileName.split('.').pop() || '').toLowerCase();
  const trimmed = text.trim();

  if (ext === 'kml' || trimmed.startsWith('<?xml') || trimmed.startsWith('<kml')) {
    return { kind: 'kml', places: parseKML(trimmed, listName) };
  }
  if (ext === 'json' || ext === 'geojson' || trimmed.startsWith('{') || trimmed.startsWith('[')) {
    const data = JSON.parse(trimmed);
    if (data && data.app === 'llocs') return { kind: 'backup', backup: data, places: data.places || [] };
    return { kind: 'geojson', places: parseGeoJSON(data, listName) };
  }
  if (ext === 'csv' || ext === 'tsv') {
    return { kind: 'csv', places: parseCSVPlaces(trimmed, listName) };
  }
  return { kind: 'links', places: parseLinks(trimmed, listName) };
}

// --- GeoJSON (Takeout) --------------------------------------------------------

export function parseGeoJSON(data, listName = '') {
  const features = Array.isArray(data) ? data : data.features || [];
  return features.map((f) => {
    const p = f.properties || {};
    const loc = p.location || p.Location || {};
    const url = p.google_maps_url || p['Google Maps URL'] || p.url || '';
    const name = loc.name || loc['Business Name'] || p.Title || p.name || nameFromUrl(url) || loc.address || loc.Address || 'Unbenannter Ort';
    const address = loc.address || loc.Address || '';

    let lat = null;
    let lng = null;
    const coords = f.geometry && f.geometry.coordinates;
    if (Array.isArray(coords) && coords.length >= 2 && !(coords[0] === 0 && coords[1] === 0)) {
      [lng, lat] = coords.map(Number);
    } else if (loc['Geo Coordinates']) {
      lat = Number(loc['Geo Coordinates'].Latitude);
      lng = Number(loc['Geo Coordinates'].Longitude);
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      const c = parseCoords(url);
      lat = c ? c.lat : null;
      lng = c ? c.lng : null;
    }

    return { name, address, lat, lng, url, note: p.Comment || p.comment || p.description || '', listName };
  });
}

// --- CSV ------------------------------------------------------------------------

export function parseCSV(text) {
  const delimiter = detectDelimiter(text);
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

function detectDelimiter(text) {
  const firstLine = text.split(/\r?\n/, 1)[0];
  const counts = [',', ';', '\t'].map((d) => [d, firstLine.split(d).length]);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][0];
}

const COLUMN_ALIASES = {
  name: ['title', 'titel', 'name', 'ort', 'place'],
  note: ['note', 'notiz', 'notes', 'comment', 'kommentar', 'beschreibung', 'description'],
  url: ['url', 'link', 'google maps url', 'maps url'],
  address: ['address', 'adresse', 'anschrift'],
  lat: ['lat', 'latitude', 'breite', 'breitengrad'],
  lng: ['lng', 'lon', 'long', 'longitude', 'länge', 'laengengrad', 'längengrad'],
  category: ['category', 'kategorie', 'art', 'type', 'typ', 'tags'],
};

export function parseCSVPlaces(text, listName = '') {
  const rows = parseCSV(text.replace(/^﻿/, ''));
  if (rows.length < 2) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = {};
  for (const [key, aliases] of Object.entries(COLUMN_ALIASES)) {
    const idx = header.findIndex((h) => aliases.includes(h));
    if (idx >= 0) col[key] = idx;
  }
  const get = (r, key) => (col[key] != null ? (r[col[key]] || '').trim() : '');

  return rows.slice(1).map((r) => {
    const url = get(r, 'url');
    let lat = parseFloat(get(r, 'lat').replace(',', '.'));
    let lng = parseFloat(get(r, 'lng').replace(',', '.'));
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      const c = parseCoords(url);
      lat = c ? c.lat : null;
      lng = c ? c.lng : null;
    }
    const name = get(r, 'name') || nameFromUrl(url) || get(r, 'address') || 'Unbenannter Ort';
    return {
      name,
      address: get(r, 'address'),
      lat,
      lng,
      url,
      note: get(r, 'note'),
      categoryHint: get(r, 'category'),
      listName,
    };
  }).filter((p) => p.name || p.url);
}

// --- KML (Google My Maps) ------------------------------------------------------

export function parseKML(text, listName = '') {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('KML-Datei konnte nicht gelesen werden.');
  const out = [];
  for (const pm of doc.getElementsByTagName('Placemark')) {
    const point = pm.getElementsByTagName('Point')[0];
    if (!point) continue; // Linien/Flächen (z. B. Radrouten) ignorieren
    const coordText = (point.getElementsByTagName('coordinates')[0]?.textContent || '').trim();
    const [lng, lat] = coordText.split(',').map(Number);
    const folder = pm.parentElement?.tagName === 'Folder'
      ? pm.parentElement.getElementsByTagName('name')[0]?.textContent
      : '';
    const text = (tag) => pm.getElementsByTagName(tag)[0]?.textContent?.trim() || '';
    out.push({
      name: text('name') || 'Unbenannter Ort',
      address: text('address'),
      lat: Number.isFinite(lat) ? lat : null,
      lng: Number.isFinite(lng) ? lng : null,
      url: '',
      note: text('description').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
      listName: folder || listName,
    });
  }
  return out;
}

// --- Eingefügte Links / Koordinaten -------------------------------------------

const TRAILING_COORDS = /(-?\d{1,2}\.\d{2,})\s*[,;]\s*(-?\d{1,3}\.\d{2,})\s*$/;

export function parseLinks(text, listName = '') {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  // Geteilter Text aus der Google-Maps-App: „Name“, „Adresse“ und Link auf eigenen Zeilen ergeben einen Ort.
  // Textzeilen ohne Link (und ohne Koordinaten) gehören daher zum nächsten Link; nur wenn Links vorkommen.
  const hasUrls = lines.some((l) => /https?:\/\/\S+/.test(l));
  const entries = [];
  let pending = [];
  for (const line of lines) {
    if (hasUrls && !/https?:\/\/\S+/.test(line) && !parseCoords(line)) {
      pending.push(line);
      continue;
    }
    entries.push({ line, extra: pending });
    pending = [];
  }
  pending.forEach((line) => entries.push({ line, extra: [] }));
  return entries
    .map(({ line, extra }) => {
      const urlMatch = line.match(/https?:\/\/\S+/);
      const url = urlMatch ? urlMatch[0] : '';
      let label = line.replace(url, '');
      let c = parseCoords(url || line);
      // "Name | 39.8283, 2.8303": Koordinaten am Zeilenende
      const trailing = !c && label.match(TRAILING_COORDS);
      if (trailing) {
        c = parseCoords(`${trailing[1]}, ${trailing[2]}`);
        label = label.replace(TRAILING_COORDS, '');
      }
      label = label.replace(/[\s|–,;-]+$/, '').trim();
      const labelIsCoords = !!parseCoords(label);
      if (!label && extra.length) label = extra[0];
      return {
        name: (!labelIsCoords && label) || nameFromUrl(url) || (c ? `Pin ${c.lat.toFixed(4)}, ${c.lng.toFixed(4)}` : line),
        address: extra.slice(1).join(', ').slice(0, 500),
        lat: c ? c.lat : null,
        lng: c ? c.lng : null,
        url,
        note: '',
        listName,
      };
    });
}

// --- Kategorie zuweisen -----------------------------------------------------------

// override: 'auto' oder eine Kategorie-ID aus dem Import-Dialog
export function assignCategory(raw, categories, override = 'auto') {
  const ids = new Set(categories.map((c) => c.id));
  if (override && override !== 'auto' && ids.has(override)) return override;
  if (raw.category && ids.has(raw.category)) return raw.category;
  // Der Name ist das stärkste Signal; Notizen erwähnen oft Nebensachen ("Café im Innenhof").
  return (
    classify(raw.name, categories, null) ||
    categoryFromHint(raw.categoryHint, categories) ||
    categoryFromHint(raw.listName, categories) ||
    classify(raw.note || '', categories, null) ||
    FALLBACK_CATEGORY
  );
}
