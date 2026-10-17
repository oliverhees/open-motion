// OpenMotion — Motion-Spec types.
//
// One idea runs through everything: every element is a LAYER.
// A layer = frame (where/how big) + content (what) + time (when).
// Editor, AI and renderer all read and write this one structure.

/** Easing name, GSAP-style syntax: "linear", "power2.inOut", "back.out", "sine.in" … */
export type Ease = string;

/** Numeric layer properties that can be keyframed. */
export type AnimProp = "x" | "y" | "w" | "h" | "rotation" | "scale" | "opacity";
export const ANIM_PROPS: readonly AnimProp[] = ["x", "y", "w", "h", "rotation", "scale", "opacity"];

/** A keyframe. `t` is seconds relative to the layer start. `ease` shapes the segment ARRIVING at this key. */
export interface Keyframe {
  t: number;
  v: number;
  ease?: Ease;
}

export type Keys = Partial<Record<AnimProp, Keyframe[]>>;

export type TransitionType =
  | "fade"
  | "slideUp"
  | "slideDown"
  | "slideLeft"
  | "slideRight"
  | "pop"
  | "wipe"
  | "blur";

/** Enter (`in`) or exit (`out`) animation. Runs on its own sub-layer, so it never fights keyframes. */
export interface Transition {
  type: TransitionType;
  duration?: number;
  ease?: Ease;
  /** Slide distance in canvas px (default 60). */
  distance?: number;
}

/** Position and size in canvas px (the design canvas, e.g. 1920×1080). */
export interface Frame {
  x: number;
  y: number;
  w: number;
  h: number;
  rotation?: number;
  scale?: number;
  opacity?: number;
}

/** Ties a layer's start to a word of the transcript. Cut the facecam, the layer moves along. */
export interface Anchor {
  word: string;
  offset?: number;
}

export interface LayerCommon {
  id: string;
  name?: string;
  /** If set, `start` is relative to this scene's start and scene speed applies. */
  scene?: string;
  /** Stacking order. Higher track = on top. */
  track: number;
  /** Seconds. Absolute, or relative to the scene. Ignored when `anchor` is set. */
  start: number;
  duration: number;
  anchor?: Anchor;
  keys?: Keys;
  in?: Transition;
  out?: Transition;
  hidden?: boolean;
  locked?: boolean;
  /** Free data for tools: prompt history, notes, source info … */
  meta?: Record<string, unknown>;
}

export interface TextStyle {
  fontFamily?: string;
  fontSize: number;
  fontWeight?: number;
  italic?: boolean;
  color?: string;
  align?: "left" | "center" | "right";
  valign?: "top" | "middle" | "bottom";
  lineHeight?: number;
  letterSpacing?: number;
  uppercase?: boolean;
  background?: string;
  padding?: number;
  radius?: number;
}

export interface TextLayer extends LayerCommon {
  type: "text";
  frame: Frame;
  text: string;
  style: TextStyle;
}

export interface ShapeLayer extends LayerCommon {
  type: "shape";
  frame: Frame;
  shape: "rect" | "ellipse";
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  radius?: number;
}

/** Drawn graphic. `svg` is the inner markup (no <svg> root). Use style="fill:$accent" for palette colors. */
export interface SvgLayer extends LayerCommon {
  type: "svg";
  frame: Frame;
  svg: string;
  viewBox?: string;
  preserveAspectRatio?: string;
}

export interface MediaSource {
  kind: "upload" | "ai" | "recording" | "url";
  prompt?: string;
  model?: string;
}

export interface ImageLayer extends LayerCommon {
  type: "image";
  frame: Frame;
  src: string;
  fit?: "cover" | "contain" | "fill";
  radius?: number;
  source?: MediaSource;
}

export interface VideoLayer extends LayerCommon {
  type: "video";
  frame: Frame;
  src: string;
  fit?: "cover" | "contain" | "fill";
  radius?: number;
  /** Seconds into the source file where this clip begins. */
  mediaStart?: number;
  /** Default true. Put the sound on its own audio layer ("detach audio"). */
  muted?: boolean;
  volume?: number;
  source?: MediaSource;
}

export interface AudioLayer extends LayerCommon {
  type: "audio";
  src: string;
  mediaStart?: number;
  volume?: number;
}

export type VisualLayer = TextLayer | ShapeLayer | SvgLayer | ImageLayer | VideoLayer;
export type Layer = VisualLayer | AudioLayer;
export type LayerType = Layer["type"];

export interface Scene {
  id: string;
  name: string;
  duration: number;
  /** Animation tempo inside the scene (keys and transitions). 1 = normal, 2 = twice as fast. */
  speed?: number;
}

export interface Word {
  id: string;
  text: string;
  /** Seconds in the SOURCE recording (not the composition). Cuts and moves keep anchors correct. */
  t0: number;
  t1: number;
}

/**
 * Transcript of one recording. `source` is the media file (e.g. the facecam).
 * Word times are mapped to the composition through the layer that plays `source`.
 */
export interface Transcript {
  source?: string;
  language?: string;
  provider?: string;
  words: Word[];
  /** Removed ranges of the recording, in SOURCE seconds. Non-destructive: words stay, cut words show struck through. */
  cuts?: Cut[];
}

export interface Cut {
  t0: number;
  t1: number;
  reason?: "manual" | "filler" | "pause";
}

export interface FontFace {
  family: string;
  src: string;
  weight?: number | string;
  style?: "normal" | "italic";
}

export interface MotionSpec {
  version: 1;
  meta: { title: string; lang?: string };
  canvas: { width: number; height: number; fps: number; background?: string };
  /** Global look. Palette entries become CSS variables: "$accent" → var(--om-accent). */
  style?: { palette?: Record<string, string>; fonts?: FontFace[] };
  scenes: Scene[];
  layers: Layer[];
  transcript?: Transcript;
}

export function isVisual(layer: Layer): layer is VisualLayer {
  return layer.type !== "audio";
}
