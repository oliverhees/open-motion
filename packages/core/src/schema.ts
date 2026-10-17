// Runtime validation for the Motion-Spec.
// Two layers of checks:
//   1. Shape (zod): right fields, right types.
//   2. Meaning (validateSpec): unique ids, scene references, anchors, sorted keys …
// Error messages are written so an AI model can read them and fix its own patch.

import { z } from "zod";
import { isValidEase } from "./ease.ts";
import type { MotionSpec } from "./types.ts";

const id = z.string().regex(/^[A-Za-z][\w-]{0,63}$/, "ids start with a letter; letters, digits, _ and - only");
const ease = z.string().refine(isValidEase, { message: "unknown ease name" });
const num = z.number().finite();
const pos = num.positive();
const nonneg = num.nonnegative();
const color = z.string().min(1);

const frame = z
  .object({ x: num, y: num, w: pos, h: pos, rotation: num.optional(), scale: nonneg.optional(), opacity: num.min(0).max(1).optional() })
  .strict();

const keyframe = z.object({ t: nonneg, v: num, ease: ease.optional() }).strict();
const keys = z
  .object({
    x: z.array(keyframe).optional(),
    y: z.array(keyframe).optional(),
    w: z.array(keyframe).optional(),
    h: z.array(keyframe).optional(),
    rotation: z.array(keyframe).optional(),
    scale: z.array(keyframe).optional(),
    opacity: z.array(keyframe).optional(),
  })
  .strict();

const transition = z
  .object({
    type: z.enum(["fade", "slideUp", "slideDown", "slideLeft", "slideRight", "pop", "wipe", "blur"]),
    duration: pos.optional(),
    ease: ease.optional(),
    distance: num.optional(),
  })
  .strict();

const source = z
  .object({ kind: z.enum(["upload", "ai", "recording", "url"]), prompt: z.string().optional(), model: z.string().optional() })
  .strict();

const common = {
  id,
  name: z.string().optional(),
  scene: id.optional(),
  track: z.number().int().min(0).max(999),
  start: nonneg,
  duration: pos,
  anchor: z.object({ word: id, offset: num.optional() }).strict().optional(),
  keys: keys.optional(),
  in: transition.optional(),
  out: transition.optional(),
  hidden: z.boolean().optional(),
  locked: z.boolean().optional(),
  meta: z.record(z.unknown()).optional(),
};

const fit = z.enum(["cover", "contain", "fill"]).optional();

export const layerSchema = z.discriminatedUnion("type", [
  z
    .object({
      ...common,
      type: z.literal("text"),
      frame,
      text: z.string(),
      style: z
        .object({
          fontFamily: z.string().optional(),
          fontSize: pos,
          fontWeight: z.number().int().min(100).max(1000).optional(),
          italic: z.boolean().optional(),
          color: color.optional(),
          align: z.enum(["left", "center", "right"]).optional(),
          valign: z.enum(["top", "middle", "bottom"]).optional(),
          lineHeight: pos.optional(),
          letterSpacing: num.optional(),
          uppercase: z.boolean().optional(),
          background: color.optional(),
          padding: nonneg.optional(),
          radius: nonneg.optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...common,
      type: z.literal("shape"),
      frame,
      shape: z.enum(["rect", "ellipse"]),
      fill: color.optional(),
      stroke: color.optional(),
      strokeWidth: nonneg.optional(),
      radius: nonneg.optional(),
    })
    .strict(),
  z
    .object({
      ...common,
      type: z.literal("svg"),
      frame,
      svg: z.string().max(200_000),
      viewBox: z.string().regex(/^-?[\d.]+ -?[\d.]+ [\d.]+ [\d.]+$/, 'viewBox looks like "0 0 400 300"').optional(),
      preserveAspectRatio: z.string().optional(),
    })
    .strict(),
  z
    .object({ ...common, type: z.literal("image"), frame, src: z.string().min(1), fit, radius: nonneg.optional(), source: source.optional() })
    .strict(),
  z
    .object({
      ...common,
      type: z.literal("video"),
      frame,
      src: z.string().min(1),
      fit,
      radius: nonneg.optional(),
      mediaStart: nonneg.optional(),
      muted: z.boolean().optional(),
      volume: num.min(0).max(4).optional(),
      source: source.optional(),
    })
    .strict(),
  z
    .object({ ...common, type: z.literal("audio"), src: z.string().min(1), mediaStart: nonneg.optional(), volume: num.min(0).max(4).optional() })
    .strict(),
]);

export const specSchema = z
  .object({
    version: z.literal(1),
    meta: z.object({ title: z.string(), lang: z.string().optional() }).strict(),
    canvas: z
      .object({ width: z.number().int().min(16).max(7680), height: z.number().int().min(16).max(7680), fps: z.number().int().min(1).max(120), background: color.optional() })
      .strict(),
    style: z
      .object({
        palette: z.record(z.string().regex(/^[a-z][a-z0-9-]*$/, "palette names: lowercase, digits, -"), color).optional(),
        fonts: z
          .array(z.object({ family: z.string(), src: z.string(), weight: z.union([z.number(), z.string()]).optional(), style: z.enum(["normal", "italic"]).optional() }).strict())
          .optional(),
      })
      .strict()
      .optional(),
    scenes: z.array(z.object({ id, name: z.string(), duration: pos, speed: pos.optional() }).strict()),
    layers: z.array(layerSchema),
    transcript: z
      .object({
        source: z.string().optional(),
        language: z.string().optional(),
        provider: z.string().optional(),
        words: z.array(z.object({ id, text: z.string(), t0: nonneg, t1: nonneg }).strict()),
        cuts: z.array(z.object({ t0: nonneg, t1: nonneg, reason: z.enum(["manual", "filler", "pause"]).optional() }).strict()).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

/** Full check: shape + meaning. Never throws. */
export function validateSpec(input: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const parsed = specSchema.safeParse(input);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) errors.push(`${formatPath(input, issue.path)}: ${issue.message}`);
    return { ok: false, errors, warnings };
  }
  const spec = parsed.data as MotionSpec;

  const sceneIds = new Set<string>();
  for (const s of spec.scenes) {
    if (sceneIds.has(s.id)) errors.push(`scenes: duplicate scene id "${s.id}"`);
    sceneIds.add(s.id);
  }
  const wordIds = new Set((spec.transcript?.words ?? []).map((w) => w.id));
  const palette = spec.style?.palette ?? {};
  const layerIds = new Set<string>();

  for (const layer of spec.layers) {
    const where = `layer "${layer.id}"`;
    if (layerIds.has(layer.id)) errors.push(`${where}: duplicate layer id`);
    layerIds.add(layer.id);
    if (layer.scene && !sceneIds.has(layer.scene)) errors.push(`${where}: scene "${layer.scene}" does not exist`);
    if (layer.anchor && !wordIds.has(layer.anchor.word)) errors.push(`${where}: anchor word "${layer.anchor.word}" is not in transcript.words`);
    for (const [prop, list] of Object.entries(layer.keys ?? {})) {
      if (!list || list.length === 0) continue;
      for (let i = 1; i < list.length; i++) {
        if (list[i].t <= list[i - 1].t) errors.push(`${where}: keys.${prop} must be sorted by t with no duplicates (index ${i})`);
      }
      const last = list[list.length - 1].t;
      if (last > layer.duration + 1e-6) warnings.push(`${where}: keys.${prop} has a key at ${last}s, after the layer ends (${layer.duration}s)`);
    }
    for (const c of colorsOf(layer)) {
      if (c.startsWith("$") && !(c.slice(1) in palette)) errors.push(`${where}: color "${c}" is not in style.palette`);
    }
    if (layer.scene) {
      const scene = spec.scenes.find((s) => s.id === layer.scene);
      if (scene && !layer.anchor && layer.start + layer.duration > scene.duration + 1e-6) {
        warnings.push(`${where}: runs past the end of scene "${scene.id}" (${scene.duration}s)`);
      }
    }
    if (layer.type === "svg" && /<\s*script|on\w+\s*=|javascript:/i.test(layer.svg)) {
      warnings.push(`${where}: svg contains scripts or event handlers; they will be removed`);
    }
  }
  return { ok: errors.length === 0, errors, warnings };
}

/** Throws one readable error listing every problem. */
export function assertValidSpec(input: unknown): MotionSpec {
  const r = validateSpec(input);
  if (!r.ok) throw new SpecError(r.errors);
  return input as MotionSpec;
}

export class SpecError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(`Invalid Motion-Spec:\n- ${problems.join("\n- ")}`);
    this.name = "SpecError";
    this.problems = problems;
  }
}

function colorsOf(layer: MotionSpec["layers"][number]): string[] {
  const out: string[] = [];
  if (layer.type === "text") {
    if (layer.style.color) out.push(layer.style.color);
    if (layer.style.background) out.push(layer.style.background);
  }
  if (layer.type === "shape") {
    if (layer.fill) out.push(layer.fill);
    if (layer.stroke) out.push(layer.stroke);
  }
  return out;
}

/** Turns ["layers", 3, "frame", "w"] into `layers[3] (id "cam").frame.w`. */
function formatPath(input: unknown, path: (string | number)[]): string {
  let out = "";
  let node: unknown = input;
  for (const seg of path) {
    if (typeof seg === "number") {
      out += `[${seg}]`;
      node = Array.isArray(node) ? node[seg] : undefined;
      const nid = node && typeof node === "object" && "id" in node ? (node as { id: unknown }).id : undefined;
      if (typeof nid === "string") out += ` (id "${nid}")`;
    } else {
      out += out ? `.${seg}` : seg;
      node = node && typeof node === "object" ? (node as Record<string, unknown>)[seg] : undefined;
    }
  }
  return out || "spec";
}
