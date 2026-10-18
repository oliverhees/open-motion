// Template library: ready-made scenes and overlays that adapt to the project.
// Every template reads the project's format (safe areas), art direction (fonts, palette, motion signature)
// and brand (logo, handle, website, tagline) and returns plain patch ops, so it stays editable layer by layer.
//
// Scene templates add a scene after the current one. In a project with a facecam/recording running
// through (a video layer without a scene), they are laid over the recording at the playhead instead,
// as a full-screen card, so the voice keeps running.

import type { PatchOp } from "./patch.ts";
import { getStyle, STYLES, type StyleDef } from "./styles.ts";
import { brandPalette } from "./brand.ts";
import { compositionDuration, sceneTimings } from "./timing.ts";
import type { Ease, Frame, Layer, MotionSpec, Scene, ShapeLayer, SvgLayer, TextAnim, TextLayer, TextStyle, Transition, ImageLayer } from "./types.ts";

export type TemplateKind = "scene" | "overlay";
type L10n = { de: string; en: string };

export interface TemplateField {
  key: string;
  label: L10n;
  /** text = one line, lines = one entry per line, number = numeric value */
  type: "text" | "lines" | "number";
  default: L10n | ((c: TemplateCtx) => string);
  hint?: L10n;
}

export interface TemplateDef {
  id: string;
  kind: TemplateKind;
  name: L10n;
  desc: L10n;
  /** One emoji as a visual anchor in the gallery. */
  icon: string;
  /** Seconds the template takes. */
  duration: number;
  fields: TemplateField[];
  build: (c: TemplateCtx, v: Record<string, string>) => Layer[];
}

export interface TemplateCtx {
  W: number; H: number; u: number; vertical: boolean; narrow: boolean;
  /** Safe area in canvas px. */
  safe: { x0: number; y0: number; x1: number; y1: number };
  lang: "de" | "en";
  /** dw/bw = em per character (mixed case), dwU/bwU = the same in uppercase. Measured per style, safe guesses otherwise. */
  font: { display: string; displayWeight: number; body: string; bodyWeight: number; dw: number; dwU: number; bw: number; bwU: number };
  motion: { enter: Ease; exit: Ease; inDur: number; outDur: number; stagger: number; text: TextAnim };
  has: (token: string) => boolean;
  brand?: MotionSpec["meta"]["brand"];
  title: string;
  /** Unique layer id inside this insert. */
  id: (name: string) => string;
  /** Scene id the layers belong to, start offset inside it, and the track base. */
  scene: string;
  t0: number;
  track: number;
  /** true when laid over a recording (needs its own background). */
  overlayScene: boolean;
  /** Art direction id (cards follow its signature). */
  style?: string;
}

// ───────────── helpers ─────────────

const r = Math.round;

/**
 * Biggest font size (≤ max) at which the text fits the box when wrapped at word boundaries.
 * Returns the size and the text with explicit line breaks, so the browser wraps exactly like this.
 * cw = width of one character in em (measured per font, conservative for unknown fonts).
 */
export function fitText(text: string, boxW: number, boxH: number, max: number, min: number, cw: number, lh: number, maxLines = 6): { size: number; text: string; lines: number } {
  const plainLen = (s: string) => s.replace(/\[\[|\]\]/g, "").length;
  const W = boxW * 0.96;
  // Below min only when the text cannot fit otherwise (long user texts): never smaller than ~55 % of min.
  const floor = Math.max(12, min * 0.55);
  const tryAt = (size: number, hyphenate: boolean, anyHeight = false): string[] | null => {
    const perLine = Math.max(1, Math.floor(W / (size * cw)));
    const out: string[] = [];
    for (const para of text.split("\n")) {
      let line = "";
      for (let word of para.split(/\s+/).filter(Boolean)) {
        if (plainLen(word) > perLine) {
          if (!hyphenate || perLine < 4) return null;
          // Very long word: break it with a hyphen, but keep at least 3 letters per piece.
          if (line) { out.push(line); line = ""; }
          while (plainLen(word) > perLine) { out.push(`${word.slice(0, perLine - 1)}-`); word = word.slice(perLine - 1); }
        }
        const next = line ? `${line} ${word}` : word;
        if (plainLen(next) > perLine) { out.push(line); line = word; } else line = next;
      }
      out.push(line);
    }
    // Slack: animated words sit in inline boxes that make a line a little taller than size × line height.
    return anyHeight || (out.length <= maxLines && out.length * size * lh + size * 0.3 <= boxH) ? out : null;
  };
  const step = (size: number) => Math.max(1, Math.floor(size / 40));
  for (const hyphenate of [false, true]) {
    for (let size = Math.floor(max); size >= Math.floor(hyphenate ? floor : min); size -= step(size)) {
      const out = tryAt(size, hyphenate);
      if (out) return { size, text: balanceMarkers(out).join("\n"), lines: out.length };
    }
  }
  // Nothing fits the height: still wrap to the width (line-by-line animations would otherwise keep one long line).
  const size = Math.floor(floor);
  const out = tryAt(size, true, true) ?? [text];
  return { size, text: balanceMarkers(out).join("\n"), lines: out.length };
}

/** Font size at which a one-line text fits a width (pills, buttons, handles). */
function oneLine(text: string, width: number, max: number, cw: number): number {
  return r(Math.max(12, Math.min(max, (width * 0.94) / Math.max(1, text.length * cw))));
}

/** A [[highlight]] that got split over two lines is closed and reopened, so each line renders correctly. */
function balanceMarkers(lines: string[]): string[] {
  let open = false;
  return lines.map((l) => {
    let s = open ? `[[${l}` : l;
    const opens = (l.match(/\[\[/g) ?? []).length;
    const closes = (l.match(/\]\]/g) ?? []).length;
    open = open ? opens >= closes : opens > closes;
    if (open) s += "]]";
    return s;
  });
}

function txt(c: TemplateCtx, id: string, frame: Frame, text: string, style: Partial<TextStyle> & { fontSize: number }, extra: Partial<TextLayer> = {}): TextLayer {
  return {
    id: c.id(id), name: id, type: "text", scene: c.scene, track: c.track + 5, start: c.t0, duration: 1,
    frame: rf(frame), text, style: { fontFamily: c.font.body, fontWeight: c.font.bodyWeight, color: "$ink", lineHeight: 1.15, ...style }, ...extra,
  };
}

const isUpper = (t: string) => /\p{L}/u.test(t) && t === t.toUpperCase();

function headline(c: TemplateCtx, id: string, frame: Frame, text: string, max: number, extra: Partial<TextLayer> & { styleExtra?: Partial<TextStyle> } = {}): TextLayer {
  const lh = 1.04;
  const f = fitText(text, frame.w, frame.h, max, Math.min(max, c.u * 4.2), isUpper(text) || extra.styleExtra?.uppercase ? c.font.dwU : c.font.dw, lh);
  const { styleExtra, ...rest } = extra;
  return txt(c, id, frame, f.text, { fontFamily: c.font.display, fontWeight: c.font.displayWeight, fontSize: f.size, lineHeight: lh, letterSpacing: r(-f.size * 0.02), highlight: "$accent", ...styleExtra }, { anim: { ...c.motion.text, stagger: c.motion.stagger }, ...rest });
}

function body(c: TemplateCtx, id: string, frame: Frame, text: string, max: number, extra: Partial<TextLayer> & { styleExtra?: Partial<TextStyle> } = {}): TextLayer {
  const lh = 1.3;
  const f = fitText(text, frame.w, frame.h, max, Math.min(max, c.u * 2.6), isUpper(text) ? c.font.bwU : c.font.bw, lh);
  const { styleExtra, ...rest } = extra;
  return txt(c, id, frame, f.text, { fontSize: f.size, lineHeight: lh, color: "$muted", ...styleExtra }, { in: enter(c, "slideUp"), ...rest });
}

/** Small uppercase label (kicker). */
function kicker(c: TemplateCtx, id: string, frame: Frame, text: string, extra: Partial<TextLayer> & { styleExtra?: Partial<TextStyle> } = {}): TextLayer {
  const size = r(Math.min(c.u * 3, frame.w / (Math.max(4, text.length) * (c.font.bwU + 0.14))));
  const { styleExtra, ...rest } = extra;
  return txt(c, id, frame, text, { fontFamily: c.font.body, fontWeight: 700, fontSize: size, letterSpacing: r(size * 0.14), uppercase: true, color: "$accent", ...styleExtra }, { in: enter(c, "fade"), ...rest });
}

function shape(c: TemplateCtx, id: string, frame: Frame, fill: string, extra: Partial<ShapeLayer> = {}): ShapeLayer {
  return { id: c.id(id), name: id, type: "shape", shape: "rect", scene: c.scene, track: c.track + 2, start: c.t0, duration: 1, frame: rf(frame), fill, ...extra };
}

function svg(c: TemplateCtx, id: string, frame: Frame, markup: string, extra: Partial<SvgLayer> = {}): SvgLayer {
  return { id: c.id(id), name: id, type: "svg", scene: c.scene, track: c.track + 3, start: c.t0, duration: 1, frame: rf(frame), svg: markup, viewBox: `0 0 ${r(frame.w)} ${r(frame.h)}`, ...extra };
}

function logo(c: TemplateCtx, id: string, frame: Frame, extra: Partial<ImageLayer> = {}): ImageLayer | null {
  const b = c.brand;
  if (!b?.logo) return null;
  // Fit the logo's aspect into the frame, centered.
  const a = b.logoAspect ?? 1;
  let w = frame.w;
  let h = w / a;
  if (h > frame.h) { h = frame.h; w = h * a; }
  return { id: c.id(id), name: id, type: "image", scene: c.scene, track: c.track + 6, start: c.t0, duration: 1, src: b.logo, fit: "contain", frame: rf({ x: frame.x + (frame.w - w) / 2, y: frame.y + (frame.h - h) / 2, w, h }), in: enter(c, "pop"), ...extra };
}

function enter(c: TemplateCtx, type: Transition["type"], delay = 0): Transition {
  void delay;
  return { type, duration: c.motion.inDur, ease: c.motion.enter };
}

function exit(c: TemplateCtx): Transition {
  return { type: "fade", duration: c.motion.outDur, ease: c.motion.exit };
}

const rf = (f: Frame): Frame => ({ ...f, x: r(f.x), y: r(f.y), w: Math.max(1, r(f.w)), h: Math.max(1, r(f.h)) });

/** Timing: start (seconds into the template), and the layer lasts until `end` (default: template end). */
function at<T extends Layer>(c: TemplateCtx, total: number, l: T | null, start: number, end = total): T | null {
  if (!l) return null;
  return { ...l, start: Math.round((c.t0 + start) * 100) / 100, duration: Math.round(Math.max(0.2, end - start) * 100) / 100, out: l.out ?? exit(c) };
}

function lines(v: string, max = 6): string[] {
  return v.split("\n").map((s) => s.trim()).filter(Boolean).slice(0, max);
}

/** A soft accent glow behind scene content (most styles use one). */
function glow(c: TemplateCtx, x: number, y: number, size: number, token = "$accent", opacity = 0.32): ShapeLayer {
  return shape(c, "glow", { x: x - size / 2, y: y - size / 2, w: size, h: size, opacity }, `radial-gradient(circle, ${token} 0%, transparent 65%)`, { shape: "ellipse", track: c.track, in: { type: "fade", duration: 1.2 } });
}

function bgPanel(c: TemplateCtx): ShapeLayer | null {
  return c.overlayScene ? shape(c, "bg", { x: 0, y: 0, w: c.W, h: c.H }, "$bg", { track: c.track - 1, in: { type: "fade", duration: 0.35 } }) : null;
}

/**
 * A card / panel in the style's signature: glass cards, hard offset shadows, soft rounded app cards, neon edges.
 * fill = the plain fill for styles without a signature.
 */
function card(c: TemplateCtx, fill = "$surface"): Partial<ShapeLayer> {
  switch (c.style) {
    case "glass": return { fill: "rgba(255,255,255,0.10)", stroke: "rgba(255,255,255,0.22)", strokeWidth: 2, look: { glass: 24, shadow: "0 24px 60px rgba(0,0,0,0.35)" } };
    case "brutal": return { fill, stroke: "#000000", strokeWidth: r(c.u * 0.45), look: { shadow: `${r(c.u * 0.8)}px ${r(c.u * 0.8)}px 0 #000000` } };
    case "pastel": return { fill, radius: r(c.u * 3.5), look: { shadow: "0 20px 40px #2E2A4F1A" } };
    case "neon": return { fill, stroke: "$accent", strokeWidth: 2, look: { glow: "$accent", glowSize: 0.6 } };
    case "keynote": case "velvet": return { fill, look: { shadow: "0 30px 80px rgba(0,0,0,0.45)" } };
    default: return { fill };
  }
}

const accent2 = (c: TemplateCtx) => (c.has("accent2") ? "$accent2" : "$accent");
const L = (de: string, en: string): L10n => ({ de, en });
const clean = <T,>(list: (T | null | undefined | false)[]): T[] => list.filter(Boolean) as T[];

// ───────────── the templates ─────────────

export const TEMPLATES: TemplateDef[] = [
  {
    id: "intro", kind: "scene", icon: "🎬", duration: 4, name: L("Intro mit Logo", "Logo intro"), desc: L("Logo, Titel und Slogan erscheinen nacheinander.", "Logo, title and tagline appear one after another."),
    fields: [
      { key: "title", type: "text", label: L("Titel", "Title"), default: (c) => c.brand?.name ?? c.title },
      { key: "tagline", type: "text", label: L("Slogan", "Tagline"), default: (c) => c.brand?.tagline ?? (c.lang === "de" ? "Kurz erklärt" : "Explained in a minute") },
    ],
    build: (c, v) => {
      const T = 4;
      const { x0, x1, y0, y1 } = c.safe;
      const w = x1 - x0;
      const cy = (y0 + y1) / 2;
      const logoH = c.u * (c.vertical ? 14 : 16);
      const lg = logo(c, "logo", { x: x0, y: cy - logoH - c.u * 6, w, h: logoH });
      const tY = lg ? cy - c.u * 3 : cy - c.u * 10;
      return clean([
        bgPanel(c) && at(c, T, bgPanel(c), 0),
        at(c, T, glow(c, c.W / 2, cy, Math.max(c.W, c.H) * 0.9), 0),
        at(c, T, lg, 0.15),
        at(c, T, headline(c, "title", { x: x0, y: tY, w, h: c.u * 13 }, v.title, c.u * 12, { styleExtra: { align: "center", valign: "middle" } }), lg ? 0.6 : 0.2),
        at(c, T, svg(c, "line", { x: c.W / 2 - c.u * 12, y: tY + c.u * 14.5, w: c.u * 24, h: c.u * 1.2 }, `<line x1="0" y1="${r(c.u * 0.6)}" x2="${r(c.u * 24)}" y2="${r(c.u * 0.6)}" style="stroke:$accent;stroke-width:${r(c.u * 0.7)};stroke-linecap:round"/>`, { draw: { duration: 0.7, ease: "power3.inOut" } }), 1),
        at(c, T, body(c, "tagline", { x: x0, y: tY + c.u * 17, w, h: c.u * 10 }, v.tagline, c.u * 4.4, { styleExtra: { align: "center" } }), 1.25),
      ]);
    },
  },
  {
    id: "title", kind: "scene", icon: "🅰️", duration: 4, name: L("Titelkarte", "Title card"), desc: L("Kicker, große Überschrift mit Hervorhebung, Unterzeile.", "Kicker, big headline with highlight, subline."),
    fields: [
      { key: "kicker", type: "text", label: L("Kicker", "Kicker"), default: L("Neu", "New") },
      { key: "title", type: "text", label: L("Überschrift ([[Wort]] hebt hervor)", "Headline ([[word]] highlights)"), default: L("So geht's [[in 60 Sekunden]]", "How it works [[in 60 seconds]]") },
      { key: "sub", type: "text", label: L("Unterzeile", "Subline"), default: L("Alles Wichtige auf einen Blick", "Everything that matters at a glance") },
    ],
    build: (c, v) => {
      const T = 4;
      const { x0, x1, y0, y1 } = c.safe;
      const center = c.vertical;
      const w = (x1 - x0) * (center ? 1 : 0.8);
      const top = y0 + (y1 - y0) * (center ? 0.28 : 0.22);
      const align = center ? "center" : "left";
      return clean([
        at(c, T, bgPanel(c), 0),
        at(c, T, glow(c, c.W * (center ? 0.5 : 0.78), c.H * 0.3, Math.max(c.W, c.H) * 0.8), 0),
        at(c, T, kicker(c, "kicker", { x: x0, y: top, w, h: c.u * 4 }, v.kicker, { styleExtra: { align } }), 0.15),
        at(c, T, headline(c, "title", { x: x0, y: top + c.u * 6, w, h: c.u * (center ? 34 : 26) }, v.title, c.u * (center ? 11 : 12.5), { styleExtra: { align } }), 0.35),
        at(c, T, body(c, "sub", { x: x0, y: top + c.u * (center ? 42 : 34), w: w * (center ? 1 : 0.85), h: c.u * 10 }, v.sub, c.u * 4.4, { styleExtra: { align } }), 0.9),
      ]);
    },
  },
  {
    id: "chapter", kind: "scene", icon: "🔖", duration: 3, name: L("Kapitel", "Chapter"), desc: L("Große Nummer und Kapitelname, für lange Videos.", "Big number and chapter name, for long videos."),
    fields: [
      { key: "num", type: "text", label: L("Nummer", "Number"), default: L("01", "01") },
      { key: "title", type: "text", label: L("Kapitelname", "Chapter name"), default: L("Die Grundlagen", "The basics") },
    ],
    build: (c, v) => {
      const T = 3;
      const { x0, x1, y0, y1 } = c.safe;
      const w = x1 - x0;
      const numSize = r(Math.min(c.u * (c.vertical ? 38 : 34), (w * 0.9) / Math.max(1, v.num.length * c.font.dw)));
      const ny = c.vertical ? y0 + (y1 - y0) * 0.2 : y0 + (y1 - y0) * 0.1;
      return clean([
        at(c, T, bgPanel(c), 0),
        at(c, T, txt(c, "num", { x: x0, y: ny, w, h: numSize * 1.25 }, v.num, { fontFamily: c.font.display, fontWeight: c.font.displayWeight, fontSize: numSize, lineHeight: 1, color: "$accent", align: c.vertical ? "center" : "left" }, { in: { type: "maskUp", duration: 0.7, ease: "expo.out" } }), 0.1),
        at(c, T, shape(c, "bar", { x: c.vertical ? c.W / 2 - c.u * 10 : x0, y: ny + numSize * 1.28, w: c.u * 20, h: c.u * 0.8 }, "$accent", { in: { type: c.vertical ? "iris" : "wipe", duration: 0.5, ease: "power3.inOut" } }), 0.45),
        at(c, T, headline(c, "title", { x: x0, y: ny + numSize * 1.28 + c.u * 4, w, h: c.u * 22 }, v.title, c.u * 10, { styleExtra: { align: c.vertical ? "center" : "left" } }), 0.55),
      ]);
    },
  },
  {
    id: "hook", kind: "scene", icon: "❓", duration: 3, name: L("Hook-Frage", "Hook question"), desc: L("Eine Frage, die in der ersten Sekunde packt.", "A question that grabs in the first second."),
    fields: [{ key: "q", type: "text", label: L("Frage ([[Wort]] hebt hervor)", "Question ([[word]] highlights)"), default: L("Wusstest du, dass [[80 %]] das falsch machen?", "Did you know [[80 %]] get this wrong?") }],
    build: (c, v) => {
      const T = 3;
      const { x0, x1, y0, y1 } = c.safe;
      const w = x1 - x0;
      const qm = c.u * (c.vertical ? 70 : 60);
      return clean([
        at(c, T, bgPanel(c), 0),
        (() => {
          // Giant decorative "?" sized by the font's width so it stays on the canvas, right side.
          const size = r(Math.min(qm, (c.W * 0.42) / Math.max(0.5, c.font.dw), c.H * 0.7));
          const f = rf({ x: c.W - size * c.font.dw * 1.2 - c.u * 3, y: c.H / 2 - size * 0.55, w: size * c.font.dw * 1.2, h: size * 1.1, opacity: 0.12 });
          return at(c, T, txt(c, "mark", f, "?", { fontFamily: c.font.display, fontWeight: 900, fontSize: size, lineHeight: 1, color: "$accent", align: "right" }, { frame: f, in: { type: "zoomOut", duration: 1.2, ease: "expo.out" }, track: c.track }), 0);
        })(),
        at(c, T, headline(c, "q", { x: x0, y: y0 + (y1 - y0) * 0.22, w: w * (c.vertical ? 1 : 0.86), h: (y1 - y0) * 0.56 }, v.q, c.u * (c.vertical ? 10.5 : 11.5), { styleExtra: { valign: "middle", align: c.vertical ? "center" : "left" } }), 0.1),
      ]);
    },
  },
  {
    id: "statement", kind: "scene", icon: "💥", duration: 3.5, name: L("Statement", "Statement"), desc: L("Eine Aussage, Wort für Wort, ein Wort mit Textmarker.", "One statement, word by word, one word with a marker."),
    fields: [{ key: "text", type: "text", label: L("Aussage ([[Wort]] markiert)", "Statement ([[word]] is marked)"), default: L("Weniger Klicks. [[Mehr Wirkung.]]", "Fewer clicks. [[More impact.]]") }],
    build: (c, v) => {
      const T = 3.5;
      const { x0, x1, y0, y1 } = c.safe;
      const h = headline(c, "text", { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, v.text, c.u * (c.vertical ? 13 : 14), {
        styleExtra: { align: "center", valign: "middle", marker: "$accent", highlight: "$bg" },
        anim: { type: c.motion.text.type === "type" ? "type" : "rise", by: "word", stagger: Math.max(0.08, c.motion.stagger * 1.4), duration: 0.5, ease: c.motion.enter },
      });
      return clean([at(c, T, bgPanel(c), 0), at(c, T, glow(c, c.W / 2, c.H / 2, Math.max(c.W, c.H), accent2(c), 0.22), 0), at(c, T, h, 0.1)]);
    },
  },
  {
    id: "bignumber", kind: "scene", icon: "🔢", duration: 4, name: L("Große Zahl", "Big number"), desc: L("Eine Zahl zählt hoch, ein Ring zeichnet sich.", "A number counts up, a ring draws itself."),
    fields: [
      { key: "num", type: "number", label: L("Zahl", "Number"), default: L("87", "87") },
      { key: "prefix", type: "text", label: L("Davor (z. B. €)", "Before (e.g. $)"), default: L("", "") },
      { key: "suffix", type: "text", label: L("Danach (z. B. %)", "After (e.g. %)"), default: L(" %", "%") },
      { key: "label", type: "text", label: L("Bedeutung", "Meaning"), default: L("weniger Zeit im Schnitt", "less time spent editing") },
    ],
    build: (c, v) => {
      const T = 4;
      const { x0, x1, y0, y1 } = c.safe;
      const to = Number(v.num.replace(",", ".")) || 0;
      const dec = /[.,]\d/.test(v.num) ? (v.num.split(/[.,]/)[1].length > 1 ? 2 : 1) : 0;
      const shown = `${v.prefix}${v.num}${v.suffix}`;
      const ring = Math.min(x1 - x0, (y1 - y0) * (c.vertical ? 0.5 : 0.78));
      const cx = c.W / 2;
      const cy = c.vertical ? y0 + (y1 - y0) * 0.44 : (y0 + y1) / 2 - c.u * 4;
      const size = r(Math.min(ring * 0.3, (ring * 0.78) / Math.max(2, shown.length * c.font.dw)));
      const sw = r(c.u * 1.2);
      const rad = ring / 2 - sw;
      return clean([
        at(c, T, bgPanel(c), 0),
        at(c, T, svg(c, "ring", { x: cx - ring / 2, y: cy - ring / 2, w: ring, h: ring }, `<circle cx="${r(ring / 2)}" cy="${r(ring / 2)}" r="${r(rad)}" style="fill:none;stroke:$surface;stroke-width:${sw}"/><circle cx="${r(ring / 2)}" cy="${r(ring / 2)}" r="${r(rad)}" transform="rotate(-90 ${r(ring / 2)} ${r(ring / 2)})" style="fill:none;stroke:$accent;stroke-width:${sw};stroke-linecap:round"/>`, { draw: { duration: 1.4, stagger: 0, ease: "power3.out" } }), 0.1),
        at(c, T, txt(c, "num", { x: cx - ring / 2, y: cy - size * 0.7, w: ring, h: size * 1.4 }, shown, { fontFamily: c.font.display, fontWeight: c.font.displayWeight, fontSize: size, lineHeight: 1.1, align: "center", valign: "middle" },
          { count: { from: 0, to, decimals: dec as 0 | 1 | 2, duration: 1.4, delay: 0, ease: "expo.out", prefix: v.prefix, suffix: v.suffix }, in: enter(c, "pop") }), 0.15),
        at(c, T, body(c, "label", { x: x0, y: c.vertical ? cy + ring / 2 + c.u * 5 : cy + ring / 2 + c.u * 3, w: x1 - x0, h: c.u * 10 }, v.label, c.u * 4.6, { styleExtra: { align: "center", color: "$ink" } }), 0.9),
      ]);
    },
  },
  {
    id: "stats", kind: "scene", icon: "📊", duration: 5, name: L("3 Kennzahlen", "3 stats"), desc: L("Drei Zahlen zählen nacheinander hoch.", "Three numbers count up one after another."),
    fields: [{ key: "items", type: "lines", label: L("Je Zeile: Zahl | Bedeutung", "One per line: number | meaning"), default: L("120 | Videos pro Monat\n3× | schneller fertig\n98 % | zufriedene Kunden", "120 | videos per month\n3× | faster to finish\n98% | happy customers") }],
    build: (c, v) => {
      const T = 5;
      const { x0, x1, y0, y1 } = c.safe;
      const items = lines(v.items, 3).map((l) => { const [n, ...rest] = l.split("|"); return { n: n.trim(), label: rest.join("|").trim() }; });
      const n = Math.max(1, items.length);
      const out: (Layer | null)[] = [at(c, T, bgPanel(c), 0)];
      const colW = c.vertical ? x1 - x0 : (x1 - x0 - c.u * 4 * (n - 1)) / n;
      const rowH = c.vertical ? (y1 - y0) / n : y1 - y0;
      const longest = Math.max(...items.map((i) => i.n.length), 2);
      const numSize = r(Math.min(c.u * (c.vertical ? 15 : 13), (colW * 0.85) / (longest * c.font.dw * 1.1)));
      items.forEach((it, i) => {
        const x = c.vertical ? x0 : x0 + i * (colW + c.u * 4);
        const y = c.vertical ? y0 + i * rowH + rowH * 0.12 : y0 + (y1 - y0) * 0.28;
        const m = /^([^\d-]*)(-?[\d.,]+)(.*)$/.exec(it.n);
        const to = m ? Number(m[2].replace(",", ".")) : NaN;
        const t = 0.2 + i * 0.45;
        out.push(at(c, T, shape(c, `card${i}`, { x, y: y - c.u * 2, w: colW, h: numSize * 1.3 + c.u * 14 }, "$surface", { radius: r(c.u * 2), ...card(c), in: enter(c, "slideUp") }), t - 0.1));
        out.push(at(c, T, txt(c, `n${i}`, { x: x + c.u * 2, y, w: colW - c.u * 4, h: numSize * 1.3 }, it.n, { fontFamily: c.font.display, fontWeight: c.font.displayWeight, fontSize: numSize, lineHeight: 1.1, color: i === 1 ? accent2(c) : "$accent", align: c.vertical ? "left" : "center" },
          { in: enter(c, "pop"), ...(m && Number.isFinite(to) ? { count: { from: 0, to, decimals: (/[.,]\d/.test(m[2]) ? 1 : 0) as 0 | 1, duration: 1.2, ease: "expo.out", prefix: m[1], suffix: m[3] } } : {}) }), t));
        out.push(at(c, T, body(c, `l${i}`, { x: x + c.u * 2, y: y + numSize * 1.3 + c.u * 1, w: colW - c.u * 4, h: c.u * 10 }, it.label, c.u * 3.8, { styleExtra: { align: c.vertical ? "left" : "center", color: "$ink" } }), t + 0.25));
      });
      return clean(out);
    },
  },
  {
    id: "bars", kind: "scene", icon: "📈", duration: 5, name: L("Balkendiagramm", "Bar chart"), desc: L("Balken wachsen auf ihre Werte, mit Beschriftung.", "Bars grow to their values, with labels."),
    fields: [
      { key: "title", type: "text", label: L("Titel", "Title"), default: L("Zeit pro Video", "Time per video") },
      { key: "items", type: "lines", label: L("Je Zeile: Name: Wert", "One per line: name: value"), default: L("Vorher: 120\nMit Vorlagen: 45\nMit Open Motion: 12", "Before: 120\nWith templates: 45\nWith Open Motion: 12") },
      { key: "unit", type: "text", label: L("Einheit", "Unit"), default: L(" min", " min") },
    ],
    build: (c, v) => {
      const T = 5;
      const { x0, x1, y0, y1 } = c.safe;
      const items = lines(v.items, 6).map((l) => { const i = l.lastIndexOf(":"); return { name: (i > 0 ? l.slice(0, i) : l).trim(), val: Math.max(0, Number((i > 0 ? l.slice(i + 1) : "0").replace(",", ".").replace(/[^\d.-]/g, "")) || 0) }; });
      const maxV = Math.max(1, ...items.map((i) => i.val));
      const out: (Layer | null)[] = [at(c, T, bgPanel(c), 0)];
      const titleH = c.u * 9;
      out.push(at(c, T, headline(c, "title", { x: x0, y: y0, w: x1 - x0, h: titleH }, v.title, c.u * 7), 0.1));
      const area = y0 + titleH + c.u * 4;
      const n = Math.max(1, items.length);
      const gap = c.u * 2.4;
      const rowH = Math.min(c.u * (c.vertical ? 20 : 12), (y1 - area - gap * (n - 1)) / n);
      // The chart sits in the middle of the free space (slightly above center), not glued under the title.
      const top = area + Math.max(0, (y1 - area - (n * rowH + (n - 1) * gap)) * 0.4);
      const labelW = c.vertical ? 0 : (x1 - x0) * 0.28;
      const barX = x0 + labelW + (labelW ? c.u * 2 : 0);
      // Value labels sit right of the bars: reserve room for the longest one in this font.
      const valText = (v2: number) => `${v2}${v.unit}`;
      const longestVal = Math.max(...items.map((i) => valText(i.val).length), 2);
      const valSize = r(Math.min(c.u * (c.vertical ? 5.5 : 4.6), (rowH * (c.vertical ? 0.5 : 1)) * 0.6));
      const valW = longestVal * valSize * c.font.dw + c.u * 2;
      const barMax = Math.max(c.u * 10, x1 - barX - valW - c.u * 1.5);
      items.forEach((it, i) => {
        const y = top + i * (rowH + gap);
        const w = Math.max(c.u * 1.5, (it.val / maxV) * barMax);
        const t = 0.4 + i * 0.25;
        const barY = c.vertical ? y + rowH * 0.46 : y;
        const barH = c.vertical ? rowH * 0.5 : rowH;
        if (labelW) out.push(at(c, T, body(c, `name${i}`, { x: x0, y: y + rowH * 0.15, w: labelW, h: rowH * 0.7 }, it.name, c.u * 3.8, { styleExtra: { align: "right", valign: "middle", color: "$ink" } }), t));
        else out.push(at(c, T, body(c, `name${i}`, { x: barX, y, w: x1 - x0, h: rowH * 0.42 }, it.name, Math.min(c.u * 4.6, rowH * 0.34), { styleExtra: { color: "$ink", valign: "bottom" } }), t));
        out.push(at(c, T, shape(c, `bar${i}`, { x: barX, y: barY, w, h: barH }, i === items.length - 1 ? "$accent" : "$surface", { radius: r(Math.min(barH / 2, c.u * 1.2)), in: { type: "wipe", duration: 0.8, ease: "power3.out" } }), t));
        out.push(at(c, T, txt(c, `val${i}`, { x: barX + w + c.u * 1.5, y: barY, w: valW, h: barH }, valText(it.val), { fontFamily: c.font.display, fontWeight: c.font.displayWeight, fontSize: valSize, valign: "middle", lineHeight: 1.1, color: i === items.length - 1 ? "$accent" : "$ink" }, { in: enter(c, "fade") }), t + 0.55));
      });
      return clean(out);
    },
  },
  {
    id: "list", kind: "scene", icon: "📝", duration: 5, name: L("Liste mit 3 Punkten", "List of 3"), desc: L("Überschrift und nummerierte Punkte, nacheinander.", "Headline and numbered points, one after another."),
    fields: [
      { key: "title", type: "text", label: L("Überschrift", "Headline"), default: L("3 Dinge, die du wissen musst", "3 things you need to know") },
      { key: "items", type: "lines", label: L("Punkte (je Zeile einer)", "Points (one per line)"), default: L("Es ist kostenlos\nEs läuft auf deinem Rechner\nDu behältst die Kontrolle", "It is free\nIt runs on your computer\nYou stay in control") },
    ],
    build: (c, v) => {
      const T = 5;
      const { x0, x1, y0, y1 } = c.safe;
      const items = lines(v.items, 5);
      const out: (Layer | null)[] = [at(c, T, bgPanel(c), 0)];
      const titleH = c.u * (c.vertical ? 22 : 16);
      const rowH0 = Math.min(c.u * (c.vertical ? 16 : 13), (y1 - y0 - titleH - c.u * 4) / Math.max(1, items.length));
      // Title + points as one block, a little above the middle of the free height (not glued to the top).
      const by = y0 + Math.max(0, (y1 - y0 - (titleH + c.u * 4 + rowH0 * items.length)) * 0.4);
      out.push(at(c, T, headline(c, "title", { x: x0, y: by, w: x1 - x0, h: titleH }, v.title, c.u * (c.vertical ? 9 : 8.5)), 0.1));
      const top = by + titleH + c.u * 4;
      const rowH = rowH0;
      const badge = Math.min(rowH * 0.7, c.u * 8);
      items.forEach((it, i) => {
        const y = top + i * rowH;
        const t = 0.6 + i * Math.max(0.35, c.motion.stagger * 4);
        out.push(at(c, T, shape(c, `badge${i}`, { x: x0, y: y + (rowH - badge) / 2 - rowH * 0.1, w: badge, h: badge }, "$accent", { shape: "ellipse", in: enter(c, "pop") }), t));
        out.push(at(c, T, txt(c, `num${i}`, { x: x0, y: y + (rowH - badge) / 2 - rowH * 0.1, w: badge, h: badge }, String(i + 1), { fontFamily: c.font.display, fontWeight: c.font.displayWeight, fontSize: r(badge * 0.5), color: "$bg", align: "center", valign: "middle", lineHeight: 1 }, { in: enter(c, "pop") }), t + 0.05));
        out.push(at(c, T, body(c, `item${i}`, { x: x0 + badge + c.u * 3, y: y + rowH * 0.05, w: x1 - x0 - badge - c.u * 3, h: rowH * 0.8 }, it, c.u * (c.vertical ? 5 : 4.6), { styleExtra: { color: "$ink", valign: "middle" }, in: enter(c, "slideLeft") }), t + 0.1));
      });
      return clean(out);
    },
  },
  {
    id: "steps", kind: "scene", icon: "🪜", duration: 5, name: L("Schritt für Schritt", "Step by step"), desc: L("Drei Schritte, verbunden durch eine Linie, die sich zeichnet.", "Three steps, joined by a line that draws itself."),
    fields: [{ key: "items", type: "lines", label: L("Schritte (je Zeile einer)", "Steps (one per line)"), default: L("Aufnehmen\nKI baut\nExportieren", "Record\nAI builds\nExport") }],
    build: (c, v) => {
      const T = 5;
      const { x0, x1, y0, y1 } = c.safe;
      const items = lines(v.items, 4);
      const n = Math.max(1, items.length);
      const out: (Layer | null)[] = [at(c, T, bgPanel(c), 0)];
      const dot = c.u * (c.vertical ? 11 : 10);
      const pos = items.map((_, i) => c.vertical
        ? { x: x0 + dot / 2, y: y0 + ((y1 - y0) / n) * (i + 0.5) }
        : { x: x0 + ((x1 - x0) / n) * (i + 0.5), y: (y0 + y1) / 2 - c.u * 4 });
      const a = pos[0];
      const b = pos[pos.length - 1];
      const lw = Math.max(1, Math.abs(b.x - a.x));
      const lh = Math.max(1, Math.abs(b.y - a.y));
      if (n > 1) out.push(at(c, T, svg(c, "line", { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) - c.u * 0.5, w: c.vertical ? c.u : lw, h: c.vertical ? lh : c.u }, c.vertical
        ? `<line x1="${r(c.u / 2)}" y1="0" x2="${r(c.u / 2)}" y2="${r(lh)}" style="stroke:$surface;stroke-width:${r(c.u * 0.6)}"/>`
        : `<line x1="0" y1="${r(c.u / 2)}" x2="${r(lw)}" y2="${r(c.u / 2)}" style="stroke:$surface;stroke-width:${r(c.u * 0.6)}"/>`, { draw: { duration: 0.4 + n * 0.45, ease: "power2.inOut" }, track: c.track + 1 }), 0.2));
      items.forEach((it, i) => {
        const p = pos[i];
        const t = 0.3 + i * 0.45;
        out.push(at(c, T, shape(c, `dot${i}`, { x: p.x - dot / 2, y: p.y - dot / 2, w: dot, h: dot }, i === n - 1 ? "$accent" : "$surface", { shape: "ellipse", stroke: "$accent", strokeWidth: r(c.u * 0.5), in: enter(c, "pop") }), t));
        out.push(at(c, T, txt(c, `num${i}`, { x: p.x - dot / 2, y: p.y - dot / 2, w: dot, h: dot }, String(i + 1), { fontFamily: c.font.display, fontWeight: c.font.displayWeight, fontSize: r(dot * 0.45), color: i === n - 1 ? "$bg" : "$ink", align: "center", valign: "middle", lineHeight: 1 }, { in: enter(c, "pop") }), t + 0.05));
        const lf = c.vertical
          ? { x: p.x + dot / 2 + c.u * 3, y: p.y - c.u * 5, w: x1 - p.x - dot / 2 - c.u * 3, h: c.u * 10 }
          : { x: p.x - (x1 - x0) / n / 2 + c.u, y: p.y + dot / 2 + c.u * 3, w: (x1 - x0) / n - c.u * 2, h: c.u * 14 };
        out.push(at(c, T, headline(c, `step${i}`, lf, it, c.u * 5.5, { styleExtra: { align: c.vertical ? "left" : "center", valign: c.vertical ? "middle" : "top" }, anim: undefined, in: enter(c, "slideUp") }), t + 0.15));
      });
      return clean(out);
    },
  },
  {
    id: "compare", kind: "scene", icon: "⚖️", duration: 5, name: L("Vergleich A vs B", "Compare A vs B"), desc: L("Zwei Karten nebeneinander, VS in der Mitte.", "Two cards side by side, VS in the middle."),
    fields: [
      { key: "a", type: "text", label: L("Links: Titel", "Left: title"), default: L("Früher", "Before") },
      { key: "aItems", type: "lines", label: L("Links: Punkte", "Left: points"), default: L("Stunden im Schnittprogramm\nAlles neu bei jeder Änderung", "Hours in the editor\nRedo everything on every change") },
      { key: "b", type: "text", label: L("Rechts: Titel", "Right: title"), default: L("Jetzt", "Now") },
      { key: "bItems", type: "lines", label: L("Rechts: Punkte", "Right: points"), default: L("Minuten mit KI\nEin Klick pro Änderung", "Minutes with AI\nOne click per change") },
    ],
    build: (c, v) => {
      const T = 5;
      const { x0, x1, y0, y1 } = c.safe;
      const gap = c.u * 6;
      const out: (Layer | null)[] = [at(c, T, bgPanel(c), 0)];
      const cards = c.vertical
        ? [{ x: x0, y: y0, w: x1 - x0, h: (y1 - y0 - gap) / 2 }, { x: x0, y: y0 + (y1 - y0 + gap) / 2, w: x1 - x0, h: (y1 - y0 - gap) / 2 }]
        : [{ x: x0, y: y0 + c.u * 2, w: (x1 - x0 - gap) / 2, h: y1 - y0 - c.u * 4 }, { x: x0 + (x1 - x0 + gap) / 2, y: y0 + c.u * 2, w: (x1 - x0 - gap) / 2, h: y1 - y0 - c.u * 4 }];
      [[v.a, v.aItems, "$surface"], [v.b, v.bItems, "$accent"]].forEach(([title, items, fill], i) => {
        const f = cards[i];
        const t = 0.2 + i * 0.6;
        const pad = c.u * 4;
        const onAccent = i === 1;
        out.push(at(c, T, shape(c, `card${i}`, f, fill, { radius: r(c.u * 2.5), ...(i === 0 ? card(c) : {}), in: enter(c, i ? "slideLeft" : "slideRight") }), t));
        // The title takes the height it needs (up to ~40 % of the card); the points start right below it.
        const tf = fitText(title, f.w - 2 * pad, Math.max(c.u * 13, (f.h - 2 * pad) * 0.4), c.u * 7.5, c.u * 4.2, isUpper(title) ? c.font.dwU : c.font.dw, 1.04);
        const th = Math.max(c.u * 9, tf.lines * tf.size * 1.04 + tf.size * 0.3);
        out.push(at(c, T, headline(c, `title${i}`, { x: f.x + pad, y: f.y + pad, w: f.w - 2 * pad, h: th }, title, c.u * 7.5, { styleExtra: { color: onAccent ? "$bg" : "$ink", highlight: onAccent ? "$bg" : "$accent" } }), t + 0.15));
        out.push(at(c, T, body(c, `items${i}`, { x: f.x + pad, y: f.y + pad + th + c.u * 2, w: f.w - 2 * pad, h: f.h - 2 * pad - th - c.u * 2 }, lines(items).map((l) => `${onAccent ? "✓" : "✗"}  ${l}`).join("\n"), c.u * 4.2, { styleExtra: { color: onAccent ? "$bg" : "$muted" } }), t + 0.35));
      });
      const vs = c.u * 11;
      const vc = c.vertical ? { x: c.W / 2, y: (y0 + y1) / 2 } : { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
      out.push(at(c, T, shape(c, "vsdot", { x: vc.x - vs / 2, y: vc.y - vs / 2, w: vs, h: vs }, "$bg", { shape: "ellipse", stroke: "$accent", strokeWidth: r(c.u * 0.6), track: c.track + 7, in: enter(c, "pop") }), 0.75));
      out.push(at(c, T, txt(c, "vs", { x: vc.x - vs / 2, y: vc.y - vs / 2, w: vs, h: vs }, "VS", { fontFamily: c.font.display, fontWeight: c.font.displayWeight, fontSize: r(vs * 0.36), align: "center", valign: "middle", lineHeight: 1, color: "$accent" }, { track: c.track + 8, in: enter(c, "pop") }), 0.8));
      return clean(out);
    },
  },
  {
    id: "quote", kind: "scene", icon: "💬", duration: 5, name: L("Zitat", "Quote"), desc: L("Großes Zitat mit Anführungszeichen und Quelle.", "Big quote with quote marks and source."),
    fields: [
      { key: "quote", type: "text", label: L("Zitat", "Quote"), default: L("Das Beste ist: Ich kann jedes Detail nachträglich ändern.", "The best part: I can change every detail afterwards.") },
      { key: "author", type: "text", label: L("Von", "By"), default: L("Lea, Creatorin", "Lea, creator") },
    ],
    build: (c, v) => {
      const T = 5;
      const { x0, x1, y0, y1 } = c.safe;
      const qs = c.u * (c.vertical ? 34 : 30);
      return clean([
        at(c, T, bgPanel(c), 0),
        at(c, T, txt(c, "mark", { x: x0 - c.u * 1, y: Math.max(c.u, y0 - qs * 0.12), w: qs, h: qs }, "“", { fontFamily: c.font.display, fontWeight: 900, fontSize: r(qs), lineHeight: 1, color: "$accent" }, { frame: rf({ x: x0 - c.u * 1, y: Math.max(c.u, y0 - qs * 0.12), w: qs, h: qs, opacity: 0.9 }), in: enter(c, "pop"), track: c.track + 1 }), 0.1),
        at(c, T, headline(c, "quote", { x: x0, y: y0 + qs * 0.5, w: x1 - x0, h: (y1 - y0) - qs * 0.5 - c.u * 12 }, v.quote, c.u * (c.vertical ? 8 : 7.5), { styleExtra: { lineHeight: 1.12, valign: "middle" } }), 0.35),
        at(c, T, shape(c, "rule", { x: x0, y: y1 - c.u * 8.5, w: c.u * 8, h: c.u * 0.6 }, "$accent", { in: { type: "wipe", duration: 0.5, ease: "power3.inOut" } }), 1.2),
        at(c, T, body(c, "author", { x: x0 + c.u * 10, y: y1 - c.u * 11, w: x1 - x0 - c.u * 10, h: c.u * 6 }, v.author, c.u * 3.8, { styleExtra: { valign: "middle" } }), 1.3),
      ]);
    },
  },
  {
    id: "cta", kind: "scene", icon: "👉", duration: 4, name: L("Call to Action", "Call to action"), desc: L("Aufforderung mit pulsierendem Button.", "A call to action with a pulsing button."),
    fields: [
      { key: "title", type: "text", label: L("Überschrift", "Headline"), default: L("Probier es [[jetzt]] aus", "Try it [[now]]") },
      { key: "button", type: "text", label: L("Button", "Button"), default: L("Kostenlos starten", "Start for free") },
      { key: "sub", type: "text", label: L("Darunter (Website / Handle)", "Below (website / handle)"), default: (c) => c.brand?.website ?? c.brand?.handle ?? "open-motion.dev" },
    ],
    build: (c, v) => {
      const T = 4;
      const { x0, x1, y0, y1 } = c.safe;
      const w = x1 - x0;
      const cy = (y0 + y1) / 2;
      const btnSize = oneLine(v.button, w * 0.86, c.u * 5, c.font.bw * 1.12);
      const bw = Math.min(w, v.button.length * btnSize * c.font.bw * 1.12 + btnSize * 3);
      const bh = btnSize * 2.4;
      const by = cy + c.u * 4;
      const pulse = { scale: [{ t: 1.4, v: 1 }, { t: 1.75, v: 1.06, ease: "sine.inOut" }, { t: 2.1, v: 1, ease: "sine.inOut" }, { t: 2.45, v: 1.06, ease: "sine.inOut" }, { t: 2.8, v: 1, ease: "sine.inOut" }] };
      return clean([
        at(c, T, bgPanel(c), 0),
        at(c, T, glow(c, c.W / 2, by + bh / 2, Math.max(c.W, c.H) * 0.7), 0),
        at(c, T, headline(c, "title", { x: x0, y: cy - c.u * 26, w, h: c.u * 26 }, v.title, c.u * 11, { styleExtra: { align: "center", valign: "bottom" } }), 0.1),
        at(c, T, shape(c, "button", { x: c.W / 2 - bw / 2, y: by, w: bw, h: bh }, "$accent", { radius: r(bh / 2), in: enter(c, "pop"), keys: pulse }), 0.6),
        at(c, T, txt(c, "btntext", { x: c.W / 2 - bw / 2, y: by, w: bw, h: bh }, v.button, { fontFamily: c.font.body, fontWeight: 700, fontSize: btnSize, align: "center", valign: "middle", color: "$bg", lineHeight: 1 }, { in: enter(c, "pop"), keys: pulse, track: c.track + 7 }), 0.65),
        at(c, T, body(c, "sub", { x: x0, y: by + bh + c.u * 4, w, h: c.u * 7 }, v.sub, c.u * 3.8, { styleExtra: { align: "center" } }), 1),
      ]);
    },
  },
  {
    id: "outro", kind: "scene", icon: "👋", duration: 4, name: L("Outro", "Outro"), desc: L("Logo, Dank, Handle und Website zum Schluss.", "Logo, thanks, handle and website at the end."),
    fields: [
      { key: "text", type: "text", label: L("Text", "Text"), default: L("Danke fürs Zuschauen!", "Thanks for watching!") },
      { key: "handle", type: "text", label: L("Handle", "Handle"), default: (c) => c.brand?.handle ?? "@openmotion" },
      { key: "website", type: "text", label: L("Website", "Website"), default: (c) => c.brand?.website ?? "" },
    ],
    build: (c, v) => {
      const T = 4;
      const { x0, x1, y0, y1 } = c.safe;
      const w = x1 - x0;
      const cy = (y0 + y1) / 2;
      const logoH = c.u * 12;
      const lg = logo(c, "logo", { x: x0, y: cy - logoH - c.u * 14, w, h: logoH });
      const ty = lg ? cy - c.u * 10 : cy - c.u * 16;
      return clean([
        at(c, T, bgPanel(c), 0),
        at(c, T, glow(c, c.W / 2, cy, Math.max(c.W, c.H) * 0.8, accent2(c), 0.28), 0),
        at(c, T, lg, 0.1),
        at(c, T, headline(c, "text", { x: x0, y: ty, w, h: c.u * 22 }, v.text, c.u * 10, { styleExtra: { align: "center", valign: "middle" } }), 0.35),
        v.handle ? at(c, T, txt(c, "handle", { x: x0, y: ty + c.u * 25, w, h: c.u * 7 }, v.handle, { fontFamily: c.font.display, fontWeight: c.font.displayWeight, fontSize: oneLine(v.handle, w, c.u * 5.5, isUpper(v.handle) ? c.font.dwU : c.font.dw), align: "center", color: "$accent" }, { in: enter(c, "slideUp") }), 0.9) : null,
        v.website ? at(c, T, body(c, "website", { x: x0, y: ty + c.u * 33, w, h: c.u * 6 }, v.website, c.u * 3.8, { styleExtra: { align: "center" } }), 1.1) : null,
      ]);
    },
  },
  {
    id: "endscreen", kind: "scene", icon: "▶️", duration: 10, name: L("YouTube-Endcard", "YouTube end screen"), desc: L("Platz für 2 Video-Kacheln und Abo-Button (YouTube-Endbildschirm, 5–20 s).", "Room for 2 video tiles and the subscribe button (YouTube end screen, 5–20 s)."),
    fields: [{ key: "text", type: "text", label: L("Text", "Text"), default: L("Schau als Nächstes:", "Watch next:") }],
    build: (c, v) => {
      const T = 10;
      const { x0, x1, y0, y1 } = c.safe;
      const out: (Layer | null)[] = [at(c, T, bgPanel(c), 0), at(c, T, glow(c, c.W * 0.5, c.H * 0.5, Math.max(c.W, c.H), "$accent", 0.2), 0)];
      out.push(at(c, T, headline(c, "text", { x: x0, y: y0, w: x1 - x0, h: c.u * 10 }, v.text, c.u * 7, { styleExtra: { align: c.vertical ? "center" : "left" } }), 0.2));
      // Video tiles (16:9 boxes) where YouTube's end screen elements go; the subscribe circle uses the logo.
      const tileW = c.vertical ? x1 - x0 : (x1 - x0 - c.u * 6) * 0.4;
      const tileH = tileW * 9 / 16;
      const tiles = c.vertical
        ? [{ x: x0, y: y0 + c.u * 16 }, { x: x0, y: y0 + c.u * 16 + tileH + c.u * 5 }]
        : [{ x: x0, y: y0 + c.u * 18 }, { x: x0 + tileW + c.u * 6, y: y0 + c.u * 18 }];
      tiles.forEach((p, i) => out.push(at(c, T, shape(c, `tile${i}`, { ...p, w: tileW, h: tileH }, "$surface", { radius: r(c.u * 1.5), stroke: "$accent", strokeWidth: r(c.u * 0.3), ...card(c), in: enter(c, "slideUp") }), 0.4 + i * 0.2)));
      const sub = c.u * (c.vertical ? 16 : 18);
      const sp = c.vertical ? { x: c.W / 2 - sub / 2, y: tiles[1].y + tileH + c.u * 6 } : { x: x1 - sub, y: y0 + c.u * 18 + (tileH - sub) / 2 };
      const lg = logo(c, "logo", { x: sp.x + sub * 0.18, y: sp.y + sub * 0.18, w: sub * 0.64, h: sub * 0.64 }, { track: c.track + 8 });
      out.push(at(c, T, shape(c, "subscribe", { ...sp, w: sub, h: sub }, "$surface", { shape: "ellipse", stroke: "$accent", strokeWidth: r(c.u * 0.5), in: enter(c, "pop") }), 0.8));
      out.push(lg ? at(c, T, lg, 0.9) : at(c, T, txt(c, "subtext", { ...sp, w: sub, h: sub }, c.lang === "de" ? "ABO" : "SUB", { fontFamily: c.font.display, fontWeight: c.font.displayWeight, fontSize: r(sub * 0.24), align: "center", valign: "middle", color: "$accent", lineHeight: 1 }, { in: enter(c, "pop") }), 0.9));
      return clean(out);
    },
  },
  {
    id: "countdown", kind: "scene", icon: "⏱️", duration: 3, name: L("Countdown 3-2-1", "Countdown 3-2-1"), desc: L("Drei, zwei, eins – mit Ring.", "Three, two, one – with a ring."),
    fields: [],
    build: (c) => {
      const T = 3;
      const ring = Math.min(c.safe.x1 - c.safe.x0, c.safe.y1 - c.safe.y0) * 0.7;
      const cx = c.W / 2;
      const cy = c.H / 2;
      const out: (Layer | null)[] = [at(c, T, bgPanel(c), 0)];
      out.push(at(c, T, svg(c, "ring", { x: cx - ring / 2, y: cy - ring / 2, w: ring, h: ring }, `<circle cx="${r(ring / 2)}" cy="${r(ring / 2)}" r="${r(ring / 2 - c.u)}" transform="rotate(-90 ${r(ring / 2)} ${r(ring / 2)})" style="fill:none;stroke:$accent;stroke-width:${r(c.u * 1.2)};stroke-linecap:round"/>`, { draw: { duration: 2.9, ease: "linear" } }), 0));
      ["3", "2", "1"].forEach((n, i) => out.push(at(c, T, txt(c, `n${n}`, { x: cx - ring / 2, y: cy - ring * 0.35, w: ring, h: ring * 0.7 }, n, { fontFamily: c.font.display, fontWeight: c.font.displayWeight, fontSize: r(ring * 0.5), align: "center", valign: "middle", lineHeight: 1 }, { in: { type: "pop", duration: 0.3, ease: "back.out(2)" }, out: { type: "zoomOut", duration: 0.2 } }), i, i + 1)));
      return clean(out);
    },
  },
  {
    id: "checklist", kind: "scene", icon: "✅", duration: 5, name: L("Checkliste", "Checklist"), desc: L("Punkte bekommen nacheinander einen gezeichneten Haken.", "Points get a hand-drawn tick, one after another."),
    fields: [
      { key: "title", type: "text", label: L("Überschrift", "Headline"), default: L("Bereit für dein erstes Video?", "Ready for your first video?") },
      { key: "items", type: "lines", label: L("Punkte (je Zeile einer)", "Points (one per line)"), default: L("Aufnahme vorhanden\nStil gewählt\nMarke hinterlegt", "Recording ready\nStyle picked\nBrand set up") },
    ],
    build: (c, v) => {
      const T = 5;
      const { x0, x1, y0, y1 } = c.safe;
      const items = lines(v.items, 5);
      const out: (Layer | null)[] = [at(c, T, bgPanel(c), 0)];
      const titleH = c.u * (c.vertical ? 22 : 16);
      const rowH = Math.min(c.u * (c.vertical ? 16 : 13), (y1 - y0 - titleH - c.u * 5) / Math.max(1, items.length));
      const by = y0 + Math.max(0, (y1 - y0 - (titleH + c.u * 5 + rowH * items.length)) * 0.4);
      out.push(at(c, T, headline(c, "title", { x: x0, y: by, w: x1 - x0, h: titleH }, v.title, c.u * (c.vertical ? 9 : 8.5)), 0.1));
      const top = by + titleH + c.u * 5;
      const box = Math.min(rowH * 0.62, c.u * 7.5);
      items.forEach((it, i) => {
        const y = top + i * rowH;
        const t = 0.6 + i * 0.5;
        const by = y + (rowH * 0.8 - box) / 2;
        out.push(at(c, T, shape(c, `box${i}`, { x: x0, y: by, w: box, h: box }, "$surface", { radius: r(box * 0.22), stroke: "$accent", strokeWidth: r(c.u * 0.35), in: enter(c, "pop") }), t));
        out.push(at(c, T, svg(c, `tick${i}`, { x: x0, y: by, w: box, h: box }, `<path d="M ${r(box * 0.22)} ${r(box * 0.52)} L ${r(box * 0.43)} ${r(box * 0.72)} L ${r(box * 0.8)} ${r(box * 0.28)}" style="fill:none;stroke:$accent;stroke-width:${r(box * 0.13)};stroke-linecap:round;stroke-linejoin:round"/>`, { draw: { duration: 0.35, ease: "power2.out" }, track: c.track + 7 }), t + 0.35));
        out.push(at(c, T, body(c, `item${i}`, { x: x0 + box + c.u * 3, y, w: x1 - x0 - box - c.u * 3, h: rowH * 0.8 }, it, c.u * (c.vertical ? 5 : 4.6), { styleExtra: { color: "$ink", valign: "middle" }, in: enter(c, "slideLeft") }), t + 0.1));
      });
      return clean(out);
    },
  },

  {
    id: "timeline", kind: "scene", icon: "🗓️", duration: 5, name: L("Zeitstrahl", "Timeline"), desc: L("Meilensteine mit Jahreszahlen auf einer Linie, die sich zeichnet.", "Milestones with dates on a line that draws itself."),
    fields: [{ key: "items", type: "lines", label: L("Je Zeile: Datum | Ereignis", "One per line: date | event"), default: L("2024 | Die Idee\n2025 | Erste Version\n2026 | 10.000 Nutzer", "2024 | The idea\n2025 | First release\n2026 | 10,000 users") }],
    build: (c, v) => {
      const T = 5;
      const { x0, x1, y0, y1 } = c.safe;
      const items = lines(v.items, 5).map((l) => { const [d, ...rest] = l.split("|"); return { date: d.trim(), text: rest.join("|").trim() }; });
      const n = Math.max(1, items.length);
      const out: (Layer | null)[] = [at(c, T, bgPanel(c), 0)];
      const dot = c.u * 3.2;
      if (c.vertical) {
        const lx = x0 + dot / 2;
        const rowH = (y1 - y0) / n;
        out.push(at(c, T, svg(c, "line", { x: lx - c.u * 0.5, y: y0 + rowH * 0.3, w: c.u, h: rowH * (n - 1) + 1 }, `<line x1="${r(c.u / 2)}" y1="0" x2="${r(c.u / 2)}" y2="${r(rowH * (n - 1))}" style="stroke:$accent;stroke-width:${r(c.u * 0.5)}"/>`, { draw: { duration: 0.5 + n * 0.4, ease: "power2.inOut" } }), 0.2));
        items.forEach((it, i) => {
          const y = y0 + rowH * i + rowH * 0.3;
          const t = 0.3 + i * 0.4;
          out.push(at(c, T, shape(c, `dot${i}`, { x: lx - dot / 2, y: y - dot / 2, w: dot, h: dot }, "$accent", { shape: "ellipse", in: enter(c, "pop") }), t));
          const dw = x1 - lx - dot - c.u * 2;
          out.push(at(c, T, txt(c, `date${i}`, { x: lx + dot + c.u * 2, y: y - c.u * 4.5, w: dw, h: c.u * 9 }, it.date, { fontFamily: c.font.display, fontWeight: c.font.displayWeight, fontSize: oneLine(it.date, dw, c.u * 7, isUpper(it.date) ? c.font.dwU : c.font.dw), color: "$accent", valign: "middle", lineHeight: 1.1 }, { in: enter(c, "slideLeft") }), t + 0.05));
          out.push(at(c, T, body(c, `text${i}`, { x: lx + dot + c.u * 2, y: y + c.u * 5, w: x1 - lx - dot - c.u * 2, h: rowH - c.u * 10 }, it.text, c.u * 4.6, { styleExtra: { color: "$ink" } }), t + 0.15));
        });
      } else {
        const ly = (y0 + y1) / 2;
        const colW = (x1 - x0) / n;
        out.push(at(c, T, svg(c, "line", { x: x0, y: ly - c.u * 0.5, w: x1 - x0, h: c.u }, `<line x1="0" y1="${r(c.u / 2)}" x2="${r(x1 - x0)}" y2="${r(c.u / 2)}" style="stroke:$surface;stroke-width:${r(c.u * 0.5)}"/>`, { draw: { duration: 0.5 + n * 0.4, ease: "power2.inOut" } }), 0.2));
        items.forEach((it, i) => {
          const cx = x0 + colW * (i + 0.5);
          const t = 0.3 + i * 0.4;
          const up = i % 2 === 0;
          out.push(at(c, T, shape(c, `dot${i}`, { x: cx - dot / 2, y: ly - dot / 2, w: dot, h: dot }, "$accent", { shape: "ellipse", in: enter(c, "pop") }), t));
          out.push(at(c, T, txt(c, `date${i}`, { x: cx - colW / 2 + c.u, y: up ? ly - c.u * 22 : ly + c.u * 4, w: colW - c.u * 2, h: c.u * 9 }, it.date, { fontFamily: c.font.display, fontWeight: c.font.displayWeight, fontSize: oneLine(it.date, colW - c.u * 2, c.u * 7, isUpper(it.date) ? c.font.dwU : c.font.dw), color: "$accent", align: "center", valign: up ? "bottom" : "top", lineHeight: 1.1 }, { in: enter(c, up ? "slideUp" : "slideDown") }), t + 0.05));
          out.push(at(c, T, body(c, `text${i}`, { x: cx - colW / 2 + c.u, y: up ? ly - c.u * 12.5 : ly + c.u * 13.5, w: colW - c.u * 2, h: c.u * 9 }, it.text, c.u * 3.8, { styleExtra: { color: "$ink", align: "center", valign: up ? "bottom" : "top" } }), t + 0.15));
        });
      }
      return clean(out);
    },
  },

  // ─── overlays: on top of whatever is on screen (facecam, screen recording) ───
  {
    id: "lowerthird", kind: "overlay", icon: "🏷️", duration: 4, name: L("Bauchbinde", "Lower third"), desc: L("Name und Rolle unten links.", "Name and role at the bottom left."),
    fields: [
      { key: "name", type: "text", label: L("Name", "Name"), default: (c) => c.brand?.name ?? (c.lang === "de" ? "Max Mustermann" : "Alex Example") },
      { key: "role", type: "text", label: L("Rolle", "Role"), default: L("Gründer", "Founder") },
    ],
    build: (c, v) => {
      const T = 4;
      const { x0, x1, y1 } = c.safe;
      // Long names shrink instead of wrapping (the bar is one line by design).
      const room = x1 - x0 - c.u * 6;
      const nameSize = r(Math.min(c.u * (c.vertical ? 5.2 : 4.6), room / Math.max(1, v.name.length * c.font.dw)));
      const roleSize = r(Math.min(nameSize * 0.62, room / Math.max(1, v.role.length * c.font.bw)));
      const w = Math.min(x1 - x0, Math.max(v.name.length * nameSize * c.font.dw, v.role.length * roleSize * c.font.bw) + c.u * 8);
      const h = nameSize * 1.25 + roleSize * 1.4 + c.u * 3;
      const x = c.vertical ? (c.W - w) / 2 : x0;
      const y = c.vertical ? y1 - h - c.u * 6 : y1 - h;
      return clean([
        at(c, T, shape(c, "panel", { x, y, w, h }, "$surface", { radius: r(c.u * 1.2), ...card(c), in: { type: "wipe", duration: 0.5, ease: c.motion.enter } }), 0),
        at(c, T, shape(c, "bar", { x, y, w: c.u * 0.9, h }, "$accent", { in: { type: "wipeDown", duration: 0.4, ease: c.motion.enter } }), 0.1),
        at(c, T, txt(c, "name", { x: x + c.u * 3.5, y: y + c.u * 1.4, w: w - c.u * 5, h: nameSize * 1.25 }, v.name, { fontFamily: c.font.display, fontWeight: c.font.displayWeight, fontSize: nameSize, lineHeight: 1.15 }, { in: enter(c, "slideRight") }), 0.25),
        at(c, T, txt(c, "role", { x: x + c.u * 3.5, y: y + c.u * 1.6 + nameSize * 1.25, w: w - c.u * 5, h: roleSize * 1.4 }, v.role, { fontSize: roleSize, color: "$muted", lineHeight: 1.3 }, { in: enter(c, "slideRight") }), 0.4),
      ]);
    },
  },
  {
    id: "callout", kind: "overlay", icon: "📍", duration: 3, name: L("Hinweis mit Linie", "Callout with line"), desc: L("Ein Label mit Linie, die auf etwas zeigt.", "A label with a line pointing at something."),
    fields: [{ key: "text", type: "text", label: L("Text", "Text"), default: L("Hier klicken", "Click here") }],
    build: (c, v) => {
      const T = 3;
      const maxW = (c.safe.x1 - c.safe.x0) * (c.vertical ? 1 : 0.5);
      const size = oneLine(v.text, maxW - c.u * 6, c.u * 3.6, c.font.bw * 1.12);
      const w = Math.min(maxW, v.text.length * size * c.font.bw * 1.12 + c.u * 6);
      const h = size * 2.2;
      const target = { x: c.W * 0.5, y: c.H * 0.5 };
      const lx = c.vertical ? c.W / 2 - w / 2 : Math.min(c.safe.x1 - w, target.x + c.u * 18);
      const ly = c.vertical ? target.y - c.u * 30 : target.y - c.u * 22;
      const ax = c.vertical ? c.W / 2 : lx;
      const ay = ly + h;
      const bx = Math.min(target.x, ax);
      const by = Math.min(target.y, ay);
      const bw = Math.max(c.u, Math.abs(target.x - ax));
      const bh = Math.max(c.u, Math.abs(target.y - ay));
      return clean([
        at(c, T, svg(c, "line", { x: bx - c.u, y: by - c.u, w: bw + c.u * 2, h: bh + c.u * 2 }, `<line x1="${r(ax - bx + c.u)}" y1="${r(ay - by + c.u)}" x2="${r(target.x - bx + c.u)}" y2="${r(target.y - by + c.u)}" style="stroke:$accent;stroke-width:${r(c.u * 0.45)};stroke-linecap:round"/><circle cx="${r(target.x - bx + c.u)}" cy="${r(target.y - by + c.u)}" r="${r(c.u * 0.9)}" style="fill:$accent"/>`, { draw: { duration: 0.5, ease: "power2.out" } }), 0),
        at(c, T, shape(c, "pill", { x: lx, y: ly, w, h }, "$accent", { radius: r(h / 2), in: enter(c, "pop") }), 0.35),
        at(c, T, txt(c, "text", { x: lx, y: ly, w, h }, v.text, { fontWeight: 700, fontSize: size, align: "center", valign: "middle", color: "$bg", lineHeight: 1 }, { in: enter(c, "pop") }), 0.4),
      ]);
    },
  },
  {
    id: "subscribe", kind: "overlay", icon: "🔔", duration: 3.5, name: L("Abo-Button", "Subscribe button"), desc: L("Button poppt auf und wechselt zu „Abonniert“.", "Button pops in and turns into “Subscribed”."),
    fields: [
      { key: "text", type: "text", label: L("Button", "Button"), default: L("Abonnieren", "Subscribe") },
      { key: "done", type: "text", label: L("Danach", "After"), default: L("Abonniert ✓", "Subscribed ✓") },
    ],
    build: (c, v) => {
      const T = 3.5;
      const longest = Math.max(v.text.length, v.done.length);
      const size = oneLine("x".repeat(longest), c.safe.x1 - c.safe.x0 - c.u * 8, c.u * 3.8, c.font.bw * 1.12);
      const w = longest * size * c.font.bw * 1.12 + c.u * 8;
      const h = size * 2.3;
      const x = (c.W - w) / 2;
      const y = c.vertical ? c.safe.y1 - h - c.u * 22 : c.safe.y1 - h - c.u * 2;
      return clean([
        at(c, T, shape(c, "btn", { x, y, w, h }, "#E62117", { radius: r(h / 2), in: { type: "pop", duration: 0.45, ease: "back.out(2)" } }), 0, 1.6),
        at(c, T, txt(c, "btntext", { x, y, w, h }, v.text, { fontWeight: 700, fontSize: size, align: "center", valign: "middle", color: "#FFFFFF", lineHeight: 1 }, { in: { type: "pop", duration: 0.45, ease: "back.out(2)" }, out: { type: "fade", duration: 0.15 } }), 0.05, 1.6),
        at(c, T, shape(c, "btn2", { x, y, w, h }, "$surface", { radius: r(h / 2), in: { type: "fade", duration: 0.15 } }), 1.55),
        at(c, T, txt(c, "donetext", { x, y, w, h }, v.done, { fontWeight: 700, fontSize: size, align: "center", valign: "middle", color: "$ink", lineHeight: 1 }, { in: { type: "fade", duration: 0.15 } }), 1.6),
      ]);
    },
  },
  {
    id: "keyword", kind: "overlay", icon: "✨", duration: 2.5, name: L("Schlagwort", "Keyword"), desc: L("Ein Schlagwort poppt groß auf.", "A keyword pops up big."),
    fields: [{ key: "word", type: "text", label: L("Wort", "Word"), default: L("Automatisch", "Automatic") }],
    build: (c, v) => {
      const T = 2.5;
      const { x0, x1, y0 } = c.safe;
      const size = r(Math.min(c.u * (c.vertical ? 9 : 8), ((x1 - x0) * 0.85) / Math.max(3, v.word.length * c.font.dw)));
      const w = Math.min(x1 - x0, v.word.length * size * c.font.dw + size * 1.2);
      const h = size * 1.5;
      const y = c.vertical ? y0 + c.u * 10 : y0 + c.u * 4;
      return clean([
        at(c, T, shape(c, "pill", { x: (c.W - w) / 2, y, w, h }, "$accent", { radius: r(c.u * 1.5), frame: rf({ x: (c.W - w) / 2, y, w, h, rotation: -2 }), in: { type: "pop", duration: 0.4, ease: "back.out(1.8)" } }), 0),
        at(c, T, txt(c, "word", { x: (c.W - w) / 2, y, w, h }, v.word, { fontFamily: c.font.display, fontWeight: c.font.displayWeight, fontSize: size, align: "center", valign: "middle", color: "$bg", lineHeight: 1 }, { frame: rf({ x: (c.W - w) / 2, y, w, h, rotation: -2 }), in: { type: "pop", duration: 0.4, ease: "back.out(1.8)" } }), 0.05),
      ]);
    },
  },
  {
    id: "handle", kind: "overlay", icon: "@", duration: 3, name: L("Social-Handle", "Social handle"), desc: L("Dein Handle als Pille, unten mittig.", "Your handle as a pill, bottom center."),
    fields: [{ key: "handle", type: "text", label: L("Handle", "Handle"), default: (c) => c.brand?.handle ?? "@openmotion" }],
    build: (c, v) => {
      const T = 3;
      const size = oneLine(v.handle, c.safe.x1 - c.safe.x0 - c.u * 12, c.u * 3.6, c.font.bw * 1.12);
      const icon = Math.max(size * 1.7, c.u * 5);
      const w = v.handle.length * size * c.font.bw * 1.12 + icon + c.u * 6;
      const h = icon + c.u * 1.6;
      const x = (c.W - w) / 2;
      const y = c.vertical ? c.safe.y1 - h - c.u * 8 : c.safe.y1 - h;
      return clean([
        at(c, T, shape(c, "pill", { x, y, w, h }, "$surface", { radius: r(h / 2), ...card(c), ...(c.style === "pastel" ? { radius: r(h / 2) } : {}), in: enter(c, "slideUp") }), 0),
        at(c, T, shape(c, "icon", { x: x + c.u * 0.8, y: y + c.u * 0.8, w: icon, h: icon }, "$accent", { shape: "ellipse", in: enter(c, "pop") }), 0.15),
        at(c, T, txt(c, "at", { x: x + c.u * 0.8, y: y + c.u * 0.8, w: icon, h: icon }, "@", { fontWeight: 700, fontSize: r(icon * 0.55), align: "center", valign: "middle", color: "$bg", lineHeight: 1 }, { in: enter(c, "pop") }), 0.2),
        at(c, T, txt(c, "handle", { x: x + icon + c.u * 2.5, y, w: w - icon - c.u * 3, h }, v.handle, { fontWeight: 700, fontSize: size, valign: "middle", lineHeight: 1 }, { in: enter(c, "fade") }), 0.3),
      ]);
    },
  },
  {
    id: "circle", kind: "overlay", icon: "⭕", duration: 2.5, name: L("Einkreisen", "Circle it"), desc: L("Ein handgezeichneter Kreis markiert eine Stelle (für Bildschirmaufnahmen).", "A hand-drawn circle marks a spot (for screen recordings)."),
    fields: [{ key: "label", type: "text", label: L("Beschriftung (optional)", "Label (optional)"), default: L("Wichtig!", "Important!") }],
    build: (c, v) => {
      const T = 2.5;
      const w = c.u * 30;
      const h = c.u * 16;
      const x = c.W / 2 - w / 2;
      const y = c.H / 2 - h / 2;
      const size = r(c.u * 3.6);
      // A loose, slightly overshooting loop looks drawn by hand.
      const path = `M ${r(w * 0.55)} ${r(h * 0.06)} C ${r(w * 0.95)} ${r(h * 0.02)}, ${r(w * 1.0)} ${r(h * 0.8)}, ${r(w * 0.5)} ${r(h * 0.94)} C ${r(w * 0.05)} ${r(h * 1.02)}, ${r(w * -0.02)} ${r(h * 0.2)}, ${r(w * 0.42)} ${r(h * 0.08)} C ${r(w * 0.58)} ${r(h * 0.04)}, ${r(w * 0.68)} ${r(h * 0.1)}, ${r(w * 0.72)} ${r(h * 0.16)}`;
      return clean([
        at(c, T, svg(c, "ring", { x, y, w, h }, `<path d="${path}" style="fill:none;stroke:$accent;stroke-width:${r(c.u * 0.8)};stroke-linecap:round"/>`, { draw: { duration: 0.6, ease: "power2.inOut" } }), 0),
        v.label ? (() => {
          const cw = (isUpper(v.label) ? c.font.dwU : c.font.dw) * 1.08;
          const room = c.safe.x1 - (x + w * 0.6);
          // One line if it fits at a readable size, else up to two lines.
          const fit = fitText(v.label, room, size * 2.8, size, size * 0.7, cw, 1.2, 2);
          const lw = Math.min(room, Math.max(...fit.text.split("\n").map((l) => l.length)) * fit.size * cw + c.u * 2);
          const lh = fit.lines * fit.size * 1.2 + fit.size * 0.3;
          const f = rf({ x: x + w * 0.6, y: y - lh - c.u, w: lw, h: lh, rotation: -4 });
          return at(c, T, txt(c, "label", f, fit.text, { fontFamily: c.font.display, fontWeight: c.font.displayWeight, fontSize: fit.size, color: "$accent", lineHeight: 1.2 }, { frame: f, in: enter(c, "pop") }), 0.5);
        })() : null,
      ]);
    },
  },
  {
    id: "arrow", kind: "overlay", icon: "➡️", duration: 2.5, name: L("Pfeil", "Arrow"), desc: L("Ein gezeichneter Pfeil zeigt auf die Bildmitte, mit Text.", "A drawn arrow points to the center, with text."),
    fields: [{ key: "label", type: "text", label: L("Text", "Text"), default: L("Genau hier", "Right here") }],
    build: (c, v) => {
      const T = 2.5;
      const w = c.u * 24;
      const h = c.u * 16;
      const x = c.W / 2 - w - c.u * 2;
      const y = c.H / 2 - h - c.u * 2;
      const size = r(c.u * 3.8);
      return clean([
        at(c, T, svg(c, "arrow", { x, y, w, h }, `<path d="M ${r(w * 0.04)} ${r(h * 0.1)} Q ${r(w * 0.6)} ${r(h * 0.0)}, ${r(w * 0.94)} ${r(h * 0.9)}" style="fill:none;stroke:$accent;stroke-width:${r(c.u * 0.7)};stroke-linecap:round"/><path d="M ${r(w * 0.72)} ${r(h * 0.78)} L ${r(w * 0.95)} ${r(h * 0.93)} L ${r(w * 0.98)} ${r(h * 0.62)}" style="fill:none;stroke:$accent;stroke-width:${r(c.u * 0.7)};stroke-linecap:round;stroke-linejoin:round"/>`, { draw: { duration: 0.6, stagger: 0.2, ease: "power2.out" } }), 0),
        (() => {
          const lx = Math.max(c.safe.x0, x - c.u * 4);
          const cw = (isUpper(v.label) ? c.font.dwU : c.font.dw) * 1.08;
          const fit = fitText(v.label, c.safe.x1 - lx, size * 2.8, size, size * 0.7, cw, 1.2, 2);
          const lw = Math.min(c.safe.x1 - lx, Math.max(...fit.text.split("\n").map((l) => l.length)) * fit.size * cw + c.u * 2);
          const lh = fit.lines * fit.size * 1.2 + fit.size * 0.3;
          return at(c, T, txt(c, "label", { x: lx, y: y - lh - c.u * 0.5, w: lw, h: lh }, fit.text, { fontFamily: c.font.display, fontWeight: c.font.displayWeight, fontSize: fit.size, color: "$accent", lineHeight: 1.2 }, { in: enter(c, "pop") }), 0.3);
        })(),
      ]);
    },
  },
];

// ───────────── inserting ─────────────

export function getTemplate(id: string): TemplateDef | undefined {
  return TEMPLATES.find((t) => t.id === id);
}

/** Field defaults for a project (brand and language aware), for the gallery form and the AI. */
export function templateDefaults(spec: MotionSpec, id: string): Record<string, string> {
  const t = getTemplate(id);
  if (!t) return {};
  const c = context(spec, 0, "x", 0, false);
  return Object.fromEntries(t.fields.map((f) => [f.key, typeof f.default === "function" ? f.default(c) : f.default[c.lang]]));
}

/**
 * Ops that insert a template at time t (seconds on the composition).
 * Scene templates: a new scene after the scene at t, or, when a recording runs through the video,
 * a full-screen card on top at t. Overlays: at t inside the current scene.
 */
export function templateOps(spec: MotionSpec, id: string, values: Record<string, string> = {}, t = 0): { ops: PatchOp[]; at: number; layers: string[] } {
  const tpl = getTemplate(id);
  if (!tpl) throw new Error(`Unknown template "${id}". Available: ${TEMPLATES.map((x) => x.id).join(", ")}`);
  const v = { ...templateDefaults(spec, id), ...Object.fromEntries(Object.entries(values).filter(([, x]) => typeof x === "string")) };
  const scenes = sceneTimings(spec);
  const total = compositionDuration(spec);
  const tt = Math.max(0, Math.min(t, Math.max(0, total - 0.01)));
  const cur = spec.scenes.find((s) => { const st = scenes.get(s.id)!; return tt >= st.start && tt < st.end; }) ?? spec.scenes[spec.scenes.length - 1];
  const recording = spec.layers.some((l) => l.type === "video" && !l.scene && !l.hidden && l.duration > 4);
  const ops: PatchOp[] = [];
  let sceneId: string;
  let t0: number;
  let absStart: number;
  let overlayScene = false;
  let track: number;
  let fitInto = 0;
  if (tpl.kind === "scene" && !recording) {
    sceneId = uniqueScene(spec, tpl.id);
    const scene: Scene = { id: sceneId, name: tpl.name[spec.meta.lang === "de" ? "de" : "en"], duration: tpl.duration };
    const index = cur ? spec.scenes.indexOf(cur) + 1 : spec.scenes.length;
    ops.push({ op: "addScene", scene, index });
    t0 = 0;
    absStart = cur ? scenes.get(cur.id)!.end : total;
    track = 10;
  } else {
    if (!cur) {
      sceneId = uniqueScene(spec, "s");
      ops.push({ op: "addScene", scene: { id: sceneId, name: "Scene 1", duration: Math.max(tpl.duration, total || tpl.duration) } });
      t0 = tt;
    } else {
      sceneId = cur.id;
      const st = scenes.get(cur.id)!;
      t0 = Math.round((tt - st.start) * (st.speed ?? 1) * 100) / 100;
      // Near the end of a scene: shorten the template to what is left (≥ 2 s), otherwise make the scene longer.
      const left = st.end - tt;
      const need = (tt - st.start) + tpl.duration;
      if (need > cur.duration + 1e-3 && !recording && left < 2) ops.push({ op: "scene", id: cur.id, set: { duration: Math.round(need * 100) / 100 } });
      else if (need > cur.duration + 1e-3 && !recording) fitInto = Math.round(left * (st.speed ?? 1) * 100) / 100;
    }
    absStart = tt;
    overlayScene = tpl.kind === "scene";
    track = 60;
  }
  const prefix = uniquePrefix(spec, tpl.id);
  const c = context(spec, t0, sceneId, track, overlayScene, (name) => `${prefix}-${name}`);
  let layers = withPalette(spec, tpl.build(c, v));
  if (fitInto) layers = layers.map((l) => ({ ...l, duration: Math.max(0.2, Math.min(l.duration, Math.round((t0 + fitInto - l.start) * 100) / 100)) }));
  for (const layer of layers) ops.push({ op: "add", layer: { ...layer, meta: { ...(layer.meta ?? {}), template: tpl.id } } });
  return { ops, at: absStart, layers: layers.map((l) => l.id) };
}

/**
 * Templates speak in palette tokens ($bg, $ink, $surface, $muted, $accent, $accent2). A project without some of
 * them (an older or hand-made palette) gets the derived color instead, so a template never breaks a spec.
 */
function withPalette(spec: MotionSpec, layers: Layer[]): Layer[] {
  const pal = spec.style?.palette ?? {};
  const bgHex = /^#[0-9a-f]{6}$/i.test(spec.canvas.background ?? "") ? spec.canvas.background : undefined;
  const derived = brandPalette({ accent: pal.accent ?? Object.values(pal).find((v) => /^#[0-9a-f]{6}$/i.test(v) && v !== pal.bg) ?? "#FF5A1F", bg: pal.bg ?? bgHex, ink: pal.ink }, {});
  derived.accent2 = pal.accent2 ?? derived.accent;
  const json = JSON.stringify(layers).replace(/\$([a-z][a-z0-9-]*)/g, (m, name: string) => (name in pal ? m : derived[name] ?? m));
  return JSON.parse(json) as Layer[];
}

function uniqueScene(spec: MotionSpec, base: string): string {
  for (let i = 1; ; i++) if (!spec.scenes.some((s) => s.id === `${base}${i}`)) return `${base}${i}`;
}

function uniquePrefix(spec: MotionSpec, base: string): string {
  for (let i = 1; ; i++) if (!spec.layers.some((l) => l.id.startsWith(`${base}${i}-`))) return `${base}${i}`;
}

function context(spec: MotionSpec, t0: number, scene: string, track: number, overlayScene: boolean, id: (n: string) => string = (n) => n): TemplateCtx {
  const { width: W, height: H } = spec.canvas;
  const u = Math.min(W, H) / 100;
  const ratio = W / H;
  const vertical = ratio < 0.7;
  const narrow = ratio < 1.2;
  // Same safe areas the AI is told about (platform buttons in 9:16 cover the bottom and the right edge).
  const safe = ratio < 0.7 ? { x0: W * 0.074, y0: H * 0.135, x1: W * 0.926, y1: H * 0.78 }
    : ratio < 0.9 ? { x0: W * 0.074, y0: H * 0.09, x1: W * 0.926, y1: H * 0.91 }
    : ratio < 1.2 ? { x0: W * 0.074, y0: H * 0.074, x1: W * 0.926, y1: H * 0.926 }
    : { x0: W * 0.0625, y0: H * 0.093, x1: W * 0.9375, y1: H * 0.907 };
  const st: StyleDef | undefined = getStyle(spec.meta.style);
  const brand = spec.meta.brand;
  const display = brand?.display ?? st?.fonts.display ?? firstFont(spec, "display") ?? "Inter";
  const bodyF = brand?.body ?? st?.fonts.body ?? firstFont(spec, "body") ?? display;
  const known = (f: string) => STYLES.find((s) => s.fonts.display === f);
  const knownBody = (f: string) => STYLES.find((s) => s.fonts.body === f);
  const lang = spec.meta.lang?.startsWith("de") ? "de" : "en";
  return {
    W, H, u, vertical, narrow, safe, lang,
    font: {
      display, body: bodyF,
      displayWeight: st && display === st.fonts.display ? st.fonts.displayWeight : 800,
      bodyWeight: st && bodyF === st.fonts.body ? st.fonts.bodyWeight : 400,
      dw: known(display)?.fonts.displayWidth ?? 0.75,
      dwU: known(display)?.fonts.displayUpper ?? 0.85,
      bw: knownBody(bodyF)?.fonts.bodyWidth ?? 0.62,
      bwU: (knownBody(bodyF)?.fonts.bodyWidth ?? 0.62) * 1.17,
    },
    motion: st
      ? { enter: st.motion.enter, exit: st.motion.exit, inDur: st.motion.inDur, outDur: st.motion.outDur, stagger: st.motion.stagger, text: st.motion.text }
      : { enter: "power3.out", exit: "power2.in", inDur: 0.5, outDur: 0.35, stagger: 0.06, text: { type: "rise", by: "word" } },
    has: (k) => !!spec.style?.palette?.[k],
    brand, title: spec.meta.title, id, scene, t0, track, overlayScene, style: st?.id,
  };
}

function firstFont(spec: MotionSpec, role: "display" | "body"): string | undefined {
  const texts = spec.layers.filter((l): l is TextLayer => l.type === "text" && !!l.style.fontFamily);
  if (!texts.length) return undefined;
  const sorted = [...texts].sort((a, b) => b.style.fontSize - a.style.fontSize);
  return (role === "display" ? sorted[0] : sorted[sorted.length - 1]).style.fontFamily;
}
