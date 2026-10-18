# Open Motion – Handbuch

**Motion Graphics aus Code, bei denen jedes Element eine live editierbare Ebene ist.**

> Status: Baustein 4 + Docker. **Ebenen-Kern**, **Live-Editor**, **Facecam, Uploads, Transkript, Text-Schnitt** und **KI** (Chat, Kommentare, Grafiken aus Transkript, Bildmodelle) funktionieren und sind getestet. Als Nächstes kommt die Profi-Timeline.

---

## 🧱 Die Idee in einem Satz

**Alles ist eine Ebene. Jede Ebene besteht aus Rahmen, Inhalt und Zeit.**

- **Rahmen:** Position, Größe, Drehung, Skalierung, Deckkraft.
- **Inhalt:** Text, Form, gezeichnete Grafik (SVG), Bild, Video oder Ton.
- **Zeit:** Start, Dauer, Keyframes, Ein- und Ausblendung.

Editor, KI und Renderer lesen und schreiben dieselbe JSON-Datei, die **Motion-Spec**. Gerendert wird erst beim Export.

---

## 🐳 Auf dem Server (Coolify / Docker)

- **Zwei Dienste aus einem Image:** `app` (Editor, API, Login) und `worker` (Export, Transkription). Beide teilen sich den Datenordner.
- **Zwei Varianten:** `slim` oder `whisper` (mit lokalem Whisper), Auswahl per `OPENMOTION_WORKER_VARIANT`.
- **Geschützt:** Passwort-Login für den Editor, API-Tokens für KIs (MCP, Hermes, Skripte).
- **Anleitung Schritt für Schritt:** [`coolify.md`](coolify.md)

Lokal ohne Docker läuft alles in einem Prozess (`OPENMOTION_ROLE=all`, Standard). Ohne `OPENMOTION_PASSWORD` ist der Editor offen, also nur lokal so betreiben.

## 🎛️ Editor starten

```bash
npm install
npm run example:assets     # Beispiel-Assets (einmalig)
npm run editor:build       # Editor bauen
npm start                  # → http://localhost:4317
```

Entwickeln mit Live-Reload: `npm start` in einem Terminal, `npm run editor:dev` im zweiten (→ http://localhost:5173).

**Was der Editor kann:**

- **Bühne:** Klick wählt aus, Ziehen verschiebt, Ecken skalieren (Shift = Seitenverhältnis halten), Mitte rastet ein.
- **Text:** Doppelklick oder Enter, dann direkt in der Vorschau tippen.
- **Auto-Keyframes:** Ist eine Eigenschaft animiert, entsteht beim Ändern am Abspielkopf ein Keyframe. Die Raute ◆ neben jedem Wert startet eine Animation.
- **Szenen-Leiste und Tweaks wie bei Motion:** Name, Länge, Tempo, alle Texte der Szene.
- **Ebenen:** ausblenden, sperren, nach oben oder unten schieben, löschen.
- **Stil:** Farbpalette und Hintergrund, alles ändert sich live.
- **Kommentare am Element:** mit Zeitstempel und „An KI senden" (die KI kommt in Baustein 4).
- **Export:** MP4/GIF, 720p/1080p, 15/30/60 fps, Qualität, schärferer Text.
- **Sicherheit:** Autosave, Undo/Redo und Versionsverlauf.
- **Sprache:** Deutsch/Englisch umschaltbar.

**Tastenkürzel:** Leertaste = Abspielen · C = Kommentar-Modus · Enter = Text bearbeiten · Pfeile = 1 px (Shift: 10 px) · Entf = Ebene löschen · Strg/Cmd+Z = Rückgängig · Strg/Cmd+Shift+Z = Wiederholen · Esc = Auswahl aufheben

**Hot-Update:** Bei jeder Änderung wird nur die betroffene Ebene neu gesetzt. Ein verschobenes Video lädt nicht neu.

## 🎥 Facecam, Uploads und Transkript (Tab „Medien")

- **Aufnehmen:** Kamera und Mikro im Browser, Countdown, Geräteauswahl. Der Server wandelt die WebM-Aufnahme in MP4 um (H.264, 30 fps), damit sie sich sauber spulen lässt.
- **Hochladen:** über den Knopf oder per Drag & Drop direkt auf die Bühne. Die Datei landet sortiert in `assets/images|video|audio|fonts`, und die Ebene erscheint dort, wo du loslässt.
- **Facecam = 2 Ebenen:** ein stummes Video und der Ton als eigene Spur.
- **Layout-Knöpfe:** Groß rechts, Ecke, Kreis, Split und Vollbild. Jeder Knopf setzt am Abspielkopf einen Keyframe: Die Facecam hält ihre Position und gleitet in 0,6 s ins neue Layout.
- **Transkript mit Zeit pro Wort**, wählbar:
  - **Lokal** mit faster-whisper: kostenlos, offline, Modell wählbar (`tiny`, `small`, `large-v3-turbo` …)
  - **OpenAI Whisper**, **ElevenLabs Scribe**, **Groq** und **Deepgram** mit eigenem Key
- **Anker:** Ebene auswählen, ⚓ einschalten, Wort anklicken. Die Ebene startet dann genau bei diesem Wort und wandert mit, wenn die Facecam verschoben oder gekürzt wird.
- **Wörter korrigieren:** per Doppelklick auf ein Wort.
- **Wortzeiten** beziehen sich auf die Original-Aufnahme. Darauf baut der Text-Schnitt (3b) auf.

## ✂️ Text-Schnitt (Tab „Medien" → ✂ Schnitt)

- **Schneiden wie im Textdokument:** Wort anklicken, mit Shift erweitern, Entf drücken. Das Video und der abgekoppelte Ton schneiden mit.
- **Nichts geht verloren:** Geschnittene Wörter bleiben durchgestrichen stehen, ein Klick holt sie zurück. Per Schalter lassen sie sich ausblenden.
- **Vorschläge:** Füllwörter (äh, ähm, hm …) und Pausen ab 0,7 s werden gefunden. Pausen werden auf 0,3 s gekürzt. Einzeln oder mit „Alle anwenden".
- **Anker wandern mit:** Eine Grafik, die an einem Wort hängt, rückt automatisch nach vorn.
- **Ton ohne Knackser:** Beim Export setzt FFmpeg an jede Schnittkante eine 10-ms-Blende. Die Vorschau im Editor schneidet hart.
- **Nicht-destruktiv:** Schnitte sind nur Zeitbereiche der Original-Aufnahme (`transcript.cuts`). Die Datei selbst bleibt unangetastet.

**Lokales Whisper einrichten:**

```bash
pip install faster-whisper     # Python 3 + FFmpeg nötig
```

Modelle werden beim ersten Lauf nach `data/models/` geladen. Das Audio dekodiert Open Motion selbst mit FFmpeg, deshalb spielen PyAV-Versionen keine Rolle.

**API-Keys:** ⚙ Einstellungen im Editor. Die Keys liegen in `data/settings.json` (Dateirechte 600) und werden nie an den Browser zurückgeschickt, er sieht nur „gesetzt …abcd".

## 🎨 Neues Video: Format, Stil, Interview

1. **Neues Video** → **Format** (16:9, 9:16, 1:1, 4:5) und **Stil** wählen (oder „Überrasch mich").
2. Das Projekt öffnet mit einem gestylten Start und dem **Interview** im Chat: Ziel, Publikum, Länge, Botschaft, Stil. Klicken, tippen oder 🎙️ drücken und sprechen (lokales Whisper).
3. **Bauen** → die KI schreibt die Szenen, schaut sich danach gerenderte Frames an und korrigiert alles unter 8 (abschaltbar unter ⚙ → „Qualitäts-Check").
4. Ist etwas unklar, antwortet die KI mit einem kurzen Formular, statt zu raten.

**Effekte, die du anfragen oder im Panel setzen kannst:** Text pro Wort/Buchstabe/Zeile, Textmarker auf einem Wort, hochzählende Zahlen, Linien, die sich selbst zeichnen, Masken- und Iris-Blenden, 3D-Kippen, Unschärfe, Kamerafahrten, Glow/Schatten/Glas, Körnung/Vignette/Scanlines, Untertitel aus dem Transkript (Tab „Medien").

## 🏷️ Brand-Kit

1. **🎨 Marken** (Startseite, ⚙ Einstellungen oder Tab „Stil") → **Neue Marke**.
2. Logo (PNG, JPEG, WebP, SVG), Farben (nur die Hauptfarbe ist Pflicht, der Rest wird so abgeleitet, dass Text lesbar bleibt), Schriften (Name einer Google Font oder eigene WOFF2/TTF-Datei), Slogan, Website, Handle.
3. Optional: **Logo im Video** in einer Ecke (Größe, Deckkraft). Es läuft immer über das ganze Video.
4. **Standard für neue Videos** an → jedes neue Video startet in deiner Marke. Pro Projekt: Tab **Stil** → **Marke** (wechseln, erneut anwenden oder „Keine Marke", das stellt den Look exakt wieder her).

## 🧩 Vorlagen (Tab „Vorlagen")

25 fertige Szenen und Einblendungen: Intro, Titelkarte, Kapitel, Hook, Statement, große Zahl, 3 Kennzahlen, Balkendiagramm, Liste, Schritte, Vergleich, Zitat, Call to Action, Outro, YouTube-Endcard, Countdown, Checkliste, Zeitstrahl · Bauchbinde, Hinweis mit Linie, Abo-Button, Schlagwort, Handle, Einkreisen, Pfeil.

1. Vorlage anklicken → **Live-Vorschau in deinem Format, Stil und deiner Marke**.
2. Texte anpassen (`[[Wort]]` hebt hervor) → **Einfügen**. Szenen kommen hinter die aktuelle Szene, Einblendungen an den Abspielkopf.
3. Läuft eine Aufnahme durch das Video, werden Szenen-Vorlagen als Vollbild-Karte am Abspielkopf eingeblendet; die Stimme läuft weiter.
4. Alles Eingefügte sind normale Ebenen: anklicken, ziehen, ändern oder die KI fragen.

## 📦 Export-Formate

- **MP4 / GIF:** das fertige Video.
- **WebM / MOV · transparent:** für Overlays in Premiere, DaVinci, CapCut oder auf Webseiten. Vollflächige Hintergründe werden automatisch ausgeblendet (im Dialog abwählbar). MOV ist ProRes 4444: groß, gemacht für Schnittprogramme.
- **Lottie (Beta):** eine JSON für Apps, Webseiten und After Effects. Formen, Text, Bilder, Verläufe, Zähler, Wischblenden und alle Übergänge; Video, Untertitel, Glow, Unschärfe und 3D fehlen, der Dialog zeigt, was fehlt. Die Schriften müssen dort installiert sein, wo die Lottie abgespielt wird.

## ✦ KI (Chat links, wie bei Motion)

- **Chat:** „Mach eine 20-Sekunden-Animation für mein Café, 4 Szenen, warm und ruhig." Die KI baut die Szenen, Texte, gezeichneten Grafiken und Bilder.
- **Folgewünsche** im selben Chat: „Szene 2 langsamer", „Titel in Orange", „Tasse als Eiskaffee".
- **Kommentare → Änderungen:** Kommentare mit „An KI senden" arbeitet die KI per Knopf nacheinander ab. Sie ändert nur das kommentierte Element, schreibt eine Antwort an den Kommentar und setzt ihn auf „Erledigt".
- **Grafiken aus Transkript:** Ein Knopf erzeugt Titel, Stichworte und SVG-Grafiken zum Gesagten, jeweils am passenden Wort verankert. Sie wandern also beim Schneiden mit.
- **KI-Bild an jeder Bild-, Form- oder Grafik-Ebene:** Prompt eingeben und „Generieren". Der Rahmen bleibt, nur der Inhalt wird zum Bild.
- **Sicher:** Die KI schreibt nur Patches, keinen freien Code. Jede Antwort wird vom Kern geprüft. Fehler gehen im Klartext an die KI zurück (bis zu 3 Versuche). Bilder werden erst erzeugt, wenn alles gültig ist (höchstens 4 pro Antwort).
- **Nachvollziehbar:** Geänderte Ebenen blinken kurz auf. Jede Antwort hat einen eigenen „Rückgängig"-Knopf. Der Chat wird im Projektordner gespeichert (`chat.json`).

| Wofür | Anbieter (eigener Key, ⚙ Einstellungen) | Standard-Modell (änderbar) |
| --- | --- | --- |
| KI | Anthropic (Claude), OpenAI, OpenRouter | `claude-sonnet-5-5`, `gpt-5`, `anthropic/claude-sonnet-5.5` |
| Bilder | Kie.ai, OpenAI, OpenRouter, Google Gemini | `gpt-image-2-text-to-image`, `gpt-image-1`, `google/gemini-2.5-flash-image`, `gemini-2.5-flash-image` |

Bilder werden immer sofort nach `assets/images/` heruntergeladen. Kie.ai löscht generierte Medien nach einiger Zeit.

**🔑 Ohne API-Key, mit deinem Abo:** Als KI-Anbieter gehen auch **Claude Code** und **Codex**. Open Motion nutzt dann die angemeldete CLI auf deinem Rechner (nur ohne Docker). Und über den **MCP-Server** (`/mcp`) steuern Claude Code, Codex und Hermes Open Motion direkt. Anleitung: [Claude Code, Codex, Hermes](mcp.md).

**Testmodus ohne Keys:** `OPENMOTION_FAKE_AI=1 npm start` liefert feste KI-Antworten und Platzhalterbilder. Damit lässt sich die Oberfläche testen (`npm run smoke:ai`).

## ⚙️ Rendern: passt sich selbst an

- **Erkennt die Hardware vor jedem Export:** CPU-Kerne, freien RAM und die aktuelle Auslastung. Dabei zählen die **Container-Grenzen** (Docker/Coolify), nicht der ganze Server.
- **Plant die Worker:** Jeder Worker ist ein eigener Headless-Chrome, der einen Teil der Einzelbilder rendert.
  - CPU: Kerne − 1, abzüglich dessen, was gerade schon läuft
  - RAM: ca. 0,5 GB pro Worker bei 1080p, mehr bei 4K oder „schärferem Text"
  - Obergrenze 16
- **GPU:** Sie wird nur genutzt, wenn ein echter Test-Encode klappt (FFmpeg listet NVENC auch ohne GPU). Erkannt werden NVIDIA (NVENC) und Apple (VideoToolbox).
- **Exporte laufen nacheinander:** Jeder Export nutzt schon alle passenden Kerne, mehrere gleichzeitig würden sich nur ausbremsen.
- **Lernt mit:** Nach jedem Export wird die echte Dauer gemessen (`data/render-stats.json`), und die Zeitschätzung im Export-Dialog wird damit genauer.
- **Sichtbar:** Der Export-Dialog zeigt den Plan, zum Beispiel „8 Kerne (Container), 14 GB frei → 7 Worker". 🩺 zeigt ihn auch.
- **Von Hand überschreiben (optional):** `OPENMOTION_RENDER_WORKERS=4`, `OPENMOTION_RENDER_GPU=0|1`

## 🩺 Fehlersuche

- **Verbindungen testen:** ⚙ Einstellungen → 🩺 „Jetzt testen". Jeder Key wird mit einem Mini-Aufruf geprüft, dazu die Modellnamen. Ist ein Modell veraltet, stehen passende Vorschläge direkt darunter. Per „Bericht kopieren" bekommst du einen Bericht **ohne Keys**.
- **Im Terminal:** `npm run check:keys` (optional `-- --agent --images` für einen echten Probelauf, kostet wenige Cent). Der Bericht wird auch als `data/diagnose.txt` gespeichert.
- **Debug-Log:** `npm run start:debug` schreibt jede API-Antwort nach `data/logs/api-<datum>.log`, ohne Header und ohne Keys.
- **Testplan Schritt für Schritt:** [`testplan-echte-keys.md`](testplan-echte-keys.md)

## 📁 Projektordner

Jedes Projekt ist ein eigener Ordner (Standard: `./data/projects/`, änderbar per `OPENMOTION_DATA`):

```
<projekt-id>/
  project.json     Titel, erstellt, geändert
  spec.json        die Motion-Spec
  comments.json    Kommentare (inkl. Antworten der KI)
  chat.json        KI-Chatverlauf
data/settings.json   Einstellungen + Keys (Dateirechte 600)
data/tokens.json     API-Tokens für KIs (nur als Hash)
data/sessions.json   Anmeldungen (nur als Hash)
data/queue/          Warteschlange zwischen Editor und Worker
data/worker.json     Lebenszeichen des Workers (alle 10 s)
data/diagnose.txt    letzter Verbindungstest (ohne Keys)
data/render-stats.json  gemessene Render-Geschwindigkeit (für genauere Schätzungen)
data/logs/           Debug-Log (nur mit start:debug)
  assets/
    images/  video/  audio/  fonts/
  renders/         Exporte
  history/         automatische Versionen (höchstens 1 pro Minute, die letzten 50)
```

Reine Dateien: Du kannst sie sichern, in Nextcloud synchronisieren oder in Git legen.

---

## ⚡ Schnellstart nur Rendern (ohne Editor)

Voraussetzungen: Node 22.18 oder neuer, FFmpeg, Python 3 mit Pillow (nur für die Beispiel-Assets).

```bash
npm install
npm run example:assets     # erzeugt Platzhalter-Facecam, Musik, Bild, Schrift
npm run example:render     # → examples/explainer/explainer.mp4
```

Tests:

```bash
npm test                   # schnell, ohne Browser
OM_RENDER_TEST=1 npm test  # zusätzlich echter Render
npm run smoke              # klickt den Editor in Headless-Chrome durch (Server muss laufen)
npm run smoke:media        # Aufnahme mit Fake-Kamera + Sprachdatei, Transkript, Anker, Layout, Upload
npm run smoke:cut          # Wörter schneiden, Vorschläge anwenden, Wort zurückholen, Export
npm run smoke:ai           # KI im Testmodus: Chat, Rückgängig, Kommentar, Transkript-Grafik, KI-Bild
```

---

## 🗂️ Aufbau

```
packages/
  core/     Spec, Schema, Easing, Zeiten, evaluate, Patches, Compiler
            läuft in Node UND im Browser (für den kommenden Editor)
  render/   baut HyperFrames-Projekte, rendert MP4/GIF, CLI "openmotion"
  server/   Projektordner, Autosave, Kommentare, Export-Jobs, liefert den Editor aus
  editor/   React-Oberfläche: Bühne, Szenen-Leiste, Tweaks, Ebenen, Medien, Stil, Kommentare, Export
  server/py/transcribe.py   lokales Whisper (faster-whisper)
examples/
  erklaervideo/   13-Sekunden-Beispiel mit Facecam, Ton, Musik, Anker
docs/
  motion-spec.md  alle Felder auf einen Blick
```

---

## 🎬 So wird aus JSON ein Video

1. **Spec:** Du (oder die KI) beschreibst Ebenen als JSON.
2. **Compiler:** Jede Ebene wird zu drei verschachtelten Boxen:
   - Rahmen-Box mit Position, Größe und Keyframes
   - Effekt-Box für Ein- und Ausblendungen
   - Inhalt als HyperFrames-Clip
3. **Animation:** Keyframes werden zu Web Animations (direkt im Browser, **ohne GSAP**).
4. **Render:** HyperFrames springt zu jedem Bild, macht einen Screenshot, FFmpeg baut daraus die MP4.

Vorschau und Export rechnen mit derselben Easing-Funktion. **Was du siehst, ist das fertige Video.**

---

## 🛠️ Befehle

```bash
openmotion validate spec.json                 # prüfen, Fehler in Klartext
openmotion describe spec.json                 # kompakte Übersicht für KI-Modelle
openmotion compile  spec.json -o build/       # HyperFrames-Projekt erzeugen
openmotion render   spec.json -o video.mp4    # rendern
openmotion patch    spec.json ops.json        # Änderungen anwenden
```

**Export-Optionen** (wie im Export-Dialog von Motion):

| Option | Werte |
| --- | --- |
| `--format` | `mp4`, `gif` |
| `--height` | z. B. `720`, `1080` |
| `--fps` | z. B. `15`, `30`, `60` |
| `--quality` | `high`, `medium`, `low` |
| `--sharp` | rendert doppelt so groß und skaliert dann herunter, für schärferen Text |

Ohne globale Installation: `node packages/render/src/cli.ts …`

---

## ✏️ Patches: wie Editor und KI etwas ändern

Kleine Änderungen per Ebenen-ID. Alles andere bleibt unangetastet.

| Op | Wofür |
| --- | --- |
| `set` | ein Feld setzen: `text`, `frame.x`, `style.color` … |
| `setAt` | Wert zu einem Zeitpunkt setzen. Ist die Eigenschaft animiert, entsteht dort ein Keyframe |
| `removeKey` | Keyframe löschen |
| `swap` | **Inhalt tauschen, Rahmen bleibt**: Grafik → Bild → Video |
| `replace` | Ebene komplett neu, ID bleibt (z. B. „zeichne die Tasse neu") |
| `add` / `remove` | Ebene hinzufügen oder löschen |
| `scene`, `addScene`, `removeScene` | Szenen ändern |
| `style`, `canvas` | Palette, Schriften, Format |

Beispiele liegen in `examples/explainer/patches/`.

Fehler kommen als Klartext zurück, damit ein KI-Modell sie lesen und korrigieren kann:

```
Patch op #0: no layer with id "tasse". Existing ids: bg, dots, s1-kicker, …
```

---

## 🎥 Facecam

- Eine Facecam besteht aus **zwei Ebenen**: einem stummen Video und dem Ton als eigener Ebene.
- Dadurch kannst du das Bild frei bewegen und den Ton getrennt mischen.
- `facecamLayers()` und `facecamFrame()` aus `@openmotion/core` liefern fertige Layouts: `full`, `right`, `corner`, `circle`, `split`.

## ⚓ Anker

- Eine Ebene kann an einem **Wort aus dem Transkript** hängen statt an einer festen Zeit.
- Schneidest du die Facecam, wandert die Ebene automatisch mit.
- Im Beispiel hängt das Bild am Wort „Bild" (`w22`).

---

## ⚠️ Bekannte Grenzen und Entscheidungen

- **KI- und Bild-APIs:** nach den Dokus der Anbieter gebaut und mit deren Antwortformaten getestet (simulierte Antworten). Mit echten Keys gegen die Live-APIs noch nicht getestet. Modellnamen ändern sich oft, deshalb sind sie in den Einstellungen frei wählbar.
- **API-Transkription:** nach den Dokus der Anbieter gebaut und mit deren Antwortformaten getestet, aber noch nicht mit echten Keys gegen die Live-APIs. Bitte beim ersten Einsatz prüfen.
- **Szenen bleiben fest:** Schnitte kürzen die Facecam und verschieben verankerte Ebenen, aber nicht die Szenen. Szenen an Wörter zu koppeln ist der nächste logische Schritt.
- **Export mit vielen Schnitten** dauert länger, weil jedes Stück ein eigener Video-Clip ist.
- **Lange Aufnahmen** werden während des Uploads umgewandelt. Bei sehr langen Dateien kann ein vorgeschalteter Proxy (Timeout) abbrechen.
- **Docker-Image** ist nach bewährtem Muster gebaut, aber in meiner Umgebung (ohne Docker) nicht gebaut worden. Die Zwei-Dienste-Architektur selbst ist mit zwei echten Prozessen getestet (`scripts/e2e-roles.ts`).
- **Kein GSAP.** Die GSAP-Lizenz verbietet den Einsatz in visuellen Animations-Editoren, die mit Webflow konkurrieren. Open Motion nutzt deshalb die eingebaute Web Animations API des Browsers.
- **YouTube und andere Plattformen** lassen sich als eingebettetes Video nicht bildgenau rendern. Importiere das Video als Datei (Rechte beachten).
- **SVG von der KI** wird bereinigt: Skripte, Event-Handler, `foreignObject` und `javascript:`-Links fliegen raus.
- **Telemetrie:** HyperFrames sammelt standardmäßig anonyme Nutzungsdaten. Open Motion schaltet das beim Rendern ab (`HYPERFRAMES_NO_TELEMETRY=1`, `DO_NOT_TRACK=1`).
- **Versionen sind gepinnt:** `hyperframes@0.8.106`, `zod@3.23.8`. Updates nur bewusst und mit Testrender.
- **Lizenz** von Open Motion selbst ist noch offen. Vor der Veröffentlichung festlegen.
- **Schrift im Beispiel:** Bricolage Grotesque, SIL Open Font License (siehe `assets/fonts/OFL.txt`).

---

## 🗺️ Nächste Bausteine

1. ✅ **Ebenen-Kern**: Spec, Compiler, Patches, Render
2. ✅ **Live-Editor**: Klick, Ziehen, Skalieren, Text tippen, Auto-Keyframes, Szenen, Kommentare, Export
3. ✅ **3a: Facecam und Uploads**: Aufnahme, Upload, Layouts, Transkript (lokal + 4 APIs), Anker
   ✅ **3b: Text-Schnitt**: Wörter löschen und zurückholen, Füllwörter/Pausen-Vorschläge, knackfreier Ton
4. ✅ **KI**: Chat wie Motion, Kommentare → Änderungen, Grafiken aus Transkript, 4 Bildanbieter
5. ⬜ **Profi-Timeline**: Spuren, Keyframes, Easing-Kurven, Tonspuren
