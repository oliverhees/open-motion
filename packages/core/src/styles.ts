// Style library: curated looks the AI builds from and the user picks in the interview.
// Each style is a complete art direction: palette tokens, a font pair (Google Fonts, loaded on demand),
// a motion signature (eases, durations, stagger, text animation, transitions) and do/don't rules.
// Browser-safe data only (used by the editor and the server).

import type { Ease, TextAnim, Texture, TransitionType } from "./types.ts";

export interface StyleDef {
  id: string;
  name: { de: string; en: string };
  mood: { de: string; en: string };
  /** Palette tokens. Always: bg, surface, ink, muted, accent. */
  palette: Record<string, string>;
  fonts: { display: string; displayWeight: number; body: string; bodyWeight: number; mono?: string;
    /** Width of a display character in em, measured in Chrome (uppercase, the wider case), for sizing headlines so they do not wrap. */
    displayWidth?: number };
  motion: {
    enter: Ease;
    exit: Ease;
    /** Typical entrance / exit seconds. */
    inDur: number;
    outDur: number;
    stagger: number;
    text: TextAnim;
    transitions: TransitionType[];
    /** Camera idea in words. */
    camera: string;
    /** Energy in BPM (pacing grid). */
    bpm: number;
  };
  texture?: Texture;
  /** Typical looks, as hints for the AI. */
  look?: string;
  do: string[];
  dont: string[];
}

export const STYLES: StyleDef[] = [
  {
    id: "keynote",
    name: { de: "Keynote Minimal", en: "Keynote Minimal" },
    mood: { de: "Ruhige Souveränität, eine Aussage pro Szene", en: "Quiet confidence, one statement per scene" },
    palette: { bg: "#0B0B0D", surface: "#1A1A1E", ink: "#F5F5F7", muted: "#86868B", accent: "#2997FF" },
    fonts: { display: "Geist", displayWeight: 600, body: "Geist", bodyWeight: 300, mono: "Geist Mono", displayWidth: 0.6 },
    motion: { enter: "power3.out", exit: "power2.in", inDur: 1.0, outDur: 0.5, stagger: 0.08, text: { type: "blur", by: "word" }, transitions: ["blur", "zoomOut", "maskUp"], camera: "very slow push-in (zoom 1 → 1.04) on hero moments", bpm: 70 },
    look: "soft shadows, product reveal from darkness, lots of negative space",
    do: ["one claim per scene", "huge type, tight tracking (-0.03em)", "long holds (2.5–3 s)"],
    dont: ["neon", "bounce", "more than 3 elements on screen"],
  },
  {
    id: "swiss",
    name: { de: "Swiss Grid", en: "Swiss Grid" },
    mood: { de: "Klinische Präzision für SaaS und Daten", en: "Clinical precision for SaaS and data" },
    palette: { bg: "#F2F0EB", surface: "#FFFFFF", ink: "#111111", muted: "#6B6B6B", accent: "#FF3B1F" },
    fonts: { display: "Archivo", displayWeight: 900, body: "Archivo", bodyWeight: 300, mono: "IBM Plex Mono", displayWidth: 0.7 },
    motion: { enter: "expo.out", exit: "power4.in", inDur: 0.4, outDur: 0.25, stagger: 0.05, text: { type: "mask", by: "line" }, transitions: ["wipe", "wipeUp", "maskUp"], camera: "none; hard cuts", bpm: 110 },
    look: "hairline rules that grow from 0, numbers at 80–120 px counting up, strict 12-column grid",
    do: ["left alignment, edge anchoring", "counters for every number", "hairlines and grid"],
    dont: ["decorative transitions", "centered floating stacks", "gradients"],
  },
  {
    id: "velvet",
    name: { de: "Velvet Noir", en: "Velvet Noir" },
    mood: { de: "Premium und langsam, Luxus", en: "Premium and slow, luxury" },
    palette: { bg: "#0A0A0A", surface: "#16130F", ink: "#EDE6DA", muted: "#8A8276", accent: "#C9A96E" },
    fonts: { display: "Fraunces", displayWeight: 300, body: "Manrope", bodyWeight: 300, displayWidth: 0.62 },
    motion: { enter: "sine.inOut", exit: "sine.inOut", inDur: 1.2, outDur: 0.9, stagger: 0.12, text: { type: "fade", by: "char" }, transitions: ["fade", "blur", "iris"], camera: "slow drift and push-in", bpm: 64 },
    texture: { grain: 0.35, vignette: 0.6 },
    look: "gold accents, letter-spaced uppercase body (0.15em), warm glow on the hero",
    do: ["3 s holds", "dissolves of 1.5 s", "italic serif headlines"],
    dont: ["snapping", "saturated colors", "more than one accent"],
  },
  {
    id: "kinetic",
    name: { de: "Kinetic Bold", en: "Kinetic Bold" },
    mood: { de: "Hype-Launch, Typo füllt das Bild", en: "Hype launch, type fills the frame" },
    palette: { bg: "#0A0A0A", surface: "#1C1C1C", ink: "#FFFFFF", muted: "#9A9A9A", accent: "#FF3D2E", accent2: "#FFD60A" },
    fonts: { display: "Anton", displayWeight: 400, body: "Space Grotesk", bodyWeight: 500, displayWidth: 0.44 },
    motion: { enter: "expo.out", exit: "power3.in", inDur: 0.3, outDur: 0.2, stagger: 0.06, text: { type: "mask", by: "word" }, transitions: ["zoomIn", "wipeLeft", "maskUp"], camera: "punch-ins on emphasis words (zoom 1 → 1.08 in 0.25 s)", bpm: 120 },
    look: "type at 50–80 % of the frame width, slams on the beat, hard cuts",
    do: ["2–3 s scenes", "uppercase display", "something new on every beat"],
    dont: ["small text", "slow fades", "more than 6 words per scene"],
  },
  {
    id: "brutal",
    name: { de: "Neo-Brutal", en: "Neo-Brutal" },
    mood: { de: "Roh und laut, Indie-Dev", en: "Raw and loud, indie dev" },
    palette: { bg: "#FFFDF5", surface: "#FFFFFF", ink: "#000000", muted: "#555555", accent: "#FF5C00", accent2: "#B4FF39", accent3: "#7B61FF" },
    fonts: { display: "Space Grotesk", displayWeight: 700, body: "Space Mono", bodyWeight: 400, mono: "Space Mono", displayWidth: 0.57 },
    motion: { enter: "steps(4)", exit: "steps(3)", inDur: 0.2, outDur: 0.15, stagger: 0.05, text: { type: "type", by: "char" }, transitions: ["pop", "slideUp", "wipe"], camera: "none", bpm: 116 },
    look: "thick black borders, hard offset shadows (shadow '8px 8px 0 #000'), slight rotations ±2–4°",
    do: ["stepped motion", "flat colors", "boxes with 3–4 px borders"],
    dont: ["blur", "soft gradients", "glows"],
  },
  {
    id: "glass",
    name: { de: "Liquid Glass", en: "Liquid Glass" },
    mood: { de: "Futuristisch, Tiefe in Ebenen (KI/SaaS)", en: "Futuristic, layered depth (AI/SaaS)" },
    palette: { bg: "#070A12", surface: "#111827", ink: "#E6EAF2", muted: "#8B93A7", accent: "#7C5CFF", accent2: "#22D3EE" },
    fonts: { display: "Manrope", displayWeight: 700, body: "Manrope", bodyWeight: 400, mono: "JetBrains Mono", displayWidth: 0.6 },
    motion: { enter: "power3.out", exit: "power2.in", inDur: 0.6, outDur: 0.35, stagger: 0.07, text: { type: "rise", by: "word" }, transitions: ["zoomOut", "blur", "maskUp"], camera: "cards drift at different depths; gentle push-in", bpm: 96 },
    look: "glass cards (look.glass 20–30, fill with white at 8–14 % alpha, 1 px light stroke), radial glows behind, 3D tilt (rotateY -10…-20)",
    do: ["radial accent glow behind hero", "depth via scale and blur", "mono labels"],
    dont: ["more than two accents", "glass on glass on glass", "purple+cyan everywhere (use sparingly)"],
  },
  {
    id: "editorial",
    name: { de: "Editorial Magazin", en: "Editorial Magazine" },
    mood: { de: "Kluges Storytelling wie im Magazin", en: "Smart magazine storytelling" },
    palette: { bg: "#F4EFE6", surface: "#FFFFFF", ink: "#1A1A1A", muted: "#6E675E", accent: "#B4441F" },
    fonts: { display: "Instrument Serif", displayWeight: 400, body: "IBM Plex Sans", bodyWeight: 400, displayWidth: 0.45 },
    motion: { enter: "power3.out", exit: "power2.in", inDur: 0.7, outDur: 0.4, stagger: 0.1, text: { type: "mask", by: "line" }, transitions: ["maskUp", "wipe", "fade"], camera: "slow vertical pan through a long layout", bpm: 84 },
    look: "hairline rules drawing in, pull quotes, image crops wiping open, italic serif emphasis",
    do: ["big serif headline + small sans body", "captions like a magazine", "real photo crops"],
    dont: ["neon", "rounded cartoon shapes", "all caps everywhere"],
  },
  {
    id: "data",
    name: { de: "Data Story", en: "Data Story" },
    mood: { de: "Beweise mit Zahlen und Diagrammen", en: "Evidence with numbers and charts" },
    palette: { bg: "#0E1116", surface: "#161B22", ink: "#E6EDF3", muted: "#7D8590", accent: "#4C9AFF", accent2: "#F5A524", accent3: "#17C964" },
    fonts: { display: "IBM Plex Sans", displayWeight: 700, body: "IBM Plex Sans", bodyWeight: 400, mono: "IBM Plex Mono", displayWidth: 0.6 },
    motion: { enter: "power3.out", exit: "power2.in", inDur: 0.5, outDur: 0.3, stagger: 0.06, text: { type: "rise", by: "word" }, transitions: ["wipeUp", "fade", "wipe"], camera: "zoom to the key data point", bpm: 100 },
    look: "bars grow from the baseline (keys on h + y), line charts draw (svg draw), counters with tabular numbers",
    do: ["one number that proves it", "honest axes", "label directly on the chart"],
    dont: ["3D charts", "pie charts with > 4 slices", "decoration on data"],
  },
  {
    id: "doodle",
    name: { de: "Doodle-Erklärer", en: "Doodle Explainer" },
    mood: { de: "Freundlicher Lehrer, handgezeichnet", en: "Friendly teacher, hand-drawn" },
    palette: { bg: "#FFFBF0", surface: "#FFFFFF", ink: "#2B2B2B", muted: "#7A7368", accent: "#FF6B4A", accent2: "#3D7BFF", marker: "#FFE45C" },
    fonts: { display: "Caveat", displayWeight: 700, body: "Lexend", bodyWeight: 400, displayWidth: 0.48 },
    motion: { enter: "power2.out", exit: "power2.in", inDur: 0.6, outDur: 0.3, stagger: 0.08, text: { type: "rise", by: "word" }, transitions: ["pop", "wipe", "fade"], camera: "none or gentle", bpm: 92 },
    look: "SVG strokes draw themselves (draw), marker highlights sweep behind key words (style.marker), circles around important things",
    do: ["round line caps, 6–10 px strokes", "arrows and circles that draw on", "marker highlight on the key word"],
    dont: ["perfect geometric UI", "dark backgrounds", "gradients"],
  },
  {
    id: "collage",
    name: { de: "Papier-Collage", en: "Paper Collage" },
    mood: { de: "Haptisch, echt, Trend 2026", en: "Tactile and real, 2026 trend" },
    palette: { bg: "#EFE7DA", surface: "#FBF7F0", ink: "#1F1F1F", muted: "#7C7468", accent: "#E94F37", accent2: "#3F88C5", accent3: "#F6AE2D" },
    fonts: { display: "DM Serif Display", displayWeight: 400, body: "Bricolage Grotesque", bodyWeight: 500, displayWidth: 0.56 },
    motion: { enter: "steps(8)", exit: "steps(6)", inDur: 0.5, outDur: 0.3, stagger: 0.09, text: { type: "pop", by: "word" }, transitions: ["pop", "slideUp", "wipeLeft"], camera: "none", bpm: 96 },
    texture: { grain: 0.5 },
    look: "cut-out images (AI images of paper textures/objects), tape strips, drop shadows, slight rotations, stop-motion steps",
    do: ["stepped 8–12 fps feel", "overlapping paper pieces", "rotations ±3°"],
    dont: ["glossy gradients", "glass", "perfect alignment"],
  },
  {
    id: "vhs",
    name: { de: "Retro VHS", en: "Retro VHS" },
    mood: { de: "Nostalgisch, Gen-Z, Y2K", en: "Nostalgic, Gen-Z, Y2K" },
    palette: { bg: "#0D0221", surface: "#1A0B3D", ink: "#D1F7FF", muted: "#7A6FA8", accent: "#FF2A6D", accent2: "#05D9E8", accent3: "#F9C80E" },
    fonts: { display: "Rubik Mono One", displayWeight: 400, body: "Space Mono", bodyWeight: 400, mono: "Space Mono", displayWidth: 0.88 },
    motion: { enter: "steps(3)", exit: "steps(2)", inDur: 0.25, outDur: 0.15, stagger: 0.04, text: { type: "type", by: "char" }, transitions: ["wipeDown", "pop", "blur"], camera: "tiny jitter (±4 px) on hits", bpm: 118 },
    texture: { grain: 0.45, scanlines: 0.6, vignette: 0.5 },
    look: "chromatic offset via two text copies (accent + accent2, 3 px apart), glow on titles",
    do: ["hard cuts", "glitch on transitions", "chunky mono type"],
    dont: ["soft luxury", "long fades", "thin fonts"],
  },
  {
    id: "neon",
    name: { de: "Neon HUD", en: "Neon HUD" },
    mood: { de: "Tech-Thriller, Interface", en: "Tech thriller, interface" },
    palette: { bg: "#05010F", surface: "#0E0A24", ink: "#E0FCFF", muted: "#5E6A8A", accent: "#00F0FF", accent2: "#FF00C8", accent3: "#F5FF00" },
    fonts: { display: "Chakra Petch", displayWeight: 700, body: "JetBrains Mono", bodyWeight: 400, mono: "JetBrains Mono", displayWidth: 0.6 },
    motion: { enter: "expo.out", exit: "power3.in", inDur: 0.35, outDur: 0.2, stagger: 0.03, text: { type: "type", by: "char" }, transitions: ["wipe", "iris", "blur"], camera: "zoom to target, hold", bpm: 112 },
    texture: { scanlines: 0.25, vignette: 0.5 },
    look: "bracket corners that draw in (svg draw), glow (look.glow $accent), thin 1–2 px lines, data readouts",
    do: ["UI frames and brackets", "monospace labels", "glow only on the hero"],
    dont: ["serif fonts", "pastel", "glow on everything"],
  },
  {
    id: "pastel",
    name: { de: "Soft Pastel", en: "Soft Pastel" },
    mood: { de: "Freundliche App, verspielt", en: "Friendly consumer app, playful" },
    palette: { bg: "#FFF7F0", surface: "#FFFFFF", ink: "#2E2A4F", muted: "#8A86A6", accent: "#FF8FAB", accent2: "#8EC5FF", accent3: "#A8E6A1" },
    fonts: { display: "Fredoka", displayWeight: 600, body: "DM Sans", bodyWeight: 400, displayWidth: 0.58 },
    motion: { enter: "spring.soft", exit: "power2.in", inDur: 0.5, outDur: 0.25, stagger: 0.06, text: { type: "pop", by: "word" }, transitions: ["pop", "slideUp", "zoomOut"], camera: "gentle push-in", bpm: 104 },
    look: "rounded cards (radius 28–40) with soft shadows ('0 20px 40px #2E2A4F1A'), UI pieces assembling, cursor clicks",
    do: ["one small overshoot (spring.soft)", "rounded everything", "friendly icons drawn in SVG"],
    dont: ["harsh black", "sharp corners", "dark mode"],
  },
  {
    id: "creator",
    name: { de: "Creator Hype", en: "Creator Hype" },
    mood: { de: "YouTube-Retention: Untertitel, Punch-ins, Tempo", en: "YouTube retention: captions, punch-ins, pace" },
    palette: { bg: "#111111", surface: "#1E1E1E", ink: "#FFFFFF", muted: "#A0A0A0", accent: "#FFE600", accent2: "#FF2D55" },
    fonts: { display: "Anton", displayWeight: 400, body: "Montserrat", bodyWeight: 800, displayWidth: 0.44 },
    motion: { enter: "expo.out", exit: "power3.in", inDur: 0.25, outDur: 0.15, stagger: 0.04, text: { type: "pop", by: "word" }, transitions: ["pop", "zoomIn", "slideUp"], camera: "punch-in on emphasis words (zoom 1 → 1.12 in 0.2 s, back after 1–2 s); fixed captions", bpm: 124 },
    look: "captions layer (3 words, active word on $accent box), emoji/sticker pops, big numbers, face stays visible",
    do: ["captions always", "pattern interrupt every 3–5 s", "keep the face visible"],
    dont: ["covering the face", "long text blocks", "slow pacing"],
  },
];

/** Video formats and their canvas size. */
export const FORMATS = ["16:9", "9:16", "1:1", "4:5"] as const;
export type Format = (typeof FORMATS)[number];
export const FORMAT_SIZE: Record<Format, { width: number; height: number }> = {
  "16:9": { width: 1920, height: 1080 },
  "9:16": { width: 1080, height: 1920 },
  "1:1": { width: 1080, height: 1080 },
  "4:5": { width: 1080, height: 1350 },
};

export function getStyle(id: string | undefined): StyleDef | undefined {
  return STYLES.find((s) => s.id === id);
}

/** Compact art-direction brief of one style, for the AI. */
export function styleBrief(st: StyleDef): string {
  const m = st.motion;
  return [
    `STYLE "${st.name.en}" (${st.id}): ${st.mood.en}.`,
    `Palette tokens (use as $name): ${Object.entries(st.palette).map(([k, v]) => `${k} ${v}`).join(", ")}.`,
    `Fonts (Google Fonts, set style.fontFamily; they load automatically): display "${st.fonts.display}" ${st.fonts.displayWeight}, body "${st.fonts.body}" ${st.fonts.bodyWeight}${st.fonts.mono ? `, mono "${st.fonts.mono}"` : ""}.${st.fonts.displayWidth ? ` Display text width ≈ chars × fontSize × ${st.fonts.displayWidth} (measured for this font; use it instead of 0.55).` : ""}`,
    `Motion: enter ${m.enter} ~${m.inDur}s, exit ${m.exit} ~${m.outDur}s, stagger ${m.stagger}s, text anim {"type":"${m.text.type}","by":"${m.text.by ?? "word"}"}, transitions ${m.transitions.join("/")}, camera: ${m.camera}. Pace ~${m.bpm} BPM (beat = ${(60 / m.bpm).toFixed(2)} s).`,
    st.texture ? `Texture: canvas.texture ${JSON.stringify(st.texture)}.` : "Texture: none (clean).",
    st.look ? `Signature look: ${st.look}.` : "",
    `Do: ${st.do.join("; ")}. Don't: ${st.dont.join("; ")}.`,
  ].filter(Boolean).join("\n");
}
