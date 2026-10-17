# Testplan mit echten Keys

Ein Schritt nach dem anderen. Hakt etwas, hör an der Stelle auf und schick mir die drei Dinge unter „Wenn etwas schiefgeht".

⚠️ **Keys niemals in den Chat kopieren.** Der Bericht und das Log enthalten keine Keys.

## 0. Starten (einmalig)

```bash
npm install
npm run example:assets
npm run editor:build
pip install faster-whisper      # nur für lokales Whisper
npm run start:debug             # → http://localhost:4317  (Log in data/logs/)
```

## 1. Keys eintragen und Verbindung testen

- [ ] ⚙ Einstellungen öffnen
- [ ] KI-Modell wählen (z. B. Anthropic) und den Key eintragen
- [ ] Bildmodell wählen (z. B. Kie.ai) und den Key eintragen
- [ ] **Speichern**
- [ ] 🩺 **Jetzt testen** → alles ✓? (– heißt nur „kein Key“, das ist okay)
- [ ] Bei ✗: Hinweis lesen (z. B. Modellname falsch → Vorschläge stehen direkt darunter)

Alternativ im Terminal: `npm run check:keys` (mit `-- --agent --images` inklusive echtem Probelauf).

## 2. Chat (kleiner Auftrag)

- [ ] Projekt „Beispiel: Erklärvideo“ anlegen
- [ ] Im Chat: `Mach den Titel in Szene 1 orange und etwas größer.`
- [ ] Erwartung: Antwort in 5 bis 30 s, Titel blinkt auf, ist orange und größer
- [ ] „Rückgängig“ an der Antwort → Titel wieder wie vorher

## 3. Kommentar → Änderung

- [ ] 💬 Kommentar-Modus (Taste C) → auf den Filmstreifen klicken
- [ ] Text: `@KI mach das Schloss grün` → Speichern
- [ ] Im Chat: „💬 Kommentare abarbeiten (1)“
- [ ] Erwartung: nur das Schloss ändert sich, und der Kommentar steht auf „Erledigt“ mit Antwort

## 4. Grafiken aus Transkript

- [ ] Medien → Transkript vorhanden (Beispiel hat eins)
- [ ] Im Chat: „✨ Grafiken aus Transkript“
- [ ] Erwartung: neue Titel und Grafiken, unter Ebenen mit Anker ⚓

## 5. KI-Bild

- [ ] Ebene „KI-Bild“ auswählen → Feld „KI-Bild“ → Prompt → 🎨 Generieren
- [ ] Erwartung: nach 10 bis 60 s neues Bild, gleicher Rahmen, Datei unter `assets/images/`

## 6. Großer Auftrag

- [ ] Neues leeres Projekt
- [ ] Im Chat: `Mach eine 20-Sekunden-Animation für mein Café Ember Roast, 4 Szenen, warm und ruhig, mit einer gezeichneten Kaffeetasse.`
- [ ] Erwartung: 4 Szenen mit Texten und Grafik, abspielbar

## 7. Export

- [ ] Exportieren → 720p, 30 fps → Video ansehen

## Wenn etwas schiefgeht

Schick mir:
1. **Den Bericht** aus 🩺 („Bericht kopieren“) oder `data/diagnose.txt`
2. **Die Fehlermeldung** aus dem Chat oder dem roten Hinweis (Text oder Screenshot)
3. **Das Log** `data/logs/api-<datum>.log` (nur der Teil um die Fehlerzeit)
