# Motion-Spec – Referenz

Version 1. Maßeinheiten: Pixel auf der Design-Leinwand (z. B. 1920×1080), Zeiten in Sekunden.

## Projekt

```jsonc
{
  "version": 1,
  "meta":   { "title": "Mein Video", "lang": "de" },
  "canvas": { "width": 1920, "height": 1080, "fps": 30, "background": "$bg" },
  "style":  {
    "palette": { "bg": "#0F1E33", "accent": "#F97216" },   // "$accent" überall nutzbar
    "fonts":   [{ "family": "Bricolage Grotesque", "src": "assets/fonts/x.woff2", "weight": "200 800" }]
  },
  "scenes": [{ "id": "s1", "name": "Intro", "duration": 4, "speed": 1 }],
  "layers": [ /* … */ ],
  "transcript": { "words": [{ "id": "w1", "text": "Hallo", "t0": 0.4, "t1": 0.8 }] }
}
```

## Gemeinsame Felder jeder Ebene

| Feld | Bedeutung |
| --- | --- |
| `id` | eindeutig, beginnt mit Buchstabe |
| `name` | Anzeigename im Editor |
| `type` | `text`, `shape`, `svg`, `image`, `video`, `audio` |
| `track` | Stapelreihenfolge. Höher = weiter oben |
| `scene` | optional. Dann ist `start` relativ zur Szene und das Szenen-Tempo gilt |
| `start`, `duration` | Sekunden |
| `anchor` | `{ "word": "w22", "offset": -0.3 }` statt fester Startzeit |
| `frame` | `{ x, y, w, h, rotation?, scale?, opacity? }` (nicht bei `audio`) |
| `keys` | Keyframes pro Eigenschaft (siehe unten) |
| `in`, `out` | Ein- und Ausblendung (siehe unten) |
| `hidden`, `locked` | ausblenden bzw. im Editor sperren |
| `meta` | freie Daten (Prompt-Verlauf, Notizen …) |

## Inhalte je Typ

| Typ | Felder |
| --- | --- |
| `text` | `text`, `style: { fontSize, fontFamily?, fontWeight?, color?, align?, valign?, lineHeight?, letterSpacing?, uppercase?, italic?, background?, padding?, radius? }` |
| `shape` | `shape: "rect" \| "ellipse"`, `fill?`, `stroke?`, `strokeWidth?`, `radius?` |
| `svg` | `svg` (innerer SVG-Code ohne `<svg>`-Hülle), `viewBox?`, `preserveAspectRatio?` |
| `image` | `src`, `fit?`, `radius?`, `source?: { kind, prompt?, model? }` |
| `video` | `src`, `fit?`, `radius?`, `mediaStart?`, `muted?` (Standard `true`), `volume?`, `source?` |
| `audio` | `src`, `mediaStart?`, `volume?` |

**Farben in SVG:** `style="fill:$accent"` statt `fill="$accent"`. Palettenfarben werden zu CSS-Variablen.

## Keyframes

```jsonc
"keys": {
  "x": [ { "t": 0, "v": 1037 }, { "t": 4.7, "v": 1493, "ease": "power3.inOut" } ]
}
```

- Animierbar: `x`, `y`, `w`, `h`, `rotation`, `scale`, `opacity`.
- `t` ist relativ zum Start der Ebene.
- `ease` gilt für das Stück **bis zu diesem Keyframe**.
- Vor dem ersten und nach dem letzten Keyframe bleibt der Wert stehen.

**Easing-Namen:** `linear`, `power1`–`power4`, `sine`, `expo`, `circ` jeweils mit `.in`, `.out`, `.inOut`, außerdem `back.in`, `back.out`, `back.inOut`, optional mit Stärke, z. B. `back.out(2)`. Standard ist `power2.inOut`.

## Ein- und Ausblendungen

```jsonc
"in":  { "type": "slideUp", "duration": 0.7, "ease": "power3.out", "distance": 70 },
"out": { "type": "fade", "duration": 0.35 }
```

Typen: `fade`, `slideUp`, `slideDown`, `slideLeft`, `slideRight`, `pop`, `wipe`, `blur`.

Übergänge laufen auf einer eigenen Box. Sie vertragen sich deshalb mit Keyframes auf Position oder Größe.
