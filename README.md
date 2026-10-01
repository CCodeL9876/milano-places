# Milano, Espressi, Negroni e Mama Mia!

Kopie der Mallorca-App (`mallorca-places`), angepasst an Mailand: eigene Kategorien, Kartenmitte Mailand,
eigener Browser-Speicher (Präfix `milano.`), keine Beispielorte.

Web-App, die gespeicherte Google-Maps-Orte auf einer Karte und in einer Liste zeigt – filterbar nach Art des Orts
(Kaffee, Essen, Bar, Bäckerei & Süsses, Sehenswert, Shopping), sortierbar nach Entfernung zur Unterkunft.
Design „Memphis Milano“ nach der Mailänder Designgruppe Memphis: Pastellflächen (Gelb, Rosa, Mint, Flieder, Himmelblau),
dicke schwarze Konturen, harte versetzte Schatten, Kreise und Zickzack-Kanten; Überschriften in Bricolage Grotesque,
Text in Instrument Sans.

Reines HTML/CSS/JS (ES-Module), kein Build-Schritt, keine Installation.
Karte: [Leaflet](https://leafletjs.com) mit OpenStreetMap-Kacheln (per CSS-Filter zurückgenommen); Adresssuche über OpenStreetMap (Nominatim, bei Fehlern automatisch Photon) – kein API-Key nötig.

## Starten

ES-Module laden nicht über `file://`, daher einen lokalen Server starten:

```sh
cd milano-places
python3 serve.py
```

`serve.py` ist ein kleiner Server ohne Browser-Cache – so lädt Safari nie alte Dateien.
(`python3 -m http.server 5173` geht auch, dann nach Änderungen in Safari mit **Cmd+Option+R** neu laden.)

Dann <http://localhost:5173> öffnen. (Mit Node geht auch `npm start`.)
Die Orte aus der Milano-Seite liegen als `milano-import.json` im Projektordner (nicht auf GitHub, siehe `.gitignore`):
im Import-Dialog hineinziehen. Die Unterkunft wird mit übernommen.

## Funktionen

- **Import** per Drag & Drop: Takeout-`Gespeicherte Orte.json`, Listen-CSVs, KML aus My Maps, eigene CSVs
  (Spalten `name`, `lat`, `lng`, `category` …), Llocs-Backups – oder Google-Maps-Links einfügen.
- **Automatische Kategorie** über Stichwörter im Namen bzw. über den Listennamen (`Kaffee.csv` → Kaffee).
  Google exportiert keine Orts-Typen, daher lässt sich die Kategorie pro Ort in der Liste ändern.
- **Fehlende Standorte** (typisch bei Listen-CSVs) werden über OpenStreetMap gesucht (1 Anfrage/Sekunde).
- **Airbnb** per Adresse, Maps-Link, Koordinaten oder Klick auf die Karte setzen; optional „Links
  hinzufügen“ für das Airbnb-Inserat und einen Google-Maps-Link. Wird in der Datenbank gespeichert,
  nie im Quellcode (siehe `js/config.js`).
- **Reservierungen** für Restaurants (Kategorie Essen) mit Datum und Uhrzeit; Filter „Reserviert“ sortiert nach Termin.
- **Reisekasse** (Box „Kasse“ neben der Unterkunft): Teilnehmende eintragen, Rechnungen mit Betrag, Datum,
  „Bezahlt von“ und „Für wen“ erfassen. Der Betrag wird gleichmässig aufgeteilt; die Abrechnung zeigt pro Person
  Bezahlt, Anteil und Saldo sowie die kürzeste Liste an Ausgleichszahlungen. Rechenlogik in `js/cash.js`.
- **Filter**: Kategorie-Chips (Mehrfachauswahl), Volltextsuche, Sortierung nach Entfernung/Name/Art/Datum.
- **Eigene Kategorien** mit Emoji, Farbe und Stichwörtern (Standard-Kategorien nutzen Linien-Symbole) (Menü `•••` → „Kategorien verwalten“).
- **Gemeinsame Reise**: Über „Teilen“ werden die Orte in eine Supabase-Datenbank hochgeladen; alle mit dem
  geheimen Reise-Link sehen dieselbe Liste und können mitplanen (Abgleich alle 20 s). Einrichtung: [ANLEITUNG.md](ANLEITUNG.md).
- Ohne gemeinsame Reise bleiben die Daten lokal im Browser (`localStorage`); Backup als JSON über das Menü.

## Projektstruktur

```
milano-places/
├── index.html               Grundgerüst: Kopfzeile, Seitenleiste, Karte, Dialoge
├── ANLEITUNG.md             Online stellen (GitHub Pages) + gemeinsame Datenbank (Supabase)
├── manifest.webmanifest     „Zum Home-Bildschirm“ auf dem iPhone
├── css/styles.css           Design „Memphis Milano“, responsive (Karte randlos; Desktop: Seitenleiste schwebt links darüber; Handy: Liste als ziehbares Blatt von unten)
├── js/
│   ├── app.js               Zustand, Filter, Rendering, Import-Ablauf, Dialoge, Teilen
│   ├── backend.js           Speicher: lokal im Browser oder gemeinsame Reise in Supabase
│   ├── config.js            Supabase-URL und öffentlicher Key (leer = nur lokal); Unterkunft NICHT hier eintragen (öffentlich auf GitHub)
│   ├── cash.js              Reisekasse: Beträge in Cent, Aufteilung, Salden, Ausgleich
│   ├── categories.js        Standard-Kategorien + Stichwort-Erkennung
│   ├── icons.js             Linien-Symbole für Kategorien und Bedienelemente
│   ├── importers.js         Parser für GeoJSON, CSV, KML, Links; Kategorie-Zuordnung
│   ├── geo.js               Distanz, Koordinaten aus Maps-Links, Geocoding
│   ├── map.js               Leaflet-Karte, Marker, Airbnb-Marker
│   ├── map-google.js        Test-Variante mit Google Maps (Google-Orte antippen & übernehmen), siehe ANLEITUNG.md
│   └── store.js             localStorage, Backup-Download, IDs und Reise-Schlüssel
├── milano-import.json       Orte aus der Milano-Seite als Backup-Datei zum Importieren (nur lokal)
├── serve.py                 lokaler Testserver ohne Browser-Cache
├── deploy.sh                ein Befehl: Version erhöhen, committen, zu GitHub hochladen
├── vendor/leaflet/          Kartenbibliothek Leaflet 1.9.4 (lokal, kein CDN nötig)
├── supabase/schema.sql      Tabellen + Zugriffsregeln (nur mit Reise-Schlüssel)
└── assets/                  Favicon und App-Symbole
```

## Orte aus Google Maps exportieren

1. <https://takeout.google.com> öffnen, „Alle abwählen“.
2. **„Maps (Meine Orte)“** (→ `Gespeicherte Orte.json`) und **„Gespeichert“** (→ eine CSV pro Liste) auswählen.
3. Export herunterladen, entpacken und die Dateien in der App importieren.

Hinweise:
- Kurzlinks (`maps.app.goo.gl/…`) enthalten keine Koordinaten – einmal im Browser öffnen und den langen Link kopieren.
- KMZ-Dateien aus My Maps vorher entpacken (enthalten eine `doc.kml`) oder in My Maps „Als KML exportieren“ wählen.

## Mögliche nächste Schritte

- Mehrere Unterkünfte (z. B. für verschiedene Reisen) speichern und umschalten
- Marker-Clustering bei sehr vielen Orten
