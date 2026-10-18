// toLottie(): Motion-Spec → Lottie JSON (bodymovin 5.x), for apps, websites and After Effects.
//
// How: every layer is sampled frame by frame with the same math as the preview (evaluate + fxAt), and the
// samples become linear Lottie keyframes (thinned out where the motion is a straight line). That way every
// ease and every enter/exit transition comes out exactly, without rebuilding them in Lottie terms.
// Frame transform = a null parent, transition = the content layer, wipes and iris = an animated mask.
//
// Lottie cannot do everything the browser does. What is missing comes back as warnings (code + layer ids),
// never silently: video, captions, glow/shadow/glass, blur, 3D tilt, camera moves, word-by-word text.

import { getEase } from "./ease.ts";
import { compositionDuration, layerTiming, sceneTimings, type LayerTiming } from "./timing.ts";
import { fxAt, type FxState } from "./transitions.ts";
import { propAt } from "./evaluate.ts";
import { isVisual, type Layer, type MotionSpec, type TextLayer, type TransitionType, type VisualLayer } from "./types.ts";

export type LottieWarningCode =
  | "video" | "captions" | "audio" | "look" | "blur" | "tilt" | "camera" | "textAnim" | "draw" | "radius" | "texture" | "fonts" | "imageMissing" | "gradientText" | "sizeKeys";

export interface LottieWarning { code: LottieWarningCode; layers: string[] }

/** Plain-language meaning of every warning (CLI, MCP, AI). The editor shows its own translations. */
export const LOTTIE_HINTS: Record<LottieWarningCode, string> = {
  video: "videos are not part of Lottie and were left out",
  captions: "subtitles were left out (export them as video, or burn them into an MP4)",
  audio: "Lottie has no sound; audio was left out",
  look: "shadow, glow, glass and blend modes are missing",
  blur: "blur is missing (blur transitions become fades)",
  tilt: "3D tilt (rotateX/rotateY) is missing",
  camera: "camera moves are missing; the layers stay where they are",
  textAnim: "word/letter animation plays as one movement of the whole text",
  draw: "self-drawing lines appear with a wipe instead",
  radius: "rounded corners on images are missing",
  texture: "grain, vignette and scanlines are missing",
  fonts: "text needs the fonts installed where the Lottie plays (Google Fonts are linked in the file)",
  imageMissing: "an image file was not found and was left out",
  gradientText: "gradient text is shown in the plain text color",
  sizeKeys: "size animation of text and images is missing (position, scale, rotation and opacity work)",
};

export interface LottieOptions {
  fps?: number;
  /** Layer ids to leave out (same as the transparent export). */
  hide?: string[];
  /** Image src → data URL (the caller reads the files; core stays browser-safe). Missing images are skipped with a warning. */
  images?: Record<string, string>;
  /** Font family (lowercase) → ascent/descent in em, read from the font files. Places text like the browser does. */
  fontMetrics?: Record<string, { ascent: number; descent: number }>;
}

export interface LottieResult { json: Record<string, unknown>; warnings: LottieWarning[] }

type Vec = number[];
type Prop = { a: 0; k: number | Vec } | { a: 1; k: Record<string, unknown>[] };

export function toLottie(spec: MotionSpec, opts: LottieOptions = {}): LottieResult {
  const fps = opts.fps ?? spec.canvas.fps ?? 30;
  const dur = compositionDuration(spec);
  const op = Math.max(1, Math.round(dur * fps));
  const palette = spec.style?.palette ?? {};
  const scenes = sceneTimings(spec);
  const warn = new Map<LottieWarningCode, Set<string>>();
  const w = (code: LottieWarningCode, id = "") => { if (!warn.has(code)) warn.set(code, new Set()); if (id) warn.get(code)!.add(id); };
  const assets: Record<string, unknown>[] = [];
  const fonts = new Map<string, Record<string, unknown>>();
  const out: Record<string, unknown>[] = [];
  let ind = 1;

  if (spec.camera && (spec.camera.keys && Object.keys(spec.camera.keys).length)) w("camera");
  if (spec.canvas.texture) w("texture");

  // Paint order: Lottie draws the first layer on top, so collect bottom-up and reverse at the end.
  const ordered = spec.layers
    .map((layer, index) => ({ layer, index }))
    .filter((e) => !e.layer.hidden && !opts.hide?.includes(e.layer.id))
    .sort((a, b) => a.layer.track - b.layer.track || a.index - b.index)
    .map((e) => e.layer);

  for (const layer of ordered) {
    if (!isVisual(layer)) { if (layer.type === "audio") w("audio", layer.id); continue; }
    if (layer.type === "video") { w("video", layer.id); continue; }
    if (layer.type === "captions") { w("captions", layer.id); continue; }
    const timing = layerTiming(spec, layer, scenes);
    const ip = Math.max(0, Math.round(timing.start * fps));
    const lop = Math.min(op, Math.max(ip + 1, Math.round(timing.end * fps)));
    if (layer.look && (layer.look.shadow || layer.look.glow || layer.look.glass || (layer.look.blend && layer.look.blend !== "normal"))) w("look", layer.id);
    if (layer.frame.blur || layer.keys?.blur?.length || layer.in?.type === "blur" || layer.out?.type === "blur" || layer.in?.type === "zoomIn") w("blur", layer.id);
    if (layer.frame.rotateX || layer.frame.rotateY || layer.keys?.rotateX?.length || layer.keys?.rotateY?.length) w("tilt", layer.id);
    if ((layer.keys?.w?.length || layer.keys?.h?.length) && layer.type !== "shape") w("sizeKeys", layer.id);

    // Text animation by word/letter has no Lottie equivalent here: it becomes one transition of the whole text.
    // Self-drawing SVG strokes become a wipe over the same time (Lottie would need every path rebuilt as a shape).
    const fxLayer: Layer = layer.type === "text" && layer.anim && !layer.in ? { ...layer, in: animAsTransition(layer) }
      : layer.type === "svg" && layer.draw && !layer.in ? { ...layer, in: drawAsTransition(layer.svg, layer.draw) } : layer;
    if (layer.type === "text" && layer.anim) w("textAnim", layer.id);

    const frames: number[] = [];
    for (let f = ip; f < lop; f++) frames.push(f);
    const at = (f: number) => Math.min(timing.end - 1e-6, f / fps);
    const st = frames.map((f) => {
      const t = at(f);
      return {
        x: propAt(layer, "x", timing, t), y: propAt(layer, "y", timing, t), w: propAt(layer, "w", timing, t), h: propAt(layer, "h", timing, t),
        r: propAt(layer, "rotation", timing, t), s: propAt(layer, "scale", timing, t), o: propAt(layer, "opacity", timing, t), fx: fxAt(fxLayer, timing, t),
      };
    });
    const W = layer.frame.w;
    const H = layer.frame.h;
    const parentInd = ind++;
    out.push({
      ddd: 0, ind: parentInd, ty: 3, nm: `${layer.name ?? layer.id} (frame)`, sr: 1, ao: 0, ip, op: lop, st: 0, bm: 0,
      ks: {
        o: { a: 0, k: 100 }, a: { a: 0, k: [0, 0, 0] },
        p: animated(frames, st.map((v) => [r2(v.x + v.w / 2), r2(v.y + v.h / 2), 0]), 0.05),
        r: animated(frames, st.map((v) => [r2(v.r)]), 0.01),
        s: animated(frames, st.map((v) => [r2(v.s * 100), r2(v.s * 100), 100]), 0.01),
      },
    });
    // Content layers live in frame-local coordinates (0,0 = top-left of the frame), so a growing frame grows to
    // the right and down like the browser box does.
    const sizes = st.map((v) => [r2(v.w), r2(v.h)]);
    const centers = st.map((v) => [r2(v.w / 2), r2(v.h / 2)]);
    const content = (extra: Record<string, unknown>) => {
      const base: Record<string, unknown> = {
        ddd: 0, ind: ind++, parent: parentInd, nm: layer.name ?? layer.id, sr: 1, ao: 0, ip, op: lop, st: 0, bm: 0,
        ks: {
          o: animated(frames, st.map((v) => [r2(clamp(v.o * v.fx.opacity, 0, 1) * 100)]), 0.05),
          a: animated(frames, st.map((v) => [r2(v.w / 2), r2(v.h / 2), 0]), 0.05),
          p: animated(frames, st.map((v) => [r2(v.fx.tx), r2(v.fx.ty), 0]), 0.05),
          r: { a: 0, k: 0 },
          s: animated(frames, st.map((v) => [r2(v.fx.scale * 100), r2(v.fx.scale * 100), 100]), 0.01),
        },
        ...extra,
      };
      const mask = maskFor(frames, st.map((v) => ({ fx: v.fx, w: v.w, h: v.h })));
      if (mask) { base.hasMask = true; base.masksProperties = [mask]; }
      return base;
    };

    if (layer.type === "shape") {
      const geo = layer.shape === "ellipse"
        ? { ty: "el", d: 1, s: animated(frames, sizes, 0.05), p: animated(frames, centers, 0.05), nm: "ellipse" }
        : { ty: "rc", d: 1, s: animated(frames, sizes, 0.05), p: animated(frames, centers, 0.05), r: { a: 0, k: layer.radius ?? 0 }, nm: "rect" };
      const items: Record<string, unknown>[] = [geo];
      const fill = paint(layer.fill, palette, W, H);
      if (fill) items.push(fill);
      if (layer.stroke && layer.strokeWidth) {
        const c = parseColor(layer.stroke, palette);
        if (c) items.push({ ty: "st", c: { a: 0, k: [c[0], c[1], c[2], 1] }, o: { a: 0, k: r2(c[3] * 100) }, w: { a: 0, k: layer.strokeWidth }, lc: 2, lj: 2, nm: "stroke" });
      }
      items.push(groupTransform());
      out.push(content({ ty: 4, shapes: [{ ty: "gr", it: items, nm: "shape" }] }));
    } else if (layer.type === "image" || layer.type === "svg") {
      let url: string | undefined;
      if (layer.type === "image") url = opts.images?.[layer.src];
      else {
        if (layer.draw) w("draw", layer.id);
        const vb = layer.viewBox ?? `0 0 ${W} ${H}`;
        const markup = layer.svg.replace(/\$([a-z][a-z0-9-]*)/g, (m, n: string) => palette[n] ?? m);
        const svg = /^\s*<svg[\s>]/i.test(markup) ? markup : `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="${vb}" preserveAspectRatio="${layer.preserveAspectRatio ?? "xMidYMid meet"}">${markup}</svg>`;
        url = `data:image/svg+xml;base64,${b64(svg)}`;
      }
      if (!url) { w("imageMissing", layer.id); continue; }
      if (layer.type === "image" && layer.radius) w("radius", layer.id);
      const id = `img_${assets.length}`;
      assets.push({ id, w: W, h: H, u: "", p: url, e: 1 });
      out.push(content({ ty: 2, refId: id }));
    } else if (layer.type === "text") {
      const s = layer.style;
      if (s.gradient) w("gradientText", layer.id);
      if (s.background) {
        const bg = paint(s.background, palette, W, H);
        if (bg) out.push(content({ ty: 4, nm: `${layer.name ?? layer.id} (box)`, shapes: [{ ty: "gr", it: [{ ty: "rc", d: 1, s: animated(frames, sizes, 0.05), p: animated(frames, centers, 0.05), r: { a: 0, k: s.radius ?? 0 } }, bg, groupTransform()] }] }));
      }
      const family = s.fontFamily ?? "Inter";
      const weight = s.fontWeight ?? 400;
      const fName = `${family.replace(/\s+/g, "")}-${weightName(weight)}${s.italic ? "Italic" : ""}`;
      if (!fonts.has(fName)) {
        fonts.set(fName, { fName, fFamily: family, fStyle: `${weightName(weight)}${s.italic ? " Italic" : ""}`, fWeight: String(weight), ascent: r2((opts.fontMetrics?.[family.toLowerCase()]?.ascent ?? 0.75) * 100), fOrigin: "g", fPath: `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, "+")}:${s.italic ? "ital," : ""}wght@${s.italic ? "1," : ""}${weight}&display=block` });
        w("fonts");
      }
      out.push(content({ ty: 5, t: textData(layer, fName, palette, frames, timing, fps, spec.meta.lang ?? "de", opts.fontMetrics?.[family.toLowerCase()]) }));
    }
  }

  const json: Record<string, unknown> = {
    v: "5.7.4", fr: fps, ip: 0, op, w: spec.canvas.width, h: spec.canvas.height, nm: spec.meta.title, ddd: 0,
    assets, layers: out.reverse(), markers: [], meta: { g: "Open Motion" },
  };
  if (fonts.size) json.fonts = { list: [...fonts.values()] };
  return { json, warnings: [...warn.entries()].map(([code, ids]) => ({ code, layers: [...ids] })) };
}

function drawAsTransition(svg: string, d: { duration?: number; stagger?: number; ease?: string }): { type: TransitionType; duration: number; ease: string } {
  const n = (svg.match(/<(path|line|polyline|polygon|circle|ellipse|rect)\b/gi) ?? []).length;
  return { type: "wipe", duration: (d.duration ?? 1.2) + (d.stagger ?? 0.08) * Math.max(0, n - 1), ease: d.ease ?? "power2.inOut" };
}

/** Word-by-word text animation → one transition of the whole text (closest Lottie-friendly look). */
function animAsTransition(layer: TextLayer): { type: TransitionType; duration: number; ease?: string } {
  const a = layer.anim!;
  const map: Record<string, TransitionType> = { rise: "slideUp", fade: "fade", blur: "fade", pop: "pop", mask: "maskUp", drop: "slideDown", slide: "slideRight", type: "wipe" };
  const pieces = a.by === "char" ? layer.text.length : a.by === "line" ? layer.text.split("\n").length : layer.text.split(/\s+/).length;
  return { type: map[a.type] ?? "fade", duration: (a.duration ?? 0.6) + (a.stagger ?? 0.05) * Math.max(0, Math.min(pieces, 12) - 1), ease: a.ease };
}

function textData(layer: TextLayer, fName: string, palette: Record<string, string>, frames: number[], timing: LayerTiming, fps: number, lang: string, metrics?: { ascent: number; descent: number }) {
  const s = layer.style;
  const raw = s.uppercase ? layer.text.toUpperCase() : layer.text;
  const plain = raw.replace(/\[\[|\]\]/g, "");
  const fc = parseColor(s.color ?? "#ffffff", palette) ?? [1, 1, 1, 1];
  const lh = r2(s.fontSize * (s.lineHeight ?? 1.2));
  const lines = plain.split("\n").length;
  const pad = s.padding ?? 0;
  const inner = layer.frame.h - 2 * pad;
  const valignOffset = s.valign === "bottom" ? inner - lines * lh : s.valign === "middle" || s.valign === "center" ? (inner - lines * lh) / 2 : 0;
  // CSS centers the glyphs in each line box (half-leading); Lottie starts the first line at the box top.
  const m = metrics ?? { ascent: 0.75, descent: 0.25 };
  const halfLeading = (lh - (m.ascent + m.descent) * s.fontSize) / 2;
  const doc = (text: string) => ({
    s: s.fontSize, f: fName, t: text.replace(/\n/g, "\r"), j: s.align === "right" ? 1 : s.align === "center" ? 2 : 0,
    tr: r2(((s.letterSpacing ?? 0) / s.fontSize) * 1000), lh, ls: 0, fc: [fc[0], fc[1], fc[2]],
    sz: [layer.frame.w - 2 * pad, layer.frame.h - 2 * pad], ps: [pad, r2(pad + Math.max(0, valignOffset) + halfLeading)],
  });
  let k: Record<string, unknown>[];
  if (layer.count) {
    // Counter: one text keyframe per change (hold keyframes, exact like the preview).
    const c = layer.count;
    // Same curve and rounding as the preview (CSS integer counter, expo.out over 1.6 s by default).
    const ease = getEase(c.ease ?? "expo.out");
    const d = c.duration ?? 1.6;
    const dec = c.decimals ?? 0;
    const point = c.point ?? (lang.startsWith("de") ? "," : ".");
    const fmt = (v: number) => {
      const n = (Math.round(v * 10 ** dec) / 10 ** dec).toFixed(dec);
      return `${c.prefix ?? ""}${n.replace(".", point)}${c.suffix ?? ""}`;
    };
    k = [];
    let last = "";
    for (const f of frames) {
      const t = (f / fps - timing.start) * timing.speed - (c.delay ?? 0);
      const v = c.from + (c.to - c.from) * ease(clamp(t / d, 0, 1));
      const txt = fmt(v);
      if (txt !== last) { k.push({ s: doc(txt), t: f }); last = txt; }
    }
  } else k = [{ s: doc(plain), t: 0 }];

  // [[highlight]]: a range selector colors those characters (index based).
  const animators: Record<string, unknown>[] = [];
  const hlColor = parseColor(s.highlight ?? (s.marker ? s.color ?? "#ffffff" : palette.accent ? palette.accent : s.color ?? "#ffffff"), palette);
  if (!layer.count && hlColor && raw.includes("[[")) {
    let idx = 0;
    raw.split(/\[\[|\]\]/).forEach((part, i) => {
      const len = [...part.replace(/\n/g, "")].length;
      if (i % 2 === 1 && len) {
        animators.push({
          nm: "highlight",
          s: { t: 0, xe: { a: 0, k: 0 }, ne: { a: 0, k: 0 }, a: { a: 0, k: 100 }, b: 1, rn: 0, sh: 1, r: 2, s: { a: 0, k: idx }, e: { a: 0, k: idx + len } },
          a: { fc: { a: 0, k: [hlColor[0], hlColor[1], hlColor[2], 1] } },
        });
      }
      idx += len;
    });
  }
  return { d: { k }, p: {}, m: { g: 1, a: { a: 0, k: [0, 0] } }, a: animators };
}

/** Animated mask for wipes and the iris, in the content's local coordinates. */
function maskFor(frames: number[], st: { fx: FxState; w: number; h: number }[]) {
  const clipped = st.some((v) => v.fx.clipTop || v.fx.clipRight || v.fx.clipBottom || v.fx.clipLeft || v.fx.iris < 100);
  if (!clipped) return null;
  const iris = st.some((v) => v.fx.iris < 100);
  const shapes = st.map(({ fx, w, h }) => {
    if (iris) {
      const r = (fx.iris / 100) * (Math.hypot(w, h) / Math.SQRT2);
      return ellipsePath(w / 2, h / 2, Math.max(r, 0.01), Math.max(r, 0.01));
    }
    // The edge travels from outside the box (bleed) to the far side, so umlauts, descenders and glow that
    // reach past the frame are never cut while the reveal ends (the preview has no mask at rest either).
    const bx = w * 0.3;
    const by = h * 0.3;
    const l = -bx + (fx.clipLeft / 100) * (w + bx);
    const t = -by + (fx.clipTop / 100) * (h + by);
    const r = w + bx - (fx.clipRight / 100) * (w + bx);
    const b = h + by - (fx.clipBottom / 100) * (h + by);
    return { i: [[0, 0], [0, 0], [0, 0], [0, 0]], o: [[0, 0], [0, 0], [0, 0], [0, 0]], v: [[r2(l), r2(t)], [r2(r), r2(t)], [r2(r), r2(b)], [r2(l), r2(b)]], c: true };
  });
  const k: Record<string, unknown>[] = [];
  let prev = "";
  shapes.forEach((sh, i) => {
    const key = JSON.stringify(sh);
    if (key === prev && i !== shapes.length - 1) return;
    k.push({ t: frames[i], s: [sh], i: { x: 1, y: 1 }, o: { x: 0, y: 0 } });
    prev = key;
  });
  return { inv: false, mode: "a", nm: "reveal", o: { a: 0, k: 100 }, x: { a: 0, k: 0 }, pt: k.length > 1 ? { a: 1, k } : { a: 0, k: shapes[0] } };
}

function ellipsePath(cx: number, cy: number, rx: number, ry: number) {
  const K = 0.5523;
  return {
    c: true,
    v: [[cx, cy - ry], [cx + rx, cy], [cx, cy + ry], [cx - rx, cy]].map((p) => p.map(r2)),
    i: [[-rx * K, 0], [0, -ry * K], [rx * K, 0], [0, ry * K]].map((p) => p.map(r2)),
    o: [[rx * K, 0], [0, ry * K], [-rx * K, 0], [0, -ry * K]].map((p) => p.map(r2)),
  };
}

/**
 * Samples → Lottie property. Constant values become static; otherwise linear keyframes, dropping every sample
 * that lies on the straight line between its neighbours (within tol), so a 5 s slide is a handful of keys.
 */
export function animated(frames: number[], values: Vec[], tol: number): Prop {
  const same = values.every((v) => v.every((x, i) => Math.abs(x - values[0][i]) <= 1e-9));
  const single = (v: Vec) => (v.length === 1 ? v[0] : v);
  if (same || values.length < 2) return { a: 0, k: single(values[0] ?? [0]) };
  const keep = [0];
  let a = 0;
  for (let b = 2; b < values.length; b++) {
    let ok = true;
    for (let m = a + 1; m < b && ok; m++) {
      const p = (frames[m] - frames[a]) / (frames[b] - frames[a]);
      ok = values[m].every((x, i) => Math.abs(values[a][i] + (values[b][i] - values[a][i]) * p - x) <= tol);
    }
    if (!ok) { keep.push(b - 1); a = b - 1; }
  }
  keep.push(values.length - 1);
  const lin = { i: { x: [1], y: [1] }, o: { x: [0], y: [0] } };
  return { a: 1, k: keep.map((idx, n) => (n < keep.length - 1 ? { t: frames[idx], s: values[idx], ...lin } : { t: frames[idx], s: values[idx] })) };
}

function groupTransform() {
  return { ty: "tr", p: { a: 0, k: [0, 0] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 }, sk: { a: 0, k: 0 }, sa: { a: 0, k: 0 }, nm: "transform" };
}

/** Solid color or CSS linear/radial gradient → Lottie fill (gradient fills keep their stops and alpha). */
function paint(value: string | undefined, palette: Record<string, string>, W: number, H: number): Record<string, unknown> | null {
  if (!value || value === "none" || value === "transparent") return null;
  const g = /^(linear|radial)-gradient\((.*)\)$/i.exec(value.trim());
  if (!g) {
    const c = parseColor(value, palette);
    return c ? { ty: "fl", c: { a: 0, k: [c[0], c[1], c[2], 1] }, o: { a: 0, k: r2(c[3] * 100) }, r: 1, nm: "fill" } : null;
  }
  const parts = splitTop(g[2]);
  let angle = 180;
  if (g[1].toLowerCase() === "linear" && /deg$|^to /.test(parts[0]?.trim() ?? "")) {
    const p = parts.shift()!.trim();
    const dirs: Record<string, number> = { "to top": 0, "to right": 90, "to bottom": 180, "to left": 270, "to top right": 45, "to right top": 45, "to bottom right": 135, "to right bottom": 135, "to bottom left": 225, "to left bottom": 225, "to top left": 315, "to left top": 315 };
    angle = p.endsWith("deg") ? parseFloat(p) : dirs[p] ?? 180;
  } else if (g[1].toLowerCase() === "radial" && parts[0] && !parseColor(parts[0].trim().split(/\s+/)[0], palette)) parts.shift();
  const stops = parts.map((p) => {
    const m = /^(.*?)(?:\s+(-?[\d.]+)%)?$/.exec(p.trim())!;
    return { c: parseColor(m[1].trim(), palette), pos: m[2] !== undefined ? Number(m[2]) / 100 : undefined };
  }).filter((x) => x.c) as { c: number[]; pos?: number }[];
  if (!stops.length) return null;
  stops.forEach((s, i) => { if (s.pos === undefined) s.pos = stops.length === 1 ? 0 : i / (stops.length - 1); });
  // "transparent" fades in CSS without darkening (premultiplied): give fully transparent stops the color of their neighbour.
  stops.forEach((s, i) => {
    if (s.c[3] > 0) return;
    const near = stops.slice(i + 1).find((x) => x.c[3] > 0) ?? [...stops.slice(0, i)].reverse().find((x) => x.c[3] > 0);
    if (near) s.c = [near.c[0], near.c[1], near.c[2], 0];
  });
  const colors = stops.flatMap((s) => [r4(s.pos!), r4(s.c[0]), r4(s.c[1]), r4(s.c[2])]);
  const alphas = stops.flatMap((s) => [r4(s.pos!), r4(s.c[3])]);
  let sPt: number[], ePt: number[];
  if (g[1].toLowerCase() === "radial") {
    sPt = [W / 2, H / 2];
    ePt = [W / 2 + Math.hypot(W / 2, H / 2), H / 2];
  } else {
    // CSS gradient line: through the center, long enough that the corners hit 0 % and 100 %.
    const rad = (angle * Math.PI) / 180;
    const dx = Math.sin(rad);
    const dy = -Math.cos(rad);
    const half = (Math.abs(W * dx) + Math.abs(H * dy)) / 2;
    sPt = [W / 2 - dx * half, H / 2 - dy * half];
    ePt = [W / 2 + dx * half, H / 2 + dy * half];
  }
  return {
    ty: "gf", t: g[1].toLowerCase() === "radial" ? 2 : 1, o: { a: 0, k: 100 }, r: 1, nm: "gradient",
    s: { a: 0, k: sPt.map(r2) }, e: { a: 0, k: ePt.map(r2) }, h: { a: 0, k: 0 }, a: { a: 0, k: 0 },
    g: { p: stops.length, k: { a: 0, k: [...colors, ...alphas] } },
  };
}

function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { out.push(cur); cur = ""; } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

const NAMED: Record<string, string> = { white: "#ffffff", black: "#000000", red: "#ff0000", green: "#008000", blue: "#0000ff", yellow: "#ffff00", orange: "#ffa500", gray: "#808080", grey: "#808080" };

/** CSS color (hex, rgb(a), a few names, $palette) → [r, g, b, a] in 0…1. Null if not understood. */
export function parseColor(value: string, palette: Record<string, string> = {}): number[] | null {
  let v = value.trim();
  const pal = /^\$([a-z][a-z0-9-]*)$/.exec(v);
  if (pal) v = palette[pal[1]] ?? "";
  v = NAMED[v.toLowerCase()] ?? v;
  if (v.toLowerCase() === "transparent") return [0, 0, 0, 0];
  let m = /^#([0-9a-f]{3,8})$/i.exec(v);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join("");
    if (h.length !== 6 && h.length !== 8) return null;
    const n = (i: number) => parseInt(h.slice(i, i + 2), 16) / 255;
    return [r4(n(0)), r4(n(2)), r4(n(4)), h.length === 8 ? r4(n(6)) : 1];
  }
  m = /^rgba?\(([^)]+)\)$/i.exec(v);
  if (m) {
    const tok = m[1].split(/[\s,/]+/).filter(Boolean);
    const ch = tok.slice(0, 3).map((x) => (x.endsWith("%") ? (parseFloat(x) / 100) * 255 : parseFloat(x)));
    const alpha = tok[3] === undefined ? 1 : tok[3].endsWith("%") ? parseFloat(tok[3]) / 100 : parseFloat(tok[3]);
    if (ch.length < 3 || [...ch, alpha].some((x) => Number.isNaN(x))) return null;
    return [r4(ch[0] / 255), r4(ch[1] / 255), r4(ch[2] / 255), r4(alpha)];
  }
  return null;
}

function weightName(w: number): string {
  return ({ 100: "Thin", 200: "ExtraLight", 300: "Light", 400: "Regular", 500: "Medium", 600: "SemiBold", 700: "Bold", 800: "ExtraBold", 900: "Black" } as Record<number, string>)[Math.round(w / 100) * 100] ?? "Regular";
}

function b64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const r2 = (v: number) => Math.round(v * 100) / 100;
const r4 = (v: number) => Math.round(v * 10000) / 10000;
