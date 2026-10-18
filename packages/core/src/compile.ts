// compile(spec) → one self-contained HTML composition for HyperFrames.
//
// Every visual layer becomes three nested boxes:
//
//   div#om-<id>        frame box   position, size, rotation, scale, opacity (+ keyframes)
//     div#om-fx-<id>   fx box      enter/exit transition (slide, pop, wipe …)
//       <content>      the clip    text | shape | svg | img | video  (class="clip", data-start …)
//
// Animation runs on the browser's own Web Animations API (no GSAP — its license
// forbids visual animation builders). HyperFrames seeks these animations frame by
// frame, so preview and MP4 are identical.

import { cssEasing, DEFAULT_EASE } from "./ease.ts";
import { SpecError, validateSpec } from "./schema.ts";
import { compositionDuration, layerTiming, sceneTimings, sourceToComp, toAbs, type LayerTiming } from "./timing.ts";
import { NEUTRAL_FX, transitionWindows, type FxKey, type FxState } from "./transitions.ts";
import { isCutLayer, isWordCut, keptSegments } from "./cuts.ts";
import { isVisual, type AnimProp, type Keyframe, type Layer, type MotionSpec, type TextStyle, type VisualLayer } from "./types.ts";
import { interpolate } from "./evaluate.ts";

export interface CompileOptions {
  /** Output scale. 0.5 turns a 1920×1080 canvas into a 960×540 composition. Default 1. */
  scale?: number;
  /** Layer id → pre-cut audio file (relative path). Used at export for click-free cuts. */
  audioOverrides?: Record<string, string>;
  /** Transparent background (WebM/MOV with alpha): no canvas color, no texture. */
  transparent?: boolean;
  /** Layer ids left out of this compile (e.g. background areas for a transparent export). */
  hide?: string[];
}

export interface CompileResult {
  html: string;
  width: number;
  height: number;
  duration: number;
  /** Relative asset paths the composition references (copy them next to index.html). */
  assets: string[];
  warnings: string[];
  /** Animation table, also used by the editor to rebuild animations without reloading. */
  anims: AnimDef[];
}

/** [elementId, keyframes, delayMs, durationMs] */
export type AnimDef = [string, Record<string, string | number>[], number, number];

/** Frame props with their own CSS property. rotateX/rotateY share `transform` and are merged separately. */
const CSS_PROP: Partial<Record<AnimProp, string>> = {
  x: "left",
  y: "top",
  w: "width",
  h: "height",
  rotation: "rotate",
  scale: "scale",
  opacity: "opacity",
  blur: "filter",
};

const PERSPECTIVE = 1400;
/** Samples per second when two keyed props must share one CSS property (3D tilt, camera pan). */
const MERGE_FPS = 30;

export function compile(spec: MotionSpec, options: CompileOptions = {}): CompileResult {
  const check = validateSpec(spec);
  if (!check.ok) throw new SpecError(check.errors);
  const s = options.scale ?? 1;
  const width = even(spec.canvas.width * s);
  const height = even(spec.canvas.height * s);
  const duration = r3(compositionDuration(spec));
  const palette = spec.style?.palette ?? {};
  const scenes = sceneTimings(spec);
  const assets = new Set<string>();
  const anims: AnimDef[] = [];
  const visualHtml: string[] = [];
  const fixedHtml: string[] = [];
  const audioHtml: string[] = [];

  const ordered = spec.layers
    .map((layer, index) => ({ layer, index }))
    .filter((e) => !e.layer.hidden && !options.hide?.includes(e.layer.id))
    .sort((a, b) => a.layer.track - b.layer.track || a.index - b.index);

  ordered.forEach(({ layer }, paintIndex) => {
    const timing = layerTiming(spec, layer, scenes);
    const clipAttrs = [
      `data-om-id="${esc(layer.id)}"`,
      `data-start="${r3(timing.start)}"`,
      `data-duration="${r3(timing.end - timing.start)}"`,
      `data-track-index="${paintIndex}"`,
    ].join(" ");

    if (!isVisual(layer)) {
      const vol = ` data-volume="${layer.volume ?? 1}" preload="auto"`;
      const override = options.audioOverrides?.[layer.id];
      if (override) {
        audioHtml.push(`<audio id="om-c-${esc(layer.id)}" class="clip" src="${esc(override)}" ${clipAttrs}${vol}></audio>`);
      } else if (isCutLayer(spec, layer)) {
        trackAsset(assets, layer.src);
        keptSegments(spec, layer).forEach((sg, k) => {
          const attrs = segAttrs(layer.id, timing.start + sg.rel0, sg.src1 - sg.src0, paintIndex, sg.src0);
          audioHtml.push(`<audio id="om-c-${esc(layer.id)}${k ? `-s${k}` : ""}" class="clip" src="${esc(layer.src)}" ${attrs}${vol}></audio>`);
        });
      } else {
        trackAsset(assets, layer.src);
        const media = layer.mediaStart ? ` data-media-start="${r3(layer.mediaStart)}"` : "";
        audioHtml.push(`<audio id="om-c-${esc(layer.id)}" class="clip" src="${esc(layer.src)}" ${clipAttrs}${media}${vol}></audio>`);
      }
      return;
    }

    // Frame box: static base values, keyframed values become animations.
    const f = layer.frame;
    const frameStyle = [
      `left:${px(f.x * s)}`,
      `top:${px(f.y * s)}`,
      `width:${px(f.w * s)}`,
      `height:${px(f.h * s)}`,
      `z-index:${layer.track}`,
      f.rotation ? `rotate:${f.rotation}deg` : "",
      f.scale !== undefined && f.scale !== 1 ? `scale:${f.scale}` : "",
      f.opacity !== undefined && f.opacity !== 1 ? `opacity:${f.opacity}` : "",
      f.blur ? `filter:blur(${r2(f.blur * s)}px)` : "",
      layer.look?.blend && layer.look.blend !== "normal" ? `mix-blend-mode:${layer.look.blend}` : "",
    ].filter(Boolean);

    // 3D tilt: rotateX and rotateY share `transform`, so they become one (merged) animation.
    const kx = layer.keys?.rotateX;
    const ky = layer.keys?.rotateY;
    const tiltSpan = keySpan([kx, ky], (k) => toAbs(timing, k.t));
    const rxAt = (t: number) => (kx?.length ? interpolate(kx, timing, t) : (f.rotateX ?? 0));
    const ryAt = (t: number) => (ky?.length ? interpolate(ky, timing, t) : (f.rotateY ?? 0));
    if (tiltSpan) anims.push(mergedAnim(`om-${layer.id}`, tiltSpan[0], tiltSpan[1], "transform", (t) => tilt(rxAt(t), ryAt(t))));
    else if (kx?.length || ky?.length || f.rotateX || f.rotateY) frameStyle.push(`transform:${tilt(rxAt(timing.start), ryAt(timing.start))}`);

    for (const [prop, list] of Object.entries(layer.keys ?? {}) as [AnimProp, Keyframe[] | undefined][]) {
      if (!list || list.length === 0) continue;
      const css = CSS_PROP[prop];
      if (!css) continue;
      const value = (v: number) => cssValue(prop, v, s);
      if (list.length === 1) {
        frameStyle.push(`${css}:${value(list[0].v)}`);
        continue;
      }
      const t0 = toAbs(timing, list[0].t);
      const t1 = toAbs(timing, list[list.length - 1].t);
      const span = Math.max(t1 - t0, 1e-6);
      const frames = list.map((k, i) => {
        const kf: Record<string, string | number> = { offset: r4((toAbs(timing, k.t) - t0) / span), [camel(css)]: value(k.v) };
        if (i < list.length - 1) kf.easing = cssEasing(list[i + 1].ease ?? DEFAULT_EASE);
        return kf;
      });
      anims.push([`om-${layer.id}`, frames, ms(t0), ms(span)]);
    }

    // Fx box: enter/exit transitions.
    anims.push(...fxAnimations(layer, timing, s));

    const ctx: ContentCtx = { s, palette, assets, anims, timing, lang: spec.meta.lang ?? "de", spec };
    (spec.camera && layer.fixed ? fixedHtml : visualHtml).push(
      `<div id="om-${esc(layer.id)}" class="om-l" data-om-layer="${esc(layer.id)}" data-om-type="${layer.type}" style="${esc(frameStyle.join(";"))}">` +
        `<div id="om-fx-${esc(layer.id)}" class="om-fx">${
          layer.type === "video" && isCutLayer(spec, layer)
            ? keptSegments(spec, layer).map((sg, k) => content({ ...layer, mediaStart: sg.src0 }, segAttrs(layer.id, timing.start + sg.rel0, sg.src1 - sg.src0, paintIndex), ctx, k ? `-s${k}` : "")).join("")
            : content(layer, clipAttrs, ctx)
        }</div></div>`,
    );
  });

  // Camera: everything except fixed layers sits in one box that zooms, pans and turns.
  // Maps content point (W/2 + x, H/2 + y) to the screen center, scaled by zoom.
  let camOpen = "";
  if (spec.camera) {
    const ck = spec.camera.keys;
    const W = spec.canvas.width, H = spec.canvas.height;
    const at = (list: Keyframe[] | undefined, t: number, def: number) => (list?.length ? interpolateAbs(list, t) : def);
    const camStyle = [`transform-origin:0 0`, `translate:${px((W / 2) * s)} ${px((H / 2) * s)}`];
    const pan = (t: number) => `translate(${r2(-(W / 2 + at(ck.x, t, 0)) * s)}px, ${r2(-(H / 2 + at(ck.y, t, 0)) * s)}px)`;
    const panSpan = keySpan([ck.x, ck.y], (k) => k.t);
    if (panSpan) anims.push(mergedAnim("om-cam", panSpan[0], panSpan[1], "transform", pan));
    camStyle.push(`transform:${pan(0)}`);
    for (const [prop, css] of [["zoom", "scale"], ["rotation", "rotate"]] as const) {
      const list = ck[prop];
      if (!list?.length) continue;
      const v = (x: number) => (prop === "zoom" ? r4(x) : `${r3(x)}deg`);
      if (list.length === 1) { camStyle.push(`${css}:${v(list[0].v)}`); continue; }
      const t0 = list[0].t, span = Math.max(list[list.length - 1].t - t0, 1e-6);
      anims.push(["om-cam", list.map((k, i) => {
        const kf: Record<string, string | number> = { offset: r4((k.t - t0) / span), [css]: v(k.v) };
        if (i < list.length - 1) kf.easing = cssEasing(list[i + 1].ease ?? DEFAULT_EASE);
        return kf;
      }), ms(t0), ms(span)]);
    }
    camOpen = `<div id="om-cam" style="${esc(camStyle.join(";"))}">`;
  }

  const texture = options.transparent ? "" : textureHtml(spec, width, height, duration, s, anims);

  const fontFaces = (spec.style?.fonts ?? [])
    .map((font) => {
      trackAsset(assets, font.src);
      return `@font-face{font-family:${cssString(font.family)};src:url(${cssString(font.src)});font-weight:${font.weight ?? "100 900"};font-style:${font.style ?? "normal"};font-display:block}`;
    })
    .join("\n");

  const vars = Object.entries(palette)
    .map(([k, v]) => `--om-${k}:${v};`)
    .join("");
  const background = options.transparent ? "transparent" : color(spec.canvas.background ?? "#000000", palette);
  const data = JSON.stringify(anims).replace(/</g, "\\u003c");

  const html = `<!doctype html>
<html lang="${esc(spec.meta.lang ?? "de")}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=${width}, height=${height}">
<meta name="generator" content="OpenMotion">
<title>${esc(spec.meta.title)}</title>
<style>
${fontFaces}
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:${options.transparent ? "transparent" : "#000"}}
#root{position:relative;width:${width}px;height:${height}px;overflow:hidden;background:${background};${vars}}
.om-l{position:absolute}
.om-fx{position:absolute;inset:0}
.om-c{position:absolute;inset:0;width:100%;height:100%;display:block}
.om-text{display:flex;flex-direction:column;white-space:pre-wrap;overflow-wrap:break-word}
.om-text>.om-t{display:block}
.om-p{display:inline-block;white-space:pre}
.om-m{display:inline-block;overflow:hidden;vertical-align:top;padding:.18em .04em .12em;margin:-.18em -.04em -.12em}
.om-hl{display:inline}
.om-count{font-variant-numeric:tabular-nums}
.om-cap{position:absolute;inset:0;display:flex;flex-wrap:wrap;gap:0 .22em;white-space:normal}
#om-cam{position:absolute;left:0;top:0;width:100%;height:100%}
.om-tex{position:absolute;inset:0;pointer-events:none;z-index:100000}
</style>
</head>
<body>
<div id="root" data-composition-id="main" data-no-timeline data-start="0" data-duration="${duration}" data-width="${width}" data-height="${height}">
${camOpen}${visualHtml.join("\n")}${camOpen ? "</div>" : ""}
${fixedHtml.join("\n")}
${texture}
${audioHtml.join("\n")}
</div>
<script>
${runtimeSource(data, duration)}
</script>
</body>
</html>
`;
  return { html, width, height, duration, assets: [...assets], warnings: check.warnings, anims };
}

/**
 * The tiny in-page runtime.
 * HyperFrames seeks the Web Animations itself and ignores the rest.
 * The editor uses window.__om: seek / play / pause / time / rebuild (hot update without reload).
 */
function runtimeSource(data: string, duration: number): string {
  return `(function(){
  var D=${duration},list=[],playing=false,cur=0,wall=0,raf=0;
  function build(defs){for(var i=0;i<list.length;i++)list[i].cancel();list=[];
    for(var j=0;j<defs.length;j++){var a=defs[j],el=document.getElementById(a[0]);if(!el)continue;
      list.push(el.animate(a[1],{duration:Math.max(a[3],1),delay:a[2],fill:"both"}));}
    if(window.__om)window.__om.animations=list;}
  function clips(){return document.querySelectorAll(".clip[data-start]");}
  function apply(t,run){var c=clips();for(var i=0;i<c.length;i++){var e=c[i],s=+e.dataset.start||0,d=+e.dataset.duration||0,on=t>=s&&t<s+d;
      e.style.visibility=on?"":"hidden";
      if(e.tagName==="VIDEO"||e.tagName==="AUDIO"){var want=(+(e.dataset.mediaStart||0))+(t-s);
        if(!on){if(!e.paused)e.pause();continue;}
        if(run){if(e.paused){try{e.currentTime=want}catch(_){}var p=e.play();if(p&&p.catch)p.catch(function(){});}}
        else{if(!e.paused)e.pause();if(Math.abs(e.currentTime-want)>0.04){try{e.currentTime=want}catch(_){}}}}}}
  function stop(){if(playing){cur=now();playing=false;cancelAnimationFrame(raf);}}
  function now(){return playing?Math.min(D,cur+(performance.now()-wall)/1000):cur;}
  function tick(){var t=now();if(t>=D){api.seek(D);return;}apply(t,true);raf=requestAnimationFrame(tick);}
  var api={version:2,duration:D,animations:list,
    seek:function(t){stop();cur=Math.max(0,Math.min(D,t));for(var i=0;i<list.length;i++){list[i].pause();list[i].currentTime=cur*1000;}apply(cur,false);},
    play:function(from){stop();if(typeof from==="number")cur=from;if(cur>=D)cur=0;
      for(var i=0;i<list.length;i++){list[i].currentTime=cur*1000;list[i].play();}
      wall=performance.now();playing=true;apply(cur,true);raf=requestAnimationFrame(tick);},
    pause:function(){var t=now();api.seek(t);return t;},
    time:now,isPlaying:function(){return playing;},
    rebuild:function(defs,dur){if(typeof dur==="number")api.duration=D=dur;var was=playing,t=now();build(defs);if(was)api.play(t);else api.seek(t);}};
  window.__om=api;build(${data});
})();`;
}

function fxAnimations(layer: Layer, timing: LayerTiming, s: number): AnimDef[] {
  const { tin, tout, inDur, outDur } = transitionWindows(layer, timing);
  if (!tin && !tout) return [];
  const keysUsed = new Set<FxKey>([...(Object.keys(tin?.away ?? {}) as FxKey[]), ...(Object.keys(tout?.away ?? {}) as FxKey[])]);
  const groups: { css: string; members: FxKey[] }[] = [
    { css: "translate", members: ["tx", "ty"] },
    { css: "scale", members: ["scale"] },
    { css: "opacity", members: ["opacity"] },
    { css: "clipPath", members: ["clipTop", "clipRight", "clipBottom", "clipLeft", "iris"] },
    { css: "filter", members: ["blur"] },
  ];
  const out: AnimDef[] = [];
  const start = timing.start;
  const life = Math.max(timing.end - timing.start, 1e-6);
  for (const g of groups) {
    if (!g.members.some((m) => keysUsed.has(m))) continue;
    // A layer can mix an iris (circle) and a wipe (inset); the switch happens while fully open, so it is invisible.
    const irisIn = !!tin && "iris" in tin.away;
    const irisOut = !!tout && "iris" in tout.away;
    let phase: "in" | "out" = "in";
    const render = (st: FxState) => fxCss(g.css, st, s, phase === "in" ? irisIn : irisOut);
    const pts: { t: number; v: string; easing?: string }[] = [];
    const inUses = tin && g.members.some((m) => m in tin.away);
    const outUses = tout && g.members.some((m) => m in tout.away);
    if (inUses) {
      pts.push({ t: start, v: render({ ...NEUTRAL_FX, ...tin!.away }), easing: cssEasing(tin!.ease) });
      pts.push({ t: start + inDur, v: render(NEUTRAL_FX) });
    } else {
      pts.push({ t: start, v: render(NEUTRAL_FX) });
    }
    phase = "out";
    if (outUses) {
      const outStart = Math.max(timing.end - outDur, pts[pts.length - 1].t);
      if (outStart > pts[pts.length - 1].t + 1e-6) pts.push({ t: outStart, v: render(NEUTRAL_FX) });
      pts[pts.length - 1].easing = cssEasing(tout!.ease);
      pts.push({ t: timing.end, v: render({ ...NEUTRAL_FX, ...tout!.away }) });
    } else if (pts[pts.length - 1].t < timing.end - 1e-6) {
      pts.push({ t: timing.end, v: render(NEUTRAL_FX) });
    }
    // Masks and blur are switched OFF while the layer just stands there: a resting inset(0) would cut
    // shadows and glow, and any filter would stop glass (backdrop-filter) from seeing the background.
    if (g.css === "clipPath" || g.css === "filter") {
      const neutral = (v: string) => v === render(NEUTRAL_FX) || v === fxCss(g.css, NEUTRAL_FX, s, !irisOut) || v === fxCss(g.css, NEUTRAL_FX, s, irisOut);
      const eps = Math.min(0.001, life / 100);
      const held: typeof pts = [];
      pts.forEach((p, i) => {
        if (!neutral(p.v)) { held.push(p); return; }
        const prevAway = i > 0 && !neutral(pts[i - 1].v);
        const nextAway = i < pts.length - 1 && !neutral(pts[i + 1].v);
        if (prevAway) held.push({ t: p.t, v: p.v }, { t: p.t + eps, v: "none" });
        if (nextAway) held.push({ t: p.t - eps, v: "none" }, { t: p.t, v: p.v, easing: p.easing });
        if (!prevAway && !nextAway) held.push({ t: p.t, v: "none" });
      });
      const sorted = held.map((p) => ({ ...p, t: Math.min(Math.max(p.t, start), timing.end) }));
      pts.length = 0;
      pts.push(...sorted);
    }
    const frames = pts.map((p) => {
      const kf: Record<string, string | number> = { offset: r4((p.t - start) / life), [g.css]: p.v };
      if (p.easing) kf.easing = p.easing;
      return kf;
    });
    out.push([`om-fx-${layer.id}`, frames, ms(start), ms(life)]);
  }
  return out;
}

function fxCss(css: string, st: FxState, s: number, iris = false): string {
  switch (css) {
    case "translate":
      return `${r2(st.tx * s)}px ${r2(st.ty * s)}px`;
    case "scale":
      return String(r4(st.scale));
    case "opacity":
      return String(r4(st.opacity));
    case "clipPath":
      return iris ? `circle(${r2(st.iris)}% at 50% 50%)` : `inset(${r2(st.clipTop)}% ${r2(st.clipRight)}% ${r2(st.clipBottom)}% ${r2(st.clipLeft)}%)`;
    case "filter":
      return `blur(${r2(st.blur * s)}px)`;
  }
  return "";
}

function segAttrs(id: string, start: number, duration: number, track: number, mediaStart?: number): string {
  return `data-om-id="${esc(id)}" data-start="${r3(start)}" data-duration="${r3(duration)}" data-track-index="${track}"${mediaStart !== undefined ? ` data-media-start="${r3(mediaStart)}"` : ""}`;
}

interface ContentCtx {
  s: number;
  palette: Record<string, string>;
  assets: Set<string>;
  anims: AnimDef[];
  timing: LayerTiming;
  lang: string;
  spec: MotionSpec;
}

/** Shadow, glow and glass for the content element. */
function lookCss(layer: VisualLayer, ctx: ContentCtx): string[] {
  const lk = layer.look;
  if (!lk) return [];
  const filters: string[] = [];
  if (lk.shadow) filters.push(`drop-shadow(${scaleLengths(color(lk.shadow, ctx.palette), ctx.s)})`);
  if (lk.glow) {
    const g = (lk.glowSize ?? 24) * ctx.s;
    const c = color(lk.glow, ctx.palette);
    filters.push(`drop-shadow(0 0 ${r2(g / 2)}px ${c})`, `drop-shadow(0 0 ${r2(g)}px ${c})`);
  }
  const out = filters.length ? [`filter:${filters.join(" ")}`] : [];
  if (lk.glass) out.push(`backdrop-filter:blur(${r2(lk.glass * ctx.s)}px) saturate(1.4)`, `-webkit-backdrop-filter:blur(${r2(lk.glass * ctx.s)}px) saturate(1.4)`);
  return out;
}

/** "0 20px 40px #000" → lengths scaled for export size. */
function scaleLengths(v: string, s: number): string {
  return s === 1 ? v : v.replace(/(-?[\d.]+)px/g, (_, n: string) => `${r2(Number(n) * s)}px`);
}

/** Text pieces for kinetic type: [[highlights]], split by word/char/line, each with its own entrance. */
function textBody(layer: Extract<VisualLayer, { type: "text" }>, ctx: ContentCtx): string {
  const st = layer.style;
  const segs: { text: string; hl: boolean }[] = [];
  layer.text.split(/\[\[|\]\]/).forEach((part, i) => { if (part) segs.push({ text: part, hl: i % 2 === 1 }); });
  // With a marker behind the word, the word itself keeps the text color (accent on accent would vanish).
  const hlColor = color(st.highlight ?? (st.marker ? st.color ?? "#ffffff" : ctx.palette.accent ? "$accent" : st.color ?? "#ffffff"), ctx.palette);
  const marker = st.marker ? color(st.marker, ctx.palette) : "";
  const hlStyle = (grow: boolean) =>
    `color:${hlColor}${marker ? `;background:linear-gradient(${marker},${marker}) no-repeat 0 88%/${grow ? "0%" : "100%"} 42%;-webkit-text-fill-color:${hlColor}` : ";-webkit-text-fill-color:" + hlColor}`;

  const a = layer.anim;
  if (!a) {
    return segs.map((g) => (g.hl ? `<span class="om-hl" style="${esc(hlStyle(false))}">${esc(g.text)}</span>` : esc(g.text))).join("");
  }
  const by = a.by ?? (a.type === "type" ? "char" : "word");
  // Pieces keep their spaces/newlines as plain text between them, so wrapping stays natural.
  type Piece = { text: string; hl: boolean } | { gap: string };
  const pieces: Piece[] = [];
  for (const g of segs) {
    const re = by === "char" ? /(\s+)|([^\s])/gu : by === "line" ? /(\n+)|([^\n]+)/g : /(\s+)|(\S+)/g;
    for (const m of g.text.matchAll(re)) pieces.push(m[1] ? { gap: m[1] } : { text: m[2], hl: g.hl });
  }
  const real = pieces.filter((p): p is { text: string; hl: boolean } => "text" in p);
  const n = real.length;
  const rank = a.order === "random" ? seededOrder(n, layer.id)
    : a.order === "end" ? real.map((_, i) => n - 1 - i)
    : a.order === "center" ? real.map((_, i) => Math.round(Math.abs(i - (n - 1) / 2) * 2))
    : real.map((_, i) => i);
  const stagger = a.stagger ?? (by === "char" ? (a.type === "type" ? 0.045 : 0.025) : by === "line" ? 0.12 : 0.06);
  const dur = a.duration ?? (a.type === "type" ? 0.01 : 0.6);
  const ease = cssEasing(a.ease ?? (a.type === "pop" ? "expo.out" : a.type === "type" ? "linear" : "power3.out"));
  const { timing } = ctx;
  const from: Record<string, Record<string, string | number>> = {
    rise: { translate: "0 0.55em", opacity: 0 },
    fade: { opacity: 0 },
    blur: { filter: "blur(0.35em)", opacity: 0 },
    pop: { scale: 0.4, opacity: 0 },
    mask: { translate: "0 105%" },
    drop: { translate: "0 -0.7em", opacity: 0 },
    slide: { translate: "0.7em 0", opacity: 0 },
    type: { opacity: 0 },
  };
  const to: Record<string, Record<string, string | number>> = {
    rise: { translate: "0 0", opacity: 1 },
    fade: { opacity: 1 },
    blur: { filter: "blur(0em)", opacity: 1 },
    pop: { scale: 1, opacity: 1 },
    mask: { translate: "0 0" },
    drop: { translate: "0 0", opacity: 1 },
    slide: { translate: "0 0", opacity: 1 },
    type: { opacity: 1 },
  };
  let k = 0;
  return pieces.map((p) => {
    if ("gap" in p) return esc(p.gap);
    const i = k++;
    const pid = `om-p-${layer.id}-${i}`;
    const delay = timing.start + ((a.delay ?? 0) + rank[i] * stagger) / timing.speed;
    const d = dur / timing.speed;
    ctx.anims.push([pid, [{ ...from[a.type], easing: a.type === "type" ? "steps(1, end)" : ease }, { ...to[a.type] }], ms(delay), ms(Math.max(d, 0.001))]);
    let inner = esc(p.text);
    if (p.hl) {
      const hid = `${pid}-h`;
      if (marker) ctx.anims.push([hid, [{ backgroundSize: "0% 42%", easing: cssEasing("power2.inOut") }, { backgroundSize: "100% 42%" }], ms(delay + d * 0.5), ms(0.45 / timing.speed)]);
      inner = `<span id="${esc(hid)}" class="om-hl" style="${esc(hlStyle(!!marker))}">${inner}</span>`;
    }
    // A shared gradient does not reach transformed pieces, so each piece carries it.
    const grad = st.gradient && !p.hl ? ` style="${esc(`background:${color(st.gradient, ctx.palette)};-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent`)}"` : "";
    const span = `<span id="${esc(pid)}" class="om-p"${grad}>${inner}</span>`;
    return a.type === "mask" ? `<span class="om-m">${span}</span>` : span;
  }).join("");
}

/** Counter: a registered integer property animated by WAAPI, shown through CSS counters (seek-safe, no script). */
function countBody(layer: Extract<VisualLayer, { type: "text" }>, cid: string, ctx: ContentCtx): string {
  const c = layer.count!;
  const dec = c.decimals ?? 0;
  const f = 10 ** dec;
  const prop = `--om-n-${layer.id}`;
  const nid = `om-n-${layer.id}`;
  const point = c.point ?? (ctx.lang.startsWith("de") ? "," : ".");
  const neg = c.from < 0 || c.to < 0;
  const reset = dec === 0 || neg
    ? `counter-reset:omi var(${prop})`
    : `counter-reset:omi round(down, calc(var(${prop}) / ${f}), 1) omf mod(var(${prop}), ${f})`;
  const shown = dec === 0 || neg ? "counter(omi)" : `counter(omi) ${cssString(point)} counter(omf${dec === 2 ? ", decimal-leading-zero" : ""})`;
  // Non-breaking spaces: "98 %" must never wrap between the number and its unit.
  const nb = (v: string) => cssString(v.replace(/ /g, "\u00a0"));
  const contentCss = `${nb(c.prefix ?? "")} ${shown} ${nb(c.suffix ?? "")}`;
  const { timing } = ctx;
  const delay = timing.start + (c.delay ?? 0) / timing.speed;
  const scaled = (v: number) => Math.round(v * (neg ? 1 : f));
  ctx.anims.push([nid, [{ [prop]: scaled(c.from), easing: cssEasing(c.ease ?? "expo.out") }, { [prop]: scaled(c.to) }], ms(delay), ms((c.duration ?? 1.6) / timing.speed)]);
  // The <style> lives inside the layer, so hot updates in the editor replace it too.
  void cid;
  return `<style>@property ${prop}{syntax:"<integer>";inherits:false;initial-value:0}#${nid}{${prop}:${scaled(c.from)};${reset}}#${nid}::after{content:${contentCss}}</style><span id="${esc(nid)}" class="om-count"></span>`;
}

/** SVG strokes draw themselves: pathLength=1 makes every element 1 long, so no measuring is needed. */
function drawSvg(layer: Extract<VisualLayer, { type: "svg" }>, body: string, ctx: ContentCtx): string {
  const d = layer.draw!;
  const { timing } = ctx;
  const total = (d.duration ?? 1.2) / timing.speed;
  const stagger = (d.stagger ?? 0.08) / timing.speed;
  const ease = cssEasing(d.ease ?? "power2.inOut");
  let i = 0;
  return body.replace(/<(path|line|polyline|polygon|circle|ellipse|rect)\b/gi, (_, tag: string) => {
    const id = `om-d-${layer.id}-${i}`;
    const delay = timing.start + (d.delay ?? 0) / timing.speed + i * stagger;
    ctx.anims.push([id, [
      { strokeDashoffset: 1, fillOpacity: 0, easing: ease },
      { strokeDashoffset: 0, fillOpacity: 0, offset: 0.7, easing: cssEasing("power1.out") },
      { strokeDashoffset: 0, fillOpacity: 1 },
    ], ms(delay), ms(total)]);
    i++;
    return `<${tag} id="${esc(id)}" pathLength="1" stroke-dasharray="1"`;
  });
}

/** Film texture over the picture: seeded grain (moves 12×/s), vignette, scanlines. Deterministic for export. */
function textureHtml(spec: MotionSpec, width: number, height: number, duration: number, s: number, anims: AnimDef[]): string {
  const tx = spec.canvas.texture;
  if (!tx) return "";
  const out: string[] = [];
  if (tx.grain) {
    const tile = Math.round(220 * s) || 1;
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${tile}' height='${tile}'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='${r3(0.9 / s)}' numOctaves='2' seed='7' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 1.6 -0.3'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>`;
    const steps = Math.max(1, Math.round(duration * 12));
    out.push(`<div id="om-grain" class="om-tex" style="opacity:${r3(tx.grain * 0.55)};mix-blend-mode:overlay;background-image:url(&quot;data:image/svg+xml,${svg.replace(/"/g, "'").replace(/#/g, "%23").replace(/</g, "%3C").replace(/>/g, "%3E")}&quot;)"></div>`);
    anims.push(["om-grain", [{ backgroundPosition: "0px 0px", easing: `steps(${steps}, end)` }, { backgroundPosition: `${steps * 131}px ${steps * 83}px` }], 0, ms(Math.max(duration, 0.001))]);
  }
  if (tx.vignette) out.push(`<div class="om-tex" style="background:radial-gradient(ellipse at 50% 50%, transparent 52%, rgba(0,0,0,${r3(tx.vignette * 0.8)}) 100%)"></div>`);
  if (tx.scanlines) out.push(`<div class="om-tex" style="opacity:${r3(tx.scanlines * 0.5)};background:repeating-linear-gradient(0deg, rgba(0,0,0,.55) 0 ${r2(2 * s)}px, transparent ${r2(2 * s)}px ${r2(4 * s)}px)"></div>`);
  void width; void height;
  return out.join("\n");
}

function textCss(st: TextStyle, ctx: ContentCtx, gradient: boolean, look: string[]): string[] {
  const { s, palette } = ctx;
  return [
    `font-family:${st.fontFamily ? `${cssString(st.fontFamily)},system-ui,sans-serif` : "system-ui,sans-serif"}`,
    `font-size:${px(st.fontSize * s)}`,
    `font-weight:${st.fontWeight ?? 400}`,
    st.italic ? "font-style:italic" : "",
    `color:${color(st.color ?? "#ffffff", palette)}`,
    `text-align:${st.align ?? "left"}`,
    `justify-content:${{ top: "flex-start", middle: "center", center: "center", bottom: "flex-end" }[st.valign ?? "top"]}`,
    `line-height:${st.lineHeight ?? 1.15}`,
    st.letterSpacing ? `letter-spacing:${px(st.letterSpacing * s)}` : "",
    st.uppercase ? "text-transform:uppercase" : "",
    st.background ? `background:${color(st.background, palette)}` : "",
    st.padding ? `padding:${px(st.padding * s)}` : "",
    st.radius ? `border-radius:${px(st.radius * s)}` : "",
    gradient && st.gradient ? `background:${color(st.gradient, palette)};-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent` : "",
    ...look,
  ].filter(Boolean);
}

/**
 * Captions: transcript words grouped into short phrases (max N words, break at punctuation and pauses).
 * Each phrase shows while it is spoken; the current word lights up. Cut words are skipped and times
 * come from the recording (sourceToComp), so captions follow every cut.
 */
function captionsBody(layer: Extract<VisualLayer, { type: "captions" }>, ctx: ContentCtx): string {
  const spec = ctx.spec;
  const tr = spec.transcript;
  if (!tr?.words.length) return "";
  const { timing } = ctx;
  const maxN = layer.words ?? 3;
  const words = tr.words
    .filter((w) => !isWordCut(tr, w.id))
    .map((w) => ({ w, t0: sourceToComp(spec, w.t0), t1: sourceToComp(spec, w.t1) }))
    .filter((x) => x.t1 > timing.start && x.t0 < timing.end);
  const groups: (typeof words)[] = [];
  let cur: typeof words = [];
  words.forEach((x, i) => {
    cur.push(x);
    const next = words[i + 1];
    const brk = cur.length >= maxN || /[.,!?;:…]$/.test(x.w.text) || !next || next.t0 - x.t1 > 0.45;
    if (brk) { groups.push(cur); cur = []; }
  });
  const life = Math.max(timing.end - timing.start, 1e-6);
  const off = (t: number) => r4(Math.min(1, Math.max(0, (t - timing.start) / life)));
  const act = layer.active ?? {};
  const actColor = color(act.color ?? (ctx.palette.accent ? "$accent" : "#FFE600"), ctx.palette);
  const baseColor = color(layer.style.color ?? "#ffffff", ctx.palette);
  const actBg = act.background ? color(act.background, ctx.palette) : "";
  const actScale = act.scale ?? 1.06;
  const flex = { left: "flex-start", center: "center", right: "flex-end", top: "flex-start", middle: "center", bottom: "flex-end" } as const;
  const place = `justify-content:${flex[layer.style.align ?? "center"]};align-content:${flex[layer.style.valign ?? "bottom"]};align-items:center`;
  return groups.map((g, gi) => {
    const gid = `om-cap-${layer.id}-${gi}`;
    const show = g[0].t0;
    const hide = Math.max(groups[gi + 1]?.[0].t0 ?? g[g.length - 1].t1 + 0.4, show + 0.05);
    // Visible only while spoken (discrete), with a tiny lift on entry.
    ctx.anims.push([gid, [
      { offset: 0, opacity: 0, translate: "0 0.25em" },
      { offset: off(show), opacity: 0, translate: "0 0.25em", easing: cssEasing("expo.out") },
      { offset: off(Math.min(show + 0.18, hide)), opacity: 1, translate: "0 0" },
      { offset: off(hide), opacity: 1, translate: "0 0" },
      { offset: off(hide), opacity: 0, translate: "0 0" },
      { offset: 1, opacity: 0, translate: "0 0" },
    ], ms(timing.start), ms(life)]);
    const spans = g.map((x, wi) => {
      const wid = `${gid}-${wi}`;
      const end = g[wi + 1]?.t0 ?? hide;
      const frames: Record<string, string | number>[] = [
        { offset: 0, color: baseColor, scale: 1 },
        { offset: off(x.t0), color: baseColor, scale: 1 },
        { offset: off(x.t0), color: actColor, scale: actScale },
        { offset: off(end), color: actColor, scale: actScale },
        { offset: off(end), color: baseColor, scale: 1 },
        { offset: 1, color: baseColor, scale: 1 },
      ];
      if (actBg) frames.forEach((f, k) => { f.backgroundColor = k === 2 || k === 3 ? actBg : "transparent"; });
      ctx.anims.push([wid, frames, ms(timing.start), ms(life)]);
      return `<span id="${esc(wid)}" class="om-p" style="padding:0 .12em;border-radius:.18em">${esc(x.w.text)}</span>`;
    }).join(" ");
    return `<div id="${esc(gid)}" class="om-cap" style="${place}">${spans}</div>`;
  }).join("");
}

function interpolateAbs(list: Keyframe[], t: number): number {
  return interpolate(list, { start: 0, end: Infinity, speed: 1 }, t);
}

function content(layer: VisualLayer, clipAttrs: string, ctx: ContentCtx, idSuffix = ""): string {
  const { s, palette, assets } = ctx;
  const cid = `om-c-${esc(layer.id)}${idSuffix}`;
  const look = lookCss(layer, ctx);
  switch (layer.type) {
    case "captions": {
      const css = textCss(layer.style, ctx, false, look);
      return `<div id="${cid}" class="clip om-c om-text" ${clipAttrs} style="${esc(css.join(";"))}">${captionsBody(layer, ctx)}</div>`;
    }
    case "text": {
      const st = layer.style;
      const css = [
        `font-family:${st.fontFamily ? `${cssString(st.fontFamily)},system-ui,sans-serif` : "system-ui,sans-serif"}`,
        `font-size:${px(st.fontSize * s)}`,
        `font-weight:${st.fontWeight ?? 400}`,
        st.italic ? "font-style:italic" : "",
        `color:${color(st.color ?? "#ffffff", palette)}`,
        `text-align:${st.align ?? "left"}`,
        `justify-content:${{ top: "flex-start", middle: "center", center: "center", bottom: "flex-end" }[st.valign ?? "top"]}`,
        `line-height:${st.lineHeight ?? 1.15}`,
        st.letterSpacing ? `letter-spacing:${px(st.letterSpacing * s)}` : "",
        st.uppercase ? "text-transform:uppercase" : "",
        st.background ? `background:${color(st.background, palette)}` : "",
        st.padding ? `padding:${px(st.padding * s)}` : "",
        st.radius ? `border-radius:${px(st.radius * s)}` : "",
        st.gradient && !layer.anim ? `background:${color(st.gradient, palette)};-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent` : "",
        ...look,
      ].filter(Boolean);
      const rich = layer.count || layer.anim || /\[\[/.test(layer.text);
      const body = layer.count ? countBody(layer, cid, ctx) : rich ? textBody(layer, ctx) : esc(layer.text);
      return `<div id="${cid}" class="clip om-c om-text" ${clipAttrs} style="${esc(css.join(";"))}">${rich ? `<div class="om-t">${body}</div>` : body}</div>`;
    }
    case "shape": {
      const css = [
        `background:${color(layer.fill ?? "transparent", palette)}`,
        layer.stroke ? `border:${px((layer.strokeWidth ?? 2) * s)} solid ${color(layer.stroke, palette)}` : "",
        layer.shape === "ellipse" ? "border-radius:50%" : layer.radius ? `border-radius:${px(layer.radius * s)}` : "",
        ...look,
      ].filter(Boolean);
      return `<div id="${cid}" class="clip om-c" ${clipAttrs} style="${esc(css.join(";"))}"></div>`;
    }
    case "svg": {
      const vb = layer.viewBox ?? `0 0 ${layer.frame.w} ${layer.frame.h}`;
      const par = layer.preserveAspectRatio ?? "xMidYMid meet";
      let body = scopeSvgIds(paletteInSvg(sanitizeSvg(layer.svg), palette), `om-svg-${layer.id}-`);
      if (layer.draw) body = drawSvg(layer, body, ctx);
      return `<div id="${cid}" class="clip om-c" ${clipAttrs}${look.length ? ` style="${esc(look.join(";"))}"` : ""}><svg xmlns="http://www.w3.org/2000/svg" viewBox="${esc(vb)}" preserveAspectRatio="${esc(par)}" width="100%" height="100%" style="display:block;overflow:visible">${body}</svg></div>`;
    }
    case "image": {
      trackAsset(assets, layer.src);
      const css = [`object-fit:${layer.fit ?? "cover"}`, layer.radius ? `border-radius:${px(layer.radius * s)}` : "", ...look].filter(Boolean);
      return `<img id="${cid}" class="clip om-c" ${clipAttrs} src="${esc(layer.src)}" alt="" style="${esc(css.join(";"))}">`;
    }
    case "video": {
      trackAsset(assets, layer.src);
      const muted = layer.muted !== false;
      const css = [`object-fit:${layer.fit ?? "cover"}`, layer.radius ? `border-radius:${px(layer.radius * s)}` : "", ...look].filter(Boolean);
      const media = layer.mediaStart ? ` data-media-start="${r3(layer.mediaStart)}"` : "";
      const sound = muted ? " muted" : ` data-volume="${layer.volume ?? 1}"`;
      return `<video id="${cid}" class="clip om-c" ${clipAttrs}${media}${sound} src="${esc(layer.src)}" playsinline preload="auto" style="${esc(css.join(";"))}"></video>`;
    }
  }
}

/** Removes scripts, event handlers, foreignObject and javascript: links from AI-written SVG. */
export function sanitizeSvg(markup: string): string {
  return markup
    .replace(/<\s*script[\s\S]*?<\s*\/\s*script\s*>/gi, "")
    .replace(/<\s*script\b[^>]*>/gi, "")
    .replace(/<\s*foreignObject[\s\S]*?<\s*\/\s*foreignObject\s*>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s(?:xlink:)?href\s*=\s*("|')\s*javascript:[^"']*\1/gi, "");
}

/**
 * Ids inside an SVG (patterns, gradients, clip paths) live in the page's id space. "dots" in a layer
 * "dots" would clash with the layer box om-dots, and two layers with id="g" would steal each other's
 * gradient. Every id and its references (url(#…), href="#…") get a per-layer prefix.
 */
export function scopeSvgIds(markup: string, prefix: string): string {
  const ids = new Set([...markup.matchAll(/\sid\s*=\s*("|')([^"']+)\1/g)].map((m) => m[2]));
  if (!ids.size) return markup;
  const esc = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let out = markup.replace(/(\sid\s*=\s*)("|')([^"']+)\2/g, (m, a: string, q: string, id: string) => `${a}${q}${prefix}${id}${q}`);
  for (const id of ids) {
    out = out
      .replace(new RegExp(`url\\(\\s*(['"]?)#${esc(id)}\\1\\s*\\)`, "g"), `url(#${prefix}${id})`)
      .replace(new RegExp(`((?:xlink:)?href\\s*=\\s*)("|')#${esc(id)}\\2`, "g"), `$1$2#${prefix}${id}$2`);
  }
  return out;
}

/** "$accent" → "var(--om-accent)" for palette names, also inside gradients and shadows. */
export function color(value: string, palette: Record<string, string>): string {
  return value.replace(/\$([a-z][a-z0-9-]*)/g, (m, name: string) => (name in palette ? `var(--om-${name})` : m));
}

function paletteInSvg(markup: string, palette: Record<string, string>): string {
  return markup.replace(/\$([a-z][a-z0-9-]*)/g, (m, name: string) => (name in palette ? `var(--om-${name})` : m));
}

function cssValue(prop: AnimProp, v: number, s: number): string | number {
  if (prop === "rotation") return `${r3(v)}deg`;
  if (prop === "scale" || prop === "opacity") return r4(v);
  if (prop === "blur") return v > 0 ? `blur(${r2(v * s)}px)` : "none";
  return `${r2(v * s)}px`;
}

const tilt = (rx: number, ry: number) => `perspective(${PERSPECTIVE}px) rotateX(${r3(rx)}deg) rotateY(${r3(ry)}deg)`;

/**
 * One animation for several keyed values that share a CSS property: sampled at MERGE_FPS with linear steps.
 * Exact at every sample, so the curve matches evaluate() to well under a pixel.
 */
function mergedAnim(el: string, t0: number, t1: number, css: string, at: (t: number) => string): AnimDef {
  const span = Math.max(t1 - t0, 1e-6);
  const n = Math.max(1, Math.min(2000, Math.ceil(span * MERGE_FPS)));
  const frames: Record<string, string | number>[] = [];
  for (let i = 0; i <= n; i++) frames.push({ offset: r4(i / n), [css]: at(t0 + (span * i) / n) });
  return [el, frames, ms(t0), ms(span)];
}

/** Keys that live on absolute time (camera) or layer time; returns [first, last] absolute seconds. */
function keySpan(lists: (Keyframe[] | undefined)[], abs: (k: Keyframe) => number): [number, number] | null {
  const all = lists.flatMap((l) => (l && l.length > 1 ? [abs(l[0]), abs(l[l.length - 1])] : []));
  return all.length ? [Math.min(...all), Math.max(...all)] : null;
}

/** Deterministic shuffle (same order in preview and export). */
function seededOrder(n: number, seed: string): number[] {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  const idx = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909);
    const j = Math.abs(h) % (i + 1);
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx;
}

function trackAsset(set: Set<string>, src: string) {
  if (!/^(https?:|data:|blob:)/i.test(src)) set.add(src.replace(/^\.\//, ""));
}

const camel = (css: string) => css.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
const px = (v: number) => `${r2(v)}px`;
const ms = (sec: number) => Math.round(sec * 1000 * 1000) / 1000;
const r2 = (v: number) => Math.round(v * 100) / 100;
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const r4 = (v: number) => Math.round(v * 10000) / 10000;
const even = (v: number) => Math.max(2, Math.round(v / 2) * 2);
const cssString = (v: string) => `"${v.replace(/["\\]/g, "\\$&")}"`;

export function esc(v: string): string {
  return v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
