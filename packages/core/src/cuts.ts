// Text-based cutting. Cuts are ranges of the SOURCE recording that are skipped.
// Every layer that plays the transcript's recording (facecam video + its detached audio)
// is split into kept segments; anchors and the transcript map through the same segments.

import type { Cut, Layer, MotionSpec, Transcript } from "./types.ts";

/** Sorted, merged, valid cuts. */
export function normalizeCuts(cuts: Cut[] | undefined): Cut[] {
  const list = (cuts ?? []).filter((c) => c.t1 - c.t0 > 1e-4).map((c) => ({ ...c })).sort((a, b) => a.t0 - b.t0);
  const out: Cut[] = [];
  for (const c of list) {
    const last = out[out.length - 1];
    if (last && c.t0 <= last.t1 + 1e-4) {
      last.t1 = Math.max(last.t1, c.t1);
      if (last.reason !== c.reason) last.reason = "manual";
    } else out.push(c);
  }
  return out.map((c) => ({ t0: r3(c.t0), t1: r3(c.t1), ...(c.reason ? { reason: c.reason } : {}) }));
}

/** Seconds removed from the source between a and b. */
export function removedBetween(cuts: Cut[], a: number, b: number): number {
  let sum = 0;
  for (const c of cuts) sum += Math.max(0, Math.min(b, c.t1) - Math.max(a, c.t0));
  return sum;
}

/** Does this layer play the cut recording? (video or audio with the transcript's src, not anchored) */
export function isCutLayer(spec: MotionSpec, layer: Layer): layer is Extract<Layer, { type: "video" | "audio" }> {
  const t = spec.transcript;
  return !!t?.source && !!t.cuts?.length && (layer.type === "video" || layer.type === "audio") && layer.src === t.source && !layer.anchor;
}

export interface Segment {
  /** Source seconds. */
  src0: number;
  src1: number;
  /** Offset from the layer start on the composition timeline. */
  rel0: number;
}

/** Kept pieces of a cut layer, in play order. */
export function keptSegments(spec: MotionSpec, layer: Extract<Layer, { type: "video" | "audio" }>): Segment[] {
  const m0 = layer.mediaStart ?? 0;
  const m1 = m0 + layer.duration;
  const cuts = normalizeCuts(spec.transcript?.cuts).filter((c) => c.t1 > m0 && c.t0 < m1);
  const out: Segment[] = [];
  let cursor = m0;
  let rel = 0;
  for (const c of cuts) {
    const a = Math.max(m0, c.t0);
    if (a - cursor > 1e-4) {
      out.push({ src0: cursor, src1: a, rel0: rel });
      rel += a - cursor;
    }
    cursor = Math.max(cursor, Math.min(m1, c.t1));
  }
  if (m1 - cursor > 1e-4) out.push({ src0: cursor, src1: m1, rel0: rel });
  return out.map((s) => ({ src0: r3(s.src0), src1: r3(s.src1), rel0: r3(s.rel0) }));
}

export interface Suggestion {
  kind: "filler" | "pause";
  t0: number;
  t1: number;
  words?: string[];
  label: string;
}

const FILLER = /^(ä+h*m*|ä+m+|ö+h+m*|e+h+m+|h+m+|m+h*m+|u+h+m*|u+m+|e+r+m+|a+h+m*)[.,!?…]*$/i;

/** Filler words and long pauses that are not cut yet. */
export function findSuggestions(t: Transcript | undefined, opts: { pauseMin?: number; pauseKeep?: number } = {}): Suggestion[] {
  if (!t?.words.length) return [];
  const pauseMin = opts.pauseMin ?? 0.7;
  const keep = opts.pauseKeep ?? 0.3;
  const cuts = normalizeCuts(t.cuts);
  const isCut = (a: number, b: number) => removedBetween(cuts, a, b) >= (b - a) * 0.9;
  const out: Suggestion[] = [];
  const w = t.words;
  for (let i = 0; i < w.length; i++) {
    if (FILLER.test(w[i].text.trim())) {
      const t1 = i + 1 < w.length ? w[i + 1].t0 : w[i].t1;
      if (!isCut(w[i].t0, t1)) out.push({ kind: "filler", t0: w[i].t0, t1, words: [w[i].id], label: w[i].text });
    }
    if (i + 1 < w.length) {
      const gap = w[i + 1].t0 - w[i].t1;
      if (gap >= pauseMin) {
        const a = r3(w[i].t1 + keep / 2);
        const b = r3(w[i + 1].t0 - keep / 2);
        if (b > a && !isCut(a, b)) out.push({ kind: "pause", t0: a, t1: b, label: `${gap.toFixed(1)} s` });
      }
    }
  }
  return out.sort((a, b) => a.t0 - b.t0);
}

/** Range a word occupies including the gap after it (what gets removed when you delete the word). */
export function wordRange(t: Transcript, wordId: string): { t0: number; t1: number } | undefined {
  const i = t.words.findIndex((w) => w.id === wordId);
  if (i < 0) return undefined;
  const w = t.words[i];
  return { t0: w.t0, t1: i + 1 < t.words.length ? t.words[i + 1].t0 : w.t1 };
}

export function isWordCut(t: Transcript, wordId: string): boolean {
  const w = t.words.find((x) => x.id === wordId);
  if (!w) return false;
  return removedBetween(normalizeCuts(t.cuts), w.t0, w.t1) >= (w.t1 - w.t0) * 0.6 || (w.t1 - w.t0 < 1e-3 && normalizeCuts(t.cuts).some((c) => w.t0 >= c.t0 && w.t0 < c.t1));
}

/** Subtract [a,b] from cuts (restore). */
export function subtractCut(cuts: Cut[], a: number, b: number): Cut[] {
  const out: Cut[] = [];
  for (const c of normalizeCuts(cuts)) {
    if (c.t1 <= a || c.t0 >= b) out.push(c);
    else {
      if (c.t0 < a) out.push({ ...c, t1: a });
      if (c.t1 > b) out.push({ ...c, t0: b });
    }
  }
  return normalizeCuts(out);
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;
