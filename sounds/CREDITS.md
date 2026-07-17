# Sound Credits

The instrument samples in this directory (piano, flute, trumpet, cello,
double bass) are derived from the **University of Iowa Electronic Music
Studios Musical Instrument Samples** database:

https://theremin.music.uiowa.edu/mis.html

These recordings have been freely available since 1997 and may be
downloaded and used for any project without restriction.

## What was done to the source recordings

The original recordings are chromatic-scale takes (12+ notes per file,
anechoic chamber, 16-bit/44.1kHz). Each note was:

1. Isolated from its scale-run recording via silence detection
2. Trimmed to a short one-shot (~1.6-2.5s) with a fade-out
3. Downmixed to mono and compressed to Ogg Vorbis

Dynamics used: piano/cello/trumpet at mf ("mezzo-forte"), flute at ff
("forte"), double bass at mf pizzicato.

In-game, these samples are pitch-shifted (via Web Audio's
`playbackRate`) to notes between the ones actually sampled, so a
single set of recordings covers a full musical range.
