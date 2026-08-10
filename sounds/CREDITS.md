# Sound Credits

The instrument samples in this directory (piano, flute, trumpet, cello,
double bass, marimba, vibraphone) are derived from the **University of
Iowa Electronic Music Studios Musical Instrument Samples** database:

https://theremin.music.uiowa.edu/mis.html

These recordings have been freely available since 1997 and may be
downloaded and used for any project without restriction.

The 'spa' family uses piano, flute, cello, marimba, and vibraphone (a
relaxing palette). Trumpet and double bass power the 'supperclub' premium
family (see `PREMIUM_MUSIC_UNLOCKED` in game.js) — a brighter, upbeat
swing feel.

## What was done to the source recordings

**Scale-run instruments** (flute, trumpet, cello, double bass) were
recorded as chromatic-scale takes (12+ notes per file, anechoic chamber,
16-bit/44.1kHz). Each note was:

1. Isolated from its scale-run recording via silence detection
2. Trimmed to a short one-shot (~1.6-2.5s) with a fade-out
3. Downmixed to mono and compressed to MP3

**Individually-recorded instruments** (piano, marimba, vibraphone) were
already one note per file. Each was trimmed to ~1.8-2.2s with a fade-out,
downmixed to mono, and compressed to MP3.

Dynamics used: piano/cello/trumpet at mf ("mezzo-forte"), flute at pp
("pianissimo", non-vibrato — the original ff/forte take was bright enough
to read as a car horn to some listeners, so it was re-extracted quieter),
double bass at mf pizzicato, marimba (yarn mallet) and vibraphone
(sustain, motor off) at ff.

In-game, these samples are pitch-shifted (via Web Audio's
`playbackRate`) to notes between the ones actually sampled, so a
single set of recordings covers a full musical range.

## Forest night ambience (sounds/ambient/)

Four real field recordings, not synthesized — a player's explicit
request (a synthesized-vs-recorded comparison confirmed the gap is
real, especially for anything voiced by a living throat). All CC0 or
Public Domain Mark, no attribution legally required, credited anyway:

- `wind.mp3` — "Sherwood Forest — Wind in the Trees," a field recording
  via [aporee.org / Internet Archive](https://archive.org/details/aporee_50814_57967),
  Public Domain Mark 1.0. Trimmed from a ~68-minute original.
- `crickets.mp3` — "Crickets and Frogs, Continuous Loop" (despite the
  name, this one is almost entirely crickets — confirmed by
  spectrogram, no visible low-frequency croak energy), from the
  [Frogs, Toads, Spring Peepers & Crickets](https://archive.org/details/frogs-toads-spring-peepers-crickets-sound-effects)
  collection, CC0.
- `frogs.mp3` — "Croaking Frogs," from the same collection, CC0.
  Looped from a ~13s original with a short crossfade to reach 20s.
- `owl.mp3` — "Great Horned Owl Hoot," from
  [Red Library: Animals & Birds](https://archive.org/details/Red_Library_Animals_Birds),
  CC0.

All four were loudness-normalized and trimmed with short fades, no
other editing. In-game, each one is looped (or, for the owl, retriggered
at random intervals — see `SCENE_AMBIENT_CONFIG` in game.js) with
per-repeat randomized pitch/rate, gain, and stereo pan, so the same
~20s recording never sounds like it's playing on an exact, identical
loop.

A synthesized alternative (oscillators/filtered noise, the same
technique the lofi family below uses) was built and compared side by
side before this decision — real recordings won convincingly enough
that it wasn't a close call, particularly for the owl.

## Beach night ambience (sounds/ambient/beach-*.mp3)

Same idea as the forest above — four more real field recordings, not
synthesized, revealed progressively as their own scene (see
`SCENE_AMBIENT_CONFIG` in game.js). All CC0 or Public Domain Mark:

- `beach-waves.mp3` — "Midnight ocean waves," a field recording from
  [Carrara, Italy](https://archive.org/details/aporee_63151_72659),
  Public Domain Mark 1.0. Trimmed from a ~6-minute original.
- `beach-wind.mp3` — "Struer Beach, heavy wind, distant sea," from
  [Struer, Denmark](https://archive.org/details/aporee_58339_66925),
  Public Domain Mark 1.0.
- `beach-shorebirds.mp3` — gull flock calls, from
  ["Hastings Beach: Gull Flock and Evening Shoreline"](https://archive.org/details/aporee_72526_84684),
  Public Domain Mark 1.0. Gain trimmed 20% below what shipped originally
  — player feedback: it ran a bit hot relative to the rest of the scene.
- `beach-whale.mp3` — humpback whale calls, trimmed from "Humpback whale
  song 2," a hydrophone recording made by the National Park Service in
  [Glacier Bay, Alaska](https://archive.org/details/HumpbackWhalesSongsSoundsVocalizations).
  Public domain (US government work). Replaces an earlier ship's-foghorn
  layer on player feedback that it read as jarring rather than relaxing —
  a foghorn blast is inherently a sudden, loud sound no amount of mixing
  fixes, so it was swapped for something with the same "occasional distant
  event" role but an actually calm character. High-passed and denoised
  (period hydrophone tape hiss) beyond the light touch the other three
  needed.

All four loudness-adjusted and trimmed with short fades, no other editing
beyond the whale's noise reduction above. Waves and wind loop continuously;
the gulls and whale are rarer one-shot retriggers, same distinction the
forest's owl gets — and, like the owl, now ease in over a short fade
(`AMBIENT_VARIATION.EVENT_FADE_IN_SEC` in game.js) rather than snapping
straight to full volume, on the same "sudden sounds aren't relaxing"
feedback.

## Birthday party ambience (sounds/ambient/birthday-*.mp3)

One real field recording plus three synthesized sounds this time, not
four real ones — unlike the forest/beach animal and weather sounds, a
balloon squeak, a party horn honk, and a cork pop are simple mechanical
transients archive.org has essentially no clean standalone recordings
of (it's a documents/field-recording archive, not a curated
sound-effects library), and they're exactly the kind of short, tonal
one-shot the game's own lofi drum kit (`synthesizeInstrumentSample`)
already synthesizes from oscillators and filtered noise for the same
reason. Same technique, same in-repo generation script, just baked to
a static file up front instead of rendered at runtime, so the ambient
playback engine (`SCENE_AMBIENT_CONFIG`) doesn't need a second code
path for "sometimes synthesized."

- `birthday-crowd.mp3` — real field recording, "party crowd" ambience
  from [Hasenheide, Berlin](https://archive.org/details/aporee_49872_56880),
  Public Domain Mark 1.0.
- `birthday-balloon.mp3` — synthesized: rebuilt after player feedback
  ("really strange sounds") found a real bug, not just a taste problem —
  the original built each squeak by filtering two independent noise
  segments at different center frequencies and concatenating them for a
  pitch glide, with no phase continuity across that splice, so every
  burst had an audible click at the midpoint. A squeak is also
  fundamentally a stick-slip friction tone (a wandering, mostly-pure
  pitch) in the first place, not filtered noise. Rebuilt as a single
  continuously phase-accumulated oscillator per burst instead, frequency
  following a smooth random contour — no splice, so no click, and it
  reads as tonal-squeak rather than noise-burst.
- `birthday-horn.mp3` — synthesized: simplified from 8-9 summed
  harmonics down to 4 with a faster amplitude rolloff (fewer, quieter
  upper harmonics reads as a papery party-horn blat rather than a denser
  electronic-buzz tone), and fixed a real bug in the per-harmonic detune
  — it was being applied to each harmonic's already phase-integrated
  signal directly, which compounds into large uncontrolled pitch drift
  on the upper harmonics over the note's length, rather than to each
  harmonic's own instantaneous frequency before integration.
- `birthday-cork.mp3` — synthesized: a fast noise transient, a low
  body-resonance thud, and a fizzy noise tail standing in for a cork
  pop. The transient-to-thud handoff now crossfades instead of
  hard-concatenating, removing a small level-mismatch click at that
  boundary.

Crowd and balloon loop continuously; horn and cork are rarer one-shot
retriggers. Horn and cork's gain also came down significantly (0.8/0.75
→ 0.55/0.5) — they were the loudest layers in the entire scene, well
above the 0.45-0.5 ambient bed, which put any rough edge in their
synthesis under a spotlight regardless of how the timbre itself sounded.

## Halloween ambience (sounds/ambient/halloween-*.mp3)

Four real recordings again, cozy-spooky rather than horror (see
`SLEEP_SAFE_SCENES`/`HALLOWEEN_CONFIG` in game.js for why that mood
still keeps the scene out of Sleep mode):

- `halloween-wind.mp3` — "windy day recording from under a heap of dry
  leaves," a field recording from
  [Berlin, Germany](https://archive.org/details/aporee_72432_84581),
  Creative Commons Attribution 3.0 (credited here; every recording in
  this directory is credited regardless of what its license requires).
  Trimmed from a ~3-minute original.
- `halloween-creak.mp3` — "Creaky Wood," from
  [Red Library: Creaks](https://archive.org/details/Red_Library_Creaks)
  (USC Cinema / Sunset Editorial Collection), CC0.
- `halloween-wolfhowl.mp3` — a distant wolf-pack howl, trimmed from
  ["Wolves Howl,"](https://archive.org/details/WolvesHowl_571) U.S. Fish
  and Wildlife Service, public domain (US government work) — same
  category of source as the beach whale call above.
- `halloween-raven.mp3` — a single crow/raven caw, from
  [Various Bird Sounds](https://archive.org/details/various-bird-sounds)
  (cl0udn0te), CC0.

Wind loops continuously; creak, howl, and raven are rarer one-shot
retriggers, all easing in over the same short fade
(`AMBIENT_VARIATION.EVENT_FADE_IN_SEC`) every event sound in the game
uses now.

## Christmas ambience (sounds/ambient/christmas-*.mp3)

Four real recordings, genuinely calm this time (see `SLEEP_SAFE_SCENES`
in game.js) rather than Birthday/Halloween's higher-energy sets. All CC0:

- `christmas-fire.mp3` — "Close Up Burning Fire," from
  [Red Library: Fire](https://archive.org/details/Red_Library_Fire)
  (USC Cinema / Sunset Editorial Collection).
- `christmas-wind.mp3` — "Cold Arctic wind," from
  [SSE Library: WIND](https://archive.org/details/SSE_Library_WIND)
  (same USC/Sunset collection family as the Halloween creak/Forest owl).
- `christmas-bells.mp3` — "Two Metal Bells Clank Randomly," standing in
  for sleigh bells (Pixabay/Mixkit, the platforms that actually host
  standalone sleigh-bell recordings, returned HTTP 403 to this project's
  fetch tooling) — real small metal bells clanking is, mechanically,
  what a sleigh bell jingle *is*, from
  [Red Library: Bells, Horns, Whistles](https://archive.org/details/Red_Library_Bells_Horns_Whistles).
- `christmas-chimes.mp3` — "Church Bell Chimes," from the same Bells,
  Horns, Whistles collection.

Fire and wind loop continuously; bells and chimes are rarer one-shot
retriggers, easing in over the same short fade
(`AMBIENT_VARIATION.EVENT_FADE_IN_SEC`) every event sound in the game
uses.

## The lofi genre family's instruments (rhodes, lofibass, lofikit)

Not recordings — synthesized entirely in-browser (game.js,
`synthesizeInstrumentSample` and friends) from oscillators and noise via
a short `OfflineAudioContext` render, the moment the game needs them. No
files live in this directory for these three, no sourcing/licensing
question applies, and there's nothing to attribute: it's original,
generated code. `rhodes` (electric piano) and `lofibass` are pitched —
rendered across a handful of reference notes and pitch-shifted the same
way the recorded instruments are. `lofikit` is three fixed one-shots
(kick/snare/hihat), synthesized with the classic drum-machine techniques
(pitch-swept sine for the kick, filtered noise + a tone for the snare,
high-passed noise for the hihat) that most lo-fi/chiptune web audio
projects use for exactly this reason.
