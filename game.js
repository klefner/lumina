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
};

// Past wave 10, a color group can have more than 2 dots — the player
// links them into a single connected network (any dot to any other
// same-colored dot, as long as they're not already linked) rather than
// one fixed pair. Not every color gets extra dots on a given wave — only
// EXTRA_GROUP_CHANCE of them do, so it reads as randomly chosen rather
// than a hard rule, while the ceiling on how big a group can get keeps
// rising, so it's always progressively more difficult.
const GROUP_CONFIG = {
  START_WAVE: 11,           // waves 1-10 stay simple 2-dot pairs
  WAVES_PER_TIER: 10,       // the max group size ceiling rises by 1 every N waves after START_WAVE
  EXTRA_GROUP_CHANCE: 0.45, // per-color odds of exceeding 2 dots, once eligible
};

function maxGroupSizeForWave(wave) {
  if (wave < GROUP_CONFIG.START_WAVE) return 2;
  return 3 + Math.floor((wave - GROUP_CONFIG.START_WAVE) / GROUP_CONFIG.WAVES_PER_TIER);
}

function groupSizeForColor(wave) {
  const maxSize = maxGroupSizeForWave(wave);
  if (maxSize <= 2 || Math.random() >= GROUP_CONFIG.EXTRA_GROUP_CHANCE) return 2;
  return 3 + Math.floor(Math.random() * (maxSize - 2)); // 3..maxSize inclusive
}

const FADE_CONFIG = {
  OUT_DURATION_SEC: 0.9, // fade-to-black speed — the song's volume ramps down over the same span
  IN_DURATION_SEC: 0.6,  // fade-from-black speed for the new wave
};

// A short, unobtrusive tutorial hint shown once per wave for the first five
// waves only — fades in at wave start, stays on screen until the player
// does the thing it describes, then fades out and never reappears for that
// wave. `dismissWhen: 'connect'` clears it on the wave's first completed
// connection; `'complete'` waits for the whole wave to be finished.
const TUTORIAL_MESSAGES = [
  { text: 'Tap/Click hold to draw a line from one colored dot to its pair.', dismissWhen: 'connect' },
  { text: 'Lines break when they cross other lines.', dismissWhen: 'connect' },
  { text: 'Each connected dot pair is a part of a series of musical notes.', dismissWhen: 'connect' },
  { text: 'Connect all the dots to hear the song.', dismissWhen: 'complete' },
  { text: 'The longer the lines you draw, the higher your score.', dismissWhen: 'connect' },
  { text: 'This game is about making relaxing music. Please enjoy.', dismissWhen: 'connect' },
];

// ============================================================
// PAUSE MENU CONTENT — 50 facts about music, sound, color, and space, plus
// 20 pro tips for this game specifically, rotated together in the pause
// menu (see startPauseFactRotation). Kept gentle and curious in tone —
// nothing alarming or unpleasant, even where the underlying science is
// dramatic (storms, extremes, etc.) — since this plays over a relaxation
// game, not a trivia quiz.
const PAUSE_FACTS = [
  "A single cello note can make dust on a nearby table visibly dance — sound is just air taking the shape of a wiggle.",
  "Whale songs can travel hundreds of miles through the ocean — the original long-distance call.",
  "Bats can hear pitches vibrating 200,000 times a second, ten times higher than the top of human hearing.",
  "Cyclists pedaling in time with music use about 7% less oxygen than those riding in silence — rhythm is basically free fuel.",
  "You've never actually heard your own voice the way everyone else has — recordings skip the bone-conducted hum only you can feel.",
  "Elephants can 'talk' in rumbles too low for human ears, sometimes felt through the ground from miles away.",
  "Some limestone caverns naturally resonate like giant stone bells — the world's biggest musical instrument might just be a cave.",
  "A singing bowl doesn't ring on its own — the sound comes entirely from a mallet's friction slowly waking hundreds of tiny vibrations at once.",
  "Music really can change how food tastes — high notes nudge our brains toward sweetness, low notes toward bitterness.",
  "The 'hang' drum blends the metallic ring of a steel pan with the calm hum of a meditation bowl — invented by two instrument makers in the year 2000.",
  "Deep bass frequencies have been used to blow out small flames — sound waves pushing oxygen away fast enough to snuff them out.",
  "A vibraphone has a secret a marimba doesn't: tiny motorized discs spinning inside its resonator tubes, giving it that shimmering vibrato.",
  "Every whale species sings its own regional 'dialect,' and the songs slowly drift and change generation to generation, like ocean folk music.",
  "School-bus yellow sits exactly between the wavelengths that trigger red and green in our eyes, lighting up both signals at once — which is why it's almost impossible to miss out of the corner of your eye.",
  "Your eyes hold about six million tiny color-sensing cones apiece — a private constellation, doing color math thousands of times a second.",
  "A small number of people are tetrachromats, with a fourth type of color cone — they may see tens of millions more shades than the rest of us.",
  "Bees and butterflies can see ultraviolet patterns on flowers that are completely invisible to us — like secret landing lights just for them.",
  "The lens in your eye yellows gently with age, which may be part of why a warm sunset can look even richer to someone in their sixties than in their twenties.",
  "There's no such thing as 'brown light' — brown only exists as a color your brain invents when it sees dim orange sitting next to something brighter.",
  "Mantis shrimp have up to 16 types of color receptors, compared to our three — scientists still aren't entirely sure what their world looks like to them.",
  "Culture and language quietly shape which colors we notice first — the exact shade you'd call 'blue' might not look the same to the person next to you.",
  "Chladni figures are patterns that appear in sand scattered on a vibrating metal plate — a way of literally seeing sound as shape.",
  "Green is the color the human eye is most sensitive to, which is part of why exit signs, highlighters, and old computer terminals all lean green.",
  "Some people with synesthesia genuinely see colors when they hear music — a certain chord might always look gold, another always blue.",
  "The pigment ultramarine was once so rare it cost more than gold, ground from a stone that came from only one mountain range on Earth.",
  "A rainbow is technically a full circle — we usually only see an arc because the ground gets in the way. From a plane, you can sometimes see the whole ring.",
  "A day on Venus is longer than its year — it spins so slowly that sunrise to sunrise takes longer than one full trip around the Sun.",
  "If you shrank the Sun down to the size of a beach ball, the Earth would be smaller than a grain of sand next to it.",
  "There's a cloud of gas near the center of the Milky Way that contains a molecule which, on Earth, is part of what gives raspberries their flavor.",
  "Astronauts grow up to two inches taller in space, because without gravity compressing their spine, it gently stretches out.",
  "Saturn's rings are made of countless ice chunks, from dust-sized to house-sized, all quietly orbiting in a disk thinner, proportionally, than a sheet of paper.",
  "A teaspoon of a neutron star would weigh about as much as every car on Earth combined.",
  "Neptune has the fastest winds in the solar system, yet from Earth it just looks like a calm, still blue marble.",
  "Uranus rotates almost completely on its side, so for part of its 84-year orbit, one pole gets over two decades of continuous sunlight.",
  "Sound can technically travel through parts of space that hold gas or plasma, like inside a nebula — 'the silence of space' isn't quite the whole story.",
  "The footprints astronauts left on the Moon will likely still be there in a million years — there's no wind or rain to wear them away.",
  "Jupiter's Great Red Spot is a storm wider than the entire Earth, and it's been swirling for at least 350 years.",
  "The starlight you see tonight left its star so long ago that some of those stars have since quietly changed, grown, or moved on entirely.",
  "If the solar system were shrunk to fit on a dinner table, the next-nearest star to the Sun would still be in another city.",
  "A group of frogs is called an army, and their combined nighttime chorus can register nearly as loud as a rock concert.",
  "The 'Wow! signal,' a mysterious 72-second radio burst picked up in 1977, remains one of the most tantalizing unexplained echoes ever recorded from deep space.",
  "Octopuses may be able to 'taste' color through light-sensitive cells in their skin — colorblind and color-aware at the same time.",
  "The whooshing sound inside a seashell isn't 'the ocean' — it's just ambient noise resonating inside the shell's spiral chamber, amplified into a soft roar.",
  "Piano tuners often stretch the octaves slightly on purpose, because that's what our ears actually perceive as perfectly in tune.",
  "Auroras happen because the Sun is, in a very real sense, gently painting the sky — charged particles colliding with our atmosphere glow green, pink, and violet.",
  "City lights at night can make whole coastlines glow like glitter when seen from orbit — one of the prettiest views astronauts describe.",
  "A hummingbird's wings beat around 50 times a second, fast enough to produce an actual musical pitch, not just a hum.",
  "Owls fly almost silently because their feathers have soft, comb-like fringed edges that break up turbulent air before it can whistle.",
  "The color pink doesn't exist in the rainbow — it's a color your brain invents when red and violet light land on your eye at the same time.",
  "Off the coast of Northern Ireland sits a natural rock formation of thousands of near-perfect hexagonal columns — geology quietly doing geometry.",
];

const PAUSE_TIPS = [
  "Longer, winding lines score more than short direct ones — sometimes the scenic route pays better.",
  "A barrier is always tinted the exact color of the pair it's blocking — trust the color, not just the position.",
  "Rotating barriers snap any connection they sweep through, including ones you finished earlier — keep an eye on them even after you think you're done.",
  "Past wave 10, some colors get extra dots. Link them all into one connected shape — you don't have to connect them in any particular order.",
  "A quiet chime confirms every connection instantly, even before the music catches up to it.",
  "Every wave keeps looping its music until you choose to move on — there's no rush, so take your time.",
  "You can curve a line however you like as long as it doesn't cross another line or a barrier — creative routing is always allowed.",
  "The traveling light on each connection moves in time with the beat, and once every dot is linked, the lines themselves pulse together too.",
  "Score climbs the moment you release a connection, not at the end of the wave — watch the live number while you're still drawing.",
  "Each wave's music is generated fresh, so the exact same song never plays twice.",
  "Milestone badges appear every 10 waves, and they get fancier the further you go.",
  "Your best wave and best single-wave score are both saved automatically — every visit tries to beat your own record.",
  "If two dots share a color, they're always meant to connect — colors are never repeated by coincidence within a group.",
  "Redrawing a connection that's already linked, even indirectly through another dot, won't do anything — only a genuinely new link counts.",
  "Barriers always cross the real path between the dots they're blocking — if one looks avoidable, there's usually a wider way around.",
  "The full starfield doesn't reveal itself until a wave is completely finished — think of it as the reward for finishing.",
  "Pausing mutes the music and freezes the board exactly where you left it — nothing keeps moving while you're away.",
  "A saved game remembers your wave and score, so you can pick up right where you left off next time.",
  "The bigger a color's group gets, the more freedom you have in which two dots to link first — plan the easiest edge, not necessarily the first one you see.",
  "Serenity, moonlit pool, warm stone, and ocean mist are four different musical moods — each wave randomly picks one.",
];

// ============================================================
// ACHIEVEMENTS — persisted personal-best milestones, celebrated with a
// top-center toast (badge + short label) and a short synthesized jingle.
// Persistence is per-browser (localStorage), not tied to a wave/session,
// so "best ever" genuinely means best ever on this device.
// ============================================================
const STATS_KEY = 'lumina_stats_v1';
function loadStats() {
  try {
    const raw = localStorage.getItem(STATS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { bestWave: parsed.bestWave || 0, bestWaveScore: parsed.bestWaveScore || 0 };
    }
  } catch (e) { /* localStorage unavailable/corrupt — start fresh, don't block the game on it */ }
  return { bestWave: 0, bestWaveScore: 0 };
}
function saveStats(stats) {
  try { localStorage.setItem(STATS_KEY, JSON.stringify(stats)); } catch (e) { /* best-effort only */ }
}

// A single in-progress save (distinct from STATS_KEY's all-time personal
// bests) — just enough to resume exactly where a session left off.
const SAVE_KEY = 'lumina_save_v1';
function saveGame() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({ wave: STATE.wave, score: STATE.score }));
    return true;
  } catch (e) { return false; }
}
function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed.wave || parsed.wave < 1) return null;
    return { wave: parsed.wave, score: parsed.score || 0 };
  } catch (e) { return null; }
}
function clearSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* best-effort only */ }
}

// Every-10th-wave milestone tiers, each fancier than the last. Cycles
// through an escalating shimmer beyond the last named tier (wave 60+)
// rather than capping out, so the milestone keeps feeling special forever.
const MILESTONE_TIERS = [
  { name: 'Bronze',   glyph: '✦', bg: 'radial-gradient(circle at 35% 30%, #e8b27a, #8c5a2b)', glow: 'rgba(205,127,50,0.6)' },
  { name: 'Silver',   glyph: '✦', bg: 'radial-gradient(circle at 35% 30%, #f2f2f2, #9a9a9a)', glow: 'rgba(200,200,210,0.65)' },
  { name: 'Gold',     glyph: '✦', bg: 'radial-gradient(circle at 35% 30%, #ffe9a8, #d4a017)', glow: 'rgba(255,215,0,0.65)' },
  { name: 'Platinum', glyph: '✨', bg: 'radial-gradient(circle at 35% 30%, #f4faff, #b9c3cc)', glow: 'rgba(220,235,245,0.7)' },
  { name: 'Diamond',  glyph: '✨', bg: 'radial-gradient(circle at 35% 30%, #d4f6ff, #4fc3f7)', glow: 'rgba(79,195,247,0.75)' },
  { name: 'Prism',    glyph: '✨', bg: 'conic-gradient(from 0deg, #ff6b6b, #ffd93d, #6bffb8, #6bc6ff, #c66bff, #ff6b6b)', glow: 'rgba(255,255,255,0.8)' },
];
function milestoneTierForWave(wave) {
  const tier = Math.floor(wave / 10) - 1; // wave10->0(Bronze), wave20->1(Silver), ...
  return MILESTONE_TIERS[Math.min(tier, MILESTONE_TIERS.length - 1)];
}

function queueAchievement(entry) {
  STATE.achievementQueue.push(entry);
  maybeShowNextAchievement();
}

// Checks all three milestone types against this wave's result and queues
// a toast for each one earned. Called once per completed wave.
function checkAchievements(waveScore) {
  if (STATE.wave % 10 === 0) {
    const tier = milestoneTierForWave(STATE.wave);
    queueAchievement({ glyph: tier.glyph, bg: tier.bg, glow: tier.glow, label: `Wave ${STATE.wave} Cleared` });
  }
  if (STATE.wave > STATE.stats.bestWave) {
    STATE.stats.bestWave = STATE.wave;
    saveStats(STATE.stats);
    queueAchievement({
      glyph: '🏆', // 🏆
      bg: 'radial-gradient(circle at 35% 30%, #ffe9a8, #d4a017)',
      glow: 'rgba(255,215,0,0.65)',
      label: 'New Best Wave',
    });
  }
  if (waveScore > STATE.stats.bestWaveScore) {
    STATE.stats.bestWaveScore = waveScore;
    saveStats(STATE.stats);
    queueAchievement({
      glyph: '⭐', // ⭐
      bg: 'radial-gradient(circle at 35% 30%, #cfe8ff, #5b8def)',
      glow: 'rgba(91,141,239,0.65)',
      label: 'Best Wave Score',
    });
  }
}

function maybeShowNextAchievement() {
  if (STATE.achievementToastActive) return;
  const next = STATE.achievementQueue.shift();
  if (!next) return;
  STATE.achievementToastActive = true;
  showAchievementToast(next);
}

const ACHIEVEMENT_VISIBLE_MS = 3200;
function showAchievementToast(entry) {
  const toast = document.getElementById('achievement-toast');
  const badge = document.getElementById('achievement-badge');
  badge.style.setProperty('--badge-bg', entry.bg);
  badge.style.setProperty('--badge-glow', entry.glow);
  badge.textContent = entry.glyph;
  // Re-trigger the pop animation even if a previous toast just used it.
  badge.style.animation = 'none';
  void badge.offsetWidth; // force reflow so the animation restarts
  badge.style.animation = '';

  layoutAchievementToast(toast, entry.label);
  toast.classList.add('visible');
  playAchievementJingle();

  setTimeout(() => {
    toast.classList.remove('visible');
    STATE.achievementToastActive = false;
    setTimeout(maybeShowNextAchievement, 700); // let the fade-out finish before the next one pops in
  }, ACHIEVEMENT_VISIBLE_MS);
}

// Same center-out, dot-avoiding search as layoutTutorialHint, anchored near
// the top of the screen instead of dead-center, and reflowing the label
// text (not the badge, which is a fixed-size circle) to shrink the toast's
// footprint when needed.
function layoutAchievementToast(toast, text) {
  const label = document.getElementById('achievement-label');
  const words = text.split(' ');
  const lineOptions = [];
  for (let lineCount = 1; lineCount <= words.length; lineCount++) lineOptions.push(wrapIntoLines(words, lineCount));

  const maxRadius = Math.min(canvas.width, canvas.height) * 0.5;
  const positions = tutorialPositionCandidates(maxRadius, 25);

  let fallback = null; // best layout that at least stays on-screen, even if it still grazes a dot
  for (const fontSize of [20, 17, 15, 13]) {
    label.style.fontSize = fontSize + 'px';
    for (const { dx, dy } of positions) {
      toast.style.left = `calc(50% + ${dx}px)`;
      toast.style.top = `calc(14% + ${dy}px)`;
      for (const lines of lineOptions) {
        label.innerHTML = lines.map(l => l.replace(/&/g, '&amp;').replace(/</g, '&lt;')).join('<br>');
        const rect = toast.getBoundingClientRect();
        if (rectOutOfBounds(rect)) continue; // never render part of the toast off the edge of the phone
        if (!rectOverlapsAnyDot(rect)) return; // ideal: on-screen AND clear of every dot
        if (!fallback) fallback = { fontSize, dx, dy, lines };
      }
    }
  }
  if (fallback) {
    label.style.fontSize = fallback.fontSize + 'px';
    toast.style.left = `calc(50% + ${fallback.dx}px)`;
    toast.style.top = `calc(14% + ${fallback.dy}px)`;
    label.innerHTML = fallback.lines.map(l => l.replace(/&/g, '&amp;').replace(/</g, '&lt;')).join('<br>');
  }
}

// A quick, bright ascending flourish — independent of the song's own
// scheduling, fired once as a one-shot celebration. Uses the vibraphone
// samples already loaded for the current genre (or piano as a fallback
// before any wave has picked a genre), so no extra assets are needed.
function playAchievementJingle() {
  if (!STATE.audioCtx || !STATE.masterBus) return;
  const instrument = STATE.sampleBuffers.vibraphone ? 'vibraphone' : 'piano';
  const root = STATE.song ? STATE.song.genre.rootMidi : 60;
  const notes = [root + 12, root + 16, root + 19, root + 24]; // major triad + octave, rising
  const t0 = STATE.audioCtx.currentTime + 0.02;
  notes.forEach((midi, i) => {
    playSample(instrument, midi, t0 + i * 0.09, 0.5, STATE.masterBus);
  });
}

// Color palette — each index is one instrument/color
const INSTRUMENTS = [
  { hex: '#00FFFF', glow: 'rgba(0,255,255,',   name: 'crystal' },
  { hex: '#FF00FF', glow: 'rgba(255,0,255,',   name: 'bloom'   },
  { hex: '#FFD700', glow: 'rgba(255,215,0,',   name: 'gold'    },
  { hex: '#00FF88', glow: 'rgba(0,255,136,',   name: 'jade'    },
  { hex: '#FF6644', glow: 'rgba(255,102,68,',  name: 'ember'   },
  { hex: '#AA88FF', glow: 'rgba(170,136,255,', name: 'violet'  },
];

// Procedural song genres — all tuned to sound like something you'd hear
// during a spa treatment or massage: slow tempo, a plain major scale, and
// chord progressions restricted to I/IV/V/vi (every triad consonant, no
// diminished/tense chords). Each genre is a different combination of real
// instrument voices in different registers/roles so replaying gives a
// different-sounding but equally calm arrangement — the same curated
// palette, recombined. See sounds/CREDITS.md for instrument sourcing
// (University of Iowa Musical Instrument Samples, free for any use).
const GENRES = [
  {
    name: 'serenity', bpm: 56, rootMidi: 60,
    scaleIntervals: [0, 2, 4, 5, 7, 9, 11], // Ionian (major)
    chordProgression: [0, 3, 0, 4],          // I - IV - I - V
    roles: [
      { kind: 'melody',   instrument: 'flute' },
      { kind: 'arpeggio', instrument: 'piano' },
      { kind: 'pad',      instrument: 'vibraphone' }, // temporarily off cello
      { kind: 'drone',    instrument: 'marimba' },    // temporarily off cello
      { kind: 'accent',   instrument: 'marimba' },
      { kind: 'accent',   instrument: 'vibraphone' },
    ],
  },
  {
    name: 'moonlit pool', bpm: 52, rootMidi: 57,
    scaleIntervals: [0, 2, 4, 5, 7, 9, 11],
    chordProgression: [0, 5, 3, 4],          // I - vi - IV - V
    roles: [
      { kind: 'melody',   instrument: 'vibraphone' },
      { kind: 'arpeggio', instrument: 'piano' },
      { kind: 'pad',      instrument: 'marimba' },    // temporarily off cello
      { kind: 'drone',    instrument: 'vibraphone' }, // temporarily off cello
      { kind: 'accent',   instrument: 'flute' },
      { kind: 'accent',   instrument: 'marimba' },
    ],
  },
  {
    name: 'warm stone', bpm: 60, rootMidi: 62,
    scaleIntervals: [0, 2, 4, 5, 7, 9, 11],
    chordProgression: [0, 4, 5, 3],          // I - V - vi - IV
    roles: [
      { kind: 'melody',   instrument: 'piano' },
      { kind: 'arpeggio', instrument: 'marimba' },
      { kind: 'pad',      instrument: 'vibraphone' }, // temporarily off cello
      { kind: 'drone',    instrument: 'marimba' },    // temporarily off cello
      { kind: 'accent',   instrument: 'flute' },
      { kind: 'accent',   instrument: 'vibraphone' },
    ],
  },
  {
    name: 'ocean mist', bpm: 54, rootMidi: 65,
    scaleIntervals: [0, 2, 4, 5, 7, 9, 11],
    chordProgression: [0, 3, 4, 0],          // I - IV - V - I
    roles: [
      { kind: 'melody',   instrument: 'marimba' },
      { kind: 'arpeggio', instrument: 'vibraphone' },
      { kind: 'pad',      instrument: 'piano' },      // temporarily off cello
      { kind: 'drone',    instrument: 'vibraphone' }, // temporarily off cello
      { kind: 'accent',   instrument: 'flute' },
      { kind: 'accent',   instrument: 'piano' },
    ],
  },
];

// Note: trumpet and double bass sample files remain in sounds/ from an
// earlier, more upbeat set of genres but are omitted here (and so never
// fetched/decoded) since no active genre references them any more.
const SAMPLE_MANIFEST = {
  piano: ['A3', 'C4', 'E4', 'Ab4', 'C5', 'E5', 'Ab5', 'C6'],
  flute: ['B3', 'C4', 'Db4', 'D4', 'Eb4', 'E4', 'F4', 'Gb4', 'G4', 'Ab4', 'A4', 'Bb4', 'B4', 'C5', 'Db5', 'D5', 'Eb5', 'E5', 'F5', 'Gb5', 'G5', 'Ab5', 'A5', 'Bb5', 'C6', 'Db6', 'D6', 'Eb6', 'E6', 'F6', 'Gb6', 'G6', 'Ab6', 'A6', 'Bb6'],
  cello: ['D3', 'Eb3', 'E3', 'F3', 'Gb3', 'G3', 'Ab3', 'A3', 'Bb3', 'B3', 'C4', 'Db4', 'D4', 'Eb4', 'E4', 'F4', 'Gb4', 'G4', 'Ab4', 'A4', 'Bb4'],
  marimba: ['C3', 'Db3', 'D3', 'Eb3', 'E3', 'F3', 'Gb3', 'G3', 'Ab3', 'A3', 'Bb3', 'B3', 'C4', 'Db4', 'D4', 'Eb4', 'E4', 'F4', 'Gb4', 'G4', 'Ab4', 'A4', 'Bb4', 'B4', 'C5', 'Db5', 'D5', 'Eb5', 'E5', 'F5', 'Gb5', 'G5', 'Ab5', 'A5', 'Bb5', 'B5', 'C6'],
  vibraphone: ['C3', 'Db3', 'D3', 'Eb3', 'E3', 'F3', 'Gb3', 'G3', 'Ab3', 'A3', 'Bb3', 'B3', 'C4', 'Db4', 'D4', 'E4', 'F4', 'Gb4', 'G4', 'Ab4', 'A4', 'Bb4', 'B4', 'C5', 'Db5', 'D5', 'Eb5', 'E5', 'F5', 'Gb5', 'G5', 'Ab5', 'A5', 'Bb5', 'B5', 'C6'],
};

const STARFIELD_CONFIG = {
  // Density-based, not a fixed count — a fixed star count looks fine on a
  // narrow phone screen and leaves huge empty gaps on a wide desktop one.
  // Only used for the wave-complete reveal (fillBaseStarfield) — while
  // still playing, only the sparse per-connection stars are visible.
  AREA_PER_BASE_STAR: 2600,  // one ambient star per this many px^2 of canvas
  MAX_STARS: 3000,
  STARS_PER_CONNECTION: 40,
  CONNECTION_STAR_RADIUS: 100,   // scatter radius around each connected dot
  STAR_FADE_IN_SPEED: 0.02,      // per-connection sparkle — quick, so it reads as immediate feedback
  REVEAL_FADE_IN_SPEED: 0.004,   // wave-complete galaxy reveal — slow, so it reads as a gradual unveiling
  TWINKLE_FRACTION: 0.25,     // only a minority of stars twinkle — the rest sit still
  TWINKLE_SPEED_MIN: 0.01,
  TWINKLE_SPEED_MAX: 0.03,
};

const SPACE_CONFIG = {
  MAX_OBJECTS: 4,
  SPAWN_INTERVAL_FRAMES: 360, // ~6s at 60fps
  TYPES: ['asteroid', 'asteroid', 'satellite', 'comet'],
};

// Large background scenery — distinct from the small drifting asteroids/
// satellites/comets above: 0-2 deep-space phenomena, nearly stationary,
// spawned once per wave-complete reveal, fading in slowly like the rest of
// the galaxy (see STARFIELD_CONFIG.REVEAL_FADE_IN_SPEED).
//
// MUST NOT be mistakable for a dot the player forgot to connect — that
// reads as "the game is broken," not "pretty background." Three rules
// enforce that, applied everywhere a body is spawned or drawn:
//  1. Size floor: every body's overall footprint is comfortably bigger
//     than a dot could ever pulse to (DOT_RADIUS_CONNECTED_MAX=30,
//     DOT_HIT_RADIUS=44) — see MIN_RADIUS/MIN_SPREAD below.
//  2. Hue floor: never within DOT_HUE_EXCLUSION degrees of one of the six
//     actual dot colors (see celestialHue()) — a background object should
//     never coincidentally match a color the player is looking for.
//  3. Silhouette: never a single flat, saturated, filled circle with a
//     centered white highlight — that IS a dot's exact signature. Every
//     type below is shaded, banded, ringed, jetted, or made of multiple
//     scattered elements instead.
const CELESTIAL_CONFIG = {
  // Sphere-based types (rocky/gasGiant/ringed/moon/iceGiant/redGiant/
  // whiteDwarf/blackHole/pulsar/quasar core): radius range for the single
  // primary sphere.
  MIN_RADIUS: 55,
  MAX_RADIUS: 95,
  // Multi-element types (starCluster/asteroidField/binaryStar/meteorShower/
  // nebula/spiralGalaxy): the overall footprint radius they scatter their
  // pieces across — bigger than a single sphere so they read as a "field"
  // or "cluster," not a stray dot.
  MIN_SPREAD: 110,
  MAX_SPREAD: 180,
  MIN_SEPARATION: 260, // px between two bodies' centers, so a pair never overlaps
  DOT_HUE_EXCLUSION: 28, // degrees of hue kept clear of every actual dot color
};

// Dot palette hues (from INSTRUMENTS' hex values) — kept in sync manually
// since they're fixed, well-known constants; celestialHue() steers clear
// of all of them.
const DOT_HUES = [180, 300, 51, 151, 11, 261]; // crystal, bloom, gold, jade, ember, violet

function celestialHue() {
  let hue, attempts = 0;
  do {
    hue = Math.random() * 360;
    attempts++;
  } while (
    DOT_HUES.some(h => Math.min(Math.abs(hue - h), 360 - Math.abs(hue - h)) < CELESTIAL_CONFIG.DOT_HUE_EXCLUSION) &&
    attempts < 30
  );
  return hue;
}

// The pool of 20 space things a wave-complete reveal can draw from.
const CELESTIAL_TYPES = [
  'rocky', 'gasGiant', 'ringed', 'moon', 'iceGiant',       // shaded spheres
  'redGiant', 'whiteDwarf',                                 // stars
  'nebula', 'spiralGalaxy', 'aurora',                       // diffuse/irregular
  'starCluster', 'binaryStar', 'asteroidField',             // scattered elements
  'blackHole', 'supernovaRemnant', 'protoplanetaryDisk',    // ring/disk-based
  'pulsar', 'quasar',                                       // beam-based
  'greatComet', 'meteorShower',                             // streaking
];

// The traveling "drip" lights shown on each connection once the whole wave
// is connected and the dots are pulsing to the beat — a steady stream of
// beads, several in flight on a line at once (like actual wax dripping
// down a fishing line — never just one drop). A new drip is born at the
// dotA end on the same shared beat clock every connection uses (so births
// are in sync across the whole board), then travels one-way to the dotB
// end at a constant speed, slow-to-fast per drip like a drop of wax
// releasing and falling, rather than bouncing back and forth.
const TRAVELING_LIGHT_CONFIG = {
  RADIUS: 5,
  // Constant physical speed for every connection's drip, regardless of the
  // line's own length — a long line's drip just takes proportionally
  // longer to cross it, rather than visibly outrunning a short line's.
  SPEED_PX_PER_BEAT: 50,
  MIN_BEATS_PER_TRAVERSAL: 0.8, // keeps a very short line from cycling absurdly fast
  // A new drip is born this often (in beats), same interval on every
  // connection — smaller than MIN_BEATS_PER_TRAVERSAL so even the
  // shortest line always has more than one drip in flight at a time.
  SPAWN_INTERVAL_BEATS: 0.4,
};

const BARRIER_CONFIG = {
  START_WAVE: 3,          // barriers begin appearing at this wave
  WAVES_PER_BARRIER: 2,   // one more barrier every N waves after START_WAVE
  MAX_BARRIERS: 5,
  MIN_LENGTH: 90,
  MAX_LENGTH: 260,
  DOT_CLEARANCE: 60,      // keep barriers this far from any dot center
  SCREEN_CLEARANCE: 10,
  // Barriers are placed to cross the straight line between one color pair's
  // two dots, at a random point along it (not always the midpoint) and at
  // a near-perpendicular angle, so they genuinely block the direct path
  // instead of landing wherever random chance puts them.
  PAIR_LINE_MIN_T: 0.28,
  PAIR_LINE_MAX_T: 0.72,
  // Kept tight: at the old +/-82 degrees a barrier could land nearly
  // PARALLEL to the path it was supposed to block — still technically
  // touching it at one point, but functionally a sliver a player could
  // route around without any real detour, and visually unrelated-looking
  // to the path it targeted. +/-25 degrees keeps every barrier reading as
  // an actual wall across the path, not a technicality.
  ANGLE_JITTER: Math.PI / 7.2,
  // Barrier length as a fraction of the target pair's own distance apart,
  // not a flat px range — a fixed-size barrier looks arbitrary on a short
  // pair-line and trivial on a long one. Still clamped to [MIN_LENGTH,
  // MAX_LENGTH] so it never gets absurdly long or short.
  LENGTH_MIN_FRACTION: 0.35,
  LENGTH_MAX_FRACTION: 0.6,

  // Rotating barriers: introduced at higher waves, slowly spin around their
  // midpoint, and snap (break) any already-completed connection they sweep
  // through — forcing the player to route around them while they're still
  // finishing the puzzle, and to re-draw anything they cut.
  ROTATION_START_WAVE: 6,
  ROTATION_WAVES_PER_BARRIER: 3, // one more rotating barrier every N waves after ROTATION_START_WAVE
  MAX_ROTATING: 2,
  ROTATION_SPEED_BASE: 0.0045,   // radians/frame (~60fps) — a full turn every ~23s
  ROTATION_SPEED_PER_WAVE: 0.00025,
  ROTATION_SPEED_MAX: 0.009,
};

// Real player feedback: the ramp that was tuned to feel "deceptively
// simple at first, intentionally brutal by wave 30" is exactly right for
// some players and a hard wall for others who bail out before wave 10.
// Rather than picking one curve, difficulty scales how fast every ramp
// (pair count, multi-dot groups, barriers, rotating barriers) advances —
// 'normal' is the original tuning, unchanged for anyone who doesn't touch
// the setting.
const DIFFICULTY_PRESETS = {
  relaxed: {
    label: 'Relaxed',
    pairsPerWaveIncrease: 4,
    groupStartWave: 21,
    groupWavesPerTier: 16,
    extraGroupChance: 0.3,
    barrierStartWave: 6,
    barrierWavesPerBarrier: 4,
    rotationStartWave: 14,
    rotationSpeedScale: 0.7,
  },
  normal: {
    label: 'Normal',
    pairsPerWaveIncrease: 2,
    groupStartWave: 11,
    groupWavesPerTier: 10,
    extraGroupChance: 0.45,
    barrierStartWave: 3,
    barrierWavesPerBarrier: 2,
    rotationStartWave: 6,
    rotationSpeedScale: 1,
  },
  intense: {
    label: 'Intense',
    pairsPerWaveIncrease: 1,
    groupStartWave: 8,
    groupWavesPerTier: 7,
    extraGroupChance: 0.55,
    barrierStartWave: 2,
    barrierWavesPerBarrier: 1,
    rotationStartWave: 4,
    rotationSpeedScale: 1.3,
  },
};
const DIFFICULTY_KEY = 'lumina_difficulty_v1';
// Fixed base rotation speeds — always scaled from these, never from
// BARRIER_CONFIG's current (already-scaled) values, so switching
// difficulty back and forth repeatedly can never compound/drift.
const BASE_ROTATION_SPEED = { base: 0.0045, perWave: 0.00025, max: 0.009 };

function loadDifficulty() {
  try {
    const saved = localStorage.getItem(DIFFICULTY_KEY);
    return DIFFICULTY_PRESETS[saved] ? saved : 'normal';
  } catch (e) {
    return 'normal';
  }
}

function saveDifficulty(level) {
  try { localStorage.setItem(DIFFICULTY_KEY, level); } catch (e) { /* ignore */ }
}

function applyDifficulty(level) {
  const preset = DIFFICULTY_PRESETS[level] ? level : 'normal';
  const p = DIFFICULTY_PRESETS[preset];
  STATE.difficulty = preset;
  CONFIG.PAIRS_PER_WAVE_INCREASE = p.pairsPerWaveIncrease;
  GROUP_CONFIG.START_WAVE = p.groupStartWave;
  GROUP_CONFIG.WAVES_PER_TIER = p.groupWavesPerTier;
  GROUP_CONFIG.EXTRA_GROUP_CHANCE = p.extraGroupChance;
  BARRIER_CONFIG.START_WAVE = p.barrierStartWave;
  BARRIER_CONFIG.WAVES_PER_BARRIER = p.barrierWavesPerBarrier;
  BARRIER_CONFIG.ROTATION_START_WAVE = p.rotationStartWave;
  BARRIER_CONFIG.ROTATION_SPEED_BASE = BASE_ROTATION_SPEED.base * p.rotationSpeedScale;
  BARRIER_CONFIG.ROTATION_SPEED_PER_WAVE = BASE_ROTATION_SPEED.perWave * p.rotationSpeedScale;
  BARRIER_CONFIG.ROTATION_SPEED_MAX = BASE_ROTATION_SPEED.max * p.rotationSpeedScale;
}

function refreshDifficultyButtons() {
  const buttons = document.querySelectorAll('#difficulty-selector .difficulty-btn');
  for (const btn of buttons) {
    btn.classList.toggle('active', btn.dataset.difficulty === STATE.difficulty);
  }
}

function setupDifficultySelectorListeners() {
  const buttons = document.querySelectorAll('#difficulty-selector .difficulty-btn');
  for (const btn of buttons) {
    btn.addEventListener('click', () => {
      const level = btn.dataset.difficulty;
      applyDifficulty(level);
      saveDifficulty(level);
      refreshDifficultyButtons();
    });
  }
}

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
  dotUnion: {},        // dot.id -> dot.id — union-find over same-color dots, tracks which are
                        // already linked (directly or transitively) so a color with 3+ dots can
                        // be solved by connecting them into one network, not just fixed pairs

  activeDot: null,     // The dot currently being dragged from
  currentPath: [],     // Points being drawn right now [{x, y}]
  isDrawing: false,
  smoothedCursor: { x: 0, y: 0 }, // low-pass-filtered pointer position, tracks raw input each move

  audioCtx: null,      // Created on first gesture
  beatInterval: null,  // setInterval reference for beat pulse
  beatTick: 0,         // Increments each beat

  song: null,          // Procedurally generated song for the current wave
  songStartTime: null, // audioCtx.currentTime the current song loop was scheduled from — lets
                        // unmuteChunk find the next clean note onset instead of a mid-decay moment
  songNextLoopIndex: 0, // how many loop passes have been scheduled so far — incremented as
                         // maybeTopUpSongSchedule extends the schedule bit by bit over time
  beatSync: null,      // { startTime, bpm } — drives unison dot pulsing while the full song plays
  fade: null,          // { alpha, direction: 'out'|'in'|'idle', onComplete } — canvas black transition between waves

  waveCompleteAdvanceFn: null,  // set while WAVE_COMPLETE; call to advance to the next wave (tap/key)
  waveCompleteAdvancing: false, // guards against a tap and a key press both triggering the advance at once

  activeSources: [],   // Every scheduled oscillator/buffer source currently pending or playing —
                        // tracked so a wave transition can hard-stop everything, not just mute it.
  chunkGains: [],       // One persistent GainNode per pair — starts muted, ramped open on connect,
                        // so the whole song builds up in place rather than replaying from scratch.

  sampleBuffers: {},   // { piano: { A3: AudioBuffer, ... }, flute: {...}, ... } — decoded lazily
  sampleBytesLoaded: false, // raw fetch finished (kicked off at page load)

  stars: [],           // Background starfield for the current wave — resets each wave
  spaceObjects: [],    // Drifting asteroids / comets / satellites
  spaceSpawnTimer: 0,
  celestialBodies: [], // 0-2 large planets/moons/a star, spawned once per wave-complete reveal

  breakSparks: [],     // Short-lived particle bursts where a rotating barrier snaps a connection

  tutorialWave: null,        // wave number the current on-screen tutorial hint belongs to, or null
  tutorialDismissWhen: null, // 'connect' | 'complete' — what the player needs to do to dismiss it

  waveStartScore: 0,     // STATE.score snapshot at the start of the current wave — the difference
                          // at wave-complete is that wave's own score, for the best-single-wave record
  stats: loadStats(),    // persisted personal bests (see loadStats/saveStats) — survives across visits
  achievementQueue: [],  // pending {glyph, bg, glow, label} toasts, shown one at a time
  achievementToastActive: false,

  paused: false,           // freezes update()/input while the pause menu is open (see pauseGame/resumeGame)
  pauseFactHistory: [],    // last few pause-menu fact/tip strings shown, so the rotation never repeats too soon
  pauseFactTimer: null,    // setInterval id for the 10s rotation, running only while paused
  onlineFacts: [],         // bonus facts fetched live this session (see fetchOnlineFacts) — empty if offline/failed
  pendingResume: null,     // { wave, score } loaded from a save, offered on the title screen (see init/onInputStart)
};

// ============================================================
// SECTION 3: MUSIC ENGINE (procedural song generation & playback)
// ============================================================
function initAudio() {
  if (!STATE.audioCtx) {
    STATE.audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    // Master bus: gain + compressor, tuned as a true peak LIMITER rather
    // than an always-on processor. This was originally tuned aggressively
    // (threshold -32dB, ratio 16:1) back when the game used loud
    // synthesized voices, and never revisited after the move to real
    // sample-based instruments, whose per-note peaks were carefully tuned
    // down to ~0.35-0.6 (roughly -9 to -4dB). At -32dB, that old threshold
    // sat far BELOW our actual signal level, so the compressor was engaged
    // almost constantly, applying ~20+dB of gain reduction that varied
    // sharply with how many voices were simultaneously active — i.e. it
    // was crushing and pumping hardest exactly when a new voice entered,
    // such as right when connecting a pair. That's a very plausible source
    // of an unnatural, blaring swell on sustained instruments (cello/
    // strings) — likely the actual "car horn" cause diagnostic note/chord
    // isolation testing could never reproduce, since those tests never had
    // the rest of the arrangement playing to trigger heavy compression
    // alongside them. Threshold is now set just below where the signal
    // would actually clip, with a hard knee and a heavy ratio, so it's
    // fully transparent (zero gain reduction) for the vast majority of
    // normal playback and only clamps down on the rare moment several
    // voices' peaks genuinely stack up close to 0dBFS — verified against
    // a real overload case (see test notes) that the old settings were
    // otherwise silently relying on to avoid hard clipping.
    const compressor = STATE.audioCtx.createDynamicsCompressor();
    compressor.threshold.value = -3;
    compressor.knee.value = 0;
    compressor.ratio.value = 20;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.15;
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

function scaleMidi(genre, degreeIndex, octaveOffset) {
  const scaleLen = genre.scaleIntervals.length;
  const octave = Math.floor(degreeIndex / scaleLen) + octaveOffset;
  const degree = ((degreeIndex % scaleLen) + scaleLen) % scaleLen;
  return genre.rootMidi + octave * 12 + genre.scaleIntervals[degree];
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

const _instrumentRangeCache = {};
function instrumentMidiRange(instrument) {
  if (_instrumentRangeCache[instrument]) return _instrumentRangeCache[instrument];
  const notes = SAMPLE_MANIFEST[instrument];
  if (!notes) return null;
  let min = Infinity, max = -Infinity;
  for (const name of notes) {
    const m = noteNameToMidi(name);
    if (m < min) min = m;
    if (m > max) max = m;
  }
  const range = { min, max };
  _instrumentRangeCache[instrument] = range;
  return range;
}

// Folds a target note toward the instrument's actual sampled range by whole
// octaves, so playback never needs a pitch shift much larger than half an
// octave. Without this, a chord voiced above/below an instrument's range
// (easy to hit with a 5-6 role song spanning several octaves of theory)
// has multiple tones collapse onto the SAME nearest sample and play
// simultaneously at different speeds — the same recording layered against
// itself, which beats/phases into a blaring, unnatural honk instead of a
// clean chord. Called at generation time, before a note's midi is stored.
function foldToInstrumentRange(instrument, midi) {
  const range = instrumentMidiRange(instrument);
  if (!range) return midi;
  const headroom = 6; // semitones of slack allowed beyond the sampled range
  let m = midi;
  while (m > range.max + headroom) m -= 12;
  while (m < range.min - headroom) m += 12;
  return m;
}

// Folds an entire chord by a SINGLE shared octave shift, chosen to bring the
// chord's own midpoint as close as possible to the center of the
// instrument's real sampled range — instead of folding each tone
// independently (foldToInstrumentRange above). Independent per-tone folding
// was previously used here, but it only pulls tones back once they're 6+
// semitones outside the sample range; a normal, consonant triad (root/3rd/
// 5th) whose upper tones sit just past that boundary was passing through
// untouched, then getting greedily squeezed by nearestDistinctSampleNotes
// into whatever real samples were left near the edge of the range —
// collapsing an ordinary major/minor triad into an adjacent-semitone
// cluster (verified: 11/16 chord voicings across the four genres produced
// a cluster instead of the intended triad). Shifting the whole chord by the
// same number of octaves preserves its exact internal spacing, so the
// distinct-sample resolution downstream lands on tones that are actually
// spread out like the chord they represent.
function foldChordToInstrumentRange(instrument, midiList) {
  const range = instrumentMidiRange(instrument);
  if (!range) return midiList;
  const center = (Math.min(...midiList) + Math.max(...midiList)) / 2;
  const targetCenter = (range.min + range.max) / 2;
  const shift = Math.round((targetCenter - center) / 12) * 12;
  return midiList.map(m => m + shift);
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

// Resolves a whole chord to DISTINCT samples where possible. Two chord
// tones landing near the same edge of an instrument's range (e.g. both
// just above its highest sample) would otherwise both resolve to that same
// nearest sample independently and play simultaneously at different
// speeds — the same recording layered against itself, phasing into an
// unnatural honk instead of a clean chord.
function nearestDistinctSampleNotes(instrument, midiList) {
  const notes = SAMPLE_MANIFEST[instrument];
  if (!notes) return midiList.map(() => null);
  const used = new Set();
  return midiList.map(targetMidi => {
    let best = null, bestDist = Infinity;
    for (const name of notes) {
      if (used.has(name)) continue;
      const dist = Math.abs(noteNameToMidi(name) - targetMidi);
      if (dist < bestDist) { bestDist = dist; best = name; }
    }
    if (best === null) best = nearestSampleNote(instrument, targetMidi); // more chord tones than samples — reuse
    used.add(best);
    return best;
  });
}

// The source recordings themselves were captured at wildly different
// dynamics (see sounds/CREDITS.md: piano/cello at mf, marimba/vibraphone
// at ff, flute deliberately re-extracted at pp) — measured directly from
// the actual sample files (0.3s attack-window RMS, averaged per
// instrument): flute ~0.020, piano ~0.023, cello ~0.085, marimba ~0.214,
// vibraphone ~0.308. Applying the same role-based peak/velocity gain on
// top of that meant, e.g., an "accent" vibraphone note could come out
// roughly 8-9x louder than a "melody" flute note despite flute's peak
// being higher on paper — the role/velocity multiplier was never the
// only thing determining loudness. These factors renormalize every
// instrument to the same target RMS (~0.15) BEFORE role/velocity are
// applied, so a given role/velocity now means the same actual loudness
// regardless of which instrument is playing it. Verified worst-case
// (melody role, max velocity, that instrument's loudest sampled note)
// stays under 0.65 peak for every instrument — comfortable headroom
// under the master limiter.
const INSTRUMENT_GAIN_COMPENSATION = {
  flute: 7.575,
  piano: 6.422,
  cello: 1.764,
  marimba: 0.701,
  vibraphone: 0.487,
};

function playResolvedSample(instrument, nearestName, targetMidi, t, peak, dest) {
  const buffers = STATE.sampleBuffers[instrument];
  if (!buffers || !nearestName) return;
  const buffer = buffers[nearestName];
  if (!buffer) return;

  const ctx = STATE.audioCtx;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.playbackRate.value = Math.pow(2, (targetMidi - noteNameToMidi(nearestName)) / 12);

  const gain = ctx.createGain();
  gain.gain.value = peak * (INSTRUMENT_GAIN_COMPENSATION[instrument] || 1);

  src.connect(gain);
  gain.connect(dest);
  trackSource(src).start(t);
}

function playSample(instrument, targetMidi, t, peak, dest, resolvedName) {
  playResolvedSample(instrument, resolvedName || nearestSampleNote(instrument, targetMidi), targetMidi, t, peak, dest);
}

function playSampleChord(instrument, midiList, t, peak, dest, resolvedNames) {
  const names = resolvedNames || nearestDistinctSampleNotes(instrument, midiList);
  midiList.forEach((midi, i) => playResolvedSample(instrument, names[i], midi, t, peak, dest));
}

// Peak output level per role kind — pad/drone sit quietly underneath,
// melody sits forward, arpeggio and accent fill the space between.
const KIND_PEAK = {
  melody: 0.55,
  arpeggio: 0.4,
  accent: 0.32,
  drone: 0.28,
  pad: 0.22,
};

function playNoteAt(note, t, peak, dest) {
  if (note.role === 'pad') {
    playSampleChord(note.instrument, note.midiList, t, peak, dest, note.resolvedSamples);
  } else {
    playSample(note.instrument, note.midi, t, peak, dest, note.resolvedSample);
  }
}

function playScheduledNote(note, startTime, beatDur, dest) {
  const t = startTime + note.beat * beatDur;
  const vel = note.vel || 1;
  const peak = (KIND_PEAK[note.role] || 0.4) * vel;
  playNoteAt(note, t, peak, dest);
}

// unmuteChunk deliberately waits for this chunk's next clean note onset
// before it becomes audible (see its comment) — musically correct, but
// that can be most of a bar away, which reads as "nothing happened" right
// when the player needs the opposite: instant confirmation the connection
// registered. This plays that same chunk's own first scheduled note (same
// instrument, same pitch it'll actually play) immediately, straight to the
// master bus rather than through the still-muted chunk gain, as a one-shot
// confirmation layered on top of — not instead of — the clean-onset reveal.
function playConnectionChime(pairId) {
  if (!STATE.audioCtx || !STATE.masterBus || !STATE.song) return;
  const note = STATE.song.notes.find(n => n.chunkIndex === pairId);
  if (!note) return;
  const t = STATE.audioCtx.currentTime + 0.01;
  const peak = (KIND_PEAK[note.role] || 0.4) * 0.8;
  playNoteAt(note, t, peak, STATE.masterBus);
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
// role (melody, arpeggio, pad, drone, accent) is composed across the ENTIRE
// shared chord progression and beat clock, not just a private slice of it.
// Each dot pair is assigned one whole role as its permanent "stem"
// (chunkIndex). Because every stem is written against the exact same
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

  // Sparse, strong-beat-biased placement for the slow melody line — mostly
  // rests, landing on or near the downbeat, never busy.
  const melodyWeights = [0.55, 0.05, 0.2, 0.05, 0.4, 0.05, 0.2, 0.1];
  // A gentle rolling broken-chord pattern for the arpeggio voice: root, up,
  // down, up through the chord tones.
  const arpeggioPattern = [0, 1, 2, 1, 0, 1, 2, 1];

  const roles = genre.roles.slice(0, pairCount);
  const notes = [];

  roles.forEach((roleDef, chunkIndex) => {
    const { kind, instrument } = roleDef;

    for (let bar = 0; bar < progressionBars; bar++) {
      const chordRoot = genre.chordProgression[bar % genre.chordProgression.length];
      const chordDegrees = [chordRoot, chordRoot + 2, chordRoot + 4];
      const barStartBeat = bar * beatsPerBar;

      if (kind === 'melody') {
        let barHadNote = false;
        for (let step = 0; step < stepsPerBar; step++) {
          if (Math.random() < melodyWeights[step]) {
            const baseDeg = chordDegrees[Math.floor(Math.random() * chordDegrees.length)];
            const useChordTone = Math.random() < 0.8;
            const deg = useChordTone ? baseDeg : baseDeg + (Math.random() < 0.5 ? 1 : -1);
            notes.push({
              beat: humanizeBeat(barStartBeat + step * 0.5, 0.03),
              midi: foldToInstrumentRange(instrument, scaleMidi(genre, deg, 1)),
              role: kind, instrument, vel: humanizeVelocity(), chunkIndex,
            });
            barHadNote = true;
          }
        }
        // Sparse placement can roll an empty bar by chance, which would
        // leave the melody stem silent for a stretch after it's opened.
        // Guarantee at least a downbeat chord tone every bar so the wait
        // to hear something after connecting a pair is always short.
        if (!barHadNote) {
          notes.push({
            beat: barStartBeat,
            midi: foldToInstrumentRange(instrument, scaleMidi(genre, chordRoot, 1)),
            role: kind, instrument, vel: humanizeVelocity(), chunkIndex,
          });
        }
      } else if (kind === 'arpeggio') {
        for (let step = 0; step < stepsPerBar; step++) {
          if (step === 0 || Math.random() < 0.6) { // always land on the downbeat, roll the rest
            const deg = chordDegrees[arpeggioPattern[step]];
            notes.push({
              beat: humanizeBeat(barStartBeat + step * 0.5, 0.02),
              midi: foldToInstrumentRange(instrument, scaleMidi(genre, deg, 0)),
              role: kind, instrument, vel: humanizeVelocity(), chunkIndex,
            });
          }
        }
      } else if (kind === 'pad') {
        // Fold the chord as a single block (see foldChordToInstrumentRange)
        // so its internal spacing survives — folding each tone independently
        // let a normal triad's upper notes drift past the sample ceiling
        // and get greedily squeezed into whatever samples were left near
        // the edge of the range, collapsing it into an adjacent-semitone
        // cluster instead of the chord it was supposed to be.
        const padMidis = foldChordToInstrumentRange(instrument, chordDegrees.map(d => scaleMidi(genre, d, 0)));
        notes.push({
          beat: barStartBeat,
          midiList: padMidis,
          role: kind, instrument, vel: 0.9 + Math.random() * 0.15, chunkIndex,
        });
      } else if (kind === 'drone') {
        // Anchored an octave below the pad's ACTUAL (block-folded) root,
        // not computed independently from scale degree math — the two play
        // on the same downbeat on the same instrument, so if their targets
        // were resolved separately they could land on the same real sample
        // and phase against each other exactly like an un-folded chord does.
        // Clamped (not octave-folded) to the instrument's true floor: an
        // instrument with a narrow sample range (e.g. cello, ~1.75 octaves)
        // often can't fit both the chord AND a full octave below it, and
        // folding the too-low target back up by 12 would land it exactly
        // back on the pad root it was trying to avoid. Clamping instead
        // settles it at the instrument's lowest real note — diatonic in
        // every genre here, so it reads as a held pedal tone under the
        // harmony rather than a wrong note.
        const range = instrumentMidiRange(instrument);
        const padRootMidi = foldChordToInstrumentRange(instrument, chordDegrees.map(d => scaleMidi(genre, d, 0)))[0];
        const droneMidi = range ? Math.max(range.min, padRootMidi - 12) : padRootMidi - 12;
        notes.push({
          beat: barStartBeat,
          midi: droneMidi,
          role: kind, instrument, vel: 0.85 + Math.random() * 0.2, chunkIndex,
        });
      } else if (kind === 'accent') {
        // One soft ornamental note at a random position per bar — sparse by
        // design, but guaranteed so the wait after connecting is bounded.
        const step = Math.floor(Math.random() * stepsPerBar);
        const deg = chordDegrees[Math.floor(Math.random() * chordDegrees.length)];
        notes.push({
          beat: humanizeBeat(barStartBeat + step * 0.5, 0.04),
          midi: foldToInstrumentRange(instrument, scaleMidi(genre, deg, 1)),
          role: kind, instrument, vel: humanizeVelocity(), chunkIndex,
        });
      }
    }
  });

  capNoteGaps(notes, pairCount, totalBeats, 3.5);
  resolveInstrumentCollisions(notes);

  return { genre, totalBeats, pairCount, notes };
}

// Genres reassign roles to instruments (see GENRES above), which can put
// two different roles — say a drone and an accent — on the SAME instrument
// with beats that land at (or drift close to) the exact same instant. If
// each resolved its nearest sample independently, they could both land on
// the identical recording and phase against each other the same way an
// un-folded chord did (see foldChordToInstrumentRange). This is the general
// case of that fix: any group of notes sharing an instrument within a
// hair of the same beat gets its sample choices resolved TOGETHER, so two
// simultaneous notes on one instrument can never collide onto one file.
// Planned once at song-generation time, not re-derived per note at
// playback, so what's "allowed to sound at once" is decided in advance.
const SIMULTANEOUS_BEAT_TOLERANCE = 0.15; // wider than any humanizeBeat jitter, narrower than a step (0.5 beat)
function resolveInstrumentCollisions(notes) {
  const byInstrument = {};
  for (const note of notes) {
    (byInstrument[note.instrument] = byInstrument[note.instrument] || []).push(note);
  }
  for (const instrument in byInstrument) {
    const list = byInstrument[instrument].slice().sort((a, b) => a.beat - b.beat);
    let i = 0;
    while (i < list.length) {
      let j = i + 1;
      while (j < list.length && list[j].beat - list[i].beat < SIMULTANEOUS_BEAT_TOLERANCE) j++;
      const group = list.slice(i, j);
      if (group.length > 1) {
        const targets = [];
        for (const n of group) targets.push(...(n.midiList || [n.midi]));
        const resolved = nearestDistinctSampleNotes(instrument, targets);
        let k = 0;
        for (const n of group) {
          const count = n.midiList ? n.midiList.length : 1;
          if (n.midiList) n.resolvedSamples = resolved.slice(k, k + count);
          else n.resolvedSample = resolved[k];
          k += count;
        }
      }
      i = j;
    }
  }
}

// Melody/arpeggio/accent notes are placed with per-bar randomness, which
// (rarely) can compound across a bar boundary into a multi-second silent
// stretch — e.g. an early note in one bar followed by a late one in the
// next. Pad and drone are excluded: their placement is unconditional and
// fixed to the downbeat, so they can never compound this way. Scans each
// stem for gaps wider than maxGapBeats and fills the midpoint with a softer
// echo of the note before it, capping the worst-case silence after a pair
// is connected regardless of how the per-bar dice rolls landed.
function capNoteGaps(notes, pairCount, totalBeats, maxGapBeats) {
  const fillers = [];
  for (let chunkIndex = 0; chunkIndex < pairCount; chunkIndex++) {
    const chunkNotes = notes
      .filter(n => n.chunkIndex === chunkIndex && n.role !== 'pad' && n.role !== 'drone')
      .sort((a, b) => a.beat - b.beat);
    if (!chunkNotes.length) continue;

    for (let i = 0; i < chunkNotes.length; i++) {
      const cur = chunkNotes[i];
      const next = chunkNotes[(i + 1) % chunkNotes.length];
      const nextBeat = i + 1 < chunkNotes.length ? next.beat : next.beat + totalBeats;
      const gap = nextBeat - cur.beat;
      if (gap > maxGapBeats) {
        fillers.push({ ...cur, beat: (cur.beat + gap / 2) % totalBeats, vel: (cur.vel || 1) * 0.75 });
      }
    }
  }
  notes.push(...fillers);
}

// A song can have ~40-90 notes per loop pass, several of which are chords
// (multiple AudioBufferSourceNodes each). Scheduling many loop passes at
// once used to mean creating and starting several hundred nodes in a single
// synchronous burst the moment a wave starts — real gameplay audio capture
// (spectrogram + waveform analysis of an actual recorded session) showed a
// dense, off-grid glitch artifact starting exactly at the first audible
// moment, consistent with the audio thread struggling to absorb a burst
// that large. Scheduling is now spread out over time instead: a small
// number of loop passes up front, topped up incrementally as playback
// approaches running out (see maybeTopUpSongSchedule, called every frame).
const INITIAL_LOOP_ITERATIONS = 2;
const TOPUP_LOOP_ITERATIONS = 2;

// Schedules more loop passes of the current song, starting from wherever
// scheduling last left off (STATE.songNextLoopIndex) — routed through the
// persistent per-pair chunkGains, same as always. Nothing new is audible
// from this alone; it just extends how far into the future notes exist.
function scheduleMoreLoops(count) {
  const song = STATE.song;
  if (!song || STATE.songStartTime == null) return;
  const beatDur = 60 / song.genre.bpm;
  const loopDuration = song.totalBeats * beatDur;
  for (let i = 0; i < count; i++) {
    const loop = STATE.songNextLoopIndex;
    const loopStart = STATE.songStartTime + loop * loopDuration;
    song.notes.forEach(note => {
      playScheduledNote(note, loopStart, beatDur, STATE.chunkGains[note.chunkIndex]);
    });
    STATE.songNextLoopIndex++;
  }
}

// Called every frame (see update()) — schedules another batch of loop
// passes once playback is within one loop-duration of running out of
// already-scheduled notes, so the burst of node creation stays small and
// spread out instead of happening all at once. One loop of safety margin
// is exactly as far as nextNoteTimeForChunk ever looks ahead, so a
// freshly-opened gate's next note is always already scheduled by the time
// it needs to play, never landing on an as-yet-unscheduled gap. (Must stay
// strictly less than INITIAL_LOOP_ITERATIONS's coverage, or the first
// top-up fires immediately after the initial scheduling instead of later.)
function maybeTopUpSongSchedule() {
  if (!STATE.audioCtx || !STATE.song || STATE.songStartTime == null) return;
  const beatDur = 60 / STATE.song.genre.bpm;
  const loopDuration = STATE.song.totalBeats * beatDur;
  const now = STATE.audioCtx.currentTime;

  // requestAnimationFrame — and therefore update()/this function — gets
  // throttled or paused entirely by the browser while the tab is
  // backgrounded (alt-tabbed away), but the AudioContext clock keeps
  // advancing in real time regardless. Left alone, real time can run
  // right past every loop that was already scheduled before backgrounding,
  // and scheduling those missed loops on return would give every one of
  // their notes a start time already in the past — Web Audio just clamps
  // a past start() to "right now," so a whole loop's worth of notes would
  // all fire in one instant pile-up the moment the tab regains focus,
  // instead of the spread they were scheduled with. Detect that gap and
  // jump straight to the next loop boundary still in the future instead —
  // a brief continuation of the silence that was already happening while
  // backgrounded, not a burst, and the song resumes cleanly from there.
  const nextCleanLoop = Math.floor((now - STATE.songStartTime) / loopDuration) + 1;
  if (STATE.songNextLoopIndex < nextCleanLoop) {
    STATE.songNextLoopIndex = nextCleanLoop;
  }

  const scheduledUntil = STATE.songStartTime + STATE.songNextLoopIndex * loopDuration;
  if (scheduledUntil - now < loopDuration) {
    scheduleMoreLoops(TOPUP_LOOP_ITERATIONS);
  }
}

// Sets up the persistent per-pair gate (chunkGains) and schedules the first
// couple of loop passes — routed through one persistent, initially-muted
// GainNode per pair. Nothing is audible yet; connecting a pair just opens
// its gate. Because the whole loop is already running underneath, every
// unmuted chunk stays in perfect sync with every other one, and the
// build-up is continuous rather than a one-shot replay.
function scheduleLoopingSong(song) {
  const ctx = STATE.audioCtx;
  const startTime = ctx.currentTime + 0.05;
  STATE.songStartTime = startTime;
  STATE.songNextLoopIndex = 0;

  STATE.chunkGains.forEach(g => { try { g.disconnect(); } catch (e) { /* already gone */ } });
  STATE.chunkGains = [];
  for (let i = 0; i < song.pairCount; i++) {
    const g = ctx.createGain();
    // Scheduling is deferred until sample decoding resolves (see startWave),
    // so it's possible the player already connected a pair before this ran.
    // Catch up immediately (no ramp) instead of silently dropping that
    // connection's sound for the rest of the wave.
    const alreadyConnected = STATE.dots.some(d => d.pairId === i && d.connected);
    g.gain.value = alreadyConnected ? 1.0 : 0;
    g.connect(STATE.masterBus);
    STATE.chunkGains.push(g);
  }

  scheduleMoreLoops(INITIAL_LOOP_ITERATIONS);
}

// Finds the next time (>= now) that this chunk has a note scheduled to
// START — i.e. the next clean onset, not wherever an in-flight note
// currently happens to be in its decay.
function nextNoteTimeForChunk(pairId) {
  const song = STATE.song;
  const ctx = STATE.audioCtx;
  if (!song || !ctx || STATE.songStartTime == null) return null;
  const beatDur = 60 / song.genre.bpm;
  const loopDuration = song.totalBeats * beatDur;
  const chunkBeats = song.notes.filter(n => n.chunkIndex === pairId).map(n => n.beat);
  if (!chunkBeats.length) return null;

  const elapsed = ctx.currentTime - STATE.songStartTime;
  const elapsedInLoop = ((elapsed % loopDuration) + loopDuration) % loopDuration;
  let bestOffset = Infinity;
  for (const beat of chunkBeats) {
    let delta = beat * beatDur - elapsedInLoop;
    if (delta < 0) delta += loopDuration; // wraps to this beat's occurrence in the next loop pass
    if (delta < bestOffset) bestOffset = delta;
  }
  return ctx.currentTime + bestOffset;
}

// Opens this pair's gate — its slice of the song (already playing, silent)
// becomes audible from here on, every loop, layering with whatever other
// pairs have already been connected. Every note in every chunk has already
// been scheduled since the wave started (see scheduleLoopingSong), muted —
// simply ramping the gate open right now would reveal whatever note
// happens to be mid-decay at this exact instant, faded in from the middle
// of its envelope instead of its natural attack, which can sound like a
// jarring swell instead of a clean note. Instead, stay silent until this
// chunk's next scheduled note actually begins, so every reveal is a clean
// onset.
function unmuteChunk(pairId) {
  if (!STATE.audioCtx || !STATE.chunkGains[pairId]) return;
  const ctx = STATE.audioCtx;
  const now = ctx.currentTime;
  const g = STATE.chunkGains[pairId].gain;
  const nextNote = nextNoteTimeForChunk(pairId);
  const rampStart = nextNote != null ? Math.max(now, nextNote - 0.03) : now;

  g.cancelScheduledValues(now);
  g.setValueAtTime(0, now);
  g.setValueAtTime(0, rampStart);
  g.linearRampToValueAtTime(1.0, rampStart + 0.06);
}

// Closes this pair's gate again — used when a rotating barrier snaps a
// completed connection, so its stem drops back out of the arrangement
// until the player redraws it.
function remuteChunk(pairId) {
  if (!STATE.audioCtx || !STATE.chunkGains[pairId]) return;
  const t = STATE.audioCtx.currentTime;
  const g = STATE.chunkGains[pairId].gain;
  g.cancelScheduledValues(t);
  g.setValueAtTime(g.value, t);
  g.linearRampToValueAtTime(0.0, t + 0.15);
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

// One shape per instrument/color slot (index-matched to INSTRUMENTS) — real
// player feedback (including from a colorblind tester) was that several of
// the hues read as near-identical at a glance ("blue and green", "orange
// and yellow", "pink and red"). Shape gives every pair a second, color-
// independent way to tell it apart. Hit-testing (findDotAt) stays a plain
// circle regardless — only the drawn silhouette changes.
const DOT_SHAPES = ['circle', 'diamond', 'square', 'triangle', 'star', 'hexagon'];

function traceDotShapePath(shape, cx, cy, r) {
  switch (shape) {
    case 'diamond':
      ctx.moveTo(cx, cy - r);
      ctx.lineTo(cx + r, cy);
      ctx.lineTo(cx, cy + r);
      ctx.lineTo(cx - r, cy);
      ctx.closePath();
      break;
    case 'square': {
      const s = r * 0.82; // slightly smaller so it reads as similar visual weight to the circle
      ctx.rect(cx - s, cy - s, s * 2, s * 2);
      break;
    }
    case 'triangle':
      for (let i = 0; i < 3; i++) {
        const angle = -Math.PI / 2 + i * (2 * Math.PI / 3);
        const px = cx + Math.cos(angle) * r * 1.15;
        const py = cy + Math.sin(angle) * r * 1.15;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      break;
    case 'star':
      for (let i = 0; i < 10; i++) {
        const angle = -Math.PI / 2 + i * (Math.PI / 5);
        const rad = i % 2 === 0 ? r * 1.2 : r * 0.5;
        const px = cx + Math.cos(angle) * rad;
        const py = cy + Math.sin(angle) * rad;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      break;
    case 'hexagon':
      for (let i = 0; i < 6; i++) {
        const angle = -Math.PI / 2 + i * (Math.PI / 3);
        const px = cx + Math.cos(angle) * r;
        const py = cy + Math.sin(angle) * r;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      break;
    case 'circle':
    default:
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      break;
  }
}

function drawDot(dot) {
  const instrument = INSTRUMENTS[dot.colorIndex];
  const shape = DOT_SHAPES[dot.colorIndex] || 'circle';

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
  traceDotShapePath(shape, dot.x, dot.y, radius);
  ctx.fillStyle = instrument.hex;
  ctx.fill();

  ctx.shadowBlur = 12;
  ctx.beginPath();
  traceDotShapePath(shape, dot.x, dot.y, radius * 0.55);
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
  // getBeatPulse() returns non-null only once every dot is connected (see
  // its own comment) — the exact same value, same phase, that the dots
  // pulse with, so the lines visibly breathe in sync with them rather than
  // running on their own independent timing.
  const beatPulse = getBeatPulse();
  const pulseBoost = beatPulse !== null ? 0.7 + 0.6 * beatPulse : 1;

  ctx.save();
  ctx.lineWidth = CONFIG.LINE_WIDTH * (beatPulse !== null ? 0.85 + 0.3 * beatPulse : 1);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.shadowBlur = CONFIG.LINE_GLOW_BLUR * pulseBoost;
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

function segmentsLength(segments) {
  let total = 0;
  for (const s of segments) total += Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
  return total;
}

// Once every dot in the wave is connected and the dots are pulsing to the
// beat, each connection grows a steady stream of drip lights — several in
// flight on the line at once, each one born at the dotA end on the shared
// beat clock (so births line up across every connection on the board),
// then sliding one-way to the dotB end at the same constant physical
// speed (SPEED_PX_PER_BEAT) every connection uses, slow-to-fast per drip
// like a drop of wax releasing and falling. A long line just has more
// drips in flight at once than a short one, rather than a single bead
// visibly outrunning a short line's or bouncing back and forth.
function drawTravelingLights() {
  if (!STATE.beatSync) return;
  const beatDur = 60 / STATE.beatSync.bpm;
  const elapsedBeats = (performance.now() - STATE.beatSync.startTime) / 1000 / beatDur;
  const spawnInterval = TRAVELING_LIGHT_CONFIG.SPAWN_INTERVAL_BEATS;
  const latestSpawnIndex = Math.floor(elapsedBeats / spawnInterval);

  STATE.connections.forEach((connection) => {
    if (!connection.segments.length) return;
    const instrument = INSTRUMENTS[connection.colorIndex];
    const totalLen = segmentsLength(connection.segments);
    const beatsPerTraversal = Math.max(
      TRAVELING_LIGHT_CONFIG.MIN_BEATS_PER_TRAVERSAL,
      totalLen / TRAVELING_LIGHT_CONFIG.SPEED_PX_PER_BEAT
    );
    const maxDripsInFlight = Math.ceil(beatsPerTraversal / spawnInterval) + 1;

    ctx.save();
    ctx.shadowColor = instrument.hex;
    ctx.shadowBlur = 14;

    for (let k = latestSpawnIndex; k > latestSpawnIndex - maxDripsInFlight; k--) {
      const age = elapsedBeats - k * spawnInterval; // beats since this drip was born
      if (age < 0 || age > beatsPerTraversal) continue; // not born yet, or already arrived

      const lifeFrac = age / beatsPerTraversal; // 0 (just born) .. 1 (arriving)
      const pos = pointAtProgress(connection.segments, dripEase(lifeFrac));
      if (!pos) continue;

      // Fades in right after birth and fades out right before arrival, so
      // drips never pop in/out abruptly at either end of the line.
      const alpha = Math.min(1, lifeFrac * 6) * Math.min(1, (1 - lifeFrac) * 5);
      ctx.globalAlpha = 0.2 + 0.75 * alpha;
      ctx.beginPath();
      ctx.fillStyle = instrument.hex;
      ctx.arc(pos.x, pos.y, TRAVELING_LIGHT_CONFIG.RADIUS, 0, Math.PI * 2);
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
    const groupSize = groupSizeForColor(wave);

    for (let k = 0; k < groupSize; k++) {
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

// Defense in depth on top of fallbackGridPosition itself: whatever the
// reason a dot's final position might land outside the visible canvas
// (a future regression, a screen-size edge case, anything), catch it here
// too. An off-canvas dot is invisible and untappable — indistinguishable,
// from the player's side, from "this dot has no matching pair" — so this
// is checked once, right after generation, rather than trusted to never
// happen again.
function ensureAllDotsOnScreen(dots) {
  for (const dot of dots) {
    const onScreen = dot.x >= 0 && dot.x <= canvas.width && dot.y >= 0 && dot.y <= canvas.height;
    if (onScreen) continue;
    const others = dots.filter(d => d !== dot);
    const pos = findValidPosition(others);
    dot.x = pos.x;
    dot.y = pos.y;
  }
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

// A key press also advances past the WAVE_COMPLETE screen, same as a tap.
window.addEventListener('keydown', () => {
  if (STATE.phase === 'WAVE_COMPLETE' && STATE.waveCompleteAdvanceFn) {
    STATE.waveCompleteAdvanceFn();
  }
});

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
  if (STATE.paused) return; // pause menu handles its own input via real DOM buttons

  initAudio();

  if (STATE.phase === 'TITLE') {
    hideMessage();
    if (STATE.pendingResume) {
      const resume = STATE.pendingResume;
      STATE.pendingResume = null;
      STATE.score = resume.score;
      startWave(resume.wave);
    } else {
      startWave(1);
    }
    return;
  }

  if (STATE.phase === 'WAVE_COMPLETE') {
    if (STATE.waveCompleteAdvanceFn) STATE.waveCompleteAdvanceFn();
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
  if (!STATE.isDrawing || STATE.phase !== 'PLAYING' || STATE.paused) return;

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
  if (!STATE.isDrawing || !STATE.activeDot || STATE.paused) return;

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

  // Rejects both "this exact pair is already linked" and, for a 3+-dot
  // color group, "these two dots are already linked transitively through
  // another dot in the same group" — either way there's nothing new this
  // connection would add.
  if (ufConnected(STATE.activeDot.id, targetDot.id)) {
    cancelActiveLine();
    return;
  }

  if (pathCrossesExistingConnections(STATE.currentPath) || pathCrossesBarriers(STATE.currentPath)) {
    rejectConnection();
    return;
  }

  // Long, winding paths are explicitly rewarded by scoring, but that same
  // freedom can wall off part of the board — completing this exact line
  // could leave some other dot with no remaining straight-line route to
  // any of its groupmates, which would make the wave permanently
  // uncompleteable. Reject it the same way a plain crossing is rejected;
  // the player just needs a different order or a less enclosing route.
  if (wouldStrandAnyDot(pathToSegments(STATE.currentPath), STATE.activeDot, targetDot)) {
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

// Union-find over STATE.dotUnion — tracks which same-color dots are
// already linked, directly or transitively, so a 3+-dot color group can
// be solved by connecting its dots into one network in any order/pattern
// rather than one fixed pair. Path-compressed for O(~1) lookups.
function ufFind(id) {
  let root = id;
  while (STATE.dotUnion[root] !== root) root = STATE.dotUnion[root];
  while (STATE.dotUnion[id] !== root) {
    const next = STATE.dotUnion[id];
    STATE.dotUnion[id] = root;
    id = next;
  }
  return root;
}
function ufUnion(a, b) {
  const ra = ufFind(a), rb = ufFind(b);
  if (ra !== rb) STATE.dotUnion[ra] = rb;
}
function ufConnected(a, b) {
  return ufFind(a) === ufFind(b);
}

// Points per pixel of drawn line — rewards taking the long way around
// (weaving past other dots or barriers) instead of the shortest straight
// shot between a pair. Tuned so a typical direct connection is worth a
// couple dozen points, in the same ballpark as the per-wave completion
// bonus below, and a deliberately winding one is worth meaningfully more.
const SCORE_PER_LINE_PIXEL = 0.08;

// A color's dots are "connected" (for wave-complete purposes, and for
// excluding them from further drags) once ALL of them sit in the same
// union-find component — not just the two endpoints of the latest line.
// For a plain 2-dot pair this is the same instant as before; for a 3+-dot
// group it only becomes true once enough edges have linked the whole set.
function markGroupIfFullySolved(pairId) {
  const groupDots = STATE.dots.filter(d => d.pairId === pairId);
  const allLinked = groupDots.every(d => ufConnected(d.id, groupDots[0].id));
  if (allLinked) for (const d of groupDots) d.connected = true;
}

function completeConnection(dotA, dotB) {
  ufUnion(dotA.id, dotB.id);
  markGroupIfFullySolved(dotA.pairId);

  STATE.connections.push({
    dotA: dotA.id,
    dotB: dotB.id,
    colorIndex: dotA.colorIndex,
    pairId: dotA.pairId,
    segments: pathToSegments(STATE.currentPath),
  });

  const fadingLine = {
    colorIndex: dotA.colorIndex,
    pairId: dotA.pairId,
    points: STATE.currentPath.map(p => ({ x: p.x, y: p.y, alpha: 1.0 })),
    fadeIndex: 0,
    complete: false,
  };
  STATE.lines.push(fadingLine);

  spawnStarsAroundDots(dotA, dotB);

  unmuteChunk(dotA.pairId);
  playConnectionChime(dotA.pairId);

  haptic('connect');

  STATE.score += Math.round(pathLength(STATE.currentPath) * SCORE_PER_LINE_PIXEL);
  updateWaveDisplay();

  checkTutorialDismiss();

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

function pathLength(path) {
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    total += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
  }
  return total;
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

// Only already-drawn CONNECTIONS count as obstacles here, deliberately
// excluding barriers — a barrier is a single short finite segment that's
// always meant to be curved around (that's its entire purpose; it's
// placed specifically to cross a pair's straight line, so treating it as
// blocking would reject nearly every barrier wave's legitimate moves).
// A completed connection is different: it's permanent for the rest of the
// wave and can be arbitrarily long and looping (scoring rewards exactly
// that), which is what can actually wall off part of the board for good.
function existingConnectionSegments(extraSegments) {
  const segs = [];
  for (const connection of STATE.connections) segs.push(...connection.segments);
  if (extraSegments) segs.push(...extraSegments);
  return segs;
}

// A single crossing line is completely normal and fully routable around —
// the tutorial itself teaches players to expect lines near each other —
// so "is the straight chord blocked" is the wrong test for stranding; it
// would reject constantly. What actually matters is whether a dot is cut
// off by a genuine enclosure (a loop that fully surrounds it), and that
// requires real path-existence, not a single blocked segment. Rather than
// a full curved-path solver, this rasterizes every obstacle segment onto
// a coarse grid and flood-fills from the dot's cell — cheap, and it
// correctly lets a path route around any number of individual obstacles,
// only failing when there's truly no way out.
const STRAND_CHECK_CELL_SIZE = 24;

function rasterizeSegmentToGrid(seg, size, blocked) {
  const dist = Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1);
  const steps = Math.max(1, Math.ceil(dist / (size * 0.5)));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = seg.x1 + (seg.x2 - seg.x1) * t;
    const y = seg.y1 + (seg.y2 - seg.y1) * t;
    blocked.add(Math.round(x / size) + ',' + Math.round(y / size));
  }
}

function buildBlockedGrid(segments, size) {
  const blocked = new Set();
  for (const seg of segments) rasterizeSegmentToGrid(seg, size, blocked);
  return blocked;
}

// 8-directional flood fill over the blocked-cell grid. The start cell's
// own blocked state is ignored (a dot must always be able to leave from
// where it stands), and reaching the target cell always counts even if
// that cell is itself marked blocked (same reasoning, for the groupmate).
function isReachableAround(fromX, fromY, toX, toY, blocked, size, cols, rows) {
  const startCol = Math.round(fromX / size), startRow = Math.round(fromY / size);
  const toCol = Math.round(toX / size), toRow = Math.round(toY / size);
  if (startCol === toCol && startRow === toRow) return true;

  const visited = new Set([startCol + ',' + startRow]);
  const queue = [[startCol, startRow]];
  const dirs = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];

  while (queue.length) {
    const [col, row] = queue.shift();
    for (const [dc, dr] of dirs) {
      const ncol = col + dc, nrow = row + dr;
      if (ncol < 0 || ncol > cols || nrow < 0 || nrow > rows) continue;
      // No cutting corners: a diagonal move between two blocked orthogonal
      // neighbors would let the flood fill leak straight through a wall
      // that's only one cell thick wherever it happens to run diagonally
      // (exactly the shape a hand-drawn loop's boundary usually takes).
      if (dc !== 0 && dr !== 0 && blocked.has(col + dc + ',' + row) && blocked.has(col + ',' + (row + dr))) continue;
      const key = ncol + ',' + nrow;
      if (visited.has(key)) continue;
      if (ncol === toCol && nrow === toRow) return true;
      if (blocked.has(key)) continue;
      visited.add(key);
      queue.push([ncol, nrow]);
    }
  }
  return false;
}

// Long, winding paths are explicitly rewarded by scoring (see
// SCORE_PER_LINE_PIXEL), but a big enough loop can wall off part of the
// board — a dot fully enclosed by one can end up with no route left to
// any of its groupmates, making the wave permanently uncompleteable (the
// actual defect this guards against: a color's dots generate correctly
// as a group, but the board geometry that accumulates over the course of
// play can still trap one of them).
function wouldStrandAnyDot(newSegments, dotA, dotB) {
  const size = STRAND_CHECK_CELL_SIZE;
  const cols = Math.ceil(canvas.width / size) + 1;
  const rows = Math.ceil(canvas.height / size) + 1;
  const blocked = buildBlockedGrid(existingConnectionSegments(newSegments), size);

  for (const dot of STATE.dots) {
    if (dot.connected) continue;
    const groupmates = STATE.dots.filter(d => d.pairId === dot.pairId && d.id !== dot.id && !ufConnected(d.id, dot.id));
    if (groupmates.length === 0) continue;
    const hasRoute = groupmates.some(g => {
      // The pair actually being connected right now is trivially reachable
      // via the very line about to be drawn between them — that new
      // segment is already baked into `blocked`, so testing it against
      // the grid would treat their own about-to-exist connection as a
      // wall between them.
      const isActivePair = (dot.id === dotA.id && g.id === dotB.id) || (dot.id === dotB.id && g.id === dotA.id);
      if (isActivePair) return true;
      return isReachableAround(dot.x, dot.y, g.x, g.y, blocked, size, cols, rows);
    });
    if (!hasRoute) return true;
  }
  return false;
}

function checkWaveComplete() {
  const allConnected = STATE.dots.every(dot => dot.connected);
  if (!allConnected) return;

  // Tutorial text must never coexist with the WAVE COMPLETE overlay —
  // hide it instantly (no fade) rather than leaving it to whatever dismiss
  // condition that wave's hint happened to be waiting on.
  hideTutorialHint(true);

  STATE.phase = 'WAVE_COMPLETE';
  STATE.waveCompleteAdvancing = false;

  // The full song is already playing at this point — every pair's chunk
  // was unmuted as it connected, so the last connection simply completes
  // an arrangement that's been building in real time, in sync, all along.
  STATE.beatSync = { startTime: performance.now(), bpm: STATE.song.genre.bpm };

  haptic('waveComplete');

  // Wave number is already shown persistently in the top-left HUD — no
  // need to repeat it here, which keeps this line short enough to never
  // wrap into the title above it on narrow screens.
  showMessage('WAVE COMPLETE', 'tap or click to advance');
  // The rest of the galaxy reveals itself as a reward for finishing the
  // wave — only the sparse stars scattered around each connected dot are
  // visible while still playing (see spawnStarsAroundDots).
  fillBaseStarfield();
  fillSpaceGalaxy();
  spawnCelestialBodies();

  STATE.score += STATE.wave * 100;
  checkAchievements(STATE.score - STATE.waveStartScore);

  // The song keeps looping (already playing in full) for as long as the
  // player lingers here — there's no auto-advance. Only a tap, click, or
  // key press moves on to the next wave.
  const advance = () => {
    if (STATE.waveCompleteAdvancing) return; // guard against a double-fire from tap + key together
    STATE.waveCompleteAdvancing = true;
    STATE.waveCompleteAdvanceFn = null;
    STATE.beatSync = null;
    startFadeToBlack(() => {
      hideMessage();
      STATE.stars = [];
      STATE.waveCompleteAdvancing = false;
      startWave(STATE.wave + 1);
      startFadeFromBlack();
    });
  };
  STATE.waveCompleteAdvanceFn = advance; // callable from a tap/click/key press
}

function startWave(waveNumber) {
  STATE.wave = waveNumber;
  STATE.phase = 'PLAYING';
  STATE.dots = generateDots(waveNumber);
  ensureAllDotsOnScreen(STATE.dots);
  STATE.dotUnion = {};
  for (const dot of STATE.dots) STATE.dotUnion[dot.id] = dot.id;
  STATE.connections = [];
  STATE.lines = [];
  STATE.activeDot = null;
  STATE.currentPath = [];
  STATE.isDrawing = false;
  STATE.spaceObjects = [];
  STATE.spaceSpawnTimer = 0;
  STATE.celestialBodies = [];
  STATE.waveStartScore = STATE.score;

  showTutorialHint(waveNumber);

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
  const base = Math.min(1 + extra, BARRIER_CONFIG.MAX_BARRIERS);
  // A little per-wave variance so the count isn't perfectly predictable.
  const jitter = Math.random() < 0.3 ? (Math.random() < 0.5 ? -1 : 1) : 0;
  return Math.max(0, Math.min(BARRIER_CONFIG.MAX_BARRIERS, base + jitter));
}

function getRotatingCountForWave(wave) {
  if (wave < BARRIER_CONFIG.ROTATION_START_WAVE) return 0;
  const extra = Math.floor((wave - BARRIER_CONFIG.ROTATION_START_WAVE) / BARRIER_CONFIG.ROTATION_WAVES_PER_BARRIER);
  return Math.min(1 + extra, BARRIER_CONFIG.MAX_ROTATING);
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

function barrierEndpoints(pivotX, pivotY, angle, length) {
  const hx = Math.cos(angle) * length / 2;
  const hy = Math.sin(angle) * length / 2;
  return { x1: pivotX - hx, y1: pivotY - hy, x2: pivotX + hx, y2: pivotY + hy };
}

// Places each barrier to actually cross the straight line between one
// color pair's two dots — at a random point along that line (not always
// the middle) and at a near-perpendicular angle — so it genuinely blocks
// the direct path between them instead of landing wherever chance puts it.
// Higher waves add slowly-rotating barriers that break any already-drawn
// connection they sweep through (see checkRotatingBarrierBreaks).
function generateBarriers(wave, dots) {
  const count = getBarrierCountForWave(wave);
  const rotatingCount = Math.min(count, getRotatingCountForWave(wave));
  // Not dots.length/2 — a color group can now have more than 2 dots (see
  // GROUP_CONFIG), so the number of distinct color groups has to be
  // counted directly rather than assumed.
  const pairCount = new Set(dots.map(d => d.pairId)).size;
  const barriers = [];
  const targetedPairs = new Set();
  let attempts = 0;

  while (barriers.length < count && attempts < 400) {
    attempts++;
    const untargeted = [];
    for (let p = 0; p < pairCount; p++) if (!targetedPairs.has(p)) untargeted.push(p);
    const pool = untargeted.length ? untargeted : [...Array(pairCount).keys()];
    const pairId = pool[Math.floor(Math.random() * pool.length)];

    // A color group can have more than 2 dots (see GROUP_CONFIG) — target
    // a random pair from within it rather than always the first two, so a
    // barrier can end up blocking any potential edge of the network, not
    // just one fixed one.
    const groupDots = dots.filter(d => d.pairId === pairId);
    const gi = Math.floor(Math.random() * groupDots.length);
    let gj = Math.floor(Math.random() * (groupDots.length - 1));
    if (gj >= gi) gj++;
    const a = groupDots[gi], b = groupDots[gj];
    const dx = b.x - a.x, dy = b.y - a.y;
    const pairDist = Math.hypot(dx, dy);
    if (pairDist < 40) continue; // too close together to usefully block

    const t = BARRIER_CONFIG.PAIR_LINE_MIN_T + Math.random() * (BARRIER_CONFIG.PAIR_LINE_MAX_T - BARRIER_CONFIG.PAIR_LINE_MIN_T);
    const pivotX = a.x + dx * t, pivotY = a.y + dy * t;

    const lineAngle = Math.atan2(dy, dx);
    const angle = lineAngle + Math.PI / 2 + (Math.random() - 0.5) * BARRIER_CONFIG.ANGLE_JITTER;
    const lengthFraction = BARRIER_CONFIG.LENGTH_MIN_FRACTION + Math.random() * (BARRIER_CONFIG.LENGTH_MAX_FRACTION - BARRIER_CONFIG.LENGTH_MIN_FRACTION);
    const length = Math.max(BARRIER_CONFIG.MIN_LENGTH, Math.min(BARRIER_CONFIG.MAX_LENGTH, pairDist * lengthFraction));

    const { x1, y1, x2, y2 } = barrierEndpoints(pivotX, pivotY, angle, length);

    const c = BARRIER_CONFIG.SCREEN_CLEARANCE;
    if (x1 < c || x1 > canvas.width - c || x2 < c || x2 > canvas.width - c) continue;
    if (y1 < c || y1 > canvas.height - c || y2 < c || y2 > canvas.height - c) continue;
    if (!segmentClearsAllDots(x1, y1, x2, y2, dots)) continue;

    const rotating = barriers.length < rotatingCount;
    const speed = Math.min(
      BARRIER_CONFIG.ROTATION_SPEED_MAX,
      BARRIER_CONFIG.ROTATION_SPEED_BASE + wave * BARRIER_CONFIG.ROTATION_SPEED_PER_WAVE
    );
    barriers.push({
      x1, y1, x2, y2,
      pivotX, pivotY, angle, length,
      rotating,
      angularSpeed: rotating ? speed * (Math.random() < 0.5 ? -1 : 1) : 0,
      targetPairId: pairId,
      colorIndex: a.colorIndex, // tints the barrier to match the pair it's actually blocking
    });
    targetedPairs.add(pairId);
  }

  return barriers;
}

// Advances every rotating barrier's angle and recomputes its endpoints —
// called once per frame from update().
function updateBarriers() {
  for (const b of STATE.barriers) {
    if (!b.rotating) continue;
    b.angle += b.angularSpeed;
    const { x1, y1, x2, y2 } = barrierEndpoints(b.pivotX, b.pivotY, b.angle, b.length);
    b.x1 = x1; b.y1 = y1; b.x2 = x2; b.y2 = y2;
  }
}

// A spinning barrier that sweeps into an already-completed connection snaps
// it — the player has to route around rotating barriers while still
// finishing the puzzle, not just avoid them once and forget about them.
// Only checked while still actively playing (not during the post-completion
// listen/fade), since by then the puzzle's already been solved.
function checkRotatingBarrierBreaks() {
  if (STATE.phase !== 'PLAYING') return;
  // Collect which colors got hit first (a color can have multiple edges
  // once a group has 3+ dots — see GROUP_CONFIG), then break each once.
  // Breaking mutates/removes entries from STATE.connections, so resolving
  // hits before acting on any of them avoids invalidating indices mid-scan.
  const hits = new Map(); // pairId -> { colorIndex, sparkX, sparkY }
  for (const b of STATE.barriers) {
    if (!b.rotating) continue;
    for (const conn of STATE.connections) {
      if (hits.has(conn.pairId)) continue;
      for (const seg of conn.segments) {
        if (segmentsIntersect(seg, { x1: b.x1, y1: b.y1, x2: b.x2, y2: b.y2 })) {
          hits.set(conn.pairId, { colorIndex: conn.colorIndex, sparkX: (b.x1 + b.x2) / 2, sparkY: (b.y1 + b.y2) / 2 });
          break;
        }
      }
    }
  }
  for (const [pairId, hit] of hits) breakConnection(pairId, hit.colorIndex, hit.sparkX, hit.sparkY);
}

// Resets a color's WHOLE network, not just the one edge the barrier swept
// through — once a group has 3+ dots (see GROUP_CONFIG), a single edge
// can't be cleanly un-linked from the rest without re-deriving connectivity
// from the remaining edges, so a barrier strike sends that color back to
// square one instead. Simpler rule, and an honest one: if a barrier cuts
// through any part of a color's network, that color's progress resets.
function breakConnection(pairId, colorIndex, sparkX, sparkY) {
  const groupDots = STATE.dots.filter(d => d.pairId === pairId);
  for (const d of groupDots) {
    d.connected = false;
    STATE.dotUnion[d.id] = d.id;
  }

  for (let i = STATE.connections.length - 1; i >= 0; i--) {
    if (STATE.connections[i].pairId === pairId) STATE.connections.splice(i, 1);
  }
  STATE.lines = STATE.lines.filter(l => l.pairId !== pairId);
  spawnBreakSparks(sparkX, sparkY, colorIndex);
  remuteChunk(pairId);
  haptic('break');
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
  for (const b of STATE.barriers) {
    // Tinted to the color of the pair it actually blocks — a generic
    // red/orange hazard color gave no visual clue which path a barrier
    // related to, so a well-placed one could still read as "just some
    // line sitting there." Dash pattern / solid+blade-caps still keeps it
    // unmistakably a barrier rather than a connection line.
    const instrument = INSTRUMENTS[b.colorIndex] || INSTRUMENTS[0];
    if (b.rotating) {
      ctx.lineWidth = 7;
      ctx.setLineDash([]);
      ctx.strokeStyle = instrument.glow + '0.8)';
      ctx.shadowBlur = 24;
      ctx.shadowColor = instrument.hex;
    } else {
      ctx.lineWidth = 8;
      ctx.setLineDash([14, 10]);
      ctx.strokeStyle = instrument.glow + '0.65)';
      ctx.shadowBlur = 18;
      ctx.shadowColor = instrument.hex;
    }
    ctx.beginPath();
    ctx.moveTo(b.x1, b.y1);
    ctx.lineTo(b.x2, b.y2);
    ctx.stroke();

    if (b.rotating) {
      // Small end-caps read as a spinning blade/pendulum rather than a wall.
      ctx.shadowBlur = 10;
      for (const [ex, ey] of [[b.x1, b.y1], [b.x2, b.y2]]) {
        ctx.beginPath();
        ctx.fillStyle = '#ffffff';
        ctx.arc(ex, ey, 5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  ctx.restore();
}

// Brief radial particle burst marking where a rotating barrier snapped a
// connection — the visual "snap" to go with the line disappearing instantly
// instead of its usual slow ambient fade.
function spawnBreakSparks(x, y, colorIndex) {
  const count = 10;
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + Math.random() * 0.3;
    const speed = 1.5 + Math.random() * 2.5;
    STATE.breakSparks.push({
      x, y, colorIndex,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 1.0,
    });
  }
}

function updateBreakSparks() {
  for (const s of STATE.breakSparks) {
    s.x += s.vx;
    s.y += s.vy;
    s.vx *= 0.94;
    s.vy *= 0.94;
    s.life -= 0.045;
  }
  STATE.breakSparks = STATE.breakSparks.filter(s => s.life > 0);
}

function drawBreakSparks() {
  for (const s of STATE.breakSparks) {
    const instrument = INSTRUMENTS[s.colorIndex];
    ctx.save();
    ctx.globalAlpha = Math.max(0, s.life);
    ctx.shadowBlur = 14;
    ctx.shadowColor = instrument.hex;
    ctx.beginPath();
    ctx.fillStyle = '#ffffff';
    ctx.arc(s.x, s.y, 3 * s.life + 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

// ============================================================
// SECTION 7C: STARFIELD & SPACE BACKGROUND
// ============================================================
function makeStar(x, y, fadeSpeed) {
  const twinkling = Math.random() < STARFIELD_CONFIG.TWINKLE_FRACTION;
  return {
    x, y,
    radius: 0.6 + Math.random() * 1.6,
    targetAlpha: 0.35 + Math.random() * 0.55,
    alpha: 0,
    fadeSpeed,
    twinkling,
    twinklePhase: Math.random() * Math.PI * 2,
    twinkleSpeed: twinkling
      ? STARFIELD_CONFIG.TWINKLE_SPEED_MIN + Math.random() * (STARFIELD_CONFIG.TWINKLE_SPEED_MAX - STARFIELD_CONFIG.TWINKLE_SPEED_MIN)
      : 0,
  };
}

// Fills the rest of the canvas with an ambient starfield, scaled to its
// area so a wide desktop window ends up as full as a narrow phone screen
// instead of showing big empty gaps. Called when the wave completes, as a
// reveal — while still playing, only the sparse stars scattered around
// each connected dot (spawnStarsAroundDots) are visible. Fades in slowly
// (REVEAL_FADE_IN_SPEED) so it reads as a gradual unveiling rather than a
// sudden pop-in.
function fillBaseStarfield() {
  const targetCount = Math.min(
    STARFIELD_CONFIG.MAX_STARS,
    Math.round((canvas.width * canvas.height) / STARFIELD_CONFIG.AREA_PER_BASE_STAR)
  );
  while (STATE.stars.length < targetCount) {
    STATE.stars.push(makeStar(Math.random() * canvas.width, Math.random() * canvas.height, STARFIELD_CONFIG.REVEAL_FADE_IN_SPEED));
  }
}

function spawnStarsAroundDots(dotA, dotB) {
  const perDot = Math.round(STARFIELD_CONFIG.STARS_PER_CONNECTION / 2);
  for (const dot of [dotA, dotB]) {
    for (let i = 0; i < perDot; i++) {
      if (STATE.stars.length >= STARFIELD_CONFIG.MAX_STARS) return;
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.random() * STARFIELD_CONFIG.CONNECTION_STAR_RADIUS;
      STATE.stars.push(makeStar(dot.x + Math.cos(angle) * dist, dot.y + Math.sin(angle) * dist, STARFIELD_CONFIG.STAR_FADE_IN_SPEED));
    }
  }
}

function updateStars() {
  for (const s of STATE.stars) {
    if (s.alpha < s.targetAlpha) s.alpha = Math.min(s.targetAlpha, s.alpha + s.fadeSpeed);
    if (s.twinkling) s.twinklePhase += s.twinkleSpeed;
  }
}

function drawStars() {
  for (const s of STATE.stars) {
    const twinkle = s.twinkling ? 0.7 + 0.3 * Math.sin(s.twinklePhase) : 1;
    ctx.beginPath();
    ctx.fillStyle = `rgba(255,255,255,${(s.alpha * twinkle).toFixed(3)})`;
    ctx.arc(s.x, s.y, s.radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

// startX lets the wave-complete instant fill drop objects already on-screen;
// the normal trickle-spawn omits it so objects drift in from off-screen.
function spawnSpaceObject(startX) {
  const type = SPACE_CONFIG.TYPES[Math.floor(Math.random() * SPACE_CONFIG.TYPES.length)];
  const fromLeft = Math.random() < 0.5;
  const y = Math.random() * canvas.height;
  const speed = 0.15 + Math.random() * 0.3;

  const obj = {
    type,
    x: startX !== undefined ? startX : (fromLeft ? -40 : canvas.width + 40),
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

// The normal trickle-spawn is too slow to populate the sky in a reasonable
// time on its own. Populate the whole galaxy at once, already scattered
// on-screen, right when the wave completes.
function fillSpaceGalaxy() {
  STATE.spaceObjects = [];
  for (let i = 0; i < SPACE_CONFIG.MAX_OBJECTS; i++) {
    spawnSpaceObject(Math.random() * canvas.width);
  }
  STATE.spaceSpawnTimer = 0;
}

function makeCraters(radius) {
  const craters = [];
  const count = 4 + Math.floor(Math.random() * 5);
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = Math.random() * radius * 0.7;
    craters.push({ x: Math.cos(a) * d, y: Math.sin(a) * d, r: radius * (0.08 + Math.random() * 0.12) });
  }
  return craters;
}

function makeBands() {
  const count = 5 + Math.floor(Math.random() * 4);
  const bands = [];
  for (let i = 0; i < count; i++) {
    bands.push({ pos: i / count, width: (1 / count) * (0.6 + Math.random() * 0.8), lightness: 0.28 + Math.random() * 0.4 });
  }
  return bands;
}

// Types whose footprint is one primary sphere (uses MIN_RADIUS/MAX_RADIUS)
// vs. types made of several scattered/extended elements (uses MIN_SPREAD/
// MAX_SPREAD as their placement-clearance footprint) — both comfortably
// past a dot's max possible size either way.
const CELESTIAL_SPHERE_TYPES = new Set(['rocky', 'gasGiant', 'ringed', 'moon', 'iceGiant', 'redGiant', 'whiteDwarf', 'blackHole', 'pulsar', 'quasar']);

// 0, 1, or 2 large background bodies, placed clear of each other, each
// fading in independently over the reveal (see updateCelestialBodies).
// Random sub-details (cluster points, nebula blobs, streak angles...) are
// generated once here and stored on the body, not re-rolled per frame —
// otherwise they'd flicker.
function spawnCelestialBodies() {
  STATE.celestialBodies = [];
  const count = Math.floor(Math.random() * 3);
  const placed = [];
  for (let i = 0; i < count; i++) {
    const type = CELESTIAL_TYPES[Math.floor(Math.random() * CELESTIAL_TYPES.length)];
    const isSphere = CELESTIAL_SPHERE_TYPES.has(type);
    const radius = CELESTIAL_CONFIG.MIN_RADIUS + Math.random() * (CELESTIAL_CONFIG.MAX_RADIUS - CELESTIAL_CONFIG.MIN_RADIUS);
    const spread = CELESTIAL_CONFIG.MIN_SPREAD + Math.random() * (CELESTIAL_CONFIG.MAX_SPREAD - CELESTIAL_CONFIG.MIN_SPREAD);
    const footprint = isSphere ? radius : spread;

    let x, y, attempts = 0;
    do {
      x = canvas.width * (0.12 + Math.random() * 0.76);
      y = canvas.height * (0.1 + Math.random() * 0.55); // keep clear of the bottom UI/version-display strip
      attempts++;
    } while (placed.some(p => Math.hypot(p.x - x, p.y - y) < CELESTIAL_CONFIG.MIN_SEPARATION) && attempts < 20);
    placed.push({ x, y });

    const body = {
      type, x, y, radius, spread,
      hue: celestialHue(),
      rotation: Math.random() * Math.PI * 2,
      rotSpeed: 0.0004 + Math.random() * 0.0006, // barely perceptible spin — distant and slow
      ringAngle: -0.35 + Math.random() * 0.2,
      lightAngle: Math.random() * Math.PI * 2,
      alpha: 0,
      craters: (type === 'rocky' || type === 'moon') ? makeCraters(radius) : null,
      bands: (type === 'gasGiant' || type === 'iceGiant') ? makeBands() : null,
    };

    // Type-specific one-time random layout.
    if (type === 'starCluster') {
      body.points = [];
      const n = 10 + Math.floor(Math.random() * 10);
      for (let p = 0; p < n; p++) {
        const a = Math.random() * Math.PI * 2, d = Math.random() * spread;
        body.points.push({ x: Math.cos(a) * d, y: Math.sin(a) * d, r: 1 + Math.random() * 2, phase: Math.random() * Math.PI * 2 });
      }
    } else if (type === 'asteroidField') {
      body.rocks = [];
      const n = 5 + Math.floor(Math.random() * 5);
      for (let p = 0; p < n; p++) {
        const a = Math.random() * Math.PI * 2, d = Math.random() * spread;
        const rr = 5 + Math.random() * 8;
        const verts = [];
        const vc = 6 + Math.floor(Math.random() * 3);
        for (let v = 0; v < vc; v++) verts.push(0.7 + Math.random() * 0.5);
        body.rocks.push({ x: Math.cos(a) * d, y: Math.sin(a) * d, r: rr, verts, rot: Math.random() * Math.PI * 2 });
      }
    } else if (type === 'nebula') {
      body.blobs = [];
      const n = 5 + Math.floor(Math.random() * 4);
      for (let p = 0; p < n; p++) {
        const a = Math.random() * Math.PI * 2, d = Math.random() * spread * 0.6;
        body.blobs.push({ x: Math.cos(a) * d, y: Math.sin(a) * d, r: spread * (0.35 + Math.random() * 0.35), hueOffset: (Math.random() - 0.5) * 40 });
      }
    } else if (type === 'spiralGalaxy') {
      body.armPoints = [];
      const arms = 2 + Math.floor(Math.random() * 2);
      for (let arm = 0; arm < arms; arm++) {
        const armOffset = (arm / arms) * Math.PI * 2;
        const n = 22;
        for (let p = 0; p < n; p++) {
          const t = p / n;
          const a = armOffset + t * Math.PI * 2.4;
          const d = t * spread;
          body.armPoints.push({ x: Math.cos(a) * d, y: Math.sin(a) * d, r: 1 + (1 - t) * 1.8 });
        }
      }
    } else if (type === 'meteorShower') {
      body.streaks = [];
      const n = 4 + Math.floor(Math.random() * 4);
      const baseAngle = Math.random() * Math.PI * 2;
      for (let p = 0; p < n; p++) {
        const a = baseAngle + (Math.random() - 0.5) * 0.3;
        const ox = (Math.random() - 0.5) * spread * 1.6, oy = (Math.random() - 0.5) * spread * 1.6;
        const len = spread * (0.35 + Math.random() * 0.4);
        body.streaks.push({ x1: ox, y1: oy, x2: ox + Math.cos(a) * len, y2: oy + Math.sin(a) * len });
      }
    } else if (type === 'aurora') {
      body.ribbons = [];
      const n = 2 + Math.floor(Math.random() * 2);
      for (let p = 0; p < n; p++) {
        body.ribbons.push({ yOffset: (p - n / 2) * spread * 0.3, hueOffset: (Math.random() - 0.5) * 50, phase: Math.random() * Math.PI * 2 });
      }
    } else if (type === 'greatComet') {
      body.tailAngle = Math.random() * Math.PI * 2;
    } else if (type === 'binaryStar') {
      body.orbitPhase = Math.random() * Math.PI * 2;
    } else if (type === 'pulsar' || type === 'quasar') {
      body.beamAngle = Math.random() * Math.PI * 2;
    }

    STATE.celestialBodies.push(body);
  }
}

function updateCelestialBodies() {
  for (const body of STATE.celestialBodies) {
    if (body.alpha < 1) body.alpha = Math.min(1, body.alpha + STARFIELD_CONFIG.REVEAL_FADE_IN_SPEED);
    body.rotation += body.rotSpeed;
    if (body.type === 'binaryStar') body.orbitPhase += 0.0012;
    if (body.type === 'pulsar' || body.type === 'quasar') body.beamAngle += body.rotSpeed * 2;
  }
}

// Shared radial-gradient sphere fill, reused by every sphere-based type —
// always shaded dark-to-light off-center (never a flat saturated circle
// with a centered highlight, which is exactly a dot's signature).
function fillShadedSphere(radius, hue, sat, lightCore, lightMid, lightEdge, lx, ly) {
  const grad = ctx.createRadialGradient(lx, ly, radius * 0.1, 0, 0, radius * 1.15);
  grad.addColorStop(0, `hsl(${hue}, ${sat}%, ${lightCore}%)`);
  grad.addColorStop(0.6, `hsl(${hue}, ${sat}%, ${lightMid}%)`);
  grad.addColorStop(1, `hsl(${hue}, ${sat}%, ${lightEdge}%)`);
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();
}

function drawSoftGlow(radius, hue, alpha) {
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
  g.addColorStop(0, `hsla(${hue}, 85%, 75%, ${alpha})`);
  g.addColorStop(1, 'hsla(0,0%,0%,0)');
  ctx.beginPath();
  ctx.fillStyle = g;
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.fill();
}

function drawCelestialRing(radius, hue, ringAngle, behindSphere, satL, ringWidthMul, alpha) {
  ctx.save();
  ctx.rotate(ringAngle);
  ctx.scale(1, 0.32);
  ctx.beginPath();
  const start = behindSphere ? Math.PI * 0.02 : Math.PI * 1.02;
  const end = behindSphere ? Math.PI * 0.98 : Math.PI * 1.98;
  ctx.arc(0, 0, radius * 1.8, start, end);
  ctx.strokeStyle = `hsla(${hue}, ${satL}, ${alpha})`;
  ctx.lineWidth = radius * ringWidthMul;
  ctx.stroke();
  ctx.restore();
}

function drawCelestialBodies() {
  for (const body of STATE.celestialBodies) {
    if (body.alpha <= 0) continue;
    ctx.save();
    ctx.globalAlpha = body.alpha;
    ctx.translate(body.x, body.y);

    const lx = Math.cos(body.lightAngle) * body.radius * 0.6;
    const ly = Math.sin(body.lightAngle) * body.radius * 0.6;

    switch (body.type) {
      case 'rocky':
      case 'moon': {
        ctx.rotate(body.rotation);
        const sat = body.type === 'moon' ? 8 : 45;
        fillShadedSphere(body.radius, body.hue, sat, body.type === 'moon' ? 68 : 58, body.type === 'moon' ? 42 : 36, body.type === 'moon' ? 10 : 10, lx, ly);
        if (body.craters) {
          for (const c of body.craters) {
            ctx.beginPath();
            ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(0,0,0,0.18)';
            ctx.fill();
          }
        }
        ctx.beginPath();
        ctx.arc(0, 0, body.radius * 1.02, 0, Math.PI * 2);
        ctx.strokeStyle = `hsla(${body.hue}, 60%, 70%, 0.15)`;
        ctx.lineWidth = body.radius * 0.08;
        ctx.stroke();
        break;
      }
      case 'gasGiant':
      case 'iceGiant': {
        ctx.rotate(body.rotation);
        const cool = body.type === 'iceGiant';
        fillShadedSphere(body.radius, body.hue, cool ? 35 : 55, cool ? 75 : 62, cool ? 55 : 42, cool ? 25 : 14, lx, ly);
        if (body.bands) {
          ctx.save();
          ctx.beginPath();
          ctx.arc(0, 0, body.radius, 0, Math.PI * 2);
          ctx.clip();
          for (const b of body.bands) {
            const yPos = (b.pos - 0.5) * body.radius * 2;
            ctx.fillStyle = `hsla(${body.hue}, ${cool ? 25 : 40}%, ${(b.lightness * 100).toFixed(0)}%, 0.35)`;
            ctx.fillRect(-body.radius, yPos, body.radius * 2, b.width * body.radius * 2);
          }
          ctx.restore();
        }
        ctx.beginPath();
        ctx.arc(0, 0, body.radius * 1.02, 0, Math.PI * 2);
        ctx.strokeStyle = `hsla(${body.hue}, 60%, 70%, 0.15)`;
        ctx.lineWidth = body.radius * 0.08;
        ctx.stroke();
        break;
      }
      case 'ringed': {
        drawCelestialRing(body.radius, body.hue, body.ringAngle, true, '30%, 75%', 0.32, '0.5)');
        ctx.rotate(body.rotation);
        fillShadedSphere(body.radius, body.hue, 45, 58, 36, 10, lx, ly);
        ctx.rotate(-body.rotation);
        drawCelestialRing(body.radius, body.hue, body.ringAngle, false, '30%, 75%', 0.32, '0.5)');
        break;
      }
      case 'redGiant': {
        drawSoftGlow(body.radius * 2.2, body.hue, 0.18);
        fillShadedSphere(body.radius * 1.3, body.hue, 70, 75, 55, 30, lx * 0.5, ly * 0.5);
        break;
      }
      case 'whiteDwarf': {
        const r = body.radius * 0.35;
        drawSoftGlow(r * 4, body.hue, 0.35);
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fillStyle = `hsl(${body.hue}, 30%, 92%)`;
        ctx.fill();
        // thin sharp corona rays — reads as a dense point source, not a filled circle
        ctx.strokeStyle = `hsla(${body.hue}, 40%, 90%, 0.4)`;
        ctx.lineWidth = 1.5;
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2 + body.rotation;
          ctx.beginPath();
          ctx.moveTo(Math.cos(a) * r * 1.4, Math.sin(a) * r * 1.4);
          ctx.lineTo(Math.cos(a) * r * 4, Math.sin(a) * r * 4);
          ctx.stroke();
        }
        break;
      }
      case 'blackHole': {
        drawCelestialRing(body.radius, body.hue, body.ringAngle, true, '55%, 70%', 0.22, '0.6)');
        ctx.beginPath();
        ctx.arc(0, 0, body.radius * 0.7, 0, Math.PI * 2);
        ctx.fillStyle = '#000000';
        ctx.fill();
        drawCelestialRing(body.radius, body.hue, body.ringAngle, false, '55%, 70%', 0.22, '0.6)');
        break;
      }
      case 'protoplanetaryDisk': {
        drawCelestialRing(body.radius * 1.4, body.hue, body.ringAngle, true, '30%, 60%', 0.5, '0.28)');
        drawSoftGlow(body.radius * 0.6, body.hue, 0.5);
        ctx.beginPath();
        ctx.arc(0, 0, body.radius * 0.18, 0, Math.PI * 2);
        ctx.fillStyle = `hsl(${body.hue}, 40%, 90%)`;
        ctx.fill();
        drawCelestialRing(body.radius * 1.4, body.hue, body.ringAngle, false, '30%, 60%', 0.5, '0.28)');
        break;
      }
      case 'supernovaRemnant': {
        for (let i = 0; i < 3; i++) {
          ctx.beginPath();
          ctx.arc(0, 0, body.radius * (0.7 + i * 0.22), i * 0.7, i * 0.7 + Math.PI * 1.6);
          ctx.strokeStyle = `hsla(${body.hue + i * 12}, 60%, 65%, ${0.22 - i * 0.05})`;
          ctx.lineWidth = body.radius * 0.1;
          ctx.stroke();
        }
        drawSoftGlow(body.radius * 0.5, body.hue, 0.15);
        break;
      }
      case 'pulsar':
      case 'quasar': {
        const isQuasar = body.type === 'quasar';
        const r = Math.max(26, body.radius * (isQuasar ? 0.4 : 0.32)); // floor so the bright core alone still reads bigger than a dot
        drawSoftGlow(r * 3, body.hue, isQuasar ? 0.4 : 0.25);
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fillStyle = `hsl(${body.hue}, 50%, 88%)`;
        ctx.fill();
        ctx.save();
        ctx.rotate(body.beamAngle);
        const beamLen = body.radius * (isQuasar ? 3.2 : 2.2);
        for (const dir of [1, -1]) {
          const grad = ctx.createLinearGradient(0, 0, 0, dir * beamLen);
          grad.addColorStop(0, `hsla(${body.hue}, 70%, 85%, ${isQuasar ? 0.55 : 0.35})`);
          grad.addColorStop(1, 'hsla(0,0%,0%,0)');
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.moveTo(-r * 0.5, 0);
          ctx.lineTo(r * 0.5, 0);
          ctx.lineTo(r * 0.12, dir * beamLen);
          ctx.lineTo(-r * 0.12, dir * beamLen);
          ctx.closePath();
          ctx.fill();
        }
        ctx.restore();
        break;
      }
      case 'binaryStar': {
        // Sized off `spread`, not `radius` — each star needs to individually
        // stay well above a dot's size, not just their combined footprint.
        const orbitR = body.spread * 0.32;
        const starR = body.spread * 0.32;
        for (const sign of [1, -1]) {
          const a = body.orbitPhase + (sign === 1 ? 0 : Math.PI);
          ctx.save();
          ctx.translate(Math.cos(a) * orbitR, Math.sin(a) * orbitR * 0.4);
          drawSoftGlow(starR * 1.4, body.hue + (sign === 1 ? 0 : 20), 0.3);
          fillShadedSphere(starR, body.hue + (sign === 1 ? 0 : 20), 55, 75, 55, 25, starR * 0.25, starR * 0.25);
          ctx.restore();
        }
        break;
      }
      case 'starCluster': {
        for (const p of body.points) {
          const tw = 0.6 + 0.4 * Math.sin(body.rotation * 30 + p.phase);
          ctx.beginPath();
          ctx.fillStyle = `hsla(${body.hue}, 60%, 88%, ${tw})`;
          ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      }
      case 'asteroidField': {
        for (const rock of body.rocks) {
          ctx.save();
          ctx.translate(rock.x, rock.y);
          ctx.rotate(rock.rot);
          ctx.beginPath();
          const n = rock.verts.length;
          for (let i = 0; i < n; i++) {
            const a = (i / n) * Math.PI * 2;
            const r = rock.r * rock.verts[i];
            const vx = Math.cos(a) * r, vy = Math.sin(a) * r;
            if (i === 0) ctx.moveTo(vx, vy); else ctx.lineTo(vx, vy);
          }
          ctx.closePath();
          ctx.fillStyle = 'rgba(130,125,120,0.45)';
          ctx.strokeStyle = 'rgba(190,185,180,0.3)';
          ctx.lineWidth = 1;
          ctx.fill();
          ctx.stroke();
          ctx.restore();
        }
        break;
      }
      case 'nebula': {
        for (const b of body.blobs) {
          ctx.save();
          ctx.translate(b.x, b.y);
          drawSoftGlow(b.r, body.hue + b.hueOffset, 0.1);
          ctx.restore();
        }
        break;
      }
      case 'spiralGalaxy': {
        drawSoftGlow(body.spread * 0.5, body.hue, 0.14);
        ctx.rotate(body.rotation);
        for (const p of body.armPoints) {
          ctx.beginPath();
          ctx.fillStyle = `hsla(${body.hue}, 55%, 80%, 0.5)`;
          ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.beginPath();
        ctx.fillStyle = `hsl(${body.hue}, 60%, 88%)`;
        ctx.arc(0, 0, body.spread * 0.06, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'aurora': {
        for (const r of body.ribbons) {
          const wobble = Math.sin(body.rotation * 20 + r.phase) * body.spread * 0.08;
          ctx.beginPath();
          ctx.moveTo(-body.spread, r.yOffset + wobble);
          ctx.quadraticCurveTo(0, r.yOffset - wobble * 2, body.spread, r.yOffset + wobble);
          ctx.strokeStyle = `hsla(${body.hue + r.hueOffset}, 70%, 65%, 0.18)`;
          ctx.lineWidth = body.spread * 0.22;
          ctx.lineCap = 'round';
          ctx.stroke();
        }
        break;
      }
      case 'greatComet': {
        ctx.save();
        ctx.rotate(body.tailAngle);
        const tailLen = body.spread * 1.1;
        const grad = ctx.createLinearGradient(0, 0, -tailLen, 0);
        grad.addColorStop(0, `hsla(${body.hue}, 60%, 85%, 0.35)`);
        grad.addColorStop(1, 'hsla(0,0%,0%,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(0, -body.radius * 0.22);
        ctx.lineTo(-tailLen, -body.radius * 0.06);
        ctx.lineTo(-tailLen, body.radius * 0.06);
        ctx.lineTo(0, body.radius * 0.22);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        drawSoftGlow(body.radius * 0.6, body.hue, 0.4);
        ctx.beginPath();
        ctx.arc(0, 0, body.radius * 0.22, 0, Math.PI * 2);
        ctx.fillStyle = `hsl(${body.hue}, 50%, 88%)`;
        ctx.fill();
        break;
      }
      case 'meteorShower': {
        for (const s of body.streaks) {
          const grad = ctx.createLinearGradient(s.x1, s.y1, s.x2, s.y2);
          grad.addColorStop(0, 'hsla(0,0%,0%,0)');
          grad.addColorStop(1, `hsla(${body.hue}, 50%, 85%, 0.55)`);
          ctx.strokeStyle = grad;
          ctx.lineWidth = 2;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(s.x1, s.y1);
          ctx.lineTo(s.x2, s.y2);
          ctx.stroke();
        }
        break;
      }
    }

    ctx.restore();
  }
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
      case 'connect': navigator.vibrate([16, 14, 16]); break; // a quick double-tap "ping" instead of one flat buzz
      case 'reject': navigator.vibrate([20, 30, 20]); break;
      case 'break': navigator.vibrate([15, 25, 40]); break;
      case 'waveComplete': navigator.vibrate([80, 40, 80, 40, 120]); break;
    }
  } catch (e) {
    // Silently fail — iOS Safari may not support vibrate
  }
}

// ============================================================
// PAUSE MENU
// ============================================================
function closePauseMenuUI() {
  document.getElementById('pause-overlay').classList.remove('visible');
  stopPauseFactRotation();
}

function pauseGame() {
  if (STATE.paused || STATE.phase === 'TITLE') return; // nothing meaningful to pause from the title screen
  STATE.paused = true;
  if (STATE.audioCtx && STATE.masterGain) {
    const t = STATE.audioCtx.currentTime;
    STATE.masterGain.gain.cancelScheduledValues(t);
    STATE.masterGain.gain.setValueAtTime(STATE.masterGain.gain.value, t);
    STATE.masterGain.gain.linearRampToValueAtTime(0.0001, t + 0.25);
  }
  document.getElementById('pause-save-toast').classList.remove('visible');
  document.getElementById('pause-overlay').classList.add('visible');
  startPauseFactRotation();
}

function resumeGame() {
  if (!STATE.paused) return;
  STATE.paused = false;
  if (STATE.audioCtx && STATE.masterGain) {
    const t = STATE.audioCtx.currentTime;
    STATE.masterGain.gain.cancelScheduledValues(t);
    STATE.masterGain.gain.setValueAtTime(STATE.masterGain.gain.value, t);
    STATE.masterGain.gain.linearRampToValueAtTime(1.0, t + 0.25);
  }
  closePauseMenuUI();
}

function togglePause() {
  if (STATE.phase === 'TITLE') return; // nothing to pause before the game has started
  if (STATE.paused) resumeGame(); else pauseGame();
}

function handleSaveGame() {
  const ok = saveGame();
  const toast = document.getElementById('pause-save-toast');
  toast.textContent = ok ? 'Game Saved' : 'Could Not Save';
  toast.classList.add('visible');
  setTimeout(() => toast.classList.remove('visible'), 1800);
}

// Loads whatever was last written by Save Game (or resumed from the title
// screen) — jumps straight to that wave/score via the same fade transition
// the restart actions use. If nothing's been saved yet, says so instead of
// silently doing nothing.
function handleLoadGame() {
  const save = loadSave();
  if (!save) {
    const toast = document.getElementById('pause-save-toast');
    toast.textContent = 'No Saved Game';
    toast.classList.add('visible');
    setTimeout(() => toast.classList.remove('visible'), 1800);
    return;
  }
  closePauseMenuUI();
  STATE.paused = false;
  startFadeToBlack(() => {
    STATE.score = save.score;
    startWave(save.wave);
    startFadeFromBlack();
  });
}

// Restart/Restart Game/Exit all reuse the existing wave-transition fade
// (see startFadeToBlack/startFadeFromBlack) for a consistent, non-jarring
// transition rather than an abrupt cut — the same fade wave changes
// already use. STATE.paused is cleared first so update() actually runs
// the fade animation and audio ramp.
function handleRestartCurrentLevel() {
  closePauseMenuUI();
  STATE.paused = false;
  startFadeToBlack(() => {
    STATE.score = STATE.waveStartScore; // undo this wave's own earned points, not the whole run
    startWave(STATE.wave);
    startFadeFromBlack();
  });
}

function handleRestartGame() {
  closePauseMenuUI();
  STATE.paused = false;
  startFadeToBlack(() => {
    STATE.score = 0;
    startWave(1);
    startFadeFromBlack();
  });
}

function handleExitGame() {
  closePauseMenuUI();
  STATE.paused = false;
  startFadeToBlack(() => {
    exitToTitle();
    startFadeFromBlack();
  });
}

// Returns to the same pristine state the game boots into — dots, lines,
// barriers, and the starfield all cleared, any in-flight audio hard-stopped.
function exitToTitle() {
  STATE.phase = 'TITLE';
  STATE.wave = 0;
  STATE.score = 0;
  STATE.dots = [];
  STATE.connections = [];
  STATE.lines = [];
  STATE.barriers = [];
  STATE.stars = [];
  STATE.spaceObjects = [];
  STATE.celestialBodies = [];
  STATE.beatSync = null;
  STATE.song = null;
  hideTutorialHint(true); // in-wave UI must never linger over the title screen
  document.getElementById('achievement-toast').classList.remove('visible');
  STATE.achievementQueue = [];
  STATE.achievementToastActive = false;
  if (STATE.audioCtx) stopAllScheduledAudio(STATE.audioCtx.currentTime);

  // Re-check for a save (e.g. one made via "Save Game" earlier this
  // session) so the title screen accurately offers to continue from it.
  STATE.pendingResume = loadSave();
  updateWaveDisplay();
  showMessage(
    'LUMINA',
    STATE.pendingResume ? `tap or click to resume — wave ${STATE.pendingResume.wave}` : 'connect the dots. make the music.',
    { isTitleScreen: true }
  );
}

// Rotating pause-menu content: 50 curated facts + 20 game tips, plus any
// bonus facts fetched live this session (see fetchOnlineFacts) — never
// repeating an item shown in the last 5.
function pickNextPauseContent() {
  const pool = PAUSE_FACTS.concat(PAUSE_TIPS, STATE.onlineFacts);
  const recent = new Set(STATE.pauseFactHistory);
  let candidates = pool.filter(item => !recent.has(item));
  if (candidates.length === 0) candidates = pool; // pool smaller than the history window — reuse is unavoidable
  const pick = candidates[Math.floor(Math.random() * candidates.length)];
  STATE.pauseFactHistory.push(pick);
  if (STATE.pauseFactHistory.length > 5) STATE.pauseFactHistory.shift();
  return pick;
}

function showNextPauseFact() {
  const el = document.getElementById('pause-fact');
  el.classList.remove('visible');
  setTimeout(() => {
    if (!STATE.paused) return; // menu was closed during the fade-out
    el.textContent = pickNextPauseContent();
    el.classList.add('visible');
  }, 400); // let the fade-out finish before swapping text and fading back in
}

function startPauseFactRotation() {
  stopPauseFactRotation();
  showNextPauseFact(); // show one right away, don't wait 10s for the first
  STATE.pauseFactTimer = setInterval(showNextPauseFact, 10000);
  maybeFetchOnlineFacts();
}

function stopPauseFactRotation() {
  if (STATE.pauseFactTimer) {
    clearInterval(STATE.pauseFactTimer);
    STATE.pauseFactTimer = null;
  }
  document.getElementById('pause-fact').classList.remove('visible');
}

// A handful of on-topic Wikipedia article titles (music/sound/color/space)
// — the fetch is genuinely live, but which article it can land on stays
// deliberately curated so it can't surface anything off-topic or jarring.
const ONLINE_FACT_TOPICS = [
  'Frequency', 'Synesthesia', 'Chladni_figure', 'Doppler_effect', 'Resonance_(acoustics)',
  'Color_theory', 'Bioluminescence', 'Nebula', 'Exoplanet', 'Aurora',
  'Absolute_pitch', 'Rainbow', 'Tibetan_singing_bowl', 'Solar_wind', 'Bird_vocalization',
  'Afterimage_(optical_phenomenon)', 'Infrasound', 'Meteor_shower', 'Pigment', 'Harmonic',
];

// Only ever attempted when the browser itself reports it's online — and
// even then, any failure at all (still offline despite the flag, blocked,
// slow, malformed response) just quietly leaves STATE.onlineFacts empty,
// and the rotation runs on the predetermined list alone, which always works.
async function fetchOnlineFacts() {
  if (!navigator.onLine) return;
  try {
    const picks = shuffleArray([...ONLINE_FACT_TOPICS]).slice(0, 4);
    const results = await Promise.all(picks.map(topic => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3500);
      return fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${topic}`, { signal: controller.signal })
        .then(res => (res.ok ? res.json() : null))
        .catch(() => null)
        .finally(() => clearTimeout(timeout));
    }));
    const facts = results
      .filter(r => r && typeof r.extract === 'string' && r.extract.length >= 30 && r.extract.length <= 300)
      .map(r => r.extract);
    if (facts.length) STATE.onlineFacts = facts;
  } catch (e) { /* offline, blocked, CORS, whatever — the predetermined list already covers this */ }
}

function maybeFetchOnlineFacts() {
  if (STATE.onlineFacts.length > 0) return; // already fetched some this session
  fetchOnlineFacts();
}

function setupPauseMenuListeners() {
  document.getElementById('pause-button').addEventListener('click', togglePause);
  document.getElementById('pause-resume').addEventListener('click', resumeGame);
  document.getElementById('pause-save').addEventListener('click', handleSaveGame);
  document.getElementById('pause-load').addEventListener('click', handleLoadGame);
  document.getElementById('pause-restart-level').addEventListener('click', handleRestartCurrentLevel);
  document.getElementById('pause-restart-game').addEventListener('click', handleRestartGame);
  document.getElementById('pause-exit').addEventListener('click', handleExitGame);
}

// ============================================================
// SECTION 9: UI AND MESSAGES
// ============================================================
function showMessage(title, subtitle, opts) {
  document.getElementById('message-title').textContent = title;
  document.getElementById('message-subtitle').textContent = subtitle;
  document.getElementById('message-overlay').style.opacity = '1';
  // Only the title screen gets the "turn your sound on" reminder and the
  // difficulty picker — both would just be repeated noise on every WAVE
  // COMPLETE otherwise.
  const isTitleScreen = !!(opts && opts.isTitleScreen);
  document.getElementById('sound-hint').classList.toggle('visible', isTitleScreen);
  document.getElementById('difficulty-selector').classList.toggle('visible', isTitleScreen);
  if (isTitleScreen) refreshDifficultyButtons();
}

function hideMessage() {
  document.getElementById('message-overlay').style.opacity = '0';
  // The difficulty selector is the one element in here with real
  // pointer-events — without explicitly clearing it too, its buttons stay
  // clickable (invisibly, opacity alone doesn't disable pointer-events)
  // over whatever dots happen to render underneath once play starts.
  document.getElementById('difficulty-selector').classList.remove('visible');
}

function showTutorialHint(waveNumber) {
  const entry = TUTORIAL_MESSAGES[waveNumber - 1];
  if (!entry) { STATE.tutorialWave = null; STATE.tutorialDismissWhen = null; return; }
  STATE.tutorialWave = waveNumber;
  STATE.tutorialDismissWhen = entry.dismissWhen;
  layoutTutorialHint(entry.text);
  document.getElementById('tutorial-hint').style.opacity = '1';
}

// Splits `text` into progressively more lines (1, 2, 3, ...) until the
// centered text block's bounding box clears every dot on screen, or we run
// out of words to split further. Dots don't move once a wave starts, so
// this only needs to run when the hint first appears, not every frame.
function wrapIntoLines(words, lineCount) {
  if (lineCount <= 1) return [words.join(' ')];
  const totalLen = words.reduce((sum, w) => sum + w.length + 1, 0);
  const target = totalLen / lineCount;
  const lines = [];
  let cur = [], curLen = 0;
  for (const w of words) {
    if (curLen > 0 && curLen + w.length + 1 > target && lines.length < lineCount - 1) {
      lines.push(cur.join(' '));
      cur = [];
      curLen = 0;
    }
    cur.push(w);
    curLen += w.length + 1;
  }
  if (cur.length) lines.push(cur.join(' '));
  return lines;
}

function rectOverlapsAnyDot(rect) {
  const exclusion = CONFIG.DOT_RADIUS_CONNECTED_MAX + 14; // clear space beyond the dot's largest visible pulse radius
  for (const dot of STATE.dots) {
    const cx = Math.max(rect.left, Math.min(dot.x, rect.right));
    const cy = Math.max(rect.top, Math.min(dot.y, rect.bottom));
    if (Math.hypot(dot.x - cx, dot.y - cy) < exclusion) return true;
  }
  return false;
}

// A `position: fixed` element isn't clipped to the viewport just because
// its container div is narrower than the screen — nudging it sideways to
// dodge a dot (see tutorialPositionCandidates) can push part of it past
// the edge of the phone entirely, which is worse than the dot overlap it
// was trying to avoid. Any candidate layout must pass this too.
function rectOutOfBounds(rect) {
  const margin = 6;
  return rect.left < margin || rect.right > canvas.width - margin || rect.top < margin || rect.bottom > canvas.height - margin;
}

// Candidate positions relative to dead-center, nearest first: center itself,
// then rings of 8 compass points (N/S/E/W + diagonals) at increasing radius.
// Dots are scattered anywhere on screen (see findValidPosition), so a
// single dot can sit exactly at center with others boxing out the row
// above and below it — a purely vertical nudge can't always dodge that.
function tutorialPositionCandidates(maxRadius, step) {
  const candidates = [{ dx: 0, dy: 0 }];
  for (let r = step; r <= maxRadius; r += step) {
    candidates.push(
      { dx: 0, dy: -r }, { dx: 0, dy: r }, { dx: -r, dy: 0 }, { dx: r, dy: 0 },
      { dx: -r, dy: -r }, { dx: r, dy: -r }, { dx: -r, dy: r }, { dx: r, dy: r }
    );
  }
  return candidates;
}

function layoutTutorialHint(text) {
  const el = document.getElementById('tutorial-hint');
  const words = text.split(' ');
  const maxLines = words.length; // one word per line in the worst case — narrowest possible box
  const lineOptions = [];
  for (let lineCount = 1; lineCount <= maxLines; lineCount++) lineOptions.push(wrapIntoLines(words, lineCount));

  const maxRadius = Math.min(canvas.width, canvas.height) * 0.5;
  const positions = tutorialPositionCandidates(maxRadius, 25);

  // Prefer staying as close to centered as possible, and the font at full
  // size: at each candidate position (starting from dead-center), try
  // every line-break option (fewest lines first — i.e. "carriage return if
  // necessary") before moving further out. Only if every position/line
  // combination fails at full size — an extremely dot-crowded small
  // screen — do we shrink the font a little and search again, since a
  // smaller box is easier to fit around a busy layout.
  let fallback = null; // best layout that at least stays on-screen, even if it still grazes a dot
  for (const fontSize of [30, 24, 20, 17]) {
    el.style.fontSize = fontSize + 'px';
    for (const { dx, dy } of positions) {
      el.style.left = `calc(50% + ${dx}px)`;
      el.style.top = `calc(50% + ${dy}px)`;
      for (const lines of lineOptions) {
        el.innerHTML = lines.map(l => l.replace(/&/g, '&amp;').replace(/</g, '&lt;')).join('<br>');
        const rect = el.getBoundingClientRect();
        if (rectOutOfBounds(rect)) continue; // never render part of the hint off the edge of the phone
        if (!rectOverlapsAnyDot(rect)) return; // ideal: on-screen AND clear of every dot
        if (!fallback) fallback = { fontSize, dx, dy, lines };
      }
    }
  }
  // Exhausted every split, position, and font size without a fully clear
  // spot (pathologically cramped wave) — reapply the best on-screen
  // layout found; worst case it grazes a dot, but it's never cut off.
  if (fallback) {
    el.style.fontSize = fallback.fontSize + 'px';
    el.style.left = `calc(50% + ${fallback.dx}px)`;
    el.style.top = `calc(50% + ${fallback.dy}px)`;
    el.innerHTML = fallback.lines.map(l => l.replace(/&/g, '&amp;').replace(/</g, '&lt;')).join('<br>');
  }
}

// `instant`, when true, skips the normal 1.4s CSS fade — used anywhere the
// hint must be guaranteed gone by the very next frame (e.g. the moment a
// wave completes) rather than still visibly fading out over another
// overlay. Always forces the DOM opacity, even if state was already clear,
// so it also works as a defensive "make sure this is really hidden" call.
function hideTutorialHint(instant) {
  STATE.tutorialWave = null;
  STATE.tutorialDismissWhen = null;
  const el = document.getElementById('tutorial-hint');
  if (instant) {
    el.style.transition = 'none';
    el.style.opacity = '0';
    void el.offsetHeight; // flush the style change before restoring the transition
    el.style.transition = '';
  } else {
    el.style.opacity = '0';
  }
}

// Called after any dot-pair connection — clears the current tutorial hint
// if its dismiss condition is 'connect'. ('complete'-dismiss hints, and
// the wave-complete safety net, are handled by hideTutorialHint(true) in
// checkWaveComplete and enforceTutorialHintInvariant.) A no-op once all
// five tutorial waves are past (tutorialWave stays null).
function checkTutorialDismiss() {
  if (STATE.tutorialWave === null) return;
  if (STATE.tutorialDismissWhen === 'connect') hideTutorialHint();
}

// Hard guarantee, checked every frame: tutorial text may only be on screen
// while actually PLAYING. Any phase change that forgets to explicitly
// clear it (a future code path, an edge case) gets caught here instead of
// producing a repeat of "tutorial text visible during WAVE COMPLETE".
function enforceTutorialHintInvariant() {
  if (STATE.phase !== 'PLAYING' && STATE.tutorialWave !== null) {
    hideTutorialHint(true);
  }
}

function updateWaveDisplay() {
  document.getElementById('wave-display').textContent = 'wave ' + STATE.wave;
  document.getElementById('score-display').textContent = STATE.score > 0 ? STATE.score : '';
}

// ============================================================
// SECTION 10: GAME LOOP
// ============================================================
function update() {
  enforceTutorialHintInvariant();

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
  if (STATE.phase === 'WAVE_COMPLETE') { updateSpaceObjects(); updateCelestialBodies(); }
  updateBarriers();
  checkRotatingBarrierBreaks();
  updateBreakSparks();
  updateFade();
  maybeTopUpSongSchedule();
  updateDrawScoreDisplay();
}

// Live points for the line being drawn right now — the same formula
// completeConnection uses, so what's shown while dragging is exactly what
// lands in the total the instant the connection completes. Encourages
// drawing a longer, more deliberate path instead of a quick short stroke.
function updateDrawScoreDisplay() {
  const el = document.getElementById('draw-score-display');
  if (STATE.isDrawing && STATE.phase === 'PLAYING') {
    el.textContent = '+' + Math.round(pathLength(STATE.currentPath) * SCORE_PER_LINE_PIXEL);
  } else if (el.textContent !== '') {
    el.textContent = '';
  }
}

function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  drawStars();
  if (STATE.phase === 'WAVE_COMPLETE') { drawCelestialBodies(); drawSpaceObjects(); }
  drawBarriers();

  for (const line of STATE.lines) {
    drawFadingLine(line);
  }

  drawActiveLine();
  drawBreakSparks();

  for (const dot of STATE.dots) {
    drawDot(dot);
  }

  drawTravelingLights();

  drawFadeOverlay();
}

function gameLoop() {
  // If anything throws here, it must never take requestAnimationFrame's
  // next call down with it — a single bad frame would otherwise silently
  // kill the entire loop forever. That's especially costly for the pause
  // menu: opening it and Save Game are plain DOM/localStorage work that
  // don't need the loop at all, but Restart/Load/Exit all rely on
  // updateFade() (called from update()) to actually carry out their
  // transition — with a dead loop they'd visibly do nothing, while Save
  // would still appear to work fine, which is exactly the confusing
  // "only Save works" symptom a silently-dead loop produces.
  try {
    if (!STATE.paused) update(); // freeze every animation/state change while the pause menu is open
  } catch (e) {
    console.error('update() failed; game loop continuing anyway:', e);
  }
  try {
    render();
  } catch (e) {
    console.error('render() failed; game loop continuing anyway:', e);
  }
  requestAnimationFrame(gameLoop);
}

// Runs once per page load only (never mid-session, and never again after
// this same reload) — compares this page's build to whatever's actually
// live on the server right now, and if a newer one has shipped since this
// page was fetched (a stale service worker/HTTP cache, a tab left open
// across a deploy, etc.), does a single cache-busted reload so the player
// lands on the latest version without ever having to manually refresh.
// Any failure (offline, blocked fetch, no version.json yet) just leaves
// the current version running — this is a nice-to-have, never a blocker.
async function checkForNewVersionAndReload() {
  try {
    const scriptEl = document.querySelector('script[src*="game.js"]');
    const currentBuild = scriptEl ? new URL(scriptEl.src, location.href).searchParams.get('v') : null;
    if (!currentBuild) return;

    const res = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) return;
    const data = await res.json();
    if (!data.build || data.build === currentBuild) return;

    // Guard against a reload loop: only ever attempt one reload per
    // target build, in case version.json is ever transiently wrong right
    // after a reload (e.g. a CDN edge still serving the old file).
    const guardKey = 'lumina_reload_attempted_for';
    if (sessionStorage.getItem(guardKey) === data.build) return;
    sessionStorage.setItem(guardKey, data.build);

    location.replace(location.pathname + '?_r=' + Date.now());
  } catch (e) {
    // No network, fetch blocked, etc. — keep playing on the current version.
  }
}

// ============================================================
// SECTION 11: INITIALIZATION
// ============================================================
function init() {
  checkForNewVersionAndReload();
  resizeCanvas();
  preloadSampleBytes(); // start fetching instrument samples now, overlapping the "tap to begin" wait
  setupPauseMenuListeners();

  STATE.phase = 'TITLE';
  STATE.pendingResume = loadSave();
  STATE.difficulty = loadDifficulty();
  applyDifficulty(STATE.difficulty);
  setupDifficultySelectorListeners();
  showMessage(
    'LUMINA',
    STATE.pendingResume ? `tap or click to resume — wave ${STATE.pendingResume.wave}` : 'connect the dots. make the music.',
    { isTitleScreen: true }
  );
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

// Used only when 200 random attempts couldn't find a clear spot — which a
// crowded high-wave board (many 3+ dot groups) hits routinely, not as a
// rare edge case. The old version divided row position by a hardcoded 3,
// so any dot past index ~8 landed further down than the grid it assumed —
// eventually off the bottom of the canvas entirely: invisible and
// untappable, which is exactly what a dot with no reachable pair looks
// like to a player. Tiling a fixed-size grid and wrapping (with a small
// jitter on each wrap so repeats don't stack exactly on top of each
// other) guarantees every fallback position stays on screen no matter how
// many dots need one.
function fallbackGridPosition(index) {
  const cols = 5, rows = 5;
  const slot = index % (cols * rows);
  const wrap = Math.floor(index / (cols * rows));
  const col = slot % cols;
  const row = Math.floor(slot / cols);
  const usableW = canvas.width - CONFIG.EDGE_MARGIN * 2;
  const usableH = canvas.height - CONFIG.EDGE_MARGIN * 2;
  const jitter = wrap * 13;
  return {
    x: CONFIG.EDGE_MARGIN + ((col * usableW / (cols - 1)) + jitter) % usableW,
    y: CONFIG.EDGE_MARGIN + ((row * usableH / (rows - 1)) + jitter) % usableH,
  };
}

window.addEventListener('load', init);

window.__lumina = {
  getState: () => STATE,
  getDots: () => STATE.dots.map(d => ({ id: d.id, x: d.x, y: d.y, colorIndex: d.colorIndex, pairId: d.pairId, connected: d.connected })),
};
