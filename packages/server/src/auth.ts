// Built-in protection.
//  - Editor: one password (OPENMOTION_PASSWORD) → session cookie (HttpOnly, 30 days).
//  - AIs (MCP, scripts, Hermes …): API tokens, created in the editor, shown once, stored only as hash.
//  - Cookie requests that change data need the header  x-om: 1  (CSRF protection).

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type http from "node:http";

export interface TokenInfo { id: string; name: string; prefix: string; createdAt: string; lastUsed?: string }
interface TokenRec extends TokenInfo { hash: string }
export interface Who { ok: boolean; via?: "open" | "session" | "token"; token?: string }

const SESSION_DAYS = 30;
const sha = (s: string) => createHash("sha256").update(s).digest();

export class Auth {
  private dir: string;
  private tokens: TokenRec[] = [];
  private sessions = new Map<string, number>();
  private attempts = new Map<string, { n: number; first: number }>();
  private loaded = false;
  readonly password: string | undefined;

  constructor(dataDir: string, password = process.env.OPENMOTION_PASSWORD) {
    this.dir = path.resolve(dataDir);
    this.password = password || undefined;
  }

  get enabled(): boolean { return !!this.password; }

  private async load() {
    if (this.loaded) return;
    this.loaded = true;
    const t = path.join(this.dir, "tokens.json");
    const s = path.join(this.dir, "sessions.json");
    if (existsSync(t)) this.tokens = JSON.parse(await readFile(t, "utf8"));
    if (existsSync(s)) for (const [k, v] of Object.entries(JSON.parse(await readFile(s, "utf8")) as Record<string, number>)) if (v > Date.now()) this.sessions.set(k, v);
  }

  private async save(name: "tokens" | "sessions") {
    await mkdir(this.dir, { recursive: true });
    const file = path.join(this.dir, `${name}.json`);
    const data = name === "tokens" ? this.tokens : Object.fromEntries(this.sessions);
    await writeFile(`${file}.tmp`, JSON.stringify(data, null, 2), { mode: 0o600 });
    await rename(`${file}.tmp`, file);
    await chmod(file, 0o600);
  }

  /** Password login with a simple brute-force brake (10 tries per 15 minutes and IP). */
  async login(password: string, ip: string): Promise<string | null | "locked"> {
    await this.load();
    const a = this.attempts.get(ip);
    const now = Date.now();
    if (a && now - a.first < 15 * 60_000 && a.n >= 10) return "locked";
    if (!this.password || !timingSafeEqual(sha(password), sha(this.password))) {
      this.attempts.set(ip, a && now - a.first < 15 * 60_000 ? { n: a.n + 1, first: a.first } : { n: 1, first: now });
      return null;
    }
    this.attempts.delete(ip);
    const sid = randomBytes(32).toString("hex");
    this.sessions.set(sha(sid).toString("hex"), now + SESSION_DAYS * 86_400_000);
    await this.save("sessions");
    return sid;
  }

  async logout(req: http.IncomingMessage) {
    await this.load();
    const sid = cookie(req, "om_session");
    if (sid && this.sessions.delete(sha(sid).toString("hex"))) await this.save("sessions");
  }

  async who(req: http.IncomingMessage, pathToken?: string): Promise<Who> {
    await this.load();
    const bearer = pathToken ?? /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? "")?.[1];
    if (bearer) {
      const rec = await this.checkToken(bearer);
      if (rec) return { ok: true, via: "token", token: rec.name };
      return { ok: false };
    }
    if (!this.enabled) return { ok: true, via: "open" };
    const sid = cookie(req, "om_session");
    const exp = sid ? this.sessions.get(sha(sid).toString("hex")) : undefined;
    return exp && exp > Date.now() ? { ok: true, via: "session" } : { ok: false };
  }

  private async checkToken(token: string): Promise<TokenRec | undefined> {
    const h = sha(token);
    const rec = this.tokens.find((t) => timingSafeEqual(Buffer.from(t.hash, "hex"), h));
    if (rec && (!rec.lastUsed || Date.now() - Date.parse(rec.lastUsed) > 60_000)) {
      rec.lastUsed = new Date().toISOString();
      await this.save("tokens");
    }
    return rec;
  }

  async createToken(name: string): Promise<{ token: string; info: TokenInfo }> {
    await this.load();
    const token = `om_${randomBytes(24).toString("base64url")}`;
    const rec: TokenRec = { id: randomBytes(4).toString("hex"), name: name.trim().slice(0, 60) || "KI", prefix: token.slice(0, 7), createdAt: new Date().toISOString(), hash: sha(token).toString("hex") };
    this.tokens.push(rec);
    await this.save("tokens");
    const { hash: _h, ...info } = rec;
    return { token, info };
  }

  async listTokens(): Promise<TokenInfo[]> {
    await this.load();
    return this.tokens.map(({ hash: _h, ...info }) => info);
  }

  async revoke(id: string): Promise<boolean> {
    await this.load();
    const n = this.tokens.length;
    this.tokens = this.tokens.filter((t) => t.id !== id);
    if (this.tokens.length !== n) await this.save("tokens");
    return this.tokens.length !== n;
  }
}

export function cookie(req: http.IncomingMessage, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

export function sessionCookie(sid: string, req: http.IncomingMessage, clear = false): string {
  const secure = process.env.OPENMOTION_COOKIE_SECURE === "1" || req.headers["x-forwarded-proto"] === "https";
  return `om_session=${clear ? "" : sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${clear ? 0 : SESSION_DAYS * 86400}${secure ? "; Secure" : ""}`;
}
