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
  // The single width used everywhere a connection line is drawn -- while
  // actively being drawn, while fading after a connection, and once
  // settled. Used to differ across those three states (thinner while
  // drawing, then a step change to a multiplier of this once settled),
  // which read as an actual bug: a line visibly jumping to a different
  // thickness right after being drawn. Now every state renders at exactly
  // this width, with no jump -- set to match the thinner "while drawing"
  // width that existed before the unification, per player preference,
  // rather than the thicker settled width.
  LINE_WIDTH: 4,
  LINE_GLOW_BLUR: 18,
  // The hand-drawn line was fading all the way to invisible, and nothing
  // replaces it: drawTravelingLights (the intended ongoing indicator)
  // only runs once the *entire wave* is complete (STATE.beatSync is only
  // set in checkWaveComplete), so a connection made mid-wave had zero
  // visual trace once its line finished fading — it looked exactly like
  // it had never happened, or had silently broken, for the rest of the
  // wave. Floors the fade instead of letting it reach zero, so a faint
  // permanent thread always marks a still-live connection.
  // Raised from 0.15 to 0.4, then to 1 (fully opaque -- alpha's own
  // ceiling, since a literal 10x of 0.4 is 4, past what's possible) after
  // continued player feedback that the settled line was still too dim to
  // see once faded. A fully-opaque floor also means the fade-in animation
  // itself no longer visibly dims at all (see the fade loop in update()) --
  // the settled state is now just as bright as the moment it was drawn.
  LINE_FADE_FLOOR: 1,
  // Wall-clock time (not frames-per-point) for a line to fully settle at
  // the floor, independent of how many points it has. A per-point
  // sequential cascade (each point only starting once its predecessor
  // fully finished) was the original design, but that makes total settle
  // time scale with point count — a long, deliberately winding connection
  // (which scoring explicitly rewards) could carry hundreds of points and
  // take many minutes to ever reach "settled," during which it kept
  // paying full per-segment render cost the whole time (see
  // drawSettledPath's comment). This bounds every line to the same fixed
  // duration regardless of length, still sweeping start-to-end (see the
  // fade loop in update()), just staggered within that fixed window
  // instead of chained one point at a time.
  LINE_FADE_DURATION_MS: 3500,
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
  { text: 'Pinch or scroll to zoom, drag to pan.', dismissWhen: 'connect' },
  // Flagged rather than positioned by a hardcoded wave number: this is the
  // wave the board first grows wider than the screen (see
  // WIDE_WORLD_START_WAVE below), so the explanation has to land on
  // whichever wave this entry ends up on, even if messages are added or
  // reordered above it later.
  { text: 'This board is bigger than your screen — drag to pan, pinch or scroll to zoom, and find every dot.', dismissWhen: 'connect', unlocksWideWorld: true },
  { text: 'Connect the dots, make music. Relax and Enjoy!', dismissWhen: 'connect' },
];

// The wave the playfield first grows wider than the viewport (and stays
// that way every wave after) -- derived from TUTORIAL_MESSAGES' own
// unlocksWideWorld-flagged entry rather than a separate hardcoded wave
// number, so editing the tutorial sequence can never silently desync the
// two. See computeWorldSize's wide-world floor and startWave's camera
// intro below.
const WIDE_WORLD_START_WAVE = TUTORIAL_MESSAGES.findIndex(m => m.unlocksWideWorld) + 1;

// Extra clearance kept around the tutorial hint's text box, on top of a
// dot's or barrier's own exclusion radius (see dotOverlapCount /
// barrierOverlapCount below) -- so a dot never sits close enough to
// visually crowd the text, not just technically avoids overlapping it.
const TUTORIAL_HINT_BUFFER = 20;

// A generous, fixed screen-space box reserved dead-center of the screen
// on any wave that's about to show a tutorial hint (see
// reservedHintWorldRect) -- sized to comfortably fit the longest current
// message at up to 3 lines, regardless of which message this particular
// wave actually shows. Dots are placed to avoid this zone in the first
// place (see findValidPosition), so layoutTutorialHint's own search
// afterward is normally just confirming a spot that's already clear
// rather than hunting for one on a crowded board.
const TUTORIAL_HINT_RESERVE = { WIDTH_FRACTION: 0.85, MAX_WIDTH: 360, HEIGHT: 150 };

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

// Whether tapping the title screen should silently resume a save (the
// original, only behavior) or always start fresh at wave 1, leaving an
// existing save to be picked up explicitly via the Load Game button.
// Off by default -- an unconfigured player's next tap has always started
// wave 1, and that stays true even once they've saved a game once.
const AUTOLOAD_KEY = 'lumina_autoload_v1';
function loadAutoLoadSetting() {
  try { return localStorage.getItem(AUTOLOAD_KEY) === 'true'; } catch (e) { return false; }
}
function saveAutoLoadSetting(enabled) {
  try { localStorage.setItem(AUTOLOAD_KEY, enabled ? 'true' : 'false'); } catch (e) { /* best-effort only */ }
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
      label: 'New Highest Wave',
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

  // The card is opaque and always dead-center now (see style.css), so it
  // no longer needs the dot-avoidance reflow the old translucent toast
  // used — just set the text and let it wrap naturally inside the card.
  document.getElementById('achievement-label').textContent = entry.label;
  toast.classList.add('visible');
  playAchievementJingle();

  setTimeout(() => {
    toast.classList.remove('visible');
    STATE.achievementToastActive = false;
    setTimeout(maybeShowNextAchievement, 500); // let the retract finish before the next one drops in
  }, ACHIEVEMENT_VISIBLE_MS);
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

// Genre FAMILIES bundle everything that should stay consistent across an
// entire style (which chord types it uses, its rhythmic feel) — SEEDS
// within a family vary tempo/key/chord-progression-order/instrument-role
// assignment, same as a single "genre" always has. generateSong() picks a
// family, then a seed within it, then merges the two into one flat
// `genre` object so every existing call site (song.genre.bpm, etc.) keeps
// working unchanged regardless of how many families exist.
//
// 'spa' is the only family right now — tuned to sound like something
// you'd hear during a spa treatment or massage: slow tempo, a plain major
// scale, chord progressions restricted to I/IV/V/vi (every triad
// consonant, no diminished/tense chords). Each seed is a different
// combination of real instrument voices in different registers/roles so
// replaying gives a different-sounding but equally calm arrangement — the
// same curated palette, recombined. See sounds/CREDITS.md for instrument
// sourcing (University of Iowa Musical Instrument Samples, free for any
// use).
const GENRE_FAMILIES = [
  {
    name: 'spa',
    chordVocabulary: 'triad', // see CHORD_VOCABULARIES
    groove: { swing: 0, hasDrumRole: false },
    seeds: [
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
    ],
  },
  // First proof case for a genuinely different-sounding family (see
  // GENRE_FAMILIES history): 7th chords instead of plain triads, a
  // laid-back swung groove, and its own synthesized palette (electric
  // piano + bass + a drum kit — see SYNTHESIZED_INSTRUMENTS) instead of
  // the spa family's recorded acoustic instruments. Still built on the
  // exact same generation engine (scale-degree melody/arpeggio logic,
  // collision avoidance, loudness normalization) as spa.
  {
    name: 'lofi',
    chordVocabulary: 'seventh',
    groove: { swing: 0.22, hasDrumRole: true },
    seeds: [
      {
        name: 'rainy window', bpm: 76, rootMidi: 57,
        scaleIntervals: [0, 2, 4, 5, 7, 9, 11],
        chordProgression: [0, 5, 3, 4],
        roles: [
          { kind: 'melody',   instrument: 'rhodes' },
          { kind: 'arpeggio', instrument: 'rhodes' },
          { kind: 'pad',      instrument: 'rhodes' },
          { kind: 'drone',    instrument: 'lofibass' },
          { kind: 'drum',     instrument: 'lofikit' },
          { kind: 'accent',   instrument: 'rhodes' },
        ],
      },
      {
        name: 'corner cafe', bpm: 82, rootMidi: 60,
        scaleIntervals: [0, 2, 4, 5, 7, 9, 11],
        chordProgression: [0, 3, 4, 0],
        roles: [
          { kind: 'melody',   instrument: 'rhodes' },
          { kind: 'arpeggio', instrument: 'rhodes' },
          { kind: 'pad',      instrument: 'rhodes' },
          { kind: 'drone',    instrument: 'lofibass' },
          { kind: 'drum',     instrument: 'lofikit' },
          { kind: 'accent',   instrument: 'rhodes' },
        ],
      },
      {
        name: 'late study', bpm: 72, rootMidi: 62,
        scaleIntervals: [0, 2, 4, 5, 7, 9, 11],
        chordProgression: [0, 4, 5, 3],
        roles: [
          { kind: 'melody',   instrument: 'rhodes' },
          { kind: 'arpeggio', instrument: 'rhodes' },
          { kind: 'pad',      instrument: 'rhodes' },
          { kind: 'drone',    instrument: 'lofibass' },
          { kind: 'drum',     instrument: 'lofikit' },
          { kind: 'accent',   instrument: 'rhodes' },
        ],
      },
    ],
  },
];

// Chord-tone degree offsets from the chord root, keyed by family-level
// chordVocabulary. 'triad' is today's plain root/3rd/5th (every chord in
// every spa progression is I/IV/V/vi, always consonant). 'seventh' isn't
// used by any family yet — added here so the generation loop below never
// needs to change again when one does.
const CHORD_VOCABULARIES = {
  triad: (root) => [root, root + 2, root + 4],
  seventh: (root) => [root, root + 2, root + 4, root + 6],
};

// Note: trumpet and double bass sample files remain in sounds/ from an
// earlier, more upbeat set of genres but are omitted here (and so never
// fetched/decoded) since no active genre references them any more.
const SAMPLE_MANIFEST = {
  piano: ['A3', 'C4', 'E4', 'Ab4', 'C5', 'E5', 'Ab5', 'C6'],
  flute: ['B3', 'C4', 'Db4', 'D4', 'Eb4', 'E4', 'F4', 'Gb4', 'G4', 'Ab4', 'A4', 'Bb4', 'B4', 'C5', 'Db5', 'D5', 'Eb5', 'E5', 'F5', 'Gb5', 'G5', 'Ab5', 'A5', 'Bb5', 'C6', 'Db6', 'D6', 'Eb6', 'E6', 'F6', 'Gb6', 'G6', 'Ab6', 'A6', 'Bb6'],
  cello: ['D3', 'Eb3', 'E3', 'F3', 'Gb3', 'G3', 'Ab3', 'A3', 'Bb3', 'B3', 'C4', 'Db4', 'D4', 'Eb4', 'E4', 'F4', 'Gb4', 'G4', 'Ab4', 'A4', 'Bb4'],
  marimba: ['C3', 'Db3', 'D3', 'Eb3', 'E3', 'F3', 'Gb3', 'G3', 'Ab3', 'A3', 'Bb3', 'B3', 'C4', 'Db4', 'D4', 'Eb4', 'E4', 'F4', 'Gb4', 'G4', 'Ab4', 'A4', 'Bb4', 'B4', 'C5', 'Db5', 'D5', 'Eb5', 'E5', 'F5', 'Gb5', 'G5', 'Ab5', 'A5', 'Bb5', 'B5', 'C6'],
  vibraphone: ['C3', 'Db3', 'D3', 'Eb3', 'E3', 'F3', 'Gb3', 'G3', 'Ab3', 'A3', 'Bb3', 'B3', 'C4', 'Db4', 'D4', 'E4', 'F4', 'Gb4', 'G4', 'Ab4', 'A4', 'Bb4', 'B4', 'C5', 'Db5', 'D5', 'Eb5', 'E5', 'F5', 'Gb5', 'G5', 'Ab5', 'A5', 'Bb5', 'B5', 'C6'],
  // Synthesized, not recorded — see SYNTHESIZED_INSTRUMENTS below. No
  // sourcing/licensing dependency: these are generated in-browser at
  // decode time from oscillators/noise, not fetched from sounds/.
  rhodes: ['C3', 'Eb3', 'G3', 'C4', 'Eb4', 'G4', 'C5', 'Eb5', 'G5'],
  lofibass: ['C1', 'Eb1', 'G1', 'C2', 'Eb2', 'G2'],
  lofikit: ['kick', 'snare', 'hihat'], // one-shots, not pitched notes — see the 'drum' role kind
};

// Instruments with no recorded sample files at all — their "sample
// buffers" are synthesized at decode time (see synthesizeInstrumentSample)
// via a short OfflineAudioContext render instead of fetched and decoded.
// Slots into STATE.sampleBuffers exactly like a real decoded sample, so
// every downstream consumer (nearestSampleNote, playbackRate pitch-shift,
// gain compensation) works identically either way without needing to
// know the difference.
const SYNTHESIZED_INSTRUMENTS = new Set(['rhodes', 'lofibass', 'lofikit']);

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
  RADIUS: 5,            // radius of the fat leading head
  TAIL_LENGTH: 26,      // how far the tapered tail drags behind the head — long enough to read as clinging, wet wax, not a comet's spark
  // Constant physical speed for every connection's drip, regardless of the
  // line's own length — a long line's drip just takes proportionally
  // longer to cross it, rather than visibly outrunning a short line's.
  SPEED_PX_PER_BEAT: 50,
  MIN_BEATS_PER_TRAVERSAL: 0.8, // keeps a very short line from cycling absurdly fast
  // A new drip is born this often (in beats), same interval on every
  // connection — wider than before specifically to leave the longer tail
  // above room to stretch out without the next drip behind it crowding in.
  SPAWN_INTERVAL_BEATS: 0.7,
};

// Dots are placed in "world" space, which starts equal to the screen but
// grows for a wave whenever its dot count needs more room than the screen
// can offer at CONFIG.MIN_DOT_DISTANCE spacing (see computeWorldSize) — on
// intense difficulty especially, a crowded wave used to force dots closer
// together than a fingertip could disambiguate, occasionally overlapping
// two connectable dots into an untappable mess. Growing the world instead
// of shrinking the spacing keeps every dot's tap target fully clear; the
// camera then zooms out just enough to fit that (possibly larger) world
// back into the screen. The player can additionally pull further out, or
// push in past that guaranteed-fit view for precision on close-together
// dots, via scroll wheel or a two-finger pinch — zooming in shrinks the
// visible viewport below the world's size, so panning (drag on empty
// board space once zoomed in — see STATE.camera.centerX/Y) is how the
// rest of the board stays reachable.
const CAMERA_CONFIG = {
  // Ideal circle-packing density inflated for headroom: random placement
  // (not a perfect hex pack) needs real slack beyond the geometric minimum
  // to actually find a valid spot within findValidPosition's attempt budget.
  PACKING_AREA_FACTOR: 1.6,
  MAX_WORLD_GROWTH: 2.2,     // world's linear size never exceeds this many x the screen's
  ZOOM_LERP: 0.08,           // per-frame smoothing toward the target camera scale
  MIN_USER_PULLBACK: 0.65,   // manual zoom-out floor, relative to the auto-fit scale
  MAX_USER_ZOOM_IN: 3,       // manual zoom-in ceiling, relative to the auto-fit scale
  WHEEL_ZOOM_STEP: 0.0015,   // userZoom change per wheel-delta unit
  // Separate from MAX_WORLD_GROWTH (that one's about dot-packing density,
  // not aspect ratio) -- a typical phone's portrait/landscape swap is
  // already close to 2.2:1 on its own, so reusing that cap here left
  // growWorldToMatchAspect barely able to compensate at all. This one's
  // purely a backstop against a pathologically-shaped viewport, not a
  // normal-use limit.
  MAX_ORIENTATION_GROWTH: 5,
  // How long a wide wave (see WIDE_WORLD_START_WAVE) holds at the
  // full-world fit-scale before easing in to the comfortable play zoom --
  // long enough to register as a deliberate "look, there's more board
  // than this" beat rather than a flicker, short enough not to make the
  // player wait to start playing.
  WIDE_INTRO_HOLD_MS: 900,
};

// Sizes the world for a wave with `dotCount` dots: big enough that random
// placement can comfortably keep every dot CONFIG.MIN_DOT_DISTANCE apart,
// never smaller than the screen itself (so low dot counts never appear
// artificially zoomed in), and capped so a pathological dot count can't
// balloon the world (and therefore zoom out) without bound.
function computeWorldSize(dotCount) {
  const screenW = canvas.width, screenH = canvas.height;
  const usableW = Math.max(1, screenW - CONFIG.EDGE_MARGIN * 2);
  const usableH = Math.max(1, screenH - CONFIG.EDGE_MARGIN * 2);
  const areaPerDot = Math.PI * (CONFIG.MIN_DOT_DISTANCE / 2) ** 2 * CAMERA_CONFIG.PACKING_AREA_FACTOR;
  const requiredArea = dotCount * areaPerDot;
  const growth = Math.min(CAMERA_CONFIG.MAX_WORLD_GROWTH, Math.sqrt(Math.max(1, requiredArea / (usableW * usableH))));
  return { w: screenW * growth, h: screenH * growth };
}

// From WIDE_WORLD_START_WAVE on (see TUTORIAL_MESSAGES' unlocksWideWorld
// flag), the board must need real panning to see in full even when dot
// count alone wouldn't otherwise call for a bigger world -- so this floors
// computeWorldSize's result at a flat multiple of the screen's own
// dimension. Deliberately flat, not scaled by wave number: computeWorldSize's
// own dot-density growth already ramps with wave count, so this is a floor
// underneath that ramp, not a second one competing with it, and it stays
// comfortably under CAMERA_CONFIG.MAX_WORLD_GROWTH (2.2) so the two never
// fight over the same wave.
const WIDE_WORLD_CONFIG = {
  MIN_WIDTH_FACTOR: 1.6,
};

function applyWideWorldFloor(size) {
  return {
    w: Math.max(size.w, canvas.width * WIDE_WORLD_CONFIG.MIN_WIDTH_FACTOR),
    h: Math.max(size.h, canvas.height * WIDE_WORLD_CONFIG.MIN_WIDTH_FACTOR),
  };
}

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

// Maze barriers: a wall with multiple corner turns and a few small gaps,
// requiring an actual routing decision instead of a single detour around
// one straight segment. Introduced at wave 40 as its own separate, additive
// budget on top of the regular static/rotating barriers above — always
// one per wave once unlocked, never rotating (a moving multi-corner wall
// would be nearly unreadable), starting at its simplest possible shape (one
// corner, one gap) and growing a leg/gap every so many waves after that.
const MAZE_CONFIG = {
  START_WAVE: 40,
  WAVES_PER_LEG: 10,   // one more corner every N waves after START_WAVE
  MAX_LEGS: 5,
  WAVES_PER_GAP: 10,   // one more gap every N waves after START_WAVE
  MAX_GAPS: 4,
  GAP_WIDTH: 70,        // px a connection can actually pass through
  // A fraction of the world's smaller dimension, not a fixed px range —
  // a fixed 220-420px leg was tuned against a desktop-sized world and
  // reliably failed to fit (blowing past SCREEN_CLEARANCE, retried out
  // at generateMazeBarrier's attempt cap) on a phone-sized viewport's
  // much narrower world, where a maze barrier could end up never
  // spawning at all. Clamped to an absolute range so it's never
  // absurdly short on a tiny world or absurdly long on a huge one.
  LEG_LENGTH_MIN_FRACTION: 0.16,
  LEG_LENGTH_MAX_FRACTION: 0.30,
  LEG_LENGTH_ABS_MIN: 90,
  LEG_LENGTH_ABS_MAX: 420,
  CORNER_ANGLE_MIN: Math.PI * 0.3,  // ~54 degrees
  CORNER_ANGLE_MAX: Math.PI * 0.6,  // ~108 degrees
  PAIR_LINE_MIN_T: 0.28,
  PAIR_LINE_MAX_T: 0.72,
  ANGLE_JITTER: Math.PI / 7.2,
  DOT_CLEARANCE: 60,
  SCREEN_CLEARANCE: 10,
};

// A rare cosmetic-but-real obstacle: a small square barrier with one of the
// curated pause-menu fun facts (see PAUSE_FACTS) printed inside it, so
// there's a chance of stumbling on one mid-play instead of only at pause.
// It's a genuine barrier — solid, lines can't cross it, same as any other —
// not just a decoration; independent of wave number and the regular/maze
// barrier budgets, showing up on about 1 in 5 waves.
const FACT_BOX_CONFIG = {
  PROBABILITY: 0.2,
  // A box needs a whole dot-free 2D area, not just clearance along a line
  // the way a barrier does — a fixed 130px box with 70px of clearance
  // rarely found room on a small/crowded mobile-sized world (same class of
  // problem as the maze legs above, worse: attempts here scaled the
  // dimension, not the clearance too). Both now scale with the world's
  // smaller dimension, clamped to a sane absolute range.
  //
  // The floor/fraction were raised again after real play on a phone
  // showed most facts truncating even with fitFactText's shrink-to-fit —
  // a phone-portrait world's own smaller dimension left the box pinned
  // at the old 80px floor almost every time, too little room for a whole
  // sentence at any legible font size. A bigger box places less often on
  // a crowded board (see generateFactBoxBarrier's own attempt loop), but
  // that only ever means skipping the box for that wave, never a
  // half-readable one, so the trade is worth it.
  SIZE_FRACTION: 0.3,
  SIZE_ABS_MIN: 150,
  SIZE_ABS_MAX: 220,
  // Eased down from before (0.09/45/70) now that the box itself is
  // bigger — the box's own size is what has to earn its keep on
  // legibility, not the clearance around it, and a smaller clearance
  // buys back some of the placement-success rate a bigger box costs.
  DOT_CLEARANCE_FRACTION: 0.05,
  DOT_CLEARANCE_ABS_MIN: 24,
  DOT_CLEARANCE_ABS_MAX: 50,
  SCREEN_CLEARANCE: 12,
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

// "Load Game" only appears once there's actually a save to load; the
// checkbox is a standing preference and stays visible either way.
function refreshTitleLoadRow() {
  document.getElementById('title-load-button').classList.toggle('visible', !!STATE.pendingResume);
  document.getElementById('autoload-checkbox').checked = STATE.autoLoadEnabled;
}

// The title screen's own equivalent of the pause menu's Load Game: no
// active wave to fade from, so this just jumps straight there, the same
// way the original silent-resume tap always did.
function handleLoadGameFromTitle() {
  if (!STATE.pendingResume) return;
  initAudio();
  hideMessage();
  const resume = STATE.pendingResume;
  STATE.pendingResume = null;
  STATE.score = resume.score;
  startWave(resume.wave);
}

function setupTitleLoadListeners() {
  document.getElementById('title-load-button').addEventListener('click', handleLoadGameFromTitle);
  document.getElementById('autoload-checkbox').addEventListener('change', (e) => {
    STATE.autoLoadEnabled = e.target.checked;
    saveAutoLoadSetting(STATE.autoLoadEnabled);
    // Otherwise toggling the checkbox leaves whatever subtitle was set at
    // page load/exitToTitle in place, silently promising the opposite of
    // what a plain tap is now actually about to do.
    document.getElementById('message-subtitle').textContent = titleSubtitleText();
  });
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

  world: { w: 0, h: 0 },  // world-space board size for the current wave (see computeWorldSize) —
                           // >= the screen size; grows for crowded waves so dots keep their clearance
  camera: {
    autoScale: 1,          // scale that fits the whole world into the current screen
    scale: 1,               // actual rendered scale, lerped toward targetScale each frame
    targetScale: 1,          // autoScale * baseZoom * userZoom
    userZoom: 1,              // manual pull-back, 1 = the guaranteed-fit view, down to MIN_USER_PULLBACK
                               // or in past it up to MAX_USER_ZOOM_IN
    baseZoom: 1,              // the resting zoom a wide wave eases in to after its intro (see
                               // WIDE_WORLD_START_WAVE/startWave) as a multiple of autoScale;
                               // always 1 on a non-wide wave, meaning no behavior change
    wideIntroHoldUntil: 0,    // performance.now() timestamp a wide wave's zoom-out hold releases at
    centerX: 0, centerY: 0,   // world-space point the camera looks at — always the world's own
                               // center whenever the viewport is at least as big as the world
                               // (i.e. baseZoom * userZoom <= 1, the whole game before panning
                               // existed), only free to move once zoomed in past that (see
                               // clampCameraCenter)
  },
  pinch: null,          // { startDist, startZoom } while a two-finger touch is in progress
  panDrag: null,        // { startScreenX, startScreenY, startCenterX, startCenterY } while panning
  lastDrawScreenPos: null, // { x, y } screen-space, last known position of an in-progress draw gesture -- see updateEdgePan
  hintPulse: null,      // { startTime } while the hint button's "flash every unconnected dot" is playing

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
  connectionPraise: [],  // active { el, worldX, worldY, flip, spawnedAt, closing } popups -- see spawnConnectionPraise/updateConnectionPraise

  paused: false,           // freezes update()/input while the pause menu is open (see pauseGame/resumeGame)
  pauseFactHistory: [],    // last few pause-menu fact/tip strings shown, so the rotation never repeats too soon
  pauseFactTimer: null,    // setInterval id for the 13s rotation, running only while paused
  onlineFacts: [],         // bonus facts fetched live this session (see fetchOnlineFacts) — empty if offline/failed
  pendingResume: null,     // { wave, score } loaded from a save, offered on the title screen (see init/onInputStart)
  autoLoadEnabled: false,  // persisted (see AUTOLOAD_KEY) -- whether a plain tap on the title screen should
                           // silently resume pendingResume instead of always starting wave 1
};

// ============================================================
// SECTION 3: MUSIC ENGINE (procedural song generation & playback)
// ============================================================
function initAudio() {
  if (!STATE.audioCtx) {
    // Wrapped in try/catch: if anything in graph setup ever throws (an
    // unexpected browser quirk, a missing Web Audio API), the
    // `if (!STATE.audioCtx)` guard above would otherwise see it as
    // already-initialized forever after and never retry — permanent
    // silence with nothing visible to the player. Resetting audioCtx back
    // to null on failure means the next tap gets a clean second attempt.
    try {
      initAudioGraph();
    } catch (e) {
      console.error('initAudio failed; will retry on next input:', e);
      STATE.audioCtx = null;
      return;
    }
  }

  // iOS Safari (especially standalone/home-screen PWAs) frequently leaves the
  // context suspended even when created inside a user gesture, and can fail
  // to fully engage the hardware audio session until a buffer is actually
  // played. Resume + play a silent buffer synchronously on every gesture as
  // a robust unlock — cheap and idempotent if already unlocked.
  if (STATE.audioCtx.state === 'suspended') {
    const resumingCtx = STATE.audioCtx;
    STATE.audioCtx.resume().then(() => {
      // A phone call, Siri, another app grabbing the audio session, or the
      // screen locking can leave an iOS Safari AudioContext permanently
      // unable to resume no matter how many times resume() is called on
      // it again — every future gesture in this same session just keeps
      // retrying the same wedged instance. If it's still not running once
      // this resume() actually settles, discard it so the *next* gesture
      // builds a completely fresh AudioContext (and redecodes into it)
      // instead of retrying forever — self-healing without requiring the
      // player to know a full page reload is what actually fixes it.
      if (STATE.audioCtx === resumingCtx && STATE.audioCtx.state !== 'running') {
        STATE.audioCtx = null;
      }
    }).catch(() => {
      if (STATE.audioCtx === resumingCtx) STATE.audioCtx = null;
    });
  }
  const unlockBuffer = STATE.audioCtx.createBuffer(1, 1, 22050);
  const unlockSource = STATE.audioCtx.createBufferSource();
  unlockSource.buffer = unlockBuffer;
  unlockSource.connect(STATE.audioCtx.destination);
  unlockSource.start(0);
}

// One-time master bus + decode kickoff, split out of initAudio so it can
// be wrapped in a single try/catch there.
function initAudioGraph() {
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

// --- Sample loading -----------------------------------------------------
// Raw bytes are fetched as soon as the page loads (no AudioContext needed
// for a plain fetch), overlapping with the "tap to begin" dwell time.
// Decoding happens once the AudioContext exists (first user gesture).
//
// MP3, not Ogg Vorbis: WebKit (Safari, and every iOS browser — Apple
// requires them all to use WebKit's engine, Chrome included) has never
// supported decoding Ogg Vorbis via decodeAudioData. The samples used to
// ship as .ogg, which decoded fine in this project's own Chromium-based
// testing but silently failed every single sample on iOS — the game was
// otherwise fully playable (nothing else touches audio) with total
// silence and no visible error, since decode failures here are caught
// and skipped per-note by design. MP3 decodes natively everywhere.
// Every real (non-synthesized) note's actual fetch Promise, keyed the same
// way as SAMPLE_MANIFEST — not the eventual bytes. decodeAllSamples used to
// poll a shared `sampleRawBytes` object on a 100ms timer, giving up on any
// note whose fetch hadn't landed within a fixed 2-second budget (20
// attempts). With ~140 real samples fetched in parallel, that budget was
// only ever a guess at how long a real network would take — comfortably
// enough on fast wifi, but on a slower or congested mobile connection,
// some or all of those fetches could still be in flight past 2 seconds,
// and every one of them still checked at that point was silently skipped
// (by design, so one bad sample can't break the rest) — which reads to a
// player as intermittent, network-dependent total or partial silence:
// exactly the "reload sometimes brings sound back, sometimes doesn't"
// symptom this was reported as. Awaiting each note's real fetch promise
// directly removes the guess entirely: decoding simply takes as long as
// the network actually takes, however long that is, with no arbitrary
// cutoff.
let samplePromises = {};

function preloadSampleBytes() {
  for (const instrument in SAMPLE_MANIFEST) {
    if (SYNTHESIZED_INSTRUMENTS.has(instrument)) continue; // nothing to fetch — generated at decode time
    samplePromises[instrument] = {};
    SAMPLE_MANIFEST[instrument].forEach(note => {
      samplePromises[instrument][note] = fetch(`sounds/${instrument}/${instrument}_${note}.mp3`)
        .then(r => r.arrayBuffer())
        .catch(() => null); // sample missing/failed — playSample falls back gracefully
    });
  }
}

// Every note (synthesized or fetched) decodes/synthesizes independently
// and in parallel, rather than one at a time in sequence — the previous
// sequential loop meant a slow note early in the list (e.g. piano, first
// in SAMPLE_MANIFEST) delayed every instrument after it even once its own
// fetch had actually landed, compounding the same real-world network
// variance the polling loop above was already vulnerable to.
async function decodeAllSamples() {
  const jobs = [];
  for (const instrument in SAMPLE_MANIFEST) {
    STATE.sampleBuffers[instrument] = {};

    if (SYNTHESIZED_INSTRUMENTS.has(instrument)) {
      for (const key of SAMPLE_MANIFEST[instrument]) {
        jobs.push((async () => {
          try {
            STATE.sampleBuffers[instrument][key] = await synthesizeInstrumentSample(instrument, key);
          } catch (e) { /* skip — playSample/playDrumHit fall back gracefully */ }
        })());
      }
      continue;
    }

    for (const note of SAMPLE_MANIFEST[instrument]) {
      jobs.push((async () => {
        const raw = await samplePromises[instrument][note];
        if (!raw) return;
        try {
          STATE.sampleBuffers[instrument][note] = await STATE.audioCtx.decodeAudioData(raw.slice(0));
        } catch (e) { /* skip — playSample falls back gracefully */ }
      })());
    }
  }
  await Promise.all(jobs);
}

// --- Synthesized instruments ---------------------------------------------
// No recorded sample files, no sourcing/licensing question — rendered
// in-browser from oscillators/noise via a short OfflineAudioContext,
// cached into STATE.sampleBuffers exactly like a decoded recording so
// nothing downstream (nearestSampleNote, playbackRate pitch-shift, gain
// compensation) needs to know these aren't real recordings.
function synthesizeInstrumentSample(instrument, key) {
  if (instrument === 'rhodes') return synthesizeRhodesNote(key);
  if (instrument === 'lofibass') return synthesizeBassNote(key);
  if (instrument === 'lofikit') return synthesizeDrumHit(key);
  return Promise.resolve(null);
}

function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// A simple electric-piano ("Rhodes") patch: a sustained sine fundamental
// plus a fast-decaying, slightly-detuned upper partial for the
// characteristic bell-like attack transient real tine pianos have.
async function synthesizeRhodesNote(noteName) {
  const freq = midiToFreq(noteNameToMidi(noteName));
  const duration = 2.2;
  const sr = 44100;
  const ctx = new OfflineAudioContext(1, Math.ceil(duration * sr), sr);

  const fundamental = ctx.createOscillator();
  fundamental.type = 'sine';
  fundamental.frequency.value = freq;
  const fundamentalGain = ctx.createGain();
  fundamentalGain.gain.setValueAtTime(0, 0);
  fundamentalGain.gain.linearRampToValueAtTime(0.8, 0.006);
  fundamentalGain.gain.exponentialRampToValueAtTime(0.22, 0.35);
  fundamentalGain.gain.exponentialRampToValueAtTime(0.001, duration);
  fundamental.connect(fundamentalGain).connect(ctx.destination);

  const bell = ctx.createOscillator();
  bell.type = 'sine';
  bell.frequency.value = freq * 2.03; // detuned harmonic — the metallic "tine" bite
  const bellGain = ctx.createGain();
  bellGain.gain.setValueAtTime(0, 0);
  bellGain.gain.linearRampToValueAtTime(0.32, 0.004);
  bellGain.gain.exponentialRampToValueAtTime(0.001, 0.25);
  bell.connect(bellGain).connect(ctx.destination);

  fundamental.start(0); fundamental.stop(duration);
  bell.start(0); bell.stop(0.3);
  return ctx.startRendering();
}

// A plain plucked low sine/triangle — simple on purpose, sits underneath
// without competing with the rhodes for harmonic space.
async function synthesizeBassNote(noteName) {
  const freq = midiToFreq(noteNameToMidi(noteName));
  const duration = 1.6;
  const sr = 44100;
  const ctx = new OfflineAudioContext(1, Math.ceil(duration * sr), sr);

  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.value = freq;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, 0);
  gain.gain.linearRampToValueAtTime(0.9, 0.01);
  gain.gain.exponentialRampToValueAtTime(0.3, 0.25);
  gain.gain.exponentialRampToValueAtTime(0.001, duration);
  osc.connect(gain).connect(ctx.destination);

  osc.start(0); osc.stop(duration);
  return ctx.startRendering();
}

// Classic drum-machine-style synthesis (sine-with-pitch-envelope kick,
// noise+tone snare, high-passed noise hihat) rather than samples — every
// lo-fi/chiptune web audio project does this and it sidesteps sourcing a
// drum kit's worth of one-shots entirely.
async function synthesizeDrumHit(piece) {
  const sr = 44100;

  if (piece === 'kick') {
    const duration = 0.4;
    const ctx = new OfflineAudioContext(1, Math.ceil(duration * sr), sr);
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, 0);
    osc.frequency.exponentialRampToValueAtTime(45, 0.15);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(1, 0);
    gain.gain.exponentialRampToValueAtTime(0.001, 0.35);
    osc.connect(gain).connect(ctx.destination);
    osc.start(0); osc.stop(duration);
    return ctx.startRendering();
  }

  if (piece === 'snare') {
    const duration = 0.3;
    const ctx = new OfflineAudioContext(1, Math.ceil(duration * sr), sr);

    const noiseBuffer = ctx.createBuffer(1, Math.ceil(duration * sr), sr);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer;
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = 'highpass';
    noiseFilter.frequency.value = 1000;
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(1.1, 0);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, 0.18);
    noise.connect(noiseFilter).connect(noiseGain).connect(ctx.destination);

    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = 180;
    const oscGain = ctx.createGain();
    oscGain.gain.setValueAtTime(0.8, 0);
    oscGain.gain.exponentialRampToValueAtTime(0.001, 0.12);
    osc.connect(oscGain).connect(ctx.destination);

    noise.start(0);
    osc.start(0); osc.stop(0.12);
    return ctx.startRendering();
  }

  if (piece === 'hihat') {
    const duration = 0.12;
    const ctx = new OfflineAudioContext(1, Math.ceil(duration * sr), sr);
    const noiseBuffer = ctx.createBuffer(1, Math.ceil(duration * sr), sr);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 7000;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.75, 0);
    gain.gain.exponentialRampToValueAtTime(0.001, 0.09);
    noise.connect(filter).connect(gain).connect(ctx.destination);
    noise.start(0);
    return ctx.startRendering();
  }

  return null;
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
  // Same methodology, applied to the synthesized instruments: measured
  // raw 0.3s-attack-window RMS was rhodes ~0.364, lofibass ~0.307,
  // lofikit ~0.205 (kick — the loudest of its three pieces, used as the
  // anchor so kick lands at the ~0.15 target and snare/hihat naturally
  // sit a bit under it, same as a real kit mix).
  rhodes: 0.412,
  lofibass: 0.488,
  lofikit: 0.732,
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
  drum: 0.45, // unverified against real drum samples yet — no family uses this role kind until one exists
};

// Drum one-shots are triggered at their recorded pitch/speed — no nearest-
// sample resolution, no playbackRate shift, unlike every pitched role
// above. A kick/snare/hihat isn't a scale degree with neighbors to fold
// or fall back to; it's exactly one specific recording or nothing.
function playDrumHit(instrument, piece, t, peak, dest) {
  const buffers = STATE.sampleBuffers[instrument];
  if (!buffers) return;
  const buffer = buffers[piece];
  if (!buffer) return;

  const ctx = STATE.audioCtx;
  const src = ctx.createBufferSource();
  src.buffer = buffer;

  const gain = ctx.createGain();
  gain.gain.value = peak * (INSTRUMENT_GAIN_COMPENSATION[instrument] || 1);

  src.connect(gain);
  gain.connect(dest);
  trackSource(src).start(t);
}

function playNoteAt(note, t, peak, dest) {
  if (note.role === 'pad') {
    playSampleChord(note.instrument, note.midiList, t, peak, dest, note.resolvedSamples);
  } else if (note.role === 'drum') {
    playDrumHit(note.instrument, note.drumPiece, t, peak, dest);
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

// Straight-eighth step position within a bar, with an optional swing feel
// (family-level, see GENRE_FAMILIES groove.swing): the off-beat ("and")
// eighth notes land later than an even grid, the way a laid-back groove
// actually sits. swing=0 (every family so far except any that opt in)
// returns exactly the old unswung `step * 0.5` for every step — this is
// additive, not a behavior change for anything that doesn't use it.
function stepBeat(step, groove) {
  const base = step * 0.5;
  if (!groove || !groove.swing || step % 2 === 0) return base;
  return base + groove.swing * 0.5;
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
  const family = GENRE_FAMILIES[Math.floor(Math.random() * GENRE_FAMILIES.length)];
  const seed = family.seeds[Math.floor(Math.random() * family.seeds.length)];
  // Flattened so every existing call site (song.genre.bpm, song.genre.rootMidi,
  // etc.) keeps working unchanged — family-level rules just ride along as
  // extra fields on the same object.
  const genre = { ...seed, family: family.name, chordVocabulary: family.chordVocabulary, groove: family.groove };
  const buildChord = CHORD_VOCABULARIES[genre.chordVocabulary];

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
      const chordDegrees = buildChord(chordRoot);
      const barStartBeat = bar * beatsPerBar;

      if (kind === 'melody') {
        let barHadNote = false;
        for (let step = 0; step < stepsPerBar; step++) {
          if (Math.random() < melodyWeights[step]) {
            const baseDeg = chordDegrees[Math.floor(Math.random() * chordDegrees.length)];
            const useChordTone = Math.random() < 0.8;
            const deg = useChordTone ? baseDeg : baseDeg + (Math.random() < 0.5 ? 1 : -1);
            notes.push({
              beat: humanizeBeat(barStartBeat + stepBeat(step, genre.groove), 0.03),
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
              beat: humanizeBeat(barStartBeat + stepBeat(step, genre.groove), 0.02),
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
          beat: humanizeBeat(barStartBeat + stepBeat(step, genre.groove), 0.04),
          midi: foldToInstrumentRange(instrument, scaleMidi(genre, deg, 1)),
          role: kind, instrument, vel: humanizeVelocity(), chunkIndex,
        });
      } else if (kind === 'drum') {
        // Not a scale degree — a fixed one-shot kit (kick/snare/hihat),
        // triggered on a steady pattern rather than derived from the
        // chord. Only families with hasDrumRole ever assign this kind
        // (see GENRE_FAMILIES), and playback (playDrumHit) skips all the
        // pitch-resolution machinery every other role above uses.
        for (let step = 0; step < stepsPerBar; step++) {
          const beat = barStartBeat + stepBeat(step, genre.groove);
          if (step === 0 || step === 4) {
            notes.push({ beat, role: kind, instrument, drumPiece: 'kick', vel: humanizeVelocity(), chunkIndex });
          }
          if (step === 2 || step === 6) {
            notes.push({ beat, role: kind, instrument, drumPiece: 'snare', vel: humanizeVelocity(), chunkIndex });
          }
          notes.push({
            beat, role: kind, instrument, drumPiece: 'hihat',
            vel: humanizeVelocity() * (step % 2 === 0 ? 1 : 0.7), chunkIndex,
          });
        }
      }
    }
  });

  capNoteGaps(notes, pairCount, totalBeats, 3.5);
  resolveInstrumentCollisions(notes);

  return { genre, totalBeats, pairCount, notes };
}

// Genre seeds reassign roles to instruments (see GENRE_FAMILIES above), which can put
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
    if (note.role === 'drum') continue; // fixed one-shot hits — never a nearest-sample collision candidate
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

// A wave's world is sized once, for whatever orientation the screen was in
// at wave start (see generateDots/computeWorldSize) — rotating the device
// mid-wave left that shape stuck, so a portrait-shaped world viewed on a
// newly-landscape screen could only be shown letterboxed down to fit its
// own (now the more constrained) height, wasting most of the screen's
// width. Grows w or h (never both, never shrinks) so the world's aspect
// ratio can cover the new screen shape too. Recomputed from the wave's
// fixed baseW/baseH every call, not from whatever the world had already
// grown to, so rotating back and forth repeatedly can't compound into an
// ever-larger world — a screen back at the original aspect ratio always
// lands exactly back at the original size.
// Every world-space coordinate the current wave might have live across
// several different STATE arrays with different field shapes (x/y,
// x1/y1/x2/y2, cx/cy, pivotX/pivotY). growWorldToMatchAspect only ever
// appends space on one side of the world by default (x/y stay [0, oldW]
// inside a newly bigger [0, newW]) — without re-centering everything
// already placed, the whole board would end up crammed into a corner of
// the bigger world instead of staying where the player left it (caught in
// review). Screen-space-only decorations (spaceObjects, celestialBodies —
// see their own comments) are deliberately NOT included here, since
// they're not part of the world coordinate system at all.
function shiftWorldEntities(dx, dy) {
  if (dx === 0 && dy === 0) return;
  for (const d of STATE.dots) { d.x += dx; d.y += dy; }
  for (const c of STATE.connections) {
    for (const seg of c.segments) { seg.x1 += dx; seg.y1 += dy; seg.x2 += dx; seg.y2 += dy; }
  }
  for (const l of STATE.lines) {
    for (const p of l.points) { p.x += dx; p.y += dy; }
  }
  for (const b of STATE.barriers) {
    b.x1 += dx; b.y1 += dy; b.x2 += dx; b.y2 += dy;
    if (b.pivotX !== undefined) { b.pivotX += dx; b.pivotY += dy; }
    if (b.cx !== undefined) { b.cx += dx; b.cy += dy; }
    if (b.segments) {
      for (const seg of b.segments) { seg.x1 += dx; seg.y1 += dy; seg.x2 += dx; seg.y2 += dy; }
    }
  }
  for (const s of STATE.stars) { s.x += dx; s.y += dy; }
  for (const spark of STATE.breakSparks) { spark.x += dx; spark.y += dy; }
  for (const p of STATE.currentPath) { p.x += dx; p.y += dy; }
  STATE.smoothedCursor.x += dx; STATE.smoothedCursor.y += dy;
}

function growWorldToMatchAspect() {
  if (!STATE.world.baseW || !STATE.world.baseH) return; // no wave in progress yet
  const screenAspect = canvas.width / canvas.height;
  const baseAspect = STATE.world.baseW / STATE.world.baseH;
  let targetW = STATE.world.baseW, targetH = STATE.world.baseH;
  if (screenAspect > baseAspect) {
    targetW = Math.min(STATE.world.baseW * CAMERA_CONFIG.MAX_ORIENTATION_GROWTH, STATE.world.baseH * screenAspect);
  } else if (screenAspect < baseAspect) {
    targetH = Math.min(STATE.world.baseH * CAMERA_CONFIG.MAX_ORIENTATION_GROWTH, STATE.world.baseW / screenAspect);
  }
  const newW = Math.max(STATE.world.baseW, targetW);
  const newH = Math.max(STATE.world.baseH, targetH);

  // Re-center: shift everything by half of whatever just got added (or
  // removed, rotating back) on each axis, always computed fresh against
  // the current world.w/h so this stays correct and reversible on every
  // call, not just the first.
  shiftWorldEntities((newW - STATE.world.w) / 2, (newH - STATE.world.h) / 2);

  STATE.world.w = newW;
  STATE.world.h = newH;
}

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  // Keep the camera's fit scale correct if the viewport changes mid-wave
  // (orientation change, desktop window resize). world.w is 0 until the
  // first wave starts, so this is a no-op at the initial page-load call.
  if (STATE.world.w > 0) {
    growWorldToMatchAspect();
    STATE.camera.autoScale = Math.min(1, Math.min(canvas.width / STATE.world.w, canvas.height / STATE.world.h));
    // On a wide wave (see WIDE_WORLD_START_WAVE), re-derive baseZoom against
    // the new viewport too, using world.comfortW/H as the fixed reference
    // dimensions (analogous to baseW/H for growWorldToMatchAspect) --
    // otherwise an orientation change mid-wide-wave would leave the
    // comfortable zoom's meaning stuck at whatever the screen used to be.
    // Skipped during WAVE_COMPLETE: checkWaveComplete deliberately resets
    // baseZoom to 1 (full-world fit) so the reveal shows everything the
    // player just connected -- recomputing the wide-wave "comfortable"
    // zoom here on a resize/rotation would silently re-zoom in and clip
    // part of that reveal.
    if (STATE.world.comfortW && STATE.phase !== 'WAVE_COMPLETE') {
      const comfortScale = Math.min(1, Math.min(canvas.width / STATE.world.comfortW, canvas.height / STATE.world.comfortH));
      STATE.camera.baseZoom = comfortScale / STATE.camera.autoScale;
    } else if (STATE.phase === 'WAVE_COMPLETE') {
      STATE.camera.baseZoom = 1;
    }
    // A wide wave's intro hold (see startWave/CAMERA_CONFIG.WIDE_INTRO_HOLD_MS)
    // pins targetScale at the full-world fit until wideIntroHoldUntil
    // passes -- a resize mid-hold must keep pinning it there too (at the
    // now-current autoScale), or the composed comfortable-zoom target
    // below would let the frame loop start lerping in early, skipping the
    // rest of the promised zoomed-out beat.
    STATE.camera.targetScale = STATE.camera.wideIntroHoldUntil
      ? STATE.camera.autoScale
      : STATE.camera.autoScale * (STATE.camera.baseZoom || 1) * STATE.camera.userZoom;
    clampCameraCenter(); // the viewport's own size just changed along with the canvas
  }
}
window.addEventListener('resize', resizeCanvas);
// iOS Safari can report transitional/stale window.innerWidth/innerHeight
// immediately on 'resize' right after a physical rotation — a real device
// issue no headless test can reproduce, since synthetic viewport changes
// don't have that transitional window. A second, delayed re-check is the
// standard mitigation: harmless if the first read was already correct,
// corrects it if it wasn't.
window.addEventListener('orientationchange', () => {
  resizeCanvas();
  setTimeout(resizeCanvas, 150);
});
resizeCanvas();

// ------------------------------------------------------------
// Camera: screen <-> world coordinate conversion. World space is centered
// under the screen's center and scaled by STATE.camera.scale — see
// CAMERA_CONFIG/computeWorldSize above for why the world can be larger
// than the screen in the first place.
// ------------------------------------------------------------
function applyCameraTransform() {
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.scale(STATE.camera.scale, STATE.camera.scale);
  ctx.translate(-STATE.camera.centerX, -STATE.camera.centerY);
}

function screenToWorld(sx, sy) {
  const s = STATE.camera.scale || 1;
  return {
    x: (sx - canvas.width / 2) / s + STATE.camera.centerX,
    y: (sy - canvas.height / 2) / s + STATE.camera.centerY,
  };
}

function worldToScreen(wx, wy) {
  const s = STATE.camera.scale || 1;
  return {
    x: (wx - STATE.camera.centerX) * s + canvas.width / 2,
    y: (wy - STATE.camera.centerY) * s + canvas.height / 2,
  };
}

function setUserZoom(z) {
  // MIN_USER_PULLBACK/MAX_USER_ZOOM_IN are meant as bounds on the total
  // scale relative to autoScale (the full-world fit) -- so on a wide wave,
  // where baseZoom already accounts for some of that range (see
  // CAMERA_CONFIG's baseZoom composition in startWave/resizeCanvas),
  // userZoom's own clamp is divided through by baseZoom first. That keeps
  // baseZoom * userZoom always within [MIN_USER_PULLBACK, MAX_USER_ZOOM_IN]
  // regardless of baseZoom, so the player can still always pull back far
  // enough to see the entire board, and never zoom in past the same
  // absolute ceiling as any other wave.
  const baseZoom = STATE.camera.baseZoom || 1;
  const minZ = CAMERA_CONFIG.MIN_USER_PULLBACK / baseZoom;
  const maxZ = CAMERA_CONFIG.MAX_USER_ZOOM_IN / baseZoom;
  STATE.camera.userZoom = Math.max(minZ, Math.min(maxZ, z));
  STATE.camera.targetScale = STATE.camera.autoScale * baseZoom * STATE.camera.userZoom;
}

// Keeps the camera's look-at point from ever showing past the world's own
// edge. Whenever the current (possibly still-animating) scale makes the
// viewport at least as big as the world in a dimension — true for every
// zoom level at or below the guaranteed-fit view — this forces that axis
// back to dead center, exactly reproducing the pre-pan behavior; only
// once zoomed in enough that the viewport is genuinely smaller than the
// world does panning have any room to move at all.
function clampCameraCenter() {
  const s = STATE.camera.scale || 1;
  const halfViewW = (canvas.width / 2) / s;
  const halfViewH = (canvas.height / 2) / s;
  STATE.camera.centerX = halfViewW * 2 >= STATE.world.w
    ? STATE.world.w / 2
    : Math.max(halfViewW, Math.min(STATE.world.w - halfViewW, STATE.camera.centerX));
  STATE.camera.centerY = halfViewH * 2 >= STATE.world.h
    ? STATE.world.h / 2
    : Math.max(halfViewH, Math.min(STATE.world.h - halfViewH, STATE.camera.centerY));
}

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

// The hint button's whole point: let the player self-check "is everything
// really connected?" before reporting a defect, rather than guessing from
// a screenshot the way the dimming fix above was originally motivated by.
// Five white flashes over a few seconds reads unmistakably as "these
// specific dots" -- a smooth same-hue brightness pulse (the original
// version of this) was too easily mistaken for a dot's own ambient
// pulse, since neither one ever changes color, just brightness/size.
const HINT_PULSE_CONFIG = {
  DURATION_MS: 3500,
  CYCLES: 5,
};

function triggerHintPulse() {
  STATE.hintPulse = { startTime: performance.now() };
}

// 0 at the very start/end/between flashes, 1 at each flash's peak -- same
// shape for every unconnected dot, so they all flash in unison. Raising
// the underlying cosine wave to a power sharpens each cycle into a brief
// flash with a longer dark valley in between, so it reads as a strobe
// (five distinct flashes) rather than a smooth pulse.
function hintPulseBrightness() {
  if (!STATE.hintPulse) return null;
  const elapsed = performance.now() - STATE.hintPulse.startTime;
  if (elapsed >= HINT_PULSE_CONFIG.DURATION_MS) { STATE.hintPulse = null; return null; }
  const t = elapsed / HINT_PULSE_CONFIG.DURATION_MS;
  const raw = (1 - Math.cos(t * HINT_PULSE_CONFIG.CYCLES * Math.PI * 2)) / 2;
  return Math.pow(raw, 3);
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

  // The pulse-amplitude difference above (idle vs. connected) is real but
  // subtle — on a busy, colorful board, especially with a 3+-dot group
  // (see GROUP_CONFIG) where dot.connected only flips true once the WHOLE
  // group is linked, it was easy to glance past a couple of still-pending
  // dots and read the group as done. A flat dimming while unconnected
  // makes "still needs a link" and "fully connected" impossible to confuse
  // at a glance, independent of where each dot's pulse phase happens to be.
  ctx.save();
  const hintBrightness = dot.connected ? null : hintPulseBrightness();
  if (hintBrightness !== null) {
    // Dim between flashes (same idle baseline as the plain unconnected
    // case below), full brightness right at each flash's peak -- so each
    // flash has an actual dark valley on either side of it and reads as
    // 5 distinct pops, not one dot that's simply brighter the whole time.
    // The glow stays at the idle size here rather than also growing --
    // the white pass below is what grows, and a same-size or smaller
    // colored halo underneath it is fully covered instead of peeking out
    // past the edge of a bigger white one (very light colors like gold
    // otherwise left a faint tinted ring around an otherwise-white dot).
    ctx.globalAlpha *= 0.55 + hintBrightness * 0.45;
    ctx.shadowBlur = 18;
  } else if (!dot.connected) {
    ctx.globalAlpha *= 0.55;
    ctx.shadowBlur = 18;
  } else {
    ctx.shadowBlur = 35;
  }
  ctx.shadowColor = instrument.hex;
  ctx.beginPath();
  traceDotShapePath(shape, dot.x, dot.y, radius);
  ctx.fillStyle = instrument.hex;
  ctx.fill();
  if (hintBrightness !== null && hintBrightness > 0.02) {
    // A same-hue brightness pulse (the original version of this) read as
    // just a stronger idle pulse -- a dot's ambient/connected pulse never
    // changes color either, only size/glow. Crossfading a solid white
    // fill on top, keyed to the same flash curve, changes the dot's
    // actual color at each peak instead, which is what actually makes it
    // read as a distinct "look here" signal. The glow has to switch to
    // white here too, not just the fill -- otherwise the halo stays
    // tinted the dot's own color even while the shape itself goes white,
    // and the flash reads as "colored glow, white middle" instead of
    // "this whole dot is now white".
    ctx.globalAlpha = hintBrightness;
    ctx.shadowColor = '#ffffff';
    ctx.shadowBlur = 18 + hintBrightness * 25;
    ctx.beginPath();
    traceDotShapePath(shape, dot.x, dot.y, radius);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.globalAlpha = 1;
  }

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

    // Symmetric with the start: the very first sub-curve starts exactly at
    // p0 (not a midpoint) so the line begins exactly at the dot it was
    // drawn from; the very last one has to end exactly at p2 for the same
    // reason, or the rendered line visibly stops short of the dot it was
    // drawn to — every interior joint in between still rounds through a
    // midpoint, which is the actual smoothing.
    const isLast = i === points.length - 2;
    const startX = i === 1 ? p0.x : (p0.x + p1.x) / 2;
    const startY = i === 1 ? p0.y : (p0.y + p1.y) / 2;
    const endX = isLast ? p2.x : (p1.x + p2.x) / 2;
    const endY = isLast ? p2.y : (p1.y + p2.y) / 2;

    ctx.beginPath();
    ctx.strokeStyle = strokeStyleFn.style(alpha);
    ctx.moveTo(startX, startY);
    ctx.quadraticCurveTo(p1.x, p1.y, endX, endY);
    ctx.stroke();
  }
}

// Once every point in a line has settled at LINE_FADE_FLOOR (see its
// comment), per-segment alpha variation is pointless — the whole line is
// one uniform color now — so this strokes the entire smoothed curve as a
// single continuous path instead of drawSmoothedPath's one stroke() call
// per segment. That distinction matters specifically because a settled
// line is never removed for the rest of the wave: a long, winding
// connection (which scoring explicitly rewards) can carry hundreds of
// points, and re-issuing hundreds of separate stroke() calls for it every
// frame for the rest of the wave is real, avoidable, accumulating cost on
// slower hardware. One call renders identically and doesn't scale with
// point count.
function drawSettledPath(points, style) {
  if (points.length < 2) return;
  ctx.strokeStyle = style;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  if (points.length === 2) {
    ctx.lineTo(points[1].x, points[1].y);
  } else {
    for (let i = 1; i < points.length - 1; i++) {
      const p1 = points[i], p2 = points[i + 1];
      const isLast = i === points.length - 2;
      const endX = isLast ? p2.x : (p1.x + p2.x) / 2;
      const endY = isLast ? p2.y : (p1.y + p2.y) / 2;
      ctx.quadraticCurveTo(p1.x, p1.y, endX, endY); // continues from the previous call's endpoint, chaining into one path
    }
  }
  ctx.stroke();
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
  // Same width in every branch below (and the same width drawActiveLine
  // uses while the line is still being drawn) -- see the LINE_WIDTH
  // comment. Only the glow pulses with the beat, never the width.
  ctx.lineWidth = CONFIG.LINE_WIDTH;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.shadowBlur = CONFIG.LINE_GLOW_BLUR * pulseBoost;
  ctx.shadowColor = instrument.hex;

  if (line.settled) {
    drawSettledPath(line.points, instrument.glow + CONFIG.LINE_FADE_FLOOR + ')');
  } else {
    drawSmoothedPath(line.points, {
      alpha: (p0, p1) => Math.min(p0.alpha, p1.alpha),
      style: (alpha) => instrument.glow + alpha + ')',
    });
  }

  ctx.restore();
}

function drawActiveLine() {
  if (!STATE.isDrawing || STATE.currentPath.length < 2 || !STATE.activeDot) return;

  const instrument = INSTRUMENTS[STATE.activeDot.colorIndex];

  ctx.save();
  // Same CONFIG.LINE_WIDTH as drawFadingLine, so there's no visible jump
  // in thickness the moment a connection is completed.
  ctx.lineWidth = CONFIG.LINE_WIDTH;
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

// A drip of melted wax sliding down a string isn't a circle — it's a fat
// rounded head leading the way with a tapered tail dragging behind it,
// pulled backward by drag as the head pushes forward. Drawn in the drip's
// own local space (forward = +x) then rotated to the actual direction of
// travel: a tail tip behind the head, two quadratic curves sweeping out
// to the head's "shoulders", and an arc around the leading hemisphere of
// the head to close the shape.
function drawWaxDrip(x, y, angle, headRadius, tailLength) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(-tailLength, 0);
  ctx.quadraticCurveTo(-tailLength * 0.3, headRadius * 0.9, 0, headRadius);
  ctx.arc(0, 0, headRadius, Math.PI / 2, -Math.PI / 2, true);
  ctx.quadraticCurveTo(-tailLength * 0.3, -headRadius * 0.9, -tailLength, 0);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
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
      const rawT = dripEase(lifeFrac);
      const pos = pointAtProgress(connection.segments, rawT);
      if (!pos) continue;

      // Direction of travel at this point on the (possibly curved) path —
      // sampled a hair behind the drip's current position — is what the
      // wax-drip shape orients itself to, fat head leading.
      const behindPos = pointAtProgress(connection.segments, Math.max(0, rawT - 0.01)) || pos;
      const dx = pos.x - behindPos.x, dy = pos.y - behindPos.y;
      const angle = (dx === 0 && dy === 0) ? 0 : Math.atan2(dy, dx);

      // Fades in right after birth and fades out right before arrival, so
      // drips never pop in/out abruptly at either end of the line.
      const alpha = Math.min(1, lifeFrac * 6) * Math.min(1, (1 - lifeFrac) * 5);
      ctx.globalAlpha = 0.2 + 0.75 * alpha;
      ctx.fillStyle = instrument.hex;
      drawWaxDrip(pos.x, pos.y, angle, TRAVELING_LIGHT_CONFIG.RADIUS, TRAVELING_LIGHT_CONFIG.TAIL_LENGTH);
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
  const shuffledInstruments = shuffleArray([...Array(INSTRUMENTS.length).keys()]).slice(0, pairCount);

  // Group sizes are rolled up front (rather than as each dot is placed) so
  // the total dot count for the wave is known before anything gets a
  // position — computeWorldSize needs that total to decide whether this
  // wave's board needs to grow to keep every dot properly spaced.
  const groupSizes = [];
  let totalDots = 0;
  for (let pairId = 0; pairId < pairCount; pairId++) {
    const size = groupSizeForColor(wave);
    groupSizes.push(size);
    totalDots += size;
  }

  const comfortSize = computeWorldSize(totalDots);
  STATE.world = wave >= WIDE_WORLD_START_WAVE ? applyWideWorldFloor(comfortSize) : comfortSize;
  // The dot-count-driven size on its own, without the wide-world floor --
  // this is what "comfortable" (normal, non-scrolled) zoom means once the
  // floor has made the actual world bigger; see startWave's camera intro.
  STATE.world.comfortW = comfortSize.w;
  STATE.world.comfortH = comfortSize.h;
  // The wave's own size (post wide-world floor), kept alongside the
  // (possibly since-grown, see growWorldToMatchAspect) w/h -- an
  // orientation change recomputes growth from this fixed baseline every
  // time, rather than compounding onto whatever the world had already
  // grown to, so rotating back and forth repeatedly can't balloon the
  // world without bound.
  STATE.world.baseW = STATE.world.w;
  STATE.world.baseH = STATE.world.h;

  // Waves that are about to show a tutorial hint (see TUTORIAL_MESSAGES)
  // keep dots out of the hint's reserved zone from the start, rather than
  // relying solely on the hint text dodging whatever dots already landed
  // there (layoutTutorialHint still does that too, as a second layer).
  const reservedRect = wave <= TUTORIAL_MESSAGES.length ? reservedHintWorldRect() : null;

  const dots = [];
  let idCounter = 0;
  for (let pairId = 0; pairId < pairCount; pairId++) {
    const colorIndex = shuffledInstruments[pairId];
    for (let k = 0; k < groupSizes[pairId]; k++) {
      const pos = findValidPosition(dots, reservedRect);
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

// The world-space box findValidPosition keeps dots out of on a tutorial
// wave (see TUTORIAL_HINT_RESERVE) -- inverse-projects a fixed
// screen-space box back to world coordinates using exactly the
// scale/center startWave is about to apply for this wave (world center,
// fit-to-screen scale), plus a dot's own radius so it's the dot's visual
// edge that clears the zone, not just its center point.
function reservedHintWorldRect() {
  const w = STATE.world.w, h = STATE.world.h;
  const scale = Math.min(1, canvas.width / w, canvas.height / h);
  const screenW = Math.min(canvas.width * TUTORIAL_HINT_RESERVE.WIDTH_FRACTION, TUTORIAL_HINT_RESERVE.MAX_WIDTH);
  const halfW = screenW / (2 * scale) + CONFIG.DOT_RADIUS_CONNECTED_MAX / scale;
  const halfH = TUTORIAL_HINT_RESERVE.HEIGHT / (2 * scale) + CONFIG.DOT_RADIUS_CONNECTED_MAX / scale;
  const cx = w / 2, cy = h / 2;
  return { x1: cx - halfW, x2: cx + halfW, y1: cy - halfH, y2: cy + halfH };
}

function inReservedRect(x, y, reservedRect) {
  return !!reservedRect && x >= reservedRect.x1 && x <= reservedRect.x2 && y >= reservedRect.y1 && y <= reservedRect.y2;
}

// A rotating barrier's initial pose isn't the whole story: updateBarriers
// spins it continuously around (cx, cy), so over time it sweeps out the
// full disk of radius `radius` (half its length) centered there -- not
// just the line it happens to be drawn as at generation time. Used by
// generateBarriersSafely so a rotating barrier whose starting angle
// avoids the reserved hint zone, but whose pivot/radius means some later
// angle would sweep through it, still gets rejected up front.
function circleNearRect(cx, cy, radius, rect) {
  if (!rect) return false;
  const nearestX = Math.max(rect.x1, Math.min(cx, rect.x2));
  const nearestY = Math.max(rect.y1, Math.min(cy, rect.y2));
  return Math.hypot(cx - nearestX, cy - nearestY) < radius;
}

// Sampled-points check for whether a world-space line segment passes
// through a world-space rect (both endpoints outside it doesn't mean the
// segment itself doesn't cross through the middle) -- used by
// generateBarriersSafely to keep a static barrier's line from cutting
// across the reserved hint zone. Rotating barriers use circleNearRect
// above instead, since their line doesn't stay put.
function segmentNearRect(x1, y1, x2, y2, rect, steps = 8) {
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    if (inReservedRect(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, rect)) return true;
  }
  return false;
}

function findValidPosition(existingDots, reservedRect) {
  const maxAttempts = 200;
  const w = STATE.world.w, h = STATE.world.h;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const x = CONFIG.EDGE_MARGIN + Math.random() * (w - CONFIG.EDGE_MARGIN * 2);
    const y = CONFIG.EDGE_MARGIN + Math.random() * (h - CONFIG.EDGE_MARGIN * 2);

    if (inReservedRect(x, y, reservedRect)) continue;

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

  // computeWorldSize sizes the board so this should essentially never be
  // reached — but if an unlucky run of random attempts still comes up
  // empty, fall through to a deterministic search for whichever candidate
  // point is farthest from its single nearest existing dot, rather than
  // the old fixed grid that placed a dot without checking existing dots
  // at all (the actual cause of dots landing directly on top of each
  // other on crowded intense-difficulty waves). This always returns the
  // best spacing actually available, never a silent overlap.
  return bestCandidatePosition(existingDots, reservedRect);
}

function bestCandidatePosition(existingDots, reservedRect) {
  const w = STATE.world.w, h = STATE.world.h;
  const cols = 24, rows = 24;
  let best = { x: w / 2, y: h / 2 }, bestDist = -1;
  let bestOutsideReserved = null, bestOutsideReservedDist = -1;

  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c <= cols; c++) {
      const x = CONFIG.EDGE_MARGIN + (c / cols) * (w - CONFIG.EDGE_MARGIN * 2);
      const y = CONFIG.EDGE_MARGIN + (r / rows) * (h - CONFIG.EDGE_MARGIN * 2);
      let nearest = Infinity;
      for (const dot of existingDots) {
        nearest = Math.min(nearest, Math.hypot(dot.x - x, dot.y - y));
      }
      if (nearest > bestDist) { bestDist = nearest; best = { x, y }; }
      if (!inReservedRect(x, y, reservedRect) && nearest > bestOutsideReservedDist) {
        bestOutsideReservedDist = nearest;
        bestOutsideReserved = { x, y };
      }
    }
  }

  // Prefer the best spot that also clears the reserved hint zone; only an
  // entire world too small to have any such point at all (never expected
  // in practice -- computeWorldSize sizes the board for the dot count
  // well before the reserved zone is a meaningful fraction of it) falls
  // back to ignoring the zone rather than refusing to place the dot.
  return bestOutsideReserved || best;
}

// Defense in depth on top of findValidPosition/bestCandidatePosition
// themselves: whatever the reason a dot's final position might land
// outside its world bounds (a future regression, a screen-size edge case,
// anything), catch it here too. An out-of-bounds dot is invisible and
// untappable — indistinguishable, from the player's side, from "this dot
// has no matching pair" — so this is checked once, right after
// generation, rather than trusted to never happen again.
function ensureAllDotsInWorldBounds(dots) {
  for (const dot of dots) {
    const inBounds = dot.x >= 0 && dot.x <= STATE.world.w && dot.y >= 0 && dot.y <= STATE.world.h;
    if (inBounds) continue;
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
canvas.addEventListener('wheel', onWheelZoom, { passive: false });

// Safety net for a draw gesture whose end event never reaches canvas at
// all -- a mouse released over the page background outside canvas (no
// mouseup target there to bubble from), or the browser window losing
// focus entirely mid-drag (dragged out of the viewport and released
// somewhere else), or iOS interrupting an in-progress touch. Without
// this, STATE.isDrawing would stick true forever: previously that just
// left one static stale line on screen, but now that updateEdgePan runs
// every frame regardless of new input events (see its own comment), a
// stuck gesture left near a screen edge would pan the camera and grow
// the path indefinitely instead. A window-level 'mouseup' still fires
// after canvas's own bubble-phase handler for any release that DID land
// on canvas, so this is a no-op for a normal connection -- onInputEnd
// has already cleared isDrawing by the time it runs.
function cancelStaleDrawGesture() {
  if (STATE.isDrawing) cancelActiveLine();
}
window.addEventListener('mouseup', cancelStaleDrawGesture);
window.addEventListener('blur', cancelStaleDrawGesture);
canvas.addEventListener('touchcancel', cancelStaleDrawGesture, { passive: false });

// A key press also advances past the WAVE_COMPLETE screen, same as a tap.
window.addEventListener('keydown', () => {
  if (STATE.phase === 'WAVE_COMPLETE' && STATE.waveCompleteAdvanceFn) {
    STATE.waveCompleteAdvanceFn();
  }
});

// Returns world-space coordinates (see screenToWorld) — every caller wants
// to compare against dot.x/dot.y, which live in world space once the
// board is zoomed, not raw screen pixels.
function getEventPos(e) {
  const rect = canvas.getBoundingClientRect();
  if (e.touches && e.touches.length > 0) {
    return screenToWorld(e.touches[0].clientX - rect.left, e.touches[0].clientY - rect.top);
  }
  return screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
}

// Raw canvas-relative screen coordinates, not run through screenToWorld —
// panning needs a screen-space delta divided by scale, not a world-space
// point that would itself shift as centerX/Y move mid-drag.
function getEventScreenPos(e) {
  const rect = canvas.getBoundingClientRect();
  if (e.touches && e.touches.length > 0) {
    return { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top };
  }
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

function pinchDistance(touches) {
  return Math.hypot(touches[1].clientX - touches[0].clientX, touches[1].clientY - touches[0].clientY);
}

function beginPinch(e) {
  // A second finger landing mid-draw means the player's going for a pinch,
  // not finishing the line they were drawing — drop the in-progress line
  // rather than completing/rejecting a connection they didn't intend.
  if (STATE.isDrawing) cancelActiveLine();
  STATE.panDrag = null; // a second finger landing mid-pan means a pinch is starting, not a continued drag
  STATE.pinch = { startDist: pinchDistance(e.touches), startZoom: STATE.camera.userZoom };
}

function updatePinch(e) {
  if (!STATE.pinch) { beginPinch(e); return; }
  setUserZoom(STATE.pinch.startZoom * (pinchDistance(e.touches) / STATE.pinch.startDist));
}

function onWheelZoom(e) {
  if (STATE.phase !== 'PLAYING' || STATE.paused) return;
  e.preventDefault();
  setUserZoom(STATE.camera.userZoom - e.deltaY * CAMERA_CONFIG.WHEEL_ZOOM_STEP);
}

function onInputStart(e) {
  e.preventDefault();
  if (STATE.paused) return; // pause menu handles its own input via real DOM buttons

  if (STATE.phase === 'PLAYING' && e.touches && e.touches.length >= 2) {
    beginPinch(e);
    return;
  }

  initAudio();

  if (STATE.phase === 'TITLE') {
    hideMessage();
    // A plain tap only resumes automatically when the player has opted
    // into that via the Auto Load Last Save checkbox — otherwise it
    // always starts wave 1, same as if there were no save at all. An
    // existing save is still reachable through the explicit Load Game
    // button (see handleLoadGameFromTitle), just never picked up silently.
    if (STATE.autoLoadEnabled && STATE.pendingResume) {
      const resume = STATE.pendingResume;
      STATE.pendingResume = null;
      STATE.score = resume.score;
      startWave(resume.wave);
    } else {
      STATE.pendingResume = null;
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
  if (!dot) {
    // Dragging empty board space was always a no-op before panning
    // existed, and stays one at the guaranteed-fit view or further out —
    // only once the viewport is actually smaller than the world is there
    // anywhere left to pan to. That's the *composed* zoom relative to
    // autoScale (baseZoom * userZoom), not userZoom alone -- on a wide
    // wave (see WIDE_WORLD_START_WAVE), baseZoom alone can already put the
    // resting "comfortable" zoom past 1 even while userZoom is still its
    // reset default of 1, and the player needs to be able to pan right
    // away there, not only after zooming in further still.
    if (STATE.camera.baseZoom * STATE.camera.userZoom > 1) {
      const screenPos = getEventScreenPos(e);
      STATE.panDrag = {
        startScreenX: screenPos.x, startScreenY: screenPos.y,
        startCenterX: STATE.camera.centerX, startCenterY: STATE.camera.centerY,
      };
    }
    return;
  }

  STATE.activeDot = dot;
  STATE.isDrawing = true;
  STATE.currentPath = [{ x: dot.x, y: dot.y }];
  STATE.smoothedCursor = { x: dot.x, y: dot.y };
  STATE.lastDrawScreenPos = getEventScreenPos(e);
}

function onInputMove(e) {
  e.preventDefault();
  if (STATE.paused) return;

  if (STATE.phase === 'PLAYING' && e.touches && e.touches.length >= 2) {
    updatePinch(e);
    return;
  }

  if (STATE.panDrag) {
    const screenPos = getEventScreenPos(e);
    const s = STATE.camera.scale || 1;
    STATE.camera.centerX = STATE.panDrag.startCenterX - (screenPos.x - STATE.panDrag.startScreenX) / s;
    STATE.camera.centerY = STATE.panDrag.startCenterY - (screenPos.y - STATE.panDrag.startScreenY) / s;
    clampCameraCenter();
    return;
  }

  if (!STATE.isDrawing || STATE.phase !== 'PLAYING') return;

  // Remembered so updateEdgePan (see its own comment) can keep re-deriving
  // the world point under a finger/cursor that's holding still near the
  // screen edge, as the camera it's dragging along shifts what that point
  // actually is -- a real move event isn't the only thing that should
  // extend the line while edge-panning is active.
  STATE.lastDrawScreenPos = getEventScreenPos(e);
  advanceDrawingTo(getEventPos(e));
}

// Low-pass filters the raw pointer position (world space) toward
// STATE.smoothedCursor every call, not just every recorded path point, so
// hand tremor is damped out at the source -- curving through noisy points
// after the fact still looks jagged, but filtering before recording
// actually removes the shake. Shared between real move events (onInputMove)
// and updateEdgePan's synthetic per-frame re-derivation of the same point.
function advanceDrawingTo(worldPos) {
  STATE.smoothedCursor.x += (worldPos.x - STATE.smoothedCursor.x) * CONFIG.LINE_SMOOTHING;
  STATE.smoothedCursor.y += (worldPos.y - STATE.smoothedCursor.y) * CONFIG.LINE_SMOOTHING;

  const lastPoint = STATE.currentPath[STATE.currentPath.length - 1];
  const dist = Math.hypot(STATE.smoothedCursor.x - lastPoint.x, STATE.smoothedCursor.y - lastPoint.y);

  if (dist >= CONFIG.LINE_POINT_INTERVAL) {
    STATE.currentPath.push({ x: STATE.smoothedCursor.x, y: STATE.smoothedCursor.y });
  }
}

// While actively drawing and zoomed in enough that the world doesn't
// already fit on screen (same gate as the empty-space pan drag in
// onInputStart), holding the draw gesture near a screen edge auto-scrolls
// the camera toward it -- otherwise, with one finger already committed to
// drawing, there's no way to reach a dot that's currently off-screen at
// the player's current zoom level. Runs every frame (not just on move
// events) so it keeps scrolling even while the finger/cursor is
// physically still, held right at the edge.
const EDGE_PAN_CONFIG = {
  MARGIN_PX: 70,             // screen-space distance from an edge that starts pulling the camera
  MAX_SPEED_PX_PER_FRAME: 14, // camera pan speed once at/past the very edge, ~60fps like the rest of the game's per-frame constants
};

function updateEdgePan() {
  if (!STATE.isDrawing || !STATE.lastDrawScreenPos) return;
  if (STATE.camera.baseZoom * STATE.camera.userZoom <= 1) return; // nothing off-screen to reveal

  const { x, y } = STATE.lastDrawScreenPos;
  const m = EDGE_PAN_CONFIG.MARGIN_PX;
  const maxV = EDGE_PAN_CONFIG.MAX_SPEED_PX_PER_FRAME;
  let vx = 0, vy = 0;
  if (x < m) vx = -maxV * Math.min(1, (m - x) / m);
  else if (x > canvas.width - m) vx = maxV * Math.min(1, (x - (canvas.width - m)) / m);
  if (y < m) vy = -maxV * Math.min(1, (m - y) / m);
  else if (y > canvas.height - m) vy = maxV * Math.min(1, (y - (canvas.height - m)) / m);

  if (vx === 0 && vy === 0) return;

  const s = STATE.camera.scale || 1;
  STATE.camera.centerX += vx / s;
  STATE.camera.centerY += vy / s;
  clampCameraCenter();

  // The screen point itself hasn't moved, but the world point underneath
  // it just did (the camera moved) -- re-derive it fresh and keep
  // extending the line toward it, exactly as a real move event would.
  advanceDrawingTo(screenToWorld(x, y));
}

function onInputEnd(e) {
  e.preventDefault();
  if (STATE.paused) return;

  // Lifting one finger of a pinch still leaves e.touches.length === 1, so
  // this only clears once every finger is up; a still-active pinch (2+
  // remaining touches, e.g. a three-finger gesture) is left alone.
  if (e.touches && e.touches.length >= 2) return;
  if (STATE.pinch) { STATE.pinch = null; return; }
  if (STATE.panDrag) { STATE.panDrag = null; return; }

  if (!STATE.isDrawing || !STATE.activeDot) return;

  STATE.isDrawing = false;
  STATE.lastDrawScreenPos = null;

  let pos = getEventPos(e);
  if (e.changedTouches && e.changedTouches.length > 0) {
    const rect = canvas.getBoundingClientRect();
    pos = screenToWorld(e.changedTouches[0].clientX - rect.left, e.changedTouches[0].clientY - rect.top);
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

  // findDotAt validated that the release position `pos` was within
  // DOT_HIT_RADIUS of targetDot, but `pos` itself was never added to
  // currentPath — only smoothed move events are, and a real release often
  // isn't preceded by one landing exactly there. Without this, the stored
  // line/segments (and the traveling lights that ride along them for the
  // rest of the wave, long after the initial line has faded) could trail
  // off short of the dot by a real, visible gap instead of reaching it.
  STATE.currentPath.push({ x: targetDot.x, y: targetDot.y });

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
  if (wouldStrandAnyDot(smoothedCurveSegments(STATE.currentPath), STATE.activeDot, targetDot)) {
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

// ------------------------------------------------------------
// Connection praise: a small "crowd reaction" popup for a connection that
// meets one of a few well-defined criteria -- see evaluateConnectionPraise.
// Escalates through three tiers (easy/great/incredible) per criterion, like
// a crowd getting more excited the better the play is, rather than a flat
// binary "good job" that either fires constantly or almost never.
// ------------------------------------------------------------
const CONNECTION_PRAISE_CONFIG = {
  // "Tight squeeze": minimum clearance (world px) from the drawn path to
  // the nearest barrier or other connection, excluding any point still
  // near either endpoint dot (being close to your own destination isn't a
  // squeeze). Lower clearance = tighter = more impressive; thresholds are
  // MAXIMUMS, checked tightest-first.
  SQUEEZE_EXCLUDE_RADIUS: 20, // added to CONFIG.DOT_RADIUS_CONNECTED_MAX
  SQUEEZE_TIERS: [48, 28, 14], // [easy, great, incredible] px

  // "Efficient despite complexity": path-length / straight-line-distance
  // ratio, only counted when the straight line between the two dots would
  // itself have been illegal (crosses a barrier or another connection) --
  // otherwise a short ratio just means nothing was in the way. Lower ratio
  // (closer to the theoretical minimum of 1) = more impressive; thresholds
  // are MAXIMUMS.
  EFFICIENT_TIERS: [1.6, 1.35, 1.15],

  // "Went the distance": the same ratio, the other direction -- a
  // deliberately long/winding route. Needs an absolute floor too (a
  // multiple of the game's own minimum dot spacing) so a trivially short
  // pair can't qualify on ratio alone. Thresholds are MINIMUMS.
  LONG_ABS_MIN_FACTOR: 2.5,
  LONG_TIERS: [1.8, 2.6, 3.6],
};

// thresholds = [easy, great, incredible] in the direction that gets
// progressively harder to satisfy. Returns the highest tier index (0-2)
// value actually clears, checked hardest-first, or -1 if none.
function tierIndexFor(value, thresholds, higherIsBetter) {
  for (let i = thresholds.length - 1; i >= 0; i--) {
    const passes = higherIsBetter ? value >= thresholds[i] : value <= thresholds[i];
    if (passes) return i;
  }
  return -1;
}

// Minimum distance between two line segments. Assumes they don't actually
// intersect (guaranteed here -- a crossing connection is already rejected
// before completeConnection ever runs), in which case the minimum distance
// is always at one of the four endpoints.
function segmentToSegmentDistance(a, b) {
  return Math.min(
    distPointToSegment(a.x1, a.y1, b.x1, b.y1, b.x2, b.y2),
    distPointToSegment(a.x2, a.y2, b.x1, b.y1, b.x2, b.y2),
    distPointToSegment(b.x1, b.y1, a.x1, a.y1, a.x2, a.y2),
    distPointToSegment(b.x2, b.y2, a.x1, a.y1, a.x2, a.y2)
  );
}

function straightLineBlocked(dotA, dotB) {
  const straight = { x1: dotA.x, y1: dotA.y, x2: dotB.x, y2: dotB.y };
  for (const b of STATE.barriers) {
    for (const bSeg of segmentsOfBarrier(b)) {
      if (segmentsIntersect(straight, bSeg)) return true;
    }
  }
  for (const c of STATE.connections) {
    for (const cSeg of c.segments) {
      if (segmentsIntersect(straight, cSeg)) return true;
    }
  }
  return false;
}

// Checked in priority order (squeeze, then efficient, then long) so only
// one fires per connection -- a connection that happens to qualify for
// more than one criterion shows whichever is checked first, not a stack
// of popups. newSegments/actualLen are passed in rather than recomputed
// since completeConnection already needs both for other reasons.
function evaluateConnectionPraise(dotA, dotB, newSegments, actualLen) {
  const straightDist = Math.hypot(dotB.x - dotA.x, dotB.y - dotA.y);
  if (straightDist < 1) return null; // guards a divide-by-zero that MIN_DOT_DISTANCE should already prevent

  const excludeR = CONFIG.DOT_RADIUS_CONNECTED_MAX + CONNECTION_PRAISE_CONFIG.SQUEEZE_EXCLUDE_RADIUS;
  let minClearance = Infinity;
  for (const seg of newSegments) {
    const midX = (seg.x1 + seg.x2) / 2, midY = (seg.y1 + seg.y2) / 2;
    if (Math.hypot(midX - dotA.x, midY - dotA.y) < excludeR) continue;
    if (Math.hypot(midX - dotB.x, midY - dotB.y) < excludeR) continue;
    for (const b of STATE.barriers) {
      for (const bSeg of segmentsOfBarrier(b)) minClearance = Math.min(minClearance, segmentToSegmentDistance(seg, bSeg));
    }
    for (const c of STATE.connections) {
      for (const cSeg of c.segments) minClearance = Math.min(minClearance, segmentToSegmentDistance(seg, cSeg));
    }
  }
  const squeezeTier = tierIndexFor(minClearance, CONNECTION_PRAISE_CONFIG.SQUEEZE_TIERS, false);
  if (squeezeTier >= 0) return { criterion: 'squeeze', tier: squeezeTier };

  const ratio = actualLen / straightDist;
  if (straightLineBlocked(dotA, dotB)) {
    const efficientTier = tierIndexFor(ratio, CONNECTION_PRAISE_CONFIG.EFFICIENT_TIERS, false);
    if (efficientTier >= 0) return { criterion: 'efficient', tier: efficientTier };
  }

  if (actualLen >= CONFIG.MIN_DOT_DISTANCE * CONNECTION_PRAISE_CONFIG.LONG_ABS_MIN_FACTOR) {
    const longTier = tierIndexFor(ratio, CONNECTION_PRAISE_CONFIG.LONG_TIERS, true);
    if (longTier >= 0) return { criterion: 'long', tier: longTier };
  }

  return null;
}

const CONNECTION_PRAISE_COPY = {
  squeeze: [
    ['Nice squeeze!', 'Threaded it!', 'Snug fit!'],
    ['Great squeeze!', 'Razor close!', 'Right through the gap!'],
    ['INCREDIBLE SQUEEZE!', 'UNREAL PRECISION!', 'THREADED THE NEEDLE!'],
  ],
  efficient: [
    ['Nice line!', 'Clean route!', 'Smart path!'],
    ['Great line!', 'Sharp routing!', 'Beautifully efficient!'],
    ['PERFECT LINE!', 'FLAWLESS ROUTE!', 'MASTERCLASS!'],
  ],
  long: [
    ['Nice reach!', 'Going the distance!', 'Nice stretch!'],
    ['Great reach!', 'What a journey!', 'Epic route!'],
    ['INCREDIBLE REACH!', 'LEGENDARY LINE!', 'EPIC JOURNEY!'],
  ],
};
const CONNECTION_PRAISE_EMOJI = ['👍', '⭐', '🔥'];
const CONNECTION_PRAISE_VISIBLE_MS = 4000;
const CONNECTION_PRAISE_TRANSITION_MS = 260;

// Escalates note count with tier, like a crowd's reaction growing with the
// play -- tier 0 is a light two-note nudge, tier 2 adds a rising flourish.
function playConnectionPraiseRiff(tier) {
  if (!STATE.audioCtx || !STATE.masterBus) return;
  const instrument = STATE.sampleBuffers.vibraphone ? 'vibraphone' : 'piano';
  const root = STATE.song ? STATE.song.genre.rootMidi : 60;
  const RIFFS = [
    [root + 12, root + 16],
    [root + 12, root + 16, root + 19],
    [root + 12, root + 16, root + 19, root + 24, root + 28],
  ];
  const notes = RIFFS[tier] || RIFFS[0];
  const t0 = STATE.audioCtx.currentTime + 0.02;
  notes.forEach((midi, i) => {
    playSample(instrument, midi, t0 + i * 0.08, 0.45, STATE.masterBus);
  });
}

// Anchored to dotB (the dot the connection just completed at) in world
// space -- updateConnectionPraise re-derives its screen position every
// frame via worldToScreen, so it tracks pan/zoom (including the wave's own
// end-of-wave camera reset) without needing to move itself. Flips to
// unfurl leftward instead of rightward when the dot is on the right side
// of the screen, so the popup doesn't habitually run off-screen there.
function spawnConnectionPraise(dotB, result) {
  const variants = CONNECTION_PRAISE_COPY[result.criterion][result.tier];
  const text = variants[Math.floor(Math.random() * variants.length)];
  const emoji = CONNECTION_PRAISE_EMOJI[result.tier];

  const el = document.createElement('div');
  el.className = `connection-praise praise-tier-${result.tier}`;
  const screenPos = worldToScreen(dotB.x, dotB.y);
  const flip = screenPos.x > canvas.width * 0.6;
  if (flip) el.classList.add('praise-flip');
  const textEl = document.createElement('span');
  textEl.className = 'connection-praise-text';
  textEl.textContent = text;
  const emojiEl = document.createElement('span');
  emojiEl.className = 'connection-praise-emoji';
  emojiEl.textContent = emoji;
  el.appendChild(textEl);
  el.appendChild(emojiEl);
  document.getElementById('connection-praise-layer').appendChild(el);

  STATE.connectionPraise.push({
    el, worldX: dotB.x, worldY: dotB.y, flip,
    spawnedAt: performance.now(),
    closing: false,
  });

  // Force a reflow before adding .open so the clip-path transition
  // actually plays instead of jumping straight to its open state (same
  // trick showAchievementToast already uses for its own pop animation).
  void el.offsetWidth;
  el.classList.add('open');

  playConnectionPraiseRiff(result.tier);
}

function updateConnectionPraise() {
  const now = performance.now();
  const GAP = 14, VERTICAL_OFFSET = 46;
  for (let i = STATE.connectionPraise.length - 1; i >= 0; i--) {
    const entry = STATE.connectionPraise[i];
    const elapsed = now - entry.spawnedAt;
    if (elapsed >= CONNECTION_PRAISE_VISIBLE_MS) {
      entry.el.remove();
      STATE.connectionPraise.splice(i, 1);
      continue;
    }
    if (!entry.closing && elapsed >= CONNECTION_PRAISE_VISIBLE_MS - CONNECTION_PRAISE_TRANSITION_MS) {
      entry.closing = true;
      entry.el.classList.remove('open'); // reverses the same clip-path transition that opened it
    }
    const screenPos = worldToScreen(entry.worldX, entry.worldY);
    entry.el.style.top = (screenPos.y - VERTICAL_OFFSET) + 'px';
    if (entry.flip) {
      entry.el.style.right = (canvas.width - screenPos.x + GAP) + 'px';
      entry.el.style.left = 'auto';
    } else {
      entry.el.style.left = (screenPos.x + GAP) + 'px';
      entry.el.style.right = 'auto';
    }
  }
}

function completeConnection(dotA, dotB) {
  ufUnion(dotA.id, dotB.id);
  markGroupIfFullySolved(dotA.pairId);

  const newSegments = smoothedCurveSegments(STATE.currentPath);
  const actualLen = pathLength(STATE.currentPath);
  // Same rule fact boxes already follow (see FACT_BOX_CONFIG/isTutorialWave
  // in generateBarriersSafely): never coexist with the tutorial hint. A
  // praise popup positions itself at whatever dot the connection just
  // completed at, with no awareness of the hint's own reserved zone, so it
  // could otherwise land squarely on top of the tutorial text a player is
  // still reading.
  const praise = STATE.tutorialWave ? null : evaluateConnectionPraise(dotA, dotB, newSegments, actualLen);

  STATE.connections.push({
    dotA: dotA.id,
    dotB: dotB.id,
    colorIndex: dotA.colorIndex,
    pairId: dotA.pairId,
    segments: newSegments,
  });

  const fadingLine = {
    colorIndex: dotA.colorIndex,
    pairId: dotA.pairId,
    points: STATE.currentPath.map(p => ({ x: p.x, y: p.y, alpha: 1.0 })),
    bornAt: performance.now(),
    settled: false,
  };
  STATE.lines.push(fadingLine);

  spawnStarsAroundDots(dotA, dotB);

  unmuteChunk(dotA.pairId);
  playConnectionChime(dotA.pairId);
  if (praise) spawnConnectionPraise(dotB, praise);

  haptic('connect');

  STATE.score += Math.round(actualLen * SCORE_PER_LINE_PIXEL);
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
  STATE.lastDrawScreenPos = null;
}

function cancelActiveLine() {
  STATE.activeDot = null;
  STATE.currentPath = [];
  STATE.isDrawing = false;
  STATE.lastDrawScreenPos = null;
}

function pathToSegments(path) {
  const segments = [];
  for (let i = 1; i < path.length; i++) {
    segments.push({ x1: path[i - 1].x, y1: path[i - 1].y, x2: path[i].x, y2: path[i].y });
  }
  return segments;
}

// Every crossing/stranding check needs to reason about the same curve the
// player actually sees, not the sparser raw recorded points connected by
// straight lines. drawSmoothedPath renders a quadratic curve through the
// midpoint of each consecutive pair of points (classic corner-rounding
// smoothing) — at a sharp turn, like curling tightly around a barrier's
// tip, that rounded curve and the raw straight-segment polyline can
// diverge enough that a line which visibly clears an obstacle still
// crosses it in the polyline actually being tested (or the reverse).
// Sampling the exact rendered curve into fine segments keeps what's
// tested and what's shown in agreement, so a line that looks clean is
// never rejected for a crossing the player can't see.
function smoothedCurveSegments(path) {
  if (path.length < 3) return pathToSegments(path);

  const SAMPLES_PER_SPAN = 8;
  const curvePoints = [path[0]];
  for (let i = 1; i < path.length - 1; i++) {
    const p0 = path[i - 1], p1 = path[i], p2 = path[i + 1];
    // Symmetric with the start (which is exactly path[0]): the last
    // sub-curve has to end exactly at path[length-1], the point that was
    // actually validated as touching the target dot — not a midpoint
    // short of it — or every downstream consumer of these segments
    // (barrier/connection crossing checks, the would-strand check, and
    // what the traveling lights travel along) ends up stopping visibly
    // short of the dot it was drawn to.
    const isLast = i === path.length - 2;
    const startX = i === 1 ? p0.x : (p0.x + p1.x) / 2;
    const startY = i === 1 ? p0.y : (p0.y + p1.y) / 2;
    const endX = isLast ? p2.x : (p1.x + p2.x) / 2;
    const endY = isLast ? p2.y : (p1.y + p2.y) / 2;
    for (let s = 1; s <= SAMPLES_PER_SPAN; s++) {
      const t = s / SAMPLES_PER_SPAN;
      const mt = 1 - t;
      // Same quadratic bezier (start, control=p1, end) that
      // ctx.quadraticCurveTo(p1.x, p1.y, endX, endY) draws from
      // (startX, startY) in drawSmoothedPath — sampled instead of drawn.
      curvePoints.push({
        x: mt * mt * startX + 2 * mt * t * p1.x + t * t * endX,
        y: mt * mt * startY + 2 * mt * t * p1.y + t * t * endY,
      });
    }
  }
  return pathToSegments(curvePoints);
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
  const newSegments = smoothedCurveSegments(path);

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
  // Dots and connection segments live in world space, which can be larger
  // than the screen on a crowded wave (see computeWorldSize) — the grid
  // has to cover the whole world or it'd silently clip off part of the
  // board and miss strandings that happen out past the screen's own size.
  const size = STRAND_CHECK_CELL_SIZE;
  const cols = Math.ceil(STATE.world.w / size) + 1;
  const rows = Math.ceil(STATE.world.h / size) + 1;
  // This grid has to include barriers, unlike existingConnectionSegments'
  // other use (pathCrossesExistingConnections), where excluding them is
  // correct — a barrier isn't a wall a new line can't cross near, it's
  // checked separately by pathCrossesBarriers. But for THIS reachability
  // question — "can dot still physically get to its groupmate at all" —
  // leaving barriers out was a real bug: this flood-fill could see an open
  // gap that a barrier actually occupies, approve a connection that seals
  // another dot in behind it, and if that barrier is static (never moves,
  // present from wave 3 on), the wave becomes permanently uncompleteable —
  // no replay, wait, or reconnect recovers it, since every real attempt to
  // route through that same gap afterward correctly gets rejected by
  // pathCrossesBarriers forever. Confirmed empirically: reproduced on ~1 in
  // 6 real generated waves 15-60, eliminated after this fix, with the only
  // remaining rare "stuck" cases being a currently-in-the-way *rotating*
  // barrier — transient and self-resolving, not permanent.
  const barrierSegs = STATE.barriers.flatMap(segmentsOfBarrier);
  const blocked = buildBlockedGrid([...existingConnectionSegments(newSegments), ...barrierSegs], size);

  // Simulate the pending union before checking anyone's reachability. A
  // 3+-dot group (see GROUP_CONFIG) can already have some dots unioned
  // together through an earlier connection — e.g. B and C already linked,
  // with the player now connecting A to B. Without this, dot C's
  // groupmate filter still lists A as "not yet connected" (true right
  // now, before this move), so the loop below went on to demand that C
  // *itself* have a real physical route straight to A — even though C
  // plainly reaches A transitively through B the instant A-B connects,
  // exactly like markGroupIfFullySolved already understands. Any barrier
  // that merely blocked C's own direct line to A (irrelevant to the move
  // actually being made) was enough to reject a perfectly valid
  // connection, with nothing about it looking wrong to the player. Undone
  // afterward either way — this is a hypothetical check, not the real
  // move; completeConnection() does the real union only if this is
  // accepted.
  const savedUnion = { ...STATE.dotUnion };
  ufUnion(dotA.id, dotB.id);

  let stranded = false;
  for (const dot of STATE.dots) {
    if (dot.connected) continue;
    const groupmates = STATE.dots.filter(d => d.pairId === dot.pairId && d.id !== dot.id && !ufConnected(d.id, dot.id));
    if (groupmates.length === 0) continue;
    const hasRoute = groupmates.some(g => isReachableAround(dot.x, dot.y, g.x, g.y, blocked, size, cols, rows));
    if (!hasRoute) { stranded = true; break; }
  }

  STATE.dotUnion = savedUnion;
  return stranded;
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

  // Whatever zoom/pan the player was using to land the final connection
  // is exactly what they'd otherwise be stuck looking at for the reveal
  // below -- the payoff moment (the full starfield, every connected line
  // visible at once) deserves to actually be seen, not just whatever
  // close-in corner happened to be on screen. Recenters immediately and
  // resets targetScale back to the full-world fit; camera.scale eases
  // toward it via the same per-frame lerp every other scale change
  // already uses (see update()), so this reads as the camera pulling
  // back to reveal everything rather than a hard cut.
  STATE.camera.userZoom = 1;
  STATE.camera.baseZoom = 1;
  STATE.camera.autoScale = Math.min(1, Math.min(canvas.width / STATE.world.w, canvas.height / STATE.world.h));
  STATE.camera.targetScale = STATE.camera.autoScale;
  STATE.camera.centerX = STATE.world.w / 2;
  STATE.camera.centerY = STATE.world.h / 2;

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
      STATE.waveCompleteAdvancing = false;
      startWave(STATE.wave + 1); // clears STATE.stars itself now — see its own comment
      startFadeFromBlack();
    });
  };
  STATE.waveCompleteAdvanceFn = advance; // callable from a tap/click/key press
}

function startWave(waveNumber) {
  STATE.wave = waveNumber;
  STATE.phase = 'PLAYING';
  STATE.dots = generateDots(waveNumber); // also sets STATE.world to fit this wave's dot count
  ensureAllDotsInWorldBounds(STATE.dots);

  // Fit the (possibly grown) world back into the screen. Manual zoom
  // resets to the guaranteed-fit view on every new wave, since the layout
  // — and therefore what "fits" means — is different each time; the
  // camera's rendered scale is left where it was so the transition
  // animates smoothly into the new wave rather than snapping.
  STATE.camera.autoScale = Math.min(1, Math.min(canvas.width / STATE.world.w, canvas.height / STATE.world.h));
  STATE.camera.userZoom = 1;
  if (waveNumber >= WIDE_WORLD_START_WAVE) {
    // The board is genuinely wider than the screen this wave (see
    // WIDE_WORLD_START_WAVE) -- "comfortable" zoom is whatever fit-scale
    // this wave's dot count alone would have called for, before the
    // wide-world floor widened it (see generateDots/world.comfortW/H).
    // baseZoom expresses that as a multiple of autoScale so it composes
    // with manual pinch/scroll the same way userZoom always has (see
    // setUserZoom).
    const comfortScale = Math.min(1, Math.min(canvas.width / STATE.world.comfortW, canvas.height / STATE.world.comfortH));
    STATE.camera.baseZoom = comfortScale / STATE.camera.autoScale;
    // Snap straight to the full-world view (not animated in from wherever
    // the previous wave's camera ended up) and hold there briefly before
    // easing toward the comfortable zoom -- see the wideIntroHoldUntil
    // check in the main update loop. Every wide wave gets this beat, not
    // just the first, so a differently-laid-out board still gets shown
    // off each time.
    STATE.camera.scale = STATE.camera.autoScale;
    STATE.camera.targetScale = STATE.camera.autoScale;
    STATE.camera.wideIntroHoldUntil = performance.now() + CAMERA_CONFIG.WIDE_INTRO_HOLD_MS;
  } else {
    STATE.camera.baseZoom = 1;
    STATE.camera.targetScale = STATE.camera.autoScale;
    STATE.camera.wideIntroHoldUntil = 0;
    if (!STATE.camera.scale) STATE.camera.scale = STATE.camera.autoScale; // first wave: nothing to animate from
  }
  // A new wave's world is a different size (or the same size laid out
  // completely differently) — last wave's pan position doesn't mean
  // anything here, so re-center on this wave's own middle rather than
  // carrying over wherever the camera happened to be looking before.
  STATE.camera.centerX = STATE.world.w / 2;
  STATE.camera.centerY = STATE.world.h / 2;
  STATE.pinch = null;
  STATE.panDrag = null;
  STATE.lastDrawScreenPos = null;

  STATE.dotUnion = {};
  for (const dot of STATE.dots) STATE.dotUnion[dot.id] = dot.id;
  STATE.connections = [];
  STATE.lines = [];
  STATE.activeDot = null;
  STATE.currentPath = [];
  STATE.isDrawing = false;
  for (const entry of STATE.connectionPraise) entry.el.remove();
  STATE.connectionPraise = [];
  STATE.spaceObjects = [];
  STATE.spaceSpawnTimer = 0;
  STATE.celestialBodies = [];
  // The full background starfield only means anything as a wave-complete
  // reveal, and a connection's own sparse halo only means anything while
  // that connection is real — carrying either into a new wave (resume,
  // restart, load, as well as the normal advance) makes an unconnected
  // board look like it's already got history it doesn't have.
  STATE.stars = [];
  STATE.waveStartScore = STATE.score;

  showTutorialHint(waveNumber);

  const pairCount = getPairCountForWave(waveNumber);
  STATE.song = generateSong(pairCount);
  STATE.barriers = generateBarriersSafely(waveNumber, STATE.dots);

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

// Every barrier except a maze barrier (see MAZE_CONFIG) is one straight
// x1..y2 segment. A maze barrier is a multi-corner wall with a few gaps
// carved out of it, so it stores its actual drawn/collision shape as a
// `segments` array of the solid pieces instead. This is the one place that
// difference gets resolved, so rendering, path-crossing, and reachability
// checks can all treat every barrier uniformly.
function segmentsOfBarrier(b) {
  return b.segments || [{ x1: b.x1, y1: b.y1, x2: b.x2, y2: b.y2 }];
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
    if (x1 < c || x1 > STATE.world.w - c || x2 < c || x2 > STATE.world.w - c) continue;
    if (y1 < c || y1 > STATE.world.h - c || y2 < c || y2 > STATE.world.h - c) continue;
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

function mazeLegCountForWave(wave) {
  if (wave < MAZE_CONFIG.START_WAVE) return 0;
  const extra = Math.floor((wave - MAZE_CONFIG.START_WAVE) / MAZE_CONFIG.WAVES_PER_LEG);
  return Math.min(2 + extra, MAZE_CONFIG.MAX_LEGS); // wave 40 itself: 2 legs = one corner, the training case
}

function mazeGapCountForWave(wave) {
  if (wave < MAZE_CONFIG.START_WAVE) return 0;
  const extra = Math.floor((wave - MAZE_CONFIG.START_WAVE) / MAZE_CONFIG.WAVES_PER_GAP);
  return Math.min(1 + extra, MAZE_CONFIG.MAX_GAPS); // wave 40 itself: 1 gap
}

// Walks the maze's corner-to-corner waypoint chain and returns the point
// `s` px along it (arc length from waypoints[0]), used to turn a cut point
// on the spine back into real x/y coordinates once gaps are carved out.
function mazePointAtArc(waypoints, legLens, cumLens, s) {
  for (let i = 0; i < legLens.length; i++) {
    if (s <= cumLens[i + 1] || i === legLens.length - 1) {
      const local = Math.max(0, Math.min(legLens[i], s - cumLens[i]));
      const t = legLens[i] === 0 ? 0 : local / legLens[i];
      const p0 = waypoints[i], p1 = waypoints[i + 1];
      return { x: p0.x + (p1.x - p0.x) * t, y: p0.y + (p1.y - p0.y) * t };
    }
  }
  return waypoints[waypoints.length - 1];
}

// One maze barrier: a multi-corner "spine" (see the waypoint chain built
// below) crossing one color pair's direct path, with a few small gaps cut
// out of it that a connection actually has to route through. Static only —
// a moving multi-corner wall would be unreadable — and additive to the
// regular static/rotating barrier budget above, roughly one per wave once
// unlocked at MAZE_CONFIG.START_WAVE.
function generateMazeBarrier(wave, dots) {
  const legCount = mazeLegCountForWave(wave);
  if (legCount < 2) return null;
  const gapCount = mazeGapCountForWave(wave);
  const pairCount = new Set(dots.map(d => d.pairId)).size;
  const c = MAZE_CONFIG.SCREEN_CLEARANCE;
  const inBounds = (p) => p.x >= c && p.x <= STATE.world.w - c && p.y >= c && p.y <= STATE.world.h - c;

  const worldMinDim = Math.min(STATE.world.w, STATE.world.h);
  const legLenMin = Math.max(MAZE_CONFIG.LEG_LENGTH_ABS_MIN, worldMinDim * MAZE_CONFIG.LEG_LENGTH_MIN_FRACTION);
  const legLenMax = Math.max(legLenMin, Math.min(MAZE_CONFIG.LEG_LENGTH_ABS_MAX, worldMinDim * MAZE_CONFIG.LEG_LENGTH_MAX_FRACTION));

  for (let attempts = 0; attempts < 60; attempts++) {
    const pairId = Math.floor(Math.random() * pairCount);
    const groupDots = dots.filter(d => d.pairId === pairId);
    if (groupDots.length < 2) continue;
    const gi = Math.floor(Math.random() * groupDots.length);
    let gj = Math.floor(Math.random() * (groupDots.length - 1));
    if (gj >= gi) gj++;
    const a = groupDots[gi], b = groupDots[gj];
    const dx = b.x - a.x, dy = b.y - a.y;
    const pairDist = Math.hypot(dx, dy);
    if (pairDist < 40) continue;

    const t = MAZE_CONFIG.PAIR_LINE_MIN_T + Math.random() * (MAZE_CONFIG.PAIR_LINE_MAX_T - MAZE_CONFIG.PAIR_LINE_MIN_T);
    const pivotX = a.x + dx * t, pivotY = a.y + dy * t;
    const lineAngle = Math.atan2(dy, dx);
    let angle = lineAngle + Math.PI / 2 + (Math.random() - 0.5) * MAZE_CONFIG.ANGLE_JITTER;
    let legLen = legLenMin + Math.random() * (legLenMax - legLenMin);

    // The first leg is centered on the pivot (like a regular barrier) so it
    // actually crosses the pair's direct path; every leg after that grows
    // from the previous leg's far end, turning by a fresh random corner
    // angle each time.
    const waypoints = [
      { x: pivotX - Math.cos(angle) * legLen / 2, y: pivotY - Math.sin(angle) * legLen / 2 },
      { x: pivotX + Math.cos(angle) * legLen / 2, y: pivotY + Math.sin(angle) * legLen / 2 },
    ];
    let valid = inBounds(waypoints[0]) && inBounds(waypoints[1]) &&
      segmentClearsAllDots(waypoints[0].x, waypoints[0].y, waypoints[1].x, waypoints[1].y, dots);

    for (let leg = 1; valid && leg < legCount; leg++) {
      const turn = MAZE_CONFIG.CORNER_ANGLE_MIN + Math.random() * (MAZE_CONFIG.CORNER_ANGLE_MAX - MAZE_CONFIG.CORNER_ANGLE_MIN);
      angle += (Math.random() < 0.5 ? -1 : 1) * turn;
      legLen = legLenMin + Math.random() * (legLenMax - legLenMin);
      const prev = waypoints[waypoints.length - 1];
      const next = { x: prev.x + Math.cos(angle) * legLen, y: prev.y + Math.sin(angle) * legLen };
      if (!inBounds(next) || !segmentClearsAllDots(prev.x, prev.y, next.x, next.y, dots)) { valid = false; break; }
      waypoints.push(next);
    }
    if (!valid) continue;

    const legLens = [];
    const cumLens = [0];
    for (let i = 0; i < waypoints.length - 1; i++) {
      const len = Math.hypot(waypoints[i + 1].x - waypoints[i].x, waypoints[i + 1].y - waypoints[i].y);
      legLens.push(len);
      cumLens.push(cumLens[i] + len);
    }
    const total = cumLens[cumLens.length - 1];
    if (total < gapCount * MAZE_CONFIG.GAP_WIDTH * 1.6) continue; // not enough spine length for this many gaps

    // Stratified gap placement: divide the spine into gapCount buckets and
    // drop one gap at a random spot within each, so gaps land spread out
    // along the wall instead of clustering, and never overlap.
    const gapIntervals = [];
    const bucket = total / gapCount;
    const half = MAZE_CONFIG.GAP_WIDTH / 2;
    for (let g = 0; g < gapCount; g++) {
      const margin = MAZE_CONFIG.GAP_WIDTH * 0.75;
      const lo = g * bucket + margin, hi = (g + 1) * bucket - margin;
      const center = lo >= hi ? (lo + hi) / 2 : lo + Math.random() * (hi - lo);
      gapIntervals.push([Math.max(0, center - half), Math.min(total, center + half)]);
    }

    // The complement of the gap intervals is what's left solid. A solid
    // stretch that spans a corner waypoint has to become two segments, not
    // one straight line cutting the corner off — hence splitting further
    // at any waypoint that falls inside it.
    const segments = [];
    let cursor = 0;
    const emitSolid = (s0, s1) => {
      const breaks = [s0];
      for (let i = 1; i < cumLens.length - 1; i++) {
        if (cumLens[i] > s0 + 1 && cumLens[i] < s1 - 1) breaks.push(cumLens[i]);
      }
      breaks.push(s1);
      for (let i = 0; i < breaks.length - 1; i++) {
        const p0 = mazePointAtArc(waypoints, legLens, cumLens, breaks[i]);
        const p1 = mazePointAtArc(waypoints, legLens, cumLens, breaks[i + 1]);
        segments.push({ x1: p0.x, y1: p0.y, x2: p1.x, y2: p1.y });
      }
    };
    for (const [gs, ge] of gapIntervals) {
      if (gs > cursor + 1) emitSolid(cursor, gs);
      cursor = Math.max(cursor, ge);
    }
    if (cursor < total - 1) emitSolid(cursor, total);
    if (segments.length === 0) continue;

    return {
      type: 'maze',
      segments,
      rotating: false,
      angularSpeed: 0,
      targetPairId: pairId,
      colorIndex: a.colorIndex,
      // Mirrors the first solid piece so any code that isn't segment-aware
      // still sees a sane (if partial) fallback segment instead of undefined.
      x1: segments[0].x1, y1: segments[0].y1, x2: segments[0].x2, y2: segments[0].y2,
    };
  }
  return null; // couldn't place a valid maze this many attempts — skip it for this wave
}

// Places a fact-box barrier (see FACT_BOX_CONFIG) somewhere clear of every
// dot. Whether a wave gets one at all is decided once by the caller — this
// only ever handles placement, so retrying generation doesn't silently
// re-roll and inflate the "1 in 5" odds.
function generateFactBoxBarrier(dots, reservedRect, existingBarriers) {
  const worldMinDim = Math.min(STATE.world.w, STATE.world.h);
  const size = Math.max(FACT_BOX_CONFIG.SIZE_ABS_MIN, Math.min(FACT_BOX_CONFIG.SIZE_ABS_MAX, worldMinDim * FACT_BOX_CONFIG.SIZE_FRACTION));
  const dotClearance = Math.max(FACT_BOX_CONFIG.DOT_CLEARANCE_ABS_MIN, Math.min(FACT_BOX_CONFIG.DOT_CLEARANCE_ABS_MAX, worldMinDim * FACT_BOX_CONFIG.DOT_CLEARANCE_FRACTION));
  // Same idea as the dot clearance above, but against every other barrier
  // already placed this attempt (regular + maze) -- generateFactBoxBarrier
  // used to only check dots, so a fact box could land close enough to a
  // barrier's line to visually crowd it, or even brush against it.
  const barrierClearance = dotClearance;
  const half = size / 2;
  const c = FACT_BOX_CONFIG.SCREEN_CLEARANCE;
  const spanX = STATE.world.w - 2 * (c + half);
  const spanY = STATE.world.h - 2 * (c + half);
  if (spanX <= 0 || spanY <= 0) return null; // world too small for the box to fit at all
  const barrierSegs = (existingBarriers || []).flatMap(segmentsOfBarrier);

  for (let attempts = 0; attempts < 150; attempts++) {
    const cx = c + half + Math.random() * spanX;
    const cy = c + half + Math.random() * spanY;
    const tooClose = dots.some(d =>
      Math.max(Math.abs(d.x - cx), Math.abs(d.y - cy)) < half + dotClearance
    );
    if (tooClose) continue;
    // A fact box is a whole other block of text -- on a tutorial-hint wave,
    // it needs to stay clear of the same reserved zone the hint itself
    // will want (see reservedHintWorldRect), or the two texts can land
    // stacked directly on top of each other.
    if (reservedRect && cx - half < reservedRect.x2 && cx + half > reservedRect.x1 &&
        cy - half < reservedRect.y2 && cy + half > reservedRect.y1) continue;
    if (barrierSegs.some(seg => segmentNearRect(seg.x1, seg.y1, seg.x2, seg.y2, {
      x1: cx - half - barrierClearance, x2: cx + half + barrierClearance,
      y1: cy - half - barrierClearance, y2: cy + half + barrierClearance,
    }))) continue;

    const x1 = cx - half, x2 = cx + half, y1 = cy - half, y2 = cy + half;
    const segments = [
      { x1, y1, x2, y2: y1 },
      { x1: x2, y1, x2, y2 },
      { x1: x2, y1: y2, x2: x1, y2 },
      { x1, y1: y2, x2: x1, y2: y1 },
    ];

    return {
      type: 'factBox',
      segments,
      rotating: false,
      angularSpeed: 0,
      targetPairId: null,
      colorIndex: Math.floor(Math.random() * INSTRUMENTS.length),
      cx, cy, size,
      text: PAUSE_FACTS[Math.floor(Math.random() * PAUSE_FACTS.length)],
      x1: segments[0].x1, y1: segments[0].y1, x2: segments[0].x2, y2: segments[0].y2,
    };
  }
  return null; // couldn't find a clear spot this many attempts — skip it for this wave
}

// Proactive version of the same reachability question wouldStrandAnyDot
// asks reactively on every move: with these barriers in place and zero
// connections drawn yet, can every dot in each color group still reach
// every one of its groupmates at all? Barriers are generated independently
// of each other and can happen to gang up — a maze barrier's gaps landing
// behind a static barrier's own coverage, say — and seal a dot in before
// the wave even starts. wouldStrandAnyDot alone can't catch that: it only
// runs once the player is mid-drag, by which point a wave that was already
// unsolvable at spawn just looks like an unplayable one with no recourse.
function allDotsReachableGivenBarriers(dots, barriers) {
  const size = STRAND_CHECK_CELL_SIZE;
  const cols = Math.ceil(STATE.world.w / size) + 1;
  const rows = Math.ceil(STATE.world.h / size) + 1;
  const blocked = buildBlockedGrid(barriers.flatMap(segmentsOfBarrier), size);

  const byPair = {};
  for (const d of dots) (byPair[d.pairId] = byPair[d.pairId] || []).push(d);
  for (const groupDots of Object.values(byPair)) {
    for (let i = 1; i < groupDots.length; i++) {
      // Reachability is transitive (it's just "in the same connected
      // free-space region"), so checking every groupmate against dot 0
      // is enough to guarantee the whole group is mutually reachable.
      if (!isReachableAround(groupDots[0].x, groupDots[0].y, groupDots[i].x, groupDots[i].y, blocked, size, cols, rows)) {
        return false;
      }
    }
  }
  return true;
}

// Generates a wave's full barrier set (regular + maze) and verifies it
// doesn't seal any dot away from its groupmates before ever handing it to
// the player — regenerating from scratch on failure, and giving up on
// barriers entirely (rather than ever shipping an unplayable wave) if
// nothing valid turns up after a generous number of attempts.
function generateBarriersSafely(wave, dots) {
  // Rolled once per wave, not once per retry attempt below — otherwise a
  // wave that happens to need a few retries to find a solvable layout would
  // get several independent shots at the fact-box roll, quietly inflating
  // the odds past the intended 1 in 5. Never rolled at all on a
  // tutorial-hint wave (1 through TUTORIAL_MESSAGES.length) -- a fact box
  // is a whole other block of text, and no amount of careful positioning
  // reliably keeps two independent pieces of text apart on every screen
  // size, so the two features simply never coexist instead.
  const isTutorialWave = wave <= TUTORIAL_MESSAGES.length;
  const wantFactBox = !isTutorialWave && Math.random() < FACT_BOX_CONFIG.PROBABILITY;
  const reservedRect = isTutorialWave ? reservedHintWorldRect() : null;
  for (let attempt = 0; attempt < 20; attempt++) {
    const barriers = generateBarriers(wave, dots);
    const maze = generateMazeBarrier(wave, dots);
    if (maze) barriers.push(maze);
    if (wantFactBox) {
      const factBox = generateFactBoxBarrier(dots, reservedRect, barriers);
      if (factBox) barriers.push(factBox);
    }
    // A regular (non-factBox) barrier is just a line between two dots, so
    // it can still thread straight through the reserved hint zone even
    // though both its endpoints are outside it -- reject the whole set and
    // retry with a fresh random layout rather than let a barrier cut
    // across the tutorial text. A rotating barrier's *current* line isn't
    // enough to check -- it sweeps a full disk around its pivot over time
    // (see circleNearRect), and the hint can still be on screen well into
    // that rotation since it only dismisses on the wave's first connection.
    const crossesReserved = reservedRect && barriers.some(b => {
      if (b.rotating) return circleNearRect(b.pivotX, b.pivotY, b.length / 2, reservedRect);
      return segmentsOfBarrier(b).some(seg => segmentNearRect(seg.x1, seg.y1, seg.x2, seg.y2, reservedRect));
    });
    if (crossesReserved) continue;
    if (allDotsReachableGivenBarriers(dots, barriers)) return barriers;
  }
  return [];
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
  // Otherwise this pair's star halo — the one lasting sign a connection
  // ever existed, now that its line no longer fades to nothing either —
  // would keep implying "still connected" long after a rotating barrier
  // reset it, which is exactly the stale signal that made a broken
  // connection read as a mystery instead of a break.
  STATE.stars = STATE.stars.filter(s => s.pairId !== pairId);
  spawnBreakSparks(sparkX, sparkY, colorIndex);
  remuteChunk(pairId);
  haptic('break');
}

function pathCrossesBarriers(path) {
  const segs = smoothedCurveSegments(path);
  for (const b of STATE.barriers) {
    for (const bSeg of segmentsOfBarrier(b)) {
      for (const seg of segs) {
        if (segmentsIntersect(seg, bSeg)) return true;
      }
    }
  }
  return false;
}

function drawBarriers() {
  ctx.save();
  for (const b of STATE.barriers) {
    // Tinted to the color of the pair it actually blocks — a generic
    // red/orange hazard color gave no visual clue which path a barrier
    // related to, so a well-placed one could still read as "just some
    // line sitting there." Both barrier types are always dashed —
    // nothing else in the game strokes a dashed line — specifically so a
    // barrier can never be mistaken for a connection, which is always
    // solid.
    //
    // The dash pattern alone wasn't enough: at the same heavy shadowBlur
    // every connection line uses, the glow bloomed straight across the
    // gaps and visually re-fused the dashes into what still read as a
    // continuous glowing tube — a real bug, not just a subtle one, since
    // it's exactly the confusion this whole convention exists to prevent.
    // Barriers now glow far less than a connection ever does, with gaps
    // wider than the dashes themselves and flat (not round) dash caps —
    // reads as taut hazard tape, not a softer cousin of a connection line.
    const instrument = INSTRUMENTS[b.colorIndex] || INSTRUMENTS[0];
    ctx.lineCap = 'butt';
    if (b.rotating) {
      ctx.lineWidth = 7;
      ctx.setLineDash([8, 14]);
      ctx.strokeStyle = instrument.glow + '0.85)';
      ctx.shadowBlur = 6;
      ctx.shadowColor = instrument.hex;
    } else {
      ctx.lineWidth = 8;
      ctx.setLineDash([12, 12]);
      ctx.strokeStyle = instrument.glow + '0.7)';
      ctx.shadowBlur = 6;
      ctx.shadowColor = instrument.hex;
    }
    for (const seg of segmentsOfBarrier(b)) {
      ctx.beginPath();
      ctx.moveTo(seg.x1, seg.y1);
      ctx.lineTo(seg.x2, seg.y2);
      ctx.stroke();
    }

    if (b.rotating) {
      // Rivet-style pivot markers — a dark center with a bright ring in
      // the barrier's own color — read as a mechanical pivot without
      // resembling anything else in the game (a dot's own white highlight
      // always sits inside a colored shape, never the reverse). Kept to
      // almost no glow for the same reason as the stroke above: too much
      // bloom washes the dark center out into just another soft blob.
      ctx.shadowBlur = 3;
      ctx.setLineDash([]); // the barrier's own dash pattern is still active here — the ring must be solid
      for (const [ex, ey] of [[b.x1, b.y1], [b.x2, b.y2]]) {
        ctx.beginPath();
        ctx.fillStyle = '#0a0a0f';
        ctx.arc(ex, ey, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = instrument.hex;
        ctx.stroke();
      }
    }

    if (b.type === 'factBox') {
      // A small in-game "plaque" — the same curated facts the pause menu
      // rotates through (see PAUSE_FACTS), occasionally stumbled into
      // mid-play instead of only read while paused. Clipped to the box's
      // interior so a long fact can never visibly spill past its own wall.
      const half = b.size / 2;
      ctx.save();
      ctx.beginPath();
      ctx.rect(b.cx - half + 8, b.cy - half + 8, b.size - 16, b.size - 16);
      ctx.clip();
      ctx.setLineDash([]);
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(255,255,255,0.82)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const { lines, lineHeight } = fitFactText(b.text, b.size - 24, b.size - 16);
      const startY = b.cy - ((lines.length - 1) * lineHeight) / 2;
      for (let i = 0; i < lines.length; i++) {
        ctx.fillText(lines[i], b.cx, startY + i * lineHeight);
      }
      ctx.restore();
    }
  }
  ctx.restore();
}

// Simple greedy word-wrap for canvas text — measureText relies on ctx.font
// already being set to the font the caller is about to draw with.
function wrapCanvasText(text, maxWidth) {
  const words = text.split(' ');
  const lines = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? current + ' ' + word : word;
    if (current && ctx.measureText(candidate).width > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

// A fact box's size varies with the world (see FACT_BOX_CONFIG), and
// PAUSE_FACTS entries vary a lot in length — a fixed font size reliably
// wrapped some facts to more lines than a small box's clipped interior
// could show, silently cutting off both the start and end of the text
// (caught in review). Shrinks the font to whatever size actually fits
// first; only truncates, with an ellipsis, if even the smallest legible
// size still doesn't fit.
// Upright sans-serif, not the pause menu's italic Georgia — legible at the
// small sizes a fact box actually renders at is a bigger win here than
// matching the pause menu's tone, especially once fitFactText has to
// shrink it toward the small end of the range.
function factBoxFont(px) {
  return `600 ${px}px "Segoe UI", Arial, sans-serif`;
}

function fitFactText(text, maxWidth, maxHeight) {
  const MAX_FONT_PX = 13, MIN_FONT_PX = 9, LINE_HEIGHT_RATIO = 1.25;
  for (let fontPx = MAX_FONT_PX; fontPx >= MIN_FONT_PX; fontPx--) {
    ctx.font = factBoxFont(fontPx);
    const lineHeight = fontPx * LINE_HEIGHT_RATIO;
    const lines = wrapCanvasText(text, maxWidth);
    if (lines.length * lineHeight <= maxHeight) return { lines, lineHeight };
  }

  const lineHeight = MIN_FONT_PX * LINE_HEIGHT_RATIO;
  ctx.font = factBoxFont(MIN_FONT_PX);
  const allLines = wrapCanvasText(text, maxWidth);
  const maxLines = Math.max(1, Math.floor(maxHeight / lineHeight));
  const lines = allLines.slice(0, maxLines);
  if (allLines.length > maxLines) {
    let last = lines[lines.length - 1];
    while (last.length > 0 && ctx.measureText(last + '…').width > maxWidth) last = last.slice(0, -1);
    lines[lines.length - 1] = last.trimEnd() + '…';
  }
  return { lines, lineHeight };
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
function makeStar(x, y, fadeSpeed, pairId) {
  const twinkling = Math.random() < STARFIELD_CONFIG.TWINKLE_FRACTION;
  return {
    x, y,
    pairId, // undefined for the base reveal starfield; set for a connection's own halo, so breakConnection can clear it
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
  // Stars live in screen space (drawStars runs outside the camera
  // transform, see render()) but dot.x/y are world-space — convert once
  // per dot rather than spawning stars at what would be the wrong screen
  // location whenever the camera is zoomed.
  for (const dot of [dotA, dotB]) {
    const p = worldToScreen(dot.x, dot.y);
    for (let i = 0; i < perDot; i++) {
      if (STATE.stars.length >= STARFIELD_CONFIG.MAX_STARS) return;
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.random() * STARFIELD_CONFIG.CONNECTION_STAR_RADIUS;
      STATE.stars.push(makeStar(p.x + Math.cos(angle) * dist, p.y + Math.sin(angle) * dist, STARFIELD_CONFIG.STAR_FADE_IN_SPEED, dotA.pairId));
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

// ============================================================
// HOW-TO-PLAY OVERLAY
// ============================================================
// Reachable from the title screen and mid-game alike (see #help-button's
// CSS). A plain reference, not a second pause mechanism -- its own opaque
// backdrop already blocks every pointer event from reaching the board
// underneath while it's open, so there's nothing else to freeze.
function openHelp() {
  document.getElementById('help-overlay').classList.add('visible');
}

function closeHelp() {
  document.getElementById('help-overlay').classList.remove('visible');
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
// A plain tap only silently resumes when Auto Load Last Save is checked
// (see onInputStart) -- the subtitle should promise exactly that, not
// more, or a save sitting there unloaded (the normal case, since it's
// off by default) would read as a broken promise the moment tapping
// starts wave 1 instead.
function titleSubtitleText() {
  if (STATE.autoLoadEnabled && STATE.pendingResume) {
    return `tap or click to resume — wave ${STATE.pendingResume.wave}`;
  }
  return 'connect the dots. make the music.';
}

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
  showMessage('LUMINA', titleSubtitleText(), { isTitleScreen: true });
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
  STATE.pauseFactTimer = setInterval(showNextPauseFact, 13000);
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
  document.getElementById('hint-button').addEventListener('click', triggerHintPulse);
  document.getElementById('help-button').addEventListener('click', openHelp);
  document.getElementById('help-close').addEventListener('click', closeHelp);
  document.getElementById('help-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'help-overlay') closeHelp(); // tapping the backdrop itself, not the panel
  });
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
  document.getElementById('title-load-row').classList.toggle('visible', isTitleScreen);
  if (isTitleScreen) {
    refreshDifficultyButtons();
    refreshTitleLoadRow();
  }
}

function hideMessage() {
  document.getElementById('message-overlay').style.opacity = '0';
  // The difficulty selector and load row are the elements in here with
  // real pointer-events — without explicitly clearing them too, they'd
  // stay clickable (invisibly, opacity alone doesn't disable
  // pointer-events) over whatever dots happen to render underneath once
  // play starts.
  document.getElementById('difficulty-selector').classList.remove('visible');
  document.getElementById('title-load-row').classList.remove('visible');
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

// Returns how many dots crowd `rect` (a screen-space DOM box, the tutorial
// hint), not just whether any do -- layoutTutorialHint uses the count to
// pick the least-bad fallback when no fully clear layout exists. dot.x/y
// are world-space, so each dot's on-screen position -- and its exclusion
// radius, in screen px -- has to go through the camera transform first.
function dotOverlapCount(rect) {
  const exclusion = (CONFIG.DOT_RADIUS_CONNECTED_MAX + TUTORIAL_HINT_BUFFER) * (STATE.camera.scale || 1);
  let count = 0;
  for (const dot of STATE.dots) {
    const p = worldToScreen(dot.x, dot.y);
    const cx = Math.max(rect.left, Math.min(p.x, rect.right));
    const cy = Math.max(rect.top, Math.min(p.y, rect.bottom));
    if (Math.hypot(p.x - cx, p.y - cy) < exclusion) count++;
  }
  return count;
}

function pointNearRect(px, py, rect, exclusion) {
  const cx = Math.max(rect.left, Math.min(px, rect.right));
  const cy = Math.max(rect.top, Math.min(py, rect.bottom));
  return Math.hypot(px - cx, py - cy) < exclusion;
}

// Dots weren't the only thing the hint could land on top of — a barrier
// (dashed lines, wave 3+) or a fact box (a whole other block of text, any
// wave — see FACT_BOX_CONFIG) could sit right under it too, and unlike a
// dot, a fact box overlapping the hint reads as two texts stacked on top
// of each other. Fact boxes get a real rect-vs-rect check (both are
// filled areas); every other barrier type gets the same sampled-points
// exclusion as a dot, since they're thin lines rather than a filled box.
// Returns a count (of barriers that crowd the rect), same reasoning as
// dotOverlapCount above.
function barrierOverlapCount(rect) {
  const exclusion = TUTORIAL_HINT_BUFFER * (STATE.camera.scale || 1);
  let count = 0;
  for (const b of STATE.barriers) {
    if (b.type === 'factBox') {
      const half = b.size / 2;
      const topLeft = worldToScreen(b.cx - half, b.cy - half);
      const bottomRight = worldToScreen(b.cx + half, b.cy + half);
      if (rect.left < bottomRight.x + exclusion && rect.right > topLeft.x - exclusion &&
          rect.top < bottomRight.y + exclusion && rect.bottom > topLeft.y - exclusion) count++;
      continue;
    }
    for (const seg of segmentsOfBarrier(b)) {
      const p1 = worldToScreen(seg.x1, seg.y1);
      const p2 = worldToScreen(seg.x2, seg.y2);
      const steps = 6;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        if (pointNearRect(p1.x + (p2.x - p1.x) * t, p1.y + (p2.y - p1.y) * t, rect, exclusion)) { count++; break; }
      }
    }
  }
  return count;
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

// The wave counter (top-left) and the pause/hint buttons + score (top-right)
// are real on-screen UI, not part of the board -- widening the hint's
// search radius (see layoutTutorialHint) made it reach up under them on a
// crowded wave, which reads even worse than grazing a dot. Treated the
// same as being off-screen: never an acceptable landing spot at all.
function rectOverlapsHud(rect) {
  const margin = 4;
  for (const id of ['wave-display', 'right-col']) {
    const el = document.getElementById(id);
    if (!el) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue; // not laid out (e.g. title screen)
    if (rect.left < r.right + margin && rect.right > r.left - margin &&
        rect.top < r.bottom + margin && rect.bottom > r.top - margin) return true;
  }
  return false;
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

  // Reach all the way to a corner of the screen, not just a band around
  // the center -- a tighter cap here was the actual reason busy waves kept
  // falling through to the fallback below even though plenty of clear
  // screen space existed outside that band.
  const maxRadius = Math.hypot(canvas.width, canvas.height) / 2;
  const positions = tutorialPositionCandidates(maxRadius, 30);

  // Prefer staying as close to centered as possible, and the font at full
  // size: at each candidate position (starting from dead-center), try
  // every line-break option (fewest lines first — i.e. "carriage return if
  // necessary") before moving further out. Only if every position/line
  // combination fails at full size — an extremely dot-crowded small
  // screen — do we shrink the font a little and search again, since a
  // smaller box is easier to fit around a busy layout.
  let fallback = null; // least-crowded layout found so far, even if not fully clear
  let fallbackScore = Infinity;
  for (const fontSize of [30, 24, 20, 17]) {
    el.style.fontSize = fontSize + 'px';
    for (const { dx, dy } of positions) {
      el.style.left = `calc(50% + ${dx}px)`;
      el.style.top = `calc(50% + ${dy}px)`;
      for (const lines of lineOptions) {
        el.innerHTML = lines.map(l => l.replace(/&/g, '&amp;').replace(/</g, '&lt;')).join('<br>');
        const rect = el.getBoundingClientRect();
        if (rectOutOfBounds(rect) || rectOverlapsHud(rect)) continue; // never off-screen or under the wave/score/buttons HUD
        const score = dotOverlapCount(rect) + barrierOverlapCount(rect);
        if (score === 0) return; // ideal: on-screen AND clear of every dot/barrier
        if (score < fallbackScore) { fallback = { fontSize, dx, dy, lines }; fallbackScore = score; }
      }
    }
  }
  // Exhausted every split, position, and font size without a fully clear
  // spot (pathologically cramped wave) — reapply the least-crowded layout
  // found across the whole search, not just the first one tried; worst
  // case it still grazes a dot, but it's never cut off, and it's the best
  // available rather than an arbitrary one.
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
  // The button was always visible, including on the title screen, where
  // togglePause() is a deliberate no-op (nothing to pause before the game
  // has started) — that reads as a broken button rather than an
  // intentionally absent one. Hidden here instead, at the same place
  // every phase transition already runs through.
  document.getElementById('pause-button').classList.toggle('visible', STATE.phase !== 'TITLE');
  document.getElementById('hint-button').classList.toggle('visible', STATE.phase !== 'TITLE');
}

// ============================================================
// SECTION 10: GAME LOOP
// ============================================================
function update() {
  enforceTutorialHintInvariant();
  updateEdgePan();
  updateConnectionPraise();

  for (const dot of STATE.dots) {
    dot.pulsePhase += CONFIG.DOT_PULSE_SPEED;
  }

  // Every point fades from 1 down to LINE_FADE_FLOOR (never to zero — see
  // its comment) over a fixed LINE_FADE_DURATION_MS, the same for every
  // line regardless of point count (see that constant's comment for why
  // a per-point cascade doesn't work here). Each point's own local fade
  // is staggered by its position along the line — start points begin
  // fading immediately, end points begin later — so it still sweeps
  // start-to-end, just all within the one fixed window. Once elapsed
  // time reaches the full duration, line.settled latches true and this
  // skips the line entirely from then on — both this loop and, in
  // drawFadingLine, the per-segment stroke calls that no longer have any
  // per-segment alpha variation left to justify their cost.
  const LOCAL_FADE_FRACTION = 0.4; // how much of the total duration each individual point's own transition takes
  for (const line of STATE.lines) {
    if (line.settled) continue;
    const elapsedFrac = Math.min(1, (performance.now() - line.bornAt) / CONFIG.LINE_FADE_DURATION_MS);
    const n = line.points.length;
    for (let i = 0; i < n; i++) {
      const posFrac = n <= 1 ? 0 : i / (n - 1);
      const startFrac = posFrac * (1 - LOCAL_FADE_FRACTION);
      const localProgress = Math.min(1, Math.max(0, (elapsedFrac - startFrac) / LOCAL_FADE_FRACTION));
      line.points[i].alpha = 1 - localProgress * (1 - CONFIG.LINE_FADE_FLOOR);
    }
    if (elapsedFrac >= 1) line.settled = true;
  }

  // Wide waves (see WIDE_WORLD_START_WAVE) start held at the full-world
  // fit-scale (set in startWave) rather than immediately easing toward the
  // comfortable play zoom -- this is that hold's release: once its
  // deadline passes, targetScale flips to the comfortable composed value
  // exactly once, and the ordinary per-frame lerp below takes it from
  // there like any other scale change.
  if (STATE.camera.wideIntroHoldUntil && performance.now() >= STATE.camera.wideIntroHoldUntil) {
    STATE.camera.targetScale = STATE.camera.autoScale * STATE.camera.baseZoom * STATE.camera.userZoom;
    STATE.camera.wideIntroHoldUntil = 0;
  }
  STATE.camera.scale += (STATE.camera.targetScale - STATE.camera.scale) * CAMERA_CONFIG.ZOOM_LERP;
  clampCameraCenter(); // re-clamp every frame, since the viewport's own size keeps changing while scale is still animating toward targetScale

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

  // Background stays in screen space regardless of camera zoom, like a
  // fixed backdrop behind the (possibly zoomed-out) board.
  drawStars();
  if (STATE.phase === 'WAVE_COMPLETE') { drawCelestialBodies(); drawSpaceObjects(); }

  ctx.save();
  applyCameraTransform();

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

  ctx.restore();

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

// Compares this page's build to whatever's actually live on the server
// right now, and if a newer one has shipped since this page was fetched
// (a stale service worker/HTTP cache, a tab left open across a deploy,
// etc.), does a single cache-busted reload so the player lands on the
// latest version without ever having to manually refresh. Called from
// several triggers below (not just initial load), but the sessionStorage
// guard means at most one reload attempt happens per target build.
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

    // The fetch above is async — if the player already tapped to begin
    // and started a wave before it resolved, don't yank the page out from
    // under them mid-session. They'll pick up the new version next load.
    if (STATE.phase !== 'TITLE') return;

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

// init() only runs once, at the true initial page load — but mobile
// Safari (and other browsers) can restore a backgrounded tab straight
// from bfcache after switching apps and back, which resumes the exact
// same running JS without ever re-running init() at all. A long-lived
// tab left open across several deploys could silently sit on a version
// old enough that "nothing changed" for a player who's actually looking
// at a stale page, not the current one. `pageshow` fires on every one of
// those restores (in addition to a normal load), 'visibilitychange'
// covers the same "came back to this tab" moment on desktop, and the
// periodic timer is a fallback for a tab that's simply been left open
// and foregrounded the whole time. All three funnel into the same
// function, which already no-ops safely unless there's actually a newer
// build AND the player is back on the title screen.
window.addEventListener('pageshow', checkForNewVersionAndReload);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') checkForNewVersionAndReload();
});
setInterval(checkForNewVersionAndReload, 5 * 60 * 1000);

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
  STATE.autoLoadEnabled = loadAutoLoadSetting();
  applyDifficulty(STATE.difficulty);
  setupDifficultySelectorListeners();
  setupTitleLoadListeners();
  showMessage('LUMINA', titleSubtitleText(), { isTitleScreen: true });
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

window.addEventListener('load', init);

window.__lumina = {
  getState: () => STATE,
  getDots: () => STATE.dots.map(d => ({ id: d.id, x: d.x, y: d.y, colorIndex: d.colorIndex, pairId: d.pairId, connected: d.connected })),
};
