// Wo die Orte liegen:
//  - LocalBackend: nur in diesem Browser (localStorage)
//  - SharedBackend: gemeinsame Reise in Supabase; Zugriff nur mit dem geheimen Reise-Schlüssel,
//    der bei jeder Anfrage als Header "x-trip-key" mitgeht und von der Datenbank geprüft wird.
//
// Die App ändert zuerst ihren Zustand im Speicher und meldet die Änderung dann hier.

import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { loadLocalData, saveLocalData, readPref, writePref } from './store.js';

const SUPABASE_ESM = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
const TRIP_HASH = /(?:^#|&)reise=([a-f0-9]{32,128})/i;

export const sharingConfigured = () => Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

export function tripKeyFromUrl() {
  const m = location.hash.match(TRIP_HASH);
  return m ? m[1].toLowerCase() : null;
}
export const rememberedTripKey = () => readPref('trip');
export const rememberTripKey = (key) => writePref('trip', key);
export const forgetTripKey = () => writePref('trip', null);
export const shareUrl = (key) => `${location.origin}${location.pathname}#reise=${key}`;

export class LocalBackend {
  kind = 'local';

  constructor(getState) {
    this.getState = getState;
  }

  async load() {
    return loadLocalData();
  }

  #save() {
    if (!saveLocalData(this.getState())) throw new Error('Speichern im Browser nicht möglich');
  }

  async addPlaces() { this.#save(); }
  async updatePlace() { this.#save(); }
  async deletePlace() { this.#save(); }
  async deleteAllPlaces() { this.#save(); }
  async saveSettings() { this.#save(); }
}

// --- Supabase ------------------------------------------------------------------------

const PATCH_COLUMNS = { name: 'name', address: 'address', lat: 'lat', lng: 'lng', url: 'url', note: 'note', category: 'category', listName: 'list_name', glutenFree: 'gluten_free', reservation: 'reservation' };

const toRow = (p, key) => ({
  id: p.id,
  trip_key: key,
  name: p.name,
  address: p.address || '',
  lat: Number.isFinite(p.lat) ? p.lat : null,
  lng: Number.isFinite(p.lng) ? p.lng : null,
  url: p.url || '',
  note: p.note || '',
  list_name: p.listName || '',
  category: p.category,
  added_by: p.addedBy || '',
  created_at: new Date(p.addedAt || Date.now()).toISOString(),
  // Immer mitschicken: Bei einem Sammel-Insert füllt Supabase fehlende Felder einzelner Zeilen mit null
  // statt mit dem Standardwert – das verletzt „not null“, sobald nur manche Orte glutenfrei sind.
  gluten_free: !!p.glutenFree,
  // nur mitschicken, wenn gesetzt: die Spalte ist optional (null = nicht reserviert)
  ...(p.reservation ? { reservation: p.reservation } : {}),
});

const fromRow = (r) => ({
  id: r.id,
  name: r.name,
  address: r.address || '',
  lat: r.lat,
  lng: r.lng,
  url: r.url || '',
  note: r.note || '',
  listName: r.list_name || '',
  category: r.category,
  glutenFree: r.gluten_free === true,
  reservation: r.reservation && typeof r.reservation === 'object' ? r.reservation : null,
  addedBy: r.added_by || '',
  addedAt: Date.parse(r.created_at) || 0,
});

function check({ error }) {
  if (error) throw new Error(error.message || 'Unbekannter Datenbankfehler');
}

export class SharedBackend {
  kind = 'shared';

  static async connect(key) {
    if (!sharingConfigured()) throw new Error('Gemeinsame Reisen sind noch nicht eingerichtet (js/config.js).');
    const { createClient } = await import(SUPABASE_ESM);
    const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { 'x-trip-key': key } },
    });
    const backend = new SharedBackend(db, key);
    await backend.load(); // prüft Verbindung und Schlüssel
    return backend;
  }

  constructor(db, key) {
    this.db = db;
    this.key = key;
  }

  async load() {
    const [places, settings] = await Promise.all([
      this.db.from('places').select('*').eq('trip_key', this.key).order('created_at'),
      this.db.from('trip_settings').select('*').eq('trip_key', this.key).maybeSingle(),
    ]);
    check(places);
    check(settings);
    return {
      places: places.data.map(fromRow),
      airbnb: settings.data?.airbnb ?? null,
      customCategories: settings.data?.custom_categories ?? [],
    };
  }

  async addPlaces(places) {
    for (let i = 0; i < places.length; i += 500) {
      check(await this.db.from('places').insert(places.slice(i, i + 500).map((p) => toRow(p, this.key))));
    }
  }

  async updatePlace(id, patch) {
    const row = { updated_at: new Date().toISOString() };
    for (const [k, v] of Object.entries(patch)) if (PATCH_COLUMNS[k]) row[PATCH_COLUMNS[k]] = v;
    check(await this.db.from('places').update(row).eq('id', id).eq('trip_key', this.key));
  }

  async deletePlace(id) {
    check(await this.db.from('places').delete().eq('id', id).eq('trip_key', this.key));
  }

  async deleteAllPlaces() {
    check(await this.db.from('places').delete().eq('trip_key', this.key));
  }

  async saveSettings({ airbnb, customCategories }) {
    check(await this.db.from('trip_settings').upsert(
      { trip_key: this.key, airbnb, custom_categories: customCategories, updated_at: new Date().toISOString() },
      { onConflict: 'trip_key' },
    ));
  }
}
