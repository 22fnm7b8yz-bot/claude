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

# Tierstimmen 🐾

Zweite kleine Web-App im Ordner `tierstimmen/`: **Tier in einer beliebigen Sprache eingeben**
(„Hund“, „chat“, „lion“, „vaca“, „лягушка“, „ネコ“ …), ein **Bild** dazu sehen und per Knopfdruck
den **Ruf bzw. Schrei des Tiers anhören**.

- Sprache der Eingabe wählbar oder automatisch (erkennt auch kyrillische, griechische, arabische, chinesische, japanische und koreanische Schrift)
- Daten aus [Wikidata](https://www.wikidata.org) (Namen, Bild, Tonaufnahme), [Wikimedia Commons](https://commons.wikimedia.org) (Bilder und Tierlaute) und Wikipedia (Kurzbeschreibung)
- Mehrere Aufnahmen pro Tier („Andere Aufnahme“), Aussprache-Aufnahmen werden aussortiert
- Zeigt den Namen des Tiers in vielen Sprachen und bietet Alternativen an, falls der erste Treffer nicht passt
- MP3-Fassung wird bevorzugt, damit die Laute auch auf dem iPhone laufen
- Teilbare Links: `tierstimmen/?tier=Kuh&sprache=de`

Lokal starten mit `npm start` und dann <http://localhost:8080/tierstimmen/> öffnen.
Nach dem Merge nach `main` ist die App über GitHub Pages unter `…/tierstimmen/` erreichbar.

| Datei | Inhalt |
| --- | --- |
| `tierstimmen/lib.js` | Sprach-Erkennung, Bewertung der Treffer, Auswahl der Tonquellen |
| `tierstimmen/api.js` | Anfragen an Wikidata, Commons und Wikipedia |
| `tierstimmen/app.js` | Oberfläche und Abspielen |
| `test/tierstimmen.test.js` | Tests (mit simulierten Server-Antworten) |
