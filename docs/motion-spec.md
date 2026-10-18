# Motion-Spec reference

*[Deutsche Version](de/motion-spec.md)*

Version 1. Units: pixels on the design canvas (e.g. 1920×1080), times in seconds.

## Project

```jsonc
{
  "version": 1,
  "meta":   { "title": "My video", "lang": "en" },
  "canvas": { "width": 1920, "height": 1080, "fps": 30, "background": "$bg" },
  "style":  {
    "palette": { "bg": "#0F1E33", "accent": "#F97216" },   // use "$accent" anywhere
    "fonts":   [{ "family": "Bricolage Grotesque", "src": "assets/fonts/x.woff2", "weight": "200 800" }]
  },
  "scenes": [{ "id": "s1", "name": "Intro", "duration": 4, "speed": 1 }],
  "layers": [ /* … */ ],
  "transcript": {
    "source": "assets/video/facecam.mp4",
    "words": [{ "id": "w1", "text": "Hello", "t0": 0.4, "t1": 0.8 }],   // seconds of the SOURCE recording
    "cuts":  [{ "t0": 2.95, "t1": 4.35, "reason": "pause" }]             // removed ranges (text-based cutting)
  }
}
```

## Fields every layer has

| Field | Meaning |
| --- | --- |
| `id` | unique, starts with a letter |
| `name` | display name in the editor |
| `type` | `text`, `shape`, `svg`, `image`, `video`, `audio` |
| `track` | stacking order, higher = on top |
| `scene` | optional; then `start` is relative to the scene and the scene speed applies |
| `start`, `duration` | seconds |
| `anchor` | `{ "word": "w22", "offset": -0.3 }` instead of a fixed start |
| `frame` | `{ x, y, w, h, rotation?, scale?, opacity? }` (not for `audio`) |
| `keys` | keyframes per property (see below) |
| `in`, `out` | enter and exit transitions (see below) |
| `hidden`, `locked` | hide, or lock in the editor |
| `meta` | free data (prompt history, notes …) |

## Content per type

| Type | Fields |
| --- | --- |
| `text` | `text`, `style: { fontSize, fontFamily?, fontWeight?, color?, align?, valign?, lineHeight?, letterSpacing?, uppercase?, italic?, background?, padding?, radius? }` |
| `shape` | `shape: "rect" \| "ellipse"`, `fill?`, `stroke?`, `strokeWidth?`, `radius?` |
| `svg` | `svg` (inner SVG markup without the `<svg>` wrapper), `viewBox?`, `preserveAspectRatio?` |
| `image` | `src`, `fit?`, `radius?`, `source?: { kind, prompt?, model? }` |
| `video` | `src`, `fit?`, `radius?`, `mediaStart?`, `muted?` (default `true`), `volume?`, `source?` |
| `audio` | `src`, `mediaStart?`, `volume?` |

**Colors in SVG:** write `style="fill:$accent"` instead of `fill="$accent"`. Palette colors become CSS variables.

## Keyframes

```jsonc
"keys": {
  "x": [ { "t": 0, "v": 1037 }, { "t": 4.7, "v": 1493, "ease": "power3.inOut" } ]
}
```

- Animatable: `x`, `y`, `w`, `h`, `rotation`, `scale`, `opacity`.
- `t` is relative to the layer start.
- `ease` applies to the segment **arriving at** this keyframe.
- Before the first and after the last keyframe the value holds.

**Ease names:** `linear`, `power1`–`power4`, `sine`, `expo`, `circ`, each with `.in`, `.out`, `.inOut`, plus `back.in`, `back.out`, `back.inOut`, optionally with strength, e.g. `back.out(2)`. Default is `power2.inOut`.

## Enter and exit transitions

```jsonc
"in":  { "type": "slideUp", "duration": 0.7, "ease": "power3.out", "distance": 70 },
"out": { "type": "fade", "duration": 0.35 }
```

Types: `fade`, `slideUp`, `slideDown`, `slideLeft`, `slideRight`, `pop`, `wipe`, `blur`.

Transitions run on a separate box, so they never fight with keyframes on position or size.

## Patches (how editor and AI change the spec)

| Op | Purpose |
| --- | --- |
| `set` | set a field by dot path: `text`, `frame.x`, `style.color` … |
| `setAt` | set a value at time t; animated properties get a keyframe there |
| `removeKey` | delete a keyframe |
| `swap` | swap content, keep frame, timing and keyframes |
| `replace` | replace a layer completely, keep its id |
| `add`, `remove` | add or delete a layer |
| `scene`, `addScene`, `removeScene` | change scenes |
| `style`, `canvas`, `meta` | palette, fonts, format, title |
| `transcript`, `word` | replace the transcript, fix a word |
| `cut`, `uncut`, `cuts` | text-based cutting |
| `camera` | camera moves over all non-fixed layers |
| `template` | insert one of the 25 templates: `{"op":"template","id":"lowerthird","at":3.5,"values":{"name":"Mara","role":"Founder"}}` (scene templates add a scene after the one at `at`; overlays appear at `at`) |

**Brand:** `meta.brand` holds the project's brand (name, logo path, tagline, website, handle, fonts) and what it replaced (`prev`), so `{"op":"meta","set":{"brand":null}}` alone is not a full undo; use the editor's "No brand" or the MCP tool `apply_brand` with `null`, which also restores palette and fonts.
