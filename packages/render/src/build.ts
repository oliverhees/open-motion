// buildComposition(): writes a HyperFrames project folder from a Motion-Spec.
//   <outDir>/index.html   compiled composition
//   <outDir>/assets/...   every referenced file, copied from next to the spec

import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { compile, type CompileResult, type MotionSpec } from "@openmotion/core";

export interface BuildOptions {
  /** Folder the spec's relative asset paths are resolved from. */
  specDir: string;
  outDir: string;
  scale?: number;
  clean?: boolean;
  /** Layer id → relative path of a pre-cut audio file inside the composition. */
  audioOverrides?: Record<string, string>;
  /** Relative path in the composition → absolute file to copy there. */
  extraFiles?: Record<string, string>;
}

export async function buildComposition(spec: MotionSpec, opts: BuildOptions): Promise<CompileResult & { dir: string }> {
  const result = compile(spec, { scale: opts.scale ?? 1, audioOverrides: opts.audioOverrides });
  if (opts.clean !== false) await rm(opts.outDir, { recursive: true, force: true });
  await mkdir(opts.outDir, { recursive: true });
  const missing: string[] = [];
  for (const rel of result.assets) {
    const from = path.resolve(opts.specDir, rel);
    const to = path.resolve(opts.outDir, rel);
    if (!to.startsWith(path.resolve(opts.outDir) + path.sep)) throw new Error(`Asset path leaves the project folder: ${rel}`);
    if (!existsSync(from)) {
      missing.push(rel);
      continue;
    }
    await mkdir(path.dirname(to), { recursive: true });
    await copyFile(from, to);
  }
  for (const [rel, abs] of Object.entries(opts.extraFiles ?? {})) {
    const to = path.resolve(opts.outDir, rel);
    await mkdir(path.dirname(to), { recursive: true });
    await copyFile(abs, to);
  }
  if (missing.length) throw new Error(`Missing assets (relative to ${opts.specDir}):\n- ${missing.join("\n- ")}`);
  await writeFile(path.join(opts.outDir, "index.html"), result.html, "utf8");
  return { ...result, dir: opts.outDir };
}
