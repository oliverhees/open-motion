# Security

## Found a vulnerability?

Please do **not** open a public issue. Instead use:

- GitHub → **Security → Report a vulnerability** (private advisory), or
- contact via [aiianer.de](https://aiianer.de)

We will get back to you as soon as possible and keep you updated until the issue is fixed.

## Supported versions

| Version | Security updates |
| --- | --- |
| Beta 0.1 (main) | ✅ |

## How Open Motion is protected

- Editor login with a password, session cookie `HttpOnly` + `SameSite=Lax` (+ `Secure` behind HTTPS), brute-force lock
- API tokens for AIs stored only as SHA-256 hashes, shown once, revocable
- Provider API keys stored with file mode 600, never sent to the browser
- CSRF protection via a custom header on cookie requests
- Path protection for project files (tested)
- AI-generated SVG is sanitized (scripts, event handlers, `foreignObject`, `javascript:`)
- Docker container runs as non-root; the app refuses to start without a password
- Debug log without headers, keys or image data

## Known limitations

- One password for everyone, no user accounts yet
- The editor preview runs the compiled composition on the same origin. Do not import projects from strangers without reviewing them.
