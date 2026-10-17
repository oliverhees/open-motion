// Time model.
// Scenes play one after another. A layer can live inside a scene (relative time),
// on the global timeline (absolute time), or hang on a transcript word (anchor).

import type { Layer, MotionSpec } from "./types.ts";
import { isCutLayer, keptSegments, normalizeCuts, removedBetween } from "./cuts.ts";

export interface SceneTiming {
  id: string;
  start: number;
  end: number;
  speed: number;
}

export interface LayerTiming {
  /** Absolute start in seconds. */
  start: number;
  end: number;
  /** Tempo for keys and transitions (from the scene). */
  speed: number;
}

export function sceneTimings(spec: MotionSpec): Map<string, SceneTiming> {
  const out = new Map<string, SceneTiming>();
  let t = 0;
  for (const s of spec.scenes) {
    out.set(s.id, { id: s.id, start: t, end: t + s.duration, speed: s.speed ?? 1 });
    t += s.duration;
  }
  return out;
}

export function layerTiming(spec: MotionSpec, layer: Layer, scenes = sceneTimings(spec)): LayerTiming {
  const scene = layer.scene ? scenes.get(layer.scene) : undefined;
  const speed = scene?.speed ?? 1;
  let start: number;
  if (layer.anchor) {
    const word = spec.transcript?.words.find((w) => w.id === layer.anchor!.word);
    if (!word) throw new Error(`Layer "${layer.id}": anchor word "${layer.anchor.word}" not found in transcript`);
    start = Math.max(0, sourceToComp(spec, word.t0, scenes) + (layer.anchor.offset ?? 0));
  } else {
    start = (scene?.start ?? 0) + layer.start;
  }
  let duration = layer.duration;
  if (isCutLayer(spec, layer)) {
    const m0 = layer.mediaStart ?? 0;
    duration = Math.max(0.001, layer.duration - removedBetween(normalizeCuts(spec.transcript!.cuts), m0, m0 + layer.duration));
  }
  return { start, end: start + duration, speed };
}

/** Absolute time of a keyframe or transition offset given in layer-relative seconds. */
export function toAbs(timing: LayerTiming, rel: number): number {
  return timing.start + rel / timing.speed;
}

/** Layer-relative "spec time" for an absolute time (inverse of toAbs). */
export function toRel(timing: LayerTiming, abs: number): number {
  return (abs - timing.start) * timing.speed;
}

export function compositionDuration(spec: MotionSpec): number {
  const scenes = sceneTimings(spec);
  let d = 0;
  for (const s of scenes.values()) d = Math.max(d, s.end);
  for (const l of spec.layers) {
    if (l.hidden) continue;
    d = Math.max(d, layerTiming(spec, l, scenes).end);
  }
  return Math.max(d, 1 / spec.canvas.fps);
}

/** Which scene is playing at time t (for scene strip / "Scene 2 of 4"). */
export function sceneAt(spec: MotionSpec, t: number): SceneTiming | undefined {
  for (const s of sceneTimings(spec).values()) if (t >= s.start && t < s.end) return s;
  return undefined;
}

/**
 * The layer that plays the transcript's recording (video preferred over audio).
 * Undefined if there is none: then source time = composition time.
 */
export function transcriptCarrier(spec: MotionSpec): Layer | undefined {
  const src = spec.transcript?.source;
  if (!src) return undefined;
  const hits = spec.layers.filter((l) => (l.type === "video" || l.type === "audio") && l.src === src && !l.anchor);
  return hits.find((l) => l.type === "video") ?? hits[0];
}

/** Source-recording seconds → composition seconds. A time inside a cut maps to the cut point. */
export function sourceToComp(spec: MotionSpec, t: number, scenes = sceneTimings(spec)): number {
  const carrier = transcriptCarrier(spec);
  if (!carrier || (carrier.type !== "video" && carrier.type !== "audio")) return t;
  const media = carrier.mediaStart ?? 0;
  const removed = removedBetween(normalizeCuts(spec.transcript?.cuts), media, Math.max(media, t));
  return layerTiming(spec, carrier, scenes).start + (t - media) - removed;
}

/** Composition seconds → source-recording seconds (skips over cuts). */
export function compToSource(spec: MotionSpec, t: number): number {
  const carrier = transcriptCarrier(spec);
  if (!carrier || (carrier.type !== "video" && carrier.type !== "audio")) return t;
  const start = layerTiming(spec, carrier).start;
  const rel = t - start;
  if (!isCutLayer(spec, carrier)) return rel + (carrier.mediaStart ?? 0);
  const segs = keptSegments(spec, carrier);
  for (const sg of segs) if (rel < sg.rel0 + (sg.src1 - sg.src0)) return sg.src0 + Math.max(0, rel - sg.rel0);
  const last = segs[segs.length - 1];
  return last ? last.src1 + (rel - (last.rel0 + last.src1 - last.src0)) : rel + (carrier.mediaStart ?? 0);
}
