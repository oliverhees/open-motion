// Ready-made building blocks the editor and AI use a lot.

import type { AudioLayer, Frame, MotionSpec, VideoLayer } from "./types.ts";

export type FacecamLayout = "full" | "right" | "corner" | "split" | "circle";

/** Facecam positions relative to the canvas. "corner" = small, bottom right. */
export function facecamFrame(layout: FacecamLayout, canvas: MotionSpec["canvas"]): Frame {
  const { width: W, height: H } = canvas;
  const m = Math.round(Math.min(W, H) * 0.04);
  switch (layout) {
    case "full":
      return { x: 0, y: 0, w: W, h: H };
    case "right":
      return { x: Math.round(W * 0.54), y: m * 3, w: Math.round(W * 0.42), h: H - m * 6 };
    case "corner": {
      const w = Math.round(W * 0.2);
      const h = Math.round(w * 0.8);
      return { x: W - w - m, y: H - h - m, w, h };
    }
    case "circle": {
      const d = Math.round(Math.min(W, H) * 0.28);
      return { x: W - d - m, y: H - d - m, w: d, h: d };
    }
    case "split":
      return { x: Math.round(W / 2), y: 0, w: Math.round(W / 2), h: H };
  }
}

/**
 * A facecam = muted video layer + its sound on a separate audio layer ("detached audio").
 * Lets you move/scale the picture freely and mix the voice independently.
 */
export function facecamLayers(opts: {
  id?: string;
  src: string;
  duration: number;
  canvas: MotionSpec["canvas"];
  layout?: FacecamLayout;
  start?: number;
  mediaStart?: number;
  track?: number;
}): [VideoLayer, AudioLayer] {
  const id = opts.id ?? "facecam";
  const layout = opts.layout ?? "right";
  const track = opts.track ?? 50;
  const video: VideoLayer = {
    id,
    name: "Facecam",
    type: "video",
    track,
    start: opts.start ?? 0,
    duration: opts.duration,
    src: opts.src,
    fit: "cover",
    radius: layout === "circle" ? 9999 : 28,
    muted: true,
    frame: facecamFrame(layout, opts.canvas),
    source: { kind: "recording" },
    ...(opts.mediaStart ? { mediaStart: opts.mediaStart } : {}),
  };
  const audio: AudioLayer = {
    id: `${id}-audio`,
    name: "Facecam-Ton",
    type: "audio",
    track: track + 1,
    start: opts.start ?? 0,
    duration: opts.duration,
    src: opts.src,
    volume: 1,
    ...(opts.mediaStart ? { mediaStart: opts.mediaStart } : {}),
  };
  return [video, audio];
}
