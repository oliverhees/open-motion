// Google Fonts on demand: any family a text layer names is downloaded once into assets/fonts/
// and registered in style.fonts. Preview and export then use the exact same file, offline.
// Only the "latin" subset is kept (covers German incl. ä ö ü ß and €).

import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FontFace, MotionSpec, PatchOp } from "@openmotion/core";
import { httpFetch } from "./http.ts";

type Fetch = typeof fetch;

const GENERIC = new Set(["system-ui", "sans-serif", "serif", "monospace", "cursive", "fantasy", "ui-sans-serif", "ui-serif", "ui-monospace", "inherit", "initial"]);
// Google serves woff2 only to browsers it recognises.
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/** Families used by text layers that are not in style.fonts yet. */
export function missingFamilies(spec: MotionSpec): string[] {
  const have = new Set((spec.style?.fonts ?? []).map((f) => f.family.toLowerCase()));
  const want = new Set<string>();
  for (const l of spec.layers) {
    if ((l.type !== "text" && l.type !== "captions") || !l.style.fontFamily) continue;
    const fam = l.style.fontFamily.split(",")[0].trim().replace(/^["']|["']$/g, "");
    if (fam && !GENERIC.has(fam.toLowerCase()) && !have.has(fam.toLowerCase())) want.add(fam);
  }
  return [...want];
}

/**
 * Downloads missing families and returns the patch that registers them (or null if nothing to do).
 * Unknown families are reported in `missing`; the text then falls back to the system font.
 */
export async function ensureFonts(spec: MotionSpec, projectDir: string, f: Fetch = httpFetch): Promise<{ op: PatchOp | null; added: string[]; missing: string[] }> {
  const families = missingFamilies(spec).slice(0, 6);
  if (!families.length) return { op: null, added: [], missing: [] };
  const faces: FontFace[] = [];
  const added: string[] = [];
  const missing: string[] = [];
  for (const fam of families) {
    try {
      const got = await download(fam, projectDir, f);
      if (got.length) { faces.push(...got); added.push(fam); } else missing.push(fam);
    } catch {
      missing.push(fam);
    }
  }
  if (!faces.length) return { op: null, added, missing };
  return { op: { op: "style", set: { ...(spec.style ?? {}), fonts: [...(spec.style?.fonts ?? []), ...faces] } }, added, missing };
}

/**
 * One woff2 of a family for UI previews (style cards), cached in <cacheDir>/assets/fonts.
 * Served by our own server, so the browser never talks to Google (no IP leaks, works offline once cached).
 */
export async function previewFont(family: string, cacheDir: string, f: Fetch = httpFetch): Promise<string | null> {
  if (!/^[A-Za-z0-9 ]{2,60}$/.test(family)) return null;
  const faces = await download(family, cacheDir, f).catch(() => [] as FontFace[]);
  const pick = faces.find((x) => x.style === "normal") ?? faces[0];
  return pick ? path.join(cacheDir, pick.src) : null;
}

async function download(family: string, projectDir: string, f: Fetch): Promise<FontFace[]> {
  const name = family.trim().replace(/ +/g, "+");
  // Variable fonts first (one file for all weights), then fixed weights.
  const queries = [`${name}:ital,wght@0,100..900;1,100..900`, `${name}:wght@100..900`, `${name}:ital,wght@0,400;0,700;1,400;1,700`, `${name}:wght@300;400;500;600;700;800;900`, `${name}:ital@0;1`, name];
  let css = "";
  for (const q of queries) {
    const r = await f(`https://fonts.googleapis.com/css2?family=${q}&display=block`, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(20_000) });
    if (r.ok) { css = await r.text(); break; }
  }
  if (!css) return [];
  const blocks = [...css.matchAll(/\/\*\s*([\w-]+)\s*\*\/\s*@font-face\s*\{([^}]*)\}/g)].filter((m) => m[1] === "latin");
  const dir = path.join(projectDir, "assets", "fonts");
  await mkdir(dir, { recursive: true });
  const slug = family.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const out: FontFace[] = [];
  for (const [, , body] of blocks) {
    const url = /src:\s*url\(([^)]+\.woff2)\)/.exec(body)?.[1];
    const style = /font-style:\s*(\w+)/.exec(body)?.[1] === "italic" ? "italic" : "normal";
    const weight = /font-weight:\s*([\d ]+);/.exec(body)?.[1]?.trim() ?? "400";
    if (!url || !/^https:\/\/fonts\.gstatic\.com\//.test(url)) continue;
    const file = `${slug}-${style}-${weight.replace(/ /g, "-")}.woff2`;
    const abs = path.join(dir, file);
    if (!existsSync(abs)) {
      const r = await f(url, { signal: AbortSignal.timeout(30_000) });
      if (!r.ok) continue;
      await writeFile(abs, Buffer.from(await r.arrayBuffer()));
    }
    out.push({ family, src: `assets/fonts/${file}`, weight: /^\d+ \d+$/.test(weight) ? weight : Number(weight), style });
  }
  return out;
}
