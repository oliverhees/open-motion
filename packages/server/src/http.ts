// fetch with an optional debug log (OPENMOTION_DEBUG=1). Logs URL, status, time and the start of the answer.
// Never logs headers or request bodies, so keys cannot leak into the log.
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

export const httpFetch: typeof fetch = async (input, init) => {
  const t0 = Date.now();
  const url = String(input instanceof Request ? input.url : input);
  try {
    const res = await fetch(input, init);
    if (process.env.OPENMOTION_DEBUG === "1") {
      void res.clone().text().then((body) => log(`${init?.method ?? "GET"} ${clean(url)} → ${res.status} in ${Date.now() - t0} ms\n  ${body.replace(/"b64_json"\s*:\s*"[^"]{40}[^"]*"/g, '"b64_json":"…"').replace(/data:image\/[a-z]+;base64,[A-Za-z0-9+/=]{40,}/g, "data:image/…").slice(0, 800)}`)).catch(() => {});
    }
    return res;
  } catch (e) {
    if (process.env.OPENMOTION_DEBUG === "1") void log(`${init?.method ?? "GET"} ${clean(url)} → NETZWERKFEHLER nach ${Date.now() - t0} ms: ${(e as Error).message}`);
    throw e;
  }
};

const clean = (u: string) => u.replace(/([?&](key|api_key|token)=)[^&]+/gi, "$1***");

async function log(line: string) {
  const dir = process.env.OPENMOTION_LOG_DIR ?? path.resolve("data/logs");
  await mkdir(dir, { recursive: true });
  await appendFile(path.join(dir, `api-${new Date().toISOString().slice(0, 10)}.log`), `[${new Date().toISOString()}] ${line}\n`);
}
