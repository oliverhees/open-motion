# Deploy Open Motion with Coolify

*[Deutsche Version](de/coolify.md)*

Two services from one image, one shared data volume:

| Service | Job | Domain |
| --- | --- | --- |
| `app` | editor, API, login | yes, e.g. `motion.example.com` |
| `worker` | export (headless Chrome) and transcription | no |

## 1. Prepare

- [ ] Push the repo to your Git (GitHub, Forgejo …), including `examples/explainer/assets/`
- [ ] Pick a **strong password** (16+ characters)

## 2. Create in Coolify

- [ ] **+ New → Resource → Docker Compose** (from your Git repo)
- [ ] Compose file: `docker-compose.yml`
- [ ] Environment variables:
  - `OPENMOTION_PASSWORD` = your password (**required**, the app deliberately refuses to start without it)
  - `OPENMOTION_WORKER_VARIANT` = `whisper` if you want local Whisper (optional, bigger image)
- [ ] Service **app**: set your domain, port **4317**
- [ ] Service **worker**: no domain

## 3. Deploy

- [ ] Click **Deploy**. The first build takes about 5–10 minutes because Chrome is baked into the image (longer with Whisper).
- [ ] Both services should become **healthy**.

## 4. Set up

- [ ] Open your domain → sign in with the password
- [ ] ⚙ Settings → add your API keys → **Save**
- [ ] 🩺 **Test now** → "Render worker: online" must be ✓
- [ ] For AIs (MCP, Hermes): create a token under "Access for AIs" and **copy it right away**

## 5. Good to know

- **Resources:** give the worker a CPU or RAM limit in Coolify and Open Motion detects it automatically and plans its render workers accordingly.
- **Backup:** everything lives in the `openmotion-data` volume (projects, keys, tokens, chat, exports).
- **More workers:** a second worker service on the same volume shares the queue automatically.
- **Security:** session cookie `HttpOnly`, `SameSite=Lax`, `Secure` behind HTTPS. Keys and tokens are stored with file mode 600; tokens only as hashes.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| App won't start: "OPENMOTION_PASSWORD missing" | Set the variable in Coolify and redeploy |
| Export stays "queued" | Check the worker logs; 🩺 shows "Render worker offline" |
| Chrome crashes during export | `shm_size: 1gb` is set; give the worker more RAM for 4K |
| Signed out right after signing in | Is the domain served over HTTPS? Otherwise set `OPENMOTION_COOKIE_SECURE=0` |
| Need more details | Set `OPENMOTION_DEBUG=1`; the log is written to `/data/logs/` |

## Test locally with Docker

```bash
OPENMOTION_PASSWORD=your-password docker compose -f docker-compose.yml -f docker-compose.local.yml up --build
# → http://localhost:4317
```
