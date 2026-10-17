// Easing: one implementation, used twice.
//  1. evaluate() uses the function directly (editor overlay, AI context, tests).
//  2. compile() turns the same function into CSS `linear(...)` for the browser.
// Same curve in preview, editor and final MP4. No animation library needed.

import type { Ease } from "./types.ts";

export type EaseFn = (p: number) => number;

const powerIn = (n: number): EaseFn => (p) => Math.pow(p, n + 1);
const powerOut = (n: number): EaseFn => (p) => 1 - Math.pow(1 - p, n + 1);
const powerInOut = (n: number): EaseFn => (p) =>
  p < 0.5 ? Math.pow(2 * p, n + 1) / 2 : 1 - Math.pow(2 * (1 - p), n + 1) / 2;

const backIn = (c: number): EaseFn => (p) => (c + 1) * p * p * p - c * p * p;
const backOut = (c: number): EaseFn => (p) => 1 + (c + 1) * Math.pow(p - 1, 3) + c * Math.pow(p - 1, 2);
const backInOut = (c: number): EaseFn => {
  const c2 = c * 1.525;
  return (p) =>
    p < 0.5
      ? (Math.pow(2 * p, 2) * ((c2 + 1) * 2 * p - c2)) / 2
      : (Math.pow(2 * p - 2, 2) * ((c2 + 1) * (p * 2 - 2) + c2) + 2) / 2;
};

const FAMILIES: Record<string, { in: EaseFn; out: EaseFn; inOut: EaseFn }> = {
  power0: { in: (p) => p, out: (p) => p, inOut: (p) => p },
  power1: { in: powerIn(1), out: powerOut(1), inOut: powerInOut(1) },
  power2: { in: powerIn(2), out: powerOut(2), inOut: powerInOut(2) },
  power3: { in: powerIn(3), out: powerOut(3), inOut: powerInOut(3) },
  power4: { in: powerIn(4), out: powerOut(4), inOut: powerInOut(4) },
  sine: {
    in: (p) => 1 - Math.cos((p * Math.PI) / 2),
    out: (p) => Math.sin((p * Math.PI) / 2),
    inOut: (p) => -(Math.cos(Math.PI * p) - 1) / 2,
  },
  expo: {
    in: (p) => (p === 0 ? 0 : Math.pow(2, 10 * p - 10)),
    out: (p) => (p === 1 ? 1 : 1 - Math.pow(2, -10 * p)),
    inOut: (p) =>
      p === 0 ? 0 : p === 1 ? 1 : p < 0.5 ? Math.pow(2, 20 * p - 10) / 2 : (2 - Math.pow(2, -20 * p + 10)) / 2,
  },
  circ: {
    in: (p) => 1 - Math.sqrt(1 - p * p),
    out: (p) => Math.sqrt(1 - Math.pow(p - 1, 2)),
    inOut: (p) =>
      p < 0.5 ? (1 - Math.sqrt(1 - Math.pow(2 * p, 2))) / 2 : (Math.sqrt(1 - Math.pow(-2 * p + 2, 2)) + 1) / 2,
  },
};

export const DEFAULT_EASE: Ease = "power2.inOut";

/** Parses names like "power2.inOut", "back.out(2)", "linear", "none". Unknown names throw. */
export function getEase(name: Ease = DEFAULT_EASE): EaseFn {
  const n = name.trim();
  if (n === "linear" || n === "none") return (p) => p;
  const back = /^back\.(in|out|inOut)(?:\(([\d.]+)\))?$/.exec(n);
  if (back) {
    const c = back[2] ? Number(back[2]) : 1.70158;
    return back[1] === "in" ? backIn(c) : back[1] === "out" ? backOut(c) : backInOut(c);
  }
  const m = /^(power[0-4]|sine|expo|circ)\.(in|out|inOut)$/.exec(n);
  if (m) return FAMILIES[m[1]][m[2] as "in" | "out" | "inOut"];
  throw new Error(`Unknown ease "${name}". Try "power2.inOut", "sine.out", "back.out" or "linear".`);
}

export function isValidEase(name: string): boolean {
  try {
    getEase(name);
    return true;
  } catch {
    return false;
  }
}

/** CSS easing string for Web Animations. Sampled `linear()` reproduces any curve, overshoot included. */
export function cssEasing(name: Ease = DEFAULT_EASE, samples = 32): string {
  if (name === "linear" || name === "none" || name === "power0.in" || name === "power0.out" || name === "power0.inOut") {
    return "linear";
  }
  const fn = getEase(name);
  const pts: string[] = [];
  for (let i = 0; i <= samples; i++) pts.push(String(Math.round(fn(i / samples) * 10000) / 10000));
  return `linear(${pts.join(", ")})`;
}
