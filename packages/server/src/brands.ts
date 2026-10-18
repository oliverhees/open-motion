// Brand kits on the server: data/brands/<id>/brand.json, logo and own font files next to it.
// applyBrand() copies logo and fonts into a project and saves the brand ops (palette, fonts, logo bug).

import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { applyPatch, brandOps, unbrandOps, type Brand, type BrandColors, type BrandFont, type Corner, type FontFace, type MotionSpec, type PatchOp } from "@openmotion/core";
import { ensureFonts } from "./fonts.ts";
import { HttpError, type Store } from "./store.ts";

const ID_RE = /^[a-z0-9][a-z0-9-]{0,60}$/;
const HEX = /^#[0-9a-f]{3}([0-9a-f]{3})?$/i;
const LOGO_TYPES: Record<string, string> = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/svg+xml": ".svg" };
const FONT_EXT = [".woff2", ".woff", ".ttf", ".otf"];

export type BrandInput = Partial<Omit<Brand, "id" | "logo" | "logoAspect">>;

export class BrandStore {
  readonly root: string;
  constructor(dataDir: string) {
    this.root = path.resolve(dataDir, "brands");
  }

  dir(id: string): string {
    if (!ID_RE.test(id)) throw new HttpError(400, `Invalid brand id "${id}"`);
    const d = path.join(this.root, id);
    if (!existsSync(path.join(d, "brand.json"))) throw new HttpError(404, `Brand "${id}" not found. list_brands shows the existing ones.`);
    return d;
  }

  async list(): Promise<Brand[]> {
    if (!existsSync(this.root)) return [];
    const out: Brand[] = [];
    for (const e of await readdir(this.root, { withFileTypes: true })) {
      if (!e.isDirectory() || !ID_RE.test(e.name)) continue;
      try { out.push(JSON.parse(await readFile(path.join(this.root, e.name, "brand.json"), "utf8")) as Brand); } catch { /* skip broken */ }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  async get(id: string): Promise<Brand> {
    return JSON.parse(await readFile(path.join(this.dir(id), "brand.json"), "utf8")) as Brand;
  }

  async create(input: BrandInput): Promise<Brand> {
    const name = clean(input.name, 120) || "Brand";
    const id = `${slug(name)}-${randomBytes(2).toString("hex")}`;
    await mkdir(path.join(this.root, id), { recursive: true });
    const brand: Brand = { id, name, colors: { accent: "#FF5A1F" }, fonts: {} };
    await this.write(merge(brand, input));
    return this.get(id);
  }

  async update(id: string, input: BrandInput): Promise<Brand> {
    const cur = await this.get(id);
    await this.write(merge(cur, input));
    return this.get(id);
  }

  async remove(id: string): Promise<void> {
    await rm(this.dir(id), { recursive: true, force: true });
  }

  /** Logo upload (PNG, JPEG, WebP or SVG). The aspect ratio is read from the file. */
  async setLogo(id: string, data: Buffer, mime: string): Promise<Brand> {
    const ext = LOGO_TYPES[mime.split(";")[0].trim().toLowerCase()];
    if (!ext) throw new HttpError(415, "Logo must be PNG, JPEG, WebP or SVG.");
    const size = imageSize(data);
    if (!size) throw new HttpError(422, "Could not read the logo's size. Is the file a valid image?");
    const d = this.dir(id);
    const cur = await this.get(id);
    if (cur.logo) await rm(path.join(d, cur.logo), { force: true });
    const file = `logo-${randomBytes(3).toString("hex")}${ext}`;
    await writeFile(path.join(d, file), data);
    await this.write({ ...cur, logo: file, logoAspect: Math.round((size.w / size.h) * 1000) / 1000 });
    return this.get(id);
  }

  /** Own font file for the display or body slot (not on Google Fonts). */
  async setFont(id: string, slot: "display" | "body", data: Buffer, fileName: string, family: string, weight?: number): Promise<Brand> {
    const ext = path.extname(fileName).toLowerCase();
    if (!FONT_EXT.includes(ext)) throw new HttpError(415, "Font must be WOFF2, WOFF, TTF or OTF.");
    const sig = data.subarray(0, 4).toString("latin1");
    if (!["wOF2", "wOFF", "OTTO", "true", "\u0000\u0001\u0000\u0000"].includes(sig)) throw new HttpError(422, "This file is not a font.");
    const d = this.dir(id);
    const cur = await this.get(id);
    const file = `font-${slot}-${randomBytes(3).toString("hex")}${ext}`;
    await writeFile(path.join(d, file), data);
    const old = cur.fonts[slot]?.file;
    if (old) await rm(path.join(d, old), { force: true });
    const fam = clean(family, 80) || path.basename(fileName, ext).replace(/[-_]+/g, " ");
    await this.write({ ...cur, fonts: { ...cur.fonts, [slot]: { family: fam, ...(weight ? { weight } : {}), file } } });
    return this.get(id);
  }

  private async write(b: Brand) {
    const d = path.join(this.root, b.id);
    await mkdir(d, { recursive: true });
    const tmp = path.join(d, `brand.${randomBytes(3).toString("hex")}.tmp`);
    await writeFile(tmp, JSON.stringify(b, null, 2) + "\n");
    await rename(tmp, path.join(d, "brand.json"));
  }
}

/**
 * Puts a brand on a project (or takes it off with brandId null) and saves.
 * Logo and own fonts are copied into the project; Google fonts are downloaded like any other font.
 */
export async function applyBrand(store: Store, brands: BrandStore, projectId: string, brandId: string | null): Promise<{ spec: MotionSpec; missingFonts: string[] }> {
  const dir = store.dir(projectId);
  let { spec } = await store.read(projectId);
  if (!brandId) {
    spec = applyPatch(spec, unbrandOps(spec)).spec;
    await store.saveSpec(projectId, spec);
    return { spec, missingFonts: [] };
  }
  const brand = await brands.get(brandId);
  const bdir = brands.dir(brandId);
  let logoPath: string | undefined;
  if (brand.logo && existsSync(path.join(bdir, brand.logo))) {
    logoPath = `assets/images/brand-${brand.id}${path.extname(brand.logo)}`;
    await mkdir(path.join(dir, "assets/images"), { recursive: true });
    await copyFile(path.join(bdir, brand.logo), path.join(dir, logoPath));
  }
  const ops: PatchOp[] = brandOps(spec, brand, logoPath);
  spec = applyPatch(spec, ops).spec;
  // Own font files: copied into the project and registered, so they are not looked up on Google Fonts.
  const faces: FontFace[] = [];
  for (const slot of ["display", "body"] as const) {
    const f: BrandFont | undefined = brand.fonts[slot];
    if (!f?.file || !existsSync(path.join(bdir, f.file))) continue;
    const rel = `assets/fonts/brand-${brand.id}-${slot}${path.extname(f.file)}`;
    await mkdir(path.join(dir, "assets/fonts"), { recursive: true });
    await copyFile(path.join(bdir, f.file), path.join(dir, rel));
    if (!(spec.style?.fonts ?? []).some((x) => x.src === rel)) faces.push({ family: f.family, src: rel, ...(f.weight ? { weight: String(f.weight) } : {}) });
  }
  if (faces.length) spec = applyPatch(spec, [{ op: "style", set: { ...(spec.style ?? {}), fonts: [...(spec.style?.fonts ?? []), ...faces] } }]).spec;
  let missingFonts: string[] = [];
  if (process.env.OPENMOTION_NO_FONT_DOWNLOAD !== "1") {
    const r = await ensureFonts(spec, dir).catch(() => null);
    if (r?.op) spec = applyPatch(spec, [r.op]).spec;
    missingFonts = r?.missing ?? [];
  }
  await store.saveSpec(projectId, spec);
  return { spec, missingFonts };
}

/** Width and height of a PNG, JPEG, WebP, GIF or SVG (from the header, no decoding). */
export function imageSize(b: Buffer): { w: number; h: number } | null {
  try {
    if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
    if (b.toString("latin1", 0, 3) === "GIF") return { w: b.readUInt16LE(6), h: b.readUInt16LE(8) };
    if (b[0] === 0xff && b[1] === 0xd8) {
      let p = 2;
      while (p < b.length) {
        if (b[p] !== 0xff) return null;
        const m = b[p + 1];
        const len = b.readUInt16BE(p + 2);
        if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: b.readUInt16BE(p + 5), w: b.readUInt16BE(p + 7) };
        p += 2 + len;
      }
      return null;
    }
    if (b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP") {
      const kind = b.toString("latin1", 12, 16);
      if (kind === "VP8X") return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) };
      if (kind === "VP8 ") return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
      if (kind === "VP8L") { const n = b.readUInt32LE(21); return { w: 1 + (n & 0x3fff), h: 1 + ((n >> 14) & 0x3fff) }; }
      return null;
    }
    const txt = b.subarray(0, 4096).toString("utf8");
    if (/<svg[\s>]/i.test(txt)) {
      const tag = /<svg\b[^>]*>/i.exec(txt)?.[0] ?? "";
      const vb = /viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(tag);
      if (vb) return { w: Number(vb[1]), h: Number(vb[2]) };
      const w = /\swidth\s*=\s*["']([\d.]+)/i.exec(tag);
      const h = /\sheight\s*=\s*["']([\d.]+)/i.exec(tag);
      if (w && h) return { w: Number(w[1]), h: Number(h[1]) };
    }
    return null;
  } catch {
    return null;
  }
}

function merge(cur: Brand, input: BrandInput): Brand {
  const out: Brand = { ...cur };
  if (input.name !== undefined) out.name = clean(input.name, 120) || cur.name;
  if (input.colors) {
    const c: BrandColors = { ...cur.colors };
    for (const k of ["accent", "accent2", "bg", "ink", "surface", "muted"] as const) {
      const v = input.colors[k];
      if (v === undefined) continue;
      if (v === null || v === "") { if (k !== "accent") delete c[k]; continue; }
      if (!HEX.test(v)) throw new HttpError(422, `Color "${k}" must be a hex color like #FF5A1F, got "${v}".`);
      c[k] = v.toUpperCase();
    }
    out.colors = c;
  }
  if (input.fonts) {
    const f = { ...cur.fonts };
    for (const slot of ["display", "body"] as const) {
      const v = input.fonts[slot];
      if (v === undefined) continue;
      if (v === null || !v.family?.trim()) { delete f[slot]; continue; }
      const family = clean(v.family, 80);
      if (/[;{}<>"]/.test(family)) throw new HttpError(422, "Font family: name only, e.g. \"Inter\".");
      // A new Google font name replaces an uploaded file of the same slot.
      const keepFile = cur.fonts[slot]?.file && cur.fonts[slot]?.family === family ? cur.fonts[slot]!.file : undefined;
      f[slot] = { family, ...(v.weight ? { weight: Math.min(900, Math.max(100, Math.round(v.weight / 100) * 100)) } : {}), ...(keepFile ? { file: keepFile } : {}) };
    }
    out.fonts = f;
  }
  for (const k of ["tagline", "website", "handle"] as const) if (input[k] !== undefined) { const v = clean(input[k] ?? "", 300); if (v) out[k] = v; else delete out[k]; }
  if (input.watermark !== undefined) {
    const w = input.watermark;
    out.watermark = w && ["tl", "tr", "bl", "br"].includes(w.corner)
      ? { corner: w.corner as Corner, opacity: clamp(w.opacity ?? 0.85, 0.1, 1), size: clamp(w.size ?? 0.07, 0.03, 0.2) }
      : null;
  }
  return out;
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, Number(v) || a));
const clean = (v: string | undefined, max: number) => (v ?? "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, max);
function slug(s: string): string {
  return s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "brand";
}
