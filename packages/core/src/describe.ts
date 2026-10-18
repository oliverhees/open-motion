// describe(spec): a compact text map of the project for AI models.
// Gives a model just enough to target the right layer ids without reading raw JSON.

import { layerTiming, sceneTimings } from "./timing.ts";
import type { MotionSpec } from "./types.ts";

export function describe(spec: MotionSpec): string {
  const scenes = sceneTimings(spec);
  const lines: string[] = [];
  const c = spec.canvas;
  lines.push(`Project "${spec.meta.title}" — canvas ${c.width}×${c.height}, ${c.fps} fps${spec.meta.style ? `, style ${spec.meta.style}` : ""}`);
  if (spec.style?.palette) lines.push(`Palette: ${Object.entries(spec.style.palette).map(([k, v]) => `$${k}=${v}`).join(", ")}`);
  if (spec.style?.fonts?.length) lines.push(`Fonts: ${[...new Set(spec.style.fonts.map((x) => x.family))].join(", ")}`);
  if (c.texture) lines.push(`Texture: ${Object.entries(c.texture).map(([k, v]) => `${k} ${v}`).join(", ")}`);
  if (spec.camera) lines.push(`Camera keys: ${Object.entries(spec.camera.keys).map(([k, v]) => `${k} ${(v ?? []).map((x) => `${f(x.t)}s=${x.v}`).join("→")}`).join("; ")}`);
  lines.push("Scenes:");
  for (const s of spec.scenes) {
    const t = scenes.get(s.id)!;
    lines.push(`  ${s.id} "${s.name}" ${f(t.start)}–${f(t.end)}s${s.speed && s.speed !== 1 ? ` speed ${s.speed}×` : ""}`);
  }
  lines.push("Layers (higher track = on top):");
  const sorted = [...spec.layers].sort((a, b) => b.track - a.track);
  for (const l of sorted) {
    const t = layerTiming(spec, l, scenes);
    let line = `  [${l.track}] ${l.id} (${l.type}) ${f(t.start)}–${f(t.end)}s`;
    if (l.scene) line += ` scene ${l.scene}`;
    if (l.anchor) line += ` anchored to word ${l.anchor.word}`;
    if (l.type !== "audio") {
      const fr = l.frame;
      line += ` at ${Math.round(fr.x)},${Math.round(fr.y)} size ${Math.round(fr.w)}×${Math.round(fr.h)}`;
      const k = Object.keys(l.keys ?? {});
      if (k.length) line += ` keys: ${k.join(",")}`;
    }
    if (l.type === "text") line += l.count ? ` counter ${l.count.from}→${l.count.to}` : ` text "${clip(l.text)}"`;
    if (l.type === "text" && l.anim) line += ` anim ${l.anim.type}/${l.anim.by ?? "word"}`;
    if (l.type === "text" && l.style.fontFamily) line += ` font "${l.style.fontFamily}"`;
    if (l.type === "svg" && l.draw) line += " draws itself";
    if (l.type === "captions") line += ` captions ${l.words ?? 3} words/phrase`;
    if (l.type !== "audio" && l.look) line += ` look ${Object.keys(l.look).join(",")}`;
    if (l.fixed) line += " fixed";
    if (l.in) line += ` in:${l.in.type}`;
    if (l.out) line += ` out:${l.out.type}`;
    if (l.type === "image" || l.type === "video" || l.type === "audio") line += ` src ${l.src}`;
    if (l.type === "image" && l.source?.prompt) line += ` prompt "${clip(l.source.prompt)}"`;
    if (l.hidden) line += " (hidden)";
    if (l.meta?.placeholder) line += " (PLACEHOLDER: replace or remove when building)";
    lines.push(line);
  }
  if (spec.transcript?.words.length) {
    lines.push("Transcript words (id@seconds):");
    lines.push("  " + spec.transcript.words.map((w) => `${w.id}@${f(w.t0)} ${w.text}`).join(" | "));
  }
  return lines.join("\n");
}

const f = (v: number) => (Math.round(v * 100) / 100).toString();
const clip = (s: string) => (s.length > 60 ? `${s.slice(0, 57)}…` : s).replace(/\n/g, " ");
