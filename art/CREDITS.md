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

## Beach scene (beach-night.jpg)

Player request (2026-08-17): continue the real-photo redesign with
Beach next. A real photograph, sourced from Pexels (free to use for
commercial purposes, no attribution legally required, credited
anyway):

- `beach-night.jpg` — "A serene night view of the calm sea and starry
  sky at Leba Beach, Poland," by Marek Piwnicki, via
  [Pexels](https://pexels.com/photo/blue-sky-and-white-clouds-during-sunset-5933300/)
  (the page's own auto-generated title/URL slug is wrong -- the photo
  and its actual description are a calm night seascape, not a sunset).
  Re-encoded for web delivery; otherwise unedited (already a lean
  ~42KB, no denoise pass needed).

A first candidate -- "A Motion of Waves at Night" by Allan Carvalho,
also via Pexels -- was sourced, processed, and wired up first, and
looked great in isolation (a dramatic crashing wave in the same cool
blue-teal grade `BEACH_CONFIG`'s old palette already used), but failed
in context: a screenshot showed the boat sitting right at the crest of
the wave and the procedural surf lines reading as stray artifacts drawn
over the photo's own much richer wave texture, since the shot's close,
energetic framing left no calm, open horizon for those procedural
elements (built for a distant, glassy sea) to sit on believably.
Swapped for the current photo's genuinely calm, glassy water instead.

Unlike Forest, Beach keeps its moon, moon-reflection glitter path,
surf lines, and boat all procedural and drawn on top of the photo,
unchanged -- only the sky/water/sand gradient fills were replaced,
with the same Ken Burns pan/zoom technique. The glitter path especially
has to stay procedural: it's dynamically anchored to the moon's own
(randomized every wave) x-position, which a static photo can't follow.
Two things did change from the old procedural version, though:

- The photo has its own faint real stars, so `drawStars(true)`
  (reward-only, see that function's own comment) replaced the old plain
  `drawStars()` call -- same reasoning as Forest/Safari, layering a
  synthetic ambient starfield on top of real stars would just be noise.
- `BEACH_CONFIG.HORIZON_FRAC` is now a single fixed value (0.688)
  measured directly from this photo (the sharpest brightness drop down
  its own vertical center column, i.e. where the sky actually meets the
  water), rather than randomized fresh each wave the way it used to be
  -- same reasoning as Safari's own per-image `HORIZON_FRAC`: the
  glitter path/boat/surf lines have to sit on the water the photo
  actually shows, not float in open sky or sink below the visible
  shoreline the way a leftover random range would on a real photo whose
  horizon doesn't happen to fall where the range assumed.
