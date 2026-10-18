// OpenMotion — Motion-Spec types.
//
// One idea runs through everything: every element is a LAYER.
// A layer = frame (where/how big) + content (what) + time (when).
// Editor, AI and renderer all read and write this one structure.

/** Easing name, GSAP-style syntax: "linear", "power2.inOut", "back.out", "sine.in" … */
export type Ease = string;

/** Numeric layer properties that can be keyframed. */
export type AnimProp = "x" | "y" | "w" | "h" | "rotation" | "scale" | "opacity" | "blur" | "rotateX" | "rotateY";
export const ANIM_PROPS: readonly AnimProp[] = ["x", "y", "w", "h", "rotation", "scale", "opacity", "blur", "rotateX", "rotateY"];

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
  | "blur"
  /** Wipes from other directions ("wipe" = reveal left → right). */
  | "wipeLeft"
  | "wipeUp"
  | "wipeDown"
  /** Rises out of an invisible line (editorial line reveal). */
  | "maskUp"
  /** Circle opens from the center. */
  | "iris"
  /** Zoom-through: comes from big + blurred (in) / leaves big + blurred (out). */
  | "zoomIn"
  /** Comes from small (in) / shrinks away (out), no bounce. */
  | "zoomOut";

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
  /** Gaussian blur in canvas px. */
  blur?: number;
  /** 3D tilt in degrees (with perspective). */
  rotateX?: number;
  rotateY?: number;
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
  /** Not moved by the camera (facecam, captions, logo bug). Fixed layers paint above the camera content. */
  fixed?: boolean;
  /** Free data for tools: prompt history, notes, source info … */
  meta?: Record<string, unknown>;
}

/** Look effects for any visual layer. Colors may use palette names ("$accent"). */
export interface Look {
  /** Drop shadow, CSS syntax without "drop-shadow": "0 20px 40px #00000066". */
  shadow?: string;
  /** Soft glow in this color around the visible content. */
  glow?: string;
  /** Glow radius in canvas px (default 24). */
  glowSize?: number;
  /** CSS mix-blend-mode, e.g. "screen", "multiply", "overlay". */
  blend?: string;
  /** Frosted glass: blurs what is behind the layer (px). Use with a semi-transparent fill. */
  glass?: number;
}

/** Text that animates piece by piece (kinetic typography). */
export interface TextAnim {
  /** Split by word (default), character or line ("\n"). */
  by?: "word" | "char" | "line";
  /** How each piece enters. */
  type: "rise" | "fade" | "blur" | "pop" | "mask" | "drop" | "slide" | "type";
  /** Seconds between pieces (default 0.06 for words, 0.025 for chars, 0.12 for lines). */
  stagger?: number;
  /** Seconds per piece (default 0.5). */
  duration?: number;
  ease?: Ease;
  /** Order: from the start (default), from the center, from the end, or a fixed shuffle. */
  order?: "start" | "center" | "end" | "random";
  /** Seconds after the layer start (default 0). */
  delay?: number;
}

/** A number that counts from → to. Shown with prefix/suffix, up to 2 decimals. */
export interface Count {
  from: number;
  to: number;
  decimals?: 0 | 1 | 2;
  /** Seconds (default 1.6), starting at `delay` after the layer start. */
  duration?: number;
  delay?: number;
  ease?: Ease;
  prefix?: string;
  suffix?: string;
  /** Decimal mark (default "," for German canvases, "." otherwise). */
  point?: string;
}

/** SVG strokes draw themselves; fills fade in at the end. */
export interface Draw {
  /** Seconds for all strokes (default 1.2). */
  duration?: number;
  /** Seconds between elements (default 0.08). */
  stagger?: number;
  delay?: number;
  ease?: Ease;
}

export interface TextStyle {
  fontFamily?: string;
  fontSize: number;
  fontWeight?: number;
  italic?: boolean;
  color?: string;
  align?: "left" | "center" | "right";
  /** "center" is accepted as "middle". */
  valign?: "top" | "middle" | "center" | "bottom";
  lineHeight?: number;
  letterSpacing?: number;
  uppercase?: boolean;
  background?: string;
  padding?: number;
  radius?: number;
  /** Text filled with a gradient, e.g. "linear-gradient(90deg, $accent, $accent2)". */
  gradient?: string;
  /** Color for words marked [[like this]] in the text (default $accent or the text color). */
  highlight?: string;
  /** Marker behind [[highlighted]] words (a color); it sweeps in with the text animation. */
  marker?: string;
}

export interface TextLayer extends LayerCommon {
  type: "text";
  frame: Frame;
  /** Mark words with [[double brackets]] to highlight them. */
  text: string;
  style: TextStyle;
  look?: Look;
  anim?: TextAnim;
  /** Counter: replaces the text with an animated number. */
  count?: Count;
}

export interface ShapeLayer extends LayerCommon {
  type: "shape";
  frame: Frame;
  shape: "rect" | "ellipse";
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  radius?: number;
  look?: Look;
}

/** Drawn graphic. `svg` is the inner markup (no <svg> root). Use style="fill:$accent" for palette colors. */
export interface SvgLayer extends LayerCommon {
  type: "svg";
  frame: Frame;
  svg: string;
  viewBox?: string;
  preserveAspectRatio?: string;
  look?: Look;
  draw?: Draw;
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
  look?: Look;
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
  look?: Look;
}

/**
 * Captions from the transcript: short phrases, the spoken word highlighted (creator style).
 * Follows cuts automatically. Usually spans the whole video and is `fixed` (not moved by the camera).
 */
export interface CaptionsLayer extends LayerCommon {
  type: "captions";
  frame: Frame;
  style: TextStyle;
  /** Max words per phrase (default 3). Phrases also break at . , ! ? and pauses. */
  words?: number;
  /** The word being spoken right now. */
  active?: { color?: string; background?: string; scale?: number };
  look?: Look;
}

export interface AudioLayer extends LayerCommon {
  type: "audio";
  src: string;
  mediaStart?: number;
  volume?: number;
}

export type VisualLayer = TextLayer | ShapeLayer | SvgLayer | ImageLayer | VideoLayer | CaptionsLayer;
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

/** Film texture over the whole picture (0–1 each). */
export interface Texture {
  grain?: number;
  vignette?: number;
  scanlines?: number;
}

/** Camera keys use ABSOLUTE seconds. zoom 1 = normal; x/y = canvas px the camera looks to the right/down; rotation in degrees. */
export interface Camera {
  keys: Partial<Record<"zoom" | "x" | "y" | "rotation", Keyframe[]>>;
}

export interface MotionSpec {
  version: 1;
  /** style: id from the style library; brief: what the user wants (from the interview), kept for every later change. */
  meta: { title: string; lang?: string; style?: string; brief?: string; brand?: import("./brand.ts").BrandMeta };
  canvas: { width: number; height: number; fps: number; background?: string; texture?: Texture };
  /** Global look. Palette entries become CSS variables: "$accent" → var(--om-accent). */
  style?: { palette?: Record<string, string>; fonts?: FontFace[] };
  scenes: Scene[];
  layers: Layer[];
  /** Moves all layers except `fixed` ones: push-ins, pans, zoom to a target. */
  camera?: Camera;
  transcript?: Transcript;
}

export function isVisual(layer: Layer): layer is VisualLayer {
  return layer.type !== "audio";
}
