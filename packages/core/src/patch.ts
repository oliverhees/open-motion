// Patches: the only way the spec changes.
// The editor (drag, type, resize) and the AI (any model) both send small operations
// that target layers by id. Everything else stays untouched — "only the cup changes".
//
// applyPatch() never mutates its input, validates the result and explains failures
// in plain words, so a model can read the error and retry.

import { SpecError, validateSpec } from "./schema.ts";
import { layerTiming, toRel } from "./timing.ts";
import { baseValue, propAt } from "./evaluate.ts";
import { normalizeCuts, subtractCut } from "./cuts.ts";
import { templateOps } from "./templates.ts";
import { ANIM_PROPS, isVisual, type AnimProp, type Ease, type Layer, type MotionSpec, type Scene, type VisualLayer } from "./types.ts";

export type PatchOp =
  /** Set any field of a layer by dot path: "text", "frame.x", "style.color", "in.type" … */
  | { op: "set"; id: string; path: string; value: unknown }
  /**
   * Set an animatable property at absolute time t — the editor's drag/resize.
   * Animated property → keyframe at t is added or updated (auto-key).
   * Static property → base value changes, unless `key: true` starts animating it.
   */
  | { op: "setAt"; id: string; prop: AnimProp; t: number; value: number; ease?: Ease; key?: boolean }
  | { op: "removeKey"; id: string; prop: AnimProp; t: number }
  | { op: "add"; layer: Layer; index?: number }
  | { op: "remove"; id: string }
  /** Replace a layer completely but keep its id (e.g. AI redraws one graphic). */
  | { op: "replace"; id: string; layer: Omit<Layer, "id"> & { id?: string } }
  /** Swap the content, keep frame, timing, keys and transitions: graphic → image → video. */
  | { op: "swap"; id: string; content: Record<string, unknown> & { type: Layer["type"] } }
  | { op: "scene"; id: string; set: Partial<Omit<Scene, "id">> }
  | { op: "addScene"; scene: Scene; index?: number }
  | { op: "removeScene"; id: string; removeLayers?: boolean }
  | { op: "style"; set: NonNullable<MotionSpec["style"]> }
  | { op: "canvas"; set: Partial<MotionSpec["canvas"]> }
  | { op: "meta"; set: { [K in keyof MotionSpec["meta"]]?: MotionSpec["meta"][K] | null } }
  /** Set the camera (push-ins, pans, zoom to a target; absolute seconds). null removes it. */
  | { op: "camera"; set: MotionSpec["camera"] | null }
  /** Replace the transcript (null removes it). Anchors on vanished words move to the nearest new word. */
  | { op: "transcript"; set: MotionSpec["transcript"] | null }
  /** Change one word (fix a typo). */
  | { op: "word"; id: string; text: string }
  /** Cut a range of the recording (source seconds). Merges with neighbouring cuts. */
  | { op: "cut"; t0: number; t1: number; reason?: "manual" | "filler" | "pause" }
  /** Restore a range (removes it from the cuts). */
  | { op: "uncut"; t0: number; t1: number }
  | { op: "cuts"; set: { t0: number; t1: number; reason?: "manual" | "filler" | "pause" }[] }
  /** Insert a ready-made template (see TEMPLATES) at composition time `at`: a scene or an overlay, in the project's look. */
  | { op: "template"; id: string; at?: number; values?: Record<string, string> };

export interface PatchResult {
  spec: MotionSpec;
  /** Layer ids that changed (for minimal re-rendering in the editor). */
  changed: string[];
  warnings: string[];
}

export class PatchError extends Error {
  readonly opIndex: number;
  constructor(opIndex: number, message: string) {
    super(`Patch op #${opIndex}: ${message}`);
    this.name = "PatchError";
    this.opIndex = opIndex;
  }
}

/** Fields that belong to the frame/timing "slot" and survive a content swap. */
const SLOT_FIELDS = ["id", "name", "scene", "track", "start", "duration", "anchor", "keys", "in", "out", "hidden", "locked", "fixed", "look", "frame", "meta"];

export function applyPatch(spec: MotionSpec, ops: PatchOp[]): PatchResult {
  const next: MotionSpec = structuredClone(spec);
  const changed = new Set<string>();
  ops.forEach((op, i) => applyOne(next, op, i, changed));
  const check = validateSpec(next);
  if (!check.ok) throw new SpecError(check.errors);
  return { spec: next, changed: [...changed], warnings: check.warnings };
}

function applyOne(spec: MotionSpec, op: PatchOp, i: number, changed: Set<string>) {
  const find = (id: string) => {
    const idx = spec.layers.findIndex((l) => l.id === id);
    if (idx < 0) throw new PatchError(i, `no layer with id "${id}". Existing ids: ${spec.layers.map((l) => l.id).join(", ")}`);
    return idx;
  };

  if (op.op === "template") {
    let r: ReturnType<typeof templateOps>;
    try {
      r = templateOps(spec, op.id, op.values ?? {}, op.at ?? 0);
    } catch (e) {
      throw new PatchError(i, (e as Error).message);
    }
    for (const sub of r.ops) applyOne(spec, sub, i, changed);
    return;
  }
  switch (op.op) {
    case "set": {
      const idx = find(op.id);
      if (op.path === "id") throw new PatchError(i, 'ids cannot be changed with "set"; use "replace" or "add"/"remove"');
      if (op.path === "type") throw new PatchError(i, 'use "swap" to change the type of a layer');
      setPath(spec.layers[idx] as unknown as Record<string, unknown>, op.path, op.value, i);
      changed.add(op.id);
      return;
    }
    case "setAt": {
      const layer = visual(spec.layers[find(op.id)], i);
      if (!ANIM_PROPS.includes(op.prop)) throw new PatchError(i, `"${op.prop}" is not animatable. Use one of: ${ANIM_PROPS.join(", ")}`);
      const timing = layerTiming(spec, layer);
      const rel = round(toRel(timing, op.t), 4);
      const list = layer.keys?.[op.prop];
      if (list && list.length > 0) {
        upsertKey(layer, op.prop, rel, op.value, op.ease, 1 / spec.canvas.fps);
      } else if (op.key) {
        const before = round(propAt(layer, op.prop, timing, op.t), 4);
        layer.keys = layer.keys ?? {};
        layer.keys[op.prop] = rel > 1e-6 ? [{ t: 0, v: before }, { t: rel, v: op.value, ...(op.ease ? { ease: op.ease } : {}) }] : [{ t: 0, v: op.value }];
      } else {
        (layer.frame as unknown as Record<string, number>)[op.prop] = op.value;
      }
      changed.add(op.id);
      return;
    }
    case "removeKey": {
      const layer = visual(spec.layers[find(op.id)], i);
      const timing = layerTiming(spec, layer);
      const rel = toRel(timing, op.t);
      const list = layer.keys?.[op.prop];
      if (!list) throw new PatchError(i, `layer "${op.id}" has no keys for "${op.prop}"`);
      const tol = 1 / spec.canvas.fps;
      const k = list.findIndex((key) => Math.abs(key.t - rel) <= tol);
      if (k < 0) throw new PatchError(i, `no "${op.prop}" key near ${op.t}s`);
      const removed = list.splice(k, 1)[0];
      if (list.length === 0) {
        delete layer.keys![op.prop];
        (layer.frame as unknown as Record<string, number>)[op.prop] = removed.v;
      }
      changed.add(op.id);
      return;
    }
    case "add": {
      if (spec.layers.some((l) => l.id === op.layer.id)) throw new PatchError(i, `layer id "${op.layer.id}" already exists`);
      const at = op.index ?? spec.layers.length;
      spec.layers.splice(Math.max(0, Math.min(at, spec.layers.length)), 0, structuredClone(op.layer));
      changed.add(op.layer.id);
      return;
    }
    case "remove": {
      spec.layers.splice(find(op.id), 1);
      changed.add(op.id);
      return;
    }
    case "replace": {
      const idx = find(op.id);
      spec.layers[idx] = { ...(structuredClone(op.layer) as Layer), id: op.id };
      changed.add(op.id);
      return;
    }
    case "swap": {
      const idx = find(op.id);
      const old = spec.layers[idx] as unknown as Record<string, unknown>;
      if (op.content.type === "audio" || old.type === "audio") throw new PatchError(i, "swap works between visual layers (text, shape, svg, image, video)");
      const slot: Record<string, unknown> = {};
      for (const f of SLOT_FIELDS) if (f in old) slot[f] = old[f];
      const fresh: Record<string, unknown> = { ...structuredClone(op.content) };
      for (const f of SLOT_FIELDS) delete fresh[f];
      spec.layers[idx] = { ...slot, ...fresh } as unknown as Layer;
      changed.add(op.id);
      return;
    }
    case "scene": {
      const scene = spec.scenes.find((s) => s.id === op.id);
      if (!scene) throw new PatchError(i, `no scene with id "${op.id}"`);
      const before = scene.duration;
      Object.assign(scene, op.set);
      // A shorter scene trims its layers, so nothing spills into the next scene (anchored layers keep their word timing).
      if (typeof op.set.duration === "number" && op.set.duration < before) {
        for (const l of spec.layers) {
          if (l.scene !== op.id || l.anchor || l.start + l.duration <= op.set.duration + 1e-6) continue;
          l.duration = Math.max(0.1, Math.round((op.set.duration - l.start) * 1000) / 1000);
          // Keyframes after the new end would never play.
          if (isVisual(l) && l.keys) for (const k of Object.keys(l.keys) as AnimProp[]) {
            const list = l.keys[k]!.filter((kf) => kf.t <= l.duration + 1e-6);
            if (list.length) l.keys[k] = list; else delete l.keys[k];
          }
        }
      }
      spec.layers.filter((l) => l.scene === op.id).forEach((l) => changed.add(l.id));
      return;
    }
    case "addScene": {
      if (spec.scenes.some((s) => s.id === op.scene.id)) throw new PatchError(i, `scene id "${op.scene.id}" already exists`);
      spec.scenes.splice(op.index ?? spec.scenes.length, 0, structuredClone(op.scene));
      return;
    }
    case "removeScene": {
      const idx = spec.scenes.findIndex((s) => s.id === op.id);
      if (idx < 0) throw new PatchError(i, `no scene with id "${op.id}"`);
      spec.scenes.splice(idx, 1);
      const inside = spec.layers.filter((l) => l.scene === op.id);
      if (op.removeLayers) spec.layers = spec.layers.filter((l) => l.scene !== op.id);
      else inside.forEach((l) => delete l.scene);
      inside.forEach((l) => changed.add(l.id));
      return;
    }
    case "camera": {
      if (op.set === null) delete spec.camera;
      else {
        if (!op.set || typeof op.set !== "object" || !op.set.keys) throw new PatchError(i, 'camera needs {"keys": {"zoom"|"x"|"y"|"rotation": [{"t": seconds, "v": value}]}} or null');
        spec.camera = structuredClone(op.set);
      }
      spec.layers.forEach((l) => changed.add(l.id));
      return;
    }
    case "style": {
      spec.style = { ...(spec.style ?? {}), ...structuredClone(op.set) };
      spec.layers.forEach((l) => changed.add(l.id));
      return;
    }
    case "canvas": {
      spec.canvas = { ...spec.canvas, ...op.set };
      spec.layers.forEach((l) => changed.add(l.id));
      return;
    }
    case "transcript": {
      const old = spec.transcript?.words ?? [];
      if (op.set === null) {
        delete spec.transcript;
        for (const l of spec.layers) if (l.anchor) delete l.anchor;
      } else {
        spec.transcript = structuredClone(op.set);
        const fresh = spec.transcript.words;
        for (const l of spec.layers) {
          if (!l.anchor || fresh.some((w) => w.id === l.anchor!.word)) continue;
          const was = old.find((w) => w.id === l.anchor!.word);
          const near = was && fresh.length ? fresh.reduce((a, b) => (Math.abs(b.t0 - was.t0) < Math.abs(a.t0 - was.t0) ? b : a)) : undefined;
          if (near) l.anchor.word = near.id;
          else delete l.anchor;
          changed.add(l.id);
        }
      }
      spec.layers.filter((l) => l.anchor).forEach((l) => changed.add(l.id));
      return;
    }
    case "word": {
      const w = spec.transcript?.words.find((x) => x.id === op.id);
      if (!w) throw new PatchError(i, `no word with id "${op.id}"`);
      w.text = op.text;
      return;
    }
    case "cut":
    case "uncut":
    case "cuts": {
      if (!spec.transcript) throw new PatchError(i, "no transcript: transcribe the recording first");
      if (op.op !== "cuts" && !(op.t1 > op.t0)) throw new PatchError(i, "t1 must be greater than t0");
      const cur = spec.transcript.cuts ?? [];
      const next = op.op === "cut" ? normalizeCuts([...cur, { t0: op.t0, t1: op.t1, reason: op.reason ?? "manual" }])
        : op.op === "uncut" ? subtractCut(cur, op.t0, op.t1) : normalizeCuts(op.set);
      if (next.length) spec.transcript.cuts = next;
      else delete spec.transcript.cuts;
      spec.layers.forEach((l) => changed.add(l.id));
      return;
    }
    case "meta": {
      // null removes a field (JSON has no undefined), e.g. {"brand": null} takes the brand off.
      spec.meta = { ...spec.meta, ...op.set } as MotionSpec["meta"];
      for (const [k, v] of Object.entries(op.set)) if (v === null || v === undefined) delete (spec.meta as Record<string, unknown>)[k];
      return;
    }
    default:
      throw new PatchError(i, `unknown op "${(op as { op: string }).op}"`);
  }
}

function visual(layer: Layer, i: number): VisualLayer {
  if (!isVisual(layer)) throw new PatchError(i, `layer "${layer.id}" is audio and has no frame`);
  return layer;
}

function upsertKey(layer: VisualLayer, prop: AnimProp, t: number, v: number, ease: Ease | undefined, tolerance: number) {
  const list = layer.keys![prop]!;
  const hit = list.find((k) => Math.abs(k.t - t) <= tolerance);
  if (hit) {
    hit.v = v;
    if (ease) hit.ease = ease;
    return;
  }
  list.push({ t: Math.max(0, t), v, ...(ease ? { ease } : {}) });
  list.sort((a, b) => a.t - b.t);
}

function setPath(target: Record<string, unknown>, path: string, value: unknown, i: number) {
  const parts = path.split(".");
  if (parts.some((p) => !p || p === "__proto__" || p === "constructor" || p === "prototype")) throw new PatchError(i, `invalid path "${path}"`);
  let node: Record<string, unknown> = target;
  for (let k = 0; k < parts.length - 1; k++) {
    const next = node[parts[k]];
    if (next === undefined) node[parts[k]] = {};
    else if (typeof next !== "object" || next === null) throw new PatchError(i, `"${parts.slice(0, k + 1).join(".")}" is not an object`);
    node = node[parts[k]] as Record<string, unknown>;
  }
  const last = parts[parts.length - 1];
  if (value === undefined || value === null) delete node[last];
  else node[last] = structuredClone(value);
}

const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;

/** Convenience for editors: current value of a property at time t (keys respected). */
export function valueAt(spec: MotionSpec, id: string, prop: AnimProp, t: number): number {
  const layer = spec.layers.find((l) => l.id === id);
  if (!layer || !isVisual(layer)) throw new Error(`no visual layer "${id}"`);
  return layer.keys?.[prop]?.length ? propAt(layer, prop, layerTiming(spec, layer), t) : baseValue(layer, prop);
}
