// evaluate(spec, t): "What does every layer look like at second t?"
// Pure math, no browser needed. Used by the editor (selection boxes, snapping),
// by the AI (context: "what is on screen at 0:13?") and by tests.
// The compiler produces the same values in the browser via Web Animations.

import { getEase } from "./ease.ts";
import { layerTiming, sceneTimings, type LayerTiming } from "./timing.ts";
import { fxAt, type FxState } from "./transitions.ts";
import { isVisual, type AnimProp, type Keyframe, type Layer, type MotionSpec, type VisualLayer } from "./types.ts";
import { DEFAULT_EASE } from "./ease.ts";

export interface LayerState {
  id: string;
  type: Layer["type"];
  track: number;
  visible: boolean;
  /** Frame values incl. keyframes (canvas px). Undefined for audio. */
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  rotation?: number;
  scale?: number;
  opacity?: number;
  /** Enter/exit effect on top of the frame. */
  fx?: FxState;
  timing: LayerTiming;
}

const DEFAULTS: Record<AnimProp, number> = { x: 0, y: 0, w: 1, h: 1, rotation: 0, scale: 1, opacity: 1, blur: 0, rotateX: 0, rotateY: 0 };

export function baseValue(layer: VisualLayer, prop: AnimProp): number {
  const v = layer.frame[prop];
  return typeof v === "number" ? v : DEFAULTS[prop];
}

/** Value of one property at absolute time t (keys respected). */
export function propAt(layer: VisualLayer, prop: AnimProp, timing: LayerTiming, t: number): number {
  const list = layer.keys?.[prop];
  if (!list || list.length === 0) return baseValue(layer, prop);
  return interpolate(list, timing, t);
}

export function interpolate(list: Keyframe[], timing: LayerTiming, t: number): number {
  const abs = (k: Keyframe) => timing.start + k.t / timing.speed;
  if (t <= abs(list[0])) return list[0].v;
  for (let i = 1; i < list.length; i++) {
    const a = list[i - 1];
    const b = list[i];
    const ta = abs(a);
    const tb = abs(b);
    if (t <= tb) {
      const p = tb === ta ? 1 : (t - ta) / (tb - ta);
      return a.v + (b.v - a.v) * getEase(b.ease ?? DEFAULT_EASE)(p);
    }
  }
  return list[list.length - 1].v;
}

export function evaluate(spec: MotionSpec, t: number): LayerState[] {
  const scenes = sceneTimings(spec);
  const out: LayerState[] = [];
  spec.layers.forEach((layer) => {
    const timing = layerTiming(spec, layer, scenes);
    const visible = !layer.hidden && t >= timing.start && t < timing.end;
    const base: LayerState = { id: layer.id, type: layer.type, track: layer.track, visible, timing };
    if (isVisual(layer)) {
      base.x = propAt(layer, "x", timing, t);
      base.y = propAt(layer, "y", timing, t);
      base.w = propAt(layer, "w", timing, t);
      base.h = propAt(layer, "h", timing, t);
      base.rotation = propAt(layer, "rotation", timing, t);
      base.scale = propAt(layer, "scale", timing, t);
      base.opacity = propAt(layer, "opacity", timing, t);
      base.fx = fxAt(layer, timing, t);
    }
    out.push(base);
  });
  // Paint order: track first, then order in the layer list.
  return out
    .map((s, i) => ({ s, i }))
    .sort((a, b) => a.s.track - b.s.track || a.i - b.i)
    .map((e) => e.s);
}

/**
 * Topmost visible layer under a canvas point at time t.
 * Rotation and fx offsets are ignored on purpose: the editor selects the frame box.
 */
export function layerAt(spec: MotionSpec, t: number, px: number, py: number): string | undefined {
  const states = evaluate(spec, t).filter((s) => s.visible && s.type !== "audio");
  for (let i = states.length - 1; i >= 0; i--) {
    const s = states[i];
    const layer = spec.layers.find((l) => l.id === s.id);
    if (layer?.locked) continue;
    if (px >= s.x! && px <= s.x! + s.w! && py >= s.y! && py <= s.y! + s.h!) return s.id;
  }
  return undefined;
}
