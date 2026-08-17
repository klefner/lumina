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
  ERASE_HIT_RADIUS: 30,      // Touch detection radius for tapping an existing line in erase mode

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
// `relaxedOnly: true` skips the entry entirely outside Relaxed difficulty
// (see showTutorialHint) rather than showing a tip about a button that
// wave's player doesn't have.
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
  { text: 'Tap the ⋮ button any time to save your progress.', dismissWhen: 'connect' },
  { text: 'In Relaxed mode, open the ⋮ menu and tap Erase a Line, then tap a line to remove it and redraw.', dismissWhen: 'connect', relaxedOnly: true },
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
    // rotateSeed rides along with the save it actually belongs to (see
    // newRotateSeed's own comment) -- a single global "current" seed
    // would get silently overwritten the moment a fresh game starts
    // without touching this save, so loading the save back afterward
    // would resolve its already-played waves against the wrong seed,
    // possibly changing which package they'd shown. safariVariant rides
    // along for the exact same reason (review catch, PR #91): without it,
    // reloading mid-Safari-block would have a coin-flip chance of
    // switching day<->night before that block's waves were actually done.
    localStorage.setItem(SAVE_KEY, JSON.stringify({ wave: STATE.wave, score: STATE.score, rotateSeed: STATE.rotateSeed, safariVariant: STATE.safariVariant }));
    return true;
  } catch (e) { return false; }
}
function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed.wave || parsed.wave < 1) return null;
    // rotateSeed/safariVariant are missing on a save written before those
    // fields existed -- every call site falls back to STATE's own current
    // value (rotateSeed) or lets generateSafariScene reroll fresh
    // (safariVariant) when this is null (see
    // handleLoadGameFromTitle/handleLoadGame/startGameFromTitle).
    return { wave: parsed.wave, score: parsed.score || 0, rotateSeed: parsed.rotateSeed || null, safariVariant: parsed.safariVariant || null };
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

// Flight Mode -- an alternate way to play the same waves (see FLIGHT_CONFIG
// and the onInputStart/Move/End branches below): pilot a ship around the
// board and fly through dots instead of dragging between them. Off by
// default, same reasoning as autoload above -- an unconfigured player's
// experience never changes underneath them.
const FLIGHT_MODE_KEY = 'lumina_flightmode_v1';
function loadFlightModeSetting() {
  try { return localStorage.getItem(FLIGHT_MODE_KEY) === 'true'; } catch (e) { return false; }
}
function saveFlightModeSetting(enabled) {
  try { localStorage.setItem(FLIGHT_MODE_KEY, enabled ? 'true' : 'false'); } catch (e) { /* best-effort only */ }
}

// Cockpit Mode -- a third way to play the same wave progression (see
// COCKPIT_CONFIG and the onInputStart/Move/End branches below): a genuinely
// 3D first-person view, piloted with a virtual joystick, flying through
// pairs of colored dots scattered in open space instead of dragging or
// piloting a top-down ship. Mutually exclusive with Flight Mode (see
// setupTitleLoadListeners) -- off by default, same reasoning as above.
const COCKPIT_MODE_KEY = 'lumina_cockpitmode_v1';
function loadCockpitModeSetting() {
  try { return localStorage.getItem(COCKPIT_MODE_KEY) === 'true'; } catch (e) { return false; }
}
function saveCockpitModeSetting(enabled) {
  try { localStorage.setItem(COCKPIT_MODE_KEY, enabled ? 'true' : 'false'); } catch (e) { /* best-effort only */ }
}

// Scene -- which background plays behind the board (see SECTION 7C's
// Space starfield/celestial bodies and SECTION 7E's Night Forest/7F's
// Beach at Night). Either a fixed scene, or 'rotate' to work through every
// entry in SCENE_LIST in a random order, one whole package (a scene's full
// run of consecutive waves) at a time (see resolveSceneBlock's random-
// package-order rewrite), so two players sitting side by side comparing
// scenes never need to touch the dropdown mid-session. Defaults to
// 'rotate' (unlike flight/cockpit mode's off-by-default) since picking a
// scene doesn't change how you play -- an unconfigured player should just
// see everything.
const SCENE_LIST = ['space', 'forest', 'beach', 'birthday', 'halloween', 'christmas', 'safari'];
const SCENE_KEY = 'lumina_scene_v1';
function loadSceneSetting() {
  try {
    const saved = localStorage.getItem(SCENE_KEY);
    // Premium ids are accepted here purely so a fixed pick survives a
    // reload -- this is NOT where ownership is granted or checked (that's
    // isPremiumSceneOwned, read fresh by resolveSceneBlock/
    // refreshSceneSelector every time). A player who picked an owned
    // premium scene, then somehow lost ownership (cleared storage, new
    // device), keeps the stored selection but simply never gets it played
    // or shown as selectable, same as a Sleep-incompatible fixed pick
    // already behaves.
    return (saved === 'rotate' || SCENE_LIST.includes(saved) || PREMIUM_SCENE_LIST.includes(saved)) ? saved : 'rotate';
  } catch (e) {
    return 'rotate';
  }
}
function saveSceneSetting(mode) {
  try { localStorage.setItem(SCENE_KEY, mode); } catch (e) { /* best-effort only */ }
}

// Rotate mode's package order (player request, 2026-08-14): instead of
// always working through SCENE_LIST in the same fixed order, each
// completed package -- one scene's whole run of consecutive waves, e.g.
// Birthday's 5 -- is followed by a randomly chosen next package, not
// necessarily the next array entry. Every wave of whichever package comes
// up still plays in full before another package gets picked; nothing
// about mid-package behavior changes, only which package comes next.
//
// The actual pick has to be reproducible, not just "call Math.random()
// once" -- resolveSceneBlock is a pure function of waveNumber elsewhere
// (the HUD's own progress display calls it every frame, see
// updateWaveDisplay), and it has to keep agreeing with itself for the
// same wave, including after a reload mid-run (loading a save re-derives
// the scene from scratch, see startWave). A small seeded PRNG (mulberry32
// -- public-domain, single self-contained function, no library needed)
// makes the whole sequence a pure function of (seed, block index)
// instead: same seed always produces the same package order, so as long
// as the seed itself is persisted rather than re-rolled, a reload can't
// retroactively change which package a wave the player already reached
// was playing.
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// One seed per playthrough, riding along with whichever save it actually
// belongs to (see SAVE_KEY's own rotateSeed field) rather than one global
// "current" seed -- a single shared key would get silently overwritten
// the moment a fresh game starts without touching an existing save
// (Codex review catch, PR #87), so loading that save back afterward would
// resolve its already-played waves against the WRONG seed, possibly
// changing which package they'd shown. Every load/resume path restores
// the seed the save was actually written with; only a genuinely new
// playthrough (Start Game without autoload, Restart Game) calls this to
// roll a fresh one.
function newRotateSeed() {
  return 1 + Math.floor(Math.random() * 0xFFFFFFFE);
}

// Paid scenes (see the Store: index.html's #store-overlay and
// STORE_PRODUCTS below) -- deliberately never merged into SCENE_LIST.
// Keeping them a wholly separate list is what keeps them out of Rotate
// mode and every free-scene code path (activeSceneList, sceneWaveCount's
// caller in resolveSceneBlock's rotate branch) without any of those
// needing to know purchases exist at all -- the only place ownership
// actually gets checked is resolveSceneBlock's own premium branch below,
// which is the real enforcement backstop, not the dropdown (see
// refreshSceneSelector) that merely reflects it.
const PREMIUM_SCENE_LIST = ['aurora', 'reef', 'cavern'];
const PREMIUM_SCENE_NAMES = { aurora: 'Aurora Skies', reef: 'Coral Reef Glow', cavern: 'Crystal Cave' };

// This is a prototype storefront (see MONETIZATION_ARCHITECTURE.md's
// paywall-infrastructure entry) -- "purchasing" just writes scene ids to
// localStorage, the same honest-placeholder pattern PREMIUM_MUSIC_UNLOCKED
// already uses elsewhere in this file. Nothing here is a real entitlement
// check; a real launch replaces this with the Entitlement & Paid Content
// Service that doc describes, served from a Cloudflare Worker a static
// GitHub Pages site can't fake its way around.
const PURCHASED_SCENES_KEY = 'lumina_purchased_scenes_v1';
function loadPurchasedScenes() {
  try {
    const saved = JSON.parse(localStorage.getItem(PURCHASED_SCENES_KEY) || '[]');
    return Array.isArray(saved) ? saved.filter((id) => PREMIUM_SCENE_LIST.includes(id)) : [];
  } catch (e) {
    return [];
  }
}
function savePurchasedScenes(ids) {
  try { localStorage.setItem(PURCHASED_SCENES_KEY, JSON.stringify(ids)); } catch (e) { /* best-effort only */ }
}
function isPremiumSceneOwned(sceneId) {
  return STATE.purchasedScenes.includes(sceneId);
}

// The one product this demo storefront sells -- a single $1.99 bundle
// covering all three premium scenes at once, not three separate SKUs.
// Simpler for a first product, and matches the original ask ("three
// backgrounds... $1.99" as one pack, not $1.99 each).
const STORE_PRODUCTS = [{
  id: 'premium_scene_pack',
  name: 'Dreamscape Pack',
  priceLabel: '$1.99',
  sceneIds: PREMIUM_SCENE_LIST,
}];

// Grants every scene in the given product to the player and persists it.
// Called only from the demo checkout's "Simulate Purchase" button (see
// setupStoreListeners) -- a real Stripe Payment Links checkout would call
// this instead from a webhook-confirmed response, never from a client-side
// button tap alone (see MONETIZATION_ARCHITECTURE.md).
function completeSimulatedPurchase(productId) {
  const product = STORE_PRODUCTS.find((p) => p.id === productId);
  if (!product) return;
  const owned = new Set(STATE.purchasedScenes);
  for (const sceneId of product.sceneIds) owned.add(sceneId);
  STATE.purchasedScenes = Array.from(owned);
  savePurchasedScenes(STATE.purchasedScenes);
  refreshSceneSelector();
}

// How many consecutive waves Rotate mode holds a given scene for, before
// moving on to the next one in SCENE_LIST -- one more than that scene has
// real ambient sounds to reveal (see SCENE_AMBIENT_CONFIG): one wave per
// reveal, plus one bonus wave with nothing new to reveal, where the full
// set just gets to keep playing. That bonus wave matters because a
// reveal only happens on a wave's COMPLETION (see
// updateSceneAmbienceForWaveComplete) -- without it, the scene the LAST
// sound is revealed on doubles as the scene's very last wave, so the
// instant a player advances past that completion screen the scene (and
// that brand new sound) gets cut off, often before an event layer like
// the owl or whale even gets through its own 1.5-3.5s startup delay to
// make a single sound. Space has no ambient sounds of its own -- "no one
// can hear you scream in space" -- so it just gets a single wave, same as
// it always has.
//
// Referencing SCENE_AMBIENT_CONFIG (defined later, in SECTION 7's scene
// ambience block) is safe here specifically because this is a function
// body, not top-level module code -- it only actually runs once the whole
// script has finished loading and something calls resolveSceneForWave,
// by which point SCENE_AMBIENT_CONFIG's own `const` has long since
// initialized. A top-level `const` computed eagerly at this point in the
// file, before that declaration runs, would throw instead.
function sceneWaveCount(scene) {
  const config = SCENE_AMBIENT_CONFIG[scene];
  return config ? config.order.length + 1 : 1;
}

// Which scenes are appropriate for Sleep mode. Sleep exists specifically
// for calm, low-arousal stimulus (see the sleep-mode tint, the score
// display getting hidden below, and DIFFICULTY_CONFIG's own no-barriers
// choice for it) -- a scene whose whole theme is deliberately high-energy
// (a birthday party's balloon pops and horns) has no business playing
// under it, no matter what a player last had selected under a different
// difficulty. Every other difficulty can select any scene at all; this
// set only ever narrows things down while STATE.difficulty === 'sleep'.
// The three premium scenes (see PREMIUM_SCENE_LIST) are all deliberately
// calm, glowy backdrops -- no bursts, no jump-scare timing -- built with
// Sleep mode as a use case from the start, so all three are included here
// too, same as the free calm scenes.
// Safari included: a slow photo pan/zoom and a soft, walking-pace
// ambient track are exactly the low-arousal profile Sleep mode wants --
// same class of calm as Forest/Beach/Christmas, not Birthday/Halloween's
// deliberate higher energy.
const SLEEP_SAFE_SCENES = new Set(['space', 'forest', 'beach', 'christmas', 'aurora', 'reef', 'cavern', 'safari']);

function isSceneSleepSafe(scene) {
  return SLEEP_SAFE_SCENES.has(scene);
}

// The scenes actually available for selection/rotation right now -- every
// one of them outside Sleep mode, but only the calm subset while it's
// active (see SLEEP_SAFE_SCENES). 'space' being sleep-safe guarantees
// this is never empty.
function activeSceneList() {
  return STATE.difficulty === 'sleep' ? SCENE_LIST.filter(isSceneSleepSafe) : SCENE_LIST;
}

// Shared by resolveSceneForWave and catchUpAmbienceStreakForWave --
// besides which scene a given wave falls on, also returns that wave's
// 0-indexed position within its scene's own block (e.g. the 3rd wave of
// a Forest block returns blockPosition: 2). A fixed (non-Rotate)
// sceneMode never has a "block" to be positioned within, so it's always
// position 0 there.
function resolveSceneBlock(waveNumber) {
  const scenes = activeSceneList();
  if (STATE.sceneMode !== 'rotate') {
    // Premium scenes never enter activeSceneList/SCENE_LIST at all (see
    // PREMIUM_SCENE_LIST's own comment), so they need their own branch
    // here rather than falling into the `requested`/`scenes.includes`
    // check below, which would just always reject them. This is the real
    // enforcement backstop for "unpurchased scenes never actually play" --
    // ownership is re-checked fresh on every call, not cached, so it can't
    // be stale relative to a purchase that just happened, and a
    // STATE.sceneMode set directly (devtools, or a stale value from before
    // a purchase existed) can never play a scene that isn't owned right
    // now, regardless of what the dropdown (see refreshSceneSelector)
    // happens to be showing.
    if (PREMIUM_SCENE_LIST.includes(STATE.sceneMode)) {
      const allowed = isPremiumSceneOwned(STATE.sceneMode)
        && (STATE.difficulty !== 'sleep' || isSceneSleepSafe(STATE.sceneMode));
      return { scene: allowed ? STATE.sceneMode : 'space', blockPosition: 0 };
    }
    const requested = SCENE_LIST.includes(STATE.sceneMode) ? STATE.sceneMode : 'space';
    // A fixed pick that Sleep mode has ruled out (see SLEEP_SAFE_SCENES)
    // falls back to Space for the rest of this Sleep session, rather than
    // actually playing it -- the dropdown itself also disables picking it
    // in the first place (see refreshSceneSelector), but this is the
    // backstop that holds even if a player picked it under a different
    // difficulty and only switched to Sleep afterward, without touching
    // the scene dropdown again.
    const scene = scenes.includes(requested) ? requested : 'space';
    return { scene, blockPosition: 0 };
  }
  // Random package order (see mulberry32/newRotateSeed above) --
  // packages no longer sit at fixed positions in one repeating cycle, so
  // there's no modulo shortcut anymore: walk forward package by package,
  // deterministically re-rolling the same sequence from the same seed
  // every time, until the one containing waveNumber is reached. scenes is
  // never empty (see activeSceneList) and every package is at least 1
  // wave long (see sceneWaveCount), so `remaining` strictly decreases and
  // this always terminates -- the iteration cap is just a defensive
  // backstop, never expected to actually bite.
  const rand = mulberry32(STATE.rotateSeed);
  let previousScene = null;
  let remaining = waveNumber - 1;
  for (let guard = 0; guard < 100000; guard++) {
    const candidates = (previousScene !== null && scenes.length > 1)
      ? scenes.filter((s) => s !== previousScene) // never repeat the immediately previous package back to back
      : scenes;
    const scene = candidates[Math.floor(rand() * candidates.length)];
    previousScene = scene;
    const count = sceneWaveCount(scene);
    if (remaining < count) return { scene, blockPosition: remaining };
    remaining -= count;
  }
  return { scene: scenes[0], blockPosition: 0 }; // unreachable in practice -- see the guard's own comment
}

function resolveSceneForWave(waveNumber) {
  return resolveSceneBlock(waveNumber).scene;
}

// A normal, continuous playthrough always has STATE.ambienceStreak
// already exactly matching the new wave's blockPosition by the time this
// runs (every prior wave in the block completed in order, each revealing
// one more sound) -- so this is a no-op there. It only actually does
// anything right after a load/restart/session-start lands mid-block,
// where resetSceneAmbience zeroed the streak but resolveSceneBlock (pure
// arithmetic on the absolute wave number, no memory of that reset) still
// expects however many sounds a wave that far into the block should
// already have. Without this, loading into the middle or end of a block
// could reveal only some of its sounds -- or none -- before Rotate moves
// the scene on regardless, since the scene switch itself only cares
// about the absolute wave number, not the streak. Silently backfills
// (starts each not-yet-playing layer immediately) rather than routing
// through the normal per-wave reveal, and deliberately skips the
// completion toast -- resuming into an already-complete set isn't a
// moment a player just earned.
function catchUpAmbienceStreakForWave(waveNumber) {
  const config = SCENE_AMBIENT_CONFIG[STATE.scene];
  if (!config) return;
  const { blockPosition } = resolveSceneBlock(waveNumber);
  const shouldAlreadyBeRevealed = Math.min(blockPosition, config.order.length);
  while (STATE.ambienceStreak < shouldAlreadyBeRevealed) {
    STATE.ambienceStreak++;
    startSceneAmbienceLayer(STATE.scene, config.order[STATE.ambienceStreak - 1]);
  }
}

// ------------------------------------------------------------
// COCKPIT MODE
//
// A third way to play the same wave progression as classic/Flight Mode
// (same pair-count-by-wave scaling and color palette, see
// getPairCountForWave/INSTRUMENTS) -- a genuinely 3D, first-person view,
// piloted with a virtual joystick, flying through pairs of colored dots
// scattered in open space. Rendered with Three.js into its own overlay
// canvas (#cockpitCanvas) rather than the 2D board -- see render()'s
// cockpitMode branch, which skips the classic canvas entirely while a
// cockpit wave is active. Reuses the same union-find/scoring/wave-complete
// plumbing as classic mode (ufUnion, markGroupIfFullySolved,
// checkWaveComplete) since none of that cares about dot geometry, only
// dot ids -- see completeCockpitConnection.
//
// Simplifications versus classic/Flight Mode, deliberate for this first
// version: every color has exactly one pair (no 3+-dot groups), there are
// no barriers or portals, and the only rejection rule is flying back
// through a line already drawn (the 3D equivalent of "a line can't cross
// another line") -- true 3D barrier/crossing geometry is a substantially
// bigger problem than this first pass is trying to solve.
// ------------------------------------------------------------
const COCKPIT_CONFIG = {
  DOT_FIELD_RADIUS: 260,      // dots are scattered within this radius of the origin
  MIN_DOT_SPACING: 55,        // rejection-sampling floor between any two dot centers
  DOT_RADIUS: 9,               // sphere radius, world units
  HIT_RADIUS: 20,              // ship-to-dot distance that counts as "flew through it"
  LINE_HIT_RADIUS: 10,         // ship-to-other-line distance that breaks an in-progress connection
  TURN_RATE: 0.0225,           // radians/frame of yaw/pitch change at full joystick deflection --
                                 // halved from 0.045 (player report, round 3: steering specifically,
                                 // not throttle, was still too sensitive -- CONTROL_SMOOTHING below
                                 // only softens how fast input ramps up, not the top turn speed itself)
  MAX_PITCH: 1.5,              // radians, just under +/-90 degrees so the ship can never flip over
  CONTROL_SMOOTHING: 0.09,     // how fast the effective throttle/turn chases the raw input each frame
                                // (1 = instant, lower = smoother/slower) -- without this, small stick
                                // jitter or overcorrection translated 1:1 into yaw/pitch/thrust every
                                // single frame, which read as far too sensitive (player report). Lowered
                                // from the initial 0.18 -- still too sensitive at that value (player
                                // report, round 2) -- roughly doubles the ramp-up time to full response
  ACCEL: 0.06,                  // world units/frame^2 of thrust at full throttle
  DRAG: 0.985,                  // per-frame velocity retention -- close to 1 so the ship genuinely
                                 // drifts on release rather than stopping, per the player's own request
  MAX_SPEED: 6,
  SHIP_START_DISTANCE: 1.4,    // multiple of DOT_FIELD_RADIUS the ship starts out from the field,
                                // looking back in toward it (yaw 0 / pitch 0 already faces -z)
  MAX_FLIGHT_DISTANCE: 2.2,    // multiple of DOT_FIELD_RADIUS the soft boundary holds the ship within
  STICK_MAX_RADIUS: 60,        // screen px a touch stick's knob travels from its anchor for full deflection
  STICK_DEAD_ZONE: 6,          // screen px before a touch stick registers any input
  MOUSE_STEER_RADIUS_FRACTION: 0.4, // fraction of min(canvas.width, canvas.height) that maps to full
                                     // steering deflection -- the whole screen acts as one big virtual
                                     // joystick centered on its middle, no click-and-drag required
  MOUSE_STEER_DEAD_ZONE: 12,   // screen px from center before mouse-position steering registers
  FOV_DEFAULT: 75,
  FOV_MIN: 40,                 // degrees -- most zoomed in
  FOV_MAX: 100,                // degrees -- most zoomed out
  FOV_KEY_STEP: 1.2,           // degrees/frame while a zoom key is held
  FOV_WHEEL_STEP: 0.05,        // degrees per wheel-delta unit
  WAYPOINT_IDLE_MS: 3000,      // Normal difficulty: no new connection this long shows the waypoint
                                // arrow -- Relaxed shows it always, Intense never (see
                                // updateCockpitWaypointArrow)
  WAYPOINT_ANGLE_SMOOTHING: 0.12, // per-frame chase rate for the edge-compass arrow's angle, only
                                    // used while the target is off-screen (see updateCockpitWaypointArrow)
  WAYPOINT_MARKER_EDGE_MARGIN: 44, // px kept clear of every viewport edge for the on-screen waypoint
                                     // marker -- covers its own ~34px height plus the 26px it's
                                     // offset above the target, so it can never render partially or
                                     // fully off-screen (review, #49)
  CONNECTION_STARS_PER_DOT: 20,     // mirrors classic mode's STARFIELD_CONFIG.STARS_PER_CONNECTION/2 --
                                     // no ambient background starfield here (see review feedback: it
                                     // read as a field of connectable objects) -- only a sparse halo
                                     // around each completed connection's two dots, same as classic
  CONNECTION_STAR_SCATTER_RADIUS: 35, // world units around each dot the halo scatters within
  CONNECTION_STAR_SIZE: 3,
  LINE_TUBE_RADIUS: 1.8,       // world units -- real geometry, not a WebGL line-width hint (which
                                // GL clamps to ~1px on most drivers regardless of what you ask for,
                                // exactly why the original LineBasicMaterial lines were nearly
                                // invisible -- see review feedback)
  SCORE_PER_LINE_UNIT: 4,      // 3D world units are much smaller than 2D screen pixels -- scaled up
                                // so a typical connection's score feels comparable to classic mode
  REVEAL_DISTANCE_MULTIPLIER: 2.0, // multiple of DOT_FIELD_RADIUS the ship eases back to for the
                                     // wave-complete reveal -- far enough to frame the whole finished
                                     // constellation inside COCKPIT_CONFIG.FOV_DEFAULT
  REVEAL_EASE: 0.045,           // per-frame chase rate for the wave-complete pull-back/look-back --
                                  // slower than CONTROL_SMOOTHING on purpose, this is a cinematic
                                  // camera move, not a control response
};

// Loaded lazily, not from a <script> tag -- most players will never touch
// Cockpit Mode, and this keeps the deploy pipeline (deploy-pages.yml's
// explicit file allowlist) untouched, since nothing new needs to ship in
// _site. Kicked off as soon as the title-screen checkbox is checked (see
// setupTitleLoadListeners) so it's very likely already resolved by the
// time a wave actually starts.
let THREE_LIB = null;
let threeLoadPromise = null;
function ensureThreeLoaded() {
  if (THREE_LIB) return Promise.resolve(THREE_LIB);
  if (!threeLoadPromise) {
    threeLoadPromise = import('https://unpkg.com/three@0.160.0/build/three.module.js')
      .then(mod => { THREE_LIB = mod; return mod; })
      .catch(e => {
        console.error('Failed to load Three.js for Cockpit Mode:', e);
        threeLoadPromise = null; // let the next attempt (e.g. next wave) retry rather than staying broken forever
        throw e;
      });
  }
  return threeLoadPromise;
}

// Three.js engine objects (renderer/scene/camera/meshes) live here, not on
// STATE -- STATE.dots etc. are plain data (and, elsewhere, get walked by
// code that has no reason to know Three.js exists), while these are
// WebGL resources with their own lifecycle (see teardownCockpitScene).
const COCKPIT = {
  renderer: null, scene: null, camera: null,
  dotMeshes: new Map(),    // dot.id -> THREE.Mesh
  lineObjects: [],         // THREE.Mesh (tube) per completed STATE.cockpitLines entry
  activeLineObject: null,  // THREE.Mesh (tube) for the connection currently being drawn, or null
  starGroups: [],          // THREE.Points, one per completed connection's two-dot halo (see
                            // spawnCockpitConnectionStars) -- no ambient background field
  starTexture: null,       // lazily-built soft circular sprite, shared by every star group
};

function noseDirection(yaw, pitch) {
  return {
    x: Math.sin(yaw) * Math.cos(pitch),
    y: Math.sin(pitch),
    z: -Math.cos(yaw) * Math.cos(pitch),
  };
}

function findValidCockpitPosition(existingDots) {
  for (let attempt = 0; attempt < 200; attempt++) {
    // Rejection-sample within a sphere (not a cube) so dots stay evenly
    // distributed in every direction instead of clumping toward corners.
    const r = COCKPIT_CONFIG.DOT_FIELD_RADIUS * Math.cbrt(Math.random());
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const pos = {
      x: r * Math.sin(phi) * Math.cos(theta),
      y: r * Math.sin(phi) * Math.sin(theta),
      z: r * Math.cos(phi),
    };
    const tooClose = existingDots.some(d => Math.hypot(pos.x - d.x, pos.y - d.y, pos.z - d.z) < COCKPIT_CONFIG.MIN_DOT_SPACING);
    if (!tooClose) return pos;
  }
  // Extremely unlikely (would need dozens of dots packed into this small a
  // volume) -- falls back to an unchecked random point rather than ever
  // failing wave generation outright.
  const spread = COCKPIT_CONFIG.DOT_FIELD_RADIUS;
  return { x: (Math.random() - 0.5) * spread, y: (Math.random() - 0.5) * spread, z: (Math.random() - 0.5) * spread };
}

function generateCockpitDots(waveNumber) {
  const pairCount = getPairCountForWave(waveNumber);
  const shuffledInstruments = shuffleArray([...Array(INSTRUMENTS.length).keys()]).slice(0, pairCount);
  const dots = [];
  let idCounter = 0;
  for (let pairId = 0; pairId < pairCount; pairId++) {
    const colorIndex = shuffledInstruments[pairId];
    for (let k = 0; k < 2; k++) {
      const pos = findValidCockpitPosition(dots);
      dots.push({
        id: idCounter++,
        x: pos.x, y: pos.y, z: pos.z,
        colorIndex, pairId,
        connected: false,
        pulsePhase: Math.random() * Math.PI * 2,
      });
    }
  }
  return dots;
}

// The stick's own DOM element (see index.html/#cockpit-left-stick,
// #cockpit-right-stick) is the fixed anchor, not wherever a touch first
// landed -- canvas-relative, same coordinate space getEventScreenPos uses,
// so a knob offset computed against this lines up with the visual exactly.
function cockpitStickAnchor(elId) {
  const rect = canvas.getBoundingClientRect();
  const stickRect = document.getElementById(elId).getBoundingClientRect();
  return {
    x: stickRect.left + stickRect.width / 2 - rect.left,
    y: stickRect.top + stickRect.height / 2 - rect.top,
  };
}

// Touch only -- desktop steers/throttles via keyboard+mouse instead (see
// handleCockpitKeyDown/handleCockpitMouseMove/Down/Up below). Two sticks
// tracked independently by touch identifier so both fingers can be down at
// once; which stick a new touch claims is decided by which half of the
// screen it landed in, matching the two fixed on-screen graphics.
function cockpitTouchStart(e) {
  const rect = canvas.getBoundingClientRect();
  for (const t of e.changedTouches) {
    const x = t.clientX - rect.left, y = t.clientY - rect.top;
    const isLeftHalf = x < canvas.width / 2;
    if (isLeftHalf && !STATE.cockpitLeftStick) {
      STATE.cockpitLeftStick = { touchId: t.identifier, curX: x, curY: y };
    } else if (!isLeftHalf && !STATE.cockpitRightStick) {
      STATE.cockpitRightStick = { touchId: t.identifier, curX: x, curY: y };
    }
  }
}

function cockpitTouchMove(e) {
  const rect = canvas.getBoundingClientRect();
  for (const t of e.changedTouches) {
    const x = t.clientX - rect.left, y = t.clientY - rect.top;
    if (STATE.cockpitLeftStick && STATE.cockpitLeftStick.touchId === t.identifier) {
      STATE.cockpitLeftStick.curX = x; STATE.cockpitLeftStick.curY = y;
    } else if (STATE.cockpitRightStick && STATE.cockpitRightStick.touchId === t.identifier) {
      STATE.cockpitRightStick.curX = x; STATE.cockpitRightStick.curY = y;
    }
  }
}

function cockpitTouchEnd(e) {
  for (const t of e.changedTouches) {
    if (STATE.cockpitLeftStick && STATE.cockpitLeftStick.touchId === t.identifier) STATE.cockpitLeftStick = null;
    if (STATE.cockpitRightStick && STATE.cockpitRightStick.touchId === t.identifier) STATE.cockpitRightStick = null;
  }
}

function isTouchCapableDevice() {
  return ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
}

// Called once per cockpit wave start (device capability doesn't change
// mid-session) -- the sticks are only ever meaningful on a touch device;
// desktop relies on WASD/arrows/mouse instead (see the player's own
// request: "see these controls on mobile, but not on PC").
function refreshCockpitControlVisibility() {
  const touch = isTouchCapableDevice();
  document.getElementById('cockpit-left-stick').classList.toggle('visible', touch);
  document.getElementById('cockpit-right-stick').classList.toggle('visible', touch);
}

// Moves each stick's knob graphic to track its actual current input, same
// clamp radius the physics itself uses (see computeCockpitThrottle/Turn) --
// called every render frame, independent of whether the Three.js scene has
// finished loading, so the controls are usable even during that brief gap.
function updateCockpitStickVisuals() {
  updateCockpitStickKnob('cockpit-left-stick', STATE.cockpitLeftStick);
  updateCockpitStickKnob('cockpit-right-stick', STATE.cockpitRightStick);
}

function updateCockpitStickKnob(stickElId, stickState) {
  const knob = document.getElementById(stickElId).querySelector('.cockpit-stick-knob');
  if (!stickState) {
    knob.style.transform = 'translate(0px, 0px)';
    return;
  }
  const anchor = cockpitStickAnchor(stickElId);
  let dx = stickState.curX - anchor.x;
  let dy = stickState.curY - anchor.y;
  const dist = Math.hypot(dx, dy);
  if (dist > COCKPIT_CONFIG.STICK_MAX_RADIUS) {
    const k = COCKPIT_CONFIG.STICK_MAX_RADIUS / dist;
    dx *= k; dy *= k;
  }
  knob.style.transform = `translate(${dx}px, ${dy}px)`;
}

function clampUnit(v) { return Math.max(-1, Math.min(1, v)); }

// Combines every active source (touch stick, keyboard, mouse) into one
// throttle value -1..1 -- summed then clamped, since a player only ever
// uses one device's worth of these at a time in practice, not fighting
// several simultaneously.
function computeCockpitThrottle() {
  let throttle = 0;
  const stick = STATE.cockpitLeftStick;
  if (stick) {
    const anchor = cockpitStickAnchor('cockpit-left-stick');
    const dy = anchor.y - stick.curY; // up = positive = accelerate
    if (Math.abs(dy) > COCKPIT_CONFIG.STICK_DEAD_ZONE) throttle += clampUnit(dy / COCKPIT_CONFIG.STICK_MAX_RADIUS);
  }
  if (STATE.cockpitKeys.up) throttle += 1;
  if (STATE.cockpitKeys.down) throttle -= 1;
  if (STATE.cockpitMouseButtons.right) throttle += 1;
  if (STATE.cockpitMouseButtons.left) throttle -= 1;
  return clampUnit(throttle);
}

// Same combining approach as computeCockpitThrottle, for the 2D steering
// vector (x = yaw, y = pitch) instead of a single throttle axis.
function computeCockpitTurn() {
  let tx = 0, ty = 0;
  const stick = STATE.cockpitRightStick;
  if (stick) {
    const anchor = cockpitStickAnchor('cockpit-right-stick');
    const dx = stick.curX - anchor.x, dy = stick.curY - anchor.y;
    if (Math.hypot(dx, dy) > COCKPIT_CONFIG.STICK_DEAD_ZONE) {
      tx += clampUnit(dx / COCKPIT_CONFIG.STICK_MAX_RADIUS);
      ty += clampUnit(dy / COCKPIT_CONFIG.STICK_MAX_RADIUS);
    }
  }
  if (STATE.cockpitKeys.a) tx -= 1;
  if (STATE.cockpitKeys.d) tx += 1;
  if (STATE.cockpitKeys.w) ty -= 1;
  if (STATE.cockpitKeys.s) ty += 1;
  if (STATE.cockpitMousePos) {
    const cx = canvas.width / 2, cy = canvas.height / 2;
    const dx = STATE.cockpitMousePos.x - cx, dy = STATE.cockpitMousePos.y - cy;
    const radius = Math.min(canvas.width, canvas.height) * COCKPIT_CONFIG.MOUSE_STEER_RADIUS_FRACTION;
    if (Math.hypot(dx, dy) > COCKPIT_CONFIG.MOUSE_STEER_DEAD_ZONE) {
      tx += clampUnit(dx / radius);
      ty += clampUnit(dy / radius);
    }
  }
  return { x: clampUnit(tx), y: clampUnit(ty) };
}

function handleCockpitKeyDown(e) {
  if (!STATE.cockpitMode || STATE.phase !== 'PLAYING' || STATE.paused) return;
  switch (e.key) {
    case 'w': case 'W': STATE.cockpitKeys.w = true; break;
    case 'a': case 'A': STATE.cockpitKeys.a = true; break;
    case 's': case 'S': STATE.cockpitKeys.s = true; break;
    case 'd': case 'D': STATE.cockpitKeys.d = true; break;
    case 'ArrowUp': STATE.cockpitKeys.up = true; e.preventDefault(); break;
    case 'ArrowDown': STATE.cockpitKeys.down = true; e.preventDefault(); break;
    case 'ArrowLeft': STATE.cockpitKeys.zoomOut = true; e.preventDefault(); break;
    case 'ArrowRight': STATE.cockpitKeys.zoomIn = true; e.preventDefault(); break;
    default: return;
  }
}

function handleCockpitKeyUp(e) {
  if (!STATE.cockpitMode) return; // always clear on keyup regardless of phase -- a key released mid-pause must not stick
  switch (e.key) {
    case 'w': case 'W': STATE.cockpitKeys.w = false; break;
    case 'a': case 'A': STATE.cockpitKeys.a = false; break;
    case 's': case 'S': STATE.cockpitKeys.s = false; break;
    case 'd': case 'D': STATE.cockpitKeys.d = false; break;
    case 'ArrowUp': STATE.cockpitKeys.up = false; break;
    case 'ArrowDown': STATE.cockpitKeys.down = false; break;
    case 'ArrowLeft': STATE.cockpitKeys.zoomOut = false; break;
    case 'ArrowRight': STATE.cockpitKeys.zoomIn = false; break;
  }
}

function handleCockpitMouseMove(e) {
  if (!STATE.cockpitMode || STATE.phase !== 'PLAYING') return;
  const rect = canvas.getBoundingClientRect();
  STATE.cockpitMousePos = { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

function handleCockpitMouseDown(e) {
  if (!STATE.cockpitMode || STATE.phase !== 'PLAYING' || STATE.paused) return;
  if (e.button === 0) STATE.cockpitMouseButtons.left = true;
  else if (e.button === 2) { STATE.cockpitMouseButtons.right = true; e.preventDefault(); } // suppress the context menu
}

function handleCockpitMouseUp(e) {
  if (!STATE.cockpitMode) return; // always clear regardless of phase -- same reasoning as handleCockpitKeyUp
  if (e.button === 0) STATE.cockpitMouseButtons.left = false;
  else if (e.button === 2) STATE.cockpitMouseButtons.right = false;
}

function updateCockpitZoom() {
  if (!STATE.cockpitMode || STATE.phase !== 'PLAYING' || STATE.cockpitFov == null) return;
  if (STATE.cockpitKeys.zoomIn) STATE.cockpitFov -= COCKPIT_CONFIG.FOV_KEY_STEP;
  if (STATE.cockpitKeys.zoomOut) STATE.cockpitFov += COCKPIT_CONFIG.FOV_KEY_STEP;
  STATE.cockpitFov = Math.max(COCKPIT_CONFIG.FOV_MIN, Math.min(COCKPIT_CONFIG.FOV_MAX, STATE.cockpitFov));
}

function cockpitPathLength(points) {
  let len = 0;
  for (let i = 1; i < points.length; i++) {
    len += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y, points[i].z - points[i - 1].z);
  }
  return len;
}

function completeCockpitConnection(dotA, dotB) {
  ufUnion(dotA.id, dotB.id);
  markGroupIfFullySolved(dotA.pairId);

  const scoreAwarded = Math.round(cockpitPathLength(STATE.cockpitPath) * COCKPIT_CONFIG.SCORE_PER_LINE_UNIT);
  STATE.cockpitLines.push({ pairId: dotA.pairId, colorIndex: dotA.colorIndex, points: STATE.cockpitPath });
  spawnCockpitConnectionStars(dotA, dotB);

  unmuteChunk(dotA.pairId);
  playConnectionChime(dotA.pairId);
  haptic('connect');

  STATE.score += scoreAwarded;
  updateWaveDisplay();
  STATE.cockpitLastProgressTime = performance.now(); // resets the Normal-difficulty waypoint arrow's idle delay

  STATE.cockpitActiveDot = null;
  STATE.cockpitPath = [];

  checkWaveComplete();
}

function rejectCockpitConnection() {
  haptic('reject');
  STATE.cockpitActiveDot = null;
  STATE.cockpitPath = [];
}

function cancelCockpitConnection() {
  STATE.cockpitActiveDot = null;
  STATE.cockpitPath = [];
}

// Mirrors updateShipDrawing's role in Flight Mode: the ship's own position
// each frame IS the line, not a separate pointer position (see
// completeCockpitConnection/cockpitPath).
function updateCockpitDrawing() {
  const ship = STATE.cockpitShip;
  if (!ship) return;

  if (!STATE.cockpitActiveDot) {
    for (const dot of STATE.dots) {
      if (dot.connected) continue;
      if (Math.hypot(ship.x - dot.x, ship.y - dot.y, ship.z - dot.z) <= COCKPIT_CONFIG.HIT_RADIUS) {
        STATE.cockpitActiveDot = dot;
        STATE.cockpitPath = [{ x: ship.x, y: ship.y, z: ship.z }];
        break;
      }
    }
    return;
  }

  const last = STATE.cockpitPath[STATE.cockpitPath.length - 1];
  if (Math.hypot(ship.x - last.x, ship.y - last.y, ship.z - last.z) >= 4) {
    STATE.cockpitPath.push({ x: ship.x, y: ship.y, z: ship.z });
  }

  // Flying back through an already-completed line breaks the connection in
  // progress -- the 3D equivalent of "a line can't cross another line"
  // (classic mode's actual segment-intersection barrier checks don't
  // translate to open 3D space; this is a proximity check instead).
  for (const line of STATE.cockpitLines) {
    for (const p of line.points) {
      if (Math.hypot(ship.x - p.x, ship.y - p.y, ship.z - p.z) <= COCKPIT_CONFIG.LINE_HIT_RADIUS) {
        rejectCockpitConnection();
        return;
      }
    }
  }

  for (const dot of STATE.dots) {
    if (dot.id === STATE.cockpitActiveDot.id) continue;
    if (Math.hypot(ship.x - dot.x, ship.y - dot.y, ship.z - dot.z) > COCKPIT_CONFIG.HIT_RADIUS) continue;

    if (dot.colorIndex !== STATE.cockpitActiveDot.colorIndex) {
      rejectCockpitConnection();
      return;
    }
    if (ufConnected(STATE.cockpitActiveDot.id, dot.id)) {
      cancelCockpitConnection(); // already linked -- nothing new this would add, same as classic mode
      return;
    }
    completeCockpitConnection(STATE.cockpitActiveDot, dot);
    return;
  }
}

function updateCockpitShip() {
  if (!STATE.cockpitMode || STATE.phase !== 'PLAYING' || !STATE.cockpitShip) return;
  const ship = STATE.cockpitShip;

  updateCockpitZoom();

  // Throttle (accelerate/decelerate) and steering direction are two
  // independent inputs now, not one combined joystick vector -- left
  // stick/up-down arrows/mouse buttons for throttle, right stick/WASD/
  // mouse position for direction (see computeCockpitThrottle/Turn and the
  // player's own request for this split).
  //
  // Both raw readings are eased toward rather than applied directly -- see
  // COCKPIT_CONFIG.CONTROL_SMOOTHING -- so a jittery stick or a snap
  // correction doesn't turn/thrust the ship by the same amount in a single
  // frame (player report: controls felt far too sensitive).
  const rawTurn = computeCockpitTurn();
  const smoothing = COCKPIT_CONFIG.CONTROL_SMOOTHING;
  STATE.cockpitTurnSmoothed.x += (rawTurn.x - STATE.cockpitTurnSmoothed.x) * smoothing;
  STATE.cockpitTurnSmoothed.y += (rawTurn.y - STATE.cockpitTurnSmoothed.y) * smoothing;
  const turn = STATE.cockpitTurnSmoothed;
  if (turn.x !== 0 || turn.y !== 0) {
    ship.yaw += turn.x * COCKPIT_CONFIG.TURN_RATE;
    ship.pitch = Math.max(-COCKPIT_CONFIG.MAX_PITCH, Math.min(COCKPIT_CONFIG.MAX_PITCH,
      ship.pitch - turn.y * COCKPIT_CONFIG.TURN_RATE));
  }

  const rawThrottle = computeCockpitThrottle();
  STATE.cockpitThrottleSmoothed += (rawThrottle - STATE.cockpitThrottleSmoothed) * smoothing;
  const throttle = STATE.cockpitThrottleSmoothed;
  if (Math.abs(throttle) > 0.001) {
    const dir = noseDirection(ship.yaw, ship.pitch);
    ship.vx += dir.x * COCKPIT_CONFIG.ACCEL * throttle;
    ship.vy += dir.y * COCKPIT_CONFIG.ACCEL * throttle;
    ship.vz += dir.z * COCKPIT_CONFIG.ACCEL * throttle;
  }

  // Drift, not a hard stop -- thrust only fires while a throttle input is
  // actively held past its dead zone (above); releasing it just removes
  // that input; existing velocity keeps carrying the ship forward, decaying
  // slowly via DRAG rather than snapping to zero.
  ship.vx *= COCKPIT_CONFIG.DRAG;
  ship.vy *= COCKPIT_CONFIG.DRAG;
  ship.vz *= COCKPIT_CONFIG.DRAG;
  const speed = Math.hypot(ship.vx, ship.vy, ship.vz);
  if (speed > COCKPIT_CONFIG.MAX_SPEED) {
    const k = COCKPIT_CONFIG.MAX_SPEED / speed;
    ship.vx *= k; ship.vy *= k; ship.vz *= k;
  }

  ship.x += ship.vx;
  ship.y += ship.vy;
  ship.z += ship.vz;

  // Soft boundary -- eases the ship back rather than a hard wall, so
  // drifting out this far never feels like slamming into glass.
  const distFromCenter = Math.hypot(ship.x, ship.y, ship.z);
  const maxDist = COCKPIT_CONFIG.DOT_FIELD_RADIUS * COCKPIT_CONFIG.MAX_FLIGHT_DISTANCE;
  if (distFromCenter > maxDist) {
    const k = maxDist / distFromCenter;
    ship.x *= k; ship.y *= k; ship.z *= k;
    ship.vx *= 0.5; ship.vy *= 0.5; ship.vz *= 0.5;
  }

  updateCockpitDrawing();
}

// The wave-complete payoff shot: instead of leaving the ship frozen exactly
// where the final connection landed (almost always embedded inside that
// dot's own sphere -- an ugly close-up, not a reward), ease it back along
// the direction it already happens to be from the field's center, out to a
// vantage point that frames the whole finished constellation, while turning
// to look back at it. Flight input is already ignored during WAVE_COMPLETE
// (see updateCockpitShip's own phase check), so this has the ship entirely
// to itself -- a guided camera move, not physics.
function updateCockpitWaveCompleteReveal() {
  if (!STATE.cockpitMode || !STATE.cockpitShip || STATE.phase !== 'WAVE_COMPLETE') return;
  const ship = STATE.cockpitShip;

  if (!STATE.cockpitRevealDir) {
    const dist = Math.hypot(ship.x, ship.y, ship.z);
    // A dead-center finish (dist ~0) has no meaningful outward direction to
    // pull back along -- fall back to slightly-above-level along the ship's
    // original start-facing axis, which reads better than a flat horizon.
    STATE.cockpitRevealDir = dist > 1
      ? { x: ship.x / dist, y: ship.y / dist, z: ship.z / dist }
      : { x: 0, y: 0.15, z: 1 };
  }
  const dir = STATE.cockpitRevealDir;
  const targetDist = COCKPIT_CONFIG.DOT_FIELD_RADIUS * COCKPIT_CONFIG.REVEAL_DISTANCE_MULTIPLIER;
  const rate = COCKPIT_CONFIG.REVEAL_EASE;

  ship.x += (dir.x * targetDist - ship.x) * rate;
  ship.y += (dir.y * targetDist - ship.y) * rate;
  ship.z += (dir.z * targetDist - ship.z) * rate;
  ship.vx = 0; ship.vy = 0; ship.vz = 0; // a guided shot, not drift

  // Look back at the origin -- noseDirection() inverted (see its own
  // comment for the yaw/pitch <-> direction convention).
  const len = Math.hypot(ship.x, ship.y, ship.z) || 1;
  const ndx = -ship.x / len, ndy = -ship.y / len, ndz = -ship.z / len;
  const targetPitch = Math.max(-COCKPIT_CONFIG.MAX_PITCH, Math.min(COCKPIT_CONFIG.MAX_PITCH, Math.asin(ndy)));
  const targetYaw = Math.atan2(ndx, -ndz);
  // Shortest-path yaw interpolation -- a plain lerp would spin the long way
  // around whenever the raw target/current angles straddle the +/-pi seam.
  let yawDiff = targetYaw - ship.yaw;
  while (yawDiff > Math.PI) yawDiff -= Math.PI * 2;
  while (yawDiff < -Math.PI) yawDiff += Math.PI * 2;
  ship.yaw += yawDiff * rate;
  ship.pitch += (targetPitch - ship.pitch) * rate;
}

// A soft round sprite for star points -- THREE.PointsMaterial with no map
// renders plain GL squares (the "stars look too large and perfectly
// square, like connectable objects" review feedback), not circles. Built
// once from a tiny canvas gradient and shared by every connection's star
// group, not regenerated per-connection.
function cockpitStarTexture() {
  if (COCKPIT.starTexture) return COCKPIT.starTexture;
  const THREE = THREE_LIB;
  const size = 32;
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const ctx2d = c.getContext('2d');
  const gradient = ctx2d.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.4, 'rgba(255,255,255,0.7)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx2d.fillStyle = gradient;
  ctx2d.fillRect(0, 0, size, size);
  COCKPIT.starTexture = new THREE.CanvasTexture(c);
  return COCKPIT.starTexture;
}

// No ambient background starfield (see review feedback: a full 3D field of
// bright squares read as a field of connectable objects, not decoration).
// Instead, a small sparse halo appears around each dot the instant its
// connection completes -- the direct 3D equivalent of classic mode's
// spawnStarsAroundDots, called from completeCockpitConnection the same way.
function spawnCockpitConnectionStars(dotA, dotB) {
  if (!COCKPIT.scene || !THREE_LIB) return; // scene not built yet (Three.js still loading) -- nothing to add to
  const THREE = THREE_LIB;
  const perDot = COCKPIT_CONFIG.CONNECTION_STARS_PER_DOT;
  const positions = new Float32Array(perDot * 2 * 3);
  let i = 0;
  for (const dot of [dotA, dotB]) {
    for (let k = 0; k < perDot; k++) {
      // Scattered within a small sphere around the dot, not just on its
      // surface -- same reasoning as findValidCockpitPosition's own r * cbrt.
      const r = COCKPIT_CONFIG.CONNECTION_STAR_SCATTER_RADIUS * Math.cbrt(Math.random());
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      positions[i++] = dot.x + r * Math.sin(phi) * Math.cos(theta);
      positions[i++] = dot.y + r * Math.sin(phi) * Math.sin(theta);
      positions[i++] = dot.z + r * Math.cos(phi);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    map: cockpitStarTexture(),
    color: 0xffffff,
    size: COCKPIT_CONFIG.CONNECTION_STAR_SIZE,
    sizeAttenuation: true,
    transparent: true,
    depthWrite: false,
  });
  const points = new THREE.Points(geometry, material);
  COCKPIT.scene.add(points);
  COCKPIT.starGroups.push(points);
}

function clearCockpitConnectionStars() {
  if (COCKPIT.scene) {
    for (const points of COCKPIT.starGroups) {
      COCKPIT.scene.remove(points);
      points.geometry.dispose();
      points.material.dispose();
    }
  }
  COCKPIT.starGroups = [];
}

function ensureCockpitScene() {
  if (COCKPIT.scene) return;
  const THREE = THREE_LIB;
  const canvasEl = document.getElementById('cockpitCanvas');
  COCKPIT.renderer = new THREE.WebGLRenderer({ canvas: canvasEl, antialias: true });
  COCKPIT.renderer.setSize(window.innerWidth, window.innerHeight);
  COCKPIT.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));

  COCKPIT.scene = new THREE.Scene();
  COCKPIT.camera = new THREE.PerspectiveCamera(COCKPIT_CONFIG.FOV_DEFAULT, window.innerWidth / window.innerHeight, 0.1, 4000);

  COCKPIT.scene.add(new THREE.AmbientLight(0xffffff, 0.7));
  const point = new THREE.PointLight(0xffffff, 0.6);
  point.position.set(0, 200, 200);
  COCKPIT.scene.add(point);
}

function buildCockpitDotMeshes() {
  const THREE = THREE_LIB;
  for (const mesh of COCKPIT.dotMeshes.values()) {
    COCKPIT.scene.remove(mesh);
    mesh.geometry.dispose();
    mesh.material.dispose();
  }
  COCKPIT.dotMeshes.clear();
  for (const dot of STATE.dots) {
    const geometry = new THREE.SphereGeometry(COCKPIT_CONFIG.DOT_RADIUS, 20, 20);
    const color = new THREE.Color(INSTRUMENTS[dot.colorIndex].hex);
    const material = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.6 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(dot.x, dot.y, dot.z);
    COCKPIT.scene.add(mesh);
    COCKPIT.dotMeshes.set(dot.id, mesh);
  }
}

function threeVectorsFrom(points) {
  return points.map(p => new THREE_LIB.Vector3(p.x, p.y, p.z));
}

// A real tube mesh, not a THREE.Line -- WebGL clamps gl.LINE width to ~1px
// on most drivers regardless of LineBasicMaterial's linewidth property (a
// well-known Three.js/WebGL limitation, not a bug in this file), which is
// exactly why the original lines were "way too thin and not very bright"
// (review feedback). MeshBasicMaterial is unlit -- it renders at its exact
// color from every angle regardless of scene lighting, reading as a bright
// self-illuminated trail rather than something that dims when it's not
// facing a light.
function buildCockpitLineMesh(points, colorHex) {
  const THREE = THREE_LIB;
  const curve = new THREE.CatmullRomCurve3(threeVectorsFrom(points));
  const tubularSegments = Math.max(8, Math.min(64, points.length * 4));
  const geometry = new THREE.TubeGeometry(curve, tubularSegments, COCKPIT_CONFIG.LINE_TUBE_RADIUS, 6, false);
  const material = new THREE.MeshBasicMaterial({ color: new THREE.Color(colorHex) });
  return new THREE.Mesh(geometry, material);
}

function updateCockpitLineObjects() {
  // Completed lines: rebuilt only when the count changes -- cheap enough at
  // this scale (a handful of pairs per wave) and simplest to keep in sync
  // with STATE.cockpitLines without a separate dirty-tracking scheme.
  if (COCKPIT.lineObjects.length !== STATE.cockpitLines.length) {
    for (const obj of COCKPIT.lineObjects) { COCKPIT.scene.remove(obj); obj.geometry.dispose(); obj.material.dispose(); }
    COCKPIT.lineObjects = STATE.cockpitLines.map(line => {
      const obj = buildCockpitLineMesh(line.points, INSTRUMENTS[line.colorIndex].hex);
      COCKPIT.scene.add(obj);
      return obj;
    });
  }

  // The connection currently being drawn -- rebuilt every frame since it
  // grows continuously; fine at these point counts (a wave never
  // accumulates more than a few hundred).
  if (COCKPIT.activeLineObject) {
    COCKPIT.scene.remove(COCKPIT.activeLineObject);
    COCKPIT.activeLineObject.geometry.dispose();
    COCKPIT.activeLineObject.material.dispose();
    COCKPIT.activeLineObject = null;
  }
  if (STATE.cockpitActiveDot && STATE.cockpitPath.length > 1) {
    COCKPIT.activeLineObject = buildCockpitLineMesh(STATE.cockpitPath, INSTRUMENTS[STATE.cockpitActiveDot.colorIndex].hex);
    COCKPIT.scene.add(COCKPIT.activeLineObject);
  }
}

function renderCockpitScene() {
  if (!THREE_LIB || !COCKPIT.scene || !STATE.cockpitShip) return;
  const ship = STATE.cockpitShip;

  if (STATE.cockpitFov != null && COCKPIT.camera.fov !== STATE.cockpitFov) {
    COCKPIT.camera.fov = STATE.cockpitFov;
    COCKPIT.camera.updateProjectionMatrix();
  }

  COCKPIT.camera.position.set(ship.x, ship.y, ship.z);
  const dir = noseDirection(ship.yaw, ship.pitch);
  COCKPIT.camera.lookAt(ship.x + dir.x, ship.y + dir.y, ship.z + dir.z);
  // Bank into turns -- purely visual (recomputed from scratch every frame,
  // so it never accumulates), proportional to the current steering input's
  // yaw component, from whichever source (stick/WASD/mouse) is active.
  // Uses the smoothed turn (see CONTROL_SMOOTHING/updateCockpitShip), not
  // the raw reading -- the actual heading change was already smoothed, but
  // this bank still jittered instantly with every bit of raw stick noise,
  // shaking the whole view (and the waypoint arrow, which reads this same
  // camera orientation) independent of that fix (player report).
  COCKPIT.camera.rotateZ(-STATE.cockpitTurnSmoothed.x * 0.4);

  updateCockpitLineObjects();

  COCKPIT.renderer.render(COCKPIT.scene, COCKPIT.camera);
}

// The dot the waypoint arrow should point toward: the match for whichever
// connection is currently in progress, or the nearest unconnected dot if
// none is. Mirrors what a player is actually trying to reach in either
// case, not just "closest thing" regardless of context.
function cockpitWaypointTarget() {
  if (STATE.cockpitActiveDot) {
    return STATE.dots.find(d => d.pairId === STATE.cockpitActiveDot.pairId
      && d.id !== STATE.cockpitActiveDot.id && !d.connected) || null;
  }
  let nearest = null, nearestDist = Infinity;
  const ship = STATE.cockpitShip;
  for (const dot of STATE.dots) {
    if (dot.connected) continue;
    const dist = Math.hypot(ship.x - dot.x, ship.y - dot.y, ship.z - dot.z);
    if (dist < nearestDist) { nearestDist = dist; nearest = dot; }
  }
  return nearest;
}

// Two modes, depending on whether the target is actually visible:
//  - On-screen: a marker glued to the target's own real projected position,
//    hovering just above it and pointing straight down -- previously this
//    always sat at the screen edge instead, rotated by a compass angle, so
//    even a target dead-center on screen got an arrow off at the margin
//    that only vaguely gestured toward it (player report: "it's like the
//    arrows are only tied to the screen [rather than the object]").
//  - Off-screen (or behind the ship): the original compass-style edge
//    arrow, angle-smoothed (see COCKPIT_CONFIG.WAYPOINT_ANGLE_SMOOTHING)
//    so it sweeps rather than snaps frame to frame.
// Difficulty-gated per the player's own request: Relaxed always shows it,
// Normal only after COCKPIT_CONFIG.WAYPOINT_IDLE_MS without a new
// connection, Intense never.
function updateCockpitWaypointArrow() {
  const el = document.getElementById('cockpit-waypoint-arrow');
  if (!STATE.cockpitMode || !STATE.cockpitShip || STATE.difficulty === 'intense') {
    el.classList.remove('visible');
    STATE.cockpitWaypointAngle = null;
    STATE.cockpitWaypointTargetId = null;
    return;
  }
  const dueToIdle = QOL_DIFFICULTIES.has(STATE.difficulty)
    || (performance.now() - STATE.cockpitLastProgressTime >= COCKPIT_CONFIG.WAYPOINT_IDLE_MS);
  if (!dueToIdle) {
    el.classList.remove('visible');
    STATE.cockpitWaypointAngle = null;
    STATE.cockpitWaypointTargetId = null;
    return;
  }
  const target = cockpitWaypointTarget();
  if (!target || !THREE_LIB || !COCKPIT.camera) {
    el.classList.remove('visible');
    STATE.cockpitWaypointAngle = null;
    STATE.cockpitWaypointTargetId = null;
    return;
  }
  // The target's identity, not just whether it's currently null, has to
  // reset the smoothed edge angle -- otherwise a target swap (the active
  // connection's match changes, or "nearest unconnected" flips to a
  // different dot) while both the old and new targets stay off-screen the
  // whole time never hits the on-screen branch's own reset below, so the
  // arrow instantly recolors to the new target but keeps sweeping from the
  // old one's stale direction (review, #49).
  if (STATE.cockpitWaypointTargetId !== target.id) {
    STATE.cockpitWaypointAngle = null;
    STATE.cockpitWaypointTargetId = target.id;
  }

  const THREE = THREE_LIB;
  const ship = STATE.cockpitShip;
  const color = INSTRUMENTS[target.colorIndex].hex;
  el.style.color = color;
  el.style.textShadow = `0 0 14px ${color}`;

  const toTarget = new THREE.Vector3(target.x - ship.x, target.y - ship.y, target.z - ship.z);
  const local = toTarget.clone().applyQuaternion(COCKPIT.camera.quaternion.clone().invert());
  // local.z < 0 is "in front of the camera" -- noseDirection's own
  // convention (the ship faces -z at yaw=0/pitch=0), which the camera's
  // orientation always matches (see renderCockpitScene).
  const inFront = local.z < 0;
  const ndc = new THREE.Vector3(target.x, target.y, target.z).project(COCKPIT.camera);
  const onScreen = inFront && Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1;

  if (onScreen) {
    const px = (ndc.x * 0.5 + 0.5) * window.innerWidth;
    const py = (1 - (ndc.y * 0.5 + 0.5)) * window.innerHeight;
    // Clamped so the marker's own rendered footprint (a 34px-tall glyph,
    // itself offset another 26px above the target) never goes off-edge --
    // an unclamped target within ~9px of the top edge rendered the whole
    // marker off-screen with nothing else shown either, since the onScreen
    // test above only checks the target's own NDC position, not this
    // element's footprint around it (review, #49).
    const margin = COCKPIT_CONFIG.WAYPOINT_MARKER_EDGE_MARGIN;
    const clampedPx = Math.min(Math.max(px, margin), window.innerWidth - margin);
    const clampedPy = Math.min(Math.max(py, margin), window.innerHeight - margin);
    el.style.left = clampedPx + 'px';
    el.style.top = (clampedPy - 26) + 'px'; // hovering just above the target, pointing down at it
    el.style.transform = 'translate(-50%, -50%) rotate(180deg)';
    STATE.cockpitWaypointAngle = null; // re-enter edge mode fresh if it goes off-screen next
  } else {
    const rawAngle = Math.atan2(local.x, local.y); // 0 = target dead ahead-and-up, clockwise from there
    if (STATE.cockpitWaypointAngle == null) STATE.cockpitWaypointAngle = rawAngle;
    // Shortest-path smoothing -- a plain lerp would sweep the long way
    // around whenever raw/current straddle the +/-pi seam.
    let diff = rawAngle - STATE.cockpitWaypointAngle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    STATE.cockpitWaypointAngle += diff * COCKPIT_CONFIG.WAYPOINT_ANGLE_SMOOTHING;
    const angle = STATE.cockpitWaypointAngle;

    const cx = window.innerWidth / 2, cy = window.innerHeight / 2;
    const edgeRadius = Math.min(window.innerWidth, window.innerHeight) * 0.42;
    el.style.left = (cx + Math.sin(angle) * edgeRadius) + 'px';
    el.style.top = (cy - Math.cos(angle) * edgeRadius) + 'px';
    el.style.transform = `translate(-50%, -50%) rotate(${angle}rad)`;
  }
  el.classList.add('visible');
}

// Unlike the waypoint arrow above, this isn't a difficulty-gated hint -- it's
// baseline feedback that a connection is in progress at all. In cockpit mode
// the dot/line you're dragging from is easy to lose behind the ship while
// flying forward past it, so without this the player has no on-screen
// confirmation they're still connected (player report, post-#45 playtest).
function updateCockpitConnectionStatus() {
  const el = document.getElementById('cockpit-connection-status');
  if (!STATE.cockpitMode || !STATE.cockpitActiveDot) {
    el.classList.remove('visible');
    return;
  }
  const color = INSTRUMENTS[STATE.cockpitActiveDot.colorIndex].hex;
  el.style.color = color;
  // #top-buttons-row can wrap to a second line on narrow viewports (see its
  // own comment) -- clear whatever it's actually rendering as right now
  // instead of a fixed offset sized for one line, or the badge lands on top
  // of the wrapped row instead of below it (review, #46).
  const overlayBottom = document.getElementById('ui-overlay').getBoundingClientRect().bottom;
  el.style.top = Math.max(16, overlayBottom + 8) + 'px';
  el.classList.add('visible');
}

function teardownCockpitScene() {
  // COCKPIT.scene itself is retained (ensureCockpitScene reuses it across
  // waves/sessions), so disposing an object's GPU buffers is not enough on
  // its own -- it has to be removed from the scene graph too, or it stays
  // there, traversed and rendered (now with disposed/invalid buffers)
  // alongside whatever the next session builds (review, #44).
  if (COCKPIT.scene && THREE_LIB) {
    for (const mesh of COCKPIT.dotMeshes.values()) {
      COCKPIT.scene.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    for (const obj of COCKPIT.lineObjects) {
      COCKPIT.scene.remove(obj);
      obj.geometry.dispose();
      obj.material.dispose();
    }
    if (COCKPIT.activeLineObject) {
      COCKPIT.scene.remove(COCKPIT.activeLineObject);
      COCKPIT.activeLineObject.geometry.dispose();
      COCKPIT.activeLineObject.material.dispose();
    }
  }
  COCKPIT.dotMeshes.clear();
  COCKPIT.lineObjects = [];
  COCKPIT.activeLineObject = null;
  clearCockpitConnectionStars();
  document.getElementById('cockpitCanvas').classList.remove('visible');
  document.getElementById('cockpit-left-stick').classList.remove('visible');
  document.getElementById('cockpit-right-stick').classList.remove('visible');
  document.getElementById('cockpit-waypoint-arrow').classList.remove('visible');
  document.getElementById('cockpit-connection-status').classList.remove('visible');
}

function startCockpitWave(waveNumber) {
  STATE.dots = generateCockpitDots(waveNumber);
  STATE.cockpitShip = {
    x: 0, y: 0, z: COCKPIT_CONFIG.DOT_FIELD_RADIUS * COCKPIT_CONFIG.SHIP_START_DISTANCE,
    vx: 0, vy: 0, vz: 0,
    yaw: 0, pitch: 0, // already faces -z, i.e. back in toward the dot field centered on the origin
  };
  if (STATE.cockpitFov == null) STATE.cockpitFov = COCKPIT_CONFIG.FOV_DEFAULT; // a zoom preference, not
                                                                                 // per-wave state -- only
                                                                                 // defaulted once, then
                                                                                 // left alone across waves
  STATE.cockpitLeftStick = null;
  STATE.cockpitRightStick = null;
  STATE.cockpitKeys = { w: false, a: false, s: false, d: false, up: false, down: false, zoomIn: false, zoomOut: false };
  STATE.cockpitMouseButtons = { left: false, right: false };
  STATE.cockpitThrottleSmoothed = 0;
  STATE.cockpitTurnSmoothed = { x: 0, y: 0 };
  STATE.cockpitRevealDir = null;
  STATE.cockpitWaypointAngle = null;
  STATE.cockpitWaypointTargetId = null;
  STATE.cockpitActiveDot = null;
  STATE.cockpitPath = [];
  STATE.cockpitLines = [];
  clearCockpitConnectionStars(); // a new wave's connections haven't happened yet -- no halo carries over
  STATE.cockpitLastProgressTime = performance.now();
  refreshCockpitControlVisibility();
  document.getElementById('cockpitCanvas').classList.add('visible');

  ensureThreeLoaded().then(() => {
    // A mode switch or exit-to-title could easily land before this
    // resolves -- only build the scene if Cockpit Mode is still current.
    // buildCockpitDotMeshes reads STATE.dots live, so even a wave advance
    // in the meantime still builds the right (current) dots, not stale ones.
    if (!STATE.cockpitMode || !STATE.cockpitShip) return;
    ensureCockpitScene();
    buildCockpitDotMeshes();
  }).catch(() => { handleCockpitLoadFailure(); });
}

// Three.js genuinely failing to load (network issue, ad blocker, CDN
// outage) would otherwise leave the player on a permanent black screen
// (#cockpitCanvas made visible synchronously above, before this could ever
// resolve) with an invisible, still-running simulation behind it -- the
// ship keeps flying, dots keep being generated, none of it ever rendered.
// Bailing out to the title screen with an explanation is a far less
// confusing failure than that (review, #44). Also turns the persisted
// setting off, since silently retrying and failing again next launch would
// just repeat the same dead end -- the player can always re-check the box.
function handleCockpitLoadFailure() {
  if (!STATE.cockpitMode || !STATE.cockpitShip) return; // already left before this rejected
  STATE.cockpitMode = false;
  saveCockpitModeSetting(false);
  exitToTitle();
  document.getElementById('message-subtitle').textContent =
    "Couldn't load Cockpit Mode (check your connection) — try again later, or play another mode.";
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
  // Sleep mode already hides the score for the same reason (player
  // request: a competitive stimulus works against winding down) -- the
  // achievement toast (box + playAchievementJingle) is exactly that same
  // stimulus, milestone-cleared/high-score bragging with a fanfare, so it
  // gets the same treatment. Per-line connection praise
  // (spawnConnectionPraise) is a separate system and stays on -- it's
  // reward for the line just drawn, not a running competitive tally.
  if (STATE.difficulty === 'sleep') return;
  STATE.achievementQueue.push(entry);
  maybeShowNextAchievement();
}

// Shared by both progress-based achievements below (New Highest Wave, Best
// Wave Score) -- their underlying stats always track from wave 1, but the
// celebratory toast+sound wait until it's meaningful. Same wave-10
// threshold the Save Game tip uses.
const EARLY_ACHIEVEMENT_GATE_WAVE = 10;

// Checks all three milestone types against this wave's result and queues
// a toast for each one earned. Called once per completed wave. Returns the
// entries actually earned this call (queueAchievement's own shift-on-push
// behavior means the queue array itself can't reliably be diffed
// before/after -- see checkWaveComplete's postcard-eligibility check,
// the one caller that needs to know what was earned, not just that
// something was queued).
function checkAchievements(waveScore) {
  const earned = [];
  if (STATE.wave % 10 === 0) {
    const tier = milestoneTierForWave(STATE.wave);
    const entry = { glyph: tier.glyph, bg: tier.bg, glow: tier.glow, label: `Wave ${STATE.wave} Cleared` };
    queueAchievement(entry);
    earned.push(entry);
  }
  if (STATE.wave > STATE.stats.bestWave) {
    STATE.stats.bestWave = STATE.wave;
    saveStats(STATE.stats);
    if (STATE.wave >= EARLY_ACHIEVEMENT_GATE_WAVE) {
      const entry = {
        glyph: '🏆', // 🏆
        bg: 'radial-gradient(circle at 35% 30%, #ffe9a8, #d4a017)',
        glow: 'rgba(255,215,0,0.65)',
        label: 'New Highest Wave',
      };
      queueAchievement(entry);
      earned.push(entry);
    }
  }
  if (waveScore > STATE.stats.bestWaveScore) {
    STATE.stats.bestWaveScore = waveScore;
    saveStats(STATE.stats);
    if (STATE.wave >= EARLY_ACHIEVEMENT_GATE_WAVE) {
      const entry = {
        glyph: '⭐', // ⭐
        bg: 'radial-gradient(circle at 35% 30%, #cfe8ff, #5b8def)',
        glow: 'rgba(91,141,239,0.65)',
        label: 'Best Wave Score',
      };
      queueAchievement(entry);
      earned.push(entry);
    }
  }
  return earned;
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

// Single switch for every premium (paid-tier) music family, e.g.
// 'supperclub' below. The content itself always ships in the build --
// there's no separate paid download -- this just controls whether
// generateSong() is allowed to draw from it. Hardcoded true for now: the
// payment/entitlement backend (see MONETIZATION_ARCHITECTURE.md) doesn't
// exist yet, so there's no real purchase to gate on, and the plan is to
// let players hear the premium packs while they're new. Flip to false (or
// wire up a real per-player entitlement check) once that backend lands.
const PREMIUM_MUSIC_UNLOCKED = true;

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
  // First premium (paid-tier) family -- see PREMIUM_MUSIC_UNLOCKED, which
  // gates whether generateSong() may ever pick it. A brighter, more
  // upbeat supper-club/swing feel to contrast with spa/lofi's calm:
  // seventh chords, a swung eighth-note feel, trumpet lead over a walking
  // double bass. Both are real recorded instruments already sourced
  // alongside every other sample here (see SAMPLE_MANIFEST) that simply
  // had no genre using them until now.
  {
    name: 'supperclub',
    premium: true,
    chordVocabulary: 'seventh',
    groove: { swing: 0.18, hasDrumRole: false },
    seeds: [
      {
        name: 'blue room', bpm: 108, rootMidi: 58,
        scaleIntervals: [0, 2, 4, 5, 7, 9, 11],
        chordProgression: [0, 3, 4, 0],
        roles: [
          { kind: 'melody',   instrument: 'trumpet' },
          { kind: 'arpeggio', instrument: 'piano' },
          { kind: 'pad',      instrument: 'vibraphone' },
          { kind: 'drone',    instrument: 'doublebass' },
          { kind: 'accent',   instrument: 'marimba' },
          { kind: 'accent',   instrument: 'piano' },
        ],
      },
      {
        name: 'uptown strut', bpm: 116, rootMidi: 55,
        scaleIntervals: [0, 2, 4, 5, 7, 9, 11],
        chordProgression: [0, 5, 1, 4],
        roles: [
          { kind: 'melody',   instrument: 'trumpet' },
          { kind: 'arpeggio', instrument: 'vibraphone' },
          { kind: 'pad',      instrument: 'piano' },
          { kind: 'drone',    instrument: 'doublebass' },
          { kind: 'accent',   instrument: 'marimba' },
          { kind: 'accent',   instrument: 'trumpet' },
        ],
      },
      {
        name: 'velvet curtain', bpm: 100, rootMidi: 60,
        scaleIntervals: [0, 2, 4, 5, 7, 9, 11],
        chordProgression: [0, 4, 5, 3],
        roles: [
          { kind: 'melody',   instrument: 'trumpet' },
          { kind: 'arpeggio', instrument: 'piano' },
          { kind: 'pad',      instrument: 'marimba' },
          { kind: 'drone',    instrument: 'doublebass' },
          { kind: 'accent',   instrument: 'vibraphone' },
          { kind: 'accent',   instrument: 'trumpet' },
        ],
      },
    ],
  },
  // Sleep mode's only genre family (sleepOnly: true — see
  // availableGenreFamilies) — never selected outside Sleep difficulty, and
  // Sleep difficulty never selects anything else. Tempo (50-54 BPM) is
  // deliberately even slower than 'spa' (52-56), toward the low end of the
  // 60-80 BPM range sleep research associates with a calming effect, since
  // the goal here is actually falling asleep, not just relaxing.
  //
  // Every role is musicbox or vibraphone ONLY -- no cello (and, as
  // before, never flute/trumpet/piano/marimba/drums). This family
  // originally included cello, moved off the risky pad+drone-together
  // combination in an earlier fix (see git history: 9f2a3d1/654e8f6/
  // 34976c5), but a follow-up player report ("all of the lullabies...
  // yacht horn") made clear that containing cello's collision pattern
  // wasn't enough -- cello is a bowed, continuously-sustained real
  // recording, and every "sounds like a horn" complaint this game has
  // ever had (flute, originally; cello, twice) has been a continuous-tone
  // instrument, never a decay/mallet one. Vibraphone has been layered
  // into chords, drones, and simultaneous same-instrument roles all over
  // the spa family for as long as this game has existed with zero horn
  // reports; musicbox is synthesized (sine + soft overtone, see
  // synthesizeMusicboxNote) so it can't carry an acoustic recording
  // artifact at all. Dropping cello removes the failure mode at its root
  // instead of continuing to contain it seed by seed.
  {
    name: 'lullaby',
    chordVocabulary: 'triad',
    groove: { swing: 0, hasDrumRole: false },
    sleepOnly: true,
    seeds: [
      {
        name: 'drift off', bpm: 50, rootMidi: 60,
        scaleIntervals: [0, 2, 4, 5, 7, 9, 11], // Ionian (major) -- same fully-consonant choice as spa
        chordProgression: [0, 3, 0, 4],          // I - IV - I - V
        roles: [
          { kind: 'melody',   instrument: 'musicbox' },
          { kind: 'arpeggio', instrument: 'vibraphone' },
          { kind: 'pad',      instrument: 'vibraphone' },
          { kind: 'drone',    instrument: 'musicbox' },
          { kind: 'accent',   instrument: 'musicbox' },
          { kind: 'accent',   instrument: 'vibraphone' },
        ],
      },
      {
        name: 'starlight cradle', bpm: 54, rootMidi: 57,
        scaleIntervals: [0, 2, 4, 5, 7, 9, 11],
        chordProgression: [0, 5, 3, 4],          // I - vi - IV - V
        roles: [
          { kind: 'melody',   instrument: 'vibraphone' },
          { kind: 'arpeggio', instrument: 'musicbox' },
          { kind: 'pad',      instrument: 'musicbox' },
          { kind: 'drone',    instrument: 'vibraphone' },
          { kind: 'accent',   instrument: 'musicbox' },
          { kind: 'accent',   instrument: 'vibraphone' },
        ],
      },
      {
        name: 'quiet tide', bpm: 52, rootMidi: 55,
        scaleIntervals: [0, 2, 4, 5, 7, 9, 11],
        chordProgression: [0, 3, 4, 0],
        roles: [
          { kind: 'melody',   instrument: 'vibraphone' },
          { kind: 'arpeggio', instrument: 'musicbox' },
          { kind: 'pad',      instrument: 'vibraphone' },
          { kind: 'drone',    instrument: 'musicbox' },
          { kind: 'accent',   instrument: 'vibraphone' },
          { kind: 'accent',   instrument: 'musicbox' },
        ],
      },
    ],
  },
  // Halloween's own family (sceneOnly: 'halloween' -- see
  // availableGenreFamilies) -- every other scene draws a random genre
  // from the pool above with zero connection to what's on screen, which
  // is exactly why Halloween never actually sounded spooky: the same
  // bright major-key 'spa'/'lofi' material any other scene could roll.
  // The engine itself doesn't need anything new to sound eerie instead of
  // pleasant -- chord quality falls straight out of scaleIntervals, so
  // harmonic minor (a natural minor with a raised 7th) turns the exact
  // same triad/arpeggio/pad machinery every other family already uses
  // into minor i/iv chords against a major V, the classic "spooky
  // cadence" interval used across horror and Halloween-themed music, via
  // the augmented 2nd it creates between scale degrees 6 and 7. Kept to
  // the same real-recording instrument pool 'spa' uses (piano/flute/
  // cello/marimba/vibraphone) rather than anything synthesized, and keeps
  // flute/cello out of pad/drone roles -- both have a documented history
  // of reading as "a horn" when sustained continuously there (see
  // 'lullaby' family's own comment) -- in favor of marimba/vibraphone/
  // piano, already proven safe in those roles.
  {
    name: 'eerie',
    sceneOnly: 'halloween',
    chordVocabulary: 'triad',
    groove: { swing: 0, hasDrumRole: false },
    seeds: [
      {
        name: 'witching hour', bpm: 68, rootMidi: 57,
        scaleIntervals: [0, 2, 3, 5, 7, 8, 11], // harmonic minor
        chordProgression: [0, 3, 4, 0],          // i - iv - V - i
        roles: [
          { kind: 'melody',   instrument: 'flute' },
          { kind: 'arpeggio', instrument: 'piano' },
          { kind: 'pad',      instrument: 'vibraphone' },
          { kind: 'drone',    instrument: 'marimba' },
          { kind: 'accent',   instrument: 'marimba' },
          { kind: 'accent',   instrument: 'cello' },
        ],
      },
      {
        name: 'hollow trees', bpm: 64, rootMidi: 62,
        scaleIntervals: [0, 2, 3, 5, 7, 8, 11],
        chordProgression: [0, 5, 3, 4],          // i - VI - iv - V
        roles: [
          { kind: 'melody',   instrument: 'cello' },
          { kind: 'arpeggio', instrument: 'marimba' },
          { kind: 'pad',      instrument: 'piano' },
          { kind: 'drone',    instrument: 'vibraphone' },
          { kind: 'accent',   instrument: 'flute' },
          { kind: 'accent',   instrument: 'marimba' },
        ],
      },
      {
        name: 'crooked path', bpm: 72, rootMidi: 55,
        scaleIntervals: [0, 2, 3, 5, 7, 8, 11],
        chordProgression: [0, 4, 5, 3],          // i - V - VI - iv
        roles: [
          { kind: 'melody',   instrument: 'flute' },
          { kind: 'arpeggio', instrument: 'vibraphone' },
          { kind: 'pad',      instrument: 'marimba' },
          { kind: 'drone',    instrument: 'piano' },
          { kind: 'accent',   instrument: 'cello' },
          { kind: 'accent',   instrument: 'piano' },
        ],
      },
    ],
  },
  // Safari's own family (sceneOnly: 'safari' -- see availableGenreFamilies
  // and 'eerie' above, the exact precedent this follows) -- player request
  // (2026-08-16, same request that shipped the Safari scene's ambient
  // track): the INTERACTIVE gameplay music (this engine) is a completely
  // separate system from that ambient bed (SCENE_AMBIENT_CONFIG's
  // safari-song.mp3 etc.) -- every other scene draws its gameplay music
  // from a scene-blind random pool, so Safari's dot-connecting music
  // sounded like generic spa/lofi/supperclub material with zero
  // relationship to an African savanna. Built against the same brief as
  // the ambient track (95-115 BPM walking pace, warm consonant harmony,
  // kalimba/marimba-style plucked tones, warm bass, no brass/synth
  // leads): Mixolydian mode (a major scale with a flattened 7th) instead
  // of every other family's plain Ionian, for a lightly modal, "worldly"
  // color distinct from spa's straightforwardly major sound, while
  // staying fully consonant via the same triad vocabulary. Melody/
  // arpeggio/accent all play a new synthesized 'kalimba' voice (see
  // SYNTHESIZED_INSTRUMENTS/synthesizeKalimbaNote) -- no real kalimba
  // sample set was available to source cleanly, so this follows the
  // 'lofi'/'lullaby' families' own precedent of synthesizing a genuinely
  // new timbre rather than reassigning an existing recorded instrument
  // and hoping it reads as different. Pad is vibraphone and drone is
  // doublebass -- both already-sourced real recordings (see
  // SAMPLE_MANIFEST), doublebass specifically for the brief's own "warm,
  // rounded, not heavy sub" bass description. Deliberately does NOT use
  // the 'drum' role kind -- that role is hardwired to a fixed kick/snare/
  // hihat pattern shared with 'lofi' (see generateSong's own 'drum'
  // branch), not a generic pluggable kit, so a true hand-percussion feel
  // isn't available to this engine without changes far riskier than a
  // new scene-locked family warrants; a light swing on the groove
  // instead gives a looser, less machine-quantized feel without touching
  // that shared logic.
  {
    name: 'savanna',
    sceneOnly: 'safari',
    chordVocabulary: 'triad',
    groove: { swing: 0.15, hasDrumRole: false },
    seeds: [
      {
        name: 'sunrise trail', bpm: 98, rootMidi: 60,
        scaleIntervals: [0, 2, 4, 5, 7, 9, 10], // Mixolydian
        chordProgression: [0, 3, 0, 4],          // I - IV - I - v (flat-7 colors the v)
        roles: [
          { kind: 'melody',   instrument: 'kalimba' },
          { kind: 'arpeggio', instrument: 'kalimba' },
          { kind: 'pad',      instrument: 'vibraphone' },
          { kind: 'drone',    instrument: 'doublebass' },
          { kind: 'accent',   instrument: 'kalimba' },
          { kind: 'accent',   instrument: 'vibraphone' },
        ],
      },
      {
        name: 'acacia grove', bpm: 104, rootMidi: 57,
        scaleIntervals: [0, 2, 4, 5, 7, 9, 10],
        chordProgression: [0, 5, 3, 4],          // I - vi - IV - v
        roles: [
          { kind: 'melody',   instrument: 'kalimba' },
          { kind: 'arpeggio', instrument: 'kalimba' },
          { kind: 'pad',      instrument: 'vibraphone' },
          { kind: 'drone',    instrument: 'doublebass' },
          { kind: 'accent',   instrument: 'vibraphone' },
          { kind: 'accent',   instrument: 'kalimba' },
        ],
      },
      {
        name: 'riverside drift', bpm: 110, rootMidi: 62,
        scaleIntervals: [0, 2, 4, 5, 7, 9, 10],
        chordProgression: [0, 3, 4, 0],          // I - IV - v - I
        roles: [
          { kind: 'melody',   instrument: 'kalimba' },
          { kind: 'arpeggio', instrument: 'kalimba' },
          { kind: 'pad',      instrument: 'vibraphone' },
          { kind: 'drone',    instrument: 'doublebass' },
          { kind: 'accent',   instrument: 'kalimba' },
          { kind: 'accent',   instrument: 'vibraphone' },
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

// Trumpet and double bass (below) were sourced alongside the rest of this
// manifest from the start but sat unused for years -- an earlier, more
// upbeat set of genres never got past a draft. They're the basis for the
// 'supperclub' premium family (see GENRE_FAMILIES/PREMIUM_MUSIC_UNLOCKED).
const SAMPLE_MANIFEST = {
  piano: ['A3', 'C4', 'E4', 'Ab4', 'C5', 'E5', 'Ab5', 'C6'],
  flute: ['B3', 'C4', 'Db4', 'D4', 'Eb4', 'E4', 'F4', 'Gb4', 'G4', 'Ab4', 'A4', 'Bb4', 'B4', 'C5', 'Db5', 'D5', 'Eb5', 'E5', 'F5', 'Gb5', 'G5', 'Ab5', 'A5', 'Bb5', 'C6', 'Db6', 'D6', 'Eb6', 'E6', 'F6', 'Gb6', 'G6', 'Ab6', 'A6', 'Bb6'],
  cello: ['D3', 'Eb3', 'E3', 'F3', 'Gb3', 'G3', 'Ab3', 'A3', 'Bb3', 'B3', 'C4', 'Db4', 'D4', 'Eb4', 'E4', 'F4', 'Gb4', 'G4', 'Ab4', 'A4', 'Bb4'],
  marimba: ['C3', 'Db3', 'D3', 'Eb3', 'E3', 'F3', 'Gb3', 'G3', 'Ab3', 'A3', 'Bb3', 'B3', 'C4', 'Db4', 'D4', 'Eb4', 'E4', 'F4', 'Gb4', 'G4', 'Ab4', 'A4', 'Bb4', 'B4', 'C5', 'Db5', 'D5', 'Eb5', 'E5', 'F5', 'Gb5', 'G5', 'Ab5', 'A5', 'Bb5', 'B5', 'C6'],
  vibraphone: ['C3', 'Db3', 'D3', 'Eb3', 'E3', 'F3', 'Gb3', 'G3', 'Ab3', 'A3', 'Bb3', 'B3', 'C4', 'Db4', 'D4', 'E4', 'F4', 'Gb4', 'G4', 'Ab4', 'A4', 'Bb4', 'B4', 'C5', 'Db5', 'D5', 'Eb5', 'E5', 'F5', 'Gb5', 'G5', 'Ab5', 'A5', 'Bb5', 'B5', 'C6'],
  trumpet: ['C4', 'Db4', 'D4', 'Eb4', 'E4', 'F4', 'Gb4', 'G4', 'Ab4', 'A4', 'Bb4', 'B4', 'C5', 'Db5', 'D5', 'Eb5', 'E5', 'F5', 'Gb5', 'G5', 'Ab5', 'A5', 'Bb5', 'B5'],
  doublebass: ['E1', 'F1', 'Gb1', 'G1', 'Ab1', 'A1', 'Bb1', 'B1', 'C2', 'Db2', 'D2', 'Eb2', 'E2', 'F2', 'Gb2', 'G2', 'Ab2', 'A2', 'Bb2', 'B2'],
  // Synthesized, not recorded — see SYNTHESIZED_INSTRUMENTS below. No
  // sourcing/licensing dependency: these are generated in-browser at
  // decode time from oscillators/noise, not fetched from sounds/.
  rhodes: ['C3', 'Eb3', 'G3', 'C4', 'Eb4', 'G4', 'C5', 'Eb5', 'G5'],
  lofibass: ['C1', 'Eb1', 'G1', 'C2', 'Eb2', 'G2'],
  lofikit: ['kick', 'snare', 'hihat'], // one-shots, not pitched notes — see the 'drum' role kind
  // Sleep mode's lullaby melody voice -- a soft music-box/celesta-style
  // tone (see synthesizeMusicboxNote). Chromatic across two octaves, not
  // sparse like rhodes' triad-only set, so a melody line lands close to
  // its real target with little pitch-shift (this instrument only ever
  // plays gentle, mid-register lullaby melodies -- it doesn't need
  // rhodes' wider spread across a busier multi-role arrangement).
  musicbox: ['C4', 'Db4', 'D4', 'Eb4', 'E4', 'F4', 'Gb4', 'G4', 'Ab4', 'A4', 'Bb4', 'B4', 'C5', 'Db5', 'D5', 'Eb5', 'E5', 'F5', 'Gb5', 'G5', 'Ab5', 'A5', 'Bb5', 'B5', 'C6'],
  // Safari's 'savanna' genre family's melody/arpeggio/accent voice (see
  // synthesizeKalimbaNote). Sparse (12 notes, roughly a major third
  // apart) rather than a full C3-C6 chromatic set like marimba's -- this
  // instrument is synthesized, not decoded from a fetched file, and
  // decodeAllSamples() renders every manifest entry for every
  // synthesized instrument up front for every session regardless of
  // which scene ends up selected (review catch, PR #93: a full 37-note
  // chromatic set would have meant 37 extra OfflineAudioContext renders,
  // and ~11MB of retained buffers, on every single player's startup,
  // including the vast majority who never see Safari at all). The
  // engine's existing nearest-sample/playbackRate pitch-shift fallback
  // (same mechanism every other instrument already relies on between
  // its own sampled notes) covers the gaps -- same sparse-is-fine
  // precedent as 'rhodes' (9 notes across 3 octaves for its own
  // melody/arpeggio/pad roles in 'lofi').
  kalimba: ['C3', 'E3', 'G3', 'Bb3', 'C4', 'E4', 'G4', 'Bb4', 'C5', 'E5', 'G5', 'C6'],
};

// Instruments with no recorded sample files at all — their "sample
// buffers" are synthesized at decode time (see synthesizeInstrumentSample)
// via a short OfflineAudioContext render instead of fetched and decoded.
// Slots into STATE.sampleBuffers exactly like a real decoded sample, so
// every downstream consumer (nearestSampleNote, playbackRate pitch-shift,
// gain compensation) works identically either way without needing to
// know the difference.
const SYNTHESIZED_INSTRUMENTS = new Set(['rhodes', 'lofibass', 'lofikit', 'musicbox', 'kalimba']);

// A kit's pieces (kick/snare/hihat) aren't different pitches of the same
// sound the way a melody instrument's notes are -- they're intentionally
// voiced at different relative loudnesses, same as a real drum mix (kick
// punchy and up front, hihat naturally sitting under it). Per-sample
// loudness normalization (see registerSampleGain) is right for correcting
// ACCIDENTAL note-to-note recording variance in a melody instrument, but
// applying it independently to each kit piece would erase that ON-PURPOSE
// balance -- the same mistake as flattening melody/pad/drone to one
// identical volume, just at the level of a drum kit instead of a scale
// role (review, #51). Kit instruments get one shared gain instead (see
// registerKitGain), anchored on their own loudest piece.
const DRUM_KIT_INSTRUMENTS = new Set(['lofikit']);

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

// Late-wave portals (issue #25): a paired teleport link that can bridge a
// dot deliberately sealed off by its own small enclosing barrier (see
// generatePortalPocket) back to the rest of the board. Drawing works as
// two separate hops joined at the pair, not one continuous magic
// teleporting drag -- drag the sealed dot to either portal (locks in as a
// STATE.portalThreads entry, not yet a real connection), then start a new
// drag from the OTHER portal to the dot's actual same-color match to
// finish the pair. Both hops are ordinary, fully continuous lines, so
// every existing crossing/stranding/scoring/rendering path handles them
// unchanged -- only the flood-fill reachability check needed to learn
// about the wormhole edge (see isReachableAround's portals parameter).
const PORTAL_CONFIG = {
  START_WAVE: 50,
  PROBABILITY: 0.4,      // per-eligible-wave odds of attempting a sealed pocket at all
  ENCLOSURE_RADIUS: 90,  // px from the sealed dot's center to each wall of its triangular enclosure
  HIT_RADIUS: 40,        // how close a drag has to land to register as touching a portal
  DOT_CLEARANCE: 60,     // keep the enclosure and the open-side portal this far from every other dot
  SCREEN_CLEARANCE: 20,
  GENERATION_ATTEMPTS: 12, // candidate dots / open-portal placements tried before giving up for the wave
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
  // "Help Me Fall Asleep": gentler than Relaxed on every axis, and the
  // preset values below are really just a backstop -- the real guarantee
  // is startWave skipping generateBarriersSafely entirely for this
  // difficulty (see there), so barriers/mazes/fact-boxes/portals can
  // never appear regardless of what this config alone would allow.
  // Infinity is safe here: every comparison against *_START_WAVE is
  // `wave < START_WAVE` / `wave >= START_WAVE` against a finite wave
  // number, so it simply never trips.
  sleep: {
    label: 'Sleep',
    pairsPerWaveIncrease: 999, // pair count barely grows across a realistic session
    groupStartWave: Infinity,   // always plain 2-dot pairs, never multi-dot groups
    groupWavesPerTier: 16,
    extraGroupChance: 0,
    barrierStartWave: Infinity,
    barrierWavesPerBarrier: 4,
    rotationStartWave: Infinity,
    rotationSpeedScale: 0,
  },
};

// Difficulties where the beginner/comfort-oriented QOL affordances (erase
// button, an always-on cockpit waypoint arrow, the match-dimming draw
// assist) are available. Sleep is at least as forgiving as Relaxed on
// every axis, so it gets every QOL affordance Relaxed does.
const QOL_DIFFICULTIES = new Set(['relaxed', 'sleep']);
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
  document.getElementById('flight-mode-checkbox').checked = STATE.flightMode;
  document.getElementById('cockpit-mode-checkbox').checked = STATE.cockpitMode;
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
  if (resume.rotateSeed) STATE.rotateSeed = resume.rotateSeed; // this save's own order, not whatever's currently in STATE
  STATE.safariVariant = resume.safariVariant || null; // this save's own day/night pick, not a leftover from earlier in this page session
  startWave(resume.wave);
}

// The explicit Start Game button's handler (setupTitleLoadListeners) --
// a plain tap/click anywhere on the title screen used to trigger this
// too (see onInputStart), but player feedback: that made it too easy to
// start a wave by accident while still looking over the title screen's
// own options (scene, difficulty, etc.), so starting now requires
// actually pressing the button.
function startGameFromTitle() {
  initAudio();
  hideMessage();
  // Start Game only resumes automatically when the player has opted into
  // that via the Auto Load Last Save checkbox -- otherwise it always
  // starts wave 1, same as if there were no save at all. An existing save
  // is still reachable through the explicit Load Game button (see
  // handleLoadGameFromTitle), just never picked up silently.
  if (STATE.autoLoadEnabled && STATE.pendingResume) {
    const resume = STATE.pendingResume;
    STATE.pendingResume = null;
    STATE.score = resume.score;
    if (resume.rotateSeed) STATE.rotateSeed = resume.rotateSeed; // this save's own order, not whatever's currently in STATE
    STATE.safariVariant = resume.safariVariant || null; // this save's own day/night pick, not a leftover from earlier in this page session
    startWave(resume.wave);
  } else {
    STATE.pendingResume = null;
    STATE.rotateSeed = newRotateSeed(); // a genuinely new playthrough gets its own random package order
    // Same reasoning as rotateSeed just above: a genuinely new playthrough
    // must not inherit whatever day/night pick (or mid-pan phase) was
    // still sitting in STATE from earlier in this page session -- without
    // this, a fresh Start Game landing on Safari again would silently
    // treat itself as "still the same block" (see generateSafariScene's
    // previousScene check) and keep the old variant instead of rerolling.
    STATE.safariScene = null;
    STATE.safariVariant = null;
    startWave(1);
  }
}

function setupTitleLoadListeners() {
  document.getElementById('title-load-button').addEventListener('click', handleLoadGameFromTitle);
  document.getElementById('start-game-button').addEventListener('click', startGameFromTitle);
  document.getElementById('autoload-checkbox').addEventListener('change', (e) => {
    STATE.autoLoadEnabled = e.target.checked;
    saveAutoLoadSetting(STATE.autoLoadEnabled);
    // Otherwise toggling the checkbox leaves whatever subtitle was set at
    // page load/exitToTitle in place, silently promising the opposite of
    // what Start Game is now actually about to do.
    document.getElementById('message-subtitle').textContent = titleSubtitleText();
  });
  document.getElementById('flight-mode-checkbox').addEventListener('change', (e) => {
    STATE.flightMode = e.target.checked;
    saveFlightModeSetting(STATE.flightMode);
    // Mutually exclusive with Cockpit Mode -- only one control scheme can
    // actually be piloting the next wave.
    if (STATE.flightMode && STATE.cockpitMode) {
      STATE.cockpitMode = false;
      saveCockpitModeSetting(false);
      document.getElementById('cockpit-mode-checkbox').checked = false;
    }
  });
  document.getElementById('cockpit-mode-checkbox').addEventListener('change', (e) => {
    STATE.cockpitMode = e.target.checked;
    saveCockpitModeSetting(STATE.cockpitMode);
    if (STATE.cockpitMode) {
      if (STATE.flightMode) {
        STATE.flightMode = false;
        saveFlightModeSetting(false);
        document.getElementById('flight-mode-checkbox').checked = false;
      }
      ensureThreeLoaded(); // fire-and-forget -- kicked off now so it's very likely ready by "Start Game"
    }
    refreshSceneSelector(); // Cockpit Mode disables the picker -- see its own comment
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
      refreshSceneSelector(); // Sleep mode disables non-sleep-safe options -- see its own comment
    });
  }
}

function refreshSceneSelector() {
  const select = document.getElementById('scene-selector');

  // A non-sleep-safe scene (e.g. Birthday) has no business being pickable
  // at all under Sleep mode (see SLEEP_SAFE_SCENES) -- 'rotate' stays
  // enabled regardless, since it already skips unsafe scenes on its own
  // (see activeSceneList) rather than needing to be disabled outright.
  const sleepModeActive = STATE.difficulty === 'sleep';

  // Disabling that option below doesn't clear a <select>'s existing
  // selection -- left alone, the dropdown would keep showing e.g.
  // "Birthday Party" while Sleep is active even though resolveSceneBlock
  // is silently falling back to Space underneath it (review catch, PR
  // #69). Reset the stored selection itself, to the same fallback
  // resolveSceneBlock already uses, so the displayed value and the
  // actual played scene never disagree.
  if (sleepModeActive && STATE.sceneMode !== 'rotate' && !isSceneSleepSafe(STATE.sceneMode)) {
    STATE.sceneMode = 'space';
    saveSceneSetting(STATE.sceneMode);
  }
  // Same reasoning, for ownership instead of sleep-safety: a premium scene
  // that's no longer owned (storage cleared, different device) shouldn't
  // stay the displayed selection just because it once was -- reset it to
  // Rotate rather than silently showing a locked scene as "selected" while
  // resolveSceneBlock is actually playing Space underneath it.
  if (PREMIUM_SCENE_LIST.includes(STATE.sceneMode) && !isPremiumSceneOwned(STATE.sceneMode)) {
    STATE.sceneMode = 'rotate';
    saveSceneSetting(STATE.sceneMode);
  }

  select.value = STATE.sceneMode;
  // Cockpit Mode renders its own Three.js scene (see render()'s cockpitMode
  // branch and startWave's early return for it) and never reads
  // STATE.scene -- a visible, enabled picker here would promise a setting
  // that silently does nothing all session. Disable it instead of hiding
  // it so the reason ("not available right now") stays discoverable.
  select.disabled = STATE.cockpitMode;
  select.title = STATE.cockpitMode ? "Not available in Cockpit Mode — its 3D view doesn't use this" : '';

  for (const option of select.options) {
    if (option.value === 'rotate') continue;
    // Premium options are gated on ownership first -- this is what a
    // player actually sees (locked padlock, disabled), while
    // resolveSceneBlock's ownership re-check above is what actually
    // prevents an unpurchased scene from playing even if this UI-layer
    // gate were somehow bypassed.
    if (PREMIUM_SCENE_LIST.includes(option.value)) {
      const owned = isPremiumSceneOwned(option.value);
      const sleepBlocked = sleepModeActive && !isSceneSleepSafe(option.value);
      option.disabled = !owned || sleepBlocked;
      option.textContent = owned ? PREMIUM_SCENE_NAMES[option.value] : `${PREMIUM_SCENE_NAMES[option.value]} 🔒`;
      option.title = !owned ? 'Purchase this pack in the Store to unlock' : (sleepBlocked ? 'Not available in Sleep mode' : '');
      continue;
    }
    const disable = sleepModeActive && !isSceneSleepSafe(option.value);
    option.disabled = disable;
    option.title = disable ? 'Not available in Sleep mode' : '';
  }
}

function setupSceneSelectorListeners() {
  document.getElementById('scene-selector').addEventListener('change', (e) => {
    STATE.sceneMode = e.target.value;
    saveSceneSetting(STATE.sceneMode);
  });
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
  blockingFlashes: [],  // [{ segments, startTime }] -- brief white flashes traced over a connection that
                         // just blocked a rejected attempt (see flashBlockingConnections/drawBlockingFlashes)
  eraseMode: false,     // Relaxed-difficulty only: while true, a tap targets an existing connection
                         // to erase instead of starting a new line (see ERASE_HIT_RADIUS/toggleEraseMode)
  eraseArmed: false,    // true between an erase-mode touchstart/mousedown and its matching release --
                         // the hit test itself waits for onInputEnd so a pinch's first finger can't
                         // erase a line it only grazed (see beginPinch)

  activeDot: null,     // The dot currently being dragged from
  currentPath: [],     // Points being drawn right now [{x, y}]
  isDrawing: false,
  smoothedCursor: { x: 0, y: 0 }, // low-pass-filtered pointer position, tracks raw input each move

  portals: null,          // { a: {x,y}, b: {x,y}, colorIndex, pairId } for this wave, or null --
                           // see PORTAL_CONFIG/generatePortalPocket. Neither side is a fixed
                           // "entry"/"exit"; either can be dragged to or from.
  portalThreads: [],       // Pending half-connections that touched one portal side and are waiting
                           // to be picked up from the other (see completePortalLeg/onInputStart) --
                           // { enteredSide: 'a'|'b', dotA, segments, points, length }
  activePortalThread: null, // The thread STATE.activeDot is currently continuing, if this drag
                             // started at a portal rather than a real dot -- see completeConnection's
                             // portalPrefix parameter. Only removed from portalThreads on success, so
                             // a rejected/cancelled second hop can just be retried from the portal.

  audioCtx: null,      // Created on first gesture
  beatInterval: null,  // setInterval reference for beat pulse
  beatTick: 0,         // Increments each beat

  song: null,          // Procedurally generated song for the current wave
  songScheduledFor: null, // the song object scheduleLoopingSong was last actually called with —
                           // lets scheduleCurrentSongOnceReady skip a redundant re-schedule of a
                           // song that's already playing (see its own comment)
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
  sampleGain: {},       // { piano: { A3: 1.4, ... }, flute: {...}, ... } — per-sample loudness
                         // normalization multiplier, computed once each buffer decodes (see
                         // computeAttackRms/sampleGainFor) so every real note plays at the same
                         // target loudness regardless of which instrument or pitch it is
  sampleBytesLoaded: false, // raw fetch finished (kicked off at page load)

  stars: [],           // Background starfield for the current wave — resets each wave
  spaceObjects: [],    // Drifting asteroids / comets / satellites
  spaceSpawnTimer: 0,
  celestialBodies: [], // 0-2 large planets/moons/a star, spawned once per wave-complete reveal

  sceneMode: 'rotate', // persisted (see SCENE_KEY) -- picked on the title screen: a fixed scene,
                        // or 'rotate' to work through SCENE_LIST in a random package order
  rotateSeed: 1,        // seeds Rotate mode's random package order (see mulberry32/newRotateSeed) --
                         // set for real in init() from the pending save's own seed, or freshly
                         // rolled if there isn't one; this placeholder is only ever read before that
  scene: 'space',       // this wave's actual resolved scene (see resolveSceneForWave/startWave) --
                         // what render() actually draws, independent of sceneMode
  forestScene: null,    // { trees, fireflies, moonXFrac, ... } for the current wave when
                         // scene === 'forest' (see generateForestScene); null otherwise
  beachScene: null,      // { waveLines, glitterDots, moonXFrac, ... } for the current wave when
                          // scene === 'beach' (see generateBeachScene); null otherwise
  birthdayScene: null,    // { confetti, lights, cakeXFrac, celebrating, celebrationBalloons, ... } for the current wave
                           // when scene === 'birthday' (see generateBirthdayScene); null otherwise
  halloweenScene: null,   // { pumpkins, bats, trees, fogBands, ... } for the current wave when
                           // scene === 'halloween' (see generateHalloweenScene); null otherwise
  christmasScene: null,   // { snowflakes, lights, treeXFrac, ... } for the current wave when
                           // scene === 'christmas' (see generateChristmasScene); null otherwise
  auroraScene: null,     // { ribbons, ... } for the current wave when scene === 'aurora'
                          // (see generateAuroraScene); null otherwise -- premium, see PREMIUM_SCENE_LIST
  reefScene: null,        // { coral, fish, bubbles, ... } for the current wave when scene === 'reef'
                           // (see generateReefScene); null otherwise -- premium, see PREMIUM_SCENE_LIST
  cavernScene: null,      // { crystals, motes, ... } for the current wave when scene === 'cavern'
                           // (see generateCavernScene); null otherwise -- premium, see PREMIUM_SCENE_LIST
  safariScene: null,      // { variant, phase } for the current wave when scene === 'safari'
                           // (see generateSafariScene); null otherwise
  safariVariant: null,    // 'day' or 'night', persists across a whole safari block once rolled, and
                           // rides along with SAVE_KEY the same way rotateSeed does (see saveGame/loadSave) --
                           // see generateSafariScene's own comment for why this can't just live on safariScene
  purchasedScenes: [],   // premium scene ids owned this session (see loadPurchasedScenes/PURCHASED_SCENES_KEY) --
                          // loaded once at init, updated by completeSimulatedPurchase

  ambientGain: null,     // GainNode every scene ambience layer routes through (see initAudioGraph)
  ambientBuffers: {},     // { forest: { wind: AudioBuffer, ... }, beach: { waves: AudioBuffer, ... } }
                           // -- decoded lazily (see loadSceneAmbienceBuffers), same pattern as
                           // sampleBuffers above. Nested per scene since sound names like 'wind'
                           // are reused across scenes with different underlying recordings.
  ambientBuffersReadyPromise: null,
  ambienceScene: null,     // which scene STATE.ambienceStreak/ambienceLayers currently belong to --
                            // lets updateSceneAmbienceForWaveComplete tell "still the same ambient
                            // scene" apart from "just switched straight from one ambient scene to
                            // another" (e.g. forest -> beach under Rotate mode), which needs a reset
                            // too even though neither scene is silence
  ambienceStreak: 0,       // consecutive completed waves on ambienceScene (see checkWaveComplete) --
                            // drives how many of SCENE_AMBIENT_CONFIG[scene].order are currently
                            // layered in; reset to 0 whenever a wave completes on a different scene,
                            // or on an explicit restart/load/exit
  ambienceLayers: {},      // { wind: { stop() }, waves: {...}, ... } -- currently active layers for
                            // ambienceScene, keyed the same way as that scene's `sounds` config
  ambienceActiveSources: [], // { source, gain } pairs currently in flight across every layer above
                              // -- lets resetSceneAmbience fade out and hard-stop whatever's
                              // actually sounding right now, not just cancel future repeats (see
                              // trackAmbientSource)

  breakSparks: [],     // Short-lived particle bursts where a rotating barrier snaps a connection

  tutorialWave: null,        // wave number the current on-screen tutorial hint belongs to, or null
  tutorialDismissWhen: null, // 'connect' | 'complete' — what the player needs to do to dismiss it

  waveStartScore: 0,     // STATE.score snapshot at the start of the current wave — the difference
                          // at wave-complete is that wave's own score, for the best-single-wave record
  stats: loadStats(),    // persisted personal bests (see loadStats/saveStats) — survives across visits
  achievementQueue: [],  // pending {glyph, bg, glow, label} toasts, shown one at a time
  achievementToastActive: false,
  lastWavePostcardLabels: [], // achievement label(s) earned by the most recently completed wave, if
                              // any -- drives whether #postcard-row shows and what it prints (see
                              // checkWaveComplete/buildWavePostcard)
  connectionPraise: [],  // active { el, worldX, worldY, flip, spawnedAt, closing } popups -- see spawnConnectionPraise/updateConnectionPraise
  lastPraiseAt: -Infinity, // performance.now() of the last one actually shown -- see CONNECTION_PRAISE_COOLDOWN_MS

  paused: false,           // freezes update()/input while the pause menu is open (see pauseGame/resumeGame)
  pauseFactHistory: [],    // last few pause-menu fact/tip strings shown, so the rotation never repeats too soon
  pauseFactTimer: null,    // setInterval id for the 13s rotation, running only while paused
  onlineFacts: [],         // bonus facts fetched live this session (see fetchOnlineFacts) — empty if offline/failed
  pendingResume: null,     // { wave, score } loaded from a save, offered on the title screen (see init/startGameFromTitle)
  autoLoadEnabled: false,  // persisted (see AUTOLOAD_KEY) -- whether clicking Start Game should
                           // silently resume pendingResume instead of always starting wave 1

  flightMode: false,   // persisted (see FLIGHT_MODE_KEY) -- picked on the title screen, alongside difficulty
  ship: null,           // { x, y, vx, vy, heading, hasTarget, targetX, targetY } while flightMode is active
                         // and a wave is in progress (see startWave/updateShip); null otherwise

  cockpitMode: false,    // persisted (see COCKPIT_MODE_KEY) -- picked on the title screen; mutually
                          // exclusive with flightMode (see setupTitleLoadListeners)
  cockpitShip: null,      // { x, y, z, vx, vy, vz, yaw, pitch } while cockpitMode is active and a
                           // wave is in progress (see startCockpitWave/updateCockpitShip); null otherwise
  cockpitFov: null,       // camera field of view, degrees -- null until startCockpitWave sets it to the
                           // default; persists across waves within a session (a zoom preference, not
                           // per-wave ship state) -- see COCKPIT_CONFIG.FOV_DEFAULT/updateCockpitZoom
  cockpitLastProgressTime: 0, // performance.now() of the last completed connection (or wave start) --
                               // drives the Normal-difficulty waypoint arrow's idle delay (see
                               // updateCockpitWaypointArrow)
  // Touch: two independent on-screen sticks, tracked by touch identifier so
  // both fingers can be down at once (see cockpitTouchStart/Move/End) --
  // left = throttle, right = steering direction. { touchId, curX, curY }
  // while that stick's zone has an active touch, screen-space; null
  // otherwise. The stick's anchor (fixed screen position) comes from its
  // own DOM element's position, not from wherever the touch started -- see
  // cockpitStickAnchor -- so the on-screen graphic and the actual input
  // origin can never drift apart.
  cockpitLeftStick: null,
  cockpitRightStick: null,
  // Desktop: WASD (steering) + up/down arrows (throttle) + left/right
  // arrows (zoom, continuous while held) -- see handleCockpitKeyDown/Up.
  cockpitKeys: { w: false, a: false, s: false, d: false, up: false, down: false, zoomIn: false, zoomOut: false },
  // Desktop: mouse position (screen-space, relative to canvas center) acts
  // as a continuous steering input alongside WASD -- see
  // handleCockpitMouseMove -- null until the first real mousemove, so a
  // touch-only session never has stray desktop steering mixed in.
  cockpitMousePos: null,
  // Desktop: left button decelerates, right button accelerates -- see
  // handleCockpitMouseDown/Up.
  cockpitMouseButtons: { left: false, right: false },
  // The actual throttle/turn applied to the ship each frame -- eases toward
  // computeCockpitThrottle()/computeCockpitTurn()'s raw reading rather than
  // snapping straight to it (see COCKPIT_CONFIG.CONTROL_SMOOTHING and
  // updateCockpitShip), so small stick jitter or a fast correction doesn't
  // translate 1:1 into an equally abrupt yaw/pitch/thrust change.
  cockpitThrottleSmoothed: 0,
  cockpitTurnSmoothed: { x: 0, y: 0 },
  // The direction (from the dot field's center) the wave-complete reveal
  // eases the ship back along -- computed once, the first frame WAVE_COMPLETE
  // starts, from wherever the ship actually finished (see
  // updateCockpitWaveCompleteReveal). Previously the ship just stopped dead
  // exactly where the final connection landed, which is almost always
  // embedded inside that dot's own sphere -- a jarring, ugly close-up
  // instead of a payoff (player report, screenshot).
  cockpitRevealDir: null,
  // The waypoint arrow's own smoothed edge-compass angle -- only used while
  // its target is off-screen (see updateCockpitWaypointArrow); null resets
  // it to jump straight to the target instead of sweeping in from wherever
  // it last was, e.g. right after the target itself changes.
  cockpitWaypointAngle: null,
  // The id of whichever dot cockpitWaypointAngle was last smoothing toward
  // -- a target swap resets the angle even if it happens to occur while
  // both the old and new targets are off-screen the whole time, which
  // otherwise never reset it on its own (review, #49).
  cockpitWaypointTargetId: null,
  cockpitActiveDot: null, // the dot a cockpit connection is currently being drawn from, or null
  cockpitPath: [],        // 3D points [{x,y,z}] recorded along the ship's own flight path since
                           // cockpitActiveDot was entered -- the 3D equivalent of STATE.currentPath
  cockpitLines: [],       // completed 3D connections -- the 3D equivalent of STATE.connections/lines,
                           // kept for rendering and for the fly-through-your-own-line rejection check
};

// ============================================================
// SECTION 3: MUSIC ENGINE (procedural song generation & playback)
// ============================================================
function initAudio() {
  // A context that's gone fully 'closed' (see recoverAudioAfterVisible)
  // needs to be treated exactly like having no context at all -- checked
  // via its state directly rather than relying on createBuffer/
  // createBufferSource/connect/start throwing below, since the spec
  // doesn't guarantee those throw on every browser once a context is
  // closed (review catch: the try/catch further down is a real backstop
  // for genuinely unexpected throws, but isn't guaranteed to ever run for
  // this specific, entirely expected case, which would otherwise leave
  // STATE.audioCtx pointing at a dead context forever).
  if (STATE.audioCtx && STATE.audioCtx.state === 'closed') {
    STATE.audioCtx = null;
  }
  const hadNoContext = !STATE.audioCtx;
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
  // a robust unlock — cheap and idempotent if already unlocked. Wrapped in
  // try/catch: a context that's gone fully 'closed' (see
  // recoverAudioAfterVisible below) throws synchronously from
  // createBuffer/createBufferSource/start rather than merely failing to
  // resume — an uncaught throw here would abort whatever tap handler called
  // initAudio(). Resetting audioCtx to null instead means this tap's caller
  // still runs to completion, and the *next* tap gets a clean rebuild.
  try {
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
  } catch (e) {
    console.error('initAudio unlock failed; will retry on next input:', e);
    STATE.audioCtx = null;
    return;
  }

  // A brand new context -- the very first one ever, or a rebuild after a
  // wedged one got discarded above -- starts with no song scheduled at
  // all. startWave is normally what schedules one, but if this context
  // swap happens mid-wave (a wedge only confirmed on some later tap, or
  // the visibilitychange recovery below), nothing would otherwise
  // re-schedule the wave already in progress until the *next* wave
  // transition -- exactly the "only a reload brings the music back"
  // symptom this was built to fix. No-ops harmlessly if there's no
  // current song yet (e.g. this is the very first tap, still on TITLE).
  // songScheduledFor is reset first -- it only remembers the song object,
  // not which audioCtx it was scheduled against, so a same-song rebuild
  // (this branch) needs the explicit nudge or the guard in
  // scheduleCurrentSongOnceReady would wrongly think this exact song was
  // already handled and skip scheduling it on the new context entirely.
  if (hadNoContext) {
    STATE.songScheduledFor = null;
    scheduleCurrentSongOnceReady();
  }
}

// Waits for sample decoding (async) before scheduling STATE.song onto
// whatever STATE.audioCtx now is -- shared by startWave (a brand new
// wave) and by the audio-recovery paths above/below (a wedged or
// rebuilt context mid-wave), so both get the same "nothing already
// connected gets silently skipped" guarantee scheduleLoopingSong provides.
function scheduleCurrentSongOnceReady() {
  if (!STATE.audioCtx || !STATE.song) return;
  const ctxForThisCall = STATE.audioCtx;
  Promise.resolve(STATE.samplesReadyPromise).then(() => {
    if (STATE.audioCtx !== ctxForThisCall || !STATE.song) return;
    // The wave this call was scheduling for can already be finished and
    // replaced by the time decoding resolves — small waves (wave 1 most
    // of all, since it's also the very first decode ever, with every real
    // instrument sample still to fetch/decode) can be solved faster than
    // that. This used to only schedule the exact song this call started
    // for, so a wave finished under those conditions got dropped and
    // never scheduled at all — "no music heard on a wave, most often wave
    // 1". Always scheduling whatever's actually STATE.song right now
    // means the player ends up with the music for the wave they're
    // really on, never silence; songScheduledFor just skips a harmless
    // but pointless duplicate reschedule when another call already beat
    // this one to the same song.
    if (STATE.songScheduledFor !== STATE.song) {
      STATE.songScheduledFor = STATE.song;
      scheduleLoopingSong(STATE.song);
    }
  });
}

// A real app switch (leaving the browser entirely, not just this tab
// losing focus to another tab in the same browser) can suspend the whole
// audio session on mobile far more aggressively than same-app
// backgrounding -- reported as "sound is lost after switching back to the
// game from another app, requires a refresh." The gesture-triggered
// self-heal in initAudio() only ever runs on the player's *next* tap, and
// even then only rebuilds the context -- it never re-schedules the wave
// already in progress (only startWave does that), which is exactly why a
// full reload was the only thing that actually brought music back (a
// reload always re-enters through startWave). This tries to recover the
// instant the game regains focus instead, without waiting for a tap.
// Only acts if the context was actually found suspended (or closed, see
// below) -- an innocuous visibility blip (opening Control Center, a quick
// app-switcher swipe that never truly backgrounds this tab) leaves it
// 'running' the whole time, and forcing a reschedule then would just be an
// audible glitch for no reason.
//
// Listened for on visibilitychange, pageshow, AND focus (see the three
// addEventListener calls below) rather than visibilitychange alone --
// player reports of this recovery occasionally not kicking in line up
// with known cross-browser inconsistency in exactly when/whether
// visibilitychange fires on a real app-switch-back gesture (as opposed to
// same-tab backgrounding, which is more reliable). audioRecoveryPending
// exists because those three can genuinely fire together for the same
// real-world "switched back" moment -- without it, each would
// independently call resume() and, once it settled, independently stop
// and reschedule the song, doubling up on an otherwise harmless recovery
// into an audible glitch.
let audioRecoveryPending = false;
function recoverAudioAfterVisible() {
  if (document.visibilityState !== 'visible') return;
  const ctx = STATE.audioCtx;
  if (!ctx) return;
  // A real app-switch can leave the context fully 'closed' rather than
  // merely 'suspended' on some mobile browsers under memory pressure --
  // closed contexts can never resume, only be replaced. This used to fall
  // straight through the (then suspended-only) guard below untouched: it
  // stayed set as STATE.audioCtx forever, so even the *next* tap's
  // initAudio() saw a non-null (but permanently dead) context and never
  // rebuilt it -- silence that persisted across further taps, not just
  // until the next one. Dropping it here (same outcome as the wedged
  // branch at the bottom of this function) is enough; actually building a
  // replacement has to wait for that next tap regardless, since
  // constructing/resuming a *new* context from a background lifecycle
  // event rather than a user gesture is unreliable across browsers' own
  // autoplay policies -- the same reason the wedged branch below already
  // defers to initAudio() instead of rebuilding inline.
  if (ctx.state === 'closed') {
    STATE.audioCtx = null;
    return;
  }
  if (ctx.state !== 'suspended') return;
  if (audioRecoveryPending) return;
  audioRecoveryPending = true;
  Promise.resolve(ctx.resume()).catch(() => {}).then(() => {
    audioRecoveryPending = false;
    if (STATE.audioCtx !== ctx) return; // some other recovery already replaced it
    if (ctx.state === 'running') {
      // Even a context reporting healthy again can have silently dropped
      // every note the song had scheduled before backgrounding -- always
      // reschedule fresh from right now rather than trust old scheduling
      // survived. scheduleLoopingSong immediately re-unmutes every pair
      // already connected, so nothing the player already earned goes quiet.
      // songScheduledFor is reset first so scheduleCurrentSongOnceReady's
      // guard doesn't see the same still-current song and skip -- the
      // sources just got stopped above, so this song genuinely does need
      // a fresh schedule despite its identity not having changed.
      stopAllScheduledAudio(ctx.currentTime);
      STATE.songScheduledFor = null;
      scheduleCurrentSongOnceReady();
    } else {
      // Wedged -- drop it so the next tap (initAudio) builds a completely
      // fresh context and reschedules onto it, same self-heal already
      // used for a mid-session wedge.
      STATE.audioCtx = null;
    }
  });
}
document.addEventListener('visibilitychange', recoverAudioAfterVisible);
window.addEventListener('pageshow', recoverAudioAfterVisible);
window.addEventListener('focus', recoverAudioAfterVisible);

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

  // Scene ambience's own gain, feeding into the same limiter/gain chain
  // as the music (see SCENE_AMBIENT_CONFIG) -- one shared knob to balance
  // the whole ambient bed against the song without touching individual
  // layers, and it rides along with the exact same pause/resume ducking
  // and peak limiting the music already gets, rather than a second,
  // separately-tuned signal path. Its value is capped (see
  // ambientMasterGainValue) rather than left at a flat 1.0, on player
  // report that ambience could sometimes read louder than the music itself.
  const ambientGain = STATE.audioCtx.createGain();
  ambientGain.gain.value = ambientMasterGainValue();
  ambientGain.connect(compressor);
  STATE.ambientGain = ambientGain;

  // Track the decode promise so startWave can wait for it before
  // scheduling the first wave's song — scheduleLoopingSong calls
  // playSample synchronously for every note up front, so if decoding
  // isn't finished by then, those notes would silently never play.
  STATE.samplesReadyPromise = decodeAllSamples();
  // Same idea for every scene's own ambient clips -- fire-and-forget is
  // fine here (unlike the song above, nothing calls this synchronously
  // right after), startSceneAmbienceLayer awaits it before actually
  // starting a layer.
  STATE.ambientBuffersReadyPromise = loadSceneAmbienceBuffers();
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
// Measures the just-decoded buffer's own attack loudness and stores the
// multiplier that brings it to TARGET_SAMPLE_RMS, so a real recording's
// natural per-note loudness swings (see sampleGainFor's own comment) never
// reach playback -- computed once here per sample, not per note played.
function registerSampleGain(instrument, key, buffer) {
  if (!buffer) return;
  const rms = computeAttackRms(buffer);
  (STATE.sampleGain[instrument] = STATE.sampleGain[instrument] || {})[key] = rms > 0 ? TARGET_SAMPLE_RMS / rms : 1;
}

// One shared gain for every piece of a kit instrument (see
// DRUM_KIT_INSTRUMENTS' own comment) -- anchored on whichever piece
// measures loudest, matching the previous hardcoded convention (kick was
// always the anchor) but computed automatically instead.
function registerKitGain(instrument, buffers) {
  let anchorRms = 0;
  for (const key in buffers) {
    if (!buffers[key]) continue;
    STATE.sampleBuffers[instrument][key] = buffers[key];
    anchorRms = Math.max(anchorRms, computeAttackRms(buffers[key]));
  }
  const gain = anchorRms > 0 ? TARGET_SAMPLE_RMS / anchorRms : 1;
  const gains = STATE.sampleGain[instrument] = STATE.sampleGain[instrument] || {};
  for (const key in buffers) {
    if (buffers[key]) gains[key] = gain;
  }
}

async function decodeAllSamples() {
  const jobs = [];
  for (const instrument in SAMPLE_MANIFEST) {
    STATE.sampleBuffers[instrument] = {};

    if (SYNTHESIZED_INSTRUMENTS.has(instrument)) {
      if (DRUM_KIT_INSTRUMENTS.has(instrument)) {
        jobs.push((async () => {
          const buffers = {};
          for (const key of SAMPLE_MANIFEST[instrument]) {
            try { buffers[key] = await synthesizeInstrumentSample(instrument, key); }
            catch (e) { /* skip — playDrumHit falls back gracefully */ }
          }
          registerKitGain(instrument, buffers);
        })());
        continue;
      }
      for (const key of SAMPLE_MANIFEST[instrument]) {
        jobs.push((async () => {
          try {
            const buffer = await synthesizeInstrumentSample(instrument, key);
            STATE.sampleBuffers[instrument][key] = buffer;
            registerSampleGain(instrument, key, buffer);
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
          const decoded = await STATE.audioCtx.decodeAudioData(raw.slice(0));
          const buffer = trimLeadingSilence(decoded, STATE.audioCtx);
          STATE.sampleBuffers[instrument][note] = buffer;
          registerSampleGain(instrument, note, buffer);
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
  if (instrument === 'musicbox') return synthesizeMusicboxNote(key);
  if (instrument === 'kalimba') return synthesizeKalimbaNote(key);
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

// Sleep mode's lullaby melody voice: a soft music-box/celesta tone. Same
// fundamental-plus-overtone shape as the Rhodes patch above, but every
// parameter pulls the opposite direction on purpose -- a slower, gentler
// attack (no percussive pluck) and a much quieter, faster-decaying
// overtone (0.1 peak here vs. Rhodes' 0.32) so there's nothing bright or
// metallic in it. This session's own earlier fix (per-note loudness
// normalization, and the melody/neighbor-tone guardrails before that) was
// prompted by real player reports of harsh high-pitched notes -- this
// patch is deliberately built to stay far on the safe side of that.
async function synthesizeMusicboxNote(noteName) {
  const freq = midiToFreq(noteNameToMidi(noteName));
  const duration = 2.6;
  const sr = 44100;
  const ctx = new OfflineAudioContext(1, Math.ceil(duration * sr), sr);

  const fundamental = ctx.createOscillator();
  fundamental.type = 'sine';
  fundamental.frequency.value = freq;
  const fundamentalGain = ctx.createGain();
  fundamentalGain.gain.setValueAtTime(0, 0);
  fundamentalGain.gain.linearRampToValueAtTime(0.7, 0.02); // unhurried attack, not a pluck
  fundamentalGain.gain.exponentialRampToValueAtTime(0.001, duration);
  fundamental.connect(fundamentalGain).connect(ctx.destination);

  const chime = ctx.createOscillator();
  chime.type = 'sine';
  chime.frequency.value = freq * 2; // a plain octave, not a detuned/beating partial
  const chimeGain = ctx.createGain();
  chimeGain.gain.setValueAtTime(0, 0);
  chimeGain.gain.linearRampToValueAtTime(0.1, 0.02);
  chimeGain.gain.exponentialRampToValueAtTime(0.001, 0.6);
  chime.connect(chimeGain).connect(ctx.destination);

  fundamental.start(0); fundamental.stop(duration);
  chime.start(0); chime.stop(0.6);
  return ctx.startRendering();
}

// Safari's 'savanna' family melody/arpeggio/accent voice (see
// GENRE_FAMILIES) -- an African thumb piano (kalimba/mbira): a metal tine
// plucked by the thumb, so the shape is sharper and more percussive than
// Rhodes' bell-like electric-piano attack (linearRampToValueAtTime(0.85,
// 0.003) here vs. Rhodes' 0.006) and the upper partial is tuned to an
// inharmonic ratio (3.01x, not a clean octave/fifth) -- real tines are
// stiff metal bars, not strings, so their overtones don't line up on
// harmonic ratios the way a plucked string's do, which is exactly what
// gives a kalimba its distinctive metallic "buzz" rather than reading as
// a clean bell or chime. A very short high-passed noise burst at onset
// stands in for the audible thumbnail-on-metal contact transient real
// recordings of this instrument have.
async function synthesizeKalimbaNote(noteName) {
  const freq = midiToFreq(noteNameToMidi(noteName));
  const duration = 1.7;
  const sr = 44100;
  const ctx = new OfflineAudioContext(1, Math.ceil(duration * sr), sr);

  const fundamental = ctx.createOscillator();
  fundamental.type = 'sine';
  fundamental.frequency.value = freq;
  const fundamentalGain = ctx.createGain();
  fundamentalGain.gain.setValueAtTime(0, 0);
  fundamentalGain.gain.linearRampToValueAtTime(0.85, 0.003); // sharp pluck attack
  fundamentalGain.gain.exponentialRampToValueAtTime(0.24, 0.18);
  fundamentalGain.gain.exponentialRampToValueAtTime(0.001, duration);
  fundamental.connect(fundamentalGain).connect(ctx.destination);

  const tine = ctx.createOscillator();
  tine.type = 'sine';
  tine.frequency.value = freq * 3.01; // inharmonic upper partial -- the metallic "buzz"
  const tineGain = ctx.createGain();
  tineGain.gain.setValueAtTime(0, 0);
  tineGain.gain.linearRampToValueAtTime(0.22, 0.002);
  tineGain.gain.exponentialRampToValueAtTime(0.001, 0.12);
  tine.connect(tineGain).connect(ctx.destination);

  const attackDur = 0.02;
  const noiseBuffer = ctx.createBuffer(1, Math.ceil(attackDur * sr), sr);
  const noiseData = noiseBuffer.getChannelData(0);
  for (let i = 0; i < noiseData.length; i++) noiseData[i] = Math.random() * 2 - 1;
  const noise = ctx.createBufferSource();
  noise.buffer = noiseBuffer;
  const noiseFilter = ctx.createBiquadFilter();
  noiseFilter.type = 'highpass';
  noiseFilter.frequency.value = 2500;
  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(0.15, 0);
  noiseGain.gain.exponentialRampToValueAtTime(0.001, attackDur);
  noise.connect(noiseFilter).connect(noiseGain).connect(ctx.destination);

  fundamental.start(0); fundamental.stop(duration);
  tine.start(0); tine.stop(0.15);
  noise.start(0); noise.stop(attackDur);
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

// Melody/accent notes are voiced an octave above the rest of the harmony by
// default (octaveOffset 1) -- good practice, a melody singing above its
// chords -- but only sounds good if the instrument actually HAS real
// samples up there. That convention was tuned against wide acoustic ranges
// like flute/trumpet; a narrow synthesized voice like rhodes (only 3
// octaves, topping out at G5) gets pushed well past its own samples by the
// same +1 octave, and even after foldToInstrumentRange's headroom, still
// lands several semitones above the nearest real recording -- an audibly
// pitch-shifted, artificial "chipmunk" tone (player report: high-pitched
// sounds were unpleasant enough to make people want to stop playing).
// Picks whichever octave (0 or 1) leaves the target closer to the
// instrument's own sampled range, so the fold/pitch-shift safety net
// rarely has to do more than a semitone or two of work.
function melodyOctaveOffset(genre, instrument, degreeIndex) {
  const range = instrumentMidiRange(instrument);
  if (!range) return 1;
  const overshoot = (m) => Math.max(0, m - range.max, range.min - m);
  const raised = scaleMidi(genre, degreeIndex, 1);
  const level = scaleMidi(genre, degreeIndex, 0);
  return overshoot(raised) <= overshoot(level) ? 1 : 0;
}

// A neighbor tone landing a half-step from a note the chord underneath it
// is simultaneously sounding is the textbook "avoid note" -- it reads as a
// wrong note, not an intentional passing tone. Whether baseDeg+/-1 lands a
// half or whole step away depends entirely on which two scale degrees
// happen to be adjacent (a major scale mixes both), so scale-degree math
// alone can't tell a pleasant neighbor from a clashing one -- this checks
// the actual resulting pitch class against the chord actually sounding
// underneath it (player report: some songs "just don't come together").
function neighborToneClashes(genre, degreeIndex, chordDegrees) {
  const scaleLen = genre.scaleIntervals.length;
  const pitchClass = (idx) => genre.scaleIntervals[((idx % scaleLen) + scaleLen) % scaleLen];
  const neighborPc = pitchClass(degreeIndex);
  return chordDegrees.some(cd => {
    const diff = Math.abs(neighborPc - pitchClass(cd)) % 12;
    return diff === 1 || diff === 11;
  });
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

// ============================================================
// SCENE AMBIENCE — real recordings (see sounds/CREDITS.md for sourcing/
// licensing), layered in one at a time as a wave streak on a given scene
// builds (see checkWaveComplete/updateSceneAmbienceForWaveComplete),
// always underneath the puzzle's own generated music, never replacing
// it. Most sounds loop continuously; a couple per scene are rarer
// one-shot events instead of a loop (the forest's owl, the beach's
// gulls and whale).
// ============================================================
const SCENE_AMBIENT_CONFIG = {
  forest: {
    // Reveal order -- wind first, since it reads as the scene's "floor."
    order: ['wind', 'crickets', 'frogs', 'owl'],
    sounds: {
      wind: { file: 'wind.mp3', gain: 0.55, isEvent: false },
      crickets: { file: 'crickets.mp3', gain: 0.42, isEvent: false },
      frogs: { file: 'frogs.mp3', gain: 0.55, isEvent: false },
      owl: { file: 'owl.mp3', gain: 0.85, isEvent: true, minGapSec: 14, maxGapSec: 40 },
    },
  },
  beach: {
    // Waves first, same reasoning as the forest's wind -- the scene's floor.
    // The foghorn that used to round out this set (player feedback: "not
    // relaxing") is gone -- replaced with a distant whale call, and the
    // shorebirds' gain is down 20% (0.7 -> 0.56) on the same feedback that
    // it ran a bit hot relative to everything else in the scene.
    order: ['waves', 'wind', 'shorebirds', 'whale'],
    sounds: {
      waves: { file: 'beach-waves.mp3', gain: 0.6, isEvent: false },
      wind: { file: 'beach-wind.mp3', gain: 0.4, isEvent: false },
      shorebirds: { file: 'beach-shorebirds.mp3', gain: 0.56, isEvent: true, minGapSec: 12, maxGapSec: 32 },
      whale: { file: 'beach-whale.mp3', gain: 0.55, isEvent: true, minGapSec: 30, maxGapSec: 65 },
    },
  },
  // Deliberately the loudest, busiest, most high-energy set of the bunch
  // -- see SLEEP_SAFE_SCENES, which is exactly why Birthday isn't in it.
  birthday: {
    // Crowd chatter first, same reasoning as the forest's wind -- the
    // scene's floor.
    order: ['crowd', 'balloon', 'horn', 'cork'],
    sounds: {
      crowd: { file: 'birthday-crowd.mp3', gain: 0.45, isEvent: false },
      balloon: { file: 'birthday-balloon.mp3', gain: 0.5, isEvent: false },
      // Player feedback called these "really strange sounds" -- horn and
      // cork were also, by a wide margin, the loudest layers in the whole
      // scene (0.8/0.75 against a 0.45-0.5 ambient bed), so anything
      // synthetic about their timbre got maximum spotlight. Rebuilt (see
      // sounds/CREDITS.md) and brought down to sit with the bed rather
      // than over it.
      //
      // Second correction (player feedback, 2026-08-14): 0.55 still read
      // as dominating, specifically drowning out quiet music passages it
      // happened to land on -- a bright, harsh one-shot transient like a
      // horn blat masks a soft melody note far more than equal *gain*
      // against a continuous bed would suggest (the ear weights sudden
      // high-energy transients more than raw RMS does). Brought below the
      // continuous bed layers (crowd/balloon) rather than just closer to
      // them, since matching their gain still meant reading louder in
      // practice.
      horn: { file: 'birthday-horn.mp3', gain: 0.35, isEvent: true, minGapSec: 10, maxGapSec: 28 },
      cork: { file: 'birthday-cork.mp3', gain: 0.5, isEvent: true, minGapSec: 20, maxGapSec: 45 },
    },
  },
  // Cozy-spooky rather than horror -- a gentle autumn wind + trick-or-treat
  // floor with three occasional atmospheric events (creak/ghost moan/witch
  // cackle). Not in SLEEP_SAFE_SCENES: even kept gentle, "spooky" trades on
  // a little tension that cuts against Sleep mode's calm/low-arousal goal
  // in a way Forest's owl doesn't. Player-requested swap (wolf howl/raven
  // out, ghost/witch/kids in) for a set that actually sounds like Halloween
  // rather than generic nighttime woods -- see sounds/CREDITS.md.
  halloween: {
    order: ['wind', 'trickortreat', 'creak', 'ghost', 'witchcackle'],
    sounds: {
      wind: { file: 'halloween-wind.mp3', gain: 0.5, isEvent: false },
      trickortreat: { file: 'halloween-trickortreat.mp3', gain: 0.4, isEvent: false },
      creak: { file: 'halloween-creak.mp3', gain: 0.6, isEvent: true, minGapSec: 14, maxGapSec: 34 },
      ghost: { file: 'halloween-ghost.mp3', gain: 0.5, isEvent: true, minGapSec: 26, maxGapSec: 58 },
      // Already mixed to read as "in the distance" in the file itself
      // (low-pass + soft echo tail baked in during sourcing, not just
      // gain here) -- see sounds/CREDITS.md.
      witchcackle: { file: 'halloween-witchcackle.mp3', gain: 0.55, isEvent: true, minGapSec: 34, maxGapSec: 70 },
    },
  },
  // Genuinely calm -- already in SLEEP_SAFE_SCENES -- unlike Birthday/
  // Halloween's deliberately higher-energy sets.
  christmas: {
    order: ['fire', 'wind', 'bells', 'chimes'],
    sounds: {
      fire: { file: 'christmas-fire.mp3', gain: 0.5, isEvent: false },
      wind: { file: 'christmas-wind.mp3', gain: 0.35, isEvent: false },
      bells: { file: 'christmas-bells.mp3', gain: 0.55, isEvent: true, minGapSec: 16, maxGapSec: 38 },
      chimes: { file: 'christmas-chimes.mp3', gain: 0.45, isEvent: true, minGapSec: 30, maxGapSec: 65 },
    },
  },
  // The composed African-inspired track is the scene's floor (same
  // reasoning as every other scene's first-revealed layer), with the bus
  // engine hum right behind it. wind and insects (both real field
  // recordings -- see sounds/CREDITS.md) are the two continuous "nature"
  // beds every other scene's ambience already leans on (forest's wind/
  // crickets, beach's waves/wind), which this scene didn't have at
  // first -- song and engine cover the "riding in a vehicle" half of the
  // brief, but neither one is actually a savanna field recording.
  // wildlife is the one occasional event layer: a real elephant trumpet
  // call (also replaces an earlier synthesized placeholder -- see git
  // history), matching the real-recording pattern player feedback
  // established for forest/beach's own event layers (owl, whale) over
  // synthesizing something built to only approximate them.
  safari: {
    order: ['song', 'wind', 'insects', 'engine', 'wildlife'],
    sounds: {
      song: { file: 'safari-song.mp3', gain: 0.5, isEvent: false },
      wind: { file: 'safari-wind.mp3', gain: 0.42, isEvent: false },
      insects: { file: 'safari-insects.mp3', gain: 0.4, isEvent: false },
      engine: { file: 'safari-engine.mp3', gain: 0.28, isEvent: false },
      wildlife: { file: 'safari-wildlife.mp3', gain: 0.55, isEvent: true, minGapSec: 25, maxGapSec: 55 },
    },
  },
};

// Applied fresh on every repeat (a loop's next crossfaded pass, or an
// event layer's next retrigger) -- real recordings vary take to take, and
// without this a ~20s clip played back to back for several waves would
// read as an obviously exact, identical loop. Shared across every scene
// above rather than tuned per scene.
const AMBIENT_VARIATION = {
  RATE_RANGE: [0.94, 1.06], // playbackRate -- pitch and speed together, same technique the pitched instrument samples use
  GAIN_RANGE: [0.85, 1.15], // multiplies each sound's own base gain above
  PAN_RANGE: [-0.3, 0.3],
  CROSSFADE_SEC: 1.5, // overlap between an outgoing loop instance and the next
  EVENT_FADE_IN_SEC: 0.35, // player feedback: a one-shot snapping straight to full
                            // volume reads as a jump-scare, not relaxing -- softens
                            // the attack on every event-type retrigger (owl, gulls,
                            // whale, birthday's horn/cork) without erasing each
                            // sound's own character
  // Player report: ambience can sometimes read louder than the music
  // itself -- never acceptable. Enforced as a single shared multiplier on
  // STATE.ambientGain (see ambientMasterGainValue/initAudioGraph) rather
  // than hand-tuning every individual layer's own gain in
  // SCENE_AMBIENT_CONFIG down, so each scene's already-hand-tuned internal
  // balance between its own layers (e.g. "shorebirds' gain is down 20% on
  // player feedback it ran hot relative to the rest of the scene") stays
  // untouched -- only the whole bed's ceiling moves.
  VOLUME_CAP_RATIO: 0.75,
};

// The value STATE.ambientGain (the one shared node every scene's whole
// ambient bed routes through) is set to at graph-init time. Derived from
// live constants rather than a hardcoded number so a future retune of
// either side can't silently let this drift back out of sync with itself.
//
// Budgets the worst case as every layer *within a scene* summing
// simultaneously, not just whichever single layer has the highest
// configured gain (review catch: once a scene's ambient streak is fully
// revealed, every one of its layers -- including its "rare" one-shot
// events, which can still land on top of the continuous ones by chance --
// is genuinely live at once, and Web Audio literally sums whatever's
// connected to a shared node sample-by-sample; a single-layer budget left
// real headroom for a fully-revealed scene's combined mix to blow well
// past the cap even though each individual layer looked fine on its own).
// Takes whichever scene's own layers sum to the highest total, accounts
// for that landing at the very top of AMBIENT_VARIATION.GAIN_RANGE's
// per-repeat jitter (its true worst case), and scales the whole shared
// node down so even that worst case can't exceed
// AMBIENT_VARIATION.VOLUME_CAP_RATIO of the loudest thing the music itself
// ever produces -- a melody note at full peak and velocity,
// KIND_PEAK.melody. Every other, quieter scene/moment ends up
// proportionally further under the cap than that, which is fine: this is
// a ceiling, not a target every scene needs to individually reach. Doesn't
// separately budget for a single layer's own loop crossfade
// (AMBIENT_VARIATION.CROSSFADE_SEC) -- an equal-power crossfade is
// specifically designed to keep that one layer's own perceived loudness
// roughly constant through the transition, not spike it, unlike genuinely
// independent layers stacking.
function ambientMasterGainValue() {
  const worstCaseSceneGainSum = Math.max(
    ...Object.values(SCENE_AMBIENT_CONFIG).map(scene =>
      Object.values(scene.sounds).reduce((sum, s) => sum + s.gain, 0)
    )
  );
  const worstCasePossibleMix = worstCaseSceneGainSum * AMBIENT_VARIATION.GAIN_RANGE[1];
  return (AMBIENT_VARIATION.VOLUME_CAP_RATIO * KIND_PEAK.melody) / worstCasePossibleMix;
}

function randRange([lo, hi]) {
  return lo + Math.random() * (hi - lo);
}

async function loadSceneAmbienceBuffers() {
  const jobs = [];
  for (const scene in SCENE_AMBIENT_CONFIG) {
    STATE.ambientBuffers[scene] = {};
    for (const name in SCENE_AMBIENT_CONFIG[scene].sounds) {
      jobs.push((async () => {
        try {
          const res = await fetch(`sounds/ambient/${SCENE_AMBIENT_CONFIG[scene].sounds[name].file}`);
          const bytes = await res.arrayBuffer();
          STATE.ambientBuffers[scene][name] = await STATE.audioCtx.decodeAudioData(bytes);
        } catch (e) { /* missing/failed to load or decode -- that layer just never starts, same graceful-skip playSample already uses */ }
      })());
    }
  }
  await Promise.all(jobs);
}

// Tracked separately from STATE.activeSources/trackSource/stopAllScheduledAudio
// on purpose -- those exist specifically to hard-stop everything at a wave
// transition so nothing from one wave's song leaks into the next, but
// scene ambience is supposed to survive ordinary wave transitions (that's
// the entire point of the streak below). Tracked here only so
// resetSceneAmbience can still fade out and hard-stop whatever's actually
// sounding right now on a real reset (restart/load/exit), not just cancel
// each layer's future repeats.
function trackAmbientSource(source, gain) {
  STATE.ambienceActiveSources.push({ source, gain });
}

// One continuously-looping layer (e.g. wind/crickets/frogs, or the
// beach's waves/wind): schedules its own next repeat shortly before the
// current one ends, each time with a fresh random playbackRate/gain/pan
// and a short crossfade so consecutive repeats overlap instead of
// clicking together. Returns a handle whose stop() cancels every future
// repeat (the currently-playing instance is left to fade out on its own
// schedule, or gets force-stopped by resetSceneAmbience if that's what
// actually called stop()).
function startLoopingAmbientLayer(buffer, baseGain) {
  let stopped = false;
  let timer = null;
  const cfg = AMBIENT_VARIATION;

  function playOnce() {
    if (stopped || !STATE.audioCtx || !STATE.ambientGain) return;
    const ctx = STATE.audioCtx;
    const now = ctx.currentTime;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = randRange(cfg.RATE_RANGE);

    const panner = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (panner) panner.pan.value = randRange(cfg.PAN_RANGE);

    const gain = ctx.createGain();
    const peakGain = baseGain * randRange(cfg.GAIN_RANGE);
    const fade = cfg.CROSSFADE_SEC;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(peakGain, now + fade);

    source.connect(gain);
    if (panner) { gain.connect(panner); panner.connect(STATE.ambientGain); }
    else gain.connect(STATE.ambientGain);

    // Actual sounding duration divided by this instance's own playbackRate
    // -- a faster repeat finishes sooner, and the fade-out/next repeat both
    // need to land relative to THIS instance's real length, not the
    // buffer's nominal one.
    const playDuration = buffer.duration / source.playbackRate.value;
    const fadeOutStart = now + playDuration - fade;
    gain.gain.setValueAtTime(peakGain, fadeOutStart);
    gain.gain.linearRampToValueAtTime(0, fadeOutStart + fade);

    source.start(now);
    source.stop(fadeOutStart + fade + 0.05);
    trackAmbientSource(source, gain);

    if (!stopped) {
      timer = setTimeout(playOnce, Math.max(50, (playDuration - fade) * 1000));
    }
  }

  playOnce();
  return { stop() { stopped = true; if (timer) clearTimeout(timer); } };
}

// An occasional event sound (the forest's owl; the beach's gulls and
// whale) rather than a loop, at a random gap after the previous one (or
// a beat after first being revealed). Same per-repeat pitch/gain/pan
// variation as the looping layers above, plus a short fade-in so the
// sound eases in rather than snapping straight to full volume.
function startEventAmbientLayer(buffer, baseGain, minGapSec, maxGapSec) {
  let stopped = false;
  let timer = null;
  const cfg = AMBIENT_VARIATION;

  function playOnce() {
    if (stopped || !STATE.audioCtx || !STATE.ambientGain) return;
    const ctx = STATE.audioCtx;
    const now = ctx.currentTime;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = randRange(cfg.RATE_RANGE);

    const panner = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (panner) panner.pan.value = randRange(cfg.PAN_RANGE);

    const gain = ctx.createGain();
    const peakGain = baseGain * randRange(cfg.GAIN_RANGE);
    const fadeIn = Math.min(cfg.EVENT_FADE_IN_SEC, buffer.duration / source.playbackRate.value / 3);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(peakGain, now + fadeIn);

    source.connect(gain);
    if (panner) { gain.connect(panner); panner.connect(STATE.ambientGain); }
    else gain.connect(STATE.ambientGain);

    source.start(now);
    trackAmbientSource(source, gain);

    if (!stopped) {
      timer = setTimeout(playOnce, randRange([minGapSec, maxGapSec]) * 1000);
    }
  }

  timer = setTimeout(playOnce, 1500 + Math.random() * 2000); // a beat after being revealed, not instantly
  return { stop() { stopped = true; if (timer) clearTimeout(timer); } };
}

async function startSceneAmbienceLayer(scene, name) {
  if (STATE.ambienceLayers[name]) return; // already playing
  if (STATE.ambientBuffersReadyPromise) await STATE.ambientBuffersReadyPromise;
  const buffer = STATE.ambientBuffers[scene] && STATE.ambientBuffers[scene][name];
  if (!buffer || !STATE.audioCtx || !STATE.ambientGain) return; // missing/failed to load -- skip gracefully
  // The reveal that asked for this layer may already be stale by the time
  // decoding finishes (wave advanced again, scene changed, reset fired) --
  // re-check right before actually starting anything audible.
  if (STATE.scene !== scene || STATE.ambienceLayers[name]) return;

  const cfg = SCENE_AMBIENT_CONFIG[scene].sounds[name];
  STATE.ambienceLayers[name] = cfg.isEvent
    ? startEventAmbientLayer(buffer, cfg.gain, cfg.minGapSec, cfg.maxGapSec)
    : startLoopingAmbientLayer(buffer, cfg.gain);
}

// Stops every scene ambience layer -- both future repeats (each layer's
// own stop()) and whatever's actually sounding right now (a short fade
// via ambienceActiveSources, so this never clicks). Called whenever a
// wave completes on a scene with no ambient config, or a different
// ambient scene than the streak was built on (see
// updateSceneAmbienceForWaveComplete), and from the explicit
// restart-game/load-game/exit-to-title paths -- deliberately NOT from a
// same-level retry, which keeps the streak going rather than punishing a
// retry by resetting the mood underneath it.
function resetSceneAmbience() {
  for (const name in STATE.ambienceLayers) {
    STATE.ambienceLayers[name].stop();
  }
  STATE.ambienceLayers = {};
  STATE.ambienceStreak = 0;
  STATE.ambienceScene = null;
  if (STATE.audioCtx) {
    const now = STATE.audioCtx.currentTime;
    for (const { source, gain } of STATE.ambienceActiveSources) {
      try {
        // cancelScheduledValues() alone doesn't preserve wherever an
        // in-progress ramp (e.g. an event sound's EVENT_FADE_IN_SEC
        // attack) had actually gotten to -- reading gain.gain.value right
        // after cancelling can hand back the ramp's start value, not its
        // current interpolated one, undoing the fade-in and re-creating
        // exactly the "sudden sound" this was meant to prevent (P2 review
        // catch, PR #68). cancelAndHoldAtTime is the API built for this:
        // cancel-and-freeze-at-the-actual-current-value in one call.
        if (gain.gain.cancelAndHoldAtTime) gain.gain.cancelAndHoldAtTime(now);
        else { gain.gain.cancelScheduledValues(now); gain.gain.setValueAtTime(gain.gain.value, now); }
        gain.gain.linearRampToValueAtTime(0, now + 0.3);
        source.stop(now + 0.35);
      } catch (e) { /* already stopped */ }
    }
  }
  STATE.ambienceActiveSources = [];
}

// Called from startWave, right after STATE.scene resolves for the wave
// that's about to start -- stops the outgoing scene's ambience the
// instant the scene actually changes, rather than leaving it playing
// through the whole new wave. (An earlier version did this check inside
// updateSceneAmbienceForWaveComplete instead, which only runs when a wave
// COMPLETES -- under Rotate mode that meant a Forest wave's wind/crickets
// kept playing through the entire following Beach wave, only getting cut
// off once that Beach wave itself completed.) Also covers two ambient
// scenes sharing a sound name (both have a "wind") -- without this, the
// new scene's reveal would silently inherit the old scene's still-playing
// layer instead of starting its own.
function syncAmbienceToScene() {
  if (STATE.scene === STATE.ambienceScene) return;
  if (STATE.ambienceStreak > 0 || Object.keys(STATE.ambienceLayers).length > 0) {
    resetSceneAmbience();
  }
  STATE.ambienceScene = STATE.scene;
}

// Shown as a celebratory toast (see queueAchievement/showAchievementToast,
// same mechanism the wave-milestone/high-score achievements use) the
// instant a scene's last ambient sound gets revealed -- only meaningful
// under Rotate mode, where a scene occupies exactly as many consecutive
// waves as it has sounds (see resolveSceneForWave/sceneWaveCount), so
// completing the set IS the wave right before the background actually
// changes. A fixed single-scene mode has no "next scene" to announce, so
// it stays quiet once its own set completes.
const SCENE_COMPLETE_CELEBRATIONS = {
  forest: { glyph: '🌲', bg: 'radial-gradient(circle at 35% 30%, #bfe3b0, #3f7d4a)', glow: 'rgba(80,170,90,0.6)' },
  beach: { glyph: '🌊', bg: 'radial-gradient(circle at 35% 30%, #bfe9f2, #2f7fa0)', glow: 'rgba(60,170,210,0.6)' },
  birthday: { glyph: '🎂', bg: 'radial-gradient(circle at 35% 30%, #ffd3e6, #c93f7a)', glow: 'rgba(255,93,143,0.6)' },
  halloween: { glyph: '🎃', bg: 'radial-gradient(circle at 35% 30%, #ffcf8a, #9a4a12)', glow: 'rgba(255,140,20,0.6)' },
  christmas: { glyph: '🎄', bg: 'radial-gradient(circle at 35% 30%, #cdeccb, #1f5c3a)', glow: 'rgba(60,190,110,0.6)' },
  safari: { glyph: '🦒', bg: 'radial-gradient(circle at 35% 30%, #f6dfa0, #7a5a1e)', glow: 'rgba(230,180,80,0.6)' },
};
const SCENE_DISPLAY_NAMES = {
  space: 'Space', forest: 'Forest', beach: 'Beach', birthday: 'Birthday', halloween: 'Halloween', christmas: 'Christmas', safari: 'Safari',
  aurora: 'Aurora Skies', reef: 'Coral Reef', cavern: 'Crystal Cave',
};

// Full names matching the title screen's own scene-selector option text
// (see index.html) -- used by #scene-progress-display below, which names
// the actual scene being played, not the shorter toast-label wording
// SCENE_DISPLAY_NAMES uses ("Beach at Night", not just "Beach").
const SCENE_HUD_NAMES = {
  space: 'Space', forest: 'Night Forest', beach: 'Beach at Night',
  birthday: 'Birthday Party', halloween: 'Halloween', christmas: 'Christmas', safari: 'Safari',
  aurora: 'Aurora Skies', reef: 'Coral Reef Glow', cavern: 'Crystal Cave',
};

function queueSceneCompleteToast(scene) {
  const celebration = SCENE_COMPLETE_CELEBRATIONS[scene];
  if (!celebration) return;
  // Packages no longer sit in a fixed repeating order (see resolveSceneBlock's
  // random-package-order rewrite), so "next" can't be read off scene's own
  // position in activeSceneList anymore -- ask resolveSceneBlock itself,
  // the one place that actually knows, for whichever wave starts the next
  // package (this wave's block still has its own "bonus" wave left after
  // this reveal, hence the blockPosition arithmetic below, not just
  // STATE.wave + 1).
  const { blockPosition } = resolveSceneBlock(STATE.wave);
  const nextBlockFirstWave = STATE.wave + (sceneWaveCount(scene) - blockPosition);
  const nextScene = resolveSceneBlock(nextBlockFirstWave).scene;
  queueAchievement({
    glyph: celebration.glyph,
    bg: celebration.bg,
    glow: celebration.glow,
    label: `${SCENE_DISPLAY_NAMES[scene]} Complete! ${SCENE_DISPLAY_NAMES[nextScene]} Ahead`,
  });
}

// Called once per wave completion (see checkWaveComplete) -- advances the
// streak and starts whichever new layer that unlocks. By this point
// STATE.scene and STATE.ambienceScene already agree (syncAmbienceToScene
// saw to that when this wave started), so there's nothing left to do here
// but the reveal itself. Once every sound in the current scene's
// SCENE_AMBIENT_CONFIG.order has been revealed, they all just keep
// playing together -- there's no reset once a scene's set is complete,
// just (under Rotate mode) the celebration toast above and the scene
// itself moving on next wave.
function updateSceneAmbienceForWaveComplete() {
  const config = SCENE_AMBIENT_CONFIG[STATE.scene];
  if (!config) return;
  if (STATE.ambienceStreak < config.order.length) {
    STATE.ambienceStreak++;
    startSceneAmbienceLayer(STATE.scene, config.order[STATE.ambienceStreak - 1]);
    if (STATE.ambienceStreak === config.order.length) {
      if (STATE.sceneMode === 'rotate') queueSceneCompleteToast(STATE.scene);
      // Birthday's balloon release -- see generateCelebrationBalloons' own
      // comment. Fires the wave this scene's whole ambient set finishes
      // revealing, in both Rotate and fixed scene mode (unlike the toast
      // above, which is Rotate-only since it announces a scene change
      // that only happens under Rotate) -- STATE.birthdayScene is always
      // the current wave's scene object by this point (checkWaveComplete
      // calls this after STATE.phase is already 'WAVE_COMPLETE', and a
      // fresh one is built at the start of every birthday wave), so
      // there's nothing else to reset here.
      if (STATE.scene === 'birthday' && STATE.birthdayScene) {
        STATE.birthdayScene.celebrating = true;
        STATE.birthdayScene.celebrationBalloons = generateCelebrationBalloons();
      }
      // Halloween's jack-o'-lanterns only ever exist as this one-time
      // celebration burst (see generateCelebrationPumpkins()) -- same
      // pattern, and same player report, as Birthday's celebration
      // balloons: nothing round/glowing should be on screen during
      // ordinary play, where it could read as a connectable dot.
      if (STATE.scene === 'halloween' && STATE.halloweenScene) {
        STATE.halloweenScene.celebrating = true;
        STATE.halloweenScene.celebrationPumpkins = generateCelebrationPumpkins();
      }
    }
  }
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
//
// DISTINCT_SAMPLE_MAX_REACH bounds how far a target is ever pushed just to
// stay unique: with a sparse instrument (rhodes has only 3 unique pitches
// per octave, 9 samples total), a busy lofi downbeat can stack up to 7
// simultaneous targets on it (melody + arpeggio + a 4-note pad chord +
// accent) -- greedily assigning them in order lets the first few claim
// every nearby sample, leaving later ones with nothing close left and
// forcing a reach of 20+ semitones into a completely different octave
// (verified: up to 30 semitones before this fix, across 200 generated lofi
// songs) -- an unmistakably wrong-sounding note, not a chord tone anymore.
// Reusing another note's sample (letting them phase against each other,
// the exact thing distinctness exists to avoid) is the lesser problem once
// the alternative is a note this far from anything it's supposed to be.
const DISTINCT_SAMPLE_MAX_REACH = 6; // semitones -- matches foldToInstrumentRange's own headroom
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
    // No unused sample at all, or the only ones left are too far away to
    // still sound like this target -- reuse the actual nearest sample.
    if (best === null || bestDist > DISTINCT_SAMPLE_MAX_REACH) best = nearestSampleNote(instrument, targetMidi);
    used.add(best);
    return best;
  });
}

// The source recordings themselves were captured at wildly different
// dynamics (see sounds/CREDITS.md: piano/cello at mf, marimba/vibraphone
// at ff, flute deliberately re-extracted at pp) -- but that's not the only
// variance: even within ONE instrument, real recordings swing loudness by
// a lot across the range (measured directly off the actual flute files:
// mean volume spans a full ~15dB from the quietest low note to the
// loudest, which happens to sit in the exact upper octaves melody spends
// most of its time in -- player report: "sounds like a flute and its
// volume is higher than the other notes"). A single instrument-wide
// average (the previous approach here) corrects the FIRST kind of
// variance but is blind to the second -- it's still just one number, so
// any one instrument's own loud outlier note plays through unchanged.
// sampleGainFor() instead measures each individual decoded buffer's own
// RMS (see computeAttackRms/decodeAllSamples) and normalizes every real
// note to the same target loudness, whichever instrument or pitch it is.
const TARGET_SAMPLE_RMS = 0.15;

// Matches the attack-window methodology this instrument-level system was
// originally tuned with: loudness is judged by a note's first ~0.3s (its
// attack/onset), not its full decay tail, since that's what a listener's
// ear actually weights and what determines how a note reads next to
// others hitting on nearby beats. Falls back to the whole buffer for
// anything shorter (e.g. a drum one-shot).
const ATTACK_WINDOW_SEC = 0.3;

// Real recordings carry mic pre-roll before the string is actually struck
// -- measured across this project's own piano set, onsets range from
// ~0.24s up to ~0.48s of near-silence before the note begins. This bites
// twice. First, measuring the attack window from literal sample 0 means
// that lead-in silence dominates the RMS for any sample whose onset is a
// meaningful fraction of ATTACK_WINDOW_SEC, understating true loudness and
// producing a wildly inflated gain multiplier (400-600x seen on the
// worst offenders here) that then clips the real attack once it finally
// arrives. Second and more serious: every note is scheduled assuming
// "starts playing at t" means "audible at t" -- with up to half a second
// of silence baked into the front of the buffer, a note's real sound
// doesn't arrive until t+onset, an offset that differs per sample. For
// a fixed melody with notes under a second apart (see
// generateBirthdaySong), that smears the actual rhythm into something
// unrecognizable even when every pitch and gain is correct, and a short
// holdSec can release/stop a note before its audible attack ever plays.
// trimLeadingSilence (below) removes this at its source, once per sample
// at decode time, so every downstream consumer -- gain calibration here
// and playback scheduling everywhere else -- gets a buffer that actually
// starts when it sounds.
// Onset relative to the recording's own noise floor, not a fraction of
// its eventual peak (review catch, PR #77: a fixed-fraction-of-peak
// threshold can't distinguish a genuinely quiet, gradual attack -- a
// bowed cello swell, a mallet roll -- from real silence, and would trim
// straight into it). Every sample in this project's library opens with
// at least a few ms of true room silence before any note, fast or slow
// attack alike, physically begins -- measuring that as the floor and
// looking for a sustained rise clearly above it (a short RMS window, not
// a single-sample peak, so one stray click can't false-trigger) finds
// the real onset for a percussive piano hit and a gradual swell alike,
// and safely resolves to "no silence found" (onset 0, nothing trimmed)
// for a sample whose attack is already audible in that opening window.
function findSampleOnset(buffer) {
  const floorWindow = Math.min(buffer.length, Math.round(0.01 * buffer.sampleRate));
  let floorSumSq = 0, floorCount = 0;
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < floorWindow; i++) { floorSumSq += data[i] * data[i]; floorCount++; }
  }
  const noiseFloorRms = floorCount > 0 ? Math.sqrt(floorSumSq / floorCount) : 0;
  const threshold = Math.max(noiseFloorRms * 6, 0.001);

  const winSamples = Math.max(1, Math.round(0.005 * buffer.sampleRate));
  for (let i = 0; i < buffer.length; i += winSamples) {
    let sumSq = 0, count = 0;
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const data = buffer.getChannelData(ch);
      for (let j = i; j < Math.min(i + winSamples, buffer.length); j++) { sumSq += data[j] * data[j]; count++; }
    }
    const rms = count > 0 ? Math.sqrt(sumSq / count) : 0;
    if (rms >= threshold) return i;
  }
  return 0;
}

function computeAttackRms(buffer) {
  const onset = findSampleOnset(buffer);
  const windowSamples = Math.min(buffer.length - onset, Math.round(ATTACK_WINDOW_SEC * buffer.sampleRate));
  if (windowSamples <= 0) return 0;
  let sumSquares = 0, count = 0;
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = onset; i < onset + windowSamples; i++) { sumSquares += data[i] * data[i]; count++; }
  }
  return count > 0 ? Math.sqrt(sumSquares / count) : 0;
}

// Copies [onset - preroll, buffer.length) into a fresh buffer, so index 0
// of the result is (almost) where the note actually starts sounding --
// undoes the recording's own mic pre-roll once, at decode time, instead
// of leaving every future playback to account for it. Keeps a small
// pre-roll because the real attack ramps up through the onset threshold
// rather than starting exactly at it; trimming flush to the threshold
// would clip the leading edge of the transient.
function trimLeadingSilence(buffer, ctx) {
  const onset = findSampleOnset(buffer);
  const prerollSamples = Math.round(0.015 * buffer.sampleRate);
  const start = Math.max(0, onset - prerollSamples);
  if (start <= 0) return buffer;
  const trimmed = ctx.createBuffer(buffer.numberOfChannels, buffer.length - start, buffer.sampleRate);
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    trimmed.copyToChannel(buffer.getChannelData(ch).subarray(start), ch);
  }
  return trimmed;
}

// The multiplier that brings one specific decoded sample up (or down) to
// TARGET_SAMPLE_RMS -- computed once per sample right after it decodes
// (see decodeAllSamples), not per note at playback time.
function sampleGainFor(instrument, name) {
  const gains = STATE.sampleGain[instrument];
  const g = gains && gains[name];
  return g != null ? g : 1; // not measured yet (shouldn't happen once decode finishes) -- unity gain
}

// holdSec, when given, cuts the note off with a short release instead of
// its full natural sample length (~1.8-2.2s per real recording, see
// sounds/CREDITS.md). Every existing caller leaves it undefined and gets
// the old unconditional-decay behavior unchanged -- pads/drones/ambient
// roles WANT their notes ringing/overlapping into each other, that's the
// whole point of a sustained texture. It exists for exactly one caller
// so far (see generateBirthdaySong/playScheduledNote): a real, recognizable
// tune needs its notes actually articulated, not smeared -- rendered and
// pitch-verified evidence (a fixed melody firing notes as little as 0.14s
// apart, each left to ring its own full ~2s sample with no note-off at
// all, produces 3-10+ simultaneously decaying overlapping tones at any
// given instant) is what a monophonic pitch detector run against the
// game's own actual synthesized audio measured before this existed --
// individually correct pitches, playing in the correct order, rendering
// as a wash rather than a legible melody.
const NOTE_RELEASE_SEC = 0.05;
function playResolvedSample(instrument, nearestName, targetMidi, t, peak, dest, holdSec) {
  const buffers = STATE.sampleBuffers[instrument];
  if (!buffers || !nearestName) return;
  const buffer = buffers[nearestName];
  if (!buffer) return;

  const ctx = STATE.audioCtx;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.playbackRate.value = Math.pow(2, (targetMidi - noteNameToMidi(nearestName)) / 12);

  const gain = ctx.createGain();
  const peakGain = peak * sampleGainFor(instrument, nearestName);
  gain.gain.value = peakGain;

  src.connect(gain);
  gain.connect(dest);
  trackSource(src).start(t);

  if (holdSec != null) {
    const releaseStart = t + holdSec;
    gain.gain.setValueAtTime(peakGain, releaseStart);
    gain.gain.linearRampToValueAtTime(0.0001, releaseStart + NOTE_RELEASE_SEC);
    src.stop(releaseStart + NOTE_RELEASE_SEC + 0.02);
  }
}

function playSample(instrument, targetMidi, t, peak, dest, resolvedName, holdSec) {
  playResolvedSample(instrument, resolvedName || nearestSampleNote(instrument, targetMidi), targetMidi, t, peak, dest, holdSec);
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
  gain.gain.value = peak * sampleGainFor(instrument, piece);

  src.connect(gain);
  gain.connect(dest);
  trackSource(src).start(t);
}

function playNoteAt(note, t, peak, dest, holdSec) {
  if (note.role === 'pad') {
    playSampleChord(note.instrument, note.midiList, t, peak, dest, note.resolvedSamples);
  } else if (note.role === 'drum') {
    playDrumHit(note.instrument, note.drumPiece, t, peak, dest);
  } else {
    playSample(note.instrument, note.midi, t, peak, dest, note.resolvedSample, holdSec);
  }
}

function playScheduledNote(note, startTime, beatDur, dest) {
  const t = startTime + note.beat * beatDur;
  const vel = note.vel || 1;
  const peak = (KIND_PEAK[note.role] || 0.4) * vel;
  // See playResolvedSample's own comment -- durBeats only exists on notes
  // that need to be articulated (currently just generateBirthdaySong's
  // melody), so this is a no-op for every other note in the game.
  const holdSec = note.durBeats != null ? note.durBeats * beatDur : null;
  playNoteAt(note, t, peak, dest, holdSec);
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
// Recomputed per call, not cached -- PREMIUM_MUSIC_UNLOCKED is a plain
// const today, but this is also where a real per-player entitlement
// check will plug in once the backend exists, and that can change
// mid-session (e.g. right after a purchase).
function availableGenreFamilies() {
  const unlocked = PREMIUM_MUSIC_UNLOCKED ? GENRE_FAMILIES : GENRE_FAMILIES.filter(f => !f.premium);
  // Sleep mode is exclusively lullaby music, and lullaby music is
  // exclusive to Sleep mode -- it would undercut the "always calm, always
  // slow" promise of the mode if it could also turn up at random in a
  // normal-difficulty rotation.
  const bySleep = STATE.difficulty === 'sleep'
    ? unlocked.filter(f => f.sleepOnly)
    : unlocked.filter(f => !f.sleepOnly);
  // Same idea, one level down: a family scoped to a specific scene (see
  // 'eerie'/Halloween) should never turn up anywhere else, and that scene
  // should never play anything BUT its own scoped family once it has one
  // -- otherwise it would only sound right some of the time, at random,
  // which is the exact complaint that prompted 'eerie' to exist. Skipped
  // in Cockpit Mode, which -- like the birthday-song special case just
  // above this function's own caller -- never reads STATE.scene as a
  // real signal; it renders its own Three.js scene regardless, so a
  // stale 'halloween' left over from classic mode would otherwise lock
  // Cockpit's music to 'eerie' for a scene it isn't actually showing.
  return STATE.scene && !STATE.cockpitMode && bySleep.some(f => f.sceneOnly === STATE.scene)
    ? bySleep.filter(f => f.sceneOnly === STATE.scene)
    : bySleep.filter(f => !f.sceneOnly);
}

function generateSong(pairCount) {
  const families = availableGenreFamilies();
  const family = families[Math.floor(Math.random() * families.length)];
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
            let deg = baseDeg;
            if (!useChordTone) {
              const candidate = baseDeg + (Math.random() < 0.5 ? 1 : -1);
              // Half-step "avoid note" against the sounding chord -- fall
              // back to a chord tone instead (see neighborToneClashes).
              deg = neighborToneClashes(genre, candidate, chordDegrees) ? baseDeg : candidate;
            }
            notes.push({
              beat: humanizeBeat(barStartBeat + stepBeat(step, genre.groove), 0.03),
              midi: foldToInstrumentRange(instrument, scaleMidi(genre, deg, melodyOctaveOffset(genre, instrument, deg))),
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
            midi: foldToInstrumentRange(instrument, scaleMidi(genre, chordRoot, melodyOctaveOffset(genre, instrument, chordRoot))),
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
          midi: foldToInstrumentRange(instrument, scaleMidi(genre, deg, melodyOctaveOffset(genre, instrument, deg))),
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

// The actual "Happy Birthday to You" melody -- public domain (the tune,
// originally "Good Morning to All," 1893, has been public domain in the US
// since the 2015-2016 Marya v. Warner/Chappell Music ruling invalidated
// the lyrics copyright claim). Encoded purely as scale-degree/duration
// note data -- an original instrumental arrangement; no lyrics are
// rendered anywhere in this project. Degrees are 0-indexed and extend past
// the octave (7 = the octave root, 11 = a fourth above that, etc.) for
// direct use with scaleMidi's own degreeIndex/octaveOffset math.
const HAPPY_BIRTHDAY_MELODY = [
  { deg: 4, dur: 0.75 }, { deg: 4, dur: 0.25 }, { deg: 5, dur: 1 }, { deg: 4, dur: 1 }, { deg: 7, dur: 1 }, { deg: 6, dur: 2 },
  { deg: 4, dur: 0.75 }, { deg: 4, dur: 0.25 }, { deg: 5, dur: 1 }, { deg: 4, dur: 1 }, { deg: 8, dur: 1 }, { deg: 7, dur: 2 },
  { deg: 4, dur: 0.75 }, { deg: 4, dur: 0.25 }, { deg: 11, dur: 1 }, { deg: 9, dur: 1 }, { deg: 7, dur: 1 }, { deg: 6, dur: 1 }, { deg: 5, dur: 2 },
  { deg: 10, dur: 0.75 }, { deg: 10, dur: 0.25 }, { deg: 9, dur: 1 }, { deg: 7, dur: 1 }, { deg: 8, dur: 1 }, { deg: 7, dur: 2 },
];

// The Birthday scene (see SCENE_LIST) gets the real tune instead of the
// generic chord/role-driven generateSong above -- player-requested, and
// player feedback confirmed the generic engine's own chord-progression
// melody role never actually happened to land on this one (it's derived
// from a random chord progression, not composed to spell out any specific
// tune). A fixed melody needs its own generator: generateSong's whole
// design is "derive notes from a chord progression + role assignment",
// which has no way to encode a pre-composed piece. Returns the exact same
// shape generateSong does (notes carry beat/midi/role/instrument/vel/
// chunkIndex), so the existing scheduler and chunkGains-gating machinery
// need no changes at all -- only the note SOURCE differs.
//
// Deliberately a solo line, no chordal accompaniment: "Happy Birthday" is
// most commonly performed exactly this way (sung a cappella), and it
// sidesteps a real risk -- a hand-picked chord progression clashing with a
// melody that already implies its own harmony at a couple of points (the
// high climb on "dear ___", the "to" pickup resolving upward each time).
function generateBirthdaySong(pairCount) {
  const genre = {
    family: 'birthday', name: 'happy birthday',
    bpm: 108, rootMidi: 60,
    scaleIntervals: [0, 2, 4, 5, 7, 9, 11], // Ionian (major) -- diatonic throughout, no borrowed tones
  };
  const instrument = 'piano';
  const totalBeats = HAPPY_BIRTHDAY_MELODY.reduce((sum, n) => sum + n.dur, 0);

  const notes = [];
  let beat = 0;
  HAPPY_BIRTHDAY_MELODY.forEach((n, i) => {
    // Contiguous blocks of melody notes per pair (not round-robin) -- the
    // notes themselves always play in their fixed chronological beat
    // position regardless of connection order (chunkIndex only gates
    // volume, same as generateSong), so connecting pairs in order reveals
    // the tune from its opening phrase forward, the way a partial reveal
    // should read.
    const chunkIndex = Math.min(pairCount - 1, Math.floor((i / HAPPY_BIRTHDAY_MELODY.length) * pairCount));
    notes.push({
      beat: humanizeBeat(beat, 0.015),
      midi: foldToInstrumentRange(instrument, scaleMidi(genre, n.deg, 0)),
      role: 'melody', instrument, vel: humanizeVelocity(), chunkIndex,
      // Real piano samples ring their full ~1.8-2.2s length with no
      // note-off (see playResolvedSample) -- fine for a pad/drone role
      // that's SUPPOSED to blend into the next one, wrong for a fixed,
      // recognizable tune whose shortest notes are only ~0.14s apart:
      // rendered and pitch-verified, that left 3-10+ notes ringing over
      // each other at any instant, an unrecognizable wash rather than
      // "Happy Birthday." durBeats gives playScheduledNote something to
      // release against; the *0.85 leaves a small gap before the next
      // note's onset so consecutive notes read as separately articulated,
      // not legato-tied into one continuous tone.
      durBeats: n.dur * 0.85,
    });
    beat += n.dur;
  });

  // Contiguous per-pair blocks (see above) mean an early-connected pair's
  // chunk can otherwise go most of a 25-beat loop (~12s at this bpm)
  // between notes once its own short phrase has played -- the same
  // bounded-audibility guarantee generateSong's own melody notes get.
  // A single capNoteGaps pass only halves each gap (it fills one echo at
  // the midpoint, not enough echoes to close the whole span), which is
  // plenty for generateSong's per-bar-random gaps but not these ~22-beat
  // contiguous-block ones -- so repeat until every chunk actually
  // converges under the cap instead of just being cut in half once.
  for (let i = 0; i < 6 && capNoteGaps(notes, pairCount, totalBeats, 3.5) > 0; i++);

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
// is connected regardless of how the per-bar dice rolls landed. One pass
// only halves each over-cap gap (a single midpoint echo, not enough to
// close the whole span) -- fine for generateSong's usually-modest gaps,
// but callers with much larger gaps (see generateBirthdaySong) need to
// call this repeatedly until it reports no more fillers added. Returns
// the number of fillers added, for exactly that.
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
  return fillers.length;
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
// review). Screen-space-only decorations (spaceObjects, celestialBodies,
// and the base ambient starfield in STATE.stars -- see drawStars' own
// "stars live in screen space" comment) are deliberately NOT included
// here, since they're not part of the world coordinate system at all.
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
  for (const spark of STATE.breakSparks) { spark.x += dx; spark.y += dy; }
  for (const p of STATE.currentPath) { p.x += dx; p.y += dy; }
  STATE.smoothedCursor.x += dx; STATE.smoothedCursor.y += dy;
  if (STATE.portals) {
    STATE.portals.a.x += dx; STATE.portals.a.y += dy;
    STATE.portals.b.x += dx; STATE.portals.b.y += dy;
  }
  for (const t of STATE.portalThreads) {
    for (const seg of t.segments) { seg.x1 += dx; seg.y1 += dy; seg.x2 += dx; seg.y2 += dy; }
    for (const p of t.points) { p.x += dx; p.y += dy; }
  }
  if (STATE.ship) {
    STATE.ship.x += dx; STATE.ship.y += dy;
    // The steering target is stale/meaningless when nothing is actively
    // held (hasTarget false), but shifting it unconditionally anyway costs
    // nothing and avoids the ship lurching toward a now-wrong-relative
    // point on whatever the next held frame happens to be.
    STATE.ship.targetX += dx; STATE.ship.targetY += dy;
  }
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
  const oldWidth = canvas.width, oldHeight = canvas.height;
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  if (COCKPIT.renderer) {
    COCKPIT.renderer.setSize(window.innerWidth, window.innerHeight);
    COCKPIT.camera.aspect = window.innerWidth / window.innerHeight;
    COCKPIT.camera.updateProjectionMatrix();
  }
  // The WAVE_COMPLETE starfield reveal (see fillBaseStarfield) fills
  // screen-space stars once, sized to the canvas at that exact moment.
  // Mobile browser chrome (address bar collapsing/reappearing on
  // scroll/tap, orientation change) resizes the viewport out from under
  // an already-showing reveal far more often than a desktop window ever
  // does mid-session -- without topping the starfield back up here, any
  // newly-exposed area would stay permanently starless instead of
  // matching the rest of the sky's density. topUpStarfieldForResize (not
  // a plain fillBaseStarfield() call) handles this precisely, including
  // an area-preserving orientation flip that a whole-canvas top-up would
  // silently do nothing for.
  if (STATE.phase === 'WAVE_COMPLETE' && (canvas.width !== oldWidth || canvas.height !== oldHeight)) {
    topUpStarfieldForResize(oldWidth, oldHeight);
  }
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

// Free in Relaxed and Normal (see updateWaveDisplay for the button's own
// visibility, which stays shown even in Intense now so there's something
// to tap that explains why nothing happens, rather than the button just
// disappearing without a word). Guarded here too, not just via the
// button's own look, so nothing else that might call this directly could
// bypass the Intense gate.
function triggerHintPulse() {
  if (STATE.difficulty === 'intense') {
    showHintToast('Hints: Relaxed & Normal Only');
    return;
  }
  STATE.hintPulse = { startTime: performance.now() };
  playHintChime();
}

// Mirrors showShareToast's fade-in/auto-hide pattern, just with a longer
// visible window -- this one is a short explanatory sentence a player
// needs to actually read, not a one-glance confirmation word.
function showHintToast(text) {
  const toast = document.getElementById('hint-toast');
  toast.textContent = text;
  // #top-buttons-row wraps to a second line on narrow viewports (see its
  // own flex-wrap rule) -- a fixed top offset sized for one line would
  // land the toast on top of the wrapped row instead of below it.
  // Anchoring to the row's own measured bottom works regardless of how
  // many lines it's actually wrapped to right now.
  const rowBottom = document.getElementById('top-buttons-row').getBoundingClientRect().bottom;
  toast.style.top = `${rowBottom + 8}px`;
  toast.classList.add('visible');
  clearTimeout(showHintToast._timer);
  showHintToast._timer = setTimeout(() => toast.classList.remove('visible'), 4200);
}

// A short, generic confirmation ping to go with the hint flash --
// deliberately not tied to the current song/instrument the way
// playConnectionChime is (a hint isn't part of the music, it's a UI
// action), just a synthesized blip so the flash has an audible cue too.
function playHintChime() {
  if (!STATE.audioCtx || !STATE.masterBus) return;
  const ctx = STATE.audioCtx;
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(880, t);
  osc.frequency.exponentialRampToValueAtTime(1320, t + 0.09);
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(0.25, t + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
  osc.connect(gain);
  gain.connect(STATE.masterBus);
  osc.start(t);
  osc.stop(t + 0.25);
  trackSource(osc);
}

// Relaxed/Sleep-difficulty only (see updateWaveDisplay for #pause-erase's
// own visibility). Stays on across multiple erases -- rather than a
// one-shot action -- so redoing several lines in a row doesn't mean
// reopening the menu each time; toggling it back off from the menu,
// pausing via any other exit, or leaving the wave all clear it.
function toggleEraseMode() {
  STATE.eraseMode = !STATE.eraseMode;
  document.getElementById('pause-erase').classList.toggle('active', STATE.eraseMode);
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

// Relaxed/Sleep only (see QOL_DIFFICULTIES): while a line is being drawn,
// every dot outside the group being connected dims to make the matching
// dot(s) easy to spot. Driven entirely off live STATE each frame (no
// separate on/off state to set or clear), so it can't get stuck dim if a
// drag is cancelled, a stale gesture is cleared on focus loss, etc. -- the
// moment isDrawing goes false, drawDot stops calling this and brightness
// is back to normal.
function shouldDimForActiveDraw(dot) {
  return QOL_DIFFICULTIES.has(STATE.difficulty) && STATE.isDrawing && !STATE.cockpitMode
    && STATE.activeDot && dot.pairId !== STATE.activeDot.pairId;
}

// How dark a non-matching dot goes while the assist is active. 0.5 (the
// original value) still left dimmed dots reading as "just a bit darker"
// next to the full-brightness ones being matched, rather than clearly
// receding out of the way (player feedback: the contrast needed to be much
// stronger). Kept well above 0 -- dots must stay visible enough to still
// see the board's overall shape and count what's left, not vanish.
const ACTIVE_DRAW_DIM_MULTIPLIER = 0.15;

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
  // Computed once and applied everywhere globalAlpha gets set below --
  // the hint-flash overlay and the final white core circle both assign
  // globalAlpha directly (not multiply), so without this they'd ignore
  // the dimming assist entirely at every flash peak (review, #52).
  const dimMultiplier = shouldDimForActiveDraw(dot) ? ACTIVE_DRAW_DIM_MULTIPLIER : 1;
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
  ctx.globalAlpha *= dimMultiplier;
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
    ctx.globalAlpha = hintBrightness * dimMultiplier;
    ctx.shadowColor = '#ffffff';
    ctx.shadowBlur = 18 + hintBrightness * 25;
    ctx.beginPath();
    traceDotShapePath(shape, dot.x, dot.y, radius);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.globalAlpha = dimMultiplier;
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
function cancelStaleDrawGesture(e) {
  // Flight Mode deliberately leaves isDrawing true on a normal release so
  // the ship can coast toward/through a dot with the finger already up
  // (see onInputEnd's flight branch) -- this window-level 'mouseup' still
  // fires right after canvas's own bubble-phase handler for EVERY release,
  // including that one, so treating it the same as a genuinely stale/
  // interrupted gesture would cancel every flight-mode connection the
  // instant a mouse button lifts. Stop steering instead, same as a normal
  // release does, and leave the connection itself alone (review, #42).
  if (STATE.flightMode && STATE.ship) {
    STATE.ship.hasTarget = false;
  } else if (STATE.isDrawing) {
    cancelActiveLine();
  }
  STATE.eraseArmed = false;

  // Cockpit Mode: a held key/mouse button or an in-progress stick touch has
  // exactly the same "interrupted, no matching end event" problem -- iOS
  // can fire touchcancel instead of touchend, and losing window focus
  // entirely (alt-tab, another app) skips keyup/mouseup altogether. Without
  // this, updateCockpitShip keeps steering/thrusting after the player
  // returns, and a cancelled stick touch permanently blocks that side from
  // ever accepting a new finger, since only a real touchend clears it
  // (review, #45).
  STATE.cockpitLeftStick = null;
  STATE.cockpitRightStick = null;
  STATE.cockpitKeys.w = false;
  STATE.cockpitKeys.a = false;
  STATE.cockpitKeys.s = false;
  STATE.cockpitKeys.d = false;
  STATE.cockpitKeys.up = false;
  STATE.cockpitKeys.down = false;
  STATE.cockpitKeys.zoomIn = false;
  STATE.cockpitKeys.zoomOut = false;
  STATE.cockpitMouseButtons.left = false;
  STATE.cockpitMouseButtons.right = false;
  // Unlike the raw inputs above, the smoothed turn/throttle (see
  // CONTROL_SMOOTHING) are only force-zeroed on a genuine interruption --
  // this same handler also fires on every ordinary mouseup (see this
  // function's own comment above), and an ordinary mouseup releasing the
  // throttle button doesn't mean steering stopped too: mouse-position
  // steering is a separate, still-active input. Zeroing turn unconditionally
  // there dropped a steady turn to zero and back every time throttle was
  // released, a visible ~200ms hitch on every single release (review, #47).
  // A real interruption's raw inputs are already cleared above, so leaving
  // this unset there just means a few frames of natural decay instead of an
  // instant snap -- not a "keeps steering forever" regression.
  if (e && (e.type === 'blur' || e.type === 'touchcancel')) {
    STATE.cockpitThrottleSmoothed = 0;
    STATE.cockpitTurnSmoothed = { x: 0, y: 0 };
  }
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

// Cockpit Mode's desktop control scheme -- WASD/arrows/mouse, alongside
// (not instead of) the two on-screen sticks used on touch (see
// cockpitTouchStart/Move/End above and refreshCockpitControlVisibility for
// which one a given device actually sees). Registered unconditionally at
// window level, same as the listeners above -- each handler is a no-op
// unless STATE.cockpitMode is actually active, so there's no cost or
// interference for classic/Flight Mode.
window.addEventListener('keydown', handleCockpitKeyDown);
window.addEventListener('keyup', handleCockpitKeyUp);
window.addEventListener('mousemove', handleCockpitMouseMove);
window.addEventListener('mousedown', handleCockpitMouseDown);
window.addEventListener('mouseup', handleCockpitMouseUp);
// The right mouse button is "accelerate" in Cockpit Mode (see
// handleCockpitMouseDown) -- the browser's own right-click context menu
// must never appear over it, or holding it down would be interrupted by a
// menu popping up mid-flight.
window.addEventListener('contextmenu', (e) => { if (STATE.cockpitMode && STATE.phase === 'PLAYING') e.preventDefault(); });

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
  STATE.eraseArmed = false; // the first finger only grazed a line on its way into a pinch, not a tap on it
  // Otherwise the ship keeps accelerating toward the pre-pinch single-
  // finger touch point for the whole zoom gesture -- and onInputEnd's own
  // pinch handling (`if (STATE.pinch) { STATE.pinch = null; return; }`)
  // returns before ever reaching the Flight Mode release branch, so that
  // stale target would otherwise still be active even after both fingers
  // lift (review, #42).
  if (STATE.flightMode && STATE.ship) STATE.ship.hasTarget = false;
  STATE.pinch = { startDist: pinchDistance(e.touches), startZoom: STATE.camera.userZoom };
}

function updatePinch(e) {
  if (!STATE.pinch) { beginPinch(e); return; }
  setUserZoom(STATE.pinch.startZoom * (pinchDistance(e.touches) / STATE.pinch.startDist));
}

function onWheelZoom(e) {
  if (STATE.phase !== 'PLAYING' || STATE.paused) return;
  e.preventDefault();
  if (STATE.cockpitMode) {
    // Scroll up (negative deltaY) narrows the FOV -- zooms in -- same
    // direction classic mode's own scroll-to-zoom uses (see setUserZoom).
    if (STATE.cockpitFov != null) {
      STATE.cockpitFov = Math.max(COCKPIT_CONFIG.FOV_MIN, Math.min(COCKPIT_CONFIG.FOV_MAX,
        STATE.cockpitFov + e.deltaY * COCKPIT_CONFIG.FOV_WHEEL_STEP));
    }
    return;
  }
  setUserZoom(STATE.camera.userZoom - e.deltaY * CAMERA_CONFIG.WHEEL_ZOOM_STEP);
}

function onInputStart(e) {
  e.preventDefault();
  if (STATE.paused) return; // pause menu handles its own input via real DOM buttons

  // Cockpit Mode's joystick is single-touch only -- a second finger landing
  // (accidentally or not) must never fall into the pinch-zoom path, which
  // would leave the joystick's matching release unresolved (see
  // onInputEnd's STATE.pinch check, which returns before ever reaching the
  // cockpit branch below) and the ship stuck thrusting forever.
  if (!STATE.cockpitMode && STATE.phase === 'PLAYING' && e.touches && e.touches.length >= 2) {
    beginPinch(e);
    return;
  }

  initAudio();

  // Starting a wave from the title screen is now only reachable through
  // the explicit Start Game button (see startGameFromTitle) -- a plain
  // tap/click here on the title screen's canvas backdrop is a no-op,
  // falling through to the `phase !== 'PLAYING'` return below.

  if (STATE.phase === 'WAVE_COMPLETE') {
    if (STATE.waveCompleteAdvanceFn) STATE.waveCompleteAdvanceFn();
    return;
  }

  if (STATE.phase !== 'PLAYING') return;

  const pos = getEventPos(e);

  // Erase mode takes over the tap entirely -- a miss (empty space or a
  // dot) is just a no-op rather than falling through to start a new line
  // or a pan, which would let a player accidentally draw or scroll while
  // they're clearly trying to remove something instead. The actual hit
  // test is deferred to onInputEnd (see STATE.eraseArmed), not resolved
  // here on first contact: on a touch device, a pinch's first finger
  // lands as its own touchstart before the second one arrives, so acting
  // immediately here could permanently erase a line the player only
  // grazed while starting to zoom. beginPinch() clears eraseArmed the
  // moment a second finger confirms it's a pinch, not a tap.
  if (STATE.eraseMode) {
    STATE.eraseArmed = true;
    return;
  }

  // In Cockpit Mode, touch is the two on-screen sticks (see
  // cockpitTouchStart) -- it never starts a drag-from-a-dot gesture or a
  // camera pan the way classic mode's touch does. Desktop mouse input goes
  // through its own always-on listeners instead (handleCockpitMouseMove/
  // Down/Up, registered separately) -- a plain click here does nothing.
  if (STATE.cockpitMode) {
    if (e.touches) cockpitTouchStart(e);
    return;
  }

  // In Flight Mode a touch/click anywhere is a steering command, not a
  // drag-from-a-dot gesture -- the ship free-flies to wherever is pointed
  // at, and flying through a dot is what starts/continues a connection
  // (see updateShipDrawing). This takes over single-touch input the same
  // gesture would otherwise use for empty-space panning below; pinch-zoom
  // (2+ touches, handled above) is untouched.
  if (STATE.flightMode) {
    flightInputStart(pos, getEventScreenPos(e));
    return;
  }

  const dot = findDotAt(pos.x, pos.y, false);
  if (dot) {
    STATE.activeDot = dot;
    STATE.isDrawing = true;
    STATE.currentPath = [{ x: dot.x, y: dot.y }];
    STATE.smoothedCursor = { x: dot.x, y: dot.y };
    STATE.lastDrawScreenPos = getEventScreenPos(e);
    return;
  }

  // A drag can also start AT a portal, but only to continue a thread
  // already waiting on its OTHER side (see completePortalLeg) -- e.g. the
  // thread entered at side 'a', so only side 'b' can pick it up. Starting
  // fresh at a portal with nothing to continue there is just a no-op, same
  // as tapping any other empty spot; it deliberately never falls through
  // to a pan either, so a mis-tap near a portal can't be mistaken for the
  // start of a camera drag.
  if (STATE.portals) {
    const portal = findPortalAt(pos.x, pos.y);
    if (portal) {
      const thread = STATE.portalThreads.find(t => t.enteredSide !== portal.side);
      if (thread) {
        STATE.activeDot = thread.dotA;
        STATE.activePortalThread = thread;
        STATE.isDrawing = true;
        STATE.currentPath = [{ x: portal.x, y: portal.y }];
        STATE.smoothedCursor = { x: portal.x, y: portal.y };
        STATE.lastDrawScreenPos = getEventScreenPos(e);
      }
      return;
    }
  }

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
}

function onInputMove(e) {
  e.preventDefault();
  if (STATE.paused) return;

  if (!STATE.cockpitMode && STATE.phase === 'PLAYING' && e.touches && e.touches.length >= 2) {
    updatePinch(e);
    return;
  }

  if (STATE.cockpitMode && STATE.phase === 'PLAYING') {
    if (e.touches) cockpitTouchMove(e);
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

  // Gated on ship.hasTarget rather than STATE.isDrawing -- the player can
  // be actively steering (still hasn't flown through a dot yet, so no
  // connection is in progress) or mid-connection; either way, moving the
  // steering point should keep updating where the ship is headed.
  if (STATE.flightMode && STATE.phase === 'PLAYING' && STATE.ship && STATE.ship.hasTarget) {
    flightInputMove(getEventPos(e), getEventScreenPos(e));
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
  // In Flight Mode, steering toward the edge should reveal more of a wide
  // world the same way dragging a classic line there does -- gated on
  // ship.hasTarget rather than STATE.isDrawing, since the player can be
  // steering toward a dot they haven't reached (and so haven't started a
  // connection) yet.
  const steering = STATE.isDrawing || (STATE.flightMode && STATE.ship && STATE.ship.hasTarget);
  if (!steering || !STATE.lastDrawScreenPos) return;
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
  // Classic mode only: there, the pointer position IS the thing drawing
  // the line. In Flight Mode the pointer is just a steering target, often
  // far from the ship itself (that's the whole point of momentum) --
  // feeding it into currentPath here would record a jump between the
  // ship's real position (added separately, every frame, by
  // updateShipDrawing) and this distant point, inflating the line's score
  // and risking false barrier/crossing rejections (review, #42). The
  // camera still pans either way; only which path gets extended differs.
  if (STATE.isDrawing && !STATE.flightMode) advanceDrawingTo(screenToWorld(x, y));
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

  // Resolved here, not on the original touchstart/mousedown (see
  // onInputStart) -- by the time a release actually lands, any pinch this
  // gesture might have turned into has already cleared eraseArmed via
  // beginPinch, so reaching here with it still true means this really was
  // just a tap.
  if (STATE.eraseMode) {
    if (STATE.eraseArmed) {
      STATE.eraseArmed = false;
      let pos = getEventPos(e);
      if (e.changedTouches && e.changedTouches.length > 0) {
        const rect = canvas.getBoundingClientRect();
        pos = screenToWorld(e.changedTouches[0].clientX - rect.left, e.changedTouches[0].clientY - rect.top);
      }
      const conn = findConnectionAt(pos.x, pos.y);
      if (conn) eraseConnection(conn);
    }
    return;
  }

  if (STATE.cockpitMode) {
    if (e.changedTouches) cockpitTouchEnd(e);
    return;
  }

  // Letting go only stops steering -- it doesn't stop the ship. Momentum
  // (see updateShip's drag decay) carries it the rest of the way toward
  // wherever it was last headed, and any connection already in progress
  // keeps extending/getting checked against dots every frame regardless of
  // whether a finger is still down (see updateShipDrawing). There's
  // nothing else to resolve here the way a classic release resolves a
  // whole connection at once.
  if (STATE.flightMode && STATE.ship) {
    STATE.ship.hasTarget = false;
    return;
  }

  if (!STATE.isDrawing || !STATE.activeDot) return;

  STATE.isDrawing = false;
  STATE.lastDrawScreenPos = null;

  let pos = getEventPos(e);
  if (e.changedTouches && e.changedTouches.length > 0) {
    const rect = canvas.getBoundingClientRect();
    pos = screenToWorld(e.changedTouches[0].clientX - rect.left, e.changedTouches[0].clientY - rect.top);
  }

  const targetDot = findDotAt(pos.x, pos.y, false);

  if (!targetDot) {
    // Only a fresh drag from a real dot -- not one already continuing a
    // portal thread (see STATE.activePortalThread) -- can end AT a portal.
    // Reaching a second portal mid-continuation has no sensible meaning
    // here, so it's just left to fall through to the plain-miss cancel
    // below like any other non-dot release would.
    if (!STATE.activePortalThread && STATE.portals) {
      const portal = findPortalAt(pos.x, pos.y);
      if (portal) {
        // Same reasoning as the dot case below: snap the recorded path to
        // the portal's exact center before checking/storing it, or the
        // stored leg (and whatever eventually renders along it) trails
        // off short of the portal by a visible gap.
        STATE.currentPath.push({ x: portal.x, y: portal.y });
        const crossedConnections = findCrossedConnections(STATE.currentPath);
        const crossedBarriers = findCrossedBarriers(STATE.currentPath);
        if (crossedConnections.length > 0 || crossedBarriers.length > 0) {
          if (crossedConnections.length > 0) flashBlockingConnections(crossedConnections);
          if (crossedBarriers.length > 0) flashBlockingBarriers(crossedBarriers);
          rejectConnection();
          return;
        }
        // This leg isn't a completed connection yet (see completePortalLeg),
        // so wouldStrandAnyDot's own dotA/dotB wrapper doesn't apply -- no
        // second dot to simulate a union with -- but the geometry it's
        // about to leave permanently on the board is exactly as capable of
        // walling something off as a real connection is.
        if (wouldNewSegmentsStrandAnyDot(smoothedCurveSegments(STATE.currentPath), null, null)) {
          rejectConnection();
          return;
        }
        completePortalLeg(STATE.activeDot, portal);
        return;
      }
    }
    cancelActiveLine();
    return;
  }

  if (targetDot.id === STATE.activeDot.id) {
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

  const crossedConnections = findCrossedConnections(STATE.currentPath);
  const crossedBarriers = findCrossedBarriers(STATE.currentPath);
  if (crossedConnections.length > 0 || crossedBarriers.length > 0) {
    if (crossedConnections.length > 0) flashBlockingConnections(crossedConnections);
    if (crossedBarriers.length > 0) flashBlockingBarriers(crossedBarriers);
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

  completeConnection(STATE.activeDot, targetDot, STATE.activePortalThread);
  STATE.activePortalThread = null;
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

// Portal counterpart to findDotAt -- see PORTAL_CONFIG/STATE.portals. No
// per-wave "includeConnected"-style exclusion: a portal doesn't belong to
// any one pending thread, so it stays touchable for as long as it exists.
function findPortalAt(x, y) {
  if (!STATE.portals) return null;
  if (Math.hypot(STATE.portals.a.x - x, STATE.portals.a.y - y) <= PORTAL_CONFIG.HIT_RADIUS) {
    return { side: 'a', x: STATE.portals.a.x, y: STATE.portals.a.y };
  }
  if (Math.hypot(STATE.portals.b.x - x, STATE.portals.b.y - y) <= PORTAL_CONFIG.HIT_RADIUS) {
    return { side: 'b', x: STATE.portals.b.x, y: STATE.portals.b.y };
  }
  return null;
}

// Erase-mode counterpart to findDotAt -- hit-tests against the same
// finely-sampled curve segments completeConnection stored (see
// smoothedCurveSegments), so a tap registers against exactly what the
// player sees drawn, not a coarser straight-line approximation of it.
// Returns whichever eligible connection is actually CLOSEST to the tap,
// not just the first one found in STATE.connections' insertion order --
// two valid, non-crossing lines can legitimately run within
// ERASE_HIT_RADIUS of each other (close parallel routing is normal,
// legal gameplay), and picking by draw order rather than proximity could
// silently erase the wrong one of the two.
function findConnectionAt(x, y) {
  let closest = null;
  let closestDist = CONFIG.ERASE_HIT_RADIUS;
  for (const conn of STATE.connections) {
    for (const seg of conn.segments) {
      const dist = distPointToSegment(x, y, seg.x1, seg.y1, seg.x2, seg.y2);
      if (dist <= closestDist) {
        closest = conn;
        closestDist = dist;
      }
    }
  }
  return closest;
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

// Minimum distance between two line segments, plus the point where that
// minimum is achieved. Assumes they don't actually intersect (guaranteed
// here -- a crossing connection is already rejected before
// completeConnection ever runs), in which case the minimum distance is
// always at one of the four endpoints.
function closestApproach(a, b) {
  const candidates = [
    { d: distPointToSegment(a.x1, a.y1, b.x1, b.y1, b.x2, b.y2), x: a.x1, y: a.y1 },
    { d: distPointToSegment(a.x2, a.y2, b.x1, b.y1, b.x2, b.y2), x: a.x2, y: a.y2 },
    { d: distPointToSegment(b.x1, b.y1, a.x1, a.y1, a.x2, a.y2), x: b.x1, y: b.y1 },
    { d: distPointToSegment(b.x2, b.y2, a.x1, a.y1, a.x2, a.y2), x: b.x2, y: b.y2 },
  ];
  let best = candidates[0];
  for (const c of candidates) if (c.d < best.d) best = c;
  return best;
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

  // Excluding by the *closest-approach point* between the two segments,
  // not by the drawn segment's own midpoint -- a long segment (e.g. a
  // direct second connection from a dot that's already got one, in a
  // 3+-dot group) can have its midpoint far from either dot while still
  // touching an existing line right at their shared dot. Checking the
  // actual near-point catches that; checking the segment's midpoint
  // doesn't (flagged by Codex review on #24: this was misreading an
  // ordinary shared-dot spoke as an "incredible squeeze").
  const excludeR = CONFIG.DOT_RADIUS_CONNECTED_MAX + CONNECTION_PRAISE_CONFIG.SQUEEZE_EXCLUDE_RADIUS;
  let minClearance = Infinity;
  for (const seg of newSegments) {
    for (const b of STATE.barriers) {
      for (const bSeg of segmentsOfBarrier(b)) {
        const approach = closestApproach(seg, bSeg);
        if (Math.hypot(approach.x - dotA.x, approach.y - dotA.y) < excludeR) continue;
        if (Math.hypot(approach.x - dotB.x, approach.y - dotB.y) < excludeR) continue;
        minClearance = Math.min(minClearance, approach.d);
      }
    }
    for (const c of STATE.connections) {
      for (const cSeg of c.segments) {
        const approach = closestApproach(seg, cSeg);
        if (Math.hypot(approach.x - dotA.x, approach.y - dotA.y) < excludeR) continue;
        if (Math.hypot(approach.x - dotB.x, approach.y - dotB.y) < excludeR) continue;
        minClearance = Math.min(minClearance, approach.d);
      }
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
// A qualifying connection is common enough on a busy board that, without a
// cooldown, popups could fire back-to-back or even stack -- reported as
// annoying/obtrusive rather than rewarding. This caps it to at most one
// every 12 seconds real time, regardless of how many connections in that
// window would otherwise have qualified.
const CONNECTION_PRAISE_COOLDOWN_MS = 12000;

// Escalates note count with tier, like a crowd's reaction growing with the
// play -- tier 0 is a light two-note nudge, tier 2 adds a rising flourish.
function playConnectionPraiseRiff(tier) {
  if (!STATE.audioCtx || !STATE.masterBus) return;
  const instrument = STATE.sampleBuffers.vibraphone ? 'vibraphone' : 'piano';
  const root = STATE.song ? STATE.song.genre.rootMidi : 60;
  // Sleep mode keeps the banner text (still a nice "well drawn" nudge,
  // still not a competitive tally -- see queueAchievement's own comment
  // on why that distinction matters) but drops the bright ascending
  // multi-note fanfare down to one quiet note, regardless of tier. Full
  // silence here would make a good line feel unacknowledged; the full
  // riff is squarely the kind of "stimulus" Sleep mode exists to remove
  // everywhere else (player request).
  if (STATE.difficulty === 'sleep') {
    playSample(instrument, root + 12, STATE.audioCtx.currentTime + 0.02, 0.12, STATE.masterBus);
    return;
  }
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

// `portalPrefix` (see completePortalLeg/STATE.portalThreads) is the other,
// already-drawn half of a portal-mediated connection, if this one is
// finishing through a portal -- its segments/length just get folded into
// this connection's own, and it's the ONLY thing this function needs to
// know about portals at all. Concatenating two independently-smoothed
// segment arrays (rather than re-smoothing across the two legs as one
// path) is what keeps the visible gap between the portals a real gap --
// no synthetic segment ever connects the last point of one leg to the
// first point of the other, so nothing downstream (traveling lights,
// crossing-checks, world-growth shifting) needs to know the join is even
// there. Undefined/null for every ordinary, non-portal connection, which
// is the overwhelming majority -- behavior there is unchanged.
function completeConnection(dotA, dotB, portalPrefix) {
  ufUnion(dotA.id, dotB.id);
  markGroupIfFullySolved(dotA.pairId);

  const legSegments = smoothedCurveSegments(STATE.currentPath);
  const legLen = pathLength(STATE.currentPath);
  const newSegments = portalPrefix ? [...portalPrefix.segments, ...legSegments] : legSegments;
  const actualLen = portalPrefix ? portalPrefix.length + legLen : legLen;
  // Same rule fact boxes already follow (see FACT_BOX_CONFIG/isTutorialWave
  // in generateBarriersSafely): never coexist with the tutorial hint. A
  // praise popup positions itself at whatever dot the connection just
  // completed at, with no awareness of the hint's own reserved zone, so it
  // could otherwise land squarely on top of the tutorial text a player is
  // still reading. Also skipped entirely while still in cooldown from the
  // last one shown (see CONNECTION_PRAISE_COOLDOWN_MS) -- a genuinely
  // praise-worthy connection made mid-cooldown just doesn't get one, rather
  // than queuing or stacking.
  const offCooldown = performance.now() - STATE.lastPraiseAt >= CONNECTION_PRAISE_COOLDOWN_MS;
  const praise = (STATE.tutorialWave || !offCooldown) ? null : evaluateConnectionPraise(dotA, dotB, newSegments, actualLen);

  const scoreAwarded = Math.round(actualLen * SCORE_PER_LINE_PIXEL);

  STATE.connections.push({
    dotA: dotA.id,
    dotB: dotB.id,
    colorIndex: dotA.colorIndex,
    pairId: dotA.pairId,
    segments: newSegments,
    scoreAwarded, // reversed in resetPairConnections if this edge is ever broken or erased
  });

  const fadingLine = {
    colorIndex: dotA.colorIndex,
    pairId: dotA.pairId,
    points: STATE.currentPath.map(p => ({ x: p.x, y: p.y, alpha: 1.0 })),
    bornAt: performance.now(),
    settled: false,
  };
  STATE.lines.push(fadingLine);
  // The portal leg's own points already became their own separate
  // STATE.lines entry when it was first drawn (completePortalLeg) --
  // merging them into one entry here would reintroduce exactly the
  // cross-board-jump problem concatenating segments (above) avoids, since
  // line.points gets walked as one continuous curve wherever it's
  // rendered. Two independent fading lines that happen to share a pairId
  // is already a normal shape (any 3+-dot group has multiple), and
  // resetPairConnections already clears every line for a pairId at once,
  // so nothing else needs to change to support it.
  if (portalPrefix) {
    const idx = STATE.portalThreads.indexOf(portalPrefix);
    if (idx !== -1) STATE.portalThreads.splice(idx, 1);
  }

  spawnStarsAroundDots(dotA, dotB);

  unmuteChunk(dotA.pairId);
  playConnectionChime(dotA.pairId);
  if (praise) {
    spawnConnectionPraise(dotB, praise);
    STATE.lastPraiseAt = performance.now();
  }

  haptic('connect');

  STATE.score += scoreAwarded;
  updateWaveDisplay();

  checkTutorialDismiss();

  STATE.activeDot = null;
  STATE.currentPath = [];

  checkWaveComplete();
}

// Reaching a portal doesn't complete a color pair by itself -- a portal is
// a waypoint, not a dot (see STATE.portals/PORTAL_CONFIG) -- so this
// deliberately skips everything completeConnection does for a REAL finish:
// no union-find, no score, no chime or unmuted music stem, no
// achievement/praise check. It just banks this leg as a STATE.portalThreads
// entry and gives it the same fading-line visual any drawn line gets, so
// it reads as a real, permanent stroke on the board rather than vanishing.
// A new drag starting from the portal's OTHER side (see onInputStart) picks
// the thread back up, and the pair only actually completes once that second
// leg reaches dotA's real matching dot (see completeConnection's
// portalPrefix parameter).
function completePortalLeg(dotA, portal) {
  const segments = smoothedCurveSegments(STATE.currentPath);
  const points = STATE.currentPath.map(p => ({ x: p.x, y: p.y, alpha: 1.0 }));
  const length = pathLength(STATE.currentPath);

  STATE.portalThreads.push({ enteredSide: portal.side, dotA, segments, points, length });

  STATE.lines.push({
    colorIndex: dotA.colorIndex,
    pairId: dotA.pairId,
    points,
    bornAt: performance.now(),
    settled: false,
  });

  haptic('connect');

  STATE.activeDot = null;
  STATE.currentPath = [];
}

function rejectConnection() {
  haptic('reject');
  STATE.activeDot = null;
  STATE.currentPath = [];
  STATE.isDrawing = false;
  STATE.lastDrawScreenPos = null;
  // The thread itself (if any) is untouched in STATE.portalThreads -- only
  // completeConnection ever removes one, on success -- so this just clears
  // which one THIS gesture was continuing, letting a fresh drag from the
  // portal pick the same thread back up rather than losing the first leg
  // just because the second one didn't land.
  STATE.activePortalThread = null;
}

function cancelActiveLine() {
  STATE.activeDot = null;
  STATE.currentPath = [];
  STATE.isDrawing = false;
  STATE.lastDrawScreenPos = null;
  STATE.activePortalThread = null;
}

// ------------------------------------------------------------
// FLIGHT MODE
//
// An alternate control scheme for the same waves (see STATE.flightMode,
// picked on the title screen): instead of dragging a finger from dot to
// dot, the player pilots a ship that's present on the board for the whole
// wave. Touching/holding anywhere steers the ship there with momentum;
// releasing just lets it coast. Flying through an eligible dot starts a
// connection the same way touching one does in the classic control
// scheme, and flying through a second one completes it -- the ship's own
// flight path becomes the connecting line, recorded through the exact
// same STATE.currentPath / advanceDrawingTo machinery the classic drag
// already uses, so scoring, rendering, barrier/crossing checks, and the
// portal mechanic all work unmodified underneath this.
//
// Deliberately NOT physically blocked by barriers -- a classic drag's
// finger can also freely move over a barrier while dragging; only the
// crossing check at the moment a connection actually completes ever
// rejects it (see attemptFlightConnection/attemptFlightPortalLeg). Flight
// Mode keeps that exact rule rather than adding new collision physics.
// ------------------------------------------------------------
const FLIGHT_CONFIG = {
  MAX_SPEED: 9,      // px/frame at full thrust
  ACCEL: 0.6,          // px/frame^2 applied toward the current steering point
  DRAG: 0.94,           // velocity multiplier per frame once released, so the ship coasts to a stop
                         // instead of stopping dead the instant a finger lifts
  SHIP_RADIUS: 14,       // visual hull size, world px
};

function flightInputStart(pos, screenPos) {
  STATE.ship.hasTarget = true;
  STATE.ship.targetX = pos.x;
  STATE.ship.targetY = pos.y;
  STATE.lastDrawScreenPos = screenPos; // so updateEdgePan can still reveal more of a wide world while steering
}

function flightInputMove(pos, screenPos) {
  STATE.ship.targetX = pos.x;
  STATE.ship.targetY = pos.y;
  STATE.lastDrawScreenPos = screenPos;
}

// Same decision tree onInputEnd's dot branch uses, just reached by flying
// through a dot instead of releasing on top of one.
function attemptFlightConnection(targetDot) {
  if (targetDot.colorIndex !== STATE.activeDot.colorIndex) {
    rejectConnection();
    return;
  }
  if (ufConnected(STATE.activeDot.id, targetDot.id)) {
    cancelActiveLine();
    return;
  }
  STATE.currentPath.push({ x: targetDot.x, y: targetDot.y });
  const crossedConnections = findCrossedConnections(STATE.currentPath);
  const crossedBarriers = findCrossedBarriers(STATE.currentPath);
  if (crossedConnections.length > 0 || crossedBarriers.length > 0) {
    if (crossedConnections.length > 0) flashBlockingConnections(crossedConnections);
    if (crossedBarriers.length > 0) flashBlockingBarriers(crossedBarriers);
    rejectConnection();
    return;
  }
  if (wouldStrandAnyDot(smoothedCurveSegments(STATE.currentPath), STATE.activeDot, targetDot)) {
    rejectConnection();
    return;
  }
  completeConnection(STATE.activeDot, targetDot, STATE.activePortalThread);
  STATE.activePortalThread = null;
}

// Same decision tree onInputEnd's portal branch uses, reached by flying
// into the open portal side instead of releasing on it.
function attemptFlightPortalLeg(portal) {
  STATE.currentPath.push({ x: portal.x, y: portal.y });
  const crossedConnections = findCrossedConnections(STATE.currentPath);
  const crossedBarriers = findCrossedBarriers(STATE.currentPath);
  if (crossedConnections.length > 0 || crossedBarriers.length > 0) {
    if (crossedConnections.length > 0) flashBlockingConnections(crossedConnections);
    if (crossedBarriers.length > 0) flashBlockingBarriers(crossedBarriers);
    rejectConnection();
    return;
  }
  if (wouldNewSegmentsStrandAnyDot(smoothedCurveSegments(STATE.currentPath), null, null)) {
    rejectConnection();
    return;
  }
  completePortalLeg(STATE.activeDot, portal);
}

// Runs every frame Flight Mode is active, independent of whether a
// connection is currently in progress -- checks whatever the ship is
// currently sitting on/passing through and starts, extends, or completes
// a connection accordingly.
function updateShipDrawing() {
  const ship = STATE.ship;

  if (!STATE.isDrawing) {
    const dot = findDotAt(ship.x, ship.y, false);
    if (dot) {
      STATE.activeDot = dot;
      STATE.isDrawing = true;
      STATE.currentPath = [{ x: dot.x, y: dot.y }];
      STATE.smoothedCursor = { x: dot.x, y: dot.y };
      return;
    }
    if (STATE.portals) {
      const portal = findPortalAt(ship.x, ship.y);
      if (portal) {
        const thread = STATE.portalThreads.find(t => t.enteredSide !== portal.side);
        if (thread) {
          STATE.activeDot = thread.dotA;
          STATE.activePortalThread = thread;
          STATE.isDrawing = true;
          STATE.currentPath = [{ x: portal.x, y: portal.y }];
          STATE.smoothedCursor = { x: portal.x, y: portal.y };
        }
      }
    }
    return;
  }

  advanceDrawingTo({ x: ship.x, y: ship.y });

  const targetDot = findDotAt(ship.x, ship.y, false);
  if (targetDot) {
    // Flying back through the dot the line started from is just ignored,
    // not treated as a cancel -- a continuously piloted ship can easily
    // clip back past its own start point mid-maneuver, which a single
    // discrete drag-and-release gesture never has to account for.
    if (targetDot.id === STATE.activeDot.id) return;
    // completeConnection/completePortalLeg (unlike rejectConnection/
    // cancelActiveLine) never touch STATE.isDrawing themselves -- they
    // were written assuming the classic onInputEnd caller already cleared
    // it first. Match that ordering here, or a successful flight-mode
    // connection would leave isDrawing stuck true with activeDot null,
    // crashing the very next dot the ship touches.
    STATE.isDrawing = false;
    attemptFlightConnection(targetDot);
    return;
  }

  if (!STATE.activePortalThread && STATE.portals) {
    const portal = findPortalAt(ship.x, ship.y);
    if (portal) {
      STATE.isDrawing = false;
      attemptFlightPortalLeg(portal);
    }
  }
}

function updateShip() {
  if (!STATE.flightMode || STATE.phase !== 'PLAYING' || !STATE.ship) return;
  const ship = STATE.ship;

  if (ship.hasTarget) {
    const dx = ship.targetX - ship.x, dy = ship.targetY - ship.y;
    const dist = Math.hypot(dx, dy);
    if (dist > 1) {
      // Eases off approaching the target ("arrival" steering) instead of
      // thrusting at full strength right up to the last pixel -- full
      // constant thrust all the way in, combined with the drag below,
      // would settle into a small perpetual wobble around the target
      // instead of actually coming to rest there.
      const thrust = FLIGHT_CONFIG.ACCEL * Math.min(1, dist / (FLIGHT_CONFIG.SHIP_RADIUS * 3));
      ship.vx += (dx / dist) * thrust;
      ship.vy += (dy / dist) * thrust;
    }
  }
  // Applies every frame, not just while coasting -- without it, constant
  // thrust toward a held (fixed) target never converges: it overshoots and
  // swings back forever, like a frictionless pendulum, instead of settling
  // near wherever the player is actually pointing.
  ship.vx *= FLIGHT_CONFIG.DRAG;
  ship.vy *= FLIGHT_CONFIG.DRAG;

  const speed = Math.hypot(ship.vx, ship.vy);
  if (speed > FLIGHT_CONFIG.MAX_SPEED) {
    ship.vx = (ship.vx / speed) * FLIGHT_CONFIG.MAX_SPEED;
    ship.vy = (ship.vy / speed) * FLIGHT_CONFIG.MAX_SPEED;
  }

  ship.x = Math.min(STATE.world.w, Math.max(0, ship.x + ship.vx));
  ship.y = Math.min(STATE.world.h, Math.max(0, ship.y + ship.vy));
  if (speed > 0.3) ship.heading = Math.atan2(ship.vy, ship.vx);

  updateShipDrawing();
}

function drawShip() {
  const ship = STATE.ship;
  if (!STATE.flightMode || !ship) return;

  ctx.save();
  ctx.translate(ship.x, ship.y);
  ctx.rotate(ship.heading + Math.PI / 2); // local hull points "up" (-y); align it to the actual heading

  const r = FLIGHT_CONFIG.SHIP_RADIUS;
  const speed = Math.hypot(ship.vx, ship.vy);

  if (ship.hasTarget && speed > 0.5) {
    const flicker = 0.7 + Math.random() * 0.3;
    const flameLen = r * (0.6 + Math.min(1, speed / FLIGHT_CONFIG.MAX_SPEED) * 0.9) * flicker;
    ctx.beginPath();
    ctx.moveTo(-r * 0.35, r * 0.6);
    ctx.lineTo(0, r * 0.6 + flameLen);
    ctx.lineTo(r * 0.35, r * 0.6);
    ctx.closePath();
    ctx.fillStyle = 'rgba(120, 200, 255, 0.85)';
    ctx.shadowBlur = 14;
    ctx.shadowColor = 'rgba(120, 200, 255, 0.9)';
    ctx.fill();
  }

  ctx.beginPath();
  ctx.moveTo(0, -r);
  ctx.lineTo(r * 0.65, r * 0.7);
  ctx.lineTo(0, r * 0.35);
  ctx.lineTo(-r * 0.65, r * 0.7);
  ctx.closePath();
  ctx.fillStyle = 'rgba(235, 245, 255, 0.96)';
  ctx.shadowBlur = 16;
  ctx.shadowColor = 'rgba(180, 220, 255, 0.9)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(120, 200, 255, 0.9)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.restore();
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

// Returns every already-drawn connection the given path actually crosses.
// Every caller is a rejection path that needs the specific connection(s),
// not just a yes/no, so it can flash exactly what blocked the attempt
// (see flashBlockingConnections) -- an empty array reads as "false" for
// any caller that only cares whether it crossed anything at all.
function findCrossedConnections(path) {
  const newSegments = smoothedCurveSegments(path);
  const crossed = [];
  for (const connection of STATE.connections) {
    const hits = connection.segments.some(existingSeg =>
      newSegments.some(newSeg => segmentsIntersect(newSeg, existingSeg)));
    if (hits) crossed.push(connection);
  }
  return crossed;
}

// A connection-attempt rejection because it crosses an already-drawn
// connection or a barrier gets no visible signal beyond the same generic
// haptic every other rejection reason (wrong color, a stranding risk)
// uses -- reasonable for those, since there's genuinely nothing to point
// at. But a crossing always has something concrete to show: the specific
// line or barrier that's actually in the way. This matters most in a
// 3+-dot group (see GROUP_CONFIG), where connecting a fresh dot to one of
// two already-linked groupmates can look identical, gesture-wise, to
// connecting it to the OTHER one -- one lands cleanly, the other crosses
// something and silently fails, reading to a player as an arbitrary "this
// dot doesn't work" rather than "this specific route is blocked, go
// around it" (player report: a low-vision playtester couldn't tell the
// two apart at all, since she also couldn't clearly see whatever was
// blocking her in the first place). Measured directly against real
// generated waves to find out what's actually doing the blocking: a
// barrier, essentially always -- a straight line to a dot can't cross the
// group's own just-drawn edge, since that edge ends at the same dot the
// new line is aiming for (geometrically only possible in a 4+-dot group,
// where a different edge that doesn't share that endpoint can genuinely
// sit in the way). Verified empirically that no dot is ever actually
// unconnectable -- every same-group dot is reachable via SOME route, see
// wouldNewSegmentsStrandAnyDot -- so the fix is visibility, not eligibility.
const BLOCKING_FLASH_DURATION_MS = 700;

function flashBlockingConnections(connections) {
  const startTime = performance.now();
  for (const connection of connections) {
    STATE.blockingFlashes.push({ segments: connection.segments, startTime });
  }
}

function flashBlockingBarriers(barriers) {
  const startTime = performance.now();
  for (const barrier of barriers) {
    STATE.blockingFlashes.push({ segments: segmentsOfBarrier(barrier), startTime });
  }
}

// Two quick bright pulses traced directly over the blocking connection's
// own path, fading out across the whole duration -- same sharpened-cosine
// technique hintPulseBrightness uses to read as distinct flashes rather
// than one smooth glow, just much shorter since this fires off a single
// failed gesture rather than a deliberate hint request.
function drawBlockingFlashes() {
  if (STATE.blockingFlashes.length === 0) return;
  const now = performance.now();
  STATE.blockingFlashes = STATE.blockingFlashes.filter(f => now - f.startTime < BLOCKING_FLASH_DURATION_MS);

  for (const flash of STATE.blockingFlashes) {
    const t = (now - flash.startTime) / BLOCKING_FLASH_DURATION_MS;
    const raw = (1 - Math.cos(t * 2 * Math.PI * 2)) / 2;
    const brightness = Math.pow(raw, 3) * (1 - t);
    if (brightness < 0.02) continue;

    ctx.save();
    ctx.globalAlpha = brightness;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = CONFIG.LINE_WIDTH * 1.8;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowBlur = 30;
    ctx.shadowColor = '#ffffff';
    ctx.beginPath();
    for (const seg of flash.segments) {
      ctx.moveTo(seg.x1, seg.y1);
      ctx.lineTo(seg.x2, seg.y2);
    }
    ctx.stroke();
    ctx.restore();
  }
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
//
// `portals`, if given (see PORTAL_CONFIG), adds one extra wormhole edge to
// the graph: standing in either portal's cell also lets the fill step
// straight to its paired portal's cell, on top of the normal 8 neighbors.
// This is the one place a portal actually needs to be understood as a real
// traversal route rather than just two more dots -- everywhere else
// (rendering, scoring, crossing-checks) only ever sees the two ordinary,
// fully continuous line segments a portal-mediated connection is actually
// drawn as (see completeConnection's portalPrefix parameter).
function isReachableAround(fromX, fromY, toX, toY, blocked, size, cols, rows, portals) {
  const startCol = Math.round(fromX / size), startRow = Math.round(fromY / size);
  const toCol = Math.round(toX / size), toRow = Math.round(toY / size);
  if (startCol === toCol && startRow === toRow) return true;

  const portalCells = portals ? [
    [Math.round(portals.a.x / size), Math.round(portals.a.y / size)],
    [Math.round(portals.b.x / size), Math.round(portals.b.y / size)],
  ] : null;

  const visited = new Set([startCol + ',' + startRow]);
  const queue = [[startCol, startRow]];
  const dirs = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];

  while (queue.length) {
    const [col, row] = queue.shift();

    let neighbors = dirs.map(([dc, dr]) => [col + dc, row + dr, dc, dr]);
    if (portalCells) {
      const [[ac, ar], [bc, br]] = portalCells;
      if (col === ac && row === ar) neighbors = neighbors.concat([[bc, br, null, null]]);
      else if (col === bc && row === br) neighbors = neighbors.concat([[ac, ar, null, null]]);
    }

    for (const [ncol, nrow, dc, dr] of neighbors) {
      if (ncol < 0 || ncol > cols || nrow < 0 || nrow > rows) continue;
      // No cutting corners: a diagonal move between two blocked orthogonal
      // neighbors would let the flood fill leak straight through a wall
      // that's only one cell thick wherever it happens to run diagonally
      // (exactly the shape a hand-drawn loop's boundary usually takes).
      // Doesn't apply to a portal jump (dc/dr null above) -- that's not a
      // physical adjacent step, corner-cutting isn't a meaningful concept
      // for it.
      if (dc !== null && dc !== 0 && dr !== 0 && blocked.has(col + dc + ',' + row) && blocked.has(col + ',' + (row + dr))) continue;
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
  return wouldNewSegmentsStrandAnyDot(newSegments, dotA.id, dotB.id);
}

// Core of the check above, but with the "simulate a completed A-B
// connection" step made optional (unionA/unionB nullable) -- a portal's
// first leg (see completePortalLeg) is real, permanent, wall-off-capable
// geometry the instant it's drawn, exactly like a completed connection is,
// even though it hasn't actually paired two dots together yet and so has
// nothing to union. Called with both a real union (the normal case) or
// neither (a portal's first leg) depending on which move is being checked.
function wouldNewSegmentsStrandAnyDot(newSegments, unionA, unionB) {
  // Dots and connection segments live in world space, which can be larger
  // than the screen on a crowded wave (see computeWorldSize) — the grid
  // has to cover the whole world or it'd silently clip off part of the
  // board and miss strandings that happen out past the screen's own size.
  const size = STRAND_CHECK_CELL_SIZE;
  const cols = Math.ceil(STATE.world.w / size) + 1;
  const rows = Math.ceil(STATE.world.h / size) + 1;
  // This grid has to include barriers, unlike the crossing-rejection check
  // (findCrossedConnections), where excluding them is correct — a barrier
  // isn't a wall a new line can't cross near, it's checked separately by
  // findCrossedBarriers. But for THIS reachability
  // question — "can dot still physically get to its groupmate at all" —
  // leaving barriers out was a real bug: this flood-fill could see an open
  // gap that a barrier actually occupies, approve a connection that seals
  // another dot in behind it, and if that barrier is static (never moves,
  // present from wave 3 on), the wave becomes permanently uncompleteable —
  // no replay, wait, or reconnect recovers it, since every real attempt to
  // route through that same gap afterward correctly gets rejected by
  // findCrossedBarriers forever. Confirmed empirically: reproduced on ~1 in
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
  if (unionA != null && unionB != null) ufUnion(unionA, unionB);

  let stranded = false;
  for (const dot of STATE.dots) {
    if (dot.connected) continue;
    const groupmates = STATE.dots.filter(d => d.pairId === dot.pairId && d.id !== dot.id && !ufConnected(d.id, dot.id));
    if (groupmates.length === 0) continue;
    const hasRoute = groupmates.some(g => isReachableAround(dot.x, dot.y, g.x, g.y, blocked, size, cols, rows, STATE.portals));
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

  // Cockpit Mode's own reveal: the ship would otherwise just sit frozen
  // exactly where the final connection landed (updateCockpitShip ignores
  // input once phase leaves PLAYING) -- almost always embedded inside that
  // dot's own sphere. cockpitRevealDir = null makes
  // updateCockpitWaveCompleteReveal compute a fresh pull-back direction
  // from wherever the ship actually finished, starting next frame. The
  // on-screen sticks have nothing left to control during this phase, so
  // they're hidden the same way exiting to the title screen already does.
  if (STATE.cockpitMode) {
    STATE.cockpitRevealDir = null;
    // updateCockpitShip (the only place that normally updates these) stops
    // running the instant phase leaves PLAYING, but renderCockpitScene's
    // visual bank roll keeps reading cockpitTurnSmoothed every frame
    // regardless of phase -- without this, finishing the wave mid-turn
    // freezes that roll at whatever it was and the entire reveal renders
    // permanently tilted, never recovering even once the player lets go of
    // the controls (review, #49).
    STATE.cockpitThrottleSmoothed = 0;
    STATE.cockpitTurnSmoothed = { x: 0, y: 0 };
    document.getElementById('cockpit-left-stick').classList.remove('visible');
    document.getElementById('cockpit-right-stick').classList.remove('visible');
  }

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
  // visible while still playing (see spawnStarsAroundDots). Stars still
  // apply to a Night Forest or Beach wave's sky (drawForestScene/
  // drawBeachScene both reuse drawStars wholesale), but drifting
  // asteroids/comets/planets are Space-only — nothing in render() would
  // ever draw them behind the trees or the waves, so don't even bother
  // spawning them.
  fillBaseStarfield();
  if (STATE.scene === 'space') {
    fillSpaceGalaxy();
    spawnCelestialBodies();
  }
  // Forest/Beach's own reward, alongside the galaxy above: each completed
  // wave on a scene's streak layers in one more real ambient recording,
  // always underneath this wave's own generated song rather than
  // replacing it (see SCENE_AMBIENT_CONFIG).
  updateSceneAmbienceForWaveComplete();

  STATE.score += STATE.wave * 100;
  const earnedThisWave = checkAchievements(STATE.score - STATE.waveStartScore);
  // The postcard/share prompt is only offered on a wave that actually
  // earned something -- a real "this one was good" signal already
  // computed above, not a separate threshold to invent and keep in sync.
  STATE.lastWavePostcardLabels = earnedThisWave.map(e => e.label);
  document.getElementById('postcard-row').classList.toggle('visible', earnedThisWave.length > 0);

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

  // Cockpit Mode's dots/ship live in real 3D space, not on the 2D board --
  // generateDots/the camera-fit math below (world size, zoom, barriers) has
  // no meaning for it, so it gets its own, much smaller setup path (see
  // startCockpitWave) and this whole classic block is skipped entirely.
  if (STATE.cockpitMode) {
    STATE.ship = null;
    STATE.barriers = [];
    startCockpitWave(waveNumber);
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
    STATE.eraseMode = false;
    STATE.eraseArmed = false;
    document.getElementById('pause-erase').classList.remove('active');
    STATE.portals = null;
    STATE.portalThreads = [];
    STATE.activePortalThread = null;
    for (const entry of STATE.connectionPraise) entry.el.remove();
    STATE.connectionPraise = [];
    STATE.spaceObjects = [];
    STATE.spaceSpawnTimer = 0;
    STATE.celestialBodies = [];
    STATE.stars = [];
    STATE.waveStartScore = STATE.score;

    const cockpitPairCount = getPairCountForWave(waveNumber);
    STATE.song = generateSong(cockpitPairCount);
    updateWaveDisplay();
    if (!STATE.beatInterval) startBeat();
    scheduleCurrentSongOnceReady();
    return;
  }

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
  STATE.eraseMode = false;
  STATE.eraseArmed = false;
  document.getElementById('pause-erase').classList.remove('active');
  // Set below by generateBarriersSafely if this wave gets one -- reset
  // here first so a wave that doesn't roll one doesn't inherit the
  // previous wave's portal pair or any thread still pending on it.
  STATE.portals = null;
  STATE.portalThreads = [];
  STATE.activePortalThread = null;
  STATE.ship = STATE.flightMode
    ? { x: STATE.world.w / 2, y: STATE.world.h / 2, vx: 0, vy: 0, heading: -Math.PI / 2, hasTarget: false, targetX: 0, targetY: 0 }
    : null;
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
  // Which scene this wave actually plays (fixed choice, or the next stop
  // in the rotation -- see resolveSceneForWave/SCENE_LIST). A forest or
  // beach scene's own decorations are rerolled fresh every wave, same
  // spirit as a new wave's own starfield/celestial-body reveal.
  STATE.scene = resolveSceneForWave(waveNumber);
  STATE.forestScene = STATE.scene === 'forest' ? generateForestScene() : null;
  STATE.beachScene = STATE.scene === 'beach' ? generateBeachScene() : null;
  STATE.birthdayScene = STATE.scene === 'birthday' ? generateBirthdayScene() : null;
  STATE.halloweenScene = STATE.scene === 'halloween' ? generateHalloweenScene() : null;
  STATE.christmasScene = STATE.scene === 'christmas' ? generateChristmasScene() : null;
  STATE.auroraScene = STATE.scene === 'aurora' ? generateAuroraScene() : null;
  STATE.reefScene = STATE.scene === 'reef' ? generateReefScene() : null;
  STATE.cavernScene = STATE.scene === 'cavern' ? generateCavernScene() : null;
  // Unlike every scene above, safari's own day/night pick has to survive
  // every wave of its block unchanged (see generateSafariScene's own
  // comment) -- passing the OUTGOING STATE.safariScene (still holding the
  // previous wave's value here, since this assignment hasn't happened
  // yet) is what lets it tell "still safari from last wave" (reuse) apart
  // from "just arrived at safari" (reroll). blockPosition can't make that
  // distinction on its own: a fixed (non-Rotate) sceneMode always reports
  // blockPosition 0, every single wave (see resolveSceneBlock), which
  // would reroll on every wave instead of just the first.
  STATE.safariScene = STATE.scene === 'safari' ? generateSafariScene(STATE.safariScene) : null;
  // Stop any leftover ambience from whatever scene the previous wave was
  // on the instant this wave's scene turns out to be different -- see
  // syncAmbienceToScene's own comment for why this can't just wait for
  // this wave's own completion.
  syncAmbienceToScene();
  // Then, if this wave landed mid-block (a load/restart/session-start,
  // not a normal continuous playthrough -- see this function's own
  // comment), silently backfill whatever sounds a wave this far into the
  // block should already have revealed.
  catchUpAmbienceStreakForWave(waveNumber);
  STATE.waveStartScore = STATE.score;

  showTutorialHint(waveNumber);

  const pairCount = getPairCountForWave(waveNumber);
  // Cockpit Mode is deliberately excluded here (see its own STATE.song
  // assignment above) -- it renders its own Three.js scene and never
  // reads STATE.scene at all, so "birthday" would just be whatever scene
  // classic mode last happened to leave behind, not a real signal.
  STATE.song = STATE.scene === 'birthday' ? generateBirthdaySong(pairCount) : generateSong(pairCount);
  // Sleep mode: no barriers, ever -- bypassing generateBarriersSafely
  // entirely (rather than just tuning BARRIER_CONFIG.START_WAVE to
  // Infinity, which this difficulty's preset also does as a backstop) is
  // the real guarantee, since it also skips the independent fact-box and
  // portal-pocket rolls nested inside that pipeline, not just the plain
  // barrier one.
  STATE.barriers = STATE.difficulty === 'sleep' ? [] : generateBarriersSafely(waveNumber, STATE.dots);

  updateWaveDisplay();

  if (!STATE.beatInterval) startBeat();

  // Sample decoding is async; scheduleLoopingSong calls playSample
  // synchronously for every note up front, so it must wait for decoding
  // to finish or the whole wave's real-instrument notes would silently
  // never play. A small wave can be solved faster than that decode
  // finishes -- wave 1 most of all, since it's also the very first decode
  // ever -- in which case STATE.song has already moved on by the time
  // this call's promise resolves; scheduleCurrentSongOnceReady handles
  // that by scheduling whatever's actually current at that point, so the
  // wave the player ends up on still gets its music instead of silence.
  scheduleCurrentSongOnceReady();
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

// Sleep mode: a warm, dim color-grade over the whole scene. A DOM overlay
// (see #sleep-mode-tint in index.html/style.css) rather than a canvas
// fillRect -- #cockpitCanvas sits above #gameCanvas with an opaque
// background, so anything drawn onto the 2D canvas's own context is
// completely hidden the instant Cockpit Mode is active (review, #54); a
// plain div above both canvases works identically for classic and
// cockpit rendering alike, with no rewrite of every dot/instrument color
// needed either way. Evening blue light measurably suppresses melatonin;
// this wash cuts down the board's own neon-blue content and lowers
// overall brightness, the same logic a phone's night-shift mode runs on.
function updateSleepModeTint() {
  document.getElementById('sleep-mode-tint').classList.toggle('visible', STATE.difficulty === 'sleep');
}

// Erase Mode's own persistent indicator (see #erase-mode-banner in
// index.html/style.css) -- a DOM overlay synced every frame, same
// reasoning as updateSleepModeTint just above. STATE.eraseMode gets
// set/cleared from enough different places (the pause-erase toggle, every
// ordinary way out of the pause menu, restart/load/exit) that a per-frame
// sync here is far less error-prone than remembering to touch a DOM class
// at each one individually. Without this, a player who erases a line and
// closes the pause menu has nothing telling them Erase Mode -- which has
// no auto-off -- is still on; every subsequent tap silently fails to draw
// a new line (see onInputStart's erase-mode branch), reading exactly like
// the game just stopped working rather than a mode they forgot to leave.
function updateEraseModeBanner() {
  const active = STATE.eraseMode && STATE.phase === 'PLAYING' && !STATE.paused;
  const banner = document.getElementById('erase-mode-banner');
  banner.classList.toggle('visible', active);
  // The opacity/transform toggle above is purely visual -- a screen reader
  // doesn't care that a hidden banner is 0% opaque, only whether it's in
  // the accessibility tree and reachable at all. Keep both explicitly in
  // sync with the same `active` flag so it's genuinely invisible to
  // assistive tech (and untabbable) whenever Erase Mode isn't actually on,
  // not just visually faded out.
  banner.setAttribute('aria-hidden', String(!active));
  banner.tabIndex = active ? 0 : -1;
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
// `portals`, if given, is treated as an extra wormhole edge (see
// isReachableAround) -- passed explicitly rather than always read from
// STATE.portals so generatePortalPocket can ask this same question both
// "as if the portal didn't exist yet" (to confirm a candidate dot is
// genuinely sealed without one) and "with the candidate portal in place"
// (to confirm it actually fixes what it sealed) before committing to it.
function allDotsReachableGivenBarriers(dots, barriers, portals) {
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
      if (!isReachableAround(groupDots[0].x, groupDots[0].y, groupDots[i].x, groupDots[i].y, blocked, size, cols, rows, portals)) {
        return false;
      }
    }
  }
  return true;
}

// Finds an open, empty spot elsewhere on the board for a portal's non-
// sealed side -- same random-attempts-with-clearance shape as
// generateFactBoxBarrier's own placement search, just for a point instead
// of a box. `avoidPoint` (the sealed side, inside its enclosure) is kept
// at real distance so the pair reads as "genuinely elsewhere," not a
// technicality one step outside the wall.
function findOpenPortalSpot(dots, barriers, avoidPoint) {
  const c = PORTAL_CONFIG.SCREEN_CLEARANCE;
  const spanX = STATE.world.w - 2 * c;
  const spanY = STATE.world.h - 2 * c;
  if (spanX <= 0 || spanY <= 0) return null;
  const barrierSegs = barriers.flatMap(segmentsOfBarrier);

  for (let attempts = 0; attempts < 100; attempts++) {
    const x = c + Math.random() * spanX;
    const y = c + Math.random() * spanY;
    if (dots.some(d => Math.hypot(d.x - x, d.y - y) < PORTAL_CONFIG.DOT_CLEARANCE)) continue;
    if (Math.hypot(avoidPoint.x - x, avoidPoint.y - y) < PORTAL_CONFIG.ENCLOSURE_RADIUS * 3) continue;
    if (barrierSegs.some(seg => distPointToSegment(x, y, seg.x1, seg.y1, seg.x2, seg.y2) < PORTAL_CONFIG.DOT_CLEARANCE)) continue;
    return { x, y };
  }
  return null;
}

// Late-wave portals (issue #25): tries to wall one existing dot into its
// own small square enclosure and bridge it back out with a portal pair,
// layered on top of an ALREADY fully-solvable barrier set (see
// generateBarriersSafely, which only ever calls this once its own
// classic, portal-free retry loop has already found one) -- so failure
// anywhere in here just means this particular wave ships without a
// portal, never an unsolvable one. Picks from real dots in random order
// (not always the first one tried) so which color gets sealed varies
// wave to wave.
function generatePortalPocket(wave, dots, barriers) {
  if (wave < PORTAL_CONFIG.START_WAVE) return null;
  if (Math.random() >= PORTAL_CONFIG.PROBABILITY) return null;

  const half = PORTAL_CONFIG.ENCLOSURE_RADIUS;
  const c = PORTAL_CONFIG.SCREEN_CLEARANCE;
  const barrierSegs = barriers.flatMap(segmentsOfBarrier);
  const candidates = [...dots].sort(() => Math.random() - 0.5).slice(0, PORTAL_CONFIG.GENERATION_ATTEMPTS);

  for (const candidate of candidates) {
    const cx = candidate.x, cy = candidate.y;
    if (cx - half < c || cx + half > STATE.world.w - c || cy - half < c || cy + half > STATE.world.h - c) continue;

    // The candidate itself is deliberately excluded -- it's meant to sit
    // this close to its own walls -- but every OTHER dot still needs real
    // clearance, same as any other barrier placement in this file.
    const tooCloseToOtherDot = dots.some(d => d.id !== candidate.id &&
      Math.max(Math.abs(d.x - cx), Math.abs(d.y - cy)) < half + PORTAL_CONFIG.DOT_CLEARANCE);
    if (tooCloseToOtherDot) continue;

    const x1 = cx - half, x2 = cx + half, y1 = cy - half, y2 = cy + half;
    const enclosureSegments = [
      { x1, y1, x2, y2: y1 },
      { x1: x2, y1, x2, y2 },
      { x1: x2, y1: y2, x2: x1, y2 },
      { x1, y1: y2, x2: x1, y2: y1 },
    ];
    if (barrierSegs.some(seg => segmentNearRect(seg.x1, seg.y1, seg.x2, seg.y2, {
      x1: x1 - PORTAL_CONFIG.DOT_CLEARANCE, x2: x2 + PORTAL_CONFIG.DOT_CLEARANCE,
      y1: y1 - PORTAL_CONFIG.DOT_CLEARANCE, y2: y2 + PORTAL_CONFIG.DOT_CLEARANCE,
    }))) continue;

    const enclosureBarrier = {
      type: 'portalSeal',
      segments: enclosureSegments,
      rotating: false,
      angularSpeed: 0,
      targetPairId: candidate.pairId,
      colorIndex: candidate.colorIndex,
      x1, y1, x2, y2: y1, // uniform x1/y1/x2/y2 fallback (see segmentsOfBarrier) -- unused here since .segments is set, kept only for shape-consistency with every other barrier type
    };
    const barriersWithSeal = [...barriers, enclosureBarrier];

    // Confirm the enclosure genuinely seals the candidate's own group off
    // WITHOUT a portal -- if some other gap this placement didn't account
    // for still leaves it reachable, a portal here would be decorative,
    // not the actual only way in, which defeats the entire point.
    const groupDots = dots.filter(d => d.pairId === candidate.pairId);
    if (allDotsReachableGivenBarriers(groupDots, barriersWithSeal, null)) continue;

    // Portal A sits inside the enclosure, offset from the dot so the two
    // don't visually sit exactly on top of each other, but nowhere near
    // the walls -- a straight line from an interior point to another
    // interior point of a convex shape never crosses its own boundary, so
    // this is safe by construction, no extra crossing check needed.
    const inset = half * 0.45;
    const portalAngle = Math.random() * Math.PI * 2;
    const portalA = { x: cx + Math.cos(portalAngle) * inset, y: cy + Math.sin(portalAngle) * inset };

    const portalB = findOpenPortalSpot(dots, barriersWithSeal, portalA);
    if (!portalB) continue;

    const portals = { a: portalA, b: portalB, colorIndex: candidate.colorIndex, pairId: candidate.pairId };
    // Full-board check, not just the candidate's group -- the new seal is
    // real geometry every other color's own reachability has to be
    // re-verified against too, cheap as this is to just always redo.
    if (!allDotsReachableGivenBarriers(dots, barriersWithSeal, portals)) continue;

    return { enclosureBarrier, portals };
  }
  return null;
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
    if (allDotsReachableGivenBarriers(dots, barriers)) {
      // A pure bonus layered on top of an already-solvable set -- see
      // generatePortalPocket's own comment for why this can never turn a
      // solvable wave into an unsolvable one.
      const pocket = generatePortalPocket(wave, dots, barriers);
      STATE.portals = pocket ? pocket.portals : null;
      if (pocket) barriers.push(pocket.enclosureBarrier);
      return barriers;
    }
  }
  STATE.portals = null;
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

// Resets a color's WHOLE network, not just one edge — once a group has 3+
// dots (see GROUP_CONFIG), a single edge can't be cleanly un-linked from the
// rest without re-deriving connectivity from the remaining edges, so both
// callers below (a barrier strike, or a player erasing a line in Relaxed
// mode) send that color back to square one instead. Simpler rule, and an
// honest one: if any part of a color's network goes away, its whole
// progress resets.
function resetPairConnections(pairId) {
  const groupDots = STATE.dots.filter(d => d.pairId === pairId);
  for (const d of groupDots) {
    d.connected = false;
    STATE.dotUnion[d.id] = d.id;
  }

  // Reverse whatever score these edges awarded, too -- otherwise erasing and
  // redrawing the same connection (Relaxed's ERASE is entirely
  // player-controlled and repeatable, unlike a barrier strike) would let a
  // player farm unlimited score, and inflate the best-wave-score
  // achievement, from a single line.
  let reversedScore = 0;
  for (let i = STATE.connections.length - 1; i >= 0; i--) {
    if (STATE.connections[i].pairId === pairId) {
      reversedScore += STATE.connections[i].scoreAwarded;
      STATE.connections.splice(i, 1);
    }
  }
  if (reversedScore > 0) {
    STATE.score = Math.max(0, STATE.score - reversedScore);
    updateWaveDisplay();
  }

  STATE.lines = STATE.lines.filter(l => l.pairId !== pairId);
  // Otherwise this pair's star halo — the one lasting sign a connection
  // ever existed, now that its line no longer fades to nothing either —
  // would keep implying "still connected" long after it reset, which is
  // exactly the stale signal that made a broken connection read as a
  // mystery instead of a break.
  STATE.stars = STATE.stars.filter(s => s.pairId !== pairId);
  remuteChunk(pairId);
}

function breakConnection(pairId, colorIndex, sparkX, sparkY) {
  resetPairConnections(pairId);
  spawnBreakSparks(sparkX, sparkY, colorIndex);
  haptic('break');
}

// Relaxed-mode-only player action (see toggleEraseMode/findConnectionAt):
// undoes one of the player's own lines on request, rather than only ever
// happening to them via a rotating barrier. Deliberately reuses the same
// break spark/haptic feedback as breakConnection -- the underlying state
// change is identical, and the feedback already reads clearly as "this
// connection just came undone" regardless of what caused it.
function eraseConnection(conn) {
  const midSeg = conn.segments[Math.floor(conn.segments.length / 2)];
  resetPairConnections(conn.pairId);
  spawnBreakSparks(midSeg.x1, midSeg.y1, conn.colorIndex);
  haptic('break');
}

// Mirrors findCrossedConnections -- returns the specific barrier(s) a path
// actually crosses, not just whether any exists, so a rejection caused by
// a barrier can flash exactly what's in the way the same as a rejection
// caused by a connection (see flashBlockingBarriers). This turned out to
// be the dominant real cause of "this specific dot won't connect" in a
// 3+-dot group (see GROUP_CONFIG): measured directly against real
// generated waves, straight-line rejections there were caused by a
// barrier roughly 33 times out of every 34, essentially never by crossing
// the group's own just-drawn edge -- which makes sense once you work
// through the geometry: a straight line TO a dot can't cross a segment
// that also ends AT that same dot.
function findCrossedBarriers(path) {
  const segs = smoothedCurveSegments(path);
  return STATE.barriers.filter(b =>
    segmentsOfBarrier(b).some(bSeg => segs.some(seg => segmentsIntersect(seg, bSeg))));
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
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      // A dimmer, smaller title above the fact itself -- reserve its own
      // space up front so fitFactText's shrink-to-fit sizes the fact text to
      // what's actually left, rather than the title fighting the fact for
      // room after the fact.
      const titleFontPx = 11, titleLineHeight = titleFontPx * 1.25, titleGap = 5;
      const { lines, lineHeight } = fitFactText(b.text, b.size - 24, b.size - 16 - titleLineHeight - titleGap);

      const contentHeight = titleLineHeight + titleGap + lines.length * lineHeight;
      const titleCenterY = b.cy - contentHeight / 2 + titleLineHeight / 2;
      ctx.font = `700 ${titleFontPx}px "Segoe UI", Arial, sans-serif`;
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.fillText('DID YOU KNOW?', b.cx, titleCenterY);

      const bodyStartY = titleCenterY + titleLineHeight / 2 + titleGap + lineHeight / 2;
      ctx.font = factBoxFont(lineHeight / 1.25);
      ctx.fillStyle = 'rgba(255,255,255,0.82)';
      for (let i = 0; i < lines.length; i++) {
        ctx.fillText(lines[i], b.cx, bodyStartY + i * lineHeight);
      }
      ctx.restore();
    }
  }
  ctx.restore();
}

// Deliberately unlike both a dot (solid filled shape) and a barrier
// (straight dashed line) -- see PORTAL_CONFIG's own comment on why the
// issue this implements explicitly asked for a distinct visual language.
// Two concentric rings spinning in opposite directions around a soft glow
// core reads as "a vortex, tap here" at a glance, tinted to the sealed
// pair's own color the same way a barrier tints to the pair it blocks.
function drawPortals() {
  if (!STATE.portals) return;
  const instrument = INSTRUMENTS[STATE.portals.colorIndex] || INSTRUMENTS[0];
  const t = performance.now() / 1000;
  ctx.save();
  ctx.lineCap = 'round';
  for (const p of [STATE.portals.a, STATE.portals.b]) {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(t * 1.1);
    ctx.beginPath();
    ctx.setLineDash([10, 8]);
    ctx.lineWidth = 4;
    ctx.strokeStyle = instrument.glow + '0.85)';
    ctx.shadowBlur = 16;
    ctx.shadowColor = instrument.hex;
    ctx.arc(0, 0, 26, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(-t * 1.6);
    ctx.beginPath();
    ctx.setLineDash([6, 6]);
    ctx.lineWidth = 3;
    ctx.strokeStyle = instrument.glow + '0.7)';
    ctx.shadowBlur = 10;
    ctx.shadowColor = instrument.hex;
    ctx.arc(0, 0, 15, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    ctx.beginPath();
    ctx.setLineDash([]);
    ctx.fillStyle = instrument.glow + '0.35)';
    ctx.shadowBlur = 20;
    ctx.shadowColor = instrument.hex;
    ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
    ctx.fill();
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

// Precise counterpart to fillBaseStarfield for a resize mid-reveal (see
// resizeCanvas). A plain fillBaseStarfield() re-run has two real gaps:
// (1) its target count depends only on total area, so an area-preserving
// orientation flip (e.g. 400x800 -> 800x400) computes the same target as
// before and adds nothing, even though the visible shape completely
// changed; (2) even when the area does grow, it scatters the added stars
// over the WHOLE canvas rather than just the newly-exposed part, which
// under-fills that part whenever the pre-existing area is large relative
// to the growth (most of the new stars land back in the already-covered
// region purely by chance). This instead fills exactly the region(s) the
// new canvas covers that the old one didn't, decomposed into up to two
// non-overlapping rectangles sharing the same origin (0,0) both rects are
// anchored at: a right strip if width grew, and a bottom strip -- capped
// to the width already claimed by the right strip, so the shared corner
// is never double-counted -- if height grew. Density stays uniform across
// old and new area alike regardless of whether this is a grow, a shrink,
// or a rotation.
function topUpStarfieldForResize(oldWidth, oldHeight) {
  // A star outside the new bounds no longer contributes any visible
  // coverage, but still occupies budget under MAX_STARS -- prune it first
  // so repeatedly resizing (e.g. rotating back and forth) can't slowly
  // starve later top-ups of room to add real ones back.
  STATE.stars = STATE.stars.filter(s => s.x < canvas.width && s.y < canvas.height);

  const commonW = Math.min(oldWidth, canvas.width);
  const commonH = Math.min(oldHeight, canvas.height);
  const regions = [];
  if (canvas.width > commonW) regions.push({ x: commonW, y: 0, w: canvas.width - commonW, h: canvas.height });
  if (canvas.height > commonH) regions.push({ x: 0, y: commonH, w: commonW, h: canvas.height - commonH });

  for (const r of regions) {
    const count = Math.round((r.w * r.h) / STARFIELD_CONFIG.AREA_PER_BASE_STAR);
    for (let i = 0; i < count; i++) {
      if (STATE.stars.length >= STARFIELD_CONFIG.MAX_STARS) return;
      STATE.stars.push(makeStar(r.x + Math.random() * r.w, r.y + Math.random() * r.h, STARFIELD_CONFIG.REVEAL_FADE_IN_SPEED));
    }
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

// rewardOnly skips the plain ambient/reveal starfield (undefined pairId)
// and draws only each connection's own halo (spawnStarsAroundDots, tagged
// with the pair's pairId) -- for a scene whose background photo already
// has its own real stars (Forest), so the ambient layer would just be
// visual noise on top of it, but the connection-reward halo is still
// live gameplay feedback (resetPairConnections relies on it existing)
// that has to render regardless (review catch, PR #97 -- drawForestScene
// dropping the drawStars() call entirely for that reason made every
// connection halo invisible in Forest too, not just the ambient stars).
function drawStars(rewardOnly = false) {
  for (const s of STATE.stars) {
    if (rewardOnly && s.pairId === undefined) continue;
    const twinkle = s.twinkling ? 0.7 + 0.3 * Math.sin(s.twinklePhase) : 1;
    ctx.beginPath();
    ctx.fillStyle = `rgba(255,255,255,${(s.alpha * twinkle).toFixed(3)})`;
    ctx.arc(s.x, s.y, s.radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ============================================================
// SECTION 7E: NIGHT FOREST BACKGROUND
// ============================================================
// Space's alternate scene (see SCENE_LIST/resolveSceneForWave): a still,
// dark tree line under a moonlit sky, built to read as calm rather than
// eventful — no drifting asteroids/comets, no wave-complete-only reveal,
// just a steady scene with a slow Ken Burns pan/zoom and drifting
// fireflies. A real photo (see art/CREDITS.md) rather than hand-drawn
// canvas art, same stylistic departure Safari made first (player
// request) -- chosen specifically for having its own real starfield
// already in frame, so this deliberately does NOT also layer the plain
// ambient Space starfield (STATE.stars' untagged entries) on top; two
// different star systems stacked on the same sky would just look like
// visual noise. It DOES still render each connection's own reward halo
// (spawnStarsAroundDots' pairId-tagged stars, via drawStars(true)) --
// that's live gameplay feedback for a still-connected pair, not
// decoration, and has to keep working regardless of scene (review catch,
// PR #97 -- an earlier version dropped drawStars() entirely and made
// every connection halo invisible in Forest along with the ambient
// stars). The photo's own dense treeline means no separate tree-cutout
// library is needed here the way Safari's single-tree photo needed one
// -- unlike Safari, this is also always night, so there's no day/night
// variant to pick between.
//
// Fireflies/moon are stored as fractions of canvas.width/height, not
// absolute pixels, precisely so a mid-wave resize needs no top-up pass
// the way the starfield does — draw time just multiplies by whatever the
// canvas size is right now. They're deliberately NOT mapped through the
// photo's own pan/zoom transform (contrast Safari's ground-anchored
// animals) -- same as Safari's shooting star, they're an independent sky
// overlay, not tied to a specific point the photo shows.
const FOREST_CONFIG = {
  image: 'art/forest-night.jpg',
  PAN_CYCLE_FRAMES: 2700,
  ZOOM_MIN: 1.05,
  ZOOM_MAX: 1.18,
};
const FOREST_IMAGE = Object.assign(new Image(), { src: FOREST_CONFIG.image });

// Lazily-created, reused offscreen canvas the moon composites onto before
// being drawn into the main scene -- see drawNightMoon's own comment on
// why the crescent's destination-out erase can't run directly on the main
// canvas. Square and sized to the moon's glow diameter; resized (rare --
// only actually changes with moonRadiusFrac's small random range or a
// canvas resize) rather than recreated every call. Shared by every night
// scene (forest, beach) rather than one offscreen canvas per scene, since
// only one scene ever renders at a time.
let nightMoonLayer = null;
function getNightMoonLayer(size) {
  if (!nightMoonLayer) {
    nightMoonLayer = document.createElement('canvas');
    nightMoonLayer.ctx = nightMoonLayer.getContext('2d');
  }
  if (nightMoonLayer.width !== size) {
    nightMoonLayer.width = size;
    nightMoonLayer.height = size;
  }
  return nightMoonLayer;
}

// Moon — a flat disc with a crescent bite punched out via destination-out.
// That erase has to happen on its own isolated layer, not directly on the
// main canvas: destination-out removes whatever is already painted
// underneath it, and by this point that's the sky gradient the calling
// scene just drew. Erasing straight into the main canvas would punch a
// genuinely transparent hole through the sky itself (visible as the
// page's own background, and as a black hole in any screenshot/postcard
// compositing) instead of just carving the moon. Composite the
// glow+disc+bite on a small offscreen canvas first, then drawImage the
// result onto the main canvas — normal source-over alpha blending there
// lets the sky already painted show through the bite correctly, same as
// compositing any other sprite. Shared by every night scene (forest,
// beach) since the moon itself looks identical regardless of what's
// underneath it.
function drawNightMoon(moonXFrac, moonYFrac, moonRadiusFrac) {
  const w = canvas.width, h = canvas.height;
  const mx = moonXFrac * w, my = moonYFrac * h;
  const mr = moonRadiusFrac * Math.min(w, h);
  const glowR = mr * 3.2;
  const moonLayer = getNightMoonLayer(Math.ceil(glowR * 2));
  const mctx = moonLayer.ctx;
  const half = moonLayer.width / 2;
  mctx.clearRect(0, 0, moonLayer.width, moonLayer.height);
  mctx.save();
  mctx.translate(half, half);
  const glow = mctx.createRadialGradient(0, 0, 0, 0, 0, glowR);
  glow.addColorStop(0, 'rgba(255,250,230,0.32)');
  glow.addColorStop(1, 'rgba(255,250,230,0)');
  mctx.fillStyle = glow;
  mctx.beginPath();
  mctx.arc(0, 0, glowR, 0, Math.PI * 2);
  mctx.fill();

  mctx.beginPath();
  mctx.arc(0, 0, mr, 0, Math.PI * 2);
  mctx.fillStyle = '#fdf6e3';
  mctx.fill();
  mctx.globalCompositeOperation = 'destination-out';
  mctx.beginPath();
  mctx.arc(mr * 0.45, -mr * 0.2, mr * 0.95, 0, Math.PI * 2);
  mctx.fillStyle = 'rgba(0,0,0,0.88)';
  mctx.fill();
  mctx.restore();
  ctx.drawImage(moonLayer, mx - half, my - half);
}

function generateForestScene() {
  const fireflyCount = 10 + Math.floor(Math.random() * 8);
  const fireflies = [];
  for (let i = 0; i < fireflyCount; i++) {
    fireflies.push({
      xFrac: Math.random(),
      yFrac: 0.55 + Math.random() * 0.4,
      phase: Math.random() * Math.PI * 2,
      driftXFrac: 0.015 + Math.random() * 0.015,
      driftYFrac: 0.01 + Math.random() * 0.01,
      driftSpeed: 0.0004 + Math.random() * 0.0004,
      pulseSpeed: 0.0025 + Math.random() * 0.0025,
    });
  }

  return {
    fireflies,
    moonXFrac: 0.15 + Math.random() * 0.7,
    moonYFrac: 0.08 + Math.random() * 0.14,
    moonRadiusFrac: 0.045 + Math.random() * 0.02,
    // Frame accumulator driving both the firefly drift/pulse below (see
    // updateForestScene) and the photo's Ken Burns pan/zoom (see
    // drawForestScene) -- started at a random point in the pan cycle
    // rather than always 0, so consecutive waves don't all visibly begin
    // from the same framing (every wave regenerates this scene fresh,
    // unlike Safari's block-persisted variant).
    phase: Math.floor(Math.random() * FOREST_CONFIG.PAN_CYCLE_FRAMES),
  };
}

function updateForestScene() {
  if (STATE.scene !== 'forest' || !STATE.forestScene) return;
  STATE.forestScene.phase += 1;
}

function drawForestScene() {
  const scene = STATE.forestScene;
  if (!scene) return;
  const w = canvas.width, h = canvas.height, t = scene.phase;
  const img = FOREST_IMAGE;

  // Still loading (first time this session needs it) -- a flat fill
  // close to the photo's own dominant tone beats a blank/white flash
  // while it finishes downloading (same technique as Safari).
  if (!img.complete || img.naturalWidth === 0) {
    ctx.fillStyle = '#0a0d18';
    ctx.fillRect(0, 0, w, h);
    return;
  }

  const cfg = FOREST_CONFIG;
  const cycle = (t % cfg.PAN_CYCLE_FRAMES) / cfg.PAN_CYCLE_FRAMES; // 0..1, wraps
  const easedT = 0.5 - 0.5 * Math.cos(cycle * Math.PI * 2); // smooth back-and-forth, not a jump-cut loop
  const zoom = cfg.ZOOM_MIN + (cfg.ZOOM_MAX - cfg.ZOOM_MIN) * easedT;

  // Cover-fit (like CSS object-fit: cover), same as drawSafariScene.
  const imgAspect = img.naturalWidth / img.naturalHeight;
  const canvasAspect = w / h;
  let drawW, drawH;
  if (imgAspect > canvasAspect) {
    drawH = h * zoom;
    drawW = drawH * imgAspect;
  } else {
    drawW = w * zoom;
    drawH = drawW / imgAspect;
  }
  const panX = (drawW - w) * easedT;
  const panY = (drawH - h) * (0.5 + 0.3 * Math.sin(cycle * Math.PI * 2));
  ctx.drawImage(img, -panX, -panY, drawW, drawH);

  drawNightMoon(scene.moonXFrac, scene.moonYFrac, scene.moonRadiusFrac);
  drawStars(true); // reward-only -- see this section's header comment

  for (const f of scene.fireflies) {
    const drift = t * f.driftSpeed + f.phase;
    const fx = (f.xFrac + Math.sin(drift) * f.driftXFrac) * w;
    const fy = (f.yFrac + Math.cos(drift * 0.8) * f.driftYFrac) * h;
    const pulse = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * f.pulseSpeed + f.phase * 2));
    const r = 6;
    const g = ctx.createRadialGradient(fx, fy, 0, fx, fy, r);
    g.addColorStop(0, `rgba(255, 224, 130, ${(0.8 * pulse).toFixed(3)})`);
    g.addColorStop(1, 'rgba(255, 224, 130, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(fx, fy, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ============================================================
// SECTION 7F: BEACH AT NIGHT BACKGROUND
// ============================================================
// Space's second alternate scene (see SCENE_LIST/resolveSceneForWave),
// built the same way the Night Forest above is: a moonlit sky (sharing
// drawNightMoon and drawStars with the forest scene), a dark ocean with a
// glittering moon-reflection path and a few gently undulating surf lines
// standing in for waves, a single distant sailboat drifting across the
// horizon (the signature per-scene animation -- same spirit as Forest's
// fireflies/Birthday's balloons/Halloween's bats/Christmas's chimney
// smoke), and a sand strip at the very bottom -- the forest's tree line
// and ground, reimagined.
//
// Wave lines/glitter dots/boat/moon are stored as fractions of
// canvas.width/height, not absolute pixels, same reasoning as the
// forest's trees.
//
// Water/sand player feedback: the previous teal-black water and
// brown-black sand were dark enough to read as no particular color at
// all. Muted for nighttime, same as before, but now unmistakably ocean
// blue and warm sand rather than a desaturated smear of either.
const BEACH_CONFIG = {
  SKY_TOP: '#050b17',
  SKY_MID: '#12253d',
  SKY_HORIZON: '#2f4f5f',
  WATER_HORIZON: '#2a5170',
  WATER_COLOR: '#0d2844',
  SAND_COLOR: '#4d4330',
  BOAT_COLOR: '#050a14',
};

function generateBeachScene() {
  const waveLineCount = 4 + Math.floor(Math.random() * 3);
  const waveLines = [];
  for (let i = 0; i < waveLineCount; i++) {
    waveLines.push({
      yFrac: 0.15 + (i / waveLineCount) * 0.8 + Math.random() * 0.05,
      phase: Math.random() * Math.PI * 2,
      speed: 0.0008 + Math.random() * 0.0008,
      amplitude: 2 + Math.random() * 3,
      opacity: 0.12 + Math.random() * 0.14,
    });
  }

  const moonXFrac = 0.15 + Math.random() * 0.7;
  // The moon's reflection on the water: a loose vertical scatter of dots
  // under the moon's own x position, widening as it nears the shore --
  // the same "glitter path" a real moon casts on open water.
  const glitterCount = 14 + Math.floor(Math.random() * 8);
  const glitterDots = [];
  for (let i = 0; i < glitterCount; i++) {
    const depth = i / glitterCount; // 0 near the horizon, 1 near the shore
    glitterDots.push({
      xFrac: moonXFrac + (Math.random() - 0.5) * (0.03 + depth * 0.12),
      yFrac: depth,
      phase: Math.random() * Math.PI * 2,
      twinkleSpeed: 0.003 + Math.random() * 0.004,
      alpha: 0.3 + Math.random() * 0.5,
      size: 1.5 + Math.random() * 2.5,
    });
  }

  // A single distant sailboat, crossing the horizon rather than sitting
  // still -- see this section's header comment.
  const boat = {
    xFrac: Math.random(),
    direction: Math.random() < 0.5 ? 1 : -1,
    speed: 0.00006 + Math.random() * 0.00005, // fraction of width per frame -- slow, distant drift, calmer than Halloween's bats
    bobPhase: Math.random() * Math.PI * 2,
    bobSpeed: 0.02 + Math.random() * 0.015,
    sizeFrac: 0.03 + Math.random() * 0.015,
  };

  return {
    waveLines,
    glitterDots,
    boat,
    horizonYFrac: 0.4 + Math.random() * 0.06,
    sandHeightFrac: 0.08 + Math.random() * 0.03,
    moonXFrac,
    moonYFrac: 0.08 + Math.random() * 0.12,
    moonRadiusFrac: 0.045 + Math.random() * 0.02,
    phase: 0, // frame accumulator driving the surf/glitter/boat animation below -- see updateBeachScene
  };
}

function updateBeachScene() {
  if (STATE.scene !== 'beach' || !STATE.beachScene) return;
  const scene = STATE.beachScene;
  scene.phase += 1;
  const boat = scene.boat;
  boat.xFrac += boat.speed * boat.direction;
  // Wrapped rather than recycled from a random edge -- same technique as
  // Halloween's bats -- the boat keeps sailing the same direction, just
  // reappears on the opposite side, so its crossing never visibly resets
  // mid-frame.
  if (boat.xFrac > 1.08) { boat.xFrac = -0.08; }
  else if (boat.xFrac < -0.08) { boat.xFrac = 1.08; }
}

function drawBeachScene() {
  const scene = STATE.beachScene;
  if (!scene) return;
  const w = canvas.width, h = canvas.height, t = scene.phase;

  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, BEACH_CONFIG.SKY_TOP);
  sky.addColorStop(0.55, BEACH_CONFIG.SKY_MID);
  sky.addColorStop(1, BEACH_CONFIG.SKY_HORIZON);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  drawNightMoon(scene.moonXFrac, scene.moonYFrac, scene.moonRadiusFrac);
  drawStars(); // same twinkling starfield Space/Forest use -- see this section's header comment

  const horizonY = scene.horizonYFrac * h;
  const sandY = h - scene.sandHeightFrac * h;

  // Water -- a flat, dark fill from the horizon down to the sand, its own
  // gradient so it reads darker/denser than the sky rather than looking
  // like a continuation of it. Drawn after the stars specifically so it
  // covers up any that would otherwise appear to twinkle underwater.
  const water = ctx.createLinearGradient(0, horizonY, 0, sandY);
  water.addColorStop(0, BEACH_CONFIG.WATER_HORIZON);
  water.addColorStop(1, BEACH_CONFIG.WATER_COLOR);
  ctx.fillStyle = water;
  ctx.fillRect(0, horizonY, w, sandY - horizonY);

  for (const d of scene.glitterDots) {
    const twinkle = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(t * d.twinkleSpeed + d.phase));
    const gx = d.xFrac * w;
    const gy = horizonY + d.yFrac * (sandY - horizonY);
    ctx.fillStyle = `rgba(255, 250, 230, ${(d.alpha * twinkle).toFixed(3)})`;
    ctx.fillRect(gx - d.size / 2, gy - d.size / 2, d.size, d.size);
  }

  // Surf lines -- a few gently undulating horizontal bands standing in
  // for breaking waves, without animating full particle foam.
  for (const wl of scene.waveLines) {
    const ly = horizonY + wl.yFrac * (sandY - horizonY);
    ctx.beginPath();
    ctx.moveTo(0, ly);
    const segments = 8;
    for (let i = 1; i <= segments; i++) {
      const x = (i / segments) * w;
      const wobble = Math.sin(t * wl.speed + wl.phase + i * 0.9) * wl.amplitude;
      ctx.lineTo(x, ly + wobble);
    }
    ctx.strokeStyle = `rgba(210, 230, 235, ${wl.opacity})`;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  // Boat -- a simple hull-and-sail silhouette riding right at the horizon
  // line, bobbing gently (see updateBeachScene for its slow horizontal
  // drift). The one point of warm color in an otherwise cool, dark scene
  // is its masthead light -- what actually makes a real distant boat
  // readable against a night horizon.
  const boat = scene.boat;
  const boatX = boat.xFrac * w;
  const bob = Math.sin(t * boat.bobSpeed + boat.bobPhase) * 1.5;
  const boatY = horizonY + (sandY - horizonY) * 0.04 + bob;
  const br = boat.sizeFrac * w;
  ctx.fillStyle = BEACH_CONFIG.BOAT_COLOR;
  ctx.beginPath();
  ctx.moveTo(boatX - br * 0.55, boatY);
  ctx.quadraticCurveTo(boatX, boatY + br * 0.28, boatX + br * 0.55, boatY);
  ctx.lineTo(boatX + br * 0.4, boatY - br * 0.08);
  ctx.lineTo(boatX - br * 0.4, boatY - br * 0.08);
  ctx.closePath();
  ctx.fill();
  // Mast + single sail, leaning toward the direction of travel.
  const mastLean = boat.direction * br * 0.12;
  ctx.beginPath();
  ctx.moveTo(boatX, boatY - br * 0.08);
  ctx.lineTo(boatX + mastLean, boatY - br * 0.85);
  ctx.lineTo(boatX - br * 0.35 * boat.direction, boatY - br * 0.08);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.arc(boatX + mastLean, boatY - br * 0.85, Math.max(1, br * 0.06), 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255, 210, 140, 0.9)';
  ctx.fill();

  ctx.fillStyle = BEACH_CONFIG.SAND_COLOR;
  ctx.fillRect(0, sandY, w, h - sandY);
}

// ============================================================
// SECTION 7G: BIRTHDAY PARTY BACKGROUND
// ============================================================
// Space's third alternate scene (see SCENE_LIST/resolveSceneForWave) --
// and its odd one out: an indoor party instead of a night sky, deliberately
// warm and bright rather than moonlit/calm (see SLEEP_SAFE_SCENES -- this
// is the one scene Sleep mode never offers). A string-light garland, a
// party table (cake, punch bowl, plate stack, and tied balloon bouquets),
// and continuous falling confetti.
//
// Balloons/confetti/lights are stored as fractions of canvas.width/height,
// not absolute pixels, same reasoning as the forest's trees.
const BIRTHDAY_CONFIG = {
  SKY_TOP: '#2a1030',
  SKY_MID: '#4a1f3d',
  SKY_HORIZON: '#7a3550',
  TABLE_COLOR: '#241221',
  BALLOON_COLORS: ['#ff5d8f', '#ffd23f', '#3fd0c9', '#a06cff', '#ff9a3f'],
  CONFETTI_COLORS: ['#ff5d8f', '#ffd23f', '#3fd0c9', '#a06cff', '#ff9a3f', '#ffffff'],
  PUNCH_COLOR: '#c22a5e',
  TABLEWARE_COLOR: '#fdeef7',
  TABLE_TOP_FRAC: 0.95, // fraction of canvas height where the table's top edge sits
};

// Balloons no longer appear during ordinary play at all -- a low-vision
// playtester (severe macular degeneration) mistook free-floating solo
// balloons for connectable dots, and even a redesign that tied them into
// bouquets anchored to the table (see git history, PR #79) still put a
// bright round shape in the same scene as the real dots the whole time
// the player is actually trying to connect something. Cleanest fix:
// balloons only exist for a specific, non-interactive moment -- the
// WAVE_COMPLETE celebration screen the wave that finishes revealing this
// scene's whole ambient set (see updateSceneAmbienceForWaveComplete's
// STATE.birthdayScene.celebrating hookup) -- where there's nothing to
// connect and nothing to confuse them with. Free to float and rise there,
// same joyful "balloon release" motion the original design used, since
// the one thing that made that motion a problem (looking like an
// unresponsive dot while the player is actively drawing lines) can't
// happen on a screen where drawing lines isn't a thing you do.
function generateCelebrationBalloons() {
  const balloonCount = 10 + Math.floor(Math.random() * 6);
  const balloons = [];
  for (let i = 0; i < balloonCount; i++) {
    balloons.push({
      xFrac: Math.random(),
      // Seeded across the whole visible height (plus a little below, for
      // staggered entry), not all starting off-screen below the bottom
      // edge -- WAVE_COMPLETE advances on the very next tap/click, so a
      // release that only started arriving after several seconds (review
      // catch, PR #81) would show most players a mostly-empty screen
      // instead of the advertised burst.
      yFrac: Math.random() * 1.2,
      colorIndex: Math.floor(Math.random() * BIRTHDAY_CONFIG.BALLOON_COLORS.length),
      radiusFrac: 0.026 + Math.random() * 0.018,
      // Fast enough to visibly cross the screen in a few seconds -- a
      // release, not an ambient drift a player might never stay long
      // enough to see (same review).
      riseSpeed: 0.0035 + Math.random() * 0.0025,
      swayPhase: Math.random() * Math.PI * 2,
      swaySpeed: 0.0006 + Math.random() * 0.0006,
      swayAmount: 0.02 + Math.random() * 0.025,
    });
  }
  return balloons;
}

function generateBirthdayScene() {
  const confettiCount = 26 + Math.floor(Math.random() * 14);
  const confetti = [];
  for (let i = 0; i < confettiCount; i++) {
    confetti.push({
      xFrac: Math.random(),
      yFrac: Math.random(),
      colorIndex: Math.floor(Math.random() * BIRTHDAY_CONFIG.CONFETTI_COLORS.length),
      fallSpeed: 0.00018 + Math.random() * 0.00022,
      driftXFrac: 0.01 + Math.random() * 0.015,
      driftPhase: Math.random() * Math.PI * 2,
      driftSpeed: 0.0008 + Math.random() * 0.0008,
      size: 3 + Math.random() * 4,
      rotation: Math.random() * Math.PI * 2,
      rotSpeed: (Math.random() - 0.5) * 0.05,
    });
  }

  // A gently sagging garland near the top -- a handful of bulbs evenly
  // spaced along a shallow quadratic sag, each with its own twinkle phase.
  const lightCount = 9 + Math.floor(Math.random() * 4);
  const lights = [];
  for (let i = 0; i < lightCount; i++) {
    lights.push({
      xFrac: (i + 0.5) / lightCount,
      phase: Math.random() * Math.PI * 2,
      twinkleSpeed: 0.003 + Math.random() * 0.004,
      colorIndex: Math.floor(Math.random() * BIRTHDAY_CONFIG.BALLOON_COLORS.length),
    });
  }

  return {
    confetti,
    lights,
    cakeXFrac: 0.5 + (Math.random() - 0.5) * 0.1,
    phase: 0, // frame accumulator driving confetti fall/light twinkle/candle flicker/celebration balloons below
    // Set true by updateSceneAmbienceForWaveComplete on the wave that
    // finishes revealing this scene's ambient set -- see
    // generateCelebrationBalloons' own comment for why balloons only
    // exist here, not during ordinary play.
    celebrating: false,
    celebrationBalloons: null,
  };
}

function updateBirthdayScene() {
  if (STATE.scene !== 'birthday' || !STATE.birthdayScene) return;
  const scene = STATE.birthdayScene;
  scene.phase += 1;
  for (const c of scene.confetti) {
    c.yFrac += c.fallSpeed;
    c.rotation += c.rotSpeed;
    if (c.yFrac > 1.05) {
      c.yFrac = -0.05;
      c.xFrac = Math.random();
    }
  }
  if (scene.celebrating && scene.celebrationBalloons) {
    for (const b of scene.celebrationBalloons) {
      b.yFrac -= b.riseSpeed;
      if (b.yFrac < -0.08) { // drifted off the top -- recycle from below, same trick confetti uses, so the release keeps going for as long as the player lingers on WAVE_COMPLETE
        b.yFrac = 1.05;
        b.xFrac = Math.random();
      }
    }
  }
}

function drawBirthdayScene() {
  const scene = STATE.birthdayScene;
  if (!scene) return;
  const w = canvas.width, h = canvas.height, t = scene.phase;

  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, BIRTHDAY_CONFIG.SKY_TOP);
  sky.addColorStop(0.6, BIRTHDAY_CONFIG.SKY_MID);
  sky.addColorStop(1, BIRTHDAY_CONFIG.SKY_HORIZON);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  // String-light garland -- a shallow sagging curve just below the top
  // edge, bulbs twinkling along it independently.
  const garlandY = 0.06 * h;
  const sagY = 0.03 * h;
  ctx.beginPath();
  ctx.moveTo(0, garlandY);
  ctx.quadraticCurveTo(w / 2, garlandY + sagY, w, garlandY);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  for (const light of scene.lights) {
    const lx = light.xFrac * w;
    const bendFrac = 4 * light.xFrac * (1 - light.xFrac); // quadratic bezier's own shape at this x
    const ly = garlandY + sagY * bendFrac;
    const twinkle = 0.5 + 0.5 * Math.sin(t * light.twinkleSpeed + light.phase);
    const color = BIRTHDAY_CONFIG.BALLOON_COLORS[light.colorIndex];
    const r = 5;
    const glow = ctx.createRadialGradient(lx, ly, 0, lx, ly, r * 2.4);
    glow.addColorStop(0, color);
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = 0.4 + 0.6 * twinkle;
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(lx, ly, r * 2.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // Confetti -- small rotating rectangles, continuously falling.
  for (const c of scene.confetti) {
    const cx = c.xFrac * w;
    const cy = c.yFrac * h;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(c.rotation);
    ctx.fillStyle = BIRTHDAY_CONFIG.CONFETTI_COLORS[c.colorIndex];
    ctx.fillRect(-c.size / 2, -c.size / 3, c.size, c.size * 0.66);
    ctx.restore();
  }

  // Table + cake + candle + punch bowl + plate stack -- one obviously-styled
  // tablescape anchored near the bottom, always in frame regardless of how
  // the confetti above happens to be scattered. The balloon bouquets (drawn
  // after, see below) are tied to this same table rather than floating
  // free, so the whole bottom strip reads as one piece of party decor.
  const tableY = BIRTHDAY_CONFIG.TABLE_TOP_FRAC * h;
  ctx.fillStyle = BIRTHDAY_CONFIG.TABLE_COLOR;
  ctx.fillRect(0, tableY, w, h - tableY);

  const cakeX = scene.cakeXFrac * w;
  const cakeW = 0.16 * w;
  const cakeH = 0.06 * h;
  const cakeY = tableY - cakeH;
  ctx.fillStyle = '#fdeef7';
  ctx.fillRect(cakeX - cakeW / 2, cakeY, cakeW, cakeH);
  ctx.fillStyle = '#ff8fb8';
  ctx.fillRect(cakeX - cakeW / 2, cakeY, cakeW, cakeH * 0.28);

  // Punch bowl -- a squat wide ellipse (bowl body) with a lighter rim
  // ellipse suggesting the concave inside, plus two small cups beside it.
  // Flat fills only, same as the cake -- deliberately styled like static
  // tableware, not like a dot (no glow, no pulse, no glossy highlight).
  const bowlX = cakeX - cakeW * 1.6;
  const bowlW = 0.075 * w;
  const bowlH = 0.022 * h;
  const bowlY = tableY - bowlH * 0.6;
  ctx.fillStyle = BIRTHDAY_CONFIG.TABLEWARE_COLOR;
  ctx.beginPath();
  ctx.ellipse(bowlX, bowlY, bowlW / 2, bowlH, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = BIRTHDAY_CONFIG.PUNCH_COLOR;
  ctx.beginPath();
  ctx.ellipse(bowlX, bowlY - bowlH * 0.28, bowlW / 2 * 0.8, bowlH * 0.6, 0, 0, Math.PI * 2);
  ctx.fill();
  for (const cupSign of [-1, 1]) {
    const cupX = bowlX + cupSign * bowlW * 0.85;
    const cupW = bowlW * 0.28;
    const cupH = bowlH * 1.8;
    ctx.fillStyle = BIRTHDAY_CONFIG.TABLEWARE_COLOR;
    ctx.fillRect(cupX - cupW / 2, tableY - cupH, cupW, cupH);
    ctx.fillStyle = BIRTHDAY_CONFIG.PUNCH_COLOR;
    ctx.beginPath();
    ctx.ellipse(cupX, tableY - cupH, cupW / 2, cupW / 2 * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Plate stack -- a few overlapping thin ellipses, on the cake's other side.
  const plateX = cakeX + cakeW * 1.6;
  const plateW = 0.06 * w;
  const plateH = 0.012 * h;
  for (let p = 0; p < 3; p++) {
    ctx.fillStyle = BIRTHDAY_CONFIG.TABLEWARE_COLOR;
    ctx.globalAlpha = 0.55 + p * 0.15;
    ctx.beginPath();
    ctx.ellipse(plateX, tableY - plateH * 0.5 - p * plateH * 0.7, plateW / 2, plateH, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  const candleX = cakeX;
  const candleTopY = cakeY - 0.035 * h;
  ctx.fillStyle = '#ffe9a8';
  ctx.fillRect(candleX - 2, candleTopY, 4, cakeY - candleTopY);

  // Candle flame -- same soft radial-glow technique the forest's fireflies
  // use, flickering via layered sine noise rather than a single steady sway.
  const flicker = 0.7 + 0.3 * Math.sin(t * 0.19) * Math.sin(t * 0.053 + 1.7);
  const flameY = candleTopY - 0.012 * h * flicker;
  const flameR = 0.014 * h * (0.85 + 0.3 * flicker);
  const flameGlow = ctx.createRadialGradient(candleX, flameY, 0, candleX, flameY, flameR * 3.2);
  flameGlow.addColorStop(0, `rgba(255, 200, 90, ${(0.55 * flicker).toFixed(3)})`);
  flameGlow.addColorStop(1, 'rgba(255, 200, 90, 0)');
  ctx.fillStyle = flameGlow;
  ctx.beginPath();
  ctx.arc(candleX, flameY, flameR * 3.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(candleX, flameY, flameR * 0.5, flameR, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#fff3c4';
  ctx.fill();

  // Celebration balloon release -- WAVE_COMPLETE only, see
  // generateCelebrationBalloons' own comment for why balloons are
  // confined to this one non-interactive screen. Drawn last/on top so the
  // release genuinely reads as filling the screen, the payoff its rarity
  // is meant to earn.
  if (scene.celebrating && scene.celebrationBalloons) {
    for (const b of scene.celebrationBalloons) {
      const drift = t * b.swaySpeed + b.swayPhase;
      const bx = (b.xFrac + Math.sin(drift) * b.swayAmount) * w;
      const by = b.yFrac * h;
      const r = b.radiusFrac * Math.min(w, h);

      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(bx, by + r);
      ctx.lineTo(bx + Math.sin(drift * 1.3) * r * 0.4, by + r * 3.2);
      ctx.stroke();

      ctx.beginPath();
      ctx.ellipse(bx, by, r * 0.82, r, 0, 0, Math.PI * 2);
      ctx.fillStyle = BIRTHDAY_CONFIG.BALLOON_COLORS[b.colorIndex];
      ctx.fill();
    }
  }
}

// ============================================================
// SECTION 7H: HALLOWEEN BACKGROUND
// ============================================================
// Space's fifth scene: a cozy-spooky autumn evening rather than horror --
// bare silhouette trees, drifting ground fog, a couple of flickering
// jack-o'-lanterns, and bats swooping across the sky on looping paths (the
// signature per-scene animation this scene needed, same spirit as "beach
// gets a sailing boat"). Mirrors the Forest/Beach/Birthday
// generate/update/draw architecture and reuses drawNightMoon/drawStars.
const HALLOWEEN_CONFIG = {
  SKY_TOP: '#160c22',
  SKY_MID: '#3a1a2e',
  SKY_HORIZON: '#7a3a1e',
  TREE_COLOR: '#0a0710',
  GROUND_COLOR: '#0c0710',
  PUMPKIN_COLOR: '#c85f0a', // deeper/more muted than the original -- less like a bright saturated dot
  STEM_COLOR: '#4a3418',
  HAYBALE_COLOR: '#5c4420',
};

function generateHalloweenScene() {
  const treeCount = 6 + Math.floor(Math.random() * 4);
  const trees = [];
  for (let i = 0; i < treeCount; i++) {
    trees.push({
      xFrac: Math.random(),
      heightFrac: 0.24 + Math.random() * 0.2,
      widthFrac: 0.05 + Math.random() * 0.03,
      swayPhase: Math.random() * Math.PI * 2,
      swaySpeed: 0.0004 + Math.random() * 0.0005,
      swayAmount: 2 + Math.random() * 3,
      branchSeed: Math.random(), // drives branch count/length below -- see drawHalloweenScene
    });
  }

  // Pumpkins no longer sit out on the ground during ordinary play at all --
  // even clustered on a haybale, a glowing carved shape near the dot field
  // still read as "maybe connectable" to a low-vision player (report: same
  // complaint that already got the Birthday balloons moved to a
  // wave-complete-only celebration). They're generated fresh, on demand,
  // by generateCelebrationPumpkins() only when that celebration triggers --
  // see updateSceneAmbienceForWaveComplete().

  const ghostCount = 2 + Math.floor(Math.random() * 2); // 2-3
  const ghosts = [];
  for (let i = 0; i < ghostCount; i++) {
    ghosts.push({
      xFrac: Math.random(),
      baseYFrac: 0.15 + Math.random() * 0.4,
      driftSpeed: (Math.random() < 0.5 ? -1 : 1) * (0.00015 + Math.random() * 0.00015),
      bobPhase: Math.random() * Math.PI * 2,
      bobSpeed: 0.0015 + Math.random() * 0.001,
      bobAmount: 0.015 + Math.random() * 0.015,
      sizeFrac: 0.028 + Math.random() * 0.014,
      wavePhase: Math.random() * Math.PI * 2,
    });
  }

  // A witch on a broom -- usually one, occasionally two -- staying high in
  // the moon band rather than drifting down into the dot field. Its
  // silhouette (broom + cloak + hat, see drawHalloweenScene) is
  // deliberately multi-part and non-circular for the same dots-vs-decor
  // reason the ghosts and ex-pumpkins needed to change shape.
  const witchCount = 1 + (Math.random() < 0.4 ? 1 : 0);
  const witches = [];
  for (let i = 0; i < witchCount; i++) {
    witches.push({
      xFrac: Math.random(),
      baseYFrac: 0.08 + Math.random() * 0.18,
      swoopAmount: 0.015 + Math.random() * 0.015,
      swoopSpeed: 0.0012 + Math.random() * 0.001,
      phase: Math.random() * Math.PI * 2,
      speed: 0.00018 + Math.random() * 0.00015,
      direction: Math.random() < 0.5 ? 1 : -1,
      sizeFrac: 0.05 + Math.random() * 0.02,
    });
  }

  const batCount = 5 + Math.floor(Math.random() * 4);
  const bats = [];
  for (let i = 0; i < batCount; i++) {
    bats.push({
      xFrac: Math.random(),
      baseYFrac: 0.1 + Math.random() * 0.35,
      swoopAmount: 0.02 + Math.random() * 0.03,
      swoopSpeed: 0.002 + Math.random() * 0.002,
      phase: Math.random() * Math.PI * 2,
      speed: 0.00035 + Math.random() * 0.00035, // fraction of width per frame -- see updateHalloweenScene
      direction: Math.random() < 0.5 ? 1 : -1,
      wingPhase: Math.random() * Math.PI * 2,
      sizeFrac: 0.012 + Math.random() * 0.008,
    });
  }

  const fogBands = [];
  for (let i = 0; i < 3; i++) {
    fogBands.push({
      yFrac: 0.72 + i * 0.08 + Math.random() * 0.03,
      xFrac: Math.random(),
      speed: 0.00006 + Math.random() * 0.00008,
      opacity: 0.1 + Math.random() * 0.08,
    });
  }

  return {
    trees,
    ghosts,
    witches,
    bats,
    fogBands,
    moonXFrac: 0.15 + Math.random() * 0.7,
    moonYFrac: 0.08 + Math.random() * 0.14,
    moonRadiusFrac: 0.05 + Math.random() * 0.02,
    phase: 0, // frame accumulator driving sway/swoop/flap/drift/flicker below
    celebrating: false,
    celebrationPumpkins: null,
  };
}

// Only ever generated once, when the wave-complete celebration fires (see
// updateSceneAmbienceForWaveComplete()) -- mirrors the Birthday scene's
// generateCelebrationBalloons() both in when it runs and in why: these
// objects should not exist in memory (let alone on screen) during
// ordinary play.
function generateCelebrationPumpkins() {
  const pumpkinCount = 2 + Math.floor(Math.random() * 3); // 2-4
  const pumpkins = [];
  for (let i = 0; i < pumpkinCount; i++) {
    pumpkins.push({
      dxFrac: (i - (pumpkinCount - 1) / 2) * 0.045 + (Math.random() - 0.5) * 0.012,
      sizeFrac: 0.026 + Math.random() * 0.012,
      flickerPhase: Math.random() * Math.PI * 2,
    });
  }
  return {
    clusterXFrac: 0.15 + Math.random() * 0.7,
    pumpkins,
    entrance: 0, // 0-1 pop-in progress, see updateHalloweenScene
  };
}

function updateHalloweenScene() {
  if (STATE.scene !== 'halloween' || !STATE.halloweenScene) return;
  const scene = STATE.halloweenScene;
  scene.phase += 1;
  for (const b of scene.bats) {
    b.xFrac += b.speed * b.direction;
    // Wrapped rather than recycled from a random edge -- a bat keeps
    // flying the same direction it was already going, just reappears on
    // the opposite side, so the motion never visibly resets mid-flight.
    if (b.xFrac > 1.08) { b.xFrac = -0.08; b.baseYFrac = 0.1 + Math.random() * 0.35; }
    else if (b.xFrac < -0.08) { b.xFrac = 1.08; b.baseYFrac = 0.1 + Math.random() * 0.35; }
  }
  for (const g of scene.ghosts) {
    g.xFrac += g.driftSpeed;
    if (g.xFrac > 1.1) g.xFrac = -0.1;
    else if (g.xFrac < -0.1) g.xFrac = 1.1;
  }
  for (const wch of scene.witches) {
    wch.xFrac += wch.speed * wch.direction;
    if (wch.xFrac > 1.1) { wch.xFrac = -0.1; wch.baseYFrac = 0.08 + Math.random() * 0.18; }
    else if (wch.xFrac < -0.1) { wch.xFrac = 1.1; wch.baseYFrac = 0.08 + Math.random() * 0.18; }
  }
  for (const f of scene.fogBands) {
    f.xFrac += f.speed;
    if (f.xFrac > 1) f.xFrac -= 1;
  }
  if (scene.celebrating && scene.celebrationPumpkins && scene.celebrationPumpkins.entrance < 1) {
    scene.celebrationPumpkins.entrance = Math.min(1, scene.celebrationPumpkins.entrance + 0.025);
  }
}

function drawHalloweenScene() {
  const scene = STATE.halloweenScene;
  if (!scene) return;
  const w = canvas.width, h = canvas.height, t = scene.phase;

  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, HALLOWEEN_CONFIG.SKY_TOP);
  sky.addColorStop(0.55, HALLOWEEN_CONFIG.SKY_MID);
  sky.addColorStop(1, HALLOWEEN_CONFIG.SKY_HORIZON);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  drawNightMoon(scene.moonXFrac, scene.moonYFrac, scene.moonRadiusFrac);
  drawStars(); // same twinkling starfield Space/Forest use -- see Forest's own comment

  // Bats -- a simple double-arc silhouette on a looping swoop path, wings
  // flapping via a fast sine. The signature per-scene animation this
  // scene needed (see this section's header comment).
  for (const b of scene.bats) {
    const bx = b.xFrac * w;
    const by = (b.baseYFrac + Math.sin(t * b.swoopSpeed + b.phase) * b.swoopAmount) * h;
    const wingFlap = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(t * 0.35 + b.wingPhase));
    const r = b.sizeFrac * Math.min(w, h);
    ctx.strokeStyle = 'rgba(10, 6, 14, 0.85)';
    ctx.lineWidth = Math.max(1, r * 0.35);
    ctx.beginPath();
    ctx.moveTo(bx - r * 1.6, by - r * wingFlap * 0.9);
    ctx.quadraticCurveTo(bx - r * 0.6, by + r * 0.3, bx, by);
    ctx.quadraticCurveTo(bx + r * 0.6, by + r * 0.3, bx + r * 1.6, by - r * wingFlap * 0.9);
    ctx.stroke();
  }

  // Ghosts -- rounded top, scalloped wavy bottom hem (not a plain oval),
  // low opacity with no glow halo so it reads as a translucent floating
  // sheet rather than a bright connectable shape.
  for (const g of scene.ghosts) {
    const gx = g.xFrac * w;
    const gy = (g.baseYFrac + Math.sin(t * g.bobSpeed + g.bobPhase) * g.bobAmount) * h;
    const r = g.sizeFrac * Math.min(w, h);
    const segments = 12;
    ctx.fillStyle = 'rgba(232, 238, 245, 0.4)';
    ctx.beginPath();
    ctx.moveTo(gx - r, gy);
    ctx.arc(gx, gy, r, Math.PI, 0);
    for (let i = 0; i <= segments; i++) {
      const frac = i / segments;
      const x = gx + r - frac * 2 * r;
      const waveY = gy + r * 0.85 + Math.sin(frac * Math.PI * 6 + t * 0.05 + g.wavePhase) * r * 0.12;
      ctx.lineTo(x, waveY);
    }
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(35, 30, 45, 0.55)';
    ctx.beginPath();
    ctx.arc(gx - r * 0.32, gy - r * 0.05, r * 0.12, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(gx + r * 0.32, gy - r * 0.05, r * 0.12, 0, Math.PI * 2);
    ctx.fill();
  }

  // Witches on brooms -- a multi-part silhouette (broom, cloak, head, hat)
  // rather than any single round shape, oriented to face its flight
  // direction.
  for (const wch of scene.witches) {
    const wx = wch.xFrac * w;
    const wy = (wch.baseYFrac + Math.sin(t * wch.swoopSpeed + wch.phase) * wch.swoopAmount) * h;
    const r = wch.sizeFrac * Math.min(w, h);
    const dir = wch.direction;
    ctx.fillStyle = 'rgba(15, 10, 20, 0.82)';
    ctx.strokeStyle = 'rgba(15, 10, 20, 0.82)';
    ctx.lineWidth = Math.max(1, r * 0.12);
    ctx.beginPath();
    ctx.moveTo(wx - dir * r * 1.3, wy + r * 0.35);
    ctx.lineTo(wx + dir * r * 0.5, wy + r * 0.35);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(wx - dir * r * 1.3, wy + r * 0.15);
    ctx.lineTo(wx - dir * r * 1.7, wy + r * 0.5);
    ctx.lineTo(wx - dir * r * 1.3, wy + r * 0.55);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(wx - dir * r * 0.4, wy + r * 0.35);
    ctx.lineTo(wx + dir * r * 0.5, wy + r * 0.1);
    ctx.lineTo(wx + dir * r * 0.15, wy - r * 0.5);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.arc(wx + dir * r * 0.25, wy - r * 0.55, r * 0.22, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(wx + dir * r * 0.05, wy - r * 0.68);
    ctx.lineTo(wx + dir * r * 0.55, wy - r * 0.7);
    ctx.lineTo(wx + dir * r * 0.15, wy - r * 1.35);
    ctx.closePath();
    ctx.fill();
  }

  // Ground fog -- soft translucent horizontal bands drifting sideways,
  // wrapping around once xFrac cycles past 1 (see updateHalloweenScene).
  // A single gradient copy goes fully off-screen for a stretch near the
  // wrap point no matter how wide it is (review catch, PR #70) -- drawing
  // a second copy one canvas-width to the left keeps one of the two
  // always at least partially in view, so the band reads as continuously
  // drifting rather than periodically vanishing.
  const FOG_BAND_WIDTH = 1.6; // multiple of canvas width -- wide enough that each copy's own fade is soft
  for (const f of scene.fogBands) {
    const fy = f.yFrac * h;
    for (const fx of [f.xFrac * w, f.xFrac * w - w]) {
      const grad = ctx.createLinearGradient(fx - w * FOG_BAND_WIDTH / 2, 0, fx + w * FOG_BAND_WIDTH / 2, 0);
      grad.addColorStop(0, 'rgba(200,200,210,0)');
      grad.addColorStop(0.5, `rgba(200,200,210,${f.opacity.toFixed(3)})`);
      grad.addColorStop(1, 'rgba(200,200,210,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, fy - h * 0.03, w, h * 0.06);
    }
  }

  // Bare trees -- forking branches rather than Forest's solid canopy, so
  // the two scenes read as visually distinct silhouettes.
  for (const tr of scene.trees) {
    const baseX = tr.xFrac * w;
    const treeH = tr.heightFrac * h;
    const baseY = h;
    const topY = baseY - treeH;
    const sway = Math.sin(t * tr.swaySpeed + tr.swayPhase) * tr.swayAmount;
    ctx.strokeStyle = HALLOWEEN_CONFIG.TREE_COLOR;
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(2, tr.widthFrac * w);
    ctx.beginPath();
    ctx.moveTo(baseX, baseY);
    ctx.lineTo(baseX + sway, topY);
    ctx.stroke();
    const branchCount = 3 + Math.floor(tr.branchSeed * 3);
    for (let i = 0; i < branchCount; i++) {
      const along = 0.35 + (i / branchCount) * 0.6;
      const fromX = baseX + sway * along;
      const fromY = baseY - treeH * along;
      const side = i % 2 === 0 ? 1 : -1;
      const branchLen = treeH * (0.16 + 0.1 * ((tr.branchSeed * (i + 1) * 37) % 1));
      const toX = fromX + side * branchLen * 0.7 + sway * 0.3;
      const toY = fromY - branchLen * 0.7;
      ctx.lineWidth = Math.max(1, tr.widthFrac * w * 0.4);
      ctx.beginPath();
      ctx.moveTo(fromX, fromY);
      ctx.lineTo(toX, toY);
      ctx.stroke();
    }
  }

  ctx.fillStyle = HALLOWEEN_CONFIG.GROUND_COLOR;
  ctx.fillRect(0, h - 6, w, 6);

  // Pumpkins only exist as a one-time wave-complete celebration burst, not
  // during ordinary play -- see generateCelebrationPumpkins() and
  // updateSceneAmbienceForWaveComplete() (same pattern, and same player
  // report, as the Birthday scene's celebration balloons).
  if (scene.celebrating && scene.celebrationPumpkins) {
    const cel = scene.celebrationPumpkins;
    // Ease-out-cubic pop-in over the first ~40 frames so the cluster
    // arrives with a little celebratory bounce rather than snapping in.
    const entranceScale = 1 - Math.pow(1 - cel.entrance, 3);

    // A haybale under the pumpkin cluster -- grounds the whole group as one
    // obviously-styled porch/yard display (same principle as Birthday's
    // cake/punch bowl/plate table), and gives the pumpkins something to
    // visibly sit ON rather than floating at the ground line on their own.
    // Ellipse center is offset up by its own vertical radius so the bottom
    // edge lands exactly on the ground line rather than straddling it.
    const clusterX = cel.clusterXFrac * w;
    const groundY = h - 6;
    const haleW = 0.22 * w;
    const haleH = 0.02 * h;
    const haleRX = haleW / 2;
    const haleCenterY = groundY - haleH;
    ctx.fillStyle = HALLOWEEN_CONFIG.HAYBALE_COLOR;
    ctx.beginPath();
    ctx.ellipse(clusterX, haleCenterY, haleRX, haleH, 0, 0, Math.PI * 2);
    ctx.fill();

    // Jack-o'-lanterns -- clustered together on the haybale above rather
    // than spread solo across the ground (player report: individually
    // glowing round shapes read as connectable dots). Each one's body is a
    // few overlapping vertical lobes instead of a plain circle/oval, so the
    // silhouette itself reads as "pumpkin," not "dot" -- same flicker
    // technique as the birthday candle and forest fireflies (layered sine
    // noise) for the carved-face glow, now much smaller and tighter to the
    // face instead of a large ambient halo.
    for (const p of cel.pumpkins) {
      const px = clusterX + p.dxFrac * w;
      const r = p.sizeFrac * Math.min(w, h) * entranceScale;
      const localRatio = Math.max(-1, Math.min(1, (px - clusterX) / haleRX));
      const supportY = haleCenterY - haleH * Math.sqrt(Math.max(0, 1 - localRatio * localRatio));
      const py = supportY - r * 0.82;
      const flicker = 0.75 + 0.25 * Math.sin(t * 0.15 + p.flickerPhase) * Math.sin(t * 0.047 + p.flickerPhase * 1.3);

      // Ridged body: 4 overlapping vertical lobes plus a short stem, rather
      // than one plain ellipse.
      const lobeCount = 4;
      ctx.fillStyle = HALLOWEEN_CONFIG.PUMPKIN_COLOR;
      for (let i = 0; i < lobeCount; i++) {
        const lobeX = px + (i - (lobeCount - 1) / 2) * (r * 0.42);
        ctx.beginPath();
        ctx.ellipse(lobeX, py, r * 0.34, r * 0.82, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.strokeStyle = 'rgba(0,0,0,0.18)';
      ctx.lineWidth = Math.max(1, r * 0.05);
      for (let i = 1; i < lobeCount; i++) {
        const lineX = px + (i - (lobeCount - 1) / 2) * (r * 0.42) - r * 0.21;
        ctx.beginPath();
        ctx.moveTo(lineX, py - r * 0.75);
        ctx.quadraticCurveTo(lineX + r * 0.02, py, lineX, py + r * 0.75);
        ctx.stroke();
      }
      ctx.fillStyle = HALLOWEEN_CONFIG.STEM_COLOR;
      ctx.fillRect(px - r * 0.08, py - r * 0.92, r * 0.16, r * 0.22);

      // Carved-face glow -- tight to the cutouts, not a broad ambient halo.
      const glow = ctx.createRadialGradient(px, py, 0, px, py, r * 1.2);
      glow.addColorStop(0, `rgba(255, 170, 60, ${(0.35 * flicker).toFixed(3)})`);
      glow.addColorStop(1, 'rgba(255, 170, 60, 0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(px, py, r * 1.2, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = `rgba(255, 210, 120, ${(0.55 + 0.45 * flicker).toFixed(3)})`;
      const eyeW = r * 0.28, eyeH = r * 0.32;
      ctx.beginPath();
      ctx.moveTo(px - r * 0.42, py - r * 0.1);
      ctx.lineTo(px - r * 0.42 + eyeW, py - r * 0.1);
      ctx.lineTo(px - r * 0.42 + eyeW * 0.5, py - r * 0.1 - eyeH);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(px + r * 0.42, py - r * 0.1);
      ctx.lineTo(px + r * 0.42 - eyeW, py - r * 0.1);
      ctx.lineTo(px + r * 0.42 - eyeW * 0.5, py - r * 0.1 - eyeH);
      ctx.closePath();
      ctx.fill();
      // A jagged zigzag mouth, same fill as the eyes.
      ctx.beginPath();
      ctx.moveTo(px - r * 0.45, py + r * 0.35);
      ctx.lineTo(px - r * 0.28, py + r * 0.2);
      ctx.lineTo(px - r * 0.12, py + r * 0.35);
      ctx.lineTo(px + r * 0.05, py + r * 0.2);
      ctx.lineTo(px + r * 0.22, py + r * 0.35);
      ctx.lineTo(px + r * 0.4, py + r * 0.22);
      ctx.lineTo(px + r * 0.4, py + r * 0.38);
      ctx.lineTo(px - r * 0.45, py + r * 0.38);
      ctx.closePath();
      ctx.fill();
    }
  }
}

// ============================================================
// SECTION 7I: CHRISTMAS BACKGROUND
// ============================================================
// Space's sixth scene: a snowy winter night -- a lit pine tree, a small
// house with a chimney puffing drifting smoke (the signature per-scene
// animation, same spirit as Beach's boat/Halloween's bats), falling snow
// in front of everything, and the shared drawNightMoon/drawStars so it
// reads as a night scene consistent with Forest/Beach/Halloween. Already
// genuinely calm -- see SLEEP_SAFE_SCENES -- unlike Birthday/Halloween's
// deliberately higher-energy sets.
const CHRISTMAS_CONFIG = {
  SKY_TOP: '#050a1a',
  SKY_MID: '#0f1f3d',
  SKY_HORIZON: '#2a3a5c',
  SNOW_COLOR: '#e8eef5',
  TREE_COLOR: '#0d2818',
  HOUSE_COLOR: '#171225',
  ROOF_COLOR: '#241a30',
  LIGHT_COLORS: ['#ff5d5d', '#5dc9ff', '#ffe15d', '#5dff8f', '#ff8fd6'],
};

function generateChristmasScene() {
  const snowflakeCount = 50 + Math.floor(Math.random() * 30);
  const snowflakes = [];
  for (let i = 0; i < snowflakeCount; i++) {
    snowflakes.push({
      xFrac: Math.random(),
      yFrac: Math.random(),
      size: 1.5 + Math.random() * 2.5,
      fallSpeed: 0.0003 + Math.random() * 0.0004,
      driftPhase: Math.random() * Math.PI * 2,
      driftSpeed: 0.001 + Math.random() * 0.0015,
      driftAmount: 0.01 + Math.random() * 0.02,
    });
  }

  const treeXFrac = 0.22 + Math.random() * 0.12;
  const lightCount = 8 + Math.floor(Math.random() * 4);
  const lights = [];
  for (let i = 0; i < lightCount; i++) {
    lights.push({
      // Spread down the tree's own triangular silhouette rather than a
      // straight garland line -- see drawChristmasScene for how heightFrac
      // maps to an actual on-tree position.
      heightFrac: (i + 0.5) / lightCount,
      side: Math.random() < 0.5 ? -1 : 1,
      inset: 0.2 + Math.random() * 0.5,
      phase: Math.random() * Math.PI * 2,
      twinkleSpeed: 0.003 + Math.random() * 0.004,
      colorIndex: Math.floor(Math.random() * CHRISTMAS_CONFIG.LIGHT_COLORS.length),
    });
  }

  const smokeCount = 6;
  const smoke = [];
  for (let i = 0; i < smokeCount; i++) {
    smoke.push({
      riseFrac: i / smokeCount, // 0 = just left the chimney, 1 = about to recycle -- see updateChristmasScene
      xDriftPhase: Math.random() * Math.PI * 2,
      sizeSeed: Math.random(),
    });
  }

  return {
    snowflakes,
    lights,
    smoke,
    treeXFrac,
    houseXFrac: 0.68 + Math.random() * 0.15,
    moonXFrac: 0.15 + Math.random() * 0.7,
    moonYFrac: 0.08 + Math.random() * 0.14,
    moonRadiusFrac: 0.045 + Math.random() * 0.02,
    phase: 0, // frame accumulator driving fall/drift/twinkle/rise below
  };
}

function updateChristmasScene() {
  if (STATE.scene !== 'christmas' || !STATE.christmasScene) return;
  const scene = STATE.christmasScene;
  scene.phase += 1;
  for (const s of scene.snowflakes) {
    s.yFrac += s.fallSpeed;
    if (s.yFrac > 1.05) { s.yFrac = -0.05; s.xFrac = Math.random(); }
  }
  for (const p of scene.smoke) {
    p.riseFrac += 0.0009;
    if (p.riseFrac > 1) p.riseFrac -= 1; // recycles back to the chimney rather than resetting visibly off-frame
  }
}

function drawChristmasScene() {
  const scene = STATE.christmasScene;
  if (!scene) return;
  const w = canvas.width, h = canvas.height, t = scene.phase;

  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, CHRISTMAS_CONFIG.SKY_TOP);
  sky.addColorStop(0.55, CHRISTMAS_CONFIG.SKY_MID);
  sky.addColorStop(1, CHRISTMAS_CONFIG.SKY_HORIZON);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  drawNightMoon(scene.moonXFrac, scene.moonYFrac, scene.moonRadiusFrac);
  drawStars(); // same twinkling starfield Space/Forest/Beach/Halloween use

  // House with a chimney -- simple silhouette, always anchored to the
  // ground line regardless of canvas size.
  const groundY = h - 0.04 * h;
  const houseX = scene.houseXFrac * w;
  const houseW = 0.22 * w;
  const houseH = 0.14 * h;
  const houseY = groundY - houseH;
  ctx.fillStyle = CHRISTMAS_CONFIG.HOUSE_COLOR;
  ctx.fillRect(houseX - houseW / 2, houseY, houseW, houseH);
  ctx.fillStyle = CHRISTMAS_CONFIG.ROOF_COLOR;
  ctx.beginPath();
  ctx.moveTo(houseX - houseW * 0.65, houseY);
  ctx.lineTo(houseX, houseY - houseH * 0.55);
  ctx.lineTo(houseX + houseW * 0.65, houseY);
  ctx.closePath();
  ctx.fill();
  // A single warm window -- makes the house read as lived-in/cozy rather
  // than a bare silhouette.
  const winSize = houseW * 0.16;
  ctx.fillStyle = 'rgba(255, 210, 130, 0.85)';
  ctx.fillRect(houseX - winSize / 2, houseY + houseH * 0.4, winSize, winSize);

  const chimneyW = houseW * 0.12;
  const chimneyX = houseX + houseW * 0.28;
  const chimneyH = houseH * 0.35;
  const chimneyTopY = houseY - houseH * 0.3 - chimneyH;
  ctx.fillStyle = CHRISTMAS_CONFIG.ROOF_COLOR;
  ctx.fillRect(chimneyX - chimneyW / 2, chimneyTopY, chimneyW, chimneyH);

  // Chimney smoke -- the signature per-scene animation this theme needed
  // (see this section's header comment): soft puffs that rise and widen,
  // fading out near the top of their own rise before recycling back to
  // the chimney rather than popping back down visibly.
  for (const p of scene.smoke) {
    const riseH = 0.16 * h;
    const py = chimneyTopY - p.riseFrac * riseH;
    const px = chimneyX + Math.sin(t * 0.02 + p.xDriftPhase) * riseH * 0.18 * p.riseFrac;
    const r = (2 + p.sizeSeed * 3) * (0.6 + p.riseFrac * 0.9);
    const alpha = 0.35 * (1 - p.riseFrac);
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(220, 220, 225, ${alpha.toFixed(3)})`;
    ctx.fill();
  }

  // Christmas tree -- a stacked triangular silhouette with lights spread
  // across its own outline (see generateChristmasScene's heightFrac/side/
  // inset) rather than a straight garland line.
  const treeX = scene.treeXFrac * w;
  const treeH = 0.32 * h;
  const treeW = 0.22 * w;
  const treeBaseY = groundY;
  const treeTopY = treeBaseY - treeH;
  ctx.fillStyle = CHRISTMAS_CONFIG.TREE_COLOR;
  for (let tier = 0; tier < 3; tier++) {
    const tierBottom = treeBaseY - tier * treeH * 0.32;
    const tierTop = treeTopY + tier * treeH * 0.22;
    const tierW = treeW * (1 - tier * 0.22);
    ctx.beginPath();
    ctx.moveTo(treeX - tierW / 2, tierBottom);
    ctx.lineTo(treeX, tierTop);
    ctx.lineTo(treeX + tierW / 2, tierBottom);
    ctx.closePath();
    ctx.fill();
  }
  // Trunk.
  ctx.fillStyle = '#2a1a12';
  ctx.fillRect(treeX - treeW * 0.04, treeBaseY, treeW * 0.08, treeH * 0.06);

  for (const l of scene.lights) {
    const rowW = treeW * (1 - l.heightFrac * 0.82) * l.inset;
    const lx = treeX + l.side * rowW;
    const ly = treeBaseY - l.heightFrac * treeH * 0.98;
    const twinkle = 0.5 + 0.5 * Math.sin(t * l.twinkleSpeed + l.phase);
    const color = CHRISTMAS_CONFIG.LIGHT_COLORS[l.colorIndex];
    ctx.globalAlpha = 0.5 + 0.5 * twinkle;
    ctx.beginPath();
    ctx.arc(lx, ly, 3, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  // A star topper.
  ctx.fillStyle = '#ffe9a0';
  ctx.beginPath();
  ctx.arc(treeX, treeTopY - 4, 4, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = CHRISTMAS_CONFIG.SNOW_COLOR;
  ctx.fillRect(0, groundY, w, h - groundY);

  // Falling snow -- drawn last so it sits in front of the tree/house/
  // ground the same way real falling snow would.
  ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
  for (const s of scene.snowflakes) {
    const sx = (s.xFrac + Math.sin(t * s.driftSpeed + s.driftPhase) * s.driftAmount) * w;
    const sy = s.yFrac * h;
    ctx.beginPath();
    ctx.arc(sx, sy, s.size, 0, Math.PI * 2);
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
// SECTION 7J: PREMIUM SCENES (STORE) -- Aurora Skies, Coral Reef Glow,
// Crystal Cave
// ============================================================
// The three scenes sold as the Dreamscape Pack (see STORE_PRODUCTS/
// PREMIUM_SCENE_LIST). Built the same way every free scene above is --
// fractional positions so resize needs no top-up pass, a phase
// accumulator driving all motion, drawn straight onto the main canvas --
// the only thing actually different about them is that resolveSceneBlock
// only ever resolves to one of these if isPremiumSceneOwned() says so.
// None have their own ambient sound layer (no SCENE_AMBIENT_CONFIG entry)
// or Rotate-mode slot -- purely a paid visual backdrop for now.

// Shared little helper: a soft wavy ribbon between two sine curves, used
// by Aurora's ribbons below. Kept generic (not folded into
// drawAuroraScene) since drawing one is just "walk left to right on the
// top curve, then right to left on the bottom curve, fill the loop."
function drawWavyRibbon(baseYFrac, ampFrac, thicknessFrac, speed, phase, colorStops, w, h, t) {
  const steps = 20;
  ctx.beginPath();
  for (let i = 0; i <= steps; i++) {
    const xf = i / steps;
    const wave = Math.sin(xf * Math.PI * 2.2 + phase + t * speed) * ampFrac * h;
    const y = baseYFrac * h + wave - thicknessFrac * h * 0.5;
    if (i === 0) ctx.moveTo(xf * w, y); else ctx.lineTo(xf * w, y);
  }
  for (let i = steps; i >= 0; i--) {
    const xf = i / steps;
    const wave = Math.sin(xf * Math.PI * 2.2 + phase + t * speed) * ampFrac * h;
    ctx.lineTo(xf * w, baseYFrac * h + wave + thicknessFrac * h * 0.5);
  }
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, baseYFrac * h - thicknessFrac * h, 0, baseYFrac * h + thicknessFrac * h);
  grad.addColorStop(0, colorStops[0]);
  grad.addColorStop(0.5, colorStops[1]);
  grad.addColorStop(1, colorStops[2]);
  ctx.fillStyle = grad;
  ctx.fill();
}

const AURORA_CONFIG = {
  SKY_TOP: '#050612', SKY_MID: '#0a1230', SKY_HORIZON: '#132a3a',
  RIDGE_COLOR: '#04060d',
  RIBBON_PALETTES: [
    ['rgba(60,220,150,0)', 'rgba(60,220,150,0.4)', 'rgba(60,220,150,0)'],
    ['rgba(120,200,255,0)', 'rgba(120,200,255,0.32)', 'rgba(120,200,255,0)'],
    ['rgba(180,120,230,0)', 'rgba(180,120,230,0.3)', 'rgba(180,120,230,0)'],
  ],
};

function generateAuroraScene() {
  const ribbons = [];
  for (let i = 0; i < 3; i++) {
    ribbons.push({
      baseYFrac: 0.18 + i * 0.1 + Math.random() * 0.06,
      ampFrac: 0.03 + Math.random() * 0.025,
      thicknessFrac: 0.09 + Math.random() * 0.05,
      speed: 0.00025 + Math.random() * 0.0002,
      phase: Math.random() * Math.PI * 2,
      colors: AURORA_CONFIG.RIBBON_PALETTES[i % AURORA_CONFIG.RIBBON_PALETTES.length],
    });
  }
  const ridgeCount = 7 + Math.floor(Math.random() * 4);
  const ridge = [];
  for (let i = 0; i <= ridgeCount; i++) {
    ridge.push({ xFrac: i / ridgeCount, heightFrac: 0.05 + Math.random() * 0.09 });
  }
  return { ribbons, ridge, phase: 0 };
}

function updateAuroraScene() {
  if (STATE.scene !== 'aurora' || !STATE.auroraScene) return;
  STATE.auroraScene.phase += 1;
}

function drawAuroraScene() {
  const scene = STATE.auroraScene;
  if (!scene) return;
  const w = canvas.width, h = canvas.height, t = scene.phase;

  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, AURORA_CONFIG.SKY_TOP);
  sky.addColorStop(0.55, AURORA_CONFIG.SKY_MID);
  sky.addColorStop(1, AURORA_CONFIG.SKY_HORIZON);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  drawStars(); // same twinkling starfield every other scene uses

  for (const r of scene.ribbons) {
    drawWavyRibbon(r.baseYFrac, r.ampFrac, r.thicknessFrac, r.speed, r.phase, r.colors, w, h, t);
  }

  // A still mountain ridge along the bottom -- same grounding role as
  // Forest's tree line -- so the aurora reads as something happening in a
  // sky above a place, not an abstract pattern filling the screen.
  ctx.beginPath();
  ctx.moveTo(0, h);
  for (const p of scene.ridge) ctx.lineTo(p.xFrac * w, h - p.heightFrac * h);
  ctx.lineTo(w, h);
  ctx.closePath();
  ctx.fillStyle = AURORA_CONFIG.RIDGE_COLOR;
  ctx.fill();
}

const REEF_CONFIG = {
  WATER_TOP: '#02121e', WATER_MID: '#04405c', WATER_BOTTOM: '#0a6e78',
  CORAL_COLORS: ['#ff7fb0', '#7de89a', '#ffd36e', '#7ee8e0'],
};

function generateReefScene() {
  const coralCount = 6 + Math.floor(Math.random() * 4);
  const coral = [];
  for (let i = 0; i < coralCount; i++) {
    coral.push({
      xFrac: Math.random(),
      heightFrac: 0.1 + Math.random() * 0.12,
      color: REEF_CONFIG.CORAL_COLORS[i % REEF_CONFIG.CORAL_COLORS.length],
      pulsePhase: Math.random() * Math.PI * 2,
      pulseSpeed: 0.0015 + Math.random() * 0.0015,
      branches: 3 + Math.floor(Math.random() * 3),
    });
  }
  const fishCount = 4 + Math.floor(Math.random() * 3);
  const fish = [];
  for (let i = 0; i < fishCount; i++) {
    fish.push({
      yFrac: 0.15 + Math.random() * 0.5,
      phase: Math.random() * Math.PI * 2,
      speed: 0.00035 + Math.random() * 0.0003,
      dir: Math.random() < 0.5 ? 1 : -1,
      size: 8 + Math.random() * 6,
      color: REEF_CONFIG.CORAL_COLORS[(i + 1) % REEF_CONFIG.CORAL_COLORS.length],
    });
  }
  const bubbleCount = 12 + Math.floor(Math.random() * 8);
  const bubbles = [];
  for (let i = 0; i < bubbleCount; i++) {
    bubbles.push({
      xFrac: Math.random(),
      startPhase: Math.random() * Math.PI * 2,
      riseSpeed: 0.00025 + Math.random() * 0.0003,
      driftAmpFrac: 0.008 + Math.random() * 0.012,
      size: 1.5 + Math.random() * 2.5,
    });
  }
  return { coral, fish, bubbles, phase: 0 };
}

function updateReefScene() {
  if (STATE.scene !== 'reef' || !STATE.reefScene) return;
  STATE.reefScene.phase += 1;
}

function drawReefScene() {
  const scene = STATE.reefScene;
  if (!scene) return;
  const w = canvas.width, h = canvas.height, t = scene.phase;

  const water = ctx.createLinearGradient(0, 0, 0, h);
  water.addColorStop(0, REEF_CONFIG.WATER_TOP);
  water.addColorStop(0.5, REEF_CONFIG.WATER_MID);
  water.addColorStop(1, REEF_CONFIG.WATER_BOTTOM);
  ctx.fillStyle = water;
  ctx.fillRect(0, 0, w, h);

  // Soft diagonal light shafts from the surface -- a couple of wide,
  // low-alpha gradient wedges, not literal sunbeam geometry.
  for (let i = 0; i < 3; i++) {
    const rayX = w * (0.15 + i * 0.32);
    const ray = ctx.createLinearGradient(rayX, 0, rayX + w * 0.18, h);
    ray.addColorStop(0, 'rgba(220,255,240,0.10)');
    ray.addColorStop(1, 'rgba(220,255,240,0)');
    ctx.fillStyle = ray;
    ctx.beginPath();
    ctx.moveTo(rayX - w * 0.05, 0);
    ctx.lineTo(rayX + w * 0.05, 0);
    ctx.lineTo(rayX + w * 0.22, h);
    ctx.lineTo(rayX + w * 0.1, h);
    ctx.closePath();
    ctx.fill();
  }

  // Bubbles -- same rise-and-recycle motion as Christmas's chimney smoke,
  // just cooler-colored and unbounded by a chimney origin.
  for (const b of scene.bubbles) {
    const cyclePos = ((t * b.riseSpeed + b.startPhase / (Math.PI * 2)) % 1 + 1) % 1;
    const by = h * (1 - cyclePos);
    const bx = b.xFrac * w + Math.sin(cyclePos * Math.PI * 4 + b.startPhase) * b.driftAmpFrac * w;
    const alpha = 0.5 * Math.sin(cyclePos * Math.PI);
    ctx.beginPath();
    ctx.arc(bx, by, b.size, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(210,245,255,${Math.max(0, alpha).toFixed(3)})`;
    ctx.fill();
  }

  // Coral -- glowing branch clusters anchored to the sea floor.
  const floorY = h - 4;
  for (const c of scene.coral) {
    const cx = c.xFrac * w;
    const ch = c.heightFrac * h;
    const pulse = 0.6 + 0.4 * Math.sin(t * c.pulseSpeed + c.pulsePhase);
    const glow = ctx.createRadialGradient(cx, floorY - ch * 0.5, 0, cx, floorY - ch * 0.5, ch * 0.9);
    glow.addColorStop(0, `${c.color}55`); // hex + alpha suffix -- c.color is always a plain 6-digit hex from REEF_CONFIG.CORAL_COLORS
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = 0.35 * pulse;
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, floorY - ch * 0.5, ch * 0.9, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.strokeStyle = c.color;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    for (let b = 0; b < c.branches; b++) {
      const spread = (b - (c.branches - 1) / 2) * 0.12;
      ctx.beginPath();
      ctx.moveTo(cx, floorY);
      ctx.quadraticCurveTo(cx + spread * w * 0.5, floorY - ch * 0.6, cx + spread * w, floorY - ch);
      ctx.stroke();
    }
  }

  // Fish -- simple drifting silhouettes crossing the mid-water, looping
  // off one edge and back in from the other.
  for (const f of scene.fish) {
    const cyclePos = ((t * f.speed + f.phase / (Math.PI * 2)) % 1 + 1) % 1;
    const fx = f.dir > 0 ? cyclePos * (w + 60) - 30 : w - cyclePos * (w + 60) + 30;
    const fy = f.yFrac * h + Math.sin(t * 0.01 + f.phase) * 10;
    ctx.save();
    ctx.translate(fx, fy);
    ctx.scale(f.dir, 1);
    ctx.fillStyle = f.color;
    ctx.beginPath();
    ctx.ellipse(0, 0, f.size, f.size * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-f.size * 0.9, 0);
    ctx.lineTo(-f.size * 1.6, -f.size * 0.5);
    ctx.lineTo(-f.size * 1.6, f.size * 0.5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

const CAVERN_CONFIG = {
  ROCK_TOP: '#030308', ROCK_MID: '#1c1330', ROCK_BOTTOM: '#241238',
  CRYSTAL_COLORS: ['#7ee8e0', '#b06fe8', '#ff9edb', '#7ac8ff'],
  // Same four colors as CRYSTAL_COLORS above, pre-split into r,g,b so the
  // crystal fill below can vary the alpha channel with the pulse without
  // parsing a hex string on every frame.
  CRYSTAL_COLORS_RGB: ['126,232,224', '176,111,232', '255,158,219', '122,200,255'],
};

function generateCavernScene() {
  const crystalCount = 8 + Math.floor(Math.random() * 5);
  const crystals = [];
  for (let i = 0; i < crystalCount; i++) {
    const fromCeiling = Math.random() < 0.4;
    crystals.push({
      xFrac: Math.random(),
      sizeFrac: 0.05 + Math.random() * 0.09,
      fromCeiling,
      color: CAVERN_CONFIG.CRYSTAL_COLORS[i % CAVERN_CONFIG.CRYSTAL_COLORS.length],
      colorRgb: CAVERN_CONFIG.CRYSTAL_COLORS_RGB[i % CAVERN_CONFIG.CRYSTAL_COLORS_RGB.length],
      pulsePhase: Math.random() * Math.PI * 2,
      pulseSpeed: 0.0012 + Math.random() * 0.0014,
      tilt: (Math.random() - 0.5) * 0.3,
    });
  }
  const moteCount = 30 + Math.floor(Math.random() * 15);
  const motes = [];
  for (let i = 0; i < moteCount; i++) {
    motes.push({
      xFrac: Math.random(),
      yFrac: Math.random(),
      driftXFrac: 0.006 + Math.random() * 0.01,
      driftYFrac: 0.004 + Math.random() * 0.008,
      phase: Math.random() * Math.PI * 2,
      speed: 0.0004 + Math.random() * 0.0004,
      twinklePhase: Math.random() * Math.PI * 2,
    });
  }
  return { crystals, motes, phase: 0 };
}

function updateCavernScene() {
  if (STATE.scene !== 'cavern' || !STATE.cavernScene) return;
  STATE.cavernScene.phase += 1;
}

function drawCavernScene() {
  const scene = STATE.cavernScene;
  if (!scene) return;
  const w = canvas.width, h = canvas.height, t = scene.phase;

  const rock = ctx.createLinearGradient(0, 0, 0, h);
  rock.addColorStop(0, CAVERN_CONFIG.ROCK_TOP);
  rock.addColorStop(0.6, CAVERN_CONFIG.ROCK_MID);
  rock.addColorStop(1, CAVERN_CONFIG.ROCK_BOTTOM);
  ctx.fillStyle = rock;
  ctx.fillRect(0, 0, w, h);

  // Drifting dust motes -- Forest's fireflies, recolored and slower, with
  // no pulse-glow gradient (a plain twinkling dot reads better at this
  // density than 30+ radial gradients would).
  for (const m of scene.motes) {
    const drift = t * m.speed + m.phase;
    const mx = (m.xFrac + Math.sin(drift) * m.driftXFrac) * w;
    const my = (m.yFrac + Math.cos(drift * 0.8) * m.driftYFrac) * h;
    const twinkle = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(t * 0.02 + m.twinklePhase));
    ctx.beginPath();
    ctx.fillStyle = `rgba(200, 220, 255, ${(0.5 * twinkle).toFixed(3)})`;
    ctx.arc(mx, my, 1.4, 0, Math.PI * 2);
    ctx.fill();
  }

  // Crystal clusters -- a glow behind a faceted polygon, jutting up from
  // the floor or down from the ceiling depending on fromCeiling.
  for (const c of scene.crystals) {
    const cx = c.xFrac * w;
    const size = c.sizeFrac * Math.min(w, h);
    const baseY = c.fromCeiling ? 0 : h;
    const tipY = c.fromCeiling ? size * 2.2 : h - size * 2.2;
    const pulse = 0.55 + 0.45 * Math.sin(t * c.pulseSpeed + c.pulsePhase);

    const glow = ctx.createRadialGradient(cx, (baseY + tipY) / 2, 0, cx, (baseY + tipY) / 2, size * 2.2);
    glow.addColorStop(0, c.color);
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = 0.3 * pulse;
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, (baseY + tipY) / 2, size * 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.save();
    ctx.translate(cx, baseY);
    ctx.rotate(c.tilt);
    ctx.beginPath();
    ctx.moveTo(-size * 0.5, 0);
    ctx.lineTo(-size * 0.2, (tipY - baseY) * 0.7);
    ctx.lineTo(0, tipY - baseY);
    ctx.lineTo(size * 0.2, (tipY - baseY) * 0.7);
    ctx.lineTo(size * 0.5, 0);
    ctx.closePath();
    ctx.fillStyle = `rgba(${c.colorRgb}, ${(0.55 + 0.25 * pulse).toFixed(3)})`;
    ctx.fill();
    ctx.restore();
  }
}

// Static store-swatch previews (player feedback: the flat CSS gradients
// standing in for "some kind of colorful background" didn't actually show
// what the player would be buying). Real canvas renders using each
// scene's own palette (AURORA_CONFIG/REEF_CONFIG/CAVERN_CONFIG above) --
// deliberately not the exact generate*Scene()/draw*Scene() functions,
// which read/write STATE and the main gameCanvas and would need a real
// refactor to target an arbitrary canvas safely; these are small,
// self-contained, and drawn once rather than animated -- a thumbnail this
// size doesn't need motion to read as "aurora ribbons" / "coral reef" /
// "crystal cave" at a glance.
function drawStoreSwatchAurora(c) {
  const w = c.width, h = c.height, sctx = c.getContext('2d');
  const sky = sctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, AURORA_CONFIG.SKY_TOP);
  sky.addColorStop(0.55, AURORA_CONFIG.SKY_MID);
  sky.addColorStop(1, AURORA_CONFIG.SKY_HORIZON);
  sctx.fillStyle = sky;
  sctx.fillRect(0, 0, w, h);

  for (let i = 0; i < 16; i++) {
    sctx.beginPath();
    sctx.fillStyle = `rgba(255,255,255,${(0.25 + Math.random() * 0.5).toFixed(2)})`;
    sctx.arc(Math.random() * w, Math.random() * h * 0.65, Math.random() * 1.1, 0, Math.PI * 2);
    sctx.fill();
  }

  AURORA_CONFIG.RIBBON_PALETTES.forEach((colors, i) => {
    const baseY = h * (0.3 + i * 0.14);
    const grad = sctx.createLinearGradient(0, baseY - h * 0.09, 0, baseY + h * 0.09);
    grad.addColorStop(0, colors[0]);
    grad.addColorStop(0.5, colors[1]);
    grad.addColorStop(1, colors[2]);
    sctx.beginPath();
    for (let x = 0; x <= w; x += 4) {
      const y = baseY + Math.sin((x / w) * Math.PI * 2.2 + i * 1.7) * h * 0.06;
      if (x === 0) sctx.moveTo(x, y); else sctx.lineTo(x, y);
    }
    sctx.strokeStyle = grad;
    sctx.lineWidth = h * 0.05;
    sctx.lineCap = 'round';
    sctx.stroke();
  });

  sctx.beginPath();
  sctx.moveTo(0, h);
  sctx.lineTo(0, h * 0.85);
  for (let x = 0; x <= w; x += w / 6) sctx.lineTo(x, h * (0.78 + Math.random() * 0.09));
  sctx.lineTo(w, h);
  sctx.closePath();
  sctx.fillStyle = AURORA_CONFIG.RIDGE_COLOR;
  sctx.fill();
}

function drawStoreSwatchReef(c) {
  const w = c.width, h = c.height, sctx = c.getContext('2d');
  const water = sctx.createLinearGradient(0, 0, 0, h);
  water.addColorStop(0, REEF_CONFIG.WATER_TOP);
  water.addColorStop(0.5, REEF_CONFIG.WATER_MID);
  water.addColorStop(1, REEF_CONFIG.WATER_BOTTOM);
  sctx.fillStyle = water;
  sctx.fillRect(0, 0, w, h);

  const colors = REEF_CONFIG.CORAL_COLORS;
  for (let i = 0; i < 5; i++) {
    const cx = ((i + 0.5) / 5) * w + (Math.random() - 0.5) * w * 0.05;
    const chHeight = (0.28 + Math.random() * 0.22) * h;
    const topY = h - chHeight;
    const color = colors[i % colors.length];
    const glow = sctx.createRadialGradient(cx, h - chHeight * 0.5, 0, cx, h - chHeight * 0.5, chHeight * 0.85);
    glow.addColorStop(0, `${color}55`);
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    sctx.fillStyle = glow;
    sctx.beginPath();
    sctx.arc(cx, h - chHeight * 0.5, chHeight * 0.85, 0, Math.PI * 2);
    sctx.fill();

    sctx.strokeStyle = color;
    sctx.lineWidth = 2;
    sctx.lineCap = 'round';
    for (let b = 0; b < 3; b++) {
      const spread = (b - 1) * 0.14;
      sctx.beginPath();
      sctx.moveTo(cx, h);
      sctx.quadraticCurveTo(cx + spread * w * 0.5, h - chHeight * 0.6, cx + spread * w, topY);
      sctx.stroke();
    }
  }

  for (let i = 0; i < 3; i++) {
    const fx = Math.random() * w, fy = h * (0.12 + Math.random() * 0.4);
    sctx.fillStyle = colors[(i + 1) % colors.length];
    sctx.beginPath();
    sctx.ellipse(fx, fy, w * 0.045, h * 0.02, 0, 0, Math.PI * 2);
    sctx.fill();
  }

  for (let i = 0; i < 7; i++) {
    sctx.beginPath();
    sctx.strokeStyle = 'rgba(255,255,255,0.4)';
    sctx.lineWidth = 1;
    sctx.arc(Math.random() * w, Math.random() * h, 1 + Math.random() * 1.4, 0, Math.PI * 2);
    sctx.stroke();
  }
}

function drawStoreSwatchCavern(c) {
  const w = c.width, h = c.height, sctx = c.getContext('2d');
  const rock = sctx.createLinearGradient(0, 0, 0, h);
  rock.addColorStop(0, CAVERN_CONFIG.ROCK_TOP);
  rock.addColorStop(0.6, CAVERN_CONFIG.ROCK_MID);
  rock.addColorStop(1, CAVERN_CONFIG.ROCK_BOTTOM);
  sctx.fillStyle = rock;
  sctx.fillRect(0, 0, w, h);

  for (let i = 0; i < 12; i++) {
    sctx.beginPath();
    sctx.fillStyle = `rgba(200,220,255,${(0.15 + Math.random() * 0.3).toFixed(2)})`;
    sctx.arc(Math.random() * w, Math.random() * h, 1, 0, Math.PI * 2);
    sctx.fill();
  }

  const colors = CAVERN_CONFIG.CRYSTAL_COLORS;
  const colorsRgb = CAVERN_CONFIG.CRYSTAL_COLORS_RGB;
  for (let i = 0; i < 5; i++) {
    const cx = ((i + 0.5) / 5) * w + (Math.random() - 0.5) * w * 0.08;
    const fromCeiling = i % 2 === 0;
    const size = h * (0.16 + Math.random() * 0.07);
    const baseY = fromCeiling ? 0 : h;
    const tipY = fromCeiling ? size * 1.8 : h - size * 1.8;
    const rgb = colorsRgb[i % colorsRgb.length];

    const glow = sctx.createRadialGradient(cx, (baseY + tipY) / 2, 0, cx, (baseY + tipY) / 2, size * 1.8);
    glow.addColorStop(0, `rgba(${rgb},0.5)`);
    glow.addColorStop(1, `rgba(${rgb},0)`);
    sctx.fillStyle = glow;
    sctx.beginPath();
    sctx.arc(cx, (baseY + tipY) / 2, size * 1.8, 0, Math.PI * 2);
    sctx.fill();

    sctx.beginPath();
    sctx.moveTo(cx - size * 0.35, baseY);
    sctx.lineTo(cx, tipY);
    sctx.lineTo(cx + size * 0.35, baseY);
    sctx.closePath();
    sctx.fillStyle = colors[i % colors.length];
    sctx.fill();
  }
}

// Rendered once at setup, not re-rendered on every store open -- a
// product thumbnail should look the same each time a player sees it, not
// reshuffle underneath them.
function renderStoreSwatches() {
  drawStoreSwatchAurora(document.getElementById('store-swatch-aurora'));
  drawStoreSwatchReef(document.getElementById('store-swatch-reef'));
  drawStoreSwatchCavern(document.getElementById('store-swatch-cavern'));
}

// ============================================================
// SECTION 7K: SAFARI BACKGROUND (real photo, not procedural)
// ============================================================
// Every other scene here is hand-drawn canvas art -- deliberately
// different direction for this one (player request, 2026-08-16): a real,
// high-resolution photograph instead, given a slow Ken Burns pan/zoom so
// it reads as motion rather than a static slide. Two source photos (day
// and night savanna), licensed CC-BY/Pexels -- see art/CREDITS.md.
//
// Which of the two plays is picked once per Rotate-mode block and held
// for every wave in it, not rerolled each wave like every other scene's
// decorative details (see generateSafariScene's own comment) -- the
// player's explicit ask ("stays until all waves are completed").
const SAFARI_CONFIG = {
  images: { day: 'art/safari-day.jpg', night: 'art/safari-night.jpg' },
  // One full slow pan/zoom cycle, in frames at the game's ~60fps loop --
  // long and gentle on purpose, background motion, not something that
  // competes for attention with the dots/lines in front of it.
  PAN_CYCLE_FRAMES: 2700,
  ZOOM_MIN: 1.06,
  ZOOM_MAX: 1.22,
  // Where the grass/horizon line actually sits in each SOURCE photo, as a
  // fraction of its own height -- measured directly from the JPEGs (a
  // brightness/hue profile: safari-day.jpg has a sharp sky-to-grass color
  // shift right around 0.80; safari-night.jpg has no such sharp edge, so
  // this is eyeballed from where the tree silhouettes sit instead). Used
  // to place the walking-animal silhouettes ON the actual ground the
  // photo shows, mapped through the same cover-fit/pan/zoom transform the
  // background itself uses, rather than a fixed screen fraction that
  // would drift off the real horizon as the pan/zoom moves.
  HORIZON_FRAC: { day: 0.80, night: 0.87 },
  BIRD_COUNT: 3,
  ANIMAL_COUNT: 2,
};

const SAFARI_IMAGES = {
  day: Object.assign(new Image(), { src: SAFARI_CONFIG.images.day }),
  night: Object.assign(new Image(), { src: SAFARI_CONFIG.images.night }),
};

// The reroll decision rests entirely on STATE.safariVariant itself, not
// on previousScene (used below only for phase continuity) -- an earlier
// draft also required previousScene to be non-null before trusting an
// existing variant, which broke the very save-restore this was meant to
// protect: right after a reload, STATE.safariScene is always null (a
// fresh page has no "previous wave" at all) even when
// handleLoadGameFromTitle/handleLoadGame/startGameFromTitle just
// restored a perfectly good STATE.safariVariant from the save a moment
// earlier, so that ANDed-in previousScene check discarded it and
// rerolled anyway (review catch, PR #91's own follow-up). Every call
// site that means "this is genuinely a fresh pick" now explicitly nulls
// STATE.safariVariant itself first (see startGameFromTitle's non-autoload
// branch, handleRestartGame), and every call site that means "resume
// this exact save" explicitly restores it first (see
// handleLoadGameFromTitle/handleLoadGame/startGameFromTitle's autoload
// branch, all reading SAVE_KEY's own safariVariant field via
// saveGame/loadSave) -- so a plain null check here is both necessary and
// sufficient, regardless of whether this is mid-block, a fresh reload, a
// save restore, or a genuinely new playthrough.
//
// previousScene is still the prior wave's STATE.safariScene, used only so
// the pan/zoom's phase keeps counting forward rather than jumping when
// truly continuing mid-block (null just means "start the pan cycle at a
// random point," never affects which variant plays).
// A few small birds drifting across the day sky -- reuses the same
// "crosses the screen, wraps around the opposite edge" technique as the
// beach's boat/Halloween's bats, just higher up and smaller. Generated
// (and drawn) for both variants, same as animals below, but birds only
// actually get drawn for 'day' -- see drawSafariScene.
function generateSafariBirds() {
  const birds = [];
  for (let i = 0; i < SAFARI_CONFIG.BIRD_COUNT; i++) {
    birds.push({
      xFrac: Math.random(),
      yFrac: 0.12 + Math.random() * 0.35, // upper sky, well above the horizon
      direction: Math.random() < 0.5 ? 1 : -1,
      speed: 0.00007 + Math.random() * 0.00006,
      sizeFrac: 0.012 + Math.random() * 0.008,
      wingPhase: Math.random() * Math.PI * 2,
      wingSpeed: 0.12 + Math.random() * 0.05,
    });
  }
  return birds;
}

// A couple of giraffe silhouettes walking along the actual grass line --
// same horizon-crossing technique as the birds above, just slower and
// anchored to SAFARI_CONFIG.HORIZON_FRAC instead of drifting through open
// sky. Ties the scene to "Animal Kingdom" directly, and to the ambient
// wildlife event layer's elephant rumble (SCENE_AMBIENT_CONFIG.safari) --
// distinct animals, same idea: this scene actually has wildlife in it,
// not just a savanna backdrop.
function generateSafariAnimals() {
  const animals = [];
  for (let i = 0; i < SAFARI_CONFIG.ANIMAL_COUNT; i++) {
    animals.push({
      xFrac: Math.random(),
      direction: Math.random() < 0.5 ? 1 : -1,
      speed: 0.000035 + Math.random() * 0.00003,
      sizeFrac: 0.05 + Math.random() * 0.02,
      legPhase: Math.random() * Math.PI * 2,
    });
  }
  return animals;
}

function generateSafariScene(previousScene) {
  if (!STATE.safariVariant) {
    STATE.safariVariant = Math.random() < 0.5 ? 'day' : 'night';
  }
  // Staggers where each fresh block's pan cycle starts, so consecutive
  // safari blocks don't all visibly begin from the exact same framing.
  // Not reset to 0 at the start of a scene -- can already be anywhere
  // from 0-2699 (or an arbitrarily large carried-forward value from a
  // long-running previous wave), which matters below.
  const phase = previousScene ? previousScene.phase : Math.floor(Math.random() * SAFARI_CONFIG.PAN_CYCLE_FRAMES);
  return {
    variant: STATE.safariVariant,
    phase,
    // Foreground wildlife/birds are always fresh per wave, same spirit as
    // every other scene's own decorative details (see this file's
    // "rerolled fresh every wave" comment in startWave) -- only the
    // day/night photo itself has to hold steady across a block.
    birds: generateSafariBirds(),
    animals: generateSafariAnimals(),
    // Night-only occasional shooting star -- starts with nothing active
    // and a short random delay before the first one, same pattern as the
    // event ambient sounds' own startEventAmbientLayer. nextSpawnFrame is
    // compared directly against scene.phase (an absolute, ever-growing
    // counter, not a per-scene-relative one -- see updateSafariScene), so
    // it has to be offset by the scene's own starting phase above, not
    // just a small delay on its own (review catch, PR #92) -- phase can
    // already be up to PAN_CYCLE_FRAMES on a fresh scene, or arbitrarily
    // larger on a carried-forward one, which would otherwise make
    // `phase >= nextSpawnFrame` true (spawning immediately) almost every
    // time instead of after the intended delay.
    shootingStar: { active: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 1, nextSpawnFrame: phase + 200 + Math.floor(Math.random() * 400) },
  };
}

function updateSafariScene() {
  if (STATE.scene !== 'safari' || !STATE.safariScene) return;
  const scene = STATE.safariScene;
  scene.phase += 1;

  for (const bird of scene.birds) {
    bird.xFrac += bird.speed * bird.direction;
    if (bird.xFrac > 1.08) bird.xFrac = -0.08;
    else if (bird.xFrac < -0.08) bird.xFrac = 1.08;
    bird.wingPhase += bird.wingSpeed;
  }

  for (const animal of scene.animals) {
    animal.xFrac += animal.speed * animal.direction;
    if (animal.xFrac > 1.1) animal.xFrac = -0.1;
    else if (animal.xFrac < -0.1) animal.xFrac = 1.1;
    animal.legPhase += 0.05 * (animal.speed / 0.00005); // faster stride reads as faster walking, not just sliding
  }

  if (scene.variant === 'night') {
    const star = scene.shootingStar;
    if (star.active) {
      star.x += star.vx;
      star.y += star.vy;
      star.life--;
      if (star.life <= 0) {
        star.active = false;
        star.nextSpawnFrame = scene.phase + 480 + Math.floor(Math.random() * 900); // roughly 8-23s at 60fps
      }
    } else if (scene.phase >= star.nextSpawnFrame) {
      star.active = true;
      star.x = 0.1 + Math.random() * 0.6;
      star.y = 0.05 + Math.random() * 0.3;
      const angle = (Math.PI / 5) + Math.random() * (Math.PI / 6); // shallow downward diagonal
      const speed = 0.006 + Math.random() * 0.004;
      star.vx = Math.cos(angle) * speed;
      star.vy = Math.sin(angle) * speed;
      star.maxLife = 22 + Math.floor(Math.random() * 14);
      star.life = star.maxLife;
    }
  }
}

// Small dark double-arc silhouette, the classic "distant bird" shape --
// wingSpan flexes with wingPhase so it actually flaps rather than
// gliding rigidly.
function drawSafariBird(x, y, size, wingPhase) {
  const flap = Math.sin(wingPhase) * size * 0.7;
  ctx.strokeStyle = 'rgba(20, 22, 26, 0.75)';
  ctx.lineWidth = Math.max(1, size * 0.18);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x - size, y + flap * 0.3);
  ctx.quadraticCurveTo(x - size * 0.4, y - flap, x, y);
  ctx.quadraticCurveTo(x + size * 0.4, y - flap, x + size, y + flap * 0.3);
  ctx.stroke();
}

// A simplified giraffe silhouette (long legs + very long neck + tiny head
// relative to a short body is what actually reads as "giraffe" even
// tiny and pure-black -- a giraffe's legs and neck are each roughly as
// long as its whole body is tall, real proportions, not a stylization).
// Walking, not standing, via a four-legged stride animation. `size` is
// the animal's total height, ground to the top of its head. Drawn
// facing its direction of travel.
function drawSafariGiraffe(x, groundY, size, direction, legPhase) {
  ctx.fillStyle = 'rgba(12, 12, 15, 0.82)';
  ctx.strokeStyle = 'rgba(12, 12, 15, 0.82)';
  ctx.lineCap = 'round';

  const legsH = size * 0.4;
  const bodyH = size * 0.15;
  const bodyW = size * 0.5;
  const bodyBottomY = groundY - legsH;
  const bodyCenterY = bodyBottomY - bodyH / 2;

  // Four legs (two diagonal pairs alternating, the way a real walking
  // gait actually splits) rather than two -- reads as an animal standing
  // on the ground, not perched on a single pair of sticks.
  ctx.lineWidth = Math.max(1.5, size * 0.035);
  const strideA = Math.sin(legPhase) * size * 0.07;
  const strideB = Math.sin(legPhase + Math.PI) * size * 0.07;
  const legXOffsets = [-0.32, -0.12, 0.12, 0.32];
  const legStrides = [strideA, strideB, strideB, strideA];
  for (let i = 0; i < 4; i++) {
    const lx = x + legXOffsets[i] * bodyW;
    ctx.beginPath();
    ctx.moveTo(lx, bodyBottomY);
    ctx.lineTo(lx + legStrides[i], groundY);
    ctx.stroke();
  }

  // Body -- short and shallow relative to the legs/neck, real proportions.
  ctx.beginPath();
  ctx.ellipse(x, bodyCenterY, bodyW / 2, bodyH / 2, 0, 0, Math.PI * 2);
  ctx.fill();

  // Neck -- the giraffe's whole visual signature: long, tapered,
  // leaning forward in the direction of travel from the shoulder (the
  // front of the body) up to a tiny head. Roughly as long as the legs.
  const neckBaseX = x + direction * bodyW * 0.36;
  const neckBaseY = bodyCenterY - bodyH * 0.3;
  const headX = neckBaseX + direction * size * 0.16;
  const headY = groundY - size;
  const neckBaseHalfW = size * 0.05;
  const neckTopHalfW = size * 0.025;
  const perpX = direction * neckTopHalfW * 0.4; // slight taper direction, not a true perpendicular (cheap approximation, fine at this scale)
  ctx.beginPath();
  ctx.moveTo(neckBaseX - neckBaseHalfW, neckBaseY);
  ctx.lineTo(headX - neckTopHalfW + perpX, headY + size * 0.06);
  ctx.lineTo(headX + neckTopHalfW + perpX, headY + size * 0.06);
  ctx.lineTo(neckBaseX + neckBaseHalfW, neckBaseY);
  ctx.closePath();
  ctx.fill();

  // Small head + two short ossicones (the pair of knobs on a giraffe's
  // head) -- the one extra detail that keeps this from reading as just
  // "some animal with a long neck" at a glance.
  ctx.beginPath();
  ctx.ellipse(headX, headY, size * 0.055, size * 0.04, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = Math.max(1, size * 0.02);
  ctx.beginPath();
  ctx.moveTo(headX - size * 0.02, headY - size * 0.03);
  ctx.lineTo(headX - size * 0.02, headY - size * 0.065);
  ctx.moveTo(headX + size * 0.02, headY - size * 0.03);
  ctx.lineTo(headX + size * 0.02, headY - size * 0.065);
  ctx.stroke();

  // Tail, trailing off the back (opposite the direction of travel).
  ctx.lineWidth = Math.max(1, size * 0.02);
  ctx.beginPath();
  ctx.moveTo(x - direction * bodyW * 0.5, bodyCenterY);
  ctx.lineTo(x - direction * bodyW * 0.62, bodyCenterY + size * 0.16);
  ctx.stroke();
}

function drawSafariShootingStar(star, w, h) {
  if (!star.active) return;
  const alpha = star.life / star.maxLife;
  const x = star.x * w, y = star.y * h;
  const tailX = x - star.vx * w * 4;
  const tailY = y - star.vy * h * 4;
  const grad = ctx.createLinearGradient(tailX, tailY, x, y);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(1, `rgba(255,255,255,${(alpha * 0.9).toFixed(3)})`);
  ctx.strokeStyle = grad;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(tailX, tailY);
  ctx.lineTo(x, y);
  ctx.stroke();
}

function drawSafariScene() {
  const scene = STATE.safariScene;
  if (!scene) return;
  const w = canvas.width, h = canvas.height;
  const img = SAFARI_IMAGES[scene.variant];

  // Still loading (first time this session needs it) -- a flat fill
  // matching the variant's own mood beats a blank/white flash while the
  // photo finishes downloading.
  if (!img.complete || img.naturalWidth === 0) {
    ctx.fillStyle = scene.variant === 'day' ? '#bcd9ea' : '#0a0d18';
    ctx.fillRect(0, 0, w, h);
    return;
  }

  const cfg = SAFARI_CONFIG;
  const cycle = (scene.phase % cfg.PAN_CYCLE_FRAMES) / cfg.PAN_CYCLE_FRAMES; // 0..1, wraps
  // Smooth back-and-forth rather than a hard jump-cut loop: eases
  // 0 -> 1 -> 0 across the cycle instead of snapping back to start.
  const t = 0.5 - 0.5 * Math.cos(cycle * Math.PI * 2);
  const zoom = cfg.ZOOM_MIN + (cfg.ZOOM_MAX - cfg.ZOOM_MIN) * t;

  // Cover-fit (like CSS object-fit: cover): scale so the shorter
  // canvas-relative dimension is fully covered, then crop the overflow.
  const imgAspect = img.naturalWidth / img.naturalHeight;
  const canvasAspect = w / h;
  let drawW, drawH;
  if (imgAspect > canvasAspect) {
    drawH = h * zoom;
    drawW = drawH * imgAspect;
  } else {
    drawW = w * zoom;
    drawH = drawW / imgAspect;
  }
  const panX = (drawW - w) * t;
  const panY = (drawH - h) * (0.5 + 0.3 * Math.sin(cycle * Math.PI * 2));
  ctx.drawImage(img, -panX, -panY, drawW, drawH);

  // Foreground wildlife/sky decoration, mapped into the SAME cover-fit/
  // pan/zoom space the photo itself just used -- specifically the
  // giraffes' ground line (SAFARI_CONFIG.HORIZON_FRAC), so they stay on
  // the actual grass the photo shows instead of drifting off it as the
  // pan/zoom moves. Drawn before the vignette below so they pick up the
  // same edge-darkening the photo does, not sitting artificially crisp
  // on top of it.
  const horizonY = -panY + cfg.HORIZON_FRAC[scene.variant] * drawH;
  for (const animal of scene.animals) {
    drawSafariGiraffe(animal.xFrac * w, horizonY, animal.sizeFrac * h, animal.direction, animal.legPhase);
  }
  if (scene.variant === 'day') {
    for (const bird of scene.birds) {
      drawSafariBird(bird.xFrac * w, bird.yFrac * h, bird.sizeFrac * h, bird.wingPhase);
    }
  } else {
    drawSafariShootingStar(scene.shootingStar, w, h);
  }

  // A real photo has arbitrary local contrast a hand-drawn scene never
  // does -- a uniform radial dim (clear center, where the board mostly
  // sits, darker toward the edges) keeps dots/lines readable everywhere
  // without hiding the photo itself, and doubles as the same moody
  // atmosphere every other scene already has (the day variant is
  // otherwise far brighter than anything else in SCENE_LIST).
  const vignette = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.25, w / 2, h / 2, Math.max(w, h) * 0.72);
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(1, scene.variant === 'day' ? 'rgba(10,14,8,0.4)' : 'rgba(0,0,0,0.5)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, w, h);
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
// clearEraseMode defaults to true -- every ordinary way out of the menu
// (Resume, Save, Load, Restart, Exit, the title-screen backstop in
// startWave) lands back in normal draw mode, so the ERASE toggle can never
// stay lit with no visible cue why taps aren't drawing lines. The one
// exception is #pause-erase's own click handler, which just set
// STATE.eraseMode to exactly what it wants and passes false here --
// otherwise this same safety reset would undo the very toggle the player
// just asked for before they ever saw it take effect.
function closePauseMenuUI({ clearEraseMode = true } = {}) {
  document.getElementById('pause-overlay').classList.remove('visible');
  document.getElementById('pause-button').setAttribute('aria-expanded', 'false');
  document.getElementById('save-tip').classList.remove('visible');
  document.getElementById('pause-save').classList.remove('save-tip-pulse');
  stopPauseFactRotation();
  if (clearEraseMode) {
    STATE.eraseMode = false;
    STATE.eraseArmed = false;
    document.getElementById('pause-erase').classList.remove('active');
  }
}

// A rare nudge toward Save Game for a player who might not have noticed it
// -- only worth showing to someone who's genuinely never used it (see
// loadSave) and only once a run has gone on long enough (wave 10+) that
// losing all progress would actually sting. Rolled fresh, and independently,
// on every pause rather than latched once true, so most pauses still show
// nothing at all.
const SAVE_TIP_CONFIG = { START_WAVE: 10, PROBABILITY: 0.1 };
function maybeShowSaveTip() {
  const shouldShow = STATE.wave >= SAVE_TIP_CONFIG.START_WAVE && !loadSave() && Math.random() < SAVE_TIP_CONFIG.PROBABILITY;
  document.getElementById('save-tip').classList.toggle('visible', shouldShow);
  document.getElementById('pause-save').classList.toggle('save-tip-pulse', shouldShow);
}

function pauseGame() {
  if (STATE.paused || STATE.phase === 'TITLE') return; // nothing meaningful to pause from the title screen
  STATE.paused = true;
  // A touch/key/button still down when pause was triggered must not keep
  // steering or thrusting once resumed.
  STATE.cockpitLeftStick = null;
  STATE.cockpitRightStick = null;
  STATE.cockpitKeys = { w: false, a: false, s: false, d: false, up: false, down: false, zoomIn: false, zoomOut: false };
  STATE.cockpitMouseButtons = { left: false, right: false };
  // Clearing the raw inputs above isn't enough on its own now that they're
  // smoothed (see CONTROL_SMOOTHING) -- without also resetting the smoothed
  // values, the ship would keep coasting through a few more frames of
  // steering/thrust right after resuming, which is exactly what this
  // function exists to prevent.
  STATE.cockpitThrottleSmoothed = 0;
  STATE.cockpitTurnSmoothed = { x: 0, y: 0 };
  if (STATE.audioCtx && STATE.masterGain) {
    const t = STATE.audioCtx.currentTime;
    STATE.masterGain.gain.cancelScheduledValues(t);
    STATE.masterGain.gain.setValueAtTime(STATE.masterGain.gain.value, t);
    STATE.masterGain.gain.linearRampToValueAtTime(0.0001, t + 0.25);
  }
  document.getElementById('pause-save-toast').classList.remove('visible');
  document.getElementById('pause-overlay').classList.add('visible');
  document.getElementById('pause-button').setAttribute('aria-expanded', 'true');
  startPauseFactRotation();
  maybeShowSaveTip();
}

function resumeGame({ clearEraseMode = true } = {}) {
  if (!STATE.paused) return;
  STATE.paused = false;
  if (STATE.audioCtx && STATE.masterGain) {
    const t = STATE.audioCtx.currentTime;
    STATE.masterGain.gain.cancelScheduledValues(t);
    STATE.masterGain.gain.setValueAtTime(STATE.masterGain.gain.value, t);
    STATE.masterGain.gain.linearRampToValueAtTime(1.0, t + 0.25);
  }
  closePauseMenuUI({ clearEraseMode });
}

function togglePause() {
  if (STATE.phase === 'TITLE') return; // nothing to pause before the game has started
  if (STATE.paused) resumeGame(); else pauseGame();
}

// ============================================================
// HOW-TO-PLAY OVERLAY
// ============================================================
// Two entry points: the standalone #help-button, title-screen-only (a
// curious new player hasn't paused anything -- there's nothing to
// resume), and #pause-help inside the in-game menu, which already
// paused the board before getting here. Either way this overlay's own
// opaque backdrop blocks every pointer event from reaching whatever's
// underneath while it's open, so there's nothing else to freeze here.
function openHelp() {
  document.getElementById('pause-overlay').classList.remove('visible'); // no-op if reached from the title screen, where it was never shown
  document.getElementById('help-overlay').classList.add('visible');
}

// Closing lands back in the game, not back in the menu that opened this --
// one tap out of Help is simpler than two. resumeGame() is already a
// guarded no-op when STATE.paused is false, which is exactly the
// title-screen case, so no separate branch is needed for it here.
function closeHelp() {
  document.getElementById('help-overlay').classList.remove('visible');
  resumeGame();
}

// ============================================================
// STORE OVERLAY -- demo storefront (see STORE_PRODUCTS/
// completeSimulatedPurchase and MONETIZATION_ARCHITECTURE.md). Same two
// entry points as Help above: the title-screen-only #store-open-button,
// and #pause-shop inside the in-game menu.
// ============================================================
// Which of #store-product/#store-checkout/#store-success is showing --
// openStore always resets to 'product' so a player who backed out mid
// checkout, closed the store, and reopened it doesn't land back in the
// checkout step for a purchase they never confirmed.
function renderStoreProduct() {
  const product = STORE_PRODUCTS[0];
  const owned = product.sceneIds.every(isPremiumSceneOwned);
  document.getElementById('store-buy-button').style.display = owned ? 'none' : 'block';
  document.getElementById('store-owned-badge').classList.toggle('visible', owned);
}

function setStorePanelStep(step) {
  document.getElementById('store-product').classList.toggle('visible', step === 'product');
  document.getElementById('store-checkout').classList.toggle('visible', step === 'checkout');
  document.getElementById('store-success').classList.toggle('visible', step === 'success');
}

function openStore() {
  document.getElementById('pause-overlay').classList.remove('visible'); // no-op if reached from the title screen, where it was never shown
  renderStoreProduct();
  setStorePanelStep('product');
  document.getElementById('store-overlay').classList.add('visible');
}

function closeStore() {
  document.getElementById('store-overlay').classList.remove('visible');
  resumeGame(); // guarded no-op from the title screen, same as closeHelp
}

function setupStoreListeners() {
  renderStoreSwatches();
  document.getElementById('store-open-button').addEventListener('click', openStore);
  document.getElementById('pause-shop').addEventListener('click', openStore);
  document.getElementById('store-close').addEventListener('click', closeStore);
  document.getElementById('store-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'store-overlay') closeStore(); // tapping the backdrop itself, not the panel
  });
  document.getElementById('store-buy-button').addEventListener('click', () => setStorePanelStep('checkout'));
  document.getElementById('store-checkout-cancel').addEventListener('click', () => setStorePanelStep('product'));
  document.getElementById('store-simulate-button').addEventListener('click', () => {
    completeSimulatedPurchase(STORE_PRODUCTS[0].id);
    setStorePanelStep('success');
  });
  document.getElementById('store-success-done').addEventListener('click', () => {
    renderStoreProduct();
    setStorePanelStep('product');
  });
}

function handleSaveGame() {
  const ok = saveGame();
  const toast = document.getElementById('pause-save-toast');
  toast.textContent = ok ? 'Game Saved' : 'Could Not Save';
  toast.classList.add('visible');
  setTimeout(() => toast.classList.remove('visible'), 1800);
  // The tip's whole job was to get them to do exactly this -- job done.
  document.getElementById('save-tip').classList.remove('visible');
  document.getElementById('pause-save').classList.remove('save-tip-pulse');
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
  // A save doesn't store how many scene-ambience layers had built up --
  // there's no correct streak to resume into, so start the reveal over
  // rather than guess.
  resetSceneAmbience();
  startFadeToBlack(() => {
    STATE.score = save.score;
    if (save.rotateSeed) STATE.rotateSeed = save.rotateSeed; // this save's own order, not whatever's currently in STATE
    STATE.safariVariant = save.safariVariant || null; // this save's own day/night pick, not a leftover from earlier in this page session
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
  resetSceneAmbience(); // a genuine fresh start, same reasoning as handleLoadGame above
  STATE.rotateSeed = newRotateSeed(); // same reasoning as startGameFromTitle's fresh-start branch
  STATE.safariScene = null;
  STATE.safariVariant = null; // same reasoning as startGameFromTitle's fresh-start branch
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
// Start Game only silently resumes when Auto Load Last Save is checked
// (see startGameFromTitle) -- the subtitle should promise exactly that,
// not more, or a save sitting there unloaded (the normal case, since
// it's off by default) would read as a broken promise the moment
// starting begins wave 1 instead.
function titleSubtitleText() {
  if (STATE.autoLoadEnabled && STATE.pendingResume) {
    return `Start Game will resume — wave ${STATE.pendingResume.wave}`;
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
  STATE.eraseMode = false;
  STATE.eraseArmed = false;
  STATE.portals = null;
  STATE.portalThreads = [];
  STATE.activePortalThread = null;
  STATE.ship = null;
  STATE.cockpitShip = null;
  STATE.cockpitLeftStick = null;
  STATE.cockpitRightStick = null;
  STATE.cockpitKeys = { w: false, a: false, s: false, d: false, up: false, down: false, zoomIn: false, zoomOut: false };
  STATE.cockpitMousePos = null;
  STATE.cockpitMouseButtons = { left: false, right: false };
  STATE.cockpitThrottleSmoothed = 0;
  STATE.cockpitTurnSmoothed = { x: 0, y: 0 };
  STATE.cockpitRevealDir = null;
  STATE.cockpitWaypointAngle = null;
  STATE.cockpitWaypointTargetId = null;
  STATE.cockpitActiveDot = null;
  STATE.cockpitPath = [];
  STATE.cockpitLines = [];
  teardownCockpitScene();
  document.getElementById('pause-erase').classList.remove('active');
  hideTutorialHint(true); // in-wave UI must never linger over the title screen
  document.getElementById('achievement-toast').classList.remove('visible');
  STATE.achievementQueue = [];
  STATE.achievementToastActive = false;
  if (STATE.audioCtx) stopAllScheduledAudio(STATE.audioCtx.currentTime);
  resetSceneAmbience(); // nothing should keep playing over the title screen

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
  // Hint and Erase both hand control straight back to the board after
  // acting, instead of leaving the menu sitting over the very thing they
  // just turned on -- a player who just armed erase mode needs to tap a
  // line next, not tap through another menu first (review feedback: Mom
  // finding the old standalone buttons undiscoverable is exactly what
  // this menu fixes, but only if picking an action doesn't just trade one
  // kind of confusion for another).
  document.getElementById('pause-hint').addEventListener('click', () => {
    triggerHintPulse();
    resumeGame();
  });
  document.getElementById('pause-erase').addEventListener('click', () => {
    toggleEraseMode(); // sets STATE.eraseMode to exactly what this tap intends
    resumeGame({ clearEraseMode: false }); // ...so the ordinary resume-clears-erase safety net must sit this one out
  });
  // The banner itself doubles as an escape hatch -- only ever visible
  // while erase mode is on (see updateEraseModeBanner), so toggling here
  // always means turning it back off, no trip through the pause menu
  // required.
  document.getElementById('erase-mode-banner').addEventListener('click', toggleEraseMode);
  document.getElementById('pause-help').addEventListener('click', openHelp);
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
  // See #message-content.title-screen in style.css -- only the title
  // screen's content column needs to actually receive clicks/touches
  // (it's scrollable and holds real buttons); WAVE_COMPLETE's overlay
  // stays pass-through so its own tap-to-advance still reaches the canvas.
  document.getElementById('message-content').classList.toggle('title-screen', isTitleScreen);
  document.getElementById('sound-hint').classList.toggle('visible', isTitleScreen);
  document.getElementById('difficulty-selector').classList.toggle('visible', isTitleScreen);
  document.getElementById('scene-row').classList.toggle('visible', isTitleScreen);
  document.getElementById('store-row').classList.toggle('visible', isTitleScreen);
  document.getElementById('flight-mode-row').classList.toggle('visible', isTitleScreen);
  document.getElementById('cockpit-mode-row').classList.toggle('visible', isTitleScreen);
  document.getElementById('title-load-row').classList.toggle('visible', isTitleScreen);
  document.getElementById('share-row').classList.toggle('visible', isTitleScreen);
  document.getElementById('start-game-row').classList.toggle('visible', isTitleScreen);
  if (isTitleScreen) {
    refreshDifficultyButtons();
    refreshTitleLoadRow();
    refreshSceneSelector();
  }
}

function hideMessage() {
  document.getElementById('message-overlay').style.opacity = '0';
  // Every row in here with real pointer-events (title-only and
  // WAVE_COMPLETE-only alike) needs explicit cleanup — without it, they'd
  // stay clickable (invisibly, opacity alone doesn't disable
  // pointer-events) over whatever dots happen to render underneath once
  // play starts.
  document.getElementById('message-content').classList.remove('title-screen');
  document.getElementById('difficulty-selector').classList.remove('visible');
  document.getElementById('scene-row').classList.remove('visible');
  document.getElementById('store-row').classList.remove('visible');
  document.getElementById('flight-mode-row').classList.remove('visible');
  document.getElementById('cockpit-mode-row').classList.remove('visible');
  document.getElementById('title-load-row').classList.remove('visible');
  document.getElementById('share-row').classList.remove('visible');
  document.getElementById('start-game-row').classList.remove('visible');
  document.getElementById('postcard-row').classList.remove('visible');
}

// ------------------------------------------------------------
// Sharing: a plain link from the title screen, and a composited
// screenshot-postcard from a WAVE_COMPLETE that actually earned an
// achievement (see checkWaveComplete). Both funnel through the Web Share
// API where available (native share sheet, works with or without a file
// attached) and fall back to something that still works everywhere else.
// ------------------------------------------------------------

// The itch.io storefront page is the promoted player-facing URL (see
// SOURCE_OF_TRUTH.md) -- the one to actually hand someone. Cloudflare
// Pages (lumina-8f0.pages.dev) and GitHub Pages remain the underlying
// deploy hosts (same build, pushed everywhere in one job -- see
// deploy-pages.yml), but they're not what gets shared with players.
const CANONICAL_SHARE_URL = 'https://draclif.itch.io/lumina';

function showShareToast(text) {
  const toast = document.getElementById('share-toast');
  toast.textContent = text;
  toast.classList.add('visible');
  setTimeout(() => toast.classList.remove('visible'), 1800);
}

async function shareGameLink() {
  const shareData = { title: 'Lumina', text: 'Connect the dots. Make the music.', url: CANONICAL_SHARE_URL };
  if (navigator.share) {
    try {
      await navigator.share(shareData);
    } catch (e) {
      // Includes the player just cancelling their own share sheet --
      // not a failure worth reporting as one.
    }
    return;
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(CANONICAL_SHARE_URL);
      showShareToast('Link Copied');
      return;
    } catch (e) { /* fall through to the generic failure message below */ }
  }
  showShareToast('Could Not Share');
}

const POSTCARD_CONFIG = {
  WIDTH: 640,
  HEIGHT: 720,
  MARGIN: 70,           // dark starfield margin around the card, visible on all sides (see "bleached white" below)
  BORDER: 22,           // thin white polaroid border on the photo's top/left/right
  BOTTOM_BORDER: 130,   // the polaroid's own thicker bottom strip -- a real Polaroid's caption area, where the
                         // wave caption AND the play-free URL are both written (see buildWavePostcard)
  CROP_FRACTION: 0.75,  // fallback centered-crop fraction when there's no board to frame (see computePostcardCropRect)
  CROP_PADDING_PX: 90,  // breathing room around the dots' own bounding box, in screen pixels
  CROP_MIN_SIZE_PX: 220, // floor so a 1-pair board doesn't crop in to an unreadably tight square
};

// Frames the photo around the dots actually on screen, in SCREEN space
// (post-camera-transform), instead of a fixed fraction of the canvas
// centered on the middle of the screen. A fixed center-crop reads fine on
// an early wave where the camera sits close in, but on a wide/late wave
// (see WIDE_WORLD_START_WAVE) the camera zooms out to fit far more world
// than a handful of dots need, so a plain center-crop mostly grabbed empty
// background with a couple of tiny, barely-visible dots adrift in it
// (player report, attached screenshot: "the screenshot is awful"). Falls
// back to the old fixed centered crop when there's no board to measure
// (e.g. buildWavePostcard called from the title screen in tests).
function computePostcardCropRect() {
  const dots = STATE.dots;
  if (!dots || !dots.length) {
    const size = Math.min(canvas.width, canvas.height) * POSTCARD_CONFIG.CROP_FRACTION;
    return { x: (canvas.width - size) / 2, y: (canvas.height - size) / 2, size };
  }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const dot of dots) {
    const p = worldToScreen(dot.x, dot.y);
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  const pad = POSTCARD_CONFIG.CROP_PADDING_PX;
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const contentSize = Math.max(maxX - minX, maxY - minY) + pad * 2;

  // Square crop, sized to the content but never larger than the shorter
  // canvas dimension (there's nothing to zoom OUT for) and never smaller
  // than CROP_MIN_SIZE_PX (a single close-together pair shouldn't crop in
  // so tight it reads as an abstract close-up instead of a game board).
  const maxSize = Math.min(canvas.width, canvas.height);
  const size = Math.min(maxSize, Math.max(POSTCARD_CONFIG.CROP_MIN_SIZE_PX, contentSize));

  // Centered on the content, then nudged back on-canvas if that would
  // spill past an edge (e.g. a group hugging one side of a wide world).
  let x = cx - size / 2, y = cy - size / 2;
  x = Math.max(0, Math.min(canvas.width - size, x));
  y = Math.max(0, Math.min(canvas.height - size, y));
  return { x, y, size };
}

// Composites a small SUBSET of the just-completed board, framed around the
// actual dots (see computePostcardCropRect) rather than the whole canvas,
// into a real Polaroid-style photo -- straight (no tilt), a thin white
// border on three sides, and a thicker bottom border carrying the wave
// caption AND the play-free URL, exactly where a real Polaroid gets
// written on. Sits on a starfield card with real dark margin showing on
// every side (player report: "since when does our space look bleached
// white?" -- the previous layout's white card filled nearly the whole
// frame, leaving almost no visible space background). The play link is
// baked directly into the pixels, sized to actually be read and typed in
// by hand -- not shrunk down to an afterthought (player report: "make
// sure that URL is legible and not so tiny that somebody can't see it").
function buildWavePostcard() {
  const { WIDTH: W, HEIGHT: H, MARGIN, BORDER, BOTTOM_BORDER } = POSTCARD_CONFIG;
  const pc = document.createElement('canvas');
  pc.width = W;
  pc.height = H;
  const pctx = pc.getContext('2d');

  const bg = pctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#0d0a24');
  bg.addColorStop(1, '#1c1440');
  pctx.fillStyle = bg;
  pctx.fillRect(0, 0, W, H);

  // Cheap deterministic decorative stars behind the photo -- not
  // STATE.stars (that's live gameplay state), just enough sparkle for the
  // card to read as "space" through the now much more visible margin
  // around the Polaroid.
  let seed = 42;
  const rand = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  pctx.fillStyle = '#ffffff';
  for (let i = 0; i < 60; i++) {
    pctx.globalAlpha = rand() * 0.6 + 0.15;
    pctx.beginPath();
    pctx.arc(rand() * W, rand() * H, rand() * 1.3 + 0.3, 0, Math.PI * 2);
    pctx.fill();
  }
  pctx.globalAlpha = 1;

  const cardW = W - MARGIN * 2;
  const photoSize = cardW - BORDER * 2;
  const cardH = BORDER + photoSize + BOTTOM_BORDER;
  const cardX = (W - cardW) / 2;
  const cardY = (H - cardH) / 2;

  pctx.shadowColor = 'rgba(0,0,0,0.5)';
  pctx.shadowBlur = 26;
  pctx.shadowOffsetY = 12;
  pctx.fillStyle = '#fdfaf3';
  pctx.fillRect(cardX, cardY, cardW, cardH);
  pctx.shadowColor = 'transparent';
  pctx.shadowBlur = 0;
  pctx.shadowOffsetY = 0;

  // The photo: an actual SUBSET of the real just-rendered gameplay canvas
  // (drawImage straight off `canvas`, not a re-drawn/synthesized
  // approximation of it), framed around the dots themselves rather than a
  // fixed slice of whatever the camera happens to be showing (see
  // computePostcardCropRect).
  //
  // `canvas` itself has no black fill -- render() clears it to fully
  // TRANSPARENT (ctx.clearRect) every frame; the game only LOOKS like
  // black space because <body>'s own CSS background is #000 showing
  // through those transparent pixels (see style.css). drawImage copies
  // that transparency faithfully, which used to let the white card
  // underneath bleed through as "space" (player report, side-by-side
  // screenshots: the postcard's photo was bright white where the real
  // game -- confirmed via an actual phone screenshot of the same wave --
  // is black). Filling the photo rect black FIRST makes the transparent
  // regions of the real screenshot resolve to the same black the game
  // actually renders against, without altering a single real pixel drawn
  // by the game itself.
  const crop = computePostcardCropRect();
  pctx.fillStyle = '#000000';
  pctx.fillRect(cardX + BORDER, cardY + BORDER, photoSize, photoSize);
  pctx.drawImage(canvas, crop.x, crop.y, crop.size, crop.size, cardX + BORDER, cardY + BORDER, photoSize, photoSize);

  const stripCenterX = cardX + cardW / 2;
  const stripTop = cardY + BORDER + photoSize;
  const maxTextWidth = cardW - BORDER * 1.5;
  pctx.textAlign = 'center';

  const labels = STATE.lastWavePostcardLabels.length ? STATE.lastWavePostcardLabels.join(' • ') : `Wave ${STATE.wave} cleared`;
  const captionText = `Lumina — ${labels} ♪  ${STATE.score} pts`;
  // A milestone wave can earn all three achievements at once, joining
  // into one long caption -- shrink the font to fit the card's own
  // width instead of letting it overflow past the white card's edge
  // (review, #52). Floored so it never shrinks to the point of being
  // unreadable on a genuinely enormous caption.
  let captionFontSize = 24;
  pctx.font = `italic ${captionFontSize}px "Segoe Script", "Bradley Hand", cursive`;
  const captionWidth = pctx.measureText(captionText).width;
  if (captionWidth > maxTextWidth) {
    captionFontSize = Math.max(13, Math.floor(captionFontSize * maxTextWidth / captionWidth));
    pctx.font = `italic ${captionFontSize}px "Segoe Script", "Bradley Hand", cursive`;
  }
  pctx.fillStyle = '#2a2440';
  pctx.fillText(captionText, stripCenterX, stripTop + BOTTOM_BORDER * 0.38);

  // The actionable line -- bold, high-contrast monospace in a clear
  // hyperlink blue (unlike the caption above, this one has to actually be
  // read and typed in by someone with nothing but the image). Floored well
  // above the caption's floor; this is the one line the whole card exists
  // to deliver.
  const linkLabel = CANONICAL_SHARE_URL.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const urlText = `play free at ${linkLabel}`;
  let urlFontSize = 24;
  pctx.font = `700 ${urlFontSize}px "Courier New", monospace`;
  const urlWidth = pctx.measureText(urlText).width;
  if (urlWidth > maxTextWidth) {
    urlFontSize = Math.max(16, Math.floor(urlFontSize * maxTextWidth / urlWidth));
    pctx.font = `700 ${urlFontSize}px "Courier New", monospace`;
  }
  pctx.fillStyle = '#1550c9';
  pctx.fillText(urlText, stripCenterX, stripTop + BOTTOM_BORDER * 0.75);

  return pc;
}

// Attempts the Web Share API with an actual image file attached -- the
// only way "share" reads as sharing THIS wave's postcard rather than just
// the game's link. Returns false (never throws) for anything short of a
// clean, completed share, including the player cancelling their own
// share sheet, so the caller can fall back to a plain download.
//
// No separate `url` field, deliberately -- `text` already has the link
// folded into it (see shareOrSaveWavePostcard), and several share targets
// that accept a file render `text` AND a same-call `url` as two separate
// items, showing the exact same link twice in a row (player report,
// screenshot: the play link duplicated back to back in the composed
// iMessage). `text`'s embedded link is the one that reliably survives
// across targets; a redundant `url` field isn't needed to make that true.
async function tryShareCanvasImage(canvasEl, filename, title, text) {
  if (!navigator.share || !navigator.canShare) return false;
  try {
    const blob = await new Promise(resolve => canvasEl.toBlob(resolve, 'image/png'));
    if (!blob) return false;
    const file = new File([blob], filename, { type: 'image/png' });
    if (!navigator.canShare({ files: [file] })) return false;
    await navigator.share({ files: [file], title, text });
    return true;
  } catch (e) {
    return false;
  }
}

function downloadCanvasImage(canvasEl, filename) {
  const link = document.createElement('a');
  link.download = filename;
  link.href = canvasEl.toDataURL('image/png');
  link.click();
}

async function shareOrSaveWavePostcard() {
  const pc = buildWavePostcard();
  const filename = `lumina-wave-${STATE.wave}.png`;
  const labels = STATE.lastWavePostcardLabels.join(', ');
  // The link is folded into the shareable text itself, not left to the
  // separate `url` field alone -- several share targets that accept a
  // file drop a same-call `url` on the floor, and this is the one piece
  // of text a recipient actually needs in order to go play it themselves.
  const shareText = `I just hit Wave ${STATE.wave} in Lumina! ${labels ? labels + '. ' : ''}Play free: ${CANONICAL_SHARE_URL}`;

  const shared = await tryShareCanvasImage(pc, filename, 'Lumina', shareText);
  if (shared) {
    showShareToast('Shared!');
    return;
  }
  downloadCanvasImage(pc, filename);
  // No native share sheet here (desktop browsers, mainly) -- the link
  // still has to reach the player somehow, so it goes on the clipboard
  // right behind the image, ready to paste wherever the image itself
  // ends up getting posted.
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(shareText);
      showShareToast('Postcard Saved + Link Copied');
      return;
    } catch (e) { /* fall through to the plain save toast below */ }
  }
  showShareToast('Postcard Saved');
}

function setupShareListeners() {
  document.getElementById('share-game-button').addEventListener('click', shareGameLink);
  document.getElementById('postcard-button').addEventListener('click', shareOrSaveWavePostcard);
}

function showTutorialHint(waveNumber) {
  const entry = TUTORIAL_MESSAGES[waveNumber - 1];
  if (!entry || (entry.relaxedOnly && STATE.difficulty !== 'relaxed')) {
    STATE.tutorialWave = null; STATE.tutorialDismissWhen = null; return;
  }
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
  // 'left-col' (wave number + song-name-display stacked together), not
  // the narrower 'wave-display' alone -- checking only the first line
  // left the tutorial hint's search free to land right on top of the
  // song name line underneath it.
  for (const id of ['left-col', 'right-col']) {
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
  // Sleep mode hides the score outright rather than just letting it sit
  // at 0 -- the whole point of Sleep is winding down, and a running
  // number that only ever goes up is a small, constant nudge toward
  // competitive thinking, which works against that (player request).
  document.getElementById('score-display').textContent =
    (STATE.difficulty !== 'sleep' && STATE.score > 0) ? `Score: ${STATE.score}` : '';
  // Which wave of the current background's set this is (player request) --
  // same visibility rule as the score above (hidden pre-game and under
  // Sleep, which wants minimal UI), and hidden in Cockpit Mode too (review
  // catch, PR #76): Cockpit's own startWave path never resolves STATE.scene
  // at all -- it renders its own separate Three.js scene, none of the
  // selectable backgrounds -- so this would just show stale leftover state
  // from whatever classic-mode scene played last, or the STATE.scene
  // default before any classic wave has ever run.
  //
  // The numerator can't just be STATE.ambienceStreak, either: it advances
  // the instant all dots connect (see checkWaveComplete), before the player
  // chooses what to do next, and Restart Current Level deliberately leaves
  // it untouched afterward (a genuine retry shouldn't silence a sound
  // layer that already unlocked -- see resetSceneAmbience's own comment).
  // That means a completed-then-restarted wave shows a streak one ahead of
  // the wave actually being replayed (review catch, PR #76) -- repeat it
  // enough times under Rotate mode and the counter reaches "N of N" without
  // the scene ever actually advancing. resolveSceneBlock(STATE.wave)'s own
  // blockPosition has no such drift: it's pure arithmetic on the absolute
  // wave number, recomputed fresh every call, so a restart that keeps
  // STATE.wave unchanged always gets the same correct position back. Only
  // meaningful under Rotate, though -- a fixed scene pick has no "block" to
  // be positioned within (resolveSceneBlock always returns 0 there), so it
  // keeps using the streak, same as before.
  const sceneTotal = sceneWaveCount(STATE.scene);
  const sceneOrdinal = STATE.sceneMode === 'rotate'
    ? resolveSceneBlock(STATE.wave).blockPosition + 1
    : STATE.ambienceStreak + 1;
  document.getElementById('scene-progress-display').textContent =
    (STATE.difficulty !== 'sleep' && STATE.phase !== 'TITLE' && !STATE.cockpitMode)
      ? `${SCENE_HUD_NAMES[STATE.scene]} ${Math.min(sceneOrdinal, sceneTotal)} of ${sceneTotal} waves`
      : '';
  // Playtest feedback aid, not a permanent gameplay element -- lets a
  // player name which specific generated song (family + seed) they're
  // hearing, so "this one didn't come together" is reportable instead of
  // anecdotal (player request).
  document.getElementById('song-name-display').textContent =
    STATE.song ? `${STATE.song.genre.family} — ${STATE.song.genre.name}` : '';
  // The button was always visible, including on the title screen, where
  // togglePause() is a deliberate no-op (nothing to pause before the game
  // has started) — that reads as a broken button rather than an
  // intentionally absent one. Hidden here instead, at the same place
  // every phase transition already runs through.
  document.getElementById('pause-button').classList.toggle('visible', STATE.phase !== 'TITLE');
  // The standalone HELP button is the mirror image of PAUSE above: useful
  // pre-game (a curious new player, nothing to pause yet), redundant once
  // a wave is running, where How to Play lives inside the one menu button
  // instead (see #pause-help) rather than sitting on screen as a second
  // permanently-visible control.
  document.getElementById('help-button').classList.toggle('visible', STATE.phase === 'TITLE');
  // Free and functional in both Relaxed and Normal. Still shown (not
  // hidden) in Intense too -- see triggerHintPulse, which explains why via
  // a toast on tap instead of silently doing nothing, rather than the
  // button just disappearing without a word.
  // Neither has a Cockpit Mode equivalent yet -- HINT would pulse dots on
  // a 2D board that isn't being rendered, and ERASE's tap-a-line gesture
  // has no first-person analog (see updateCockpitDrawing's own, simpler
  // rejection rule instead).
  document.getElementById('pause-hint').classList.toggle('visible', STATE.phase !== 'TITLE' && !STATE.cockpitMode);
  // Unlike HINT/pause, gated to PLAYING specifically, not just "not TITLE"
  // -- during WAVE_COMPLETE, canvas taps advance to the next wave before
  // ever reaching the erase-mode branch in onInputStart, so a lit ERASE
  // button there would toggle a mode that can't actually do anything.
  document.getElementById('pause-erase').classList.toggle('visible', STATE.phase === 'PLAYING' && QOL_DIFFICULTIES.has(STATE.difficulty) && !STATE.cockpitMode);
}

// ============================================================
// SECTION 10: GAME LOOP
// ============================================================
function update() {
  enforceTutorialHintInvariant();
  updateEdgePan();
  updateShip();
  updateCockpitShip();
  updateCockpitWaveCompleteReveal();
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
  updateForestScene();
  updateBeachScene();
  updateBirthdayScene();
  updateHalloweenScene();
  updateChristmasScene();
  updateAuroraScene();
  updateReefScene();
  updateCavernScene();
  updateSafariScene();
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
  // Same reasoning as updateWaveDisplay hiding #score-display -- Sleep
  // mode drops the live per-line count too, not just the running total.
  if (STATE.difficulty === 'sleep') {
    if (el.textContent !== '') el.textContent = '';
    return;
  }
  if (STATE.isDrawing && STATE.phase === 'PLAYING') {
    el.textContent = '+' + Math.round(pathLength(STATE.currentPath) * SCORE_PER_LINE_PIXEL);
  } else if (STATE.cockpitActiveDot && STATE.phase === 'PLAYING') {
    el.textContent = '+' + Math.round(cockpitPathLength(STATE.cockpitPath) * COCKPIT_CONFIG.SCORE_PER_LINE_UNIT);
  } else if (el.textContent !== '') {
    el.textContent = '';
  }
}

function render() {
  // A DOM overlay, not a canvas draw -- see updateSleepModeTint's own
  // comment for why -- so one call up front covers both the cockpit and
  // classic branches below identically, unlike drawFadeOverlay which
  // genuinely is per-rendering-path.
  updateSleepModeTint();
  updateEraseModeBanner();

  // Cockpit Mode renders into its own Three.js overlay canvas, not this
  // one -- the 2D board never had geometry for these dots to begin with
  // (see startCockpitWave/generateCockpitDots), so nothing below this
  // branch is meaningful while a cockpit wave is active. drawFadeOverlay
  // still runs so wave-transition fades work the same as classic mode.
  if (STATE.cockpitMode && STATE.cockpitShip) {
    renderCockpitScene();
    updateCockpitStickVisuals();
    updateCockpitWaypointArrow();
    updateCockpitConnectionStatus();
    drawFadeOverlay();
    return;
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Background stays in screen space regardless of camera zoom, like a
  // fixed backdrop behind the (possibly zoomed-out) board.
  if (STATE.scene === 'forest') {
    drawForestScene();
  } else if (STATE.scene === 'beach') {
    drawBeachScene();
  } else if (STATE.scene === 'birthday') {
    drawBirthdayScene();
  } else if (STATE.scene === 'halloween') {
    drawHalloweenScene();
  } else if (STATE.scene === 'christmas') {
    drawChristmasScene();
  } else if (STATE.scene === 'aurora') {
    drawAuroraScene();
  } else if (STATE.scene === 'reef') {
    drawReefScene();
  } else if (STATE.scene === 'cavern') {
    drawCavernScene();
  } else if (STATE.scene === 'safari') {
    drawSafariScene();
  } else {
    drawStars();
    if (STATE.phase === 'WAVE_COMPLETE') { drawCelestialBodies(); drawSpaceObjects(); }
  }

  ctx.save();
  applyCameraTransform();

  drawBarriers();
  drawPortals();

  for (const line of STATE.lines) {
    drawFadingLine(line);
  }

  drawBlockingFlashes();

  drawActiveLine();
  drawBreakSparks();

  for (const dot of STATE.dots) {
    drawDot(dot);
  }

  drawShip();
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
// SECTION 10B: FIRST-LAUNCH SPLASH
// ============================================================
// A self-contained animated intro built on the same hero art already used
// for the itch.io storefront listing (art/hero-splash.jpg, an #splash-hero
// <img> in index.html) -- a hand reaching up from orbit, a glowing line
// winding from its fingertip through the game's own dot shapes to the
// wordmark. #splash-canvas layers a restrained twinkle/ember animation on
// top of that photo (see drawFrame below) rather than the busier
// dot-pairing-and-connecting animation an earlier version of this used --
// the photo is already the dramatic visual and its own line is already
// the "connect the dots" moment; anything competing with it on top reads
// as clutter, not reinforcement. This layer's only job is to keep the
// splash feeling alive (a still photo alone doesn't) and to nod at scene
// variety via EMBER_COLORS, one per real scene, without spelling out scene
// names on the very first thing a player ever sees. Deliberately owns its
// own tiny canvas and requestAnimationFrame loop instead of hooking into
// gameCanvas/render()/update(): the title screen underneath initializes
// and shows completely normally in parallel (see init()), and dismissing
// this is nothing more than fading out and removing one DOM element -- it
// can never leave the actual game in some half-initialized state if
// anything here misbehaves. Always dismissible by tap/click/keypress, and
// always auto-advances on its own after a few seconds even with zero
// input -- per its own design brief, this must never become a hard gate
// in front of the game, for a first-time player or, especially, a
// returning one.
const SPLASH_CONFIG = {
  AUTO_DISMISS_MS: 3800,
  STAR_COUNT: 46,
  EMBER_COUNT: 7,
  EMBER_COLORS: ['#bcd7ff', '#7de89a', '#7ee8e0', '#ff9edb', '#ffb066', '#ff6b6b'],
};

function runSplashScreen() {
  const overlay = document.getElementById('splash-overlay');
  const splashCanvas = document.getElementById('splash-canvas');
  if (!overlay || !splashCanvas) return;
  // Test-harness hook (see tests/smoke.spec.js's shared beforeEach) --
  // every automated test needs a title screen it can interact with
  // immediately after page.goto(), not a multi-second decorative intro
  // sitting on top of it. Reaches the same end state a real dismiss()
  // does (the overlay gone), just without ever animating or attaching
  // listeners first.
  if (window.__SKIP_SPLASH__) {
    overlay.remove();
    return;
  }

  // The title screen and HELP/PAUSE buttons underneath are already fully
  // initialized and keyboard-focusable at this point (paint order, not
  // DOM/tab order, is the only thing keeping them visually covered) --
  // without this, a keyboard user tabbing through the page while the
  // splash is up could focus and activate Start Game or another control
  // that's still hidden underneath it (review catch, PR #84). `inert`
  // removes a whole subtree from the tab order and assistive tech in one
  // property; restored the moment dismiss() runs.
  const messageOverlay = document.getElementById('message-overlay');
  const uiOverlay = document.getElementById('ui-overlay');
  if (messageOverlay) messageOverlay.inert = true;
  if (uiOverlay) uiOverlay.inert = true;

  const sctx = splashCanvas.getContext('2d');

  function resizeSplashCanvas() {
    splashCanvas.width = window.innerWidth;
    splashCanvas.height = window.innerHeight;
  }
  resizeSplashCanvas();
  window.addEventListener('resize', resizeSplashCanvas);

  const stars = [];
  for (let i = 0; i < SPLASH_CONFIG.STAR_COUNT; i++) {
    stars.push({
      xFrac: Math.random(),
      yFrac: Math.random(),
      r: 0.6 + Math.random() * 1.1,
      baseAlpha: 0.3 + Math.random() * 0.5,
      phase: Math.random() * Math.PI * 2,
    });
  }
  // One rising ember per real scene's accent color (see
  // SPLASH_CONFIG.EMBER_COLORS) -- see this section's own header comment
  // for why this stays a quiet accent rather than the visual centerpiece.
  const embers = [];
  for (let i = 0; i < SPLASH_CONFIG.EMBER_COUNT; i++) {
    embers.push({
      xFrac: Math.random(),
      yFrac: Math.random() * 1.1,
      r: 2.2 + Math.random() * 1.6,
      riseSpeed: 0.00004 + Math.random() * 0.00005,
      color: SPLASH_CONFIG.EMBER_COLORS[i % SPLASH_CONFIG.EMBER_COLORS.length],
    });
  }

  const reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let dismissed = false;
  let rafId = null;

  function drawFrame(t) {
    const w = splashCanvas.width, h = splashCanvas.height;
    sctx.clearRect(0, 0, w, h);

    // Gentle twinkling stars -- extends the hero photo's own starfield
    // into whatever part of the viewport it doesn't cover (a wide desktop
    // window crops some of the photo's stars off the top/bottom; a narrow
    // phone crops the sides). Static positions, only opacity animates, so
    // this never competes for attention with the photo's own line/hand.
    for (const s of stars) {
      const twinkle = reducedMotion ? 0.85 : 0.4 + 0.6 * Math.max(0, Math.sin(t * 0.0012 + s.phase));
      sctx.globalAlpha = twinkle * s.baseAlpha;
      sctx.fillStyle = '#ffffff';
      sctx.beginPath();
      sctx.arc(s.xFrac * w, s.yFrac * h, s.r * Math.min(w, h) / 700, 0, Math.PI * 2);
      sctx.fill();
    }
    sctx.globalAlpha = 1;

    if (!reducedMotion) {
      for (const e of embers) {
        e.yFrac -= e.riseSpeed;
        if (e.yFrac < -0.05) { e.yFrac = 1.05; e.xFrac = Math.random(); }
      }
    }
    for (const e of embers) {
      const ex = e.xFrac * w, ey = e.yFrac * h;
      const r = e.r * Math.min(w, h) / 700;
      // Eases in/out at the very top and bottom of its rise rather than a
      // hard on/off cut, so it never just pops in or vanishes mid-frame.
      const fade = reducedMotion ? 0.6 : Math.max(0, Math.min(1, Math.min(e.yFrac, 1 - e.yFrac) * 6));
      if (fade <= 0) continue;
      const glow = sctx.createRadialGradient(ex, ey, 0, ex, ey, r * 5);
      glow.addColorStop(0, e.color);
      glow.addColorStop(1, 'rgba(0,0,0,0)');
      sctx.globalAlpha = fade * 0.75;
      sctx.fillStyle = glow;
      sctx.beginPath();
      sctx.arc(ex, ey, r * 5, 0, Math.PI * 2);
      sctx.fill();
    }
    sctx.globalAlpha = 1;

    if (!dismissed) rafId = requestAnimationFrame(drawFrame);
  }
  rafId = requestAnimationFrame(drawFrame);

  function dismiss() {
    if (dismissed) return;
    dismissed = true;
    if (rafId) cancelAnimationFrame(rafId);
    window.removeEventListener('resize', resizeSplashCanvas);
    clearTimeout(autoDismissTimer);
    if (messageOverlay) messageOverlay.inert = false;
    if (uiOverlay) uiOverlay.inert = false;
    overlay.classList.add('dismissing');
    // Matches #splash-overlay's own CSS transition duration -- removed
    // from the DOM (not just hidden) once fully faded so it can never
    // silently eat a stray tap/click again.
    setTimeout(() => overlay.remove(), 550);
  }

  overlay.addEventListener('click', dismiss);
  overlay.addEventListener('touchend', dismiss, { passive: true });
  window.addEventListener('keydown', function onKey(e) {
    dismiss();
    window.removeEventListener('keydown', onKey);
  }, { once: true });
  const autoDismissTimer = setTimeout(dismiss, SPLASH_CONFIG.AUTO_DISMISS_MS);

  // Everything else keyboard-focusable is now inert (see above), so this
  // is the only place Tab/Enter/Space can land -- makes the splash the
  // active keyboard target rather than leaving focus on nothing at all.
  overlay.focus();
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
  STATE.autoLoadEnabled = loadAutoLoadSetting();
  STATE.flightMode = loadFlightModeSetting();
  STATE.cockpitMode = loadCockpitModeSetting();
  STATE.sceneMode = loadSceneSetting();
  STATE.purchasedScenes = loadPurchasedScenes();
  // Adopt the pending save's own seed if it has one (matches what that
  // save's already-played waves actually showed); only roll a fresh one
  // when there's nothing to resume, or it predates this field.
  STATE.rotateSeed = STATE.pendingResume?.rotateSeed || newRotateSeed();
  if (STATE.cockpitMode) ensureThreeLoaded(); // preload -- the title screen may already be showing it as checked
  applyDifficulty(STATE.difficulty);
  setupDifficultySelectorListeners();
  setupTitleLoadListeners();
  setupSceneSelectorListeners();
  setupShareListeners();
  setupStoreListeners();
  refreshSceneSelector(); // reflects loaded purchases/difficulty in the dropdown before the title screen is ever shown
  showMessage('LUMINA', titleSubtitleText(), { isTitleScreen: true });
  updateWaveDisplay();
  runSplashScreen(); // purely decorative overlay on top of the title screen above -- see its own comment

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
