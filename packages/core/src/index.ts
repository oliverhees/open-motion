// @openmotion/core — public API.
export * from "./types.ts";
export { specSchema, layerSchema, validateSpec, assertValidSpec, SpecError, type ValidationResult } from "./schema.ts";
export { getEase, cssEasing, isValidEase, DEFAULT_EASE, type EaseFn } from "./ease.ts";
export { sceneTimings, layerTiming, compositionDuration, sceneAt, toAbs, toRel, transcriptCarrier, sourceToComp, compToSource, type SceneTiming, type LayerTiming } from "./timing.ts";
export { fxAt, awayState, NEUTRAL_FX, type FxState } from "./transitions.ts";
export { evaluate, layerAt, propAt, baseValue, interpolate, type LayerState } from "./evaluate.ts";
export { applyPatch, valueAt, PatchError, type PatchOp, type PatchResult } from "./patch.ts";
export { compile, sanitizeSvg, color, esc, type CompileOptions, type CompileResult, type AnimDef } from "./compile.ts";
export { describe } from "./describe.ts";
export { facecamFrame, facecamLayers, captionsLayer, type FacecamLayout } from "./presets.ts";
export { normalizeCuts, removedBetween, isCutLayer, keptSegments, findSuggestions, wordRange, isWordCut, subtractCut, type Segment, type Suggestion } from "./cuts.ts";
export { STYLES, FORMATS, FORMAT_SIZE, getStyle, styleBrief, type StyleDef, type Format } from "./styles.ts";
export { toLottie, parseColor, LOTTIE_HINTS, type LottieOptions, type LottieResult, type LottieWarning, type LottieWarningCode } from "./lottie.ts";
export { backgroundLayers, type BackgroundCandidate } from "./overlay.ts";
