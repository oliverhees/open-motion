<p align="center">
  <a href="README.md">English</a> · <b>Deutsch</b> · <a href="README.es.md">Español</a> · <a href="README.fr.md">Français</a> · <a href="README.pt-BR.md">Português</a> · <a href="README.zh-CN.md">简体中文</a>
</p>

[![Open Motion — Jedes Element ist eine Ebene.](docs/assets/open-motion-hero.jpg)](docs/assets/open-motion-hero.jpg)

# Open Motion

**Das offene, selbst-hostbare Motion-Graphics-Studio, in dem jedes Element eine live editierbare Ebene ist.**

[![Lizenz: AGPL v3](https://img.shields.io/badge/Lizenz-AGPL--3.0-blue.svg)](LICENSE) [![Status](https://img.shields.io/badge/Status-Beta%200.1-orange.svg)](#-status) [![Stack](https://img.shields.io/badge/Stack-HyperFrames%20%2B%20Web%20Animations-informational.svg)](#-architektur) [![Self-Hosted](https://img.shields.io/badge/Self--Hosted-Docker%20%2B%20Coolify-black.svg)](docs/de/coolify.md) [![Tests](https://img.shields.io/badge/Tests-47%20gr%C3%BCn-brightgreen.svg)](#-status)

*Beschreib dein Video, sprich in die Facecam oder zieh Dateien rein. Die KI baut Ebenen, du feilst live nach, und am Ende kommt eine MP4 raus.*

[Quickstart](#-quickstart) · [Features](#-features) · [Screenshots](#-screenshots) · [Architektur](#-architektur) · [Coolify-Deploy](docs/de/coolify.md) · [Handbuch](docs/de/handbuch.md) · [Lizenz](#-lizenz)

---

## Warum Open Motion

KI-Videogeneratoren liefern dir fertige Pixel. Ist ein Wort im Titel falsch oder sitzt eine Grafik zwei Zentimeter zu weit links, generierst du alles neu und hoffst. Klassische Schnittprogramme geben dir volle Kontrolle, kosten aber für jede Animation Stunden.

Open Motion geht einen dritten Weg: **Motion Graphics aus Code.** Jedes Element ist eine eigene Ebene mit Rahmen, Inhalt und Zeit. Die KI schreibt diese Ebenen, und du fasst sie im Editor direkt an: ziehen, skalieren, tippen. Gerendert wird erst ganz am Schluss mit Headless-Chrome und FFmpeg, Bild für Bild genau so, wie du es in der Vorschau gesehen hast.

Dazu kommt, was ein Erklärvideo braucht: Facecam-Aufnahme im Browser, ein Transkript mit Zeit pro Wort, Grafiken, die an gesprochenen Wörtern hängen, und Schneiden direkt im Text. Löschst du einen Versprecher, rücken Facecam, Ton und Grafiken automatisch nach.

## 🏆 Was uns unterscheidet

|  | KI-Videogeneratoren | Klassische Schnittprogramme | Open Motion |
| --- | --- | --- | --- |
| **Ein einzelnes Element ändern** | ❌ meist alles neu generieren | ✅ von Hand | ✅ klicken, tippen oder KI-Kommentar; nur dieses Element ändert sich |
| **Inhalt tauschen, Rahmen bleibt** | ❌ | ⚠️ umständlich | ✅ Grafik → KI-Bild → Video; Position und Animation bleiben |
| **Facecam + Transkript + Text-Schnitt** | ❌ | ⚠️ oft Zusatzsoftware | ✅ eingebaut; Grafiken hängen an Wörtern und wandern beim Schneiden mit |
| **KI-Modell frei wählbar** | ❌ Modell des Anbieters | ❌ | ✅ eigene Keys: Claude, OpenAI, OpenRouter; Bilder über Kie.ai, OpenAI, OpenRouter, Gemini |
| **Selbst hosten, Daten bleiben bei dir** | ❌ Cloud | ✅ lokal | ✅ Docker + Coolify, ein Ordner pro Projekt |
| **Quellcode** | ❌ | ❌ meist | ✅ AGPL-3.0 |

Ehrlich gesagt: Animationen als Code zu beschreiben und im Browser zu rendern, ist keine neue Idee. Unser Beitrag ist alles, was fehlt, wenn man nur rendert: ein Ebenen-Modell, das KI **und** Mensch gleichzeitig bearbeiten können, ein Live-Editor ohne Neuladen, ein Facecam-Workflow mit Text-Schnitt und ein Rendering, das sich selbst an die Hardware anpasst.

## ✨ Features

- **Ebenen-System:** Text, Formen, gezeichnete Grafiken (SVG), Bilder, Video, Ton. Jede Ebene hat Rahmen, Keyframes, Easing sowie Ein- und Ausblendungen.
- **Live-Editor:** klicken, ziehen, skalieren, direkt in der Vorschau tippen. Wer am Abspielkopf etwas ändert, setzt automatisch einen Keyframe. Nur geänderte Ebenen werden neu gesetzt, ein Video lädt beim Verschieben nie neu.
- **Szenen-Leiste und Tweaks:** Name, Länge und Tempo pro Szene, dazu alle Texte der Szene auf einen Blick.
- **KI-Chat:** „Mach eine 20-Sekunden-Animation für mein Café" → Szenen, Texte, Grafiken, Bilder. Jede Antwort ist einzeln rückgängig zu machen.
- **Kommentare am Element:** Element anklicken, „@KI mach das grün" schreiben, fertig. Nur dieses Element ändert sich.
- **Facecam:** Aufnahme im Browser oder Upload, Ton auf eigener Spur, Layout-Knöpfe (groß, Ecke, Kreis, Split) mit weichen Übergängen.
- **Transkript mit Wortzeiten:** lokal mit faster-whisper oder über OpenAI, ElevenLabs, Groq, Deepgram.
- **Anker:** Grafiken hängen an gesprochenen Wörtern.
- **Text-Schnitt:** Wörter löschen schneidet das Video. Füllwörter und lange Pausen werden vorgeschlagen, der Ton bekommt beim Export knackfreie Mini-Blenden.
- **KI-Bilder:** Kie.ai, OpenAI, OpenRouter oder Gemini, sofort lokal gespeichert.
- **Export:** MP4 oder GIF, 720p oder 1080p, 15/30/60 fps, auf Wunsch schärferer Text.
- **Selbstanpassendes Rendering:** erkennt CPU, RAM und GPU (auch Container-Grenzen), plant die Render-Worker und lernt aus jedem Export, wie lange es wirklich dauert.
- **Zweisprachige Oberfläche:** Deutsch und Englisch, umschaltbar.
- **Selbst hostbar:** Docker-Image in den Varianten `slim` und `whisper`, Editor und Render-Worker als getrennte Dienste.

## 📸 Screenshots

| Live-Editor | KI-Chat |
| --- | --- |
| [![Live-Editor](docs/assets/editor.png)](docs/assets/editor.png) | [![KI-Chat](docs/assets/ai-chat.png)](docs/assets/ai-chat.png) |
| **Transkript und Anker** | **Text-Schnitt** |
| [![Transkript und Anker](docs/assets/transcript-anchors.png)](docs/assets/transcript-anchors.png) | [![Text-Schnitt](docs/assets/text-cut.png)](docs/assets/text-cut.png) |

<sub>Der KI-Chat-Screenshot zeigt einen nachgestellten Verlauf; die dort genannten Änderungen wurden wirklich am Projekt ausgeführt.</sub>

**Beispielvideo**, komplett aus einer Motion-Spec gerendert (Facecam-Platzhalter, Musik, gezeichnete Grafiken, ein Bild am gesprochenen Wort „image" verankert):

![Beispiel](docs/assets/example.gif)

## 🚀 Quickstart

**Mit Docker (empfohlen):**

```bash
git clone https://github.com/oliverhees/open-motion.git
cd open-motion
cp .env.example .env            # OPENMOTION_PASSWORD setzen
docker compose -f docker-compose.yml -f docker-compose.local.yml --env-file .env up --build
# → http://localhost:4317
```

**Ohne Docker (Node 22.18+, FFmpeg):**

```bash
npm install
npx hyperframes browser ensure  # Chrome für den Export (einmalig)
npm run example:assets          # Beispiel-Dateien (braucht Python + Pillow)
npm run editor:build
npm start                       # → http://localhost:4317
```

Danach: ⚙ Einstellungen → API-Keys eintragen → 🩺 **Jetzt testen**.

**Auf deinem Server:** [Coolify-Anleitung Schritt für Schritt](docs/de/coolify.md)

## 🧩 Architektur

```
Browser (Editor)                         Server
┌────────────────────────────┐          ┌───────────────────────────────────────────┐
│ Vorschau (echte Kompo-     │  Patches │ app      Editor, API, Login, KI-Agent      │
│ sition im iframe, Hot-     │ ───────► │          Projektordner, Autosave, Chat     │
│ Update)                    │          │                 │ Warteschlange (Dateien)  │
│ Bühne: klicken, ziehen,    │          │                 ▼                          │
│ tippen, Kommentare         │          │ worker   Export (HyperFrames + Chrome)     │
│ KI-Chat, Tweaks, Medien    │          │          Transkription (Whisper / API)     │
└────────────────────────────┘          └───────────────────────────────────────────┘
```

**Der Kern** ist die **Motion-Spec**, eine JSON-Datei mit Szenen und Ebenen. Editor, KI und Renderer lesen und schreiben nur diese Datei. Änderungen laufen ausschließlich über **Patches** wie `set`, `setAt` (Auto-Keyframe), `swap` (Inhalt tauschen, Rahmen bleibt) oder `cut` (Text-Schnitt). Jeder Patch wird geprüft, Fehler kommen im Klartext zurück, so kann sich eine KI selbst korrigieren.

**Stack:** [HyperFrames](https://github.com/heygen-com/hyperframes) (Apache 2.0) rendert HTML zu Video. Animiert wird mit der **Web Animations API** des Browsers, bewusst ohne GSAP, dessen Lizenz den Einsatz in visuellen Animations-Editoren verbietet. Vorschau und Export nutzen exakt dieselben Easing-Funktionen. TypeScript läuft direkt in Node 22 ohne Build-Schritt, der Editor ist React + Vite.

```
packages/
  core/     Motion-Spec, Schema, Easing, Zeiten, Schnitte, Patches, Compiler
  render/   HyperFrames-Builder, Export, Hardware-Erkennung, CLI „openmotion"
  server/   API, Login, Tokens, Warteschlange, Worker, KI-Agent, Transkription
  editor/   React-Oberfläche
```

Mehr: [Handbuch](docs/de/handbuch.md) · [Motion-Spec-Referenz](docs/de/motion-spec.md)

## 🛡️ Sicherheit

- **Editor:** Passwort-Login (`OPENMOTION_PASSWORD`). Das Session-Cookie ist `HttpOnly` und `SameSite=Lax`, hinter HTTPS zusätzlich `Secure`. Nach 10 Fehlversuchen gibt es 15 Minuten Pause.
- **KIs und Skripte:** API-Tokens, im Editor erzeugt, nur einmal angezeigt, **nur als Hash gespeichert**, jederzeit widerrufbar. Tokens können keine neuen Tokens erzeugen.
- **API-Keys der Anbieter** liegen mit Dateirechten 600 auf dem Server und gehen **nie** an den Browser zurück. Der sieht nur „gesetzt …abcd".
- **CSRF-Schutz:** Jede Änderung per Cookie braucht einen eigenen Header.
- **Von der KI gezeichnete SVGs** werden bereinigt: Skripte, Event-Handler, `foreignObject` und `javascript:`-Links fliegen raus.
- **Docker:** Der Container läuft ohne Root, und die App startet nicht ohne Passwort.
- **Pfadschutz:** Keine Datei außerhalb des Projektordners ist erreichbar (getestet).
- **Telemetrie** von HyperFrames ist abgeschaltet.

Sicherheitslücke gefunden? Siehe [SECURITY.md](SECURITY.md).

## 🔧 Status

**Beta 0.1, abgesichert durch 47 automatische Tests und Ende-zu-Ende-Läufe in Headless-Chrome:**

- [x] Ebenen-Kern: Spec, Patches, Compiler, Render zu MP4/GIF (Bild für Bild geprüft)
- [x] Live-Editor: ziehen, skalieren, tippen, Auto-Keyframes, Szenen, Kommentare
- [x] Facecam-Aufnahme im Browser (mit Fake-Kamera und echter Sprache getestet)
- [x] Lokale Transkription mit faster-whisper
- [x] Text-Schnitt mit Vorschlägen, knackfreiem Ton und mitwandernden Ankern (im Export nachgemessen)
- [x] KI-Agent mit Selbstkorrektur, Kommentare → Änderungen, Grafiken aus dem Transkript (Testmodus und simulierte Anbieter)
- [x] Login, API-Tokens, CSRF-Header, Brute-Force-Bremse
- [x] Editor und Render-Worker als getrennte Prozesse mit gemeinsamer Warteschlange
- [x] Selbstanpassendes Rendering mit lernender Zeitschätzung
- [ ] Live-Test aller KI-, Bild- und Transkriptions-APIs mit echten Keys
- [ ] Docker-Build in Coolify bestätigt
- [ ] MCP-Connector für Claude, Hermes und andere Agenten
- [ ] Skill für claude.ai, Claude Code, Cowork und Hermes

**Bekannte Grenzen:** KI-, Bild- und Transkriptions-APIs sind nach den Dokus und Antwortformaten der Anbieter gebaut; der Live-Test mit echten Keys läuft. Das Docker-Image folgt bewährten Mustern, muss sich in deiner Umgebung aber noch beweisen. Ganze Szenen folgen dem Text-Schnitt noch nicht. Es gibt ein Passwort für alle (noch keine Benutzerkonten). Einige Server-Meldungen sind noch deutsch. Videos von YouTube & Co. lassen sich nicht bildgenau einbetten; importiere sie als Datei.

Details: [STATUS.md](STATUS.md)

## 🗺️ Roadmap

1. **MCP-Connector:** Claude (Web, Code, Cowork), Hermes und andere Agenten bauen Videos direkt auf deinem Server und schicken dir den Editor-Link.
2. **Skill:** Designregeln, Spec-Spickzettel und Beispiele, damit jede KI gute Motion Graphics baut.
3. **Szenen an Wörtern verankern:** Ganze Szenen folgen dem Text-Schnitt.
4. **Profi-Timeline:** Spuren, Keyframe-Kurven, Tonspuren.

## 📜 Lizenz

Der Kern (Motion-Spec, Compiler, Editor, Server, Worker) steht unter der **[GNU Affero General Public License v3.0 (AGPL-3.0)](LICENSE)**, einer von der Open Source Initiative anerkannten Open-Source-Lizenz. Frei nutzbar, veränderbar und weitergebbar. Copyleft: Wer Open Motion verändert und als Netzwerkdienst anbietet, muss den veränderten Quellcode ebenfalls veröffentlichen.

**Bausteine:** HyperFrames (Apache 2.0), React (MIT), Zod (MIT), faster-whisper (MIT, optional). Die Beispielschrift Bricolage Grotesque steht unter der SIL Open Font License. **Kein GSAP.**

## 🏠 Kein Bock auf Selbst-Hosten?

Du kannst Open Motion komplett auf deiner eigenen Infrastruktur betreiben ([Coolify-Anleitung](docs/de/coolify.md)): deine Server, deine Daten, kein Mittelsmann. Wenn du das nicht selbst aufsetzen willst, **richten wir dir eine eigene Instanz ein.** Eine Instanz pro Kunde, kein gemeinsamer Topf. Kontakt: [aiianer.de](https://aiianer.de) oder [Issues](https://github.com/oliverhees/open-motion/issues).

## 🤝 Mitmachen

Issues, Pull Requests und Diskussionen sind willkommen. Setup, Tests und PR-Erwartungen stehen in [CONTRIBUTING.md](CONTRIBUTING.md), dazu unser [Verhaltenskodex](CODE_OF_CONDUCT.md). Die wichtigste Regel: Spec-Änderungen laufen über Patches, und neue Funktionen kommen mit Tests (siehe [CLAUDE.md](CLAUDE.md)).

Projektmanagement läuft ausschließlich über [GitHub Issues](https://github.com/oliverhees/open-motion/issues).

---

<p align="center">Mit ❤️ und Leidenschaft von <b>Oliver Hees – Der Aiianer</b> · <a href="https://aiianer.de">aiianer.de</a> · <a href="LICENSE">AGPL-3.0</a></p>
