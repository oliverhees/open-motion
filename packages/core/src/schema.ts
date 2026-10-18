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
  .object({
    x: num, y: num, w: pos, h: pos, rotation: num.optional(), scale: nonneg.optional(), opacity: num.min(0).max(1).optional(),
    blur: nonneg.optional(), rotateX: num.optional(), rotateY: num.optional(),
  })
  .strict();

const keyframe = z.object({ t: nonneg, v: num, ease: ease.optional() }).strict();
const keyList = z.array(keyframe).optional();
const keys = z
  .object({ x: keyList, y: keyList, w: keyList, h: keyList, rotation: keyList, scale: keyList, opacity: keyList, blur: keyList, rotateX: keyList, rotateY: keyList })
  .strict();

export const TRANSITIONS = ["fade", "slideUp", "slideDown", "slideLeft", "slideRight", "pop", "wipe", "blur", "wipeLeft", "wipeUp", "wipeDown", "maskUp", "iris", "zoomIn", "zoomOut"] as const;
const transition = z
  .object({
    type: z.enum(TRANSITIONS),
    duration: pos.optional(),
    ease: ease.optional(),
    distance: num.optional(),
  })
  .strict();

/** CSS-ish strings the AI writes go straight into style attributes: block anything that could break out. */
const cssText = z.string().max(400).refine((v) => !/[;{}<>]|url\s*\(|expression|javascript:/i.test(v), { message: "plain CSS value only (no ; { } < > url() )" });

const look = z
  .object({ shadow: cssText.optional(), glow: cssText.optional(), glowSize: nonneg.optional(), blend: z.enum(["normal", "multiply", "screen", "overlay", "darken", "lighten", "color-dodge", "color-burn", "hard-light", "soft-light", "difference", "exclusion", "hue", "saturation", "color", "luminosity", "plus-lighter"]).optional(), glass: nonneg.optional() })
  .strict();

const textAnim = z
  .object({
    by: z.enum(["word", "char", "line"]).optional(),
    type: z.enum(["rise", "fade", "blur", "pop", "mask", "drop", "slide", "type"]),
    stagger: nonneg.optional(),
    duration: pos.optional(),
    ease: ease.optional(),
    order: z.enum(["start", "center", "end", "random"]).optional(),
    delay: nonneg.optional(),
  })
  .strict();

const count = z
  .object({
    from: num, to: num, decimals: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional(), duration: pos.optional(), delay: nonneg.optional(),
    ease: ease.optional(), prefix: z.string().max(40).optional(), suffix: z.string().max(40).optional(), point: z.string().max(2).optional(),
  })
  .strict();

const draw = z.object({ duration: pos.optional(), stagger: nonneg.optional(), delay: nonneg.optional(), ease: ease.optional() }).strict();

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
  fixed: z.boolean().optional(),
  meta: z.record(z.unknown()).optional(),
};

const fit = z.enum(["cover", "contain", "fill"]).optional();

const textStyle = z
  .object({
    fontFamily: z.string().max(120).refine((v) => !/[;{}<>]/.test(v), { message: "font family name only" }).optional(),
    fontSize: pos,
    fontWeight: z.number().int().min(100).max(1000).optional(),
    italic: z.boolean().optional(),
    color: color.optional(),
    align: z.enum(["left", "center", "right"]).optional(),
    valign: z.enum(["top", "middle", "center", "bottom"]).optional(),
    lineHeight: pos.optional(),
    letterSpacing: num.optional(),
    uppercase: z.boolean().optional(),
    background: color.optional(),
    padding: nonneg.optional(),
    radius: nonneg.optional(),
    gradient: cssText.optional(),
    highlight: color.optional(),
    marker: color.optional(),
  })
  .strict();

export const layerSchema = z.discriminatedUnion("type", [
  z
    .object({
      ...common,
      type: z.literal("text"),
      frame,
      text: z.string(),
      style: textStyle,
      look: look.optional(),
      anim: textAnim.optional(),
      count: count.optional(),
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
      look: look.optional(),
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
      look: look.optional(),
      draw: draw.optional(),
    })
    .strict(),
  z
    .object({ ...common, type: z.literal("image"), frame, src: z.string().min(1), fit, radius: nonneg.optional(), source: source.optional(), look: look.optional() })
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
      look: look.optional(),
    })
    .strict(),
  z
    .object({
      ...common,
      type: z.literal("captions"),
      frame,
      style: textStyle,
      words: z.number().int().min(1).max(12).optional(),
      active: z.object({ color: color.optional(), background: color.optional(), scale: num.min(0.5).max(2).optional() }).strict().optional(),
      look: look.optional(),
    })
    .strict(),
  z
    .object({ ...common, type: z.literal("audio"), src: z.string().min(1), mediaStart: nonneg.optional(), volume: num.min(0).max(4).optional() })
    .strict(),
]);

export const specSchema = z
  .object({
    version: z.literal(1),
    meta: z.object({
      title: z.string(), lang: z.string().optional(), style: z.string().max(40).optional(), brief: z.string().max(6000).optional(),
      brand: z.object({
        id: z.string().max(80), name: z.string().max(120), logo: z.string().max(300).optional(), logoAspect: num.positive().optional(),
        tagline: z.string().max(300).optional(), website: z.string().max(300).optional(), handle: z.string().max(120).optional(),
        display: z.string().max(120).optional(), body: z.string().max(120).optional(),
        prev: z.object({ palette: z.record(z.string()).optional(), background: z.string().optional(), display: z.string().optional(), body: z.string().optional(), weights: z.record(num).optional(), sizes: z.record(num).optional() }).strict().optional(),
      }).strict().optional(),
    }).strict(),
    canvas: z
      .object({
        width: z.number().int().min(16).max(7680), height: z.number().int().min(16).max(7680), fps: z.number().int().min(1).max(120), background: color.optional(),
        texture: z.object({ grain: num.min(0).max(1).optional(), vignette: num.min(0).max(1).optional(), scanlines: num.min(0).max(1).optional() }).strict().optional(),
      })
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
    camera: z
      .object({ keys: z.object({ zoom: keyList, x: keyList, y: keyList, rotation: keyList }).strict() })
      .strict()
      .optional(),
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
    if (layer.type === "captions" && !spec.transcript?.words.length) warnings.push(`${where}: captions need a transcript; transcribe the recording first`);
    if (layer.type === "text" && layer.count && layer.anim) warnings.push(`${where}: "count" replaces the text, so "anim" is ignored`);
    if (layer.type === "text" && /\[\[[^\]]*$|^[^[]*\]\]/.test(layer.text)) warnings.push(`${where}: unbalanced [[ ]] highlight brackets in text`);
  }
  for (const [prop, list] of Object.entries(spec.camera?.keys ?? {})) {
    for (let i = 1; i < (list?.length ?? 0); i++) {
      if (list![i].t <= list![i - 1].t) errors.push(`camera.keys.${prop} must be sorted by t with no duplicates (index ${i})`);
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

/** Every "$name" palette reference of a layer, also inside gradients and shadows. */
function colorsOf(layer: MotionSpec["layers"][number]): string[] {
  const vals: (string | undefined)[] = [];
  if (layer.type === "text" || layer.type === "captions") vals.push(layer.style.color, layer.style.background, layer.style.gradient, layer.style.highlight, layer.style.marker);
  if (layer.type === "captions") vals.push(layer.active?.color, layer.active?.background);
  if (layer.type === "shape") vals.push(layer.fill, layer.stroke);
  if (layer.type !== "audio") vals.push(layer.look?.shadow, layer.look?.glow);
  return vals.flatMap((v) => (v ? v.match(/\$[a-z][a-z0-9-]*/g) ?? [] : []));
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
