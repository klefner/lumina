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

## Beach scene (beach-day.jpg, beach-night.jpg)

Player request (2026-08-17): continue the real-photo redesign with
Beach next. First shipped as a single night-only photo (see git history
for that version's own sourcing notes); rebuilt again the same day on
direct player feedback: that first photo was an open-ocean/starry-sky
shot with no actual sand or shoreline in frame, and the scene was
hardcoded night-only. Rebuilt on Safari's own day/night architecture --
two real photos, `STATE.beachVariant` persisting across a whole block
the same way `STATE.safariVariant` does -- both showing genuine sand and
a real horizon, sourced from Pexels (free to use for commercial
purposes, no attribution legally required, credited anyway).

`STATE.beachVariant` is only ever rolled once per fresh playthrough (see
`generateBeachScene`, and `startGameFromTitle`/`handleRestartGame`
resetting it to `null`), then persists for every Beach block the rest of
that playthrough hits -- day or night, but never flip-flopping
mid-session. Sleep mode always forces it to `'night'` (player request),
same as every other sleep-safe scene here defaulting to its calmest,
dimmest look. Both the title screen's scene picker and the in-game HUD
label just say "Beach" (`SCENE_HUD_NAMES`/index.html's `<option>`) --
not "Beach at Night", which was a leftover hardcoded label from before
Beach had a day variant at all, and a real player-visible bug
(screenshot): it read "Beach at Night" even during daylight-variant
playthroughs.

- `beach-day.jpg` — "Wave on Sea Shore," via
  [Pexels](https://www.pexels.com/photo/a-beach-with-waves-and-sand-21939389/).
  A classic eye-level shoreline shot (sand foreground, a wave actually
  breaking, open horizon, blue sky) -- exactly the composition
  `BEACH_CONFIG.HORIZON_FRAC`/the ground-anchored cutouts below need.
  Resized from the original 3840x2553 to 1920x1276 and re-encoded
  (quality 74, ~415KB) for web delivery; otherwise unedited.
- `beach-night.jpg` — "Stunning Milky Way Over Sandy Beach at Night," by
  Dmytro Koplyk, via
  [Pexels](https://www.pexels.com/photo/stunning-milky-way-over-sandy-beach-at-night-33476434/).
  A genuine sandy beach (visible tire tracks and a small lifeguard
  chair -- read as authentic beach-access detail, not a flaw) under a
  real Milky Way core, chosen over several other night-sky-over-water
  candidates specifically for showing real sand, not just open water.
  Resized from the original 3840x4800 (portrait) to 1600x2000, given the
  same light denoise pass (Gaussian blur, radius 0.4px) the original
  safari-night.jpg/beach-night.jpg got to control JPEG size on
  astrophotography grain, and re-encoded (quality 74, ~243KB).

`BEACH_CONFIG.HORIZON_FRAC` is a fixed `{ day, night }` pair, one value
per photo, measured directly from its own JPEG: 0.413 for the day photo,
0.903 for the night one. Every horizon-anchored element (dolphins, the
cruise ship, the whale, the boat, the wave lines/glitter path -- palms
are anchored separately, at `sandY`, see the Beach foreground cutouts
section below) is anchored to this, mapped through the same
cover-fit/pan/zoom transform the photo itself uses, so they sit on the
water/sand line the photo actually shows as the Ken Burns cycle pans.

night's value was originally 0.672, measured the same way as Safari's
(the sharpest brightness-gradient transition down the image's own
vertical center column) -- wrong for this specific photo, and a real
player-visible bug (screenshot): the cruise ship and dolphins were
anchored high up in the middle of the starfield, nowhere near the sand
visible at the bottom of the photo. beach-night.jpg is a Milky Way
night-sky shot where individual bright stars along that one column
produce a far bigger brightness jump than the actual (much subtler,
dark-sky-to-dark-sand) horizon transition, so the single-column scan
locked onto a star instead of the real horizon, which sits much lower
in frame -- this photo is roughly 88% sky. Re-measured with a full-row
brightness AVERAGE instead (smooths out single-pixel stars, since only
the real horizon is a jump consistent across the whole row's width):
0.903.

Fixing that measurement wasn't the end of it, though (player report,
screenshot): with horizonY correctly at the real shoreline, everything
from horizonY down to sandY is real photographed SAND (that's what a
correct measurement means), while everything above horizonY is the
Milky Way sky -- and at night, real open water in near-total darkness is
visually indistinguishable from that sky, both just uniform black. The
cruise ship, dolphins, and whale still read as floating in empty air,
just now near the sand instead of up in the stars. The day photo doesn't
have this problem (a real, obviously blue-green sea fills a huge share
of that frame between horizonY and sandY), so this is night-only:
`drawBeachScene` now paints a soft tinted gradient (`rgba(8, 26, 42, …)`,
fading from a low floor alpha up to 0.6) across a synthetic "water" band
just ABOVE horizonY (`waterTopY`/`waterBottomY`, sized to 16% of canvas
height), and moves the glitter path/wave lines into that band instead of
the real-sand strip below horizonY. The cruise ship, dolphins, whale, and
boat anchor at `waterFarY` -- a point a quarter of the way down into that
band from its far (most transparent) edge, not right at its hard top
edge, where the gradient is at its most transparent and would have
undercut the whole point of adding it. Day doesn't use any of this:
`waterFarY`/`waterTopY`/`waterBottomY` all just equal `horizonY`/`sandY`
there, same as before this fix, since the real photo already provides a
visible sea to anchor to.

`drawBeachScene`'s vertical pan (`panY`) is clamped to keep that mapped
horizon within the middle 70% of the screen (Codex review catch, PR
#101): the night photo's portrait aspect (1600x2000) means `drawH` ends
up far taller than a typical wide/landscape canvas once cover-fit by
width, and the plain sine-wave pan on its own could swing far enough
that the horizon -- and everything anchored to it -- landed off the
bottom of the screen for a real stretch of the 90-second pan cycle.

## Beach foreground cutouts (art/beach-cutouts/*.webp)

Same player request, and the same real-photo-cutout technique as
Safari's tree/animal library: palm trees, dolphins, a whale, and a
cruise ship, composited over the day/night photo so the scene looks
different every playthrough rather than the same fixed procedural boat
and surf lines every time. Each file is a real photograph with its
background removed (`rembg`, the `isnet-general-use` model -- same
choice as Safari's library, for the same fine-detail-preserving reason),
sourced from Pexels (free to use for commercial purposes, no
attribution legally required, credited anyway):

- `palm-full-1.webp` and `palm-full-2.webp` — each a SINGLE real photo
  of an entire standing palm tree, trunk to crown in one frame, via
  [Pexels](https://www.pexels.com/photo/palm-trees-at-a-beach-34076502/)
  and
  [Pexels](https://www.pexels.com/photo/a-tall-palm-tree-stands-against-a-clear-blue-sky-with-a-view-of-the-ocean-and-distant-mountains-15034744/)
  respectively. Each `palm` instance in `generateBeachScene` picks one
  of the two at random, for visual variety between trees. This replaced
  a much longer, three-attempt history of trying to build a convincing
  tree out of a crown-only cutout plus a hand-drawn trunk:
  1. A backlit sunset-silhouette crown (via
     [Pexels](https://www.pexels.com/photo/palm-tree-silhouette-on-sunset-sky-5477156/))
     read as a near-solid dark blob composited small onto a bright
     daylight beach photo -- a silhouette's lighting doesn't match an
     unrelated midday scene.
  2. A better-lit crown (via
     [Pexels](https://www.pexels.com/photo/tropical-palm-trees-under-clear-blue-sky-31508264/))
     had a patch of genuinely low-confidence, partially-transparent
     `rembg` alpha around an overexposed/glare section of frond that no
     amount of erosion or re-cropping cleaned up satisfactorily.
  3. Reusing the (then-still-shipping) corner-overhang cutout's own
     already-clean crown, cropped away from its long trunk, worked
     visually -- but every version of a
     *procedural* trunk drawn underneath it (a flat solid-color
     triangle, then later a cross-trunk gradient with a slight organic
     lean and bark-ring notches) still read as an obviously fake
     cardboard-cutout trunk next to the photographic crown above it
     (player report, screenshot), and the crown cutout's own tight
     alpha-bbox crop clipped some of its lower drooping fronds where
     they'd extended past the crop -- visible as a hard cutoff edge
     right where the fake trunk met it (a second, separate player
     report, screenshot).

  Sourcing a photo of the *whole tree* sidesteps every one of these at
  once: no crown/trunk seam to fake, no clipped fronds (both source
  photos were picked specifically because the entire tree, uncropped,
  fits the frame), and a real photographic trunk with real bark texture
  and a real root flare at the base.

  Ground-anchored NOT at the horizon but at `sandY`, well within the
  photo's own visible foreground sand (see the `drawBeachScene` comment
  by the palm-drawing loop) -- an earlier version anchored the (then
  crown-only) cutout at the horizon, which is the water/sky line, and
  player feedback (screenshot) called this out directly: a cutout with
  nothing under it, sitting at the water line, read as a tree floating
  in the air over the water. A separate round of player feedback
  (screenshot) also caught the trees (along with the cruise ship)
  crowding out the dots and the score/wave text at their
  originally-shipped size -- `palm.sizeFrac` and `cruiseShip.sizeFrac`
  are both shrunk considerably from those first-shipped values.
- `dolphin.webp` — cropped from "View of a Dolphin Jumping above the
  Water Surface," via
  [Pexels](https://www.pexels.com/photo/view-of-a-dolphin-jumping-above-the-water-surface-17334473/).
  Re-cropped tighter (2026-08-18) after the generic "ground/water-anchored
  cutout touches its own bottom edge" test (see SOURCE_OF_TRUTH.md's
  Required Method) caught it: the original crop's alpha bbox extended a
  few percent past where the tail's solid content actually ends, into a
  wide, near-empty band of very faint splash mist (peak alpha ~40/255).
  `drawBeachCutout` anchors this bottom-center, so that near-empty margin
  put real, visible daylight between the tail and the water line it's
  supposed to be anchored to -- confirmed by rendering the cutout alone
  against a reference line at its own anchor point before and after.
  Re-cropped to the alpha>120 bbox instead, which trims the near-empty
  margin without touching any of the dolphin's own visible silhouette.
- `whale.webp` — cropped from "Whale's Tail," via
  [Pexels](https://www.pexels.com/photo/whale-s-tail-892548/). An
  occasional sighting (see `drawBeachScene`'s whale active/life/
  nextSpawnFrame cycle, same pattern as Safari's shooting star), not a
  fixture -- a whale tail breaking the surface is meant to read as a
  rare, notable moment.
- `cruise-ship.webp` — cropped from "White Cruise Ship" (the *Explorer of
  the Seas*, underway, no dock in frame), by Matthew Barra, via
  [Pexels](https://www.pexels.com/photo/white-cruise-ship-813011/).

  This is the SECOND source photo used for this cutout. The first
  ("White Cruise Ship on Sea," the *Marella Dream*, docked) was originally
  described here as having its dock/ropes "cleanly removed by `rembg`
  along with the sky -- no manual masking needed." That claim was wrong
  and had never actually been checked against the asset -- `rembg`
  correctly removed the sky (a different color/texture it could segment
  against) but the dock/pier is physically touching the hull in that
  source photo and reads as one continuous foreground object; `rembg`
  kept all of it, including the raised concrete pier deck, mooring
  bollards, and a receding line of dockside lamp posts. Because
  `drawBeachCutout` anchors the image's bottom edge at the horizon, the
  ship rendered with the FULL HEIGHT of that pier structure between its
  hull and the waterline -- reading as a cruise ship floating well above
  the water (player report, screenshot). This passed the Required
  Method's category-1 "contact" test the whole time, because that test
  only checks whether real opaque content exists at the bottom edge, not
  whether that content is the semantically correct part of the object --
  a dock IS real, non-transparent content, just not the ship's own hull.
  See SOURCE_OF_TRUTH.md's Required Method for the note this added to
  category 1.

  First attempt at a fix cropped the pier out of the *Marella Dream*
  photo (removing everything below the pier's own walkway line) --
  visually confirmed at the time (rendered at full production `sizeFrac`
  across multiple pan phases and both mirror directions, hull sitting
  directly on the horizon every time) and caught a follow-up review
  finding anyway: a PR reviewer (Codex) spotted that the flatter crop
  line still left several dockside lamp posts standing in front of the
  lower hull at the far right, where the receding pier's perspective
  carried them higher in frame than the crop line cleared. Rather than
  attempt a second, more careful crop of the same fundamentally-docked
  photo -- the pier runs the full width of that image with no point where
  the hull's own true waterline is even visible, so no crop line was ever
  going to cleanly separate "ship" from "dock" -- switched to a genuinely
  different photo showing the ship actually underway at sea instead,
  matching how the palm-shore-crown/procedural-trunk problem was
  ultimately solved (a whole real photo, not a patched composite).

  `rembg` (isnet-general-use) cleanly separated the ship from open sky and
  sea with no dock, pier, or any other structure in frame at all -- no
  manual masking needed, and this time actually verified: inspected the
  full alpha-channel result against a solid background before cropping,
  confirmed no residual non-ship content anywhere in the silhouette.
  Checked for the same blue color-fringe halo `palm-overhang.webp` needed
  alpha decontamination for (the sky/sea backdrop here is comparably
  saturated) -- none found; the edges here are mostly hard geometric
  shapes (hull, masts, railings) rather than fine frond-like detail, which
  gives `rembg`'s matting far less room to blend in background color
  along the boundary. Cropped to the alpha>120 bbox (1945x858) after
  confirming a wide, solid contiguous contact run at the bottom edge
  (1646px of 1949px width at alpha>150, tapering off over the final ~20
  rows -- normal soft-edge antialiasing at the hull's own waterline
  reflection, not a near-empty margin like `dolphin.webp`'s had been).
  Verified by rendering at full production `sizeFrac`
  (`CRUISE_SHIP_SIZE_FRAC.max`) across multiple pan phases and both mirror
  directions, day and night -- the hull sits directly on the rendered
  horizon in every case, no gap, no residual pier fragments anywhere in
  frame.
- `palm-overhang.webp` (REMOVED 2026-08-18, kept here only as the record
  of why) — cropped from "View of a Palm Tree on the Beach," via
  [Pexels](https://www.pexels.com/photo/view-of-a-palm-tree-on-the-beach-26551139/).
  Meant as the one exception to bottom-anchoring: a corner-hanging frond,
  anchored from a screen CORNER instead of the ground (mirrored to
  either side, picked fresh each wave) -- a palm frond hanging into frame
  from a corner is a common, recognizable beach-photo composition on its
  own terms.

  In practice this single asset produced FOUR distinct floating-tree
  defects across four rounds, each one a different root cause, before it
  was cut entirely rather than patched a fifth time:
  1. Originally shipped with a long diagonal trunk still in frame, cut
     off at the source photo's own right edge -- read fine at the
     large size this first shipped at (`sizeFrac` 0.55-0.70), where the
     cutoff point landed close enough to the screen's own edge to read
     as "continuing off-frame." A later round shrank `sizeFrac` to
     0.28-0.36 to fix an unrelated "too large, blocks the dots"
     complaint, and nobody re-verified the trunk-exits-the-frame
     illusion still held at the new size -- it didn't (player report,
     screenshot): the cutoff point is a FIXED position relative to the
     crown (proportional to `sizeFrac`), so shrinking the whole cutout
     pulled that point away from the corner and toward the screen's
     open interior at any size well under "fills most of the screen."
  2. Cropped the trunk out of the source image entirely in response --
     but the first attempt at that crop (removing everything below
     y=750 of the original) still left a genuine ~30px-wide solid trunk
     segment right at the new bottom edge, caught in PR review rather
     than by the render-and-look pass that should have caught it: that
     round's check confirmed the diagonal dangling trunk was gone but
     didn't re-scan the whole result for anything else that might still
     read as a hard cutoff -- the same "stop looking after finding one
     problem" failure this whole saga kept running into. Cropped
     further (removing another ~90px) and re-verified by measuring the
     bottom row's contiguous opaque-pixel run lengths directly (no
     single run over ~100px, all irregular widths consistent with frond
     tips, not one dominant narrow column).
  3. With the trunk genuinely gone, nothing then related the crown's own
     vertical extent to the horizon/water line at all -- on some
     Ken Burns pan states the crown's lower fronds extended down into
     the synthetic water band or the real photographed sea, reading as
     a tree growing out of the open ocean (player report, screenshot).
     Fixed by clamping the rendered height to stay a safe margin above
     `waterTopY`.
  4. Investigating a further report of the same "tree in the ocean"
     look after that clamp was in place (and confirming, by
     instrumenting the actual draw call, that the clamp math itself was
     correct -- `waterTopY` and the resulting clamped height were
     exactly as intended) led to opening the asset file directly: it is
     a symmetric photo shot from directly underneath the tree, fronds
     radiating in a full circle around a centered coconut cluster --
     0 of 886 pixels opaque on its own top row, 0 of 660 on its own
     right column. It never actually touched the corner it was drawn
     anchored to, at any crop or clamp. The first three rounds had each
     patched a real, separate symptom (an unremoved trunk, then a
     second unremoved trunk remnant, then a missing vertical bound) but
     none of them could have fixed this, because the premise underneath
     all of them -- "this asset reads as anchored to a screen corner" --
     was never true of this particular photo to begin with.

  Removed rather than re-sourced a fifth time. See SOURCE_OF_TRUTH.md's
  Required Method for the new category this added ("composition must
  match anchor role") and why every other Beach cutout doesn't have this
  risk (each one anchors to something with real, verifiable contact --
  a horizon or a shoreline -- not to an edge the asset itself was only
  assumed, never confirmed, to reach).

  Sourcing note (for the historical record): `rembg` alone left a visible
  blue color-fringe halo along every frond edge on this photo, bleeding
  in from its own saturated blue sky background -- alpha erosion alone
  (shrinking the cutout mask a couple pixels) reduced but didn't
  eliminate it. Fixed with proper alpha decontamination instead: sampling
  the source photo's actual sky color, then for every partially-
  transparent edge pixel, solving
  `foreground = (blended - (1-alpha)*sky) / alpha` to undo the blend
  rather than just trim it, before a final light erosion pass.

`drawBeachCutout` applies the same `nightTint` filter
(`brightness(0.4) saturate(0.55) contrast(1.05)`) as Safari's
`drawSafariCutout`, for the identical reason: every cutout here is a
real daylight photo, and without it a palm, dolphin, whale, or ship
would render at full midday brightness against the Milky Way whenever
the night variant is picked.

## Beach ambience wave variety (SCENE_AMBIENT_CONFIG.beach.sounds.waves)

Player request (2026-08-17): "waves of different sizes and different
ways of crashing," not one looping recording playing identically every
time. `AMBIENT_VARIATION.RATE_RANGE` ([0.94, 1.06]) already
pitch/speed-shifts every ambient layer's repeats slightly so a loop
never sounds like an exact identical replay, but that range is
deliberately subtle project-wide -- not enough on its own to read as
genuinely different-sized waves. `startLoopingAmbientLayer`/
`startEventAmbientLayer` now accept an optional per-sound `rateRange`
override (falls back to the shared default when omitted), and
`beach-waves.mp3`'s own entry sets one much wider, [0.65, 1.45]: slowed
and deepened toward the low end reads as a bigger, heavier swell; sped
up and brightened toward the high end reads as a smaller, quicker chop
-- the same real recording, genuinely reading as different waves each
repeat, the same way a pitch-shifted repeat already reads as a
different individual animal call for wildlife/owl/shorebirds elsewhere
in this file.

## Desert scene (desert-day.jpg)

Player request (2026-08-19): "a desert scene with a thunder and
lightning storm way off in the distance," desert-specific flora/fauna,
randomly placed, framed explicitly as a single-attempt test of
SOURCE_OF_TRUTH.md's Required Method (see that file, and this file's own
"Desert foreground cutouts" section below, for how each category was
applied proactively rather than after a reported failure). A real
photograph, single variant (no day/night split -- see `DESERT_CONFIG` in
game.js for why):

- `desert-day.jpg` — "Gray Sky over Mountains on Desert," by Mahdi
  Bafande, via
  [Pexels](https://www.pexels.com/photo/gray-sky-over-mountains-on-desert-14755105/),
  free to use for commercial purposes, no attribution legally required,
  credited anyway. Chosen specifically for its dramatic, storm-capable
  overcast sky over open desert mountains with a flat scrubland
  foreground -- exactly what the lightning effect and ground-anchored
  flora/fauna both need. Resized from the original to 1266×1900 and
  re-encoded for web delivery; otherwise unedited.

`DESERT_CONFIG.GROUND_FRAC` (0.88) marks where the photo's own flat
scrubland foreground actually starts, measured with a full-row
brightness scan (a real, verified jump from ~161 to ~191 across the
transition) and confirmed against a visual reference-line overlay before
being written into game.js -- not just eyeballed, the exact mistake that
produced `BEACH_CONFIG.HORIZON_FRAC.day`'s original wrong value earlier
this project (see that constant's own comment).

The storm (`drawDesertScene`, game.js) is drawn procedurally, not
photographed -- confined to the screen-space band at-or-above
`GROUND_FRAC`'s mapped position. Player correction (2026-08-19,
screenshot): the first version drew one bolt shape at a rare cadence and
read as too sparse/uniform to feel like an actual storm -- "the storm
needs to be stormy... rolling thunder, lightning flashes in the storm
clouds, occasional lightning streaked across the sky and lightning
strikes to the ground (again, all in the distance)." Rebuilt as three
distinct real phenomena (`DESERT_CONFIG.LIGHTNING_KIND_WEIGHTS`), picked
at random each trigger, all still "in the distance" per the request (the
player is never IN the storm) but now at a genuinely active cadence:
'cloud' (a diffuse in-cloud glow, no visible bolt -- the most common real
event, weighted highest since most lightning never leaves the cloud
layer), 'streak' (a jagged, forked bolt crossing roughly horizontally
between two points in the sky, cloud-to-cloud), 'strike' (a jagged,
mostly-vertical bolt reaching down to the real ground line itself, with a
brief soft impact glow where it lands -- the one kind deliberately
allowed to touch `GROUND_FRAC`'s mapped line, since a real distant strike
does visibly connect to the terrain it hits at the horizon).

## Desert foreground cutouts (art/desert-cutouts/*.webp)

Same real-photo-cutout technique as Safari/Beach's own libraries: two
desert flora species (saguaro cactus, Joshua tree) and two fauna/debris
elements (tumbleweed, roadrunner), each a SINGLE real photo showing the
entire object in its natural context -- not a composited part, per the
lesson Beach's palm-overhang and cruise-ship-dock failures both taught
(see that file's own history). Each file has its background removed via
`rembg` (`isnet-general-use` model, same choice as every other cutout
library here), sourced from Pexels (free to use for commercial purposes,
no attribution legally required, credited anyway), and every one was
checked for real "foot" contact (a contiguous run of opaque pixels at its
own bottom edge, not just a peak-alpha reading) before being wired in --
see SOURCE_OF_TRUTH.md's Required Method, category 1.

- `saguaro.webp` — from a Thalia Perla photo, via
  [Pexels](https://www.pexels.com/photo/saguaro-cactus-in-a-desert-landscape-4061938/),
  cropped to isolate a single specimen. `rembg` left one small artifact:
  a teal patch of leftover sky color at the left arm's base junction,
  fixed by targeting that exact small pixel region with a color test
  (not a broad color-based heuristic across the whole image, which was
  tried first and caught legitimate cool-toned shadow detail across the
  whole cactus instead -- reverted). Verified contact: a 41px contiguous
  opaque run at the base, tapering naturally over the final ~15 rows.
- `joshua-tree.webp` — from an Ines Martineau photo, via
  [Pexels](https://www.pexels.com/photo/joshua-tree-in-desert-landscape-35127936/),
  cropped to isolate the tree on the right side of frame. `rembg` left a
  ghosted, low-alpha remnant of a smaller background tree; a first fix
  attempt (a simple x-axis crop) didn't fully remove it, since the
  ghosting extended further into frame than expected. Fixed with a
  strict global alpha threshold (anything under alpha 200 zeroed out),
  which cleanly removed the low-confidence ghosting while preserving the
  tree's own real dead lower branch (confirmed genuine tree material, not
  a separate object, once it rendered solidly after the threshold fix).
  Verified contact: an 85px contiguous opaque run at the base.
- `tumbleweed.webp` — from an Alfo Medeiros photo, via
  [Pexels](https://www.pexels.com/photo/close-up-of-a-tumbleweed-on-a-dirt-path-14894603/),
  a single isolated tumbleweed on a dirt path. `rembg` produced a clean
  cutout with no artifacts to fix -- the wispy, fading edge texture is
  real tumbleweed detail, not a background leftover. Verified contact: a
  72px contiguous opaque run near the base (the very bottom few rows fade
  below the alpha threshold, the same real wispy taper visually confirmed
  on every other edge of this cutout, not a defect).
- `roadrunner.webp` — from a Ken Jacobsen photo, via
  [Pexels](https://www.pexels.com/photo/roadrunner-standing-on-rocky-ground-35388821/),
  a roadrunner standing on visible rocky ground with its feet in frame.
  `rembg` produced a clean cutout with no artifacts to fix. Verified
  contact: a 28px contiguous opaque run at the base (appropriately narrow
  for a bird's feet, confirmed to be the actual feet position, not a
  stray tail-feather wisp, by checking the x-range of the bottom-most
  opaque pixels against the visible bird shape).

`drawDesertCutout`/`drawDesertTumbleweed` (game.js) apply no night-tint
filter (unlike Beach/Safari's cutouts) -- Desert has no night variant, so
there's no darkened-for-moonlight case to handle.

Desert's ambient sounds (`desert-wind.mp3`, `desert-thunder.mp3`) are
credited in `sounds/CREDITS.md`, alongside every other scene's ambience.
