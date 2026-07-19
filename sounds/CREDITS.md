# Sound Credits

The instrument samples in this directory (piano, flute, trumpet, cello,
double bass, marimba, vibraphone) are derived from the **University of
Iowa Electronic Music Studios Musical Instrument Samples** database:

https://theremin.music.uiowa.edu/mis.html

These recordings have been freely available since 1997 and may be
downloaded and used for any project without restriction.

The game's active genres currently use piano, flute, cello, marimba, and
vibraphone (a relaxing/spa-style palette). Trumpet and double bass remain
in this directory from an earlier, more upbeat set of genres but aren't
referenced by any genre right now.

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
