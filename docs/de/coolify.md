# Open Motion in Coolify

Zwei Dienste aus einem Image, ein gemeinsamer Datenordner:

| Dienst | Aufgabe | Domain |
| --- | --- | --- |
| `app` | Editor, API, Login | ja, z. B. `motion.deinedomain.de` |
| `worker` | Export (Headless-Chrome) und Transkription | nein |

## 1. Vorbereiten

- [ ] Repo in dein Git (Forgejo oder GitHub) pushen, inklusive `examples/explainer/assets/`
- [ ] Ein **starkes Passwort** ausdenken (mind. 16 Zeichen)

## 2. In Coolify anlegen

- [ ] **+ New → Resource → Docker Compose** (aus dem Git-Repo)
- [ ] Compose-Datei: `docker-compose.yml`
- [ ] Umgebungsvariablen:
  - `OPENMOTION_PASSWORD` = dein Passwort (**Pflicht**, sonst startet die App bewusst nicht)
  - `OPENMOTION_WORKER_VARIANT` = `whisper`, wenn du lokales Whisper willst (optional, größeres Image)
- [ ] Beim Dienst **app** die Domain eintragen, Port **4317**
- [ ] Beim Dienst **worker** keine Domain

## 3. Deployen

- [ ] **Deploy** klicken. Der erste Build dauert etwa 5 bis 10 Minuten, weil Chrome ins Image geladen wird. Mit Whisper dauert es länger.
- [ ] Beide Dienste sollten nach einer Weile **healthy** sein.

## 4. Einrichten

- [ ] Domain öffnen → mit dem Passwort anmelden
- [ ] ⚙ Einstellungen → Keys eintragen → **Speichern**
- [ ] 🩺 **Jetzt testen** → „Render-Worker: online" muss ✓ sein
- [ ] Für KIs (MCP, Hermes): unter „Zugänge für KIs" ein Token erstellen und **sofort kopieren**

## 5. Gut zu wissen

- **Ressourcen:** Wenn du dem Worker in Coolify ein CPU- oder RAM-Limit gibst, erkennt Open Motion das automatisch und plant die Render-Worker passend.
- **Backup:** Alles liegt im Volume `openmotion-data` (Projekte, Keys, Tokens, Chat, Exporte). Dieses Volume sichern.
- **Mehrere Worker:** Ein zweiter Worker-Dienst mit demselben Volume teilt sich die Warteschlange automatisch.
- **Sicherheit:** Das Session-Cookie ist `HttpOnly`, `SameSite=Lax` und hinter HTTPS `Secure`. Keys und Tokens liegen mit Dateirechten 600 im Volume, Tokens nur als Hash.

## Fehlersuche

| Problem | Lösung |
| --- | --- |
| App startet nicht: „OPENMOTION_PASSWORD fehlt" | Variable in Coolify setzen, neu deployen |
| Export bleibt auf „Warteschlange" | Worker-Logs ansehen, 🩺 zeigt „Render-Worker offline" |
| Chrome stürzt beim Export ab | `shm_size: 1gb` ist gesetzt. Bei 4K mehr RAM für den Worker geben |
| Login klappt, aber sofort wieder abgemeldet | Läuft die Domain über HTTPS? Sonst `OPENMOTION_COOKIE_SECURE=0` |
| Mehr Details nötig | `OPENMOTION_DEBUG=1` setzen, dann liegt das Log in `/data/logs/` |

## Lokal mit Docker testen

```bash
OPENMOTION_PASSWORD=dein-passwort docker compose -f docker-compose.yml -f docker-compose.local.yml up --build
# → http://localhost:4317
```
