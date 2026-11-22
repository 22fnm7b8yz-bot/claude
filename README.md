# BonScan 🧾

Web-App (PWA) zum **Scannen von Kassenbons und Rechnungen**, um **Preise** zwischen Händlern
und **Inhaltsstoffe** von Produkten zu vergleichen. Läuft im Browser auf Handy und PC, lässt sich
wie eine App auf dem Startbildschirm installieren und speichert alle Daten nur lokal auf dem Gerät.

## Funktionen

**📷 Scannen**
- Bon fotografieren oder Bild aus der Galerie wählen; Texterkennung (Tesseract, Deutsch) läuft direkt auf dem Gerät
- Erkennt automatisch Händler (REWE, LIDL, ALDI, EDEKA, dm, …), Datum, Summe und Positionen
- Versteht Mengenzeilen (`2 Stk x 0,99`), Gewichtsartikel (`1,234 kg x 1,99 EUR/kg`), Rabatte und Pfand
- Prüft, ob die Positionen die Bonsumme ergeben, alles ist vor dem Speichern editierbar
- Alternativ: Text einfügen (z. B. aus E-Mail-Rechnungen oder digitalen Bons)

**€ Preise vergleichen**
- Gruppiert Artikel über einen *Vergleichsnamen* (z. B. „Vollmilch 3,5% 1L“ und „MILCH 1L“ → `milch`)
- Grundpreis pro kg / l / Stück wird aus der Packungsgröße im Namen berechnet
- Zeigt günstigsten Händler, Preisspanne, Sparpotenzial und Preisverlauf je Artikel
- Ranking „Wer ist am günstigsten?“ und Ausgaben pro Händler

**🥫 Inhaltsstoffe vergleichen**
- Barcode (EAN) mit der Kamera scannen, eintippen oder nach Namen suchen
- Daten aus [Open Food Facts](https://world.openfoodfacts.org): Zutaten, Nährwerte, Allergene, Zusatzstoffe, Nutri-Score, NOVA, Siegel
- Mehrere Produkte nebeneinander vergleichen – bessere Werte grün, schlechtere rot markiert
- Zutatenvergleich: gemeinsame Zutaten und Zutaten, die nur in einem Produkt vorkommen
- Produkte lassen sich mit den Preisen aus den Belegen verknüpfen (Preis pro 100 g im Vergleich)

**💾 Daten**
- Speicherung lokal im Browser, Export/Import als JSON-Sicherung, Export der Positionen als CSV (Excel)

## Starten

Es gibt keinen Build-Schritt – es sind reine HTML/CSS/JS-Dateien.

```bash
npm start          # startet http://localhost:8080
npm test           # Tests für die Bon-Erkennung
```

Für die Kamera am Handy braucht die App **HTTPS**. Am einfachsten über GitHub Pages:

1. Branch nach `main` mergen
2. Im Repository unter *Settings → Pages* als Quelle **GitHub Actions** wählen
3. Der Workflow `.github/workflows/pages.yml` testet und veröffentlicht die App automatisch
4. Die Seite am Handy öffnen und *Zum Startbildschirm hinzufügen*

## Aufbau

| Datei | Inhalt |
| --- | --- |
| `js/parser.js` | Bon-Erkennung: Händler, Datum, Summe, Positionen, Mengen, Grundpreise |
| `js/ocr.js` | Bildaufbereitung (Graustufen, Kontrast) und Texterkennung mit Tesseract.js |
| `js/barcode.js` | Barcode-Scanner (BarcodeDetector, Fallback ZXing für iPhone) |
| `js/off.js` | Anbindung an Open Food Facts, Zutaten zerlegen |
| `js/db.js` | Lokale Datenhaltung, Export/Import |
| `js/app.js` | Oberfläche und Navigation |
| `sw.js` | Offline-Cache (App und Texterkennungs-Bibliotheken) |

## Tipps für gute Scans

- Bon glatt streichen, auf dunklen Untergrund legen und gerade von oben fotografieren
- Gutes Licht, keine Schatten; lange Bons lieber in zwei Fotos aufteilen
- Beim ersten Scan werden die Texterkennungsdaten (ca. 5 MB) geladen, danach geht es auch offline

---

# Griffbild 🎸 (`akkorde/`)

Akkorde anzeigen und transponieren – erreichbar unter `/akkorde/` (lokal: `npm start`, dann http://localhost:8080/akkorde/).

- Akkordfolge oder ganzes Lied (Akkordzeilen über dem Text) eingeben
- **+ / −** transponiert alle Akkorde gleichzeitig um einen Halbton (auch Pfeiltasten), Liedtext bleibt unverändert und Akkorde bleiben über der richtigen Silbe
- Griffbilder für Gitarre (offene Griffe, Barré-Griffe, Slash-Akkorde) oder Klaviatur, mit Tönen und Intervallen; ▶ spielt den Akkord ab
- Deutsche (H/B, Fis, Es …) oder internationale Schreibweise, Vorzeichen automatisch, ♯ oder ♭
- Kapo-Hinweis, „Übernehmen" macht die transponierte Fassung zur neuen Eingabe
- **Lied suchen:** In der claude.ai-Ansicht holt „Akkorde holen" die Akkordfolge (ohne Liedtext) über Claude; außerdem Links zur Websuche (Ultimate Guitar, Google)
- **PDF:** transponierte Fassung mit Griffbildern als PDF (jsPDF, wird bei Bedarf vom CDN geladen)

| Datei | Inhalt |
| --- | --- |
| `akkorde/chords.js` | Akkorde erkennen, transponieren, Töne und Gitarrengriffe berechnen (getestet in `test/chords.test.js`) |
| `akkorde/app.js` | Oberfläche, Griffbilder (SVG), Tonwiedergabe |
