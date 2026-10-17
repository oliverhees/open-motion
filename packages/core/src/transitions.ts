// Enter/exit transitions ("in" / "out").
// They run on a separate sub-layer (the "fx" box inside the frame box),
// so a slide-in never fights with a keyframed position or scale.

import { getEase } from "./ease.ts";
import type { Layer, Transition, TransitionType } from "./types.ts";
import type { LayerTiming } from "./timing.ts";

/** State of the fx box. Neutral = no visible effect. */
export interface FxState {
  tx: number;
  ty: number;
  scale: number;
  opacity: number;
  /** Wipe: how much is cut off on the right, in percent. */
  clipRight: number;
  blur: number;
}

export type FxKey = keyof FxState;

export const NEUTRAL_FX: FxState = { tx: 0, ty: 0, scale: 1, opacity: 1, clipRight: 0, blur: 0 };

/** The "away" state a transition starts from (in) or ends at (out). */
export function awayState(type: TransitionType, distance = 60): Partial<FxState> {
  switch (type) {
    case "fade":
      return { opacity: 0 };
    case "slideUp":
      return { ty: distance, opacity: 0 };
    case "slideDown":
      return { ty: -distance, opacity: 0 };
    case "slideLeft":
      return { tx: distance, opacity: 0 };
    case "slideRight":
      return { tx: -distance, opacity: 0 };
    case "pop":
      return { scale: 0.6, opacity: 0 };
    case "wipe":
      return { clipRight: 100 };
    case "blur":
      return { blur: 16, opacity: 0 };
  }
}

export interface ResolvedTransition {
  away: Partial<FxState>;
  /** Seconds on the composition timeline (scene speed already applied). */
  duration: number;
  ease: string;
}

export function resolveTransition(tr: Transition | undefined, dir: "in" | "out", speed: number): ResolvedTransition | undefined {
  if (!tr) return undefined;
  const ease = tr.ease ?? (dir === "in" ? (tr.type === "pop" ? "back.out" : "power3.out") : "power2.in");
  const duration = (tr.duration ?? (dir === "in" ? 0.5 : 0.4)) / speed;
  return { away: awayState(tr.type, tr.distance ?? 60), duration, ease };
}

/** Clamp in/out so they never overlap on short layers. */
export function transitionWindows(layer: Layer, timing: LayerTiming) {
  const life = timing.end - timing.start;
  const tin = resolveTransition(layer.in, "in", timing.speed);
  const tout = resolveTransition(layer.out, "out", timing.speed);
  let inDur = tin ? Math.min(tin.duration, life) : 0;
  let outDur = tout ? Math.min(tout.duration, life) : 0;
  if (inDur + outDur > life) {
    const k = life / (inDur + outDur);
    inDur *= k;
    outDur *= k;
  }
  return { tin, tout, inDur, outDur };
}

/** Fx state at absolute time t. */
export function fxAt(layer: Layer, timing: LayerTiming, t: number): FxState {
  const s: FxState = { ...NEUTRAL_FX };
  const { tin, tout, inDur, outDur } = transitionWindows(layer, timing);
  if (tin && inDur > 0 && t < timing.start + inDur) {
    const p = getEase(tin.ease)(clamp01((t - timing.start) / inDur));
    for (const k of Object.keys(tin.away) as FxKey[]) s[k] = tin.away[k]! + (NEUTRAL_FX[k] - tin.away[k]!) * p;
  }
  if (tout && outDur > 0 && t > timing.end - outDur) {
    const p = getEase(tout.ease)(clamp01((t - (timing.end - outDur)) / outDur));
    for (const k of Object.keys(tout.away) as FxKey[]) s[k] = NEUTRAL_FX[k] + (tout.away[k]! - NEUTRAL_FX[k]) * p;
  }
  return s;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
