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

## Safari foreground cutouts (art/safari-cutouts/*.webp)

Player request (2026-08-17): real photos of Safari trees and animals,
randomly placed/moving over the background photo so the scene looks
different every playthrough, rather than the same two fixed
hand-drawn giraffes every time. Each file is a real photograph with its
background removed (see below), not generated or procedural — sourced
from Pexels (free to use for commercial purposes, no attribution legally
required, credited anyway):

- `tree-acacia.webp` — cropped from "Lonely Acacia Tree on a Vast Desert
  Landscape," by Timon Cornelissen, via
  [Pexels](https://pexels.com/photo/lonely-acacia-tree-on-a-vast-desert-landscape-33231637/).
- `tree-baobab.webp` — cropped from "Lonely Tree on a Field," by
  Charmain Jansen van Rensburg, via
  [Pexels](https://pexels.com/photo/lonely-tree-on-a-field-25130454/).
- `animal-zebra.webp` — cropped from "Zebra Standing on the Road Through
  the Savannah," by Charl Durand, via
  [Pexels](https://pexels.com/photo/zebra-standing-on-the-road-through-the-savannah-17153292/).
- `animal-giraffe.webp` — cropped from "A Giraffe Standing on the
  Grass," by Taryn Elliott, via
  [Pexels](https://pexels.com/photo/a-giraffe-standing-on-the-grass-5213956/).
- `animal-elephant.webp` — cropped from "Majestic African Elephant in
  the Savannah," by Mr Sketch, via
  [Pexels](https://www.pexels.com/photo/majestic-african-elephant-in-the-savannah-38794678/).

Background removal was done with `rembg` (the `isnet-general-use`
model specifically — the default `u2net` model was tested first and
crushed the acacia's fine leafy canopy to near-transparent, keeping
only the bare branch skeleton; `isnet-general-use` preserved full
canopy color and texture with a natural wispy edge). Each cutout was
then tight-cropped to its own alpha bounding box (thresholded at alpha
> 15 to reject stray near-zero-alpha noise pixels far from the actual
subject, which otherwise inflated the crop and made the subject "float"
above its intended ground line once composited) and re-encoded as
lossy WebP (quality 82) — a straight PNG export of the same crops ran
4-5x larger for no visible quality gain, since WebP handles soft
photographic alpha edges far more efficiently than PNG's lossless
palette/deflate coding.

Source photo selection turned out to matter more than any processing
step: photos with the subject's base/legs overlapping bushes or other
clutter produced broken cutouts (an early giraffe pick lost both front
legs to background shrubs) regardless of model or settings — only
switching to a cleaner source photo fixed it. Two other candidate tree
photos were rejected after cutout testing revealed they were tight
crops of a single bare branch, not a full tree, despite reading as
plausible from their thumbnails.

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
