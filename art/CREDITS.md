# Art Credits

## Splash screen (hero-splash.jpg)

See git history for this file's own sourcing notes (PR #85/#88).

## Safari scene (safari-day.jpg, safari-night.jpg)

Player request (2026-08-16): "a high res photorealistic image that you
find" for a new Safari background, as an explicit stylistic departure
from every other scene's hand-drawn canvas art. Both are real
photographs, not generated or procedural, sourced from Pexels (free to
use for commercial purposes, no attribution legally required, credited
anyway):

- `safari-day.jpg` — "Solitary Acacia Tree in Kenyan Savannah," by
  Zebari Visuals, via
  [Pexels](https://www.pexels.com/photo/solitary-acacia-tree-in-kenyan-savannah-37489738/).
  Resized from the original 2400×1600 to 1920×1280 and re-encoded for
  web delivery; otherwise unedited.
- `safari-night.jpg` — a Milky Way/starfield view over Tsavo, Kenya, by
  Beatz, via
  [Pexels](https://www.pexels.com/photo/green-grass-field-under-starry-night-5615130/).
  Resized from the original 2400×1708 to 1920×1366, given a very light
  denoise pass (Gaussian blur, radius 0.4px) to control JPEG file size
  on the astrophotography grain without visibly softening the Milky
  Way's structure, and re-encoded for web delivery.

In-game, `drawSafariScene()` (game.js) applies a slow Ken Burns-style
pan/zoom and a radial vignette to each photo at render time — neither
source file is pre-cropped or pre-vignetted.

## Forest scene (forest-night.jpg)

Player request (2026-08-17): extend Safari's real-photo treatment to
the other scenes' hand-drawn canvas art, starting with Forest. A real
photograph, sourced from Pexels (free to use for commercial purposes,
no attribution legally required, credited anyway):

- `forest-night.jpg` — "Silhouettes of Trees at Night," by Troy Olson,
  via
  [Pexels](https://www.pexels.com/photo/silhouettes-of-trees-at-night-25953506/).
  Re-encoded for web delivery; otherwise unedited. Chosen specifically
  for having its own real starfield already in frame (so `drawStars()`
  is deliberately NOT layered on top, same reasoning as Safari's night
  variant) but no moon of its own (so the existing procedural
  `drawNightMoon()` still has a real, unobstructed sky to sit in).

Unlike Safari, Forest doesn't need a separate day/night pick or a
foreground tree-cutout library: it was always a night-only scene, and
the photo's own dense treeline already provides the trees Safari's
Ken-Burns-panned single-tree photo didn't. `drawForestScene()` (game.js)
applies the same Ken Burns pan/zoom technique as Safari, with the
existing moon/starfield-adjacent glow and firefly layers drawn on top
unchanged.
