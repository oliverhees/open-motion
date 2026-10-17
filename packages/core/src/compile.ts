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
import { compositionDuration, layerTiming, sceneTimings, toAbs, type LayerTiming } from "./timing.ts";
import { NEUTRAL_FX, transitionWindows, type FxKey, type FxState } from "./transitions.ts";
import { isCutLayer, keptSegments } from "./cuts.ts";
import { isVisual, type AnimProp, type Keyframe, type Layer, type MotionSpec, type VisualLayer } from "./types.ts";

export interface CompileOptions {
  /** Output scale. 0.5 turns a 1920×1080 canvas into a 960×540 composition. Default 1. */
  scale?: number;
  /** Layer id → pre-cut audio file (relative path). Used at export for click-free cuts. */
  audioOverrides?: Record<string, string>;
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

const CSS_PROP: Record<AnimProp, string> = {
  x: "left",
  y: "top",
  w: "width",
  h: "height",
  rotation: "rotate",
  scale: "scale",
  opacity: "opacity",
};

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
  const audioHtml: string[] = [];

  const ordered = spec.layers
    .map((layer, index) => ({ layer, index }))
    .filter((e) => !e.layer.hidden)
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
    ].filter(Boolean);

    for (const [prop, list] of Object.entries(layer.keys ?? {}) as [AnimProp, Keyframe[] | undefined][]) {
      if (!list || list.length === 0) continue;
      const css = CSS_PROP[prop];
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

    visualHtml.push(
      `<div id="om-${esc(layer.id)}" class="om-l" data-om-layer="${esc(layer.id)}" data-om-type="${layer.type}" style="${esc(frameStyle.join(";"))}">` +
        `<div id="om-fx-${esc(layer.id)}" class="om-fx">${
          layer.type === "video" && isCutLayer(spec, layer)
            ? keptSegments(spec, layer).map((sg, k) => content({ ...layer, mediaStart: sg.src0 }, segAttrs(layer.id, timing.start + sg.rel0, sg.src1 - sg.src0, paintIndex), s, palette, assets, k ? `-s${k}` : "")).join("")
            : content(layer, clipAttrs, s, palette, assets)
        }</div></div>`,
    );
  });

  const fontFaces = (spec.style?.fonts ?? [])
    .map((font) => {
      trackAsset(assets, font.src);
      return `@font-face{font-family:${cssString(font.family)};src:url(${cssString(font.src)});font-weight:${font.weight ?? "100 900"};font-style:${font.style ?? "normal"};font-display:block}`;
    })
    .join("\n");

  const vars = Object.entries(palette)
    .map(([k, v]) => `--om-${k}:${v};`)
    .join("");
  const background = color(spec.canvas.background ?? "#000000", palette);
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
html,body{margin:0;padding:0;background:#000}
#root{position:relative;width:${width}px;height:${height}px;overflow:hidden;background:${background};${vars}}
.om-l{position:absolute}
.om-fx{position:absolute;inset:0}
.om-c{position:absolute;inset:0;width:100%;height:100%;display:block}
.om-text{display:flex;flex-direction:column;white-space:pre-wrap;overflow-wrap:break-word}
</style>
</head>
<body>
<div id="root" data-composition-id="main" data-no-timeline data-start="0" data-duration="${duration}" data-width="${width}" data-height="${height}">
${visualHtml.join("\n")}
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
    { css: "clipPath", members: ["clipRight"] },
    { css: "filter", members: ["blur"] },
  ];
  const out: AnimDef[] = [];
  const start = timing.start;
  const life = Math.max(timing.end - timing.start, 1e-6);
  for (const g of groups) {
    if (!g.members.some((m) => keysUsed.has(m))) continue;
    const render = (st: FxState) => fxCss(g.css, st, s);
    const pts: { t: number; v: string; easing?: string }[] = [];
    const inUses = tin && g.members.some((m) => m in tin.away);
    const outUses = tout && g.members.some((m) => m in tout.away);
    if (inUses) {
      pts.push({ t: start, v: render({ ...NEUTRAL_FX, ...tin!.away }), easing: cssEasing(tin!.ease) });
      pts.push({ t: start + inDur, v: render(NEUTRAL_FX) });
    } else {
      pts.push({ t: start, v: render(NEUTRAL_FX) });
    }
    if (outUses) {
      const outStart = Math.max(timing.end - outDur, pts[pts.length - 1].t);
      if (outStart > pts[pts.length - 1].t + 1e-6) pts.push({ t: outStart, v: render(NEUTRAL_FX) });
      pts[pts.length - 1].easing = cssEasing(tout!.ease);
      pts.push({ t: timing.end, v: render({ ...NEUTRAL_FX, ...tout!.away }) });
    } else if (pts[pts.length - 1].t < timing.end - 1e-6) {
      pts.push({ t: timing.end, v: render(NEUTRAL_FX) });
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

function fxCss(css: string, st: FxState, s: number): string {
  switch (css) {
    case "translate":
      return `${r2(st.tx * s)}px ${r2(st.ty * s)}px`;
    case "scale":
      return String(r4(st.scale));
    case "opacity":
      return String(r4(st.opacity));
    case "clipPath":
      return `inset(0px ${r2(st.clipRight)}% 0px 0px)`;
    case "filter":
      return `blur(${r2(st.blur * s)}px)`;
  }
  return "";
}

function segAttrs(id: string, start: number, duration: number, track: number, mediaStart?: number): string {
  return `data-om-id="${esc(id)}" data-start="${r3(start)}" data-duration="${r3(duration)}" data-track-index="${track}"${mediaStart !== undefined ? ` data-media-start="${r3(mediaStart)}"` : ""}`;
}

function content(layer: VisualLayer, clipAttrs: string, s: number, palette: Record<string, string>, assets: Set<string>, idSuffix = ""): string {
  const cid = `om-c-${esc(layer.id)}${idSuffix}`;
  switch (layer.type) {
    case "text": {
      const st = layer.style;
      const css = [
        `font-family:${st.fontFamily ? `${cssString(st.fontFamily)},system-ui,sans-serif` : "system-ui,sans-serif"}`,
        `font-size:${px(st.fontSize * s)}`,
        `font-weight:${st.fontWeight ?? 400}`,
        st.italic ? "font-style:italic" : "",
        `color:${color(st.color ?? "#ffffff", palette)}`,
        `text-align:${st.align ?? "left"}`,
        `justify-content:${{ top: "flex-start", middle: "center", bottom: "flex-end" }[st.valign ?? "top"]}`,
        `line-height:${st.lineHeight ?? 1.15}`,
        st.letterSpacing ? `letter-spacing:${px(st.letterSpacing * s)}` : "",
        st.uppercase ? "text-transform:uppercase" : "",
        st.background ? `background:${color(st.background, palette)}` : "",
        st.padding ? `padding:${px(st.padding * s)}` : "",
        st.radius ? `border-radius:${px(st.radius * s)}` : "",
      ].filter(Boolean);
      return `<div id="${cid}" class="clip om-c om-text" ${clipAttrs} style="${esc(css.join(";"))}">${esc(layer.text)}</div>`;
    }
    case "shape": {
      const css = [
        `background:${color(layer.fill ?? "transparent", palette)}`,
        layer.stroke ? `border:${px((layer.strokeWidth ?? 2) * s)} solid ${color(layer.stroke, palette)}` : "",
        layer.shape === "ellipse" ? "border-radius:50%" : layer.radius ? `border-radius:${px(layer.radius * s)}` : "",
      ].filter(Boolean);
      return `<div id="${cid}" class="clip om-c" ${clipAttrs} style="${esc(css.join(";"))}"></div>`;
    }
    case "svg": {
      const vb = layer.viewBox ?? `0 0 ${layer.frame.w} ${layer.frame.h}`;
      const par = layer.preserveAspectRatio ?? "xMidYMid meet";
      const body = paletteInSvg(sanitizeSvg(layer.svg), palette);
      return `<div id="${cid}" class="clip om-c" ${clipAttrs}><svg xmlns="http://www.w3.org/2000/svg" viewBox="${esc(vb)}" preserveAspectRatio="${esc(par)}" width="100%" height="100%" style="display:block;overflow:visible">${body}</svg></div>`;
    }
    case "image": {
      trackAsset(assets, layer.src);
      const css = [`object-fit:${layer.fit ?? "cover"}`, layer.radius ? `border-radius:${px(layer.radius * s)}` : ""].filter(Boolean);
      return `<img id="${cid}" class="clip om-c" ${clipAttrs} src="${esc(layer.src)}" alt="" style="${esc(css.join(";"))}">`;
    }
    case "video": {
      trackAsset(assets, layer.src);
      const muted = layer.muted !== false;
      const css = [`object-fit:${layer.fit ?? "cover"}`, layer.radius ? `border-radius:${px(layer.radius * s)}` : ""].filter(Boolean);
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

/** "$accent" → "var(--om-accent)" for palette names only. */
export function color(value: string, palette: Record<string, string>): string {
  if (value.startsWith("$")) {
    const name = value.slice(1);
    return name in palette ? `var(--om-${name})` : value;
  }
  return value;
}

function paletteInSvg(markup: string, palette: Record<string, string>): string {
  return markup.replace(/\$([a-z][a-z0-9-]*)/g, (m, name: string) => (name in palette ? `var(--om-${name})` : m));
}

function cssValue(prop: AnimProp, v: number, s: number): string | number {
  if (prop === "rotation") return `${r3(v)}deg`;
  if (prop === "scale" || prop === "opacity") return r4(v);
  return `${r2(v * s)}px`;
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
