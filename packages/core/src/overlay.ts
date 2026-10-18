// Transparent exports (WebM/MOV with alpha, Lottie): which layers are "the background"?
// Full-canvas areas are candidates. Plain shapes (color or gradient fills) are hidden by default,
// full-canvas images and videos are offered but kept, because they are often the content itself.

import { isVisual, type MotionSpec } from "./types.ts";

export interface BackgroundCandidate { id: string; name: string; type: string; hideByDefault: boolean }

export function backgroundLayers(spec: MotionSpec): BackgroundCandidate[] {
  const W = spec.canvas.width;
  const H = spec.canvas.height;
  return spec.layers.flatMap((l) => {
    if (!isVisual(l) || l.hidden) return [];
    if (l.type !== "shape" && l.type !== "image" && l.type !== "video") return [];
    const f = l.frame;
    const x0 = Math.max(0, f.x);
    const y0 = Math.max(0, f.y);
    const x1 = Math.min(W, f.x + f.w);
    const y1 = Math.min(H, f.y + f.h);
    const covered = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
    if (covered < W * H * 0.9 || (l.type === "shape" && l.shape !== "rect")) return [];
    return [{ id: l.id, name: l.name ?? l.id, type: l.type, hideByDefault: l.type === "shape" }];
  });
}
