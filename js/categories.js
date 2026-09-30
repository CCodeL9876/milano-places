// Standard-Kategorien (Symbol-Namen siehe icons.js). color = Fläche (Marker, gewählter Filter),
// ink = dunklerer Ton für Symbole und Beschriftung auf hellem Grund. Reihenfolge = Priorität bei der automatischen Erkennung:
// die erste Kategorie, deren Stichwort im Namen/in der Notiz vorkommt, gewinnt.
export const DEFAULT_CATEGORIES = [
  {
    id: 'kaffee', label: 'Kaffee', icon: 'coffee', color: '#FF8A4C', ink: '#A8430E',
    keywords: ['café', 'cafe', 'caffè', 'caffe', 'coffee', 'kaffee', 'espresso', 'roaster', 'torrefazione'],
  },
  {
    id: 'suess', label: 'Bäckerei & Süsses', icon: 'ice-cream', color: '#FFD23F', ink: '#7A5A00',
    keywords: ['gelateria', 'gelato', 'pasticceria', 'panetteria', 'panificio', 'forno', 'bakery', 'bäckerei',
      'desserterie', 'dolci', 'cioccolat'],
  },
  {
    id: 'essen', label: 'Essen', icon: 'utensils', color: '#FF9FB4', ink: '#B02A55',
    keywords: ['ristorante', 'restaurant', 'trattoria', 'osteria', 'pizzeria', 'pizza', 'pasta', 'bistrot',
      'bistro', 'paninoteca', 'panino', 'gyoza', 'sushi', 'steakhouse', 'focacceria', 'schiacciata'],
  },
  {
    id: 'bar', label: 'Bar & Drinks', icon: 'wine', color: '#B6A4FF', ink: '#5B3FC4',
    keywords: ['bar ', ' bar', 'cocktail', 'wine bar', 'enoteca', 'aperitivo', 'liquor', 'rooftop', 'drinks'],
  },
  {
    id: 'sehen', label: 'Sehenswert', icon: 'landmark', color: '#69D5B5', ink: '#1D7A5F',
    keywords: ['duomo', 'basilica', 'chiesa', 'church', 'kirche', 'museo', 'museum', 'castello', 'castle',
      'palazzo', 'galleria d', 'pinacoteca', 'cimitero', 'arco', 'colonne', 'parco', 'piazza'],
  },
  {
    id: 'shopping', label: 'Shopping', icon: 'bag', color: '#8FD0FF', ink: '#1F6AA5',
    keywords: ['store', 'shop', 'boutique', 'mercato', 'market', 'markt', 'outlet', 'concept store'],
  },
  { id: 'sonstiges', label: 'Sonstiges', icon: 'pin', color: '#D9D2C5', ink: '#5D5663', keywords: [] },
];

export const FALLBACK_CATEGORY = 'sonstiges';

const normalize = (s) => ` ${String(s || '').toLowerCase().normalize('NFC')} `;

// Findet eine Kategorie über den Namen einer Liste/Datei (z. B. "Kaffee.csv", "Essen Milano").
export function categoryFromHint(hint, categories) {
  if (!hint) return null;
  const h = normalize(hint);
  for (const c of categories) {
    if (c.id === FALLBACK_CATEGORY) continue;
    if (h.includes(c.label.toLowerCase()) || h.includes(c.id)) return c.id;
  }
  return classify(hint, categories, null);
}

// Rät die Kategorie anhand von Stichwörtern. Google exportiert keine Orts-Typen,
// daher ist das eine Heuristik – die Kategorie lässt sich in der Liste jederzeit ändern.
export function classify(text, categories, fallback = FALLBACK_CATEGORY) {
  const t = normalize(text);
  for (const c of categories) {
    if ((c.keywords || []).some((k) => t.includes(k.toLowerCase()))) return c.id;
  }
  return fallback;
}
