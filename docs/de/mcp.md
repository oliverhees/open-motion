# 🤖 Open Motion mit Claude Code, Codex und Hermes

Zwei Wege, beide **ohne API-Key**, mit deinem Abo:

| Weg | Was passiert | Wofür |
| --- | --- | --- |
| **A: Abo im Editor** | Der KI-Chat im Editor nutzt `claude` oder `codex` auf deinem Rechner | Du arbeitest im Editor |
| **B: MCP** | Claude Code, Codex oder Hermes steuern Open Motion von außen | Du sagst der KI im Terminal, was sie bauen soll |

Beide Wege laufen **auf deinem eigenen Rechner, ohne Docker**. In Docker gibt es die CLIs nicht.

---

## 🧰 Installation (einmalig)

**Linux und macOS** (Terminal):

```bash
curl -fsSL https://raw.githubusercontent.com/oliverhees/open-motion/main/install.sh | bash
```

**Windows** (PowerShell):

```powershell
powershell -ExecutionPolicy Bypass -c "irm https://raw.githubusercontent.com/oliverhees/open-motion/main/install.ps1 | iex"
```

Der Installer macht alles allein, ohne Admin-Rechte:

- 📦 Node, FFmpeg und Open Motion in **einen** Ordner (`~/.openmotion`, Windows: `%LOCALAPPDATA%\OpenMotion`)
- 🎙️ fragt, ob er **Whisper** installieren soll (Transkript gratis, ca. 1 GB, bringt sein eigenes Python mit)
- ▶️ legt ein **Start-Symbol** an (Linux: Anwendungsmenü, macOS: Schreibtisch, Windows: Desktop + Startmenü) und den Befehl `openmotion`
- 🤖 findet **Claude Code, Codex und Hermes** und verbindet sie per MCP; der Editor-Chat nutzt dann dein Abo
- 🔒 Open Motion ist danach nur auf deinem Rechner erreichbar, nicht im Netzwerk

**Wichtig:** Claude Code, Codex oder Hermes vorher installieren und einmal anmelden (`claude` → `/login`, `codex login`). Kommen sie später dazu: Installer einfach nochmal starten.

🔄 **Update:** dieselbe Zeile nochmal. Deine Projekte bleiben. · 🗑️ **Entfernen:** den Ordner löschen.

<details><summary>Ohne Installer (für Entwickler)</summary>

```bash
git clone https://github.com/oliverhees/open-motion.git
cd open-motion
npm install
npx hyperframes browser ensure
pip install faster-whisper requests
npm run editor:build
npm start                        # → http://localhost:4317
```

</details>

---

## 🅰️ Weg A: Abo im Editor (KI-Chat, Kommentare, Grafiken)

✅ **Mit dem Installer ist das schon eingestellt**, wenn er Claude Code oder Codex gefunden hat.

1. Editor öffnen → **⚙ Einstellungen**.
2. Unter **KI-Modell** wählen: **Claude Code (Abo, ohne Key)** oder **Codex (Abo, ohne Key)**.
3. Modellfeld leer lassen. Dann gilt der Standard der CLI. Oder z. B. `opus` bzw. `sonnet` eintragen.
4. **Speichern** → 🩺 **Jetzt testen**.

✅ Danach laufen KI-Chat, Kommentare („@KI …") und „Grafiken aus Transkript" über dein Abo.

**Gut zu wissen**

- 🔒 Die CLI darf dabei **keine Werkzeuge** nutzen (Claude Code: alle aus; Codex: nur lesen). Sie liefert nur die Änderung, und Open Motion prüft sie.
- 💳 Ist `ANTHROPIC_API_KEY` gesetzt, gibt Open Motion ihn **nicht** an `claude` weiter. So zählt immer das Abo.
- 🖼️ **KI-Bilder** brauchen weiter einen Bild-Key (Kie.ai, OpenAI, OpenRouter oder Gemini). Ohne Key: Grafiken als SVG zeichnen lassen.
- 🎙️ **Transkript:** lokal mit faster-whisper, ganz ohne Key.

---

## 🅱️ Weg B: MCP (die KI baut das Video für dich)

Open Motion bringt einen MCP-Server mit: **`http://localhost:4317/mcp`**. Er startet automatisch mit Open Motion.

✅ **Mit dem Installer ist das schon erledigt.** Die Einträge unten brauchst du nur ohne Installer.

### Claude Code

```bash
claude mcp add --transport http openmotion http://localhost:4317/mcp
```

### Codex

In `~/.codex/config.toml` eintragen (Pfad anpassen):

```toml
[mcp_servers.openmotion]
command = "node"
args = ["/home/DEIN-NAME/open-motion/packages/server/src/mcp-stdio.ts"]
env = { OPENMOTION_URL = "http://localhost:4317" }
```

`mcp-stdio.ts` ist eine kleine Brücke: Sie reicht alles an den laufenden Server weiter. So funktioniert es mit jedem Client, der MCP über stdio kann.

### Hermes

In `~/.hermes/config.yaml` eintragen (Pfad anpassen):

```yaml
mcp_servers:
  openmotion:
    command: "node"
    args: ["/home/DEIN-NAME/open-motion/packages/server/src/mcp-stdio.ts"]
    env:
      OPENMOTION_URL: "http://localhost:4317"
```

Kann deine Hermes-Version MCP über HTTP, geht auch direkt `url: "http://localhost:4317/mcp"`.

### 🎬 Beispiel: Erklärvideo aus einer fertigen Facecam

Sag deiner KI zum Beispiel:

> Nutze Open Motion. Lege das Projekt „KI-Tools erklärt" an. Importiere `/home/ich/Videos/facecam.mp4` als Facecam im Layout „corner". Transkribiere auf Deutsch. Schneide Füllwörter und lange Pausen raus. Setze zu jeder Kernaussage einen kurzen Titel, verankert am passenden Wort. Gib mir dann den Editor-Link.

**Oder als Motion Designer, von null:**

> Nutze Open Motion. Mach ein 20-Sekunden-Reel in 9:16 zur Eröffnung unseres Cafés. Interview mich zuerst, schlag 3 Richtungen vor, dann bau es. Schau dir deine Frames an und verbessere alles unter 8/10, dann exportiere in 1080p.

Die KI folgt einem Regie-Ablauf, der im MCP steckt: Briefing → drei Richtungen → Stil und Format → Beat-Sheet → Bauen → **eigene Frames anschauen** (`look`) und korrigieren → Export.

Öffne den Link im Browser. **Jede Änderung der KI erscheint nach etwa 2 Sekunden live im Editor**, mit dem Hinweis „Von außen aktualisiert".

### 🔧 Die Werkzeuge

| Werkzeug | Was es tut |
| --- | --- |
| `list_projects`, `create_project` | Projekte ansehen und anlegen (mit Format 16:9 / 9:16 / 1:1 / 4:5 und Stil) |
| `list_styles` | Die 14 Stile mit Schriften, Palette und Bewegungsregeln |
| `get_project`, `get_spec` | Überblick bzw. komplette Motion-Spec |
| `spec_reference` | Der Master-Prompt: Design-Gesetze, Engine-Referenz (Textanimation, Masken, Zähler, Zeichnen, 3D, Kamera, Texturen), Rezepte, Selbstcheck |
| `import_media` | Datei von deinem Rechner ins Projekt holen (Videos werden bei Bedarf umgewandelt) |
| `add_facecam` | Video als Facecam einfügen (Bild + Ton getrennt) |
| `transcribe`, `job_status` | Transkript starten; fertig = automatisch im Projekt |
| `get_transcript` | Wörter mit Zeiten, Schnitte, Vorschläge für Füllwörter und Pausen |
| `apply_patch` | Jede Änderung, wird geprüft (bei Fehler: nichts gespeichert, klare Meldung) |
| `add_captions` | Untertitel aus dem Transkript, passend zu Format und Stil |
| `look` | Rendert Frames und zeigt sie der KI als Bilder, damit sie ihre Arbeit beurteilen und korrigieren kann |
| `export_video` | MP4 oder GIF rendern, Link über `job_status` |
| `editor_url` | Link zum Projekt im Editor |

### 🔒 Sicherheit

- **Ohne Passwort** (lokal): Der MCP antwortet **nur auf localhost**. Webseiten können ihn nicht fernsteuern.
- **Mit Passwort** (Server): Im Editor unter **⚙ → Zugänge für KIs** ein Token erstellen. Dann:
  - Claude Code: `claude mcp add --transport http openmotion https://dein-server/mcp --header "Authorization: Bearer om_…"`
  - Brücke: zusätzlich `OPENMOTION_TOKEN = "om_…"` in `env`.
- **Import:** `import_media` liest nur aus deinem Home-Ordner. Andere Ordner: `OPENMOTION_IMPORT_DIRS=/pfad/a:/pfad/b`. In Docker ist der Import aus, solange du diese Variable nicht setzt.

---

## ⚠️ Ehrlich: was getestet ist

| Teil | Status |
| --- | --- |
| **Installer Linux** | ✅ live getestet: Installation, Update, echtes Whisper-Transkript, MCP mit Claude Code, Export |
| **Installer macOS / Windows** | ⚠️ nicht auf echten Rechnern getestet; Windows-Download-Schritte in PowerShell geprüft |
| Weg A mit **Claude Code** | ✅ live getestet (echte CLI, gültige Änderung im Beispielprojekt) |
| Weg A mit **Codex** | ⚠️ nur mit nachgebauter CLI getestet, nicht live |
| Weg B mit **Claude Code** über HTTP | ✅ live getestet (Projekt anlegen, Facecam importieren und einfügen, Titel setzen) |
| Live-Abgleich im Editor | ✅ im echten Browser getestet |
| Regie-Ablauf mit `look` (Claude Code) | ✅ live getestet: das Showcase im README ist so entstanden, End-Bewertung 8–9 |
| Selbstkritik im Editor-Chat (Claude Code) | ✅ live getestet; mit **Codex** nicht getestet (Codex bekommt die Frames per `--image`) |
| Kie-MCP-Erkennung | ✅ mit Konfig-Dateien getestet; Kie-Guthaben mit echtem Key nicht getestet |
| stdio-Brücke | ✅ Protokoll getestet; mit Codex und Hermes noch **nicht** live |
| **Hermes** | ⚠️ nicht live getestet. Heißen die Felder in deiner Version anders, schau in die Hermes-Doku |

**Bekannte Grenzen**

- Ändern du und die KI **gleichzeitig** dasselbe Projekt, gewinnt die letzte Speicherung.
- Der Editor übernimmt Änderungen von außen nur, solange du gerade nichts Ungespeichertes hast.
