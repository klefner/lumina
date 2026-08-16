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

  **Second correction (player feedback, 2026-08-14):** that rebuild fixed
  the click but overshot the "clean, mostly-pure tone" reasoning above —
  measured against the actual file, each burst was a short (~150-280ms),
  genuinely pure pitch glide around 1-3kHz, repeated on a steady ~1-1.5s
  cadence. That's not a squeak's acoustic signature, it's a bird/chick
  chirp's: a clean tonal peep with sharp onset/offset and silence between
  calls. Reported by a player as sounding "exactly like a baby chicken
  chirping" — accurate. A real rubber-on-rubber squeak is a stick-slip
  friction sound: rougher and noisier (not one pure partial), amplitude-
  stutters as grip repeatedly catches and releases rather than one smooth
  envelope, and is sustained for as long as the rub lasts (hundreds of ms
  to ~1s), not a brief discrete peep. Rebuilt again: same relaxation-
  oscillator carrier, but with fast pitch jitter and stick-slip amplitude
  modulation layered on top of the slow glide, a thin filtered-noise grit
  layer mixed in, longer (0.4-0.85s) events, and wider gaps between them.
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

Five real recordings, cozy-spooky rather than horror (see
`SLEEP_SAFE_SCENES`/`HALLOWEEN_CONFIG` in game.js for why that mood
still keeps the scene out of Sleep mode). The wolf howl and raven caw
that used to round this set out were swapped for a ghost moan, a
distant witch cackle, and trick-or-treating kids on player feedback
that the old pair read as generic nighttime-woods sounds rather than
anything specifically Halloween:

- `halloween-wind.mp3` — "windy day recording from under a heap of dry
  leaves," a field recording from
  [Berlin, Germany](https://archive.org/details/aporee_72432_84581),
  Creative Commons Attribution 3.0 (credited here; every recording in
  this directory is credited regardless of what its license requires).
  Trimmed from a ~3-minute original.
- `halloween-trickortreat.mp3` — kids' voices, laughing and playing
  outside, from "trick or treat.wav" by
  [cognito perceptu](https://freesound.org/people/cognito%20perceptu/sounds/31151/)
  ("Kids trick-or-treating in a field as adults howl and laugh and act
  scary," per the uploader), CC0. A ~20s window trimmed from the
  ~82.5s original, matching the wind loop's length.
- `halloween-creak.mp3` — "Creaky Wood," from
  [Red Library: Creaks](https://archive.org/details/Red_Library_Creaks)
  (USC Cinema / Sunset Editorial Collection), CC0.
- `halloween-ghost.mp3` — a low, sustained moan, from "R15-58-Zombies
  Moaning" in
  [Red Library: Voices Mixed](https://archive.org/details/Red_Library_Voices_Mixed)
  (same collection family as the creak above), CC0. Trimmed from ~11.9s
  to ~11.1s (a trailing half-second of silence cut).
- `halloween-witchcackle.mp3` — "Witch laugh.wav" by
  [Sulainar](https://freesound.org/people/Sulainar/sounds/471613/),
  CC0. The source recording is close and theatrical, not distant, so
  getting "in the distance" (the actual ask) took more than a trim: the
  first two laugh bursts (~8.5s of the 26s original) were low-passed,
  given a soft echo tail, and brought down in level -- baked into the
  file itself rather than left to in-game gain alone, so it reads as
  distant on any playback path.

Wind and trick-or-treat loop continuously; creak, ghost, and witch
cackle are rarer one-shot retriggers, all easing in over the same short
fade (`AMBIENT_VARIATION.EVENT_FADE_IN_SEC`) every event sound in the
game uses now.

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

## Safari ambience (sounds/ambient/safari-*.mp3)

An original composition, not a recording or a found track — the
player's own brief explicitly asked for a "music-generation or
composition brief," not a sourced song, for a contemporary
African-inspired world-music cue evoking a bus ride leaving Disney's
Animal Kingdom: moderate walking-pace tempo, soft hand percussion,
kalimba/marimba-style melody, warm bass, no brass or synth leads.

- `safari-song.mp3` — the main melodic bed. Built at 96 BPM (comfortably
  inside the brief's 95-115 range) as an 8-bar loop in A minor
  pentatonic, chosen specifically so 8 bars lands on exactly 20.0
  seconds — no fractional-bar seam for the game's own loop crossfade
  (`AMBIENT_VARIATION.CROSSFADE_SEC`) to cross. The melodic/harmonic
  layers reuse this project's own real sampled instruments rather than
  synthesizing timbre from scratch: `marimba` (the ostinato — the
  brief's own "kalimba or marimba-like wooden mallet tones"),
  `doublebass` (root-note bass, one warm note per bar), `flute` (one
  short, soft phrase around bar 5 — "occasional melodic color"), and
  `cello` (very quiet sustained notes underneath, standing in for the
  brief's "soft sustained pad"). The percussion has no equivalent
  sample in this project, so it's synthesized: a low djembe-like tone on
  a steady 4/4 pulse, a shekere-like filtered-noise shaker on a triplet
  subdivision underneath it (the brief's "gentle polyrhythmic feel"),
  and an occasional soft frame-drum tap. Mixed with a mild low-pass
  roll-off and a short, soft algorithmic reverb (a handful of decaying
  taps, not a real impulse response) for the brief's own "playing
  through bus speakers" description.
- `safari-engine.mp3` — a continuous, very quiet bus engine/road hum
  (a few closely-spaced low sine tones with slow drift, plus low-passed
  noise for tire/road texture) — grounds the scene as "riding in a
  vehicle" without competing with the song.

`safari-song.mp3` and `safari-engine.mp3` synthesized/composed in
Python (numpy + scipy), not in game.js — a one-time build step, same as
the birthday balloon resynthesis earlier in this project's history, not
something that needs to run again at play time.

### Real field recordings (player request, 2026-08-16)

The rest of the scene's ambience is real recordings, not synthesized --
matching the same real-over-synthetic preference forest/beach/halloween/
christmas's own ambience already established (see those sections above),
and specifically requested for Safari after the fact ("find actual
recordings of Safari related sounds... within the same kind of variable
ranges that we apply to other background ambiance notes" -- i.e. the
same `AMBIENT_VARIATION` per-repeat pitch/gain/pan jitter and crossfade
every other real-recording layer in this file already gets, no special
handling). All three below are CC0/Public Domain, credited anyway:

- `safari-wind.mp3` — "Jim Cook's wind; bluster; prairie wind," from
  [SSE Library: WIND](https://archive.org/details/SSE_Library_WIND)
  (same USC/Sunset Editorial collection family as the Halloween creak/
  Forest owl/Christmas wind) — open grassland wind, not arctic or
  forest, picked specifically over that collection's own "desert wind"
  option since a savanna is grassland, not sand. Trimmed to a steady
  20s stretch from the original ~72s recording.
- `safari-insects.mp3` — "Summer cicadas," a field recording from
  Parque Vale do Silêncio, Lisbon, Portugal, via
  [aporee.org / Internet Archive](https://archive.org/details/aporee_20041_23336),
  Public Domain Mark 1.0 (same source/license as the Forest wind
  recording). Deliberately cicadas, not crickets, despite Red Library's
  own crickets collection being the closer-to-hand option -- Forest's
  own ambience already uses crickets as its signature night-insect
  sound, and a daytime cicada drone reads as a distinctly different,
  hotter, more open-country texture than Forest's chirping. Trimmed to
  a steady 22s stretch from the original ~5m35s recording.
- `safari-wildlife.mp3` — "Elephant trumpet," from
  [Red Library: Animals Misc](https://archive.org/details/Red_Library_Animals_Misc)
  (the same collection Christmas's bells/chimes and this file's earlier
  entries come from) — replaces an earlier synthesized elephant-rumble
  placeholder (see git history) with a real trumpet call, one single
  clean blast trimmed out of a ~52s recording containing several.

All three trimmed/faded with ffmpeg (two-pass: trim first, then fade on
the trimmed clip's own timeline -- combining seek and `afade` in one
pass produced silent output on this project's ffmpeg build, since the
filter read `afade`'s start time against the untrimmed file's original
timestamps rather than the seeked clip's own).

## The 'savanna' genre family's kalimba voice (interactive gameplay music)

Distinct from the two entries above -- those are the Safari scene's
*ambient* background bed (SCENE_AMBIENT_CONFIG, always playing quietly
underneath). This entry is the *interactive* dot-connecting music engine
(GENRE_FAMILIES/generateSong) instead -- a completely separate system,
covered by its own `sceneOnly: 'safari'` genre family ('savanna') so the
music a player actually triggers by connecting dots also sounds African-
inspired while that scene is up, not a scene-blind random pick from
spa/lofi/supperclub the way every scene but Halloween's 'eerie' family
used to work.

Like the lofi family's rhodes/lofibass/lofikit and lullaby's musicbox,
the family's own kalimba (thumb piano) voice is synthesized in-browser
at decode time (`synthesizeKalimbaNote`, game.js), not a recording -- no
free-license kalimba sample set was available to source cleanly. A sine
fundamental with a sharp pluck attack, an inharmonic upper partial
(3.01x the fundamental, not a clean octave/fifth -- real metal tines
don't resonate on harmonic ratios the way a plucked string does) for
the characteristic metallic "buzz," and a very short high-passed noise
burst at onset for the thumbnail-on-metal contact transient. The
family's other two voices are real recordings already sourced above:
vibraphone (pad) and doublebass (drone/bass, per the same "warm,
rounded, not heavy sub" brief the ambient track used).
