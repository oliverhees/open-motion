#!/usr/bin/env node
// openmotion — command line.
//   openmotion validate <spec.json>
//   openmotion describe <spec.json>
//   openmotion compile  <spec.json> -o <dir> [--scale 0.5]
//   openmotion render   <spec.json> -o <file.mp4> [--height 720] [--fps 30] [--quality medium] [--format mp4|gif] [--sharp]
//   openmotion patch    <spec.json> <ops.json> [-o <out.json>]

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { applyPatch, backgroundLayers, describe, LOTTIE_HINTS as LOTTIE_HINT, validateSpec, type MotionSpec, type PatchOp } from "@openmotion/core";
import { buildComposition } from "./build.ts";
import { estimate, renderVideo, type ExportFormat } from "./render.ts";

const HELP = `OpenMotion — every element is a live-editable layer.

Usage:
  openmotion validate <spec.json>
  openmotion describe <spec.json>
  openmotion compile  <spec.json> -o <dir> [--scale 0.5]
  openmotion render   <spec.json> -o <video.mp4> [--height 720|1080] [--fps 30] [--quality high|medium|low] [--format mp4|gif|webm|mov|lottie] [--keep-bg] [--hide id,id] [--sharp] [--keep]
  openmotion patch    <spec.json> <ops.json> [-o <out.json>]
`;

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      out: { type: "string", short: "o" },
      scale: { type: "string" },
      height: { type: "string" },
      fps: { type: "string" },
      quality: { type: "string" },
      format: { type: "string" },
      sharp: { type: "boolean" },
      "keep-bg": { type: "boolean" },
      hide: { type: "string" },
      keep: { type: "boolean" },
      verbose: { type: "boolean", short: "v" },
      help: { type: "boolean", short: "h" },
    },
  });
  const [cmd, specPath, extra] = positionals;
  if (values.help || !cmd || !specPath) {
    process.stdout.write(HELP);
    process.exit(cmd ? 1 : 0);
  }
  const spec = JSON.parse(await readFile(specPath, "utf8")) as MotionSpec;
  const specDir = path.dirname(path.resolve(specPath));

  switch (cmd) {
    case "validate": {
      const r = validateSpec(spec);
      r.warnings.forEach((w) => console.log(`⚠ ${w}`));
      r.errors.forEach((e) => console.log(`✗ ${e}`));
      console.log(r.ok ? "✓ Spec ist gültig." : `✗ ${r.errors.length} Fehler.`);
      process.exit(r.ok ? 0 : 1);
    }
    case "describe":
      console.log(describe(spec));
      return;
    case "compile": {
      if (!values.out) throw new Error("compile needs -o <dir>");
      const r = await buildComposition(spec, { specDir, outDir: values.out, scale: values.scale ? Number(values.scale) : 1 });
      r.warnings.forEach((w) => console.log(`⚠ ${w}`));
      console.log(`✓ ${r.dir}/index.html  ${r.width}×${r.height}, ${r.duration}s, ${r.assets.length} assets`);
      return;
    }
    case "render": {
      if (!values.out) throw new Error("render needs -o <file>");
      const opts = {
        specDir,
        output: values.out,
        height: values.height ? Number(values.height) : undefined,
        fps: values.fps ? Number(values.fps) : undefined,
        quality: (values.quality as "high" | "medium" | "low" | undefined) ?? "medium",
        format: (values.format as ExportFormat | undefined) ?? "mp4",
        // webm/mov/lottie: transparent, full-canvas shapes hidden (like the editor), unless --keep-bg.
        transparent: !values["keep-bg"],
        hide: values.hide !== undefined ? values.hide.split(",").map((x) => x.trim()).filter(Boolean)
          : ["webm", "mov", "lottie"].includes(values.format ?? "") && !values["keep-bg"] ? backgroundLayers(spec).filter((b) => b.hideByDefault).map((b) => b.id) : undefined,
        sharpText: values.sharp,
        keepBuild: values.keep,
        onLog: values.verbose ? (l: string) => console.log(`  ${l}`) : undefined,
      };
      const est = await estimate(spec, opts);
      console.log(`… ${est.plan.reason}`);
      console.log(`… rendere ${est.frames} Bilder (Schätzung: ~${est.seconds < 90 ? `${est.seconds} s` : `${Math.round(est.seconds / 60)} min`})`);
      const r = await renderVideo(spec, opts);
      for (const w of r.warnings ?? []) console.log(`⚠ Lottie: ${LOTTIE_HINT[w.code]}${w.layers.length ? ` (${w.layers.join(", ")})` : ""}`);
      console.log(`✓ ${r.output}  ${r.width}×${r.height}, ${r.duration}s, fertig in ${r.seconds}s mit ${r.plan.workers} Worker(n)`);
      return;
    }
    case "patch": {
      if (!extra) throw new Error("patch needs <ops.json>");
      const ops = JSON.parse(await readFile(extra, "utf8")) as PatchOp[];
      const r = applyPatch(spec, Array.isArray(ops) ? ops : [ops]);
      const out = values.out ?? specPath;
      await writeFile(out, JSON.stringify(r.spec, null, 2) + "\n", "utf8");
      console.log(`✓ ${ops.length} Änderung(en), betroffen: ${r.changed.join(", ") || "–"} → ${out}`);
      return;
    }
    default:
      process.stdout.write(HELP);
      process.exit(1);
  }
}

main().catch((err: Error) => {
  console.error(`✗ ${err.message}`);
  process.exit(1);
});
