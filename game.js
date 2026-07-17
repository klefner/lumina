// ============================================================
// SECTION 1: CONSTANTS AND CONFIGURATION
// ============================================================
const CONFIG = {
  // Canvas
  EDGE_MARGIN: 70,           // Minimum px from screen edge for dot placement
  MIN_DOT_DISTANCE: 110,     // Minimum px between any two dot centers

  // Dots
  DOT_RADIUS_BASE: 20,       // Base radius of a dot in px
  DOT_RADIUS_IDLE_MAX: 22,   // Max radius during idle pulse
  DOT_RADIUS_CONNECTED_MAX: 30, // Max radius during connected pulse
  DOT_HIT_RADIUS: 44,        // Touch detection radius (larger than visual for ease of use)
  DOT_PULSE_SPEED: 0.04,     // Phase increment per frame

  // Lines
  LINE_WIDTH: 3,
  LINE_GLOW_BLUR: 18,
  LINE_FADE_SPEED: 0.003,    // Alpha decrement per frame per point
  LINE_POINT_INTERVAL: 4,    // Record a point every N pixels of movement
  LINE_SMOOTHING: 0.18,      // Low-pass filter strength on raw input (lower = smoother, laggier)

  // Audio
  BEAT_BPM: 60,

  // Wave
  STARTING_PAIRS: 3,         // Number of color pairs in Wave 1
  PAIRS_PER_WAVE_INCREASE: 2,// Add one pair every N waves
  MAX_PAIRS: 6,              // Maximum color pairs ever shown
  WAVE_COMPLETE_LISTEN_SEC: 3.5, // how long the full song plays before the fade-out begins
};

const FADE_CONFIG = {
  OUT_DURATION_SEC: 0.6, // fade-to-black speed — the song's volume ramps down over the same span
  IN_DURATION_SEC: 0.6,  // fade-from-black speed for the new wave
};

// Color palette — each index is one instrument/color
const INSTRUMENTS = [
  { hex: '#00FFFF', glow: 'rgba(0,255,255,',   name: 'crystal' },
  { hex: '#FF00FF', glow: 'rgba(255,0,255,',   name: 'bloom'   },
  { hex: '#FFD700', glow: 'rgba(255,215,0,',   name: 'gold'    },
  { hex: '#00FF88', glow: 'rgba(0,255,136,',   name: 'jade'    },
  { hex: '#FF6644', glow: 'rgba(255,102,68,',  name: 'ember'   },
  { hex: '#AA88FF', glow: 'rgba(170,136,255,', name: 'violet'  },
];

// Procedural song genres. Each defines a proper 7-note scale (so diatonic
// triads are well-formed), a chord progression (scale degrees, cycled one
// chord per bar), a per-bar rhythmic "groove" that biases where melody
// notes land, a drum pattern, and the instrumentation for lead/bass/pad.
// Three genres use real sampled instruments (recorded, pitch-shifted —
// see sounds/CREDITS.md); chiptune keeps its fully synthesized 8-bit voices
// on purpose, since that's genuinely what defines the genre.
const GENRES = [
  {
    name: 'ambient', bpm: 68, rootMidi: 60,
    scaleIntervals: [0, 2, 4, 5, 7, 9, 11], // Ionian
    chordProgression: [0, 5, 3, 4],          // I - vi - IV - V
    instruments: { lead: 'flute', bass: 'doublebass', pad: 'cello' },
    bassOnBeatThree: false,
    grooveWeights: [0.5, 0.1, 0.3, 0.1, 0.4, 0.1, 0.3, 0.1],
    drumPattern: {
      kick:  [1, 0, 0, 0, 0, 0, 0, 0],
      snare: [0, 0, 0, 0, 0, 0, 0, 0],
      hihat: [0, 0, 1, 0, 0, 0, 1, 0],
    },
  },
  {
    name: 'synthwave', bpm: 100, rootMidi: 57,
    scaleIntervals: [0, 2, 3, 5, 7, 8, 10], // Aeolian (natural minor)
    chordProgression: [0, 5, 2, 6],          // i - VI - III - VII
    instruments: { lead: 'trumpet', bass: 'doublebass', pad: 'cello' },
    bassOnBeatThree: true,
    grooveWeights: [0.8, 0.3, 0.6, 0.3, 0.8, 0.3, 0.6, 0.4],
    drumPattern: {
      kick:  [1, 0, 1, 0, 1, 0, 1, 0],
      snare: [0, 0, 1, 0, 0, 0, 1, 0],
      hihat: [0, 1, 0, 1, 0, 1, 0, 1],
    },
  },
  {
    name: 'lofi', bpm: 78, rootMidi: 62,
    scaleIntervals: [0, 2, 3, 5, 7, 9, 10], // Dorian
    chordProgression: [1, 4, 0, 5],          // ii - V - I - vi
    instruments: { lead: 'piano', bass: 'doublebass', pad: 'cello' },
    bassOnBeatThree: false,
    grooveWeights: [0.6, 0.2, 0.4, 0.5, 0.5, 0.2, 0.4, 0.6],
    drumPattern: {
      kick:  [1, 0, 0, 0, 1, 0, 0, 0],
      snare: [0, 0, 0, 1, 0, 0, 1, 0],
      hihat: [1, 0, 1, 0, 1, 0, 1, 1],
    },
  },
  {
    name: 'chiptune', bpm: 128, rootMidi: 64,
    scaleIntervals: [0, 2, 4, 5, 7, 9, 11], // Ionian
    chordProgression: [0, 4, 5, 3],          // I - V - vi - IV
    instruments: { lead: 'synth-square', bass: 'synth-bass', pad: 'synth-pad' },
    bassOnBeatThree: true,
    grooveWeights: [0.9, 0.5, 0.7, 0.5, 0.9, 0.5, 0.7, 0.6],
    drumPattern: {
      kick:  [1, 0, 0, 1, 1, 0, 0, 1],
      snare: [0, 0, 1, 0, 0, 0, 1, 0],
      hihat: [1, 0, 1, 0, 1, 0, 1, 0],
    },
  },
];

// Real instrument samples: recorded, individually-pitched one-shots from
// the University of Iowa Electronic Music Studios (free for any use — see
// sounds/CREDITS.md), pitch-shifted at playback via playbackRate to cover
// notes between the ones actually sampled.
// Vertical-layering role order (see generateSong): each connected pair opens
// one of these as a persistent "stem," all locked to the same shared chord
// progression and beat clock — the standard adaptive-game-music technique
// (used by FMOD/Wwise-style systems) for making independently-triggered
// layers always sound like one arrangement rather than random fragments.
// Max 6 pairs, one role each: melody, then harmony support, then percussion.
const CHUNK_ROLES = ['lead', 'bass', 'pad', 'kick', 'snare', 'hihat'];

const SAMPLE_MANIFEST = {
  piano: ['A3', 'C4', 'E4', 'Ab4', 'C5', 'E5', 'Ab5', 'C6'],
  flute: ['B3', 'C4', 'Db4', 'D4', 'Eb4', 'E4', 'F4', 'Gb4', 'G4', 'Ab4', 'A4', 'Bb4', 'B4', 'C5', 'Db5', 'D5', 'Eb5', 'E5', 'F5', 'Gb5', 'G5', 'Ab5', 'A5', 'Bb5', 'B5', 'C6', 'Db6', 'D6', 'Eb6', 'E6', 'F6', 'Gb6', 'G6', 'Ab6', 'A6', 'Bb6', 'B6'],
  trumpet: ['C4', 'Db4', 'D4', 'Eb4', 'E4', 'F4', 'Gb4', 'G4', 'Ab4', 'A4', 'Bb4', 'B4', 'C5', 'Db5', 'D5', 'Eb5', 'E5', 'F5', 'Gb5', 'G5', 'Ab5', 'A5', 'Bb5', 'B5'],
  cello: ['D3', 'Eb3', 'E3', 'F3', 'Gb3', 'G3', 'Ab3', 'A3', 'Bb3', 'B3', 'C4', 'Db4', 'D4', 'Eb4', 'E4', 'F4', 'Gb4', 'G4', 'Ab4', 'A4', 'Bb4'],
  doublebass: ['E1', 'F1', 'Gb1', 'G1', 'Ab1', 'A1', 'Bb1', 'B1', 'C2', 'Db2', 'D2', 'Eb2', 'E2', 'F2', 'Gb2', 'G2', 'Ab2', 'A2', 'Bb2', 'B2'],
};

const STARFIELD_CONFIG = {
  MAX_STARS: 900,
  STARS_PER_CONNECTION: 40,
  CONNECTION_STAR_RADIUS: 100,   // scatter radius around each connected dot
  WAVE_COMPLETE_FILL_COUNT: 60, // additional stars scattered on wave complete
  STAR_FADE_IN_SPEED: 0.02,
  TWINKLE_SPEED_MIN: 0.01,
  TWINKLE_SPEED_MAX: 0.03,
};

const SPACE_CONFIG = {
  MAX_OBJECTS: 4,
  SPAWN_INTERVAL_FRAMES: 360, // ~6s at 60fps
  TYPES: ['asteroid', 'asteroid', 'satellite', 'comet'],
};

// The traveling "drip" light shown on each connection once the whole wave
// is connected and the dots are pulsing to the beat — a small bead of light
// that slides along the drawn line like wax dripping down a fishing line,
// slow-to-fast per beat, then reversing direction on the next beat.
const TRAVELING_LIGHT_CONFIG = {
  RADIUS: 5,
  TAIL_STEPS: 4,
  TAIL_BEAT_SPACING: 0.045,
};

const BARRIER_CONFIG = {
  START_WAVE: 3,          // barriers begin appearing at this wave
  WAVES_PER_BARRIER: 2,   // one more barrier every N waves after START_WAVE
  MAX_BARRIERS: 4,
  MIN_LENGTH: 130,
  MAX_LENGTH: 240,
  DOT_CLEARANCE: 60,      // keep barriers this far from any dot center
  SCREEN_CLEARANCE: 10,
};

// ============================================================
// SECTION 2: STATE
// ============================================================
const STATE = {
  phase: 'TITLE',      // TITLE | PLAYING | WAVE_COMPLETE
  wave: 0,
  score: 0,

  dots: [],            // Array of dot objects
  connections: [],     // Array of completed connection objects
  lines: [],           // Array of fading line objects
  barriers: [],        // Array of static obstacle segments for this wave

  activeDot: null,     // The dot currently being dragged from
  currentPath: [],     // Points being drawn right now [{x, y}]
  isDrawing: false,
  smoothedCursor: { x: 0, y: 0 }, // low-pass-filtered pointer position, tracks raw input each move

  audioCtx: null,      // Created on first gesture
  beatInterval: null,  // setInterval reference for beat pulse
  beatTick: 0,         // Increments each beat

  song: null,          // Procedurally generated song for the current wave
  beatSync: null,      // { startTime, bpm } — drives unison dot pulsing while the full song plays
  fade: null,          // { alpha, direction: 'out'|'in'|'idle', onComplete } — canvas black transition between waves

  activeSources: [],   // Every scheduled oscillator/buffer source currently pending or playing —
                        // tracked so a wave transition can hard-stop everything, not just mute it.
  chunkGains: [],       // One persistent GainNode per pair — starts muted, ramped open on connect,
                        // so the whole song builds up in place rather than replaying from scratch.

  sampleBuffers: {},   // { piano: { A3: AudioBuffer, ... }, flute: {...}, ... } — decoded lazily
  sampleBytesLoaded: false, // raw fetch finished (kicked off at page load)

  stars: [],           // Background starfield for the current wave — resets each wave
  spaceObjects: [],    // Drifting asteroids / comets / satellites
  spaceSpawnTimer: 0,
};

// ============================================================
// SECTION 3: MUSIC ENGINE (procedural song generation & playback)
// ============================================================
function initAudio() {
  if (!STATE.audioCtx) {
    STATE.audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    // Master bus: gain + compressor so many overlapping notes (the full-song
    // finale) don't clip, and so per-note volumes can stay comfortably audible
    // on phone speakers. Tuned aggressively (low threshold, high ratio, fast
    // attack) to act as a safety limiter against dense polyphony.
    const compressor = STATE.audioCtx.createDynamicsCompressor();
    compressor.threshold.value = -32;
    compressor.knee.value = 12;
    compressor.ratio.value = 16;
    compressor.attack.value = 0.002;
    compressor.release.value = 0.2;
    const masterGain = STATE.audioCtx.createGain();
    masterGain.gain.value = 1.0;
    compressor.connect(masterGain);
    masterGain.connect(STATE.audioCtx.destination);
    STATE.masterBus = compressor;
    STATE.masterGain = masterGain;

    // Track the decode promise so startWave can wait for it before
    // scheduling the first wave's song — scheduleLoopingSong calls
    // playSample synchronously for every note up front, so if decoding
    // isn't finished by then, those notes would silently never play.
    STATE.samplesReadyPromise = decodeAllSamples();
  }

  // iOS Safari (especially standalone/home-screen PWAs) frequently leaves the
  // context suspended even when created inside a user gesture, and can fail
  // to fully engage the hardware audio session until a buffer is actually
  // played. Resume + play a silent buffer synchronously on every gesture as
  // a robust unlock — cheap and idempotent if already unlocked.
  if (STATE.audioCtx.state === 'suspended') {
    STATE.audioCtx.resume();
  }
  const unlockBuffer = STATE.audioCtx.createBuffer(1, 1, 22050);
  const unlockSource = STATE.audioCtx.createBufferSource();
  unlockSource.buffer = unlockBuffer;
  unlockSource.connect(STATE.audioCtx.destination);
  unlockSource.start(0);
}

// --- Sample loading -----------------------------------------------------
// Raw bytes are fetched as soon as the page loads (no AudioContext needed
// for a plain fetch), overlapping with the "tap to begin" dwell time.
// Decoding happens once the AudioContext exists (first user gesture).
let sampleRawBytes = {};

function preloadSampleBytes() {
  for (const instrument in SAMPLE_MANIFEST) {
    sampleRawBytes[instrument] = {};
    SAMPLE_MANIFEST[instrument].forEach(note => {
      fetch(`sounds/${instrument}/${instrument}_${note}.ogg`)
        .then(r => r.arrayBuffer())
        .then(buf => { sampleRawBytes[instrument][note] = buf; })
        .catch(() => { /* sample missing — playSample falls back gracefully */ });
    });
  }
}

async function decodeAllSamples() {
  for (const instrument in SAMPLE_MANIFEST) {
    STATE.sampleBuffers[instrument] = {};
    for (const note of SAMPLE_MANIFEST[instrument]) {
      const wait = (ms) => new Promise(r => setTimeout(r, ms));
      let raw = sampleRawBytes[instrument] && sampleRawBytes[instrument][note];
      let attempts = 0;
      while (!raw && attempts < 20) { // fetch may still be in flight — wait briefly
        await wait(100);
        raw = sampleRawBytes[instrument] && sampleRawBytes[instrument][note];
        attempts++;
      }
      if (!raw) continue;
      try {
        const audioBuffer = await STATE.audioCtx.decodeAudioData(raw.slice(0));
        STATE.sampleBuffers[instrument][note] = audioBuffer;
      } catch (e) { /* skip — playSample falls back gracefully */ }
    }
  }
}

const NOTE_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

function noteNameToMidi(name) {
  const m = /^([A-G]b?)(-?\d+)$/.exec(name);
  const octave = parseInt(m[2], 10);
  return (octave + 1) * 12 + NOTE_NAMES.indexOf(m[1]);
}

function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function scaleMidi(genre, degreeIndex, octaveOffset) {
  const scaleLen = genre.scaleIntervals.length;
  const octave = Math.floor(degreeIndex / scaleLen) + octaveOffset;
  const degree = ((degreeIndex % scaleLen) + scaleLen) % scaleLen;
  return genre.rootMidi + octave * 12 + genre.scaleIntervals[degree];
}

function scaleFreq(genre, degreeIndex, octaveOffset) {
  return midiToFreq(scaleMidi(genre, degreeIndex, octaveOffset));
}

function makeNoiseBuffer(durSec) {
  const ctx = STATE.audioCtx;
  const n = Math.max(1, Math.round(ctx.sampleRate * durSec));
  const buffer = ctx.createBuffer(1, n, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < n; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

// Registers a scheduled source node so a wave transition can hard-stop it
// later, even if it was scheduled far in the future (the whole song is
// scheduled up front). Without this, notes queued for beats past the
// transition point would still fire into the next wave once volume returns.
function trackSource(node) {
  STATE.activeSources.push(node);
  return node;
}

// Hard-stops every pending/playing note at the given time and clears
// tracking. Called when a wave's fade-to-black begins, timed to finish
// exactly as the fade completes, so nothing from this wave's song can ever
// leak into the next one.
function stopAllScheduledAudio(atTime) {
  for (const node of STATE.activeSources) {
    try { node.stop(atTime); } catch (e) { /* already stopped */ }
  }
  STATE.activeSources = [];
}

// --- Real instrument sample playback -----------------------------------
// Recorded, individually-pitched note samples (see SAMPLE_MANIFEST), pitch-
// shifted via playbackRate to reach notes between the ones actually
// sampled. Falls back to silence gracefully if a sample hasn't finished
// decoding yet (should be rare — decoding happens on the same gesture that
// unlocks audio, well before the first note is scheduled to play).
function nearestSampleNote(instrument, targetMidi) {
  const notes = SAMPLE_MANIFEST[instrument];
  if (!notes) return null;
  let best = null, bestDist = Infinity;
  for (const name of notes) {
    const dist = Math.abs(noteNameToMidi(name) - targetMidi);
    if (dist < bestDist) { bestDist = dist; best = name; }
  }
  return best;
}

function playSample(instrument, targetMidi, t, peak, dest) {
  const buffers = STATE.sampleBuffers[instrument];
  if (!buffers) return;
  const nearestName = nearestSampleNote(instrument, targetMidi);
  if (!nearestName) return;
  const buffer = buffers[nearestName];
  if (!buffer) return;

  const ctx = STATE.audioCtx;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.playbackRate.value = Math.pow(2, (targetMidi - noteNameToMidi(nearestName)) / 12);

  const gain = ctx.createGain();
  gain.gain.value = peak;

  src.connect(gain);
  gain.connect(dest);
  trackSource(src).start(t);
}

function playSampleChord(instrument, midiList, t, peak, dest) {
  midiList.forEach(midi => playSample(instrument, midi, t, peak, dest));
}

// --- Synthesized voices (chiptune only) --------------------------------
// Chiptune keeps fully synthesized 8-bit voices on purpose — that IS the
// genre's authentic sound, unlike the other genres' "computer sounding"
// leads which real samples were specifically brought in to fix.

// Punchy square lead — kept deliberately "chip" in character since that
// 8-bit voice is genuinely what defines the chiptune genre, but taken
// through a mild static lowpass to take the edge off the raw square wave's
// harsh upper harmonics (measured to carry ~5x the high-frequency energy
// of the other leads otherwise).
function playSquareLead(freq, t, dur, peak, dest) {
  const ctx = STATE.audioCtx;
  const osc = ctx.createOscillator();
  osc.type = 'square';
  osc.frequency.setValueAtTime(freq, t);

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.Q.value = 0.5;
  filter.frequency.value = Math.min(4500, freq * 4);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(peak, t + 0.008);
  gain.gain.setValueAtTime(peak, t + Math.max(0.008, dur * 0.5));
  gain.gain.exponentialRampToValueAtTime(0.001, t + dur + 0.05);

  osc.connect(filter);
  filter.connect(gain);
  gain.connect(dest);
  trackSource(osc).start(t);
  osc.stop(t + dur + 0.08);
}

// Bass: a sawtooth + sub-octave sine through a filter that snaps closed
// right after the attack, giving the note a percussive "thump" instead of
// a static drone.
function playBassNote(freq, t, dur, peak, dest) {
  const ctx = STATE.audioCtx;
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(freq, t);

  const sub = ctx.createOscillator();
  sub.type = 'sine';
  sub.frequency.setValueAtTime(freq / 2, t);

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.Q.value = 0.6;
  filter.frequency.setValueAtTime(freq * 4, t);
  filter.frequency.exponentialRampToValueAtTime(freq * 1.5, t + 0.15);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(peak, t + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.001, t + dur);

  osc.connect(filter);
  sub.connect(filter);
  filter.connect(gain);
  gain.connect(dest);
  trackSource(osc).start(t); osc.stop(t + dur + 0.1);
  trackSource(sub).start(t); sub.stop(t + dur + 0.1);
}

// Pad: three detuned triangle voices (root/3rd/5th of the chord) through a
// soft lowpass with a slow attack, for a warm sustained wash under everything.
function playPadChord(freqs, t, dur, peak, dest) {
  const ctx = STATE.audioCtx;
  freqs.forEach((freq, i) => {
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq * (1 + (i - 1) * 0.0015), t);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 0.7;
    filter.frequency.value = freq * 3;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(peak, t + 0.5);
    gain.gain.setValueAtTime(peak, t + Math.max(0.5, dur * 0.7));
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur + 0.6);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(dest);
    trackSource(osc).start(t);
    osc.stop(t + dur + 0.7);
  });
}

function playKick(t, dest) {
  const ctx = STATE.audioCtx;
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(150, t);
  osc.frequency.exponentialRampToValueAtTime(40, t + 0.12);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.9, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);

  osc.connect(gain);
  gain.connect(dest);
  trackSource(osc).start(t);
  osc.stop(t + 0.25);
}

function playSnare(t, dest) {
  const ctx = STATE.audioCtx;
  const noise = ctx.createBufferSource();
  noise.buffer = makeNoiseBuffer(0.15);

  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 1800;
  filter.Q.value = 0.8;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.5, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.14);

  noise.connect(filter);
  filter.connect(gain);
  gain.connect(dest);
  trackSource(noise).start(t);
  noise.stop(t + 0.16);

  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(200, t);
  const oscGain = ctx.createGain();
  oscGain.gain.setValueAtTime(0.25, t);
  oscGain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
  osc.connect(oscGain);
  oscGain.connect(dest);
  trackSource(osc).start(t);
  osc.stop(t + 0.09);
}

function playHihat(t, dest) {
  const ctx = STATE.audioCtx;
  const noise = ctx.createBufferSource();
  noise.buffer = makeNoiseBuffer(0.06);

  const filter = ctx.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.value = 7500;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.14, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);

  noise.connect(filter);
  filter.connect(gain);
  gain.connect(dest);
  trackSource(noise).start(t);
  noise.stop(t + 0.06);
}

function playScheduledNote(note, startTime, beatDur, dest) {
  const t = startTime + note.beat * beatDur;
  const vel = note.vel || 1;
  switch (note.role) {
    case 'lead':
      if (note.instrument === 'synth-square') playSquareLead(note.freq, t, note.dur * beatDur, 0.16 * vel, dest);
      else playSample(note.instrument, note.midi, t, 0.7 * vel, dest);
      break;
    case 'bass':
      if (note.instrument === 'synth-bass') playBassNote(note.freq, t, note.dur * beatDur, 0.24 * vel, dest);
      else playSample(note.instrument, note.midi, t, 0.55 * vel, dest);
      break;
    case 'pad':
      if (note.instrument === 'synth-pad') playPadChord(note.freqs, t, note.dur * beatDur, 0.09 * vel, dest);
      else playSampleChord(note.instrument, note.midiList, t, 0.28 * vel, dest);
      break;
    case 'kick': playKick(t, dest); break;
    case 'snare': playSnare(t, dest); break;
    case 'hihat': playHihat(t, dest); break;
  }
}

// Humanizes a scheduled beat position with a small random offset so notes
// don't land on a perfectly robotic grid — real players (and a conductor
// keeping an ensemble loosely together, not a metronome) never do.
function humanizeBeat(beat, amountBeats) {
  return beat + (Math.random() * 2 - 1) * amountBeats;
}

// Small per-note volume variance ("dynamics") so repeated notes don't sound
// like an identical sample fired on a loop.
function humanizeVelocity() {
  return 0.85 + Math.random() * 0.3;
}

// Generates a full arrangement using "vertical layering" — the standard
// adaptive-game-music technique (as used by FMOD/Wwise-style systems): every
// role (melody, bass, harmony pad, and each drum voice) is composed across
// the ENTIRE shared chord progression and beat clock, not just a private
// slice of it. Each dot pair is assigned one whole role as its permanent
// "stem" (chunkIndex). Because every stem is written against the exact same
// underlying chords and tempo, any subset of opened stems always sounds like
// one coherent arrangement — the connection order doesn't matter, and each
// stem is audible within a beat or two of being opened instead of waiting
// for a private slot to come around in a shared timeline.
function generateSong(pairCount) {
  const genre = GENRES[Math.floor(Math.random() * GENRES.length)];
  const beatsPerBar = 4;
  const progressionBars = genre.chordProgression.length; // the shared harmonic cycle every stem plays over
  const totalBeats = progressionBars * beatsPerBar;
  const stepsPerBar = 8; // eighth notes

  const roles = CHUNK_ROLES.slice(0, pairCount);
  const notes = [];

  roles.forEach((role, chunkIndex) => {
    for (let bar = 0; bar < progressionBars; bar++) {
      const chordRoot = genre.chordProgression[bar % genre.chordProgression.length];
      const chordDegrees = [chordRoot, chordRoot + 2, chordRoot + 4];
      const barStartBeat = bar * beatsPerBar;

      if (role === 'lead') {
        let barHadNote = false;
        for (let step = 0; step < stepsPerBar; step++) {
          if (Math.random() < genre.grooveWeights[step]) {
            const baseDeg = chordDegrees[Math.floor(Math.random() * chordDegrees.length)];
            const useChordTone = Math.random() < 0.7;
            const deg = useChordTone ? baseDeg : baseDeg + (Math.random() < 0.5 ? 1 : -1);
            notes.push({
              beat: humanizeBeat(barStartBeat + step * 0.5, 0.03),
              dur: 0.5,
              midi: scaleMidi(genre, deg, 1),
              freq: scaleFreq(genre, deg, 1),
              role: 'lead',
              instrument: genre.instruments.lead,
              vel: humanizeVelocity(),
              chunkIndex,
            });
            barHadNote = true;
          }
        }
        // Sparser genres' groove weights can roll an empty bar by chance,
        // which would leave the lead stem silent for a stretch after it's
        // opened. Guarantee at least a downbeat chord tone every bar so the
        // wait to hear something after connecting a pair is always short.
        if (!barHadNote) {
          notes.push({
            beat: barStartBeat,
            dur: 0.9,
            midi: scaleMidi(genre, chordRoot, 1),
            freq: scaleFreq(genre, chordRoot, 1),
            role: 'lead',
            instrument: genre.instruments.lead,
            vel: humanizeVelocity(),
            chunkIndex,
          });
        }
      } else if (role === 'bass') {
        notes.push({ beat: barStartBeat, dur: 1.8, midi: scaleMidi(genre, chordRoot, -1), freq: scaleFreq(genre, chordRoot, -1), role: 'bass', instrument: genre.instruments.bass, vel: humanizeVelocity(), chunkIndex });
        if (genre.bassOnBeatThree) {
          notes.push({ beat: humanizeBeat(barStartBeat + 2, 0.02), dur: 1.8, midi: scaleMidi(genre, chordDegrees[2], -1), freq: scaleFreq(genre, chordDegrees[2], -1), role: 'bass', instrument: genre.instruments.bass, vel: humanizeVelocity(), chunkIndex });
        }
      } else if (role === 'pad') {
        notes.push({
          beat: barStartBeat,
          dur: 4,
          midiList: chordDegrees.map(d => scaleMidi(genre, d, 0)),
          freqs: chordDegrees.map(d => scaleFreq(genre, d, 0)),
          role: 'pad',
          instrument: genre.instruments.pad,
          vel: 0.9 + Math.random() * 0.15,
          chunkIndex,
        });
      } else { // kick, snare, hihat
        for (let step = 0; step < stepsPerBar; step++) {
          if (genre.drumPattern[role][step]) {
            notes.push({ beat: humanizeBeat(barStartBeat + step * 0.5, 0.015), role, vel: humanizeVelocity(), chunkIndex });
          }
        }
      }
    }
  });

  return { genre, totalBeats, pairCount, notes };
}

const SONG_LOOP_ITERATIONS = 10; // generous coverage for a full wave's play session

// Schedules the whole song, looped, for the entire wave up front — routed
// through one persistent, initially-muted GainNode per pair (chunkGains).
// Nothing is audible yet; connecting a pair just opens its gate. Because
// the whole loop is already running underneath, every unmuted chunk stays
// in perfect sync with every other one, and the build-up is continuous
// rather than a one-shot replay.
function scheduleLoopingSong(song) {
  const ctx = STATE.audioCtx;
  const beatDur = 60 / song.genre.bpm;
  const loopDuration = song.totalBeats * beatDur;
  const startTime = ctx.currentTime + 0.05;

  STATE.chunkGains.forEach(g => { try { g.disconnect(); } catch (e) { /* already gone */ } });
  STATE.chunkGains = [];
  for (let i = 0; i < song.pairCount; i++) {
    const g = ctx.createGain();
    g.gain.value = 0;
    g.connect(STATE.masterBus);
    STATE.chunkGains.push(g);
  }

  for (let loop = 0; loop < SONG_LOOP_ITERATIONS; loop++) {
    const loopStart = startTime + loop * loopDuration;
    song.notes.forEach(note => {
      playScheduledNote(note, loopStart, beatDur, STATE.chunkGains[note.chunkIndex]);
    });
  }
}

// Opens this pair's gate — its slice of the song (already playing, silent)
// becomes audible from here on, every loop, layering with whatever other
// pairs have already been connected.
function unmuteChunk(pairId) {
  if (!STATE.audioCtx || !STATE.chunkGains[pairId]) return;
  const t = STATE.audioCtx.currentTime;
  const g = STATE.chunkGains[pairId].gain;
  g.cancelScheduledValues(t);
  g.setValueAtTime(g.value, t);
  g.linearRampToValueAtTime(1.0, t + 0.12);
}

function startBeat() {
  const interval = (60 / CONFIG.BEAT_BPM) * 1000;
  STATE.beatInterval = setInterval(() => {
    STATE.beatTick++;
  }, interval);
}

// ============================================================
// SECTION 4: CANVAS AND RENDERING
// ============================================================
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

function getBeatPulse() {
  if (!STATE.beatSync) return null;
  const elapsedSec = (performance.now() - STATE.beatSync.startTime) / 1000;
  const beatDur = 60 / STATE.beatSync.bpm;
  const beatPhase = (elapsedSec / beatDur) * Math.PI * 2;
  return (Math.sin(beatPhase) + 1) / 2; // 0..1, one full pulse per beat
}

function drawDot(dot) {
  const instrument = INSTRUMENTS[dot.colorIndex];

  let radius;
  const beatPulse = getBeatPulse();
  // While the full song plays at wave-complete, all dots pulse together in
  // sync with the beat instead of each animating on its own phase.
  const pulse = beatPulse !== null ? beatPulse : (Math.sin(dot.pulsePhase) + 1) / 2;

  if (dot.connected) {
    radius = CONFIG.DOT_RADIUS_BASE + (CONFIG.DOT_RADIUS_CONNECTED_MAX - CONFIG.DOT_RADIUS_BASE) * pulse;
  } else {
    radius = CONFIG.DOT_RADIUS_BASE + (CONFIG.DOT_RADIUS_IDLE_MAX - CONFIG.DOT_RADIUS_BASE) * pulse;
  }

  ctx.save();
  ctx.shadowBlur = 35;
  ctx.shadowColor = instrument.hex;
  ctx.beginPath();
  ctx.arc(dot.x, dot.y, radius, 0, Math.PI * 2);
  ctx.fillStyle = instrument.hex;
  ctx.fill();

  ctx.shadowBlur = 12;
  ctx.beginPath();
  ctx.arc(dot.x, dot.y, radius * 0.55, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.restore();
}

// Draws a point list as a smooth curve instead of a jagged polyline, using
// the classic "quadratic through midpoints" technique: each raw point
// becomes a curve control, and the curve passes through the midpoints
// between consecutive points rather than through the raw points themselves.
// Drawn as short per-segment strokes (via strokeStyleFn) so per-point alpha
// (the traveling fade) still applies.
function drawSmoothedPath(points, strokeStyleFn) {
  if (points.length < 2) return;

  if (points.length === 2) {
    const alpha = strokeStyleFn.alpha(points[0], points[1]);
    if (alpha > 0.01) {
      ctx.beginPath();
      ctx.strokeStyle = strokeStyleFn.style(alpha);
      ctx.moveTo(points[0].x, points[0].y);
      ctx.lineTo(points[1].x, points[1].y);
      ctx.stroke();
    }
    return;
  }

  for (let i = 1; i < points.length - 1; i++) {
    const p0 = points[i - 1];
    const p1 = points[i];
    const p2 = points[i + 1];
    const alpha = strokeStyleFn.alpha(p0, p1);
    if (alpha <= 0.01) continue;

    const startX = i === 1 ? p0.x : (p0.x + p1.x) / 2;
    const startY = i === 1 ? p0.y : (p0.y + p1.y) / 2;
    const endX = (p1.x + p2.x) / 2;
    const endY = (p1.y + p2.y) / 2;

    ctx.beginPath();
    ctx.strokeStyle = strokeStyleFn.style(alpha);
    ctx.moveTo(startX, startY);
    ctx.quadraticCurveTo(p1.x, p1.y, endX, endY);
    ctx.stroke();
  }
}

function drawFadingLine(line) {
  const instrument = INSTRUMENTS[line.colorIndex];

  ctx.save();
  ctx.lineWidth = CONFIG.LINE_WIDTH;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.shadowBlur = CONFIG.LINE_GLOW_BLUR;
  ctx.shadowColor = instrument.hex;

  drawSmoothedPath(line.points, {
    alpha: (p0, p1) => Math.min(p0.alpha, p1.alpha),
    style: (alpha) => instrument.glow + alpha + ')',
  });

  ctx.restore();
}

function drawActiveLine() {
  if (!STATE.isDrawing || STATE.currentPath.length < 2 || !STATE.activeDot) return;

  const instrument = INSTRUMENTS[STATE.activeDot.colorIndex];

  ctx.save();
  ctx.lineWidth = CONFIG.LINE_WIDTH + 1;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.shadowBlur = CONFIG.LINE_GLOW_BLUR;
  ctx.shadowColor = instrument.hex;

  drawSmoothedPath(STATE.currentPath, {
    alpha: () => 1,
    style: () => instrument.hex,
  });

  ctx.restore();
}

// Walks a connection's segments and returns the point at fractional arc-length
// progress t (0 = dotA end, 1 = dotB end).
function pointAtProgress(segments, t) {
  if (!segments.length) return null;
  let totalLen = 0;
  for (const s of segments) totalLen += Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
  if (totalLen === 0) return { x: segments[0].x1, y: segments[0].y1 };

  const targetDist = totalLen * Math.min(1, Math.max(0, t));
  let acc = 0;
  for (const s of segments) {
    const segLen = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
    if (acc + segLen >= targetDist) {
      const localT = segLen === 0 ? 0 : (targetDist - acc) / segLen;
      return { x: s.x1 + (s.x2 - s.x1) * localT, y: s.y1 + (s.y2 - s.y1) * localT };
    }
    acc += segLen;
  }
  const last = segments[segments.length - 1];
  return { x: last.x2, y: last.y2 };
}

// A "drip" easing curve — slow to start, accelerating toward the end, like a
// bead of wax sliding down a fishing line — instead of a constant-speed glide.
function dripEase(t) {
  return t * t;
}

// Once every dot in the wave is connected and the dots are pulsing to the
// beat, each connection also grows a small bead of light that slides back
// and forth along its line in time with the music, with a short fading tail
// behind it for that dripping-wax look.
function drawTravelingLights() {
  if (!STATE.beatSync) return;
  const beatDur = 60 / STATE.beatSync.bpm;
  const elapsedBeats = (performance.now() - STATE.beatSync.startTime) / 1000 / beatDur;

  STATE.connections.forEach((connection, i) => {
    if (!connection.segments.length) return;
    const instrument = INSTRUMENTS[connection.colorIndex];
    // Stagger each connection's drip cycle a little so the whole galaxy
    // doesn't move in perfect lockstep — still on the same beat clock.
    const offset = (i * 0.37) % 1;

    const posForBeats = (beats) => {
      const local = beats + offset;
      const cycle = Math.floor(local);
      const frac = local - cycle;
      const eased = dripEase(frac);
      const forward = cycle % 2 === 0;
      const t = forward ? eased : 1 - eased;
      return pointAtProgress(connection.segments, t);
    };

    ctx.save();
    ctx.shadowColor = instrument.hex;

    for (let step = TRAVELING_LIGHT_CONFIG.TAIL_STEPS; step >= 0; step--) {
      const pos = posForBeats(elapsedBeats - step * TRAVELING_LIGHT_CONFIG.TAIL_BEAT_SPACING);
      if (!pos) continue;
      const tailFrac = 1 - step / (TRAVELING_LIGHT_CONFIG.TAIL_STEPS + 1); // 0 (oldest) .. ~1 (head)
      ctx.shadowBlur = 10 + 16 * tailFrac;
      ctx.globalAlpha = 0.15 + 0.8 * tailFrac;
      ctx.beginPath();
      ctx.fillStyle = step === 0 ? '#ffffff' : instrument.hex;
      ctx.arc(pos.x, pos.y, TRAVELING_LIGHT_CONFIG.RADIUS * (0.5 + 0.5 * tailFrac), 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  });
}

// ============================================================
// SECTION 5: DOT GENERATION
// ============================================================
function getPairCountForWave(wave) {
  const extra = Math.floor((wave - 1) / CONFIG.PAIRS_PER_WAVE_INCREASE);
  return Math.min(CONFIG.STARTING_PAIRS + extra, CONFIG.MAX_PAIRS);
}

function generateDots(wave) {
  const pairCount = getPairCountForWave(wave);
  const dots = [];
  let idCounter = 0;

  const shuffledInstruments = shuffleArray([...Array(INSTRUMENTS.length).keys()]).slice(0, pairCount);

  for (let pairId = 0; pairId < pairCount; pairId++) {
    const colorIndex = shuffledInstruments[pairId];

    for (let k = 0; k < 2; k++) {
      const pos = findValidPosition(dots);
      dots.push({
        id: idCounter++,
        x: pos.x,
        y: pos.y,
        colorIndex: colorIndex,
        pairId: pairId,
        connected: false,
        pulsePhase: Math.random() * Math.PI * 2,
        pulseOffset: Math.random() * Math.PI * 2,
      });
    }
  }

  return dots;
}

function findValidPosition(existingDots) {
  const maxAttempts = 200;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const x = CONFIG.EDGE_MARGIN + Math.random() * (canvas.width - CONFIG.EDGE_MARGIN * 2);
    const y = CONFIG.EDGE_MARGIN + Math.random() * (canvas.height - CONFIG.EDGE_MARGIN * 2);

    let valid = true;
    for (const dot of existingDots) {
      const dist = Math.hypot(dot.x - x, dot.y - y);
      if (dist < CONFIG.MIN_DOT_DISTANCE) {
        valid = false;
        break;
      }
    }

    if (valid) return { x, y };
  }

  return fallbackGridPosition(existingDots.length);
}

// ============================================================
// SECTION 6: INPUT HANDLING
// ============================================================
canvas.addEventListener('touchstart', onInputStart, { passive: false });
canvas.addEventListener('touchmove', onInputMove, { passive: false });
canvas.addEventListener('touchend', onInputEnd, { passive: false });
canvas.addEventListener('mousedown', onInputStart, { passive: false });
canvas.addEventListener('mousemove', onInputMove, { passive: false });
canvas.addEventListener('mouseup', onInputEnd, { passive: false });

function getEventPos(e) {
  const rect = canvas.getBoundingClientRect();
  if (e.touches && e.touches.length > 0) {
    return {
      x: e.touches[0].clientX - rect.left,
      y: e.touches[0].clientY - rect.top,
    };
  }
  return {
    x: e.clientX - rect.left,
    y: e.clientY - rect.top,
  };
}

function onInputStart(e) {
  e.preventDefault();

  initAudio();

  if (STATE.phase === 'TITLE') {
    hideMessage();
    startWave(1);
    return;
  }

  if (STATE.phase !== 'PLAYING') return;

  const pos = getEventPos(e);

  const dot = findDotAt(pos.x, pos.y, false);
  if (!dot) return;

  STATE.activeDot = dot;
  STATE.isDrawing = true;
  STATE.currentPath = [{ x: dot.x, y: dot.y }];
  STATE.smoothedCursor = { x: dot.x, y: dot.y };
}

function onInputMove(e) {
  e.preventDefault();
  if (!STATE.isDrawing || STATE.phase !== 'PLAYING') return;

  const pos = getEventPos(e);

  // Low-pass filter the raw pointer position every move event (not just
  // every recorded path point) so hand tremor is damped out at the source —
  // curving through noisy points after the fact still looks jagged, but
  // filtering before recording actually removes the shake.
  STATE.smoothedCursor.x += (pos.x - STATE.smoothedCursor.x) * CONFIG.LINE_SMOOTHING;
  STATE.smoothedCursor.y += (pos.y - STATE.smoothedCursor.y) * CONFIG.LINE_SMOOTHING;

  const lastPoint = STATE.currentPath[STATE.currentPath.length - 1];
  const dist = Math.hypot(STATE.smoothedCursor.x - lastPoint.x, STATE.smoothedCursor.y - lastPoint.y);

  if (dist >= CONFIG.LINE_POINT_INTERVAL) {
    STATE.currentPath.push({ x: STATE.smoothedCursor.x, y: STATE.smoothedCursor.y });
  }
}

function onInputEnd(e) {
  e.preventDefault();
  if (!STATE.isDrawing || !STATE.activeDot) return;

  STATE.isDrawing = false;

  const pos = getEventPos(e);
  if (e.changedTouches && e.changedTouches.length > 0) {
    pos.x = e.changedTouches[0].clientX - canvas.getBoundingClientRect().left;
    pos.y = e.changedTouches[0].clientY - canvas.getBoundingClientRect().top;
  }

  const targetDot = findDotAt(pos.x, pos.y, false);

  if (!targetDot || targetDot.id === STATE.activeDot.id) {
    cancelActiveLine();
    return;
  }

  if (targetDot.colorIndex !== STATE.activeDot.colorIndex) {
    rejectConnection();
    return;
  }

  if (targetDot.connected || STATE.activeDot.connected) {
    cancelActiveLine();
    return;
  }

  if (pathCrossesExistingConnections(STATE.currentPath) || pathCrossesBarriers(STATE.currentPath)) {
    rejectConnection();
    return;
  }

  completeConnection(STATE.activeDot, targetDot);
}

// ============================================================
// SECTION 7: GAME LOGIC
// ============================================================
function findDotAt(x, y, includeConnected) {
  for (const dot of STATE.dots) {
    if (!includeConnected && dot.connected) continue;
    const dist = Math.hypot(dot.x - x, dot.y - y);
    if (dist <= CONFIG.DOT_HIT_RADIUS) return dot;
  }
  return null;
}

function completeConnection(dotA, dotB) {
  dotA.connected = true;
  dotB.connected = true;

  STATE.connections.push({
    dotA: dotA.id,
    dotB: dotB.id,
    colorIndex: dotA.colorIndex,
    segments: pathToSegments(STATE.currentPath),
  });

  const fadingLine = {
    colorIndex: dotA.colorIndex,
    points: STATE.currentPath.map(p => ({ x: p.x, y: p.y, alpha: 1.0 })),
    fadeIndex: 0,
    complete: false,
  };
  STATE.lines.push(fadingLine);

  spawnStarsAroundDots(dotA, dotB);

  unmuteChunk(dotA.pairId);

  haptic('connect');

  STATE.activeDot = null;
  STATE.currentPath = [];

  checkWaveComplete();
}

function rejectConnection() {
  haptic('reject');
  STATE.activeDot = null;
  STATE.currentPath = [];
  STATE.isDrawing = false;
}

function cancelActiveLine() {
  STATE.activeDot = null;
  STATE.currentPath = [];
  STATE.isDrawing = false;
}

function pathToSegments(path) {
  const segments = [];
  for (let i = 1; i < path.length; i++) {
    segments.push({ x1: path[i - 1].x, y1: path[i - 1].y, x2: path[i].x, y2: path[i].y });
  }
  return segments;
}

function segmentsIntersect(s1, s2) {
  const d1x = s1.x2 - s1.x1, d1y = s1.y2 - s1.y1;
  const d2x = s2.x2 - s2.x1, d2y = s2.y2 - s2.y1;
  const cross = d1x * d2y - d1y * d2x;
  if (Math.abs(cross) < 1e-10) return false;

  const dx = s2.x1 - s1.x1, dy = s2.y1 - s1.y1;
  const t = (dx * d2y - dy * d2x) / cross;
  const u = (dx * d1y - dy * d1x) / cross;

  return t > 0.01 && t < 0.99 && u > 0.01 && u < 0.99;
}

function pathCrossesExistingConnections(path) {
  const newSegments = pathToSegments(path);

  for (const connection of STATE.connections) {
    for (const existingSeg of connection.segments) {
      for (const newSeg of newSegments) {
        if (segmentsIntersect(newSeg, existingSeg)) return true;
      }
    }
  }
  return false;
}

function checkWaveComplete() {
  const allConnected = STATE.dots.every(dot => dot.connected);
  if (!allConnected) return;

  STATE.phase = 'WAVE_COMPLETE';

  // The full song is already playing at this point — every pair's chunk
  // was unmuted as it connected, so the last connection simply completes
  // an arrangement that's been building in real time, in sync, all along.
  STATE.beatSync = { startTime: performance.now(), bpm: STATE.song.genre.bpm };

  haptic('waveComplete');

  showMessage('WAVE COMPLETE', 'wave ' + STATE.wave);
  fillRemainingStarfield();

  STATE.score += STATE.wave * 100;

  // The song plays for a short listen window, then the fade-out begins —
  // the fade cuts the song off gracefully (volume ramps to silence in sync
  // with the visual fade) rather than waiting for the whole song to finish.
  setTimeout(() => {
    STATE.beatSync = null;
    startFadeToBlack(() => {
      hideMessage();
      STATE.stars = [];
      startWave(STATE.wave + 1);
      startFadeFromBlack();
    });
  }, CONFIG.WAVE_COMPLETE_LISTEN_SEC * 1000);
}

function startWave(waveNumber) {
  STATE.wave = waveNumber;
  STATE.phase = 'PLAYING';
  STATE.dots = generateDots(waveNumber);
  STATE.connections = [];
  STATE.lines = [];
  STATE.activeDot = null;
  STATE.currentPath = [];
  STATE.isDrawing = false;
  STATE.spaceObjects = [];
  STATE.spaceSpawnTimer = 0;

  const pairCount = getPairCountForWave(waveNumber);
  STATE.song = generateSong(pairCount);
  STATE.barriers = generateBarriers(waveNumber, STATE.dots);

  updateWaveDisplay();

  if (!STATE.beatInterval) startBeat();

  // Sample decoding is async; scheduleLoopingSong calls playSample
  // synchronously for every note up front, so it must wait for decoding
  // to finish or the whole wave's real-instrument notes would silently
  // never play. The staleness guard skips scheduling if this wave was
  // already superseded by the time decoding resolves (shouldn't normally
  // happen — decode is fast — but keeps this safe regardless).
  if (STATE.audioCtx) {
    const songForThisWave = STATE.song;
    Promise.resolve(STATE.samplesReadyPromise).then(() => {
      if (STATE.song === songForThisWave) {
        scheduleLoopingSong(songForThisWave);
      }
    });
  }
}

// ============================================================
// SECTION 7D: WAVE TRANSITION FADE
// ============================================================
function startFadeToBlack(onComplete) {
  STATE.fade = {
    startTime: performance.now(),
    duration: FADE_CONFIG.OUT_DURATION_SEC * 1000,
    direction: 'out',
    alpha: 0,
    onComplete,
  };

  // Ramp the still-playing song down to silence in perfect sync with the
  // visual fade, via Web Audio's own sample-accurate scheduling — rather
  // than waiting for the song to finish first and fading a silent screen.
  if (STATE.audioCtx && STATE.masterGain) {
    const t = STATE.audioCtx.currentTime;
    STATE.masterGain.gain.cancelScheduledValues(t);
    STATE.masterGain.gain.setValueAtTime(STATE.masterGain.gain.value, t);
    STATE.masterGain.gain.linearRampToValueAtTime(0.0001, t + FADE_CONFIG.OUT_DURATION_SEC);

    // scheduleLoopingSong pre-schedules many loop iterations up front — some
    // land well past this listen window. Muting alone doesn't stop them;
    // they'd still fire later and become audible again once the next
    // wave's fade-in restores volume. Hard-stop everything exactly when
    // the fade finishes so nothing can bleed into the next wave.
    stopAllScheduledAudio(t + FADE_CONFIG.OUT_DURATION_SEC);
  }
}

function startFadeFromBlack() {
  STATE.fade = {
    startTime: performance.now(),
    duration: FADE_CONFIG.IN_DURATION_SEC * 1000,
    direction: 'in',
    alpha: 1,
    onComplete: null,
  };

  // Restore full volume instantly — the new wave starts silent anyway
  // until the player makes its first connection.
  if (STATE.audioCtx && STATE.masterGain) {
    const t = STATE.audioCtx.currentTime;
    STATE.masterGain.gain.cancelScheduledValues(t);
    STATE.masterGain.gain.setValueAtTime(1.0, t);
  }
}

function updateFade() {
  if (!STATE.fade) return;

  const progress = Math.min(1, (performance.now() - STATE.fade.startTime) / STATE.fade.duration);

  if (STATE.fade.direction === 'out') {
    STATE.fade.alpha = progress;
    if (progress >= 1) {
      const cb = STATE.fade.onComplete;
      STATE.fade = { alpha: 1, direction: 'idle', onComplete: null };
      if (cb) cb();
    }
  } else if (STATE.fade.direction === 'in') {
    STATE.fade.alpha = 1 - progress;
    if (progress >= 1) {
      STATE.fade = null;
    }
  }
}

function drawFadeOverlay() {
  if (!STATE.fade || STATE.fade.alpha <= 0) return;
  ctx.fillStyle = `rgba(0,0,0,${STATE.fade.alpha})`;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

// ============================================================
// SECTION 7B: BARRIERS (difficulty scaling obstacles)
// ============================================================
function getBarrierCountForWave(wave) {
  if (wave < BARRIER_CONFIG.START_WAVE) return 0;
  const extra = Math.floor((wave - BARRIER_CONFIG.START_WAVE) / BARRIER_CONFIG.WAVES_PER_BARRIER);
  return Math.min(1 + extra, BARRIER_CONFIG.MAX_BARRIERS);
}

function distPointToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = x1 + t * dx, cy = y1 + t * dy;
  return Math.hypot(px - cx, py - cy);
}

function segmentClearsAllDots(x1, y1, x2, y2, dots) {
  for (const d of dots) {
    if (distPointToSegment(d.x, d.y, x1, y1, x2, y2) < BARRIER_CONFIG.DOT_CLEARANCE) return false;
  }
  return true;
}

function generateBarriers(wave, dots) {
  const count = getBarrierCountForWave(wave);
  const barriers = [];
  let attempts = 0;

  while (barriers.length < count && attempts < 300) {
    attempts++;
    const angle = Math.random() * Math.PI * 2;
    const length = BARRIER_CONFIG.MIN_LENGTH + Math.random() * (BARRIER_CONFIG.MAX_LENGTH - BARRIER_CONFIG.MIN_LENGTH);
    const cx = CONFIG.EDGE_MARGIN + Math.random() * (canvas.width - CONFIG.EDGE_MARGIN * 2);
    const cy = CONFIG.EDGE_MARGIN + Math.random() * (canvas.height - CONFIG.EDGE_MARGIN * 2);
    const x1 = cx - Math.cos(angle) * length / 2;
    const y1 = cy - Math.sin(angle) * length / 2;
    const x2 = cx + Math.cos(angle) * length / 2;
    const y2 = cy + Math.sin(angle) * length / 2;

    const c = BARRIER_CONFIG.SCREEN_CLEARANCE;
    if (x1 < c || x1 > canvas.width - c || x2 < c || x2 > canvas.width - c) continue;
    if (y1 < c || y1 > canvas.height - c || y2 < c || y2 > canvas.height - c) continue;
    if (!segmentClearsAllDots(x1, y1, x2, y2, dots)) continue;

    barriers.push({ x1, y1, x2, y2 });
  }

  return barriers;
}

function pathCrossesBarriers(path) {
  const segs = pathToSegments(path);
  for (const b of STATE.barriers) {
    for (const seg of segs) {
      if (segmentsIntersect(seg, { x1: b.x1, y1: b.y1, x2: b.x2, y2: b.y2 })) return true;
    }
  }
  return false;
}

function drawBarriers() {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineWidth = 8;
  ctx.setLineDash([14, 10]);
  ctx.strokeStyle = 'rgba(255,60,60,0.6)';
  ctx.shadowBlur = 18;
  ctx.shadowColor = '#ff3c3c';
  for (const b of STATE.barriers) {
    ctx.beginPath();
    ctx.moveTo(b.x1, b.y1);
    ctx.lineTo(b.x2, b.y2);
    ctx.stroke();
  }
  ctx.restore();
}

// ============================================================
// SECTION 7C: STARFIELD & SPACE BACKGROUND
// ============================================================
function makeStar(x, y) {
  return {
    x, y,
    radius: 0.6 + Math.random() * 1.6,
    targetAlpha: 0.35 + Math.random() * 0.55,
    alpha: 0,
    twinklePhase: Math.random() * Math.PI * 2,
    twinkleSpeed: STARFIELD_CONFIG.TWINKLE_SPEED_MIN + Math.random() * (STARFIELD_CONFIG.TWINKLE_SPEED_MAX - STARFIELD_CONFIG.TWINKLE_SPEED_MIN),
  };
}

function spawnStarsAroundDots(dotA, dotB) {
  const perDot = Math.round(STARFIELD_CONFIG.STARS_PER_CONNECTION / 2);
  for (const dot of [dotA, dotB]) {
    for (let i = 0; i < perDot; i++) {
      if (STATE.stars.length >= STARFIELD_CONFIG.MAX_STARS) return;
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.random() * STARFIELD_CONFIG.CONNECTION_STAR_RADIUS;
      STATE.stars.push(makeStar(dot.x + Math.cos(angle) * dist, dot.y + Math.sin(angle) * dist));
    }
  }
}

function fillRemainingStarfield() {
  const count = Math.min(STARFIELD_CONFIG.WAVE_COMPLETE_FILL_COUNT, STARFIELD_CONFIG.MAX_STARS - STATE.stars.length);
  for (let i = 0; i < count; i++) {
    STATE.stars.push(makeStar(Math.random() * canvas.width, Math.random() * canvas.height));
  }
}

function updateStars() {
  for (const s of STATE.stars) {
    if (s.alpha < s.targetAlpha) s.alpha = Math.min(s.targetAlpha, s.alpha + STARFIELD_CONFIG.STAR_FADE_IN_SPEED);
    s.twinklePhase += s.twinkleSpeed;
  }
}

function drawStars() {
  for (const s of STATE.stars) {
    const twinkle = 0.7 + 0.3 * Math.sin(s.twinklePhase);
    ctx.beginPath();
    ctx.fillStyle = `rgba(255,255,255,${(s.alpha * twinkle).toFixed(3)})`;
    ctx.arc(s.x, s.y, s.radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

function spawnSpaceObject() {
  const type = SPACE_CONFIG.TYPES[Math.floor(Math.random() * SPACE_CONFIG.TYPES.length)];
  const fromLeft = Math.random() < 0.5;
  const y = Math.random() * canvas.height;
  const speed = 0.15 + Math.random() * 0.3;

  const obj = {
    type,
    x: fromLeft ? -40 : canvas.width + 40,
    y,
    vx: (fromLeft ? 1 : -1) * speed * (type === 'comet' ? 2.2 : 1),
    vy: (Math.random() - 0.5) * 0.05,
    rotation: Math.random() * Math.PI * 2,
    rotSpeed: (Math.random() - 0.5) * 0.01,
  };

  if (type === 'asteroid') {
    obj.radius = 6 + Math.random() * 10;
    obj.verts = [];
    const vertCount = 7 + Math.floor(Math.random() * 3);
    for (let i = 0; i < vertCount; i++) obj.verts.push(0.7 + Math.random() * 0.5);
  } else if (type === 'satellite') {
    obj.size = 8 + Math.random() * 4;
    obj.blinkPhase = Math.random() * Math.PI * 2;
  } else if (type === 'comet') {
    obj.tail = [];
  }

  STATE.spaceObjects.push(obj);
}

function updateSpaceObjects() {
  STATE.spaceSpawnTimer++;
  if (STATE.spaceSpawnTimer > SPACE_CONFIG.SPAWN_INTERVAL_FRAMES && STATE.spaceObjects.length < SPACE_CONFIG.MAX_OBJECTS) {
    spawnSpaceObject();
    STATE.spaceSpawnTimer = 0;
  }

  for (const obj of STATE.spaceObjects) {
    obj.x += obj.vx;
    obj.y += obj.vy;
    obj.rotation += obj.rotSpeed || 0;
    if (obj.type === 'comet') {
      obj.tail.push({ x: obj.x, y: obj.y });
      if (obj.tail.length > 18) obj.tail.shift();
    }
    if (obj.type === 'satellite') obj.blinkPhase += 0.05;
  }

  STATE.spaceObjects = STATE.spaceObjects.filter(o => o.x > -60 && o.x < canvas.width + 60);
}

function drawSpaceObjects() {
  for (const obj of STATE.spaceObjects) {
    ctx.save();
    if (obj.type === 'asteroid') {
      ctx.translate(obj.x, obj.y);
      ctx.rotate(obj.rotation);
      ctx.beginPath();
      const n = obj.verts.length;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const r = obj.radius * obj.verts[i];
        const x = Math.cos(a) * r, y = Math.sin(a) * r;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fillStyle = 'rgba(120,120,130,0.35)';
      ctx.strokeStyle = 'rgba(180,180,190,0.25)';
      ctx.lineWidth = 1;
      ctx.fill();
      ctx.stroke();
    } else if (obj.type === 'satellite') {
      ctx.translate(obj.x, obj.y);
      ctx.rotate(obj.rotation);
      ctx.fillStyle = 'rgba(200,200,210,0.4)';
      ctx.fillRect(-obj.size * 0.15, -obj.size * 0.4, obj.size * 0.3, obj.size * 0.8);
      ctx.fillRect(-obj.size * 0.9, -obj.size * 0.12, obj.size * 0.6, obj.size * 0.24);
      ctx.fillRect(obj.size * 0.3, -obj.size * 0.12, obj.size * 0.6, obj.size * 0.24);
      const blink = 0.3 + 0.7 * Math.max(0, Math.sin(obj.blinkPhase));
      ctx.beginPath();
      ctx.fillStyle = `rgba(255,80,80,${blink.toFixed(2)})`;
      ctx.arc(0, 0, 1.5, 0, Math.PI * 2);
      ctx.fill();
    } else if (obj.type === 'comet') {
      for (let i = 0; i < obj.tail.length; i++) {
        const t = obj.tail[i];
        const alpha = (i / obj.tail.length) * 0.5;
        ctx.beginPath();
        ctx.fillStyle = `rgba(180,220,255,${alpha.toFixed(2)})`;
        ctx.arc(t.x, t.y, 1.6 * (i / obj.tail.length), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.beginPath();
      ctx.shadowBlur = 12;
      ctx.shadowColor = '#bfe4ff';
      ctx.fillStyle = '#eaf6ff';
      ctx.arc(obj.x, obj.y, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

// ============================================================
// SECTION 8: HAPTICS
// ============================================================
function haptic(type) {
  if (!navigator.vibrate) return;
  try {
    switch (type) {
      case 'connect': navigator.vibrate(40); break;
      case 'reject': navigator.vibrate([20, 30, 20]); break;
      case 'waveComplete': navigator.vibrate([80, 40, 80, 40, 120]); break;
    }
  } catch (e) {
    // Silently fail — iOS Safari may not support vibrate
  }
}

// ============================================================
// SECTION 9: UI AND MESSAGES
// ============================================================
function showMessage(title, subtitle) {
  document.getElementById('message-title').textContent = title;
  document.getElementById('message-subtitle').textContent = subtitle;
  document.getElementById('message-overlay').style.opacity = '1';
}

function hideMessage() {
  document.getElementById('message-overlay').style.opacity = '0';
}

function updateWaveDisplay() {
  document.getElementById('wave-display').textContent = 'wave ' + STATE.wave;
  document.getElementById('score-display').textContent = STATE.score > 0 ? STATE.score : '';
}

// ============================================================
// SECTION 10: GAME LOOP
// ============================================================
function update() {
  for (const dot of STATE.dots) {
    dot.pulsePhase += CONFIG.DOT_PULSE_SPEED;
  }

  for (const line of STATE.lines) {
    if (line.complete) continue;

    let allFaded = true;
    for (let i = 0; i < line.points.length; i++) {
      if (line.points[i].alpha > 0) {
        allFaded = false;
        if (i === 0 || line.points[i - 1].alpha < 0.05) {
          line.points[i].alpha = Math.max(0, line.points[i].alpha - CONFIG.LINE_FADE_SPEED);
        }
      }
    }
    if (allFaded) line.complete = true;
  }

  STATE.lines = STATE.lines.filter(l => !l.complete);

  updateStars();
  // Asteroids/satellites/comets only drift through once the whole wave's
  // line-galaxy is complete — they'd be a distraction while still connecting.
  if (STATE.phase === 'WAVE_COMPLETE') updateSpaceObjects();
  updateFade();
}

function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  drawStars();
  if (STATE.phase === 'WAVE_COMPLETE') drawSpaceObjects();
  drawBarriers();

  for (const line of STATE.lines) {
    drawFadingLine(line);
  }

  drawActiveLine();

  for (const dot of STATE.dots) {
    drawDot(dot);
  }

  drawTravelingLights();

  drawFadeOverlay();
}

function gameLoop() {
  update();
  render();
  requestAnimationFrame(gameLoop);
}

// ============================================================
// SECTION 11: INITIALIZATION
// ============================================================
function init() {
  resizeCanvas();
  preloadSampleBytes(); // start fetching instrument samples now, overlapping the "tap to begin" wait

  STATE.phase = 'TITLE';
  showMessage('LUMINA', 'connect the dots');
  updateWaveDisplay();

  gameLoop();
}

function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function fallbackGridPosition(index) {
  const cols = 3;
  const col = index % cols;
  const row = Math.floor(index / cols);
  return {
    x: CONFIG.EDGE_MARGIN + col * (canvas.width - CONFIG.EDGE_MARGIN * 2) / 2,
    y: CONFIG.EDGE_MARGIN + row * (canvas.height - CONFIG.EDGE_MARGIN * 2) / 3,
  };
}

window.addEventListener('load', init);

window.__lumina = {
  getState: () => STATE,
  getDots: () => STATE.dots.map(d => ({ id: d.id, x: d.x, y: d.y, colorIndex: d.colorIndex, pairId: d.pairId, connected: d.connected })),
};
