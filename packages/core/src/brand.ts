// Brand kit: your colors, fonts and logo on every video.
// A brand is stored once on the server (several are possible). Applying it to a project only produces
// patch ops: palette, fonts of the text layers, meta.brand (what the AI and the templates read) and an
// optional logo bug. Everything the brand replaced is remembered in meta.brand.prev, so switching the brand
// off restores the project exactly.

import { compositionDuration } from "./timing.ts";
import { STYLES } from "./styles.ts";
import type { PatchOp } from "./patch.ts";
import { isVisual, type ImageLayer, type MotionSpec } from "./types.ts";

export interface BrandColors {
  /** Main brand color (buttons, highlights). */
  accent: string;
  /** Second brand color. */
  accent2?: string;
  /** Background. Default: dark (#0F1115) or the project's background. */
  bg?: string;
  /** Text. Default: white or near-black, whatever reads better on bg. */
  ink?: string;
  /** Cards and panels. Default: bg mixed 8 % toward ink. */
  surface?: string;
  /** Secondary text. Default: ink mixed 45 % toward bg. */
  muted?: string;
}

export interface BrandFont {
  family: string;
  weight?: number;
  /** Own font file (uploaded, not on Google Fonts): file name inside the brand folder. */
  file?: string;
}

export type Corner = "tl" | "tr" | "bl" | "br";

export interface Brand {
  id: string;
  name: string;
  colors: BrandColors;
  fonts: { display?: BrandFont; body?: BrandFont };
  /** Logo file name inside the brand folder. */
  logo?: string;
  /** Logo width / height. */
  logoAspect?: number;
  tagline?: string;
  website?: string;
  /** Social handle, e.g. @aiianer. */
  handle?: string;
  /** Small logo in a corner through the whole video. */
  watermark?: { corner: Corner; opacity?: number; size?: number } | null;
}

/** What a project knows about its brand (in spec.meta.brand). */
export interface BrandMeta {
  id: string;
  name: string;
  /** Logo inside the project (asset path). */
  logo?: string;
  logoAspect?: number;
  tagline?: string;
  website?: string;
  handle?: string;
  display?: string;
  body?: string;
  /** Before the brand: restored when it is switched off. */
  prev?: { palette?: Record<string, string>; background?: string; display?: string; body?: string; weights?: Record<string, number>; sizes?: Record<string, number> };
}

export const WATERMARK_ID = "brand-logo";

/** Brand colors → full palette, derived where the brand gives no value. Other palette keys of the project stay. */
export function brandPalette(colors: BrandColors, base: Record<string, string> = {}): Record<string, string> {
  const bg = norm(colors.bg) ?? norm(base.bg) ?? "#0F1115";
  const ink = norm(colors.ink) ?? (luminance(bg) > 0.45 ? "#111111" : "#F7F7F8");
  const out: Record<string, string> = { ...base, bg, ink, accent: norm(colors.accent) ?? base.accent ?? "#FF5A1F" };
  out.surface = norm(colors.surface) ?? mix(bg, ink, 0.08);
  out.muted = norm(colors.muted) ?? mix(ink, bg, 0.45);
  if (norm(colors.accent2)) out.accent2 = norm(colors.accent2)!;
  return out;
}

/**
 * Ops that put a brand on a project. logoPath = where the server copied the logo into the project.
 * Fonts: text that used the project's display/body font switches to the brand font (headlines stay headlines).
 */
export function brandOps(spec: MotionSpec, brand: Brand, logoPath?: string): PatchOp[] {
  const current = spec.meta.brand as BrandMeta | undefined;
  // Re-applying (or switching brands) starts from the state before any brand.
  const prev = current?.prev ?? { palette: spec.style?.palette, background: spec.canvas.background, ...fontRoles(spec) };
  const roles = current ? { display: current.display, body: current.body } : fontRoles(spec);
  const basePalette = current?.prev?.palette ?? spec.style?.palette ?? {};
  const palette = brandPalette(brand.colors, basePalette);
  const display = brand.fonts.display?.family;
  const body = brand.fonts.body?.family ?? display;
  const meta: BrandMeta = {
    id: brand.id, name: brand.name, prev,
    ...(logoPath ? { logo: logoPath, logoAspect: brand.logoAspect ?? 1 } : {}),
    ...(brand.tagline ? { tagline: brand.tagline } : {}), ...(brand.website ? { website: brand.website } : {}), ...(brand.handle ? { handle: brand.handle } : {}),
    display: display ?? roles.display, body: body ?? roles.body,
  };
  const ops: PatchOp[] = [
    { op: "style", set: { ...(spec.style ?? {}), palette } },
    { op: "meta", set: { brand: meta } },
  ];
  // Background follows the brand when it was a palette color or plain color before.
  if (!spec.canvas.background || /^\$bg$|^#/.test(spec.canvas.background)) ops.push({ op: "canvas", set: { background: "$bg" } });
  const swaps = fontSwapOps(spec, roles, { display: display ?? roles.display, body: body ?? roles.body }, { display: brand.fonts.display?.weight, body: brand.fonts.body?.weight ?? (brand.fonts.body ? undefined : brand.fonts.display?.weight) });
  // Remember the weights the brand overwrites (first brand wins: that is the original look).
  const weights = { ...(prev.weights ?? {}) };
  for (const o of swaps) {
    if (o.op !== "set" || o.path !== "style.fontWeight" || o.id in weights) continue;
    const l = spec.layers.find((x) => x.id === o.id);
    if (l && (l.type === "text" || l.type === "captions")) weights[o.id] = l.style.fontWeight ?? 400;
  }
  if (Object.keys(weights).length) meta.prev = { ...prev, weights };
  ops.push(...swaps);
  // Starter headlines were sized for the style's font; a wider brand font must not make them wrap.
  if (display && roles.display && display !== roles.display) {
    const k = Math.min(1, widthOf(roles.display) / widthOf(display));
    const sizes = { ...(meta.prev?.sizes ?? {}) };
    if (k < 0.98) for (const l of spec.layers) {
      if (l.type !== "text" || !l.meta?.placeholder || l.style.fontFamily !== roles.display) continue;
      if (!(l.id in sizes)) sizes[l.id] = l.style.fontSize;
      ops.push({ op: "set", id: l.id, path: "style.fontSize", value: Math.round(l.style.fontSize * k) });
    }
    if (Object.keys(sizes).length) meta.prev = { ...(meta.prev ?? prev), sizes };
  }
  ops.push(...watermarkOps(spec, brand, meta));
  return ops;
}

/** Ops that take the brand off again: palette, background and fonts as before, logo bug removed. */
export function unbrandOps(spec: MotionSpec): PatchOp[] {
  const b = spec.meta.brand as BrandMeta | undefined;
  if (!b) return [];
  const ops: PatchOp[] = [];
  if (b.prev?.palette) ops.push({ op: "style", set: { ...(spec.style ?? {}), palette: b.prev.palette } });
  if (b.prev?.background !== undefined) ops.push({ op: "canvas", set: { background: b.prev.background } });
  ops.push(...fontSwapOps(spec, { display: b.display, body: b.body }, { display: b.prev?.display, body: b.prev?.body }));
  for (const [id, v] of Object.entries(b.prev?.sizes ?? {})) if (spec.layers.some((l) => l.id === id)) ops.push({ op: "set", id, path: "style.fontSize", value: v });
  for (const [id, w] of Object.entries(b.prev?.weights ?? {})) if (spec.layers.some((l) => l.id === id)) ops.push({ op: "set", id, path: "style.fontWeight", value: w });
  if (spec.layers.some((l) => l.id === WATERMARK_ID)) ops.push({ op: "remove", id: WATERMARK_ID });
  ops.push({ op: "meta", set: { brand: null } });
  return ops;
}

/** The logo bug always spans the whole video: call after changes (the server does it on every save). */
export function syncWatermark(spec: MotionSpec): PatchOp[] {
  const l = spec.layers.find((x) => x.id === WATERMARK_ID);
  if (!l) return [];
  const others: MotionSpec = { ...spec, layers: spec.layers.filter((x) => x.id !== WATERMARK_ID) };
  const total = Math.max(0.1, Math.round(compositionDuration(others) * 1000) / 1000);
  return Math.abs(l.duration - total) > 1e-3 || l.start !== 0 ? [{ op: "set", id: WATERMARK_ID, path: "duration", value: total }, { op: "set", id: WATERMARK_ID, path: "start", value: 0 }] : [];
}

function watermarkOps(spec: MotionSpec, brand: Brand, meta: BrandMeta): PatchOp[] {
  const has = spec.layers.some((l) => l.id === WATERMARK_ID);
  if (!brand.watermark || !meta.logo) return has ? [{ op: "remove", id: WATERMARK_ID }] : [];
  const { width: W, height: H } = spec.canvas;
  const short = Math.min(W, H);
  const h = Math.round(short * (brand.watermark.size ?? 0.07));
  const w = Math.round(h * (meta.logoAspect ?? 1));
  // Vertical videos: platform buttons sit at the bottom and the right edge, so the bug keeps more distance.
  const mx = Math.round(short * (H > W ? 0.07 : 0.045));
  const my = Math.round(H > W ? H * 0.09 : short * 0.045);
  const c = brand.watermark.corner;
  const x = c === "tl" || c === "bl" ? mx : W - mx - w;
  const y = c === "tl" || c === "tr" ? my : H - my - h;
  const layer: ImageLayer = {
    id: WATERMARK_ID, name: `${brand.name} Logo`, type: "image", src: meta.logo, fit: "contain", track: 900, start: 0,
    duration: Math.max(0.1, compositionDuration(spec)), fixed: true, locked: true,
    frame: { x, y, w, h, opacity: brand.watermark.opacity ?? 0.85 }, in: { type: "fade", duration: 0.6 }, meta: { brand: "watermark" },
  };
  const ops: PatchOp[] = [];
  if (has) ops.push({ op: "remove", id: WATERMARK_ID });
  ops.push({ op: "add", layer });
  return ops;
}

/** Which font is the headline font and which the body font? Biggest text = display, most text = body. */
function fontRoles(spec: MotionSpec): { display?: string; body?: string } {
  const sizes = new Map<string, { max: number; chars: number }>();
  for (const l of spec.layers) {
    if (!isVisual(l) || (l.type !== "text" && l.type !== "captions")) continue;
    const f = l.style.fontFamily;
    if (!f) continue;
    const e = sizes.get(f) ?? { max: 0, chars: 0 };
    e.max = Math.max(e.max, l.style.fontSize);
    e.chars += l.type === "text" ? l.text.length : 40;
    sizes.set(f, e);
  }
  const list = [...sizes.entries()];
  if (!list.length) return {};
  const display = list.sort((a, b) => b[1].max - a[1].max)[0][0];
  const rest = list.filter(([f]) => f !== display);
  const body = rest.length ? rest.sort((a, b) => b[1].chars - a[1].chars)[0][0] : display;
  return { display, body };
}

/**
 * Text in the old display font gets the new display font, text in the old body font the new body font.
 * When one font did both jobs, the size decides: big text (≥ 5.5 % of the short canvas side) is a headline.
 */
function fontSwapOps(spec: MotionSpec, from: { display?: string; body?: string }, to: { display?: string; body?: string }, weight: { display?: number; body?: number } = {}): PatchOp[] {
  const ops: PatchOp[] = [];
  const big = Math.min(spec.canvas.width, spec.canvas.height) * 0.055;
  for (const l of spec.layers) {
    if (!isVisual(l) || (l.type !== "text" && l.type !== "captions")) continue;
    const f = l.style.fontFamily;
    if (!f) continue;
    const isD = f === from.display;
    const isB = f === from.body;
    if (!isD && !isB) continue;
    const role = isD && isB ? (l.type === "text" && l.style.fontSize >= big ? "display" : "body") : isD ? "display" : "body";
    const target = to[role];
    if (target && target !== f) ops.push({ op: "set", id: l.id, path: "style.fontFamily", value: target });
    // The brand's weight wins where it names one (a brand font may not have the style's 800).
    if (weight[role] && l.style.fontWeight !== weight[role]) ops.push({ op: "set", id: l.id, path: "style.fontWeight", value: weight[role] });
  }
  return ops;
}

/** Measured width of a display font (em per character) when it belongs to a style, else a safe guess. */
function widthOf(family: string): number {
  return STYLES.find((s) => s.fonts.display === family)?.fonts.displayWidth ?? 0.75;
}

function norm(c?: string): string | undefined {
  if (!c) return undefined;
  const v = c.trim();
  if (/^#[0-9a-f]{3}$/i.test(v)) return `#${[...v.slice(1)].map((x) => x + x).join("")}`.toUpperCase();
  return /^#[0-9a-f]{6}$/i.test(v) ? v.toUpperCase() : undefined;
}

function rgb(hex: string): number[] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
}

function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function mix(a: string, b: string, t: number): string {
  const x = rgb(a);
  const y = rgb(b);
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}
