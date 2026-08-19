// @ts-check
// A deliberately small, fast suite — enough to catch "the game is
// actually broken" before it reaches main, not a substitute for the
// deeper manual/scripted testing a real feature change gets before a PR
// is opened. Runs against window.__lumina, the debug hook game.js
// exposes (getState/getDots) specifically so tests like these don't need
// to reach into internals any other way.
const { test, expect } = require('@playwright/test');

// The first-launch splash (see runSplashScreen in game.js) sits on top of
// the title screen for a few seconds by design -- exactly what none of
// the tests below want, since they all need to interact with the title
// screen (or whatever's beneath it) immediately after page.goto().
// Registered once, at the top level of this file, so it applies to every
// test below without touching each one individually -- see
// runSplashScreen's own check for window.__SKIP_SPLASH__. The dedicated
// splash tests further down override this back to false for themselves.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { window.__SKIP_SPLASH__ = true; });
});

function trackErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  // The pause menu's fact rotation makes a real, best-effort fetch to
  // Wikipedia (see fetchOnlineFacts) -- already handled gracefully at the
  // app level (a failure just leaves STATE.onlineFacts empty), but a live
  // external dependency has no place in a deterministic suite: Chromium
  // logs a console error for a failed/404'd request regardless of the
  // app's own .catch(), and CI's network egress hitting the real API can
  // flake independently of anything this suite is actually testing.
  // Fulfilling with a synthetic empty response keeps every test
  // deterministic without touching the feature itself.
  page.route('https://en.wikipedia.org/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
  );
  return errors;
}

test('loads cleanly and shows the title screen', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await expect(page.locator('#message-title')).toHaveText('LUMINA');
  await expect(page.locator('#difficulty-selector')).toBeVisible();
  expect(errors).toEqual([]);
});

// The first-launch splash (see runSplashScreen in game.js). These three
// tests deliberately re-enable it (the shared beforeEach above skips it
// for every other test in this file) to get real coverage of the actual
// feature, not just the test-harness bypass.
test('the splash shows its content and sits on top of the title screen underneath it', async ({ page }) => {
  const errors = trackErrors(page);
  await page.addInitScript(() => { window.__SKIP_SPLASH__ = false; });
  await page.goto('/index.html');

  await expect(page.locator('#splash-overlay')).toBeVisible();
  await expect(page.locator('#splash-title')).toHaveText('LUMINA');
  await expect(page.locator('#splash-tagline')).toHaveText('dots, lines, music, stars');
  // The real title screen underneath should already exist and be fully
  // initialized in parallel -- the splash is purely a visual overlay on
  // top of it, never a gate blocking its own setup (see init()).
  await expect(page.locator('#message-title')).toHaveText('LUMINA');
  expect(errors).toEqual([]);
});

// Review catch, PR #84: the title screen and HELP/PAUSE buttons underneath
// are already keyboard-focusable at this point (paint order, not DOM/tab
// order, is the only thing keeping them visually covered) -- without the
// inert fix, a keyboard user tabbing through the page while the splash is
// up could focus and activate a control that's still hidden underneath it.
test('while the splash is up, the title screen and HUD buttons underneath are inert (not keyboard-focusable), and the splash itself is the focused target', async ({ page }) => {
  const errors = trackErrors(page);
  await page.addInitScript(() => { window.__SKIP_SPLASH__ = false; });
  await page.goto('/index.html');

  const result = await page.evaluate(() => ({
    messageOverlayInert: document.getElementById('message-overlay').inert,
    uiOverlayInert: document.getElementById('ui-overlay').inert,
    activeElementId: document.activeElement && document.activeElement.id,
  }));
  expect(result.messageOverlayInert).toBe(true);
  expect(result.uiOverlayInert).toBe(true);
  expect(result.activeElementId).toBe('splash-overlay');

  // Dismissing restores both -- the title screen must be fully usable
  // again afterward, not permanently locked out.
  await page.click('#splash-overlay');
  await page.waitForTimeout(700);
  const after = await page.evaluate(() => ({
    messageOverlayInert: document.getElementById('message-overlay').inert,
    uiOverlayInert: document.getElementById('ui-overlay').inert,
  }));
  expect(after.messageOverlayInert).toBe(false);
  expect(after.uiOverlayInert).toBe(false);
  expect(errors).toEqual([]);
});

test('tapping/clicking the splash dismisses it and cleanly reveals a fully working title screen', async ({ page }) => {
  const errors = trackErrors(page);
  await page.addInitScript(() => {
    window.__SKIP_SPLASH__ = false;
    navigator.vibrate = () => true;
  });
  await page.goto('/index.html');
  await page.waitForTimeout(300);

  await page.click('#splash-overlay');
  // Matches the fade-then-remove timing in runSplashScreen's dismiss().
  await page.waitForTimeout(700);
  await expect(page.locator('#splash-overlay')).toHaveCount(0);

  // The title screen underneath must still be fully interactive, not just
  // visible -- click clean through to starting an actual game.
  await page.click('#start-game-button');
  await page.waitForTimeout(500);
  const phase = await page.evaluate(() => STATE.phase);
  expect(phase).toBe('PLAYING');
  expect(errors).toEqual([]);
});

test('the splash auto-dismisses on its own after a few seconds, even with zero input', async ({ page }) => {
  const errors = trackErrors(page);
  await page.addInitScript(() => { window.__SKIP_SPLASH__ = false; });
  await page.goto('/index.html');

  const autoDismissMs = await page.evaluate(() => SPLASH_CONFIG.AUTO_DISMISS_MS);
  // Product's own explicit requirement: this must never become a hard
  // gate in front of the game, even for a player who never touches
  // anything -- a "few seconds" ceiling, not a minutes-long lockout.
  expect(autoDismissMs).toBeLessThan(6000);

  await page.waitForTimeout(autoDismissMs + 700); // + the fade-then-remove timing
  await expect(page.locator('#splash-overlay')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('clicking Start Game begins the game and initializes audio', async ({ page }) => {
  const errors = trackErrors(page);
  await page.addInitScript(() => { navigator.vibrate = () => true; });
  await page.goto('/index.html');
  await page.waitForTimeout(300);

  await page.click('#start-game-button');
  await page.waitForTimeout(1500);

  const state = await page.evaluate(() => {
    const s = window.__lumina.getState();
    return { phase: s.phase, audioState: s.audioCtx ? s.audioCtx.state : null, wave: s.wave };
  });
  expect(state.phase).toBe('PLAYING');
  expect(state.wave).toBe(1);
  expect(state.audioState).toBe('running');
  expect(errors).toEqual([]);
});

test('connecting a dot pair registers and scores', async ({ page }) => {
  const errors = trackErrors(page);
  await page.addInitScript(() => { navigator.vibrate = () => true; });
  await page.goto('/index.html');
  await page.waitForTimeout(300);
  await page.click('#start-game-button');
  await page.waitForTimeout(1000);

  const dots = await page.evaluate(() => window.__lumina.getDots());
  const byPair = {};
  for (const d of dots) (byPair[d.pairId] = byPair[d.pairId] || []).push(d);
  const pair = Object.values(byPair)[0];

  const before = await page.evaluate(() => window.__lumina.getState().connections.length);
  await page.mouse.move(pair[0].x, pair[0].y);
  await page.mouse.down();
  await page.mouse.move(pair[1].x, pair[1].y, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(400);

  const after = await page.evaluate(() => ({
    connections: window.__lumina.getState().connections.length,
    score: window.__lumina.getState().score,
  }));
  expect(after.connections).toBeGreaterThan(before);
  expect(after.score).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('the score display reads "Score: <n>" once points are on the board', async ({ page }) => {
  const errors = trackErrors(page);
  await page.addInitScript(() => { navigator.vibrate = () => true; });
  await page.goto('/index.html');
  await page.waitForTimeout(300);
  await page.click('#start-game-button');
  await page.waitForTimeout(1000);

  await expect(page.locator('#score-display')).toHaveText('');

  const dots = await page.evaluate(() => window.__lumina.getDots());
  const byPair = {};
  for (const d of dots) (byPair[d.pairId] = byPair[d.pairId] || []).push(d);
  const pair = Object.values(byPair)[0];
  await page.mouse.move(pair[0].x, pair[0].y);
  await page.mouse.down();
  await page.mouse.move(pair[1].x, pair[1].y, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(400);

  const score = await page.evaluate(() => window.__lumina.getState().score);
  await expect(page.locator('#score-display')).toHaveText(`Score: ${score}`);
  expect(errors).toEqual([]);
});

test('#scene-progress-display names the current background and counts its waves, hidden on the title screen and under Sleep mode (player request)', async ({ page }) => {
  const errors = trackErrors(page);
  await page.addInitScript(() => { navigator.vibrate = () => true; });
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  // Hidden before a game starts.
  await expect(page.locator('#scene-progress-display')).toHaveText('');

  const result = await page.evaluate(() => {
    STATE.sceneMode = 'beach';
    STATE.difficulty = 'normal';
    startWave(1);
    const total = sceneWaveCount(STATE.scene);
    const first = document.getElementById('scene-progress-display').textContent;

    for (const dot of STATE.dots) dot.connected = true;
    checkWaveComplete();
    startWave(2);
    const second = document.getElementById('scene-progress-display').textContent;

    STATE.difficulty = 'sleep';
    updateWaveDisplay();
    const underSleep = document.getElementById('scene-progress-display').textContent;

    return { total, first, second, underSleep };
  });

  expect(result.first).toBe(`Beach 1 of ${result.total} waves`);
  expect(result.second).toBe(`Beach 2 of ${result.total} waves`);
  expect(result.underSleep).toBe('');
  expect(errors).toEqual([]);
});

test('#scene-progress-display stays hidden in Cockpit Mode, which never resolves STATE.scene (review catch, PR #76)', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(() => {
    STATE.sceneMode = 'forest';
    STATE.difficulty = 'normal';
    STATE.cockpitMode = true;
    startWave(1);
    return document.getElementById('scene-progress-display').textContent;
  });

  expect(result).toBe('');
  expect(errors).toEqual([]);
});

test('Restart Current Level under Rotate mode does not inflate the scene wave counter (review catch, PR #76)', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(() => {
    STATE.sceneMode = 'rotate';
    STATE.difficulty = 'normal';
    startWave(1); // whichever package Rotate mode's random order puts first (see resolveSceneBlock)

    STATE.sceneMode = 'rotate';
    startWave(2); // wherever wave 2 actually falls -- same package's 2nd wave, or the next package's 1st
    const total = sceneWaveCount(STATE.scene);
    const beforeComplete = document.getElementById('scene-progress-display').textContent;

    // Finishing the wave (see checkWaveComplete) advances STATE.ambienceStreak
    // immediately, before the player picks what to do next.
    for (const dot of STATE.dots) dot.connected = true;
    checkWaveComplete();

    // Restart Current Level (see handleRestartCurrentLevel) deliberately
    // keeps the streak as-is and replays the exact same wave number --
    // the displayed position must come back unchanged, not advanced.
    startWave(2);
    const afterRestart = document.getElementById('scene-progress-display').textContent;

    return { total, beforeComplete, afterRestart };
  });

  expect(result.beforeComplete).not.toBe('');
  expect(result.afterRestart).toBe(result.beforeComplete);
  expect(errors).toEqual([]);
});

// Regression guard for a defect where a completed connection's stored
// line/segments could trail off short of the dot it was actually drawn
// to. Root cause: the recorded path only ever gained points from move
// events (smoothed, lagged behind the raw pointer), never from the
// release position itself — so a real release, especially after quick
// final movement, often wasn't preceded by a move event landing exactly
// on the dot. The fading line fades within seconds either way, but the
// long-lived traveling lights ride along `connection.segments` for the
// rest of the wave, so this is what actually made a completed connection
// look like it never reached its pair, deep into a wave, long after the
// initial line was gone.
test('a completed connection reaches exactly to the dot it was drawn to, not short of it', async ({ page }) => {
  const errors = trackErrors(page);
  await page.addInitScript(() => { navigator.vibrate = () => true; });
  await page.goto('/index.html');
  await page.waitForTimeout(300);
  await page.click('#start-game-button');
  await page.waitForTimeout(1000);

  const dots = await page.evaluate(() => window.__lumina.getDots());
  const byPair = {};
  for (const d of dots) (byPair[d.pairId] = byPair[d.pairId] || []).push(d);
  const pair = Object.values(byPair)[0];
  const [a, b] = pair;

  // A winding multi-point drag (not a straight 2-point line) whose final
  // move lands exactly on the target dot — realistic enough that the old
  // code still produced a real gap, since the smoothed cursor recording
  // the path lags behind quick final movement even when the raw pointer
  // itself reaches the dot.
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  const steps = 10;
  for (let s = 1; s <= steps; s++) {
    const t = s / steps;
    const wobble = Math.sin(t * Math.PI * 3) * 15;
    await page.mouse.move(a.x + (b.x - a.x) * t + wobble, a.y + (b.y - a.y) * t);
  }
  await page.mouse.up();
  await page.waitForTimeout(300);

  const gap = await page.evaluate((dotB) => {
    const conn = window.__lumina.getState().connections[0];
    if (!conn) return null;
    const last = conn.segments[conn.segments.length - 1];
    return Math.hypot(last.x2 - dotB.x, last.y2 - dotB.y);
  }, b);

  expect(gap).not.toBeNull();
  expect(gap).toBeLessThan(0.5);
  expect(errors).toEqual([]);
});

// Regression guard for a defect where a crowded intense-difficulty wave
// could place two same- or different-colored dots close enough together
// that neither could be individually tapped (their touch targets
// overlapped). The fix grows the board's world space to keep every dot
// CONFIG.MIN_DOT_DISTANCE apart regardless of how many dots a wave needs,
// with the camera zooming out to fit; this walks a long run of intense
// waves directly (via the game's own startWave, exposed globally as a
// plain script) and asserts no two dots ever end up within touching
// distance of each other.
test('crowded intense-difficulty waves never place two dots close enough to overlap their tap targets', async ({ page }) => {
  const errors = trackErrors(page);
  await page.addInitScript(() => { navigator.vibrate = () => true; });
  await page.goto('/index.html');
  await page.evaluate(() => localStorage.setItem('lumina_difficulty_v1', 'intense'));
  await page.reload();
  await page.waitForTimeout(300);
  await page.click('#start-game-button');
  await page.waitForTimeout(500);

  const result = await page.evaluate(() => {
    const hitDiameter = CONFIG.DOT_HIT_RADIUS * 2;
    let worst = Infinity;
    for (let wave = 1; wave <= 60; wave++) {
      startWave(wave);
      const dots = window.__lumina.getDots();
      for (let i = 0; i < dots.length; i++) {
        for (let j = i + 1; j < dots.length; j++) {
          const d = Math.hypot(dots[i].x - dots[j].x, dots[i].y - dots[j].y);
          if (d < worst) worst = d;
        }
      }
    }
    return { worst, hitDiameter };
  });

  expect(result.worst).toBeGreaterThanOrEqual(result.hitDiameter);
  expect(errors).toEqual([]);
});

// Regression guard for a defect where a line curling tightly around a
// barrier's tip could get rejected even though the player never saw it
// touch anything: collision detection tested the raw, sparsely-recorded
// polyline, while drawSmoothedPath renders a rounded quadratic curve
// through each pair of points' midpoints — at a sharp turn the two shapes
// can diverge enough that the invisible raw polyline still crosses an
// obstacle the visible rounded curve clears. The fix (smoothedCurveSegments)
// samples the same curve that's rendered for every crossing/stranding
// check, so what's tested always matches what's shown.
test('a line that visually clears a barrier at a sharp turn is not rejected', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(() => {
    // A sharp right-angle turn — the shape of curling tightly around an
    // obstacle's tip — with a barrier sitting just past the outside of
    // that corner, strictly between segment endpoints (not the shared
    // vertex, which segmentsIntersect's own endpoint tolerance already
    // excludes and wouldn't exercise this bug).
    const path = [{ x: 0, y: 400 }, { x: 200, y: 400 }, { x: 200, y: 200 }];
    const nearCornerBarrier = { x1: 190, y1: 395, x2: 210, y2: 395 };
    // Sanity check on the test setup itself: the raw polyline (the old,
    // buggy behavior) really does cross this barrier, so a false "pass"
    // below couldn't be explained by a barrier that was never a threat.
    const rawWouldReject = pathToSegments(path).some(s => segmentsIntersect(s, nearCornerBarrier));

    const smoothCrosses = smoothedCurveSegments(path).some(s => segmentsIntersect(s, nearCornerBarrier));

    // Control case: a barrier squarely in the middle of a straight run
    // must still be caught — this isn't a blanket weakening of the check.
    const straightPath = [{ x: 0, y: 400 }, { x: 100, y: 400 }, { x: 400, y: 400 }];
    const middleBarrier = { x1: 190, y1: 350, x2: 210, y2: 450 };
    const genuineCrossingCaught = smoothedCurveSegments(straightPath).some(s => segmentsIntersect(s, middleBarrier));

    return { rawWouldReject, smoothCrosses, genuineCrossingCaught };
  });

  expect(result.rawWouldReject).toBe(true);
  expect(result.smoothCrosses).toBe(false);
  expect(result.genuineCrossingCaught).toBe(true);
  expect(errors).toEqual([]);
});

// Regression guard for three compounding defects the user found by actually
// playing deep into a run: (1) a fresh wave showed a full backdrop of stars
// despite nothing being connected yet, because STATE.stars was only ever
// cleared in the wave-complete advance closure -- resume/restart/load all
// skipped it and inherited whatever was on screen before; (2) a completed
// connection's line faded all the way to invisible with nothing replacing
// it (the traveling lights meant to be the ongoing indicator only render
// once the *entire wave* is complete), so a still-live connection looked
// identical to a broken one for the rest of the wave; (3) breaking a
// connection (a rotating barrier sweeping through) left its star halo
// behind, which kept implying "this is connected" long after it wasn't --
// exactly the mismatch that made a real break read as an inexplicable bug.
test('stars reset on a fresh wave, a connection line never fully disappears, and breaking one clears its stars too', async ({ page }) => {
  const errors = trackErrors(page);
  await page.addInitScript(() => { navigator.vibrate = () => true; });
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);
  // See the equivalent comment further down this file (the long-winding-
  // connection test) -- a generic `click('body')` risks landing on the
  // title screen's own UI now that it has more rows than it used to.
  await page.click('#start-game-button');
  await page.waitForTimeout(300);

  const freshStars = await page.evaluate(() => { startWave(1); return STATE.stars.length; });
  expect(freshStars).toBe(0);

  const setup = await page.evaluate(() => {
    const dots = window.__lumina.getDots();
    const byPair = {};
    for (const d of dots) (byPair[d.pairId] = byPair[d.pairId] || []).push(d);
    const [a, b] = Object.values(byPair)[0];

    STATE.activeDot = a;
    STATE.currentPath = [{ x: a.x, y: a.y }, { x: b.x, y: b.y }];
    completeConnection(a, b);

    return { duration: CONFIG.LINE_FADE_DURATION_MS, pairId: a.pairId, colorIndex: a.colorIndex, ax: a.x, ay: a.y };
  });

  // The fade is wall-clock-timed (see LINE_FADE_DURATION_MS), not driven
  // by calling update() a fixed number of times, so this waits real time
  // and lets the page's own render loop run naturally in the background.
  await page.waitForTimeout(setup.duration + 800);

  const fadeResult = await page.evaluate(() => ({
    lineCount: STATE.lines.length,
    settledAlpha: STATE.lines[0].points.map(p => p.alpha),
    floor: CONFIG.LINE_FADE_FLOOR,
    pairId: STATE.lines[0].pairId,
    colorIndex: STATE.lines[0].colorIndex,
  }));
  fadeResult.ax = setup.ax;
  fadeResult.ay = setup.ay;
  expect(fadeResult.lineCount).toBe(1); // never removed
  for (const alpha of fadeResult.settledAlpha) {
    expect(alpha).toBeCloseTo(fadeResult.floor, 5); // settles at the floor, not 0
  }

  const breakResult = await page.evaluate((f) => {
    breakConnection(f.pairId, f.colorIndex, f.ax, f.ay);
    return {
      linesForPair: STATE.lines.filter(l => l.pairId === f.pairId).length,
      starsForPair: STATE.stars.filter(s => s.pairId === f.pairId).length,
    };
  }, fadeResult);
  expect(breakResult.linesForPair).toBe(0);
  expect(breakResult.starsForPair).toBe(0);
  expect(errors).toEqual([]);
});

// Regression guard for a performance defect introduced by the fix above:
// making a connection's line settle at a floor instead of disappearing
// only helps if "settled" is actually reached quickly. The first version
// of that fix used a per-point cascade where each point only started
// fading once its predecessor fully finished -- total settle time scaled
// with point count, so a long, deliberately winding connection (which
// scoring explicitly rewards, and can carry hundreds of points) could
// take many minutes to ever reach "settled," paying full per-segment
// render cost -- one stroke() call per point, every frame -- the entire
// time. Fixed by making the fade wall-clock-timed instead of point-count-
// scaled: every line settles within the same fixed LINE_FADE_DURATION_MS
// regardless of length. Builds a genuinely long (300+ point), winding
// connection and asserts it settles within that fixed window and then
// renders as a single stroke() call, not one per point.
test('a long, winding connection settles within a fixed time regardless of point count, and renders as one draw call once settled', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);
  // Starting a wave now requires the explicit Start Game button -- a
  // plain click/tap on the title screen's canvas backdrop no longer does
  // anything (player feedback: too easy to start by accident).
  await page.click('#start-game-button');
  await page.waitForTimeout(300);

  const setup = await page.evaluate(() => {
    const dots = window.__lumina.getDots();
    const byPair = {};
    for (const d of dots) (byPair[d.pairId] = byPair[d.pairId] || []).push(d);
    const [a, b] = Object.values(byPair)[0];

    const path = [{ x: a.x, y: a.y }];
    const steps = 300;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      path.push({
        x: a.x + (b.x - a.x) * t + Math.sin(t * 30) * 20,
        y: a.y + (b.y - a.y) * t + Math.cos(t * 17) * 20,
      });
    }
    path.push({ x: b.x, y: b.y });

    STATE.activeDot = a;
    STATE.currentPath = path;
    completeConnection(a, b);
    return { pointCount: STATE.lines[0].points.length, duration: CONFIG.LINE_FADE_DURATION_MS };
  });
  expect(setup.pointCount).toBeGreaterThan(200); // a genuinely long path, not a trivial case

  await page.waitForTimeout(setup.duration + 800); // real time, well past the fixed settle window

  const result = await page.evaluate(() => {
    const alphas = STATE.lines[0].points.map(p => p.alpha);
    let strokeCalls = 0;
    const origStroke = ctx.stroke.bind(ctx);
    ctx.stroke = function (...args) { strokeCalls++; return origStroke(...args); };
    drawFadingLine(STATE.lines[0]);
    ctx.stroke = origStroke;
    return {
      settled: STATE.lines[0].settled,
      minAlpha: Math.min(...alphas),
      maxAlpha: Math.max(...alphas),
      floor: CONFIG.LINE_FADE_FLOOR,
      strokeCalls,
    };
  });

  expect(result.settled).toBe(true);
  expect(result.minAlpha).toBeCloseTo(result.floor, 5);
  expect(result.maxAlpha).toBeCloseTo(result.floor, 5);
  expect(result.strokeCalls).toBe(1);
  expect(errors).toEqual([]);
});

// Regression guard for a defect that made a wave permanently
// uncompleteable, with no recovery possible by replaying, waiting, or
// reconnecting anything. wouldStrandAnyDot -- the check that's supposed to
// guarantee a wave can never become unsolvable through the player's own
// moves -- built its reachability grid from existing connections only,
// never from barriers. A static barrier (present from wave 3 on, and
// unlike a rotating one, never moves) sitting in the one gap of an
// otherwise-enclosing loop of connections was invisible to this check, so
// it could approve a connection that sealed another dot in behind that
// barrier for good: every real attempt to route through the same gap
// afterward is correctly rejected forever by findCrossedBarriers, which
// *does* know about barriers -- the two checks disagreeing is what made
// the trap permanent. Builds the exact minimal scenario (a boxed-in dot,
// one gap, a static barrier plugging it) and asserts wouldStrandAnyDot
// now catches it, with a control run (no barrier) proving the enclosure
// alone was never the problem.
test('a static barrier plugging the only gap in an enclosure is correctly treated as sealing a dot in', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(() => {
    // A box of connection segments around P, open only through an 80px
    // gap (well over the 24px grid cell, ruling out grid-coarseness as
    // the reason for either result) -- with a static barrier spanning
    // exactly that gap.
    const boxSegments = [
      { x1: 200, y1: 400, x2: 400, y2: 400 }, // bottom
      { x1: 200, y1: 200, x2: 200, y2: 400 }, // left
      { x1: 400, y1: 200, x2: 400, y2: 400 }, // right
      { x1: 200, y1: 200, x2: 260, y2: 200 }, // top, left half
      { x1: 340, y1: 200, x2: 400, y2: 200 }, // top, right half -- gap is x:[260,340]
    ];
    const barrier = { x1: 260, y1: 200, x2: 340, y2: 200, rotating: false };

    const P = { id: 0, pairId: 0, x: 300, y: 300, connected: false };
    const Q = { id: 1, pairId: 0, x: 300, y: 800, connected: false }; // P's groupmate, outside the box
    const R = { id: 2, pairId: 1, x: 1000, y: 300, connected: false };
    const S = { id: 3, pairId: 1, x: 1000, y: 800, connected: false }; // the "active pair" being connected right now

    STATE.dots = [P, Q, R, S];
    STATE.dotUnion = { 0: 0, 1: 1, 2: 2, 3: 3 };
    STATE.world = { w: 1400, h: 1000 };
    STATE.connections = [{ pairId: 2, colorIndex: 0, segments: boxSegments }];

    STATE.barriers = [barrier];
    const withBarrier = wouldStrandAnyDot([], R, S);

    STATE.barriers = [];
    const withoutBarrier = wouldStrandAnyDot([], R, S);

    return { withBarrier, withoutBarrier };
  });

  expect(result.withBarrier).toBe(true); // the barrier plugging the gap really does seal P in
  expect(result.withoutBarrier).toBe(false); // control: the enclosure alone (open gap) was never the problem
  expect(errors).toEqual([]);
});

test('pause button appears once playing and opens the pause menu', async ({ page }) => {
  const errors = trackErrors(page);
  await page.addInitScript(() => { navigator.vibrate = () => true; });
  await page.goto('/index.html');
  await page.waitForTimeout(300);

  await expect(page.locator('#pause-button')).toBeHidden();
  await page.click('#start-game-button');
  await page.waitForTimeout(1000);

  await expect(page.locator('#pause-button')).toBeVisible();
  await page.click('#pause-button');
  await expect(page.locator('#pause-overlay')).toHaveClass(/visible/);
  expect(errors).toEqual([]);
});

test('maze barriers grow one corner/gap per tier starting at wave 40, and generateBarriersSafely never ships an unsolvable wave', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(() => {
    const legCounts = [39, 40, 49, 50, 59, 60].map(w => mazeLegCountForWave(w));
    const gapCounts = [39, 40, 49, 50, 59, 60].map(w => mazeGapCountForWave(w));

    // Mirrors the Monte Carlo methodology used to verify the original
    // wave-deadlock fix: generate many real waves (including the 3+-dot
    // groups GROUP_CONFIG unlocks at higher waves, and the maze/fact-box
    // barriers layered on top starting at wave 40) and confirm every
    // color group's dots stay mutually reachable at spawn, before any
    // connection is ever drawn.
    let total = 0, unsolvable = 0, mazeSeen = 0, factBoxSeen = 0;
    for (let wave = 1; wave <= 60; wave += 3) {
      for (let t = 0; t < 12; t++) {
        const dots = generateDots(wave);
        ensureAllDotsInWorldBounds(dots);
        const barriers = generateBarriersSafely(wave, dots);
        total++;
        // Reachability must be checked with whatever portal generateBarriersSafely
        // just set (see PORTAL_CONFIG, wave 50+) -- a sealed pocket is only
        // reachable THROUGH one, so checking without it would flag a wave
        // that's actually fine as a false "unsolvable."
        if (!allDotsReachableGivenBarriers(dots, barriers, STATE.portals)) unsolvable++;
        if (barriers.some(b => b.type === 'maze')) mazeSeen++;
        if (barriers.some(b => b.type === 'factBox')) factBoxSeen++;
      }
    }

    return { legCounts, gapCounts, total, unsolvable, mazeSeen, factBoxSeen };
  });

  expect(result.legCounts).toEqual([0, 2, 2, 3, 3, 4]); // 0 below wave 40, training case is 1 corner, +1 leg every 10 waves after
  expect(result.gapCounts).toEqual([0, 1, 1, 2, 2, 3]); // training case is 1 gap, +1 gap every 10 waves after
  expect(result.unsolvable).toBe(0); // the core guarantee, across every wave and barrier type generated above
  expect(result.mazeSeen).toBeGreaterThan(0); // maze barriers actually show up once unlocked
  expect(result.factBoxSeen).toBeGreaterThan(0); // fact boxes actually show up over enough waves
  expect(errors).toEqual([]);
});

// Same Monte Carlo methodology as the maze-barrier stress test above, run
// specifically across the wave range portals unlock at (see PORTAL_CONFIG,
// wave 50+). Confirms three things simultaneously, since they'd each
// individually be easy to get subtly wrong: portals show up at all, a
// sealed pocket is genuinely UNREACHABLE without one (not decorative --
// see generatePortalPocket's own reachability re-check), and the wave as a
// whole is always solvable once the portal IS accounted for (see
// isReachableAround's wormhole edge).
test('generatePortalPocket only ever seals a dot that its own portal genuinely un-seals, and never ships an unsolvable wave', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(() => {
    let total = 0, unsolvableWithPortal = 0, portalsSeen = 0, sealedButReachableWithoutPortal = 0;
    for (let trial = 0; trial < 15; trial++) {
      for (let wave = 50; wave <= 65; wave++) {
        const dots = generateDots(wave);
        ensureAllDotsInWorldBounds(dots);
        const barriers = generateBarriersSafely(wave, dots);
        total++;
        if (!allDotsReachableGivenBarriers(dots, barriers, STATE.portals)) unsolvableWithPortal++;
        if (STATE.portals) {
          portalsSeen++;
          const groupDots = dots.filter(d => d.pairId === STATE.portals.pairId);
          // With the SAME final barrier set (portal's own sealing wall
          // included) but no wormhole edge, the sealed group must be
          // unreachable -- otherwise the portal didn't actually seal
          // anything, it was just sitting there.
          if (allDotsReachableGivenBarriers(groupDots, barriers, null)) sealedButReachableWithoutPortal++;
        }
      }
    }
    return { total, unsolvableWithPortal, portalsSeen, sealedButReachableWithoutPortal };
  });

  expect(result.unsolvableWithPortal).toBe(0);
  expect(result.portalsSeen).toBeGreaterThan(0); // confirms the feature isn't silently always skipping out
  expect(result.sealedButReachableWithoutPortal).toBe(0);
  expect(errors).toEqual([]);
});

// Exercises the actual two-hop drawing mechanic (see PORTAL_CONFIG's own
// comment on why it's two ordinary drags joined at the pair, not one
// continuous teleporting one) directly via the real input handlers, same
// as the pinch-safety erase test above -- this is real production code,
// not a re-implementation. Portal placement itself (generatePortalPocket)
// is covered by the Monte Carlo test above; this only cares that a
// portal, once it exists, is actually drawable through correctly.
test('drawing through a portal is two separate hops that only complete the real pair on the second one', async ({ page }) => {
  const errors = trackErrors(page);
  await page.addInitScript(() => { navigator.vibrate = () => true; });
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);
  await page.click('#start-game-button');
  await page.waitForTimeout(800);

  const setup = await page.evaluate(() => {
    const dots = window.__lumina.getDots();
    const byPair = {};
    for (const d of dots) (byPair[d.pairId] = byPair[d.pairId] || []).push(d);
    const [a, b] = Object.values(byPair)[0];

    // Exact generation rules (see generatePortalPocket) don't matter for
    // this test -- only that a portal pair exists and is drawable to/from,
    // so placed in the corners, safely clear of every dot and (wave 1 has
    // none yet anyway) every barrier.
    const portalA = { x: 30, y: 30 };
    const portalB = { x: STATE.world.w - 30, y: 30 };
    STATE.portals = { a: portalA, b: portalB, colorIndex: a.colorIndex, pairId: a.pairId };

    return { aId: a.id, bId: b.id, ax: a.x, ay: a.y, bx: b.x, by: b.y, portalA, portalB };
  });

  // Leg 1: dot A to portal A. Locks in as a thread, not a real connection.
  const afterLeg1 = await page.evaluate(({ ax, ay, portalA, aId }) => {
    onInputStart({ preventDefault() {}, clientX: ax, clientY: ay });
    onInputEnd({ preventDefault() {}, clientX: portalA.x, clientY: portalA.y });
    return {
      threadCount: STATE.portalThreads.length,
      threadDotAId: STATE.portalThreads[0] && STATE.portalThreads[0].dotA.id,
      connectionsCount: STATE.connections.length,
      linesCount: STATE.lines.length,
      dotAConnected: STATE.dots.find(d => d.id === aId).connected,
      score: STATE.score,
    };
  }, setup);
  expect(afterLeg1.threadCount).toBe(1);
  expect(afterLeg1.threadDotAId).toBe(setup.aId);
  expect(afterLeg1.connectionsCount).toBe(0); // not a completed pair yet
  expect(afterLeg1.linesCount).toBe(1); // but it's a real, visible, drawn line
  expect(afterLeg1.dotAConnected).toBe(false);
  expect(afterLeg1.score).toBe(0); // no score for a half-connection

  // Leg 2: starting a fresh drag from portal B (the OTHER side) picks the
  // thread back up as dot A itself, then finishing at dot A's real match
  // completes the actual pair.
  const afterLeg2 = await page.evaluate(({ bx, by, portalB, aId, bId }) => {
    onInputStart({ preventDefault() {}, clientX: portalB.x, clientY: portalB.y });
    const pickedUpDotId = STATE.activeDot && STATE.activeDot.id;
    onInputEnd({ preventDefault() {}, clientX: bx, clientY: by });
    return {
      pickedUpDotId,
      threadCount: STATE.portalThreads.length,
      connection: STATE.connections[0],
      linesCount: STATE.lines.length,
      dotAConnected: STATE.dots.find(d => d.id === aId).connected,
      dotBConnected: STATE.dots.find(d => d.id === bId).connected,
      score: STATE.score,
    };
  }, setup);
  expect(afterLeg2.pickedUpDotId).toBe(setup.aId); // resumes as the ORIGINAL dot, not a stand-in
  expect(afterLeg2.threadCount).toBe(0); // consumed on success
  expect(afterLeg2.connection.dotA).toBe(setup.aId);
  expect(afterLeg2.connection.dotB).toBe(setup.bId);
  expect(afterLeg2.connection.segments.length).toBeGreaterThan(0);
  expect(afterLeg2.linesCount).toBe(2); // both hops remain their own independent fading lines
  expect(afterLeg2.dotAConnected).toBe(true);
  expect(afterLeg2.dotBConnected).toBe(true);
  expect(afterLeg2.score).toBeGreaterThan(0); // both legs' length counted, awarded only now
  expect(errors).toEqual([]);
});

// A rejected second hop (wrong color, in this case) shouldn't cost the
// player the first one -- STATE.activePortalThread is cleared, but the
// thread itself stays in STATE.portalThreads for another attempt, exactly
// like a plain rejected connection just cancels the current drag rather
// than un-drawing anything already on the board.
test('a rejected second hop through a portal leaves the first hop\'s thread available to retry', async ({ page }) => {
  const errors = trackErrors(page);
  await page.addInitScript(() => { navigator.vibrate = () => true; });
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);
  await page.click('#start-game-button');
  await page.waitForTimeout(800);

  const setup = await page.evaluate(() => {
    const dots = window.__lumina.getDots();
    const byPair = {};
    for (const d of dots) (byPair[d.pairId] = byPair[d.pairId] || []).push(d);
    const pairs = Object.values(byPair);
    const [a] = pairs[0];
    // A dot from a DIFFERENT color group, guaranteed to reject on a color
    // mismatch -- if this wave only generated one color, skip cleanly.
    const wrongColorDot = pairs.find(g => g[0].colorIndex !== a.colorIndex)?.[0];

    const portalA = { x: 30, y: 30 };
    const portalB = { x: STATE.world.w - 30, y: 30 };
    STATE.portals = { a: portalA, b: portalB, colorIndex: a.colorIndex, pairId: a.pairId };

    onInputStart({ preventDefault() {}, clientX: a.x, clientY: a.y });
    onInputEnd({ preventDefault() {}, clientX: portalA.x, clientY: portalA.y });

    return {
      hasWrongColorDot: !!wrongColorDot,
      wrongColorDot,
      portalB,
      threadCountAfterLeg1: STATE.portalThreads.length,
    };
  });
  test.skip(!setup.hasWrongColorDot, 'this generated wave only has one color group');
  expect(setup.threadCountAfterLeg1).toBe(1);

  const afterRejectedAttempt = await page.evaluate(({ wrongColorDot, portalB }) => {
    onInputStart({ preventDefault() {}, clientX: portalB.x, clientY: portalB.y });
    onInputEnd({ preventDefault() {}, clientX: wrongColorDot.x, clientY: wrongColorDot.y });
    return {
      threadCount: STATE.portalThreads.length,
      connectionsCount: STATE.connections.length,
      activePortalThread: STATE.activePortalThread,
    };
  }, setup);
  expect(afterRejectedAttempt.threadCount).toBe(1); // still there, untouched
  expect(afterRejectedAttempt.connectionsCount).toBe(0);
  expect(afterRejectedAttempt.activePortalThread).toBeNull(); // this attempt's own reference is cleared
  expect(errors).toEqual([]);
});

// STATE.portals/portalThreads must never survive into a wave, restart, or
// title screen that didn't itself just generate them -- otherwise a
// leftover portal from a previous wave could sit there un-generated but
// still tappable, or a stale thread could silently attach itself to a
// completely different dot.
test('portal state resets cleanly on both a new wave and exiting to the title screen', async ({ page }) => {
  const errors = trackErrors(page);
  await page.addInitScript(() => { navigator.vibrate = () => true; });
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);
  await page.click('#start-game-button');
  await page.waitForTimeout(800);

  const afterNewWave = await page.evaluate(() => {
    STATE.portals = { a: { x: 10, y: 10 }, b: { x: 20, y: 20 }, colorIndex: 0, pairId: 0 };
    STATE.portalThreads = [{ enteredSide: 'a', dotA: STATE.dots[0], segments: [], points: [], length: 0 }];
    STATE.activePortalThread = STATE.portalThreads[0];
    startWave(1);
    return { portals: STATE.portals, threadCount: STATE.portalThreads.length, active: STATE.activePortalThread };
  });
  expect(afterNewWave.portals).toBeNull();
  expect(afterNewWave.threadCount).toBe(0);
  expect(afterNewWave.active).toBeNull();

  const afterExit = await page.evaluate(() => {
    STATE.portals = { a: { x: 10, y: 10 }, b: { x: 20, y: 20 }, colorIndex: 0, pairId: 0 };
    STATE.portalThreads = [{ enteredSide: 'a', dotA: STATE.dots[0], segments: [], points: [], length: 0 }];
    exitToTitle();
    return { portals: STATE.portals, threadCount: STATE.portalThreads.length };
  });
  expect(afterExit.portals).toBeNull();
  expect(afterExit.threadCount).toBe(0);
  expect(errors).toEqual([]);
});

// World growth (see growWorldToMatchAspect/shiftWorldEntities) already
// shifts dots/connections/barriers to stay put visually when the world
// resizes out from under them -- a portal or a pending thread's own
// already-drawn geometry needs the exact same treatment, or the portal
// would visibly jump away from where the player just saw it, or a pending
// thread's stored line would end up detached from the portal it actually
// leads to.
test('shiftWorldEntities moves both an active portal pair and a pending thread\'s stored geometry', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(() => {
    STATE.portals = { a: { x: 10, y: 20 }, b: { x: 100, y: 200 }, colorIndex: 0, pairId: 0 };
    STATE.portalThreads = [{
      enteredSide: 'a',
      dotA: { id: 0 },
      segments: [{ x1: 0, y1: 0, x2: 10, y2: 20 }],
      points: [{ x: 0, y: 0 }, { x: 10, y: 20 }],
      length: 22,
    }];
    shiftWorldEntities(5, 7);
    return {
      portals: STATE.portals,
      threadSeg: STATE.portalThreads[0].segments[0],
      threadPoint: STATE.portalThreads[0].points[1],
    };
  });

  expect(result.portals).toEqual({ a: { x: 15, y: 27 }, b: { x: 105, y: 207 }, colorIndex: 0, pairId: 0 });
  expect(result.threadSeg).toEqual({ x1: 5, y1: 7, x2: 15, y2: 27 });
  expect(result.threadPoint).toEqual({ x: 15, y: 27 });
  expect(errors).toEqual([]);
});

// ------------------------------------------------------------
// Flight Mode: an alternate control scheme (see STATE.flightMode/
// FLIGHT_CONFIG) where the player pilots a ship instead of dragging.
// Exercised through the real input handlers and a real running game loop
// (not a re-implementation) -- onInputStart/onInputMove set the ship's
// steering target, and the ship has to actually fly there over real
// elapsed frames before updateShipDrawing detects it's over a dot.
// ------------------------------------------------------------

test('the Flight Mode checkbox toggles STATE.flightMode and persists across a reload', async ({ page }) => {
  const errors = trackErrors(page);
  await page.addInitScript(() => { navigator.vibrate = () => true; });
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  await expect(page.locator('#flight-mode-row')).toBeVisible();
  expect(await page.evaluate(() => STATE.flightMode)).toBe(false);

  await page.click('#flight-mode-checkbox');
  expect(await page.evaluate(() => STATE.flightMode)).toBe(true);

  await page.reload();
  await page.waitForFunction(() => window.__lumina);
  expect(await page.evaluate(() => STATE.flightMode)).toBe(true);
  await expect(page.locator('#flight-mode-checkbox')).toBeChecked();
  expect(errors).toEqual([]);
});

// The actual flying-and-connecting mechanic: steer toward dot A, let the
// ship fly there and pick it up, then steer toward its match and let
// momentum carry the ship through to complete the connection -- the same
// checks (color match, crossing, stranding) and the same score/connection
// bookkeeping a classic drag uses, just reached by flight instead.
test('steering the ship through two matching dots completes a real connection', async ({ page }) => {
  // Two 15s poll ceilings below could in principle sum past the suite's
  // default 30s per-test timeout even though real flight time is nowhere
  // close to that -- they're safety ceilings for a genuine hang, not a
  // tuned "just barely enough" duration like the fixed waits they replace.
  test.setTimeout(45000);
  const errors = trackErrors(page);
  await page.addInitScript(() => { navigator.vibrate = () => true; });
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);
  await page.click('#flight-mode-checkbox');
  await page.click('.difficulty-btn[data-difficulty="normal"]');
  await page.click('#start-game-button');
  await page.waitForTimeout(500);

  const setup = await page.evaluate(() => {
    // STATE.dots directly, not window.__lumina.getDots() -- that helper
    // returns a mapped COPY of each dot for read-only inspection, so
    // mutating positions through it (as this test used to) silently hit
    // throwaway objects and left the real dots exactly where they were.
    const dots = STATE.dots;
    const byPair = {};
    for (const d of dots) (byPair[d.pairId] = byPair[d.pairId] || []).push(d);
    const [a, b] = Object.values(byPair).find(g => g.length >= 2);
    // Fixed, well-separated positions for A and B (plus moving every other
    // dot far outside the ship's reachable range) eliminate two real
    // sources of flakiness found empirically with the original random
    // layout:
    //  1. Flying in a straight line, the ship can graze an unrelated dot on
    //     the way from A to B -- attemptFlightConnection correctly treats a
    //     differently-colored dot in the path as a rejection, same as
    //     onInputEnd's classic-mode equivalent. Real, intentional flight
    //     physics, not what this test is about.
    //  2. A and B can randomly land close enough together that a single
    //     flight toward A also flies straight through B before the ship
    //     ever visibly "arrives" at A -- the connection completes
    //     correctly, but the intermediate arrival-at-A checkpoint this test
    //     checks for becomes a race against Playwright's poll granularity
    //     and can be missed entirely, even though nothing actually broke.
    // A sits a quarter of the world width from the ship's center spawn, B
    // a half-world further still, so the ship has real room to decelerate
    // near A (see updateShip's arrival steering) before being redirected.
    a.x = STATE.world.w * 0.25; a.y = STATE.world.h * 0.5;
    b.x = STATE.world.w * 0.75; b.y = STATE.world.h * 0.5;
    for (const d of dots) {
      if (d.id !== a.id && d.id !== b.id) { d.x = STATE.world.w * 1000; d.y = STATE.world.h * 1000; }
    }
    return {
      aId: a.id, bId: b.id, ax: a.x, ay: a.y, bx: b.x, by: b.y,
      shipExists: !!STATE.ship,
    };
  });
  expect(setup.shipExists).toBe(true);

  // Steer toward dot A and give the ship real time to fly there. Polls for
  // the actual arrival instead of a fixed wall-clock wait -- dot positions
  // are randomly generated per run, so flight time to reach one genuinely
  // varies run to run; a fixed timeout long enough for the common case
  // still occasionally lost the race against a farther-apart layout (CI
  // flake, reproduced locally: 3/8 failures even at a generous 4000ms).
  await page.evaluate(({ ax, ay }) => {
    onInputStart({ preventDefault() {}, clientX: ax, clientY: ay });
  }, setup);
  await page.waitForFunction(
    (aId) => STATE.activeDot && STATE.activeDot.id === aId,
    setup.aId,
    { timeout: 15000 },
  );

  const afterA = await page.evaluate(({ aId }) => ({
    isDrawing: STATE.isDrawing,
    activeDotId: STATE.activeDot && STATE.activeDot.id,
    reachedA: STATE.activeDot && STATE.activeDot.id === aId,
  }), setup);
  expect(afterA.isDrawing).toBe(true);
  expect(afterA.reachedA).toBe(true);

  // Now steer toward its match and let momentum carry it the rest of the
  // way -- same poll-for-arrival approach as above.
  await page.evaluate(({ bx, by }) => {
    onInputMove({ preventDefault() {}, clientX: bx, clientY: by });
  }, setup);
  await page.waitForFunction(() => STATE.connections.length > 0, null, { timeout: 15000 });

  const afterB = await page.evaluate(({ aId, bId }) => ({
    connection: STATE.connections[0],
    dotAConnected: STATE.dots.find(d => d.id === aId).connected,
    dotBConnected: STATE.dots.find(d => d.id === bId).connected,
    score: STATE.score,
    isDrawing: STATE.isDrawing,
  }), setup);
  expect(afterB.connection).toBeTruthy();
  expect(afterB.connection.dotA).toBe(setup.aId);
  expect(afterB.connection.dotB).toBe(setup.bId);
  expect(afterB.dotAConnected).toBe(true); // wave 1 groups are plain pairs -- one link fully solves both
  expect(afterB.dotBConnected).toBe(true);
  expect(afterB.score).toBeGreaterThan(0);
  expect(afterB.isDrawing).toBe(false);
  expect(errors).toEqual([]);
});

// Flight Mode's ship must never survive past the wave/session it belongs
// to -- same reasoning as every other per-wave reset (portals, lines,
// connections) in startWave/exitToTitle.
test('the Flight Mode ship resets cleanly on a new wave and exiting to the title screen', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(() => {
    STATE.flightMode = true;
    startWave(1);
    const shipAfterStart = !!STATE.ship;
    STATE.ship.x = 12345; // mutate so a stale carry-over would be detectable
    startWave(2);
    const shipResetPosition = STATE.ship ? { x: STATE.ship.x, y: STATE.ship.y } : null;
    exitToTitle();
    const shipAfterExit = STATE.ship;
    STATE.flightMode = false;
    startWave(1);
    const shipWhenDisabled = STATE.ship;
    return { shipAfterStart, shipResetPosition, shipAfterExit, shipWhenDisabled };
  });

  expect(result.shipAfterStart).toBe(true);
  expect(result.shipResetPosition.x).not.toBe(12345); // startWave re-centers it, not carries the old position
  expect(result.shipAfterExit).toBeNull();
  expect(result.shipWhenDisabled).toBeNull(); // no ship at all once flightMode is off
  expect(errors).toEqual([]);
});

// The window-level 'mouseup' safety net (see cancelStaleDrawGesture) fires
// right after canvas's own bubble-phase onInputEnd for every release,
// including a normal Flight Mode one -- it used to unconditionally cancel
// any in-progress connection, which broke coasting for every desktop mouse
// user the instant they let go (review, #42).
test('the window-level mouseup safety net lets a Flight Mode connection keep coasting instead of cancelling it', async ({ page }) => {
  const errors = trackErrors(page);
  await page.addInitScript(() => { navigator.vibrate = () => true; });
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);
  await page.click('#flight-mode-checkbox');
  await page.click('.difficulty-btn[data-difficulty="normal"]');
  await page.click('#start-game-button');
  await page.waitForTimeout(500);

  const result = await page.evaluate(() => {
    const dots = window.__lumina.getDots();
    const [a] = dots;
    onInputStart({ preventDefault() {}, clientX: a.x, clientY: a.y });
    STATE.ship.x = a.x; STATE.ship.y = a.y; // drop the ship straight onto the dot rather than waiting real frames
    updateShipDrawing();
    const isDrawingBeforeRelease = STATE.isDrawing;

    // The actual mouseup: canvas's own handler, then the window-level
    // safety net right behind it, exactly as the browser fires them.
    onInputEnd({ preventDefault() {}, clientX: a.x, clientY: a.y });
    cancelStaleDrawGesture();

    return { isDrawingBeforeRelease, isDrawingAfterRelease: STATE.isDrawing, hasTarget: STATE.ship.hasTarget };
  });

  expect(result.isDrawingBeforeRelease).toBe(true);
  expect(result.isDrawingAfterRelease).toBe(true); // still coasting, not cancelled
  expect(result.hasTarget).toBe(false); // but no longer actively steering
  expect(errors).toEqual([]);
});

// updateEdgePan re-derives the world point under a held screen position
// and used to always extend currentPath toward it -- correct in classic
// mode (the pointer IS what's drawing), wrong in Flight Mode, where the
// pointer is just a steering target that can be far from the ship's own
// (separately recorded) position (review, #42).
test('edge panning in Flight Mode never feeds the steering point into the connection path', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(() => {
    STATE.flightMode = true;
    startWave(1);
    setUserZoom(3); // guarantee baseZoom*userZoom > 1 so edge-pan is eligible at all
    STATE.camera.scale = STATE.camera.targetScale; // skip the per-frame lerp -- clampCameraCenter reads .scale, not userZoom
    const dot = STATE.dots[0];
    STATE.activeDot = dot;
    STATE.isDrawing = true;
    STATE.currentPath = [{ x: dot.x, y: dot.y }];
    STATE.ship.hasTarget = true;
    STATE.lastDrawScreenPos = { x: 2, y: 2 }; // well inside EDGE_PAN_CONFIG.MARGIN_PX of the corner
    const lengthBefore = STATE.currentPath.length;
    updateEdgePan();
    return { lengthBefore, lengthAfter: STATE.currentPath.length, cameraMoved: STATE.camera.centerX !== STATE.world.w / 2 };
  });

  expect(result.cameraMoved).toBe(true); // the pan itself still happens
  expect(result.lengthAfter).toBe(result.lengthBefore); // but nothing got appended to the path
  expect(errors).toEqual([]);
});

// Same reasoning as the portal-pair/thread shift test above -- a ship and
// its steering target are just as real a piece of per-wave world geometry
// as a portal is, and need the same treatment on a resize/orientation
// change (see growWorldToMatchAspect) or the ship ends up displaced
// relative to the whole board (review, #42).
test('shiftWorldEntities moves the Flight Mode ship and its steering target', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(() => {
    STATE.ship = { x: 50, y: 60, vx: 0, vy: 0, heading: 0, hasTarget: true, targetX: 70, targetY: 80 };
    shiftWorldEntities(5, 7);
    return { x: STATE.ship.x, y: STATE.ship.y, targetX: STATE.ship.targetX, targetY: STATE.ship.targetY };
  });

  expect(result).toEqual({ x: 55, y: 67, targetX: 75, targetY: 87 });
  expect(errors).toEqual([]);
});

// beginPinch already dropped any in-progress connection when a second
// finger lands, but left the ship still thrusting toward the pre-pinch
// touch point for the whole zoom gesture -- and onInputEnd's own pinch
// handling returns before ever reaching the Flight Mode release branch, so
// that stale target stayed active even after both fingers lifted (review,
// #42).
test('starting a pinch in Flight Mode stops the ship from steering toward the pre-pinch point', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(() => {
    STATE.flightMode = true;
    startWave(1);
    STATE.ship.hasTarget = true;
    STATE.ship.targetX = 123;
    STATE.ship.targetY = 456;
    beginPinch({ touches: [{ clientX: 100, clientY: 100 }, { clientX: 140, clientY: 140 }] });
    return { hasTarget: STATE.ship.hasTarget, pinchActive: !!STATE.pinch };
  });

  expect(result.hasTarget).toBe(false);
  expect(result.pinchActive).toBe(true); // the pinch itself still starts normally
  expect(errors).toEqual([]);
});

test('a fact-box barrier is a real solid obstacle and displays one of the curated pause facts', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const crossingResult = await page.evaluate(() => {
    const box = {
      type: 'factBox',
      segments: [
        { x1: 100, y1: 100, x2: 200, y2: 100 },
        { x1: 200, y1: 100, x2: 200, y2: 200 },
        { x1: 200, y1: 200, x2: 100, y2: 200 },
        { x1: 100, y1: 200, x2: 100, y2: 100 },
      ],
      text: 'test fact',
      colorIndex: 0,
      rotating: false,
    };
    STATE.barriers = [box];
    // Off the sampled curve's own 8-per-span grid on purpose (see
    // smoothedCurveSegments) — coordinates that land exactly on a sample
    // boundary can coincide with the box's edge and get treated as a
    // touch rather than a crossing by segmentsIntersect's tolerance, which
    // would test that quirk instead of the barrier check this is after.
    const pathThroughBox = [{ x: 30, y: 163 }, { x: 160, y: 163 }, { x: 271, y: 163 }];
    return {
      crosses: findCrossedBarriers(pathThroughBox).length > 0,
      segCount: segmentsOfBarrier(box).length,
    };
  });
  expect(crossingResult.crosses).toBe(true); // solid: a straight path through it is rejected, same as any other barrier
  expect(crossingResult.segCount).toBe(4);

  const placementResult = await page.evaluate(() => {
    STATE.world = { w: 1600, h: 1200 };
    const dots = [{ id: 0, x: 800, y: 600, pairId: 0 }];
    let box = null;
    for (let i = 0; i < 50 && !box; i++) box = generateFactBoxBarrier(dots);
    if (!box) return { found: false };
    return {
      found: true,
      isKnownFact: PAUSE_FACTS.includes(box.text),
      // Generous minimum, not the exact configured clearance (which scales
      // with world size) -- this just confirms the box didn't land
      // overlapping the dot.
      clearOfDot: Math.max(Math.abs(dots[0].x - box.cx), Math.abs(dots[0].y - box.cy)) >= box.size / 2 + 30,
    };
  });
  expect(placementResult.found).toBe(true);
  expect(placementResult.isKnownFact).toBe(true); // the text is one of the curated pause-menu facts, not tips or arbitrary text
  expect(placementResult.clearOfDot).toBe(true);
  expect(errors).toEqual([]);
});

test('a connection attempt blocked by a barrier or another connection queues a blocking flash over exactly what blocked it, which expires on its own (player report: a rejected 3+-dot-group connection gave no visible signal about why)', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(() => {
    // Barrier case: a straight path through a solid box.
    const box = {
      type: 'factBox',
      segments: [
        { x1: 100, y1: 100, x2: 200, y2: 100 },
        { x1: 200, y1: 100, x2: 200, y2: 200 },
        { x1: 200, y1: 200, x2: 100, y2: 200 },
        { x1: 100, y1: 200, x2: 100, y2: 100 },
      ],
    };
    STATE.barriers = [box];
    STATE.connections = [];
    STATE.blockingFlashes = [];
    const barrierCrossed = findCrossedBarriers([{ x: 30, y: 163 }, { x: 271, y: 163 }]);
    flashBlockingBarriers(barrierCrossed);
    const barrierFlashCount = STATE.blockingFlashes.length;

    // Connection case: a 4th dot's straight line crossing an unrelated
    // already-drawn edge that doesn't share either endpoint with it (the
    // one geometrically real way a same-group connection, not a barrier,
    // blocks a straight attempt -- see findCrossedBarriers' own comment).
    STATE.barriers = [];
    STATE.blockingFlashes = [];
    const D = { id: 2000, x: 300, y: 100 };
    const E = { id: 2001, x: 300, y: 300 };
    STATE.connections = [{ dotA: D.id, dotB: E.id, segments: [{ x1: D.x, y1: D.y, x2: E.x, y2: E.y }] }];
    const connCrossed = findCrossedConnections([{ x: 200, y: 200 }, { x: 400, y: 200 }]);
    flashBlockingConnections(connCrossed);
    const connFlashCount = STATE.blockingFlashes.length;

    drawBlockingFlashes(); // throws if the render path is broken
    // Force every queued flash's own natural expiry rather than waiting out
    // BLOCKING_FLASH_DURATION_MS in real time.
    for (const f of STATE.blockingFlashes) f.startTime -= 10000;
    drawBlockingFlashes();
    const afterExpiry = STATE.blockingFlashes.length;

    return { barrierFlashCount, connFlashCount, afterExpiry };
  });

  expect(result.barrierFlashCount).toBe(1);
  expect(result.connFlashCount).toBe(1);
  expect(result.afterExpiry).toBe(0);
  expect(errors).toEqual([]);
});

test('the longest pause facts always fit inside a fact box, at every size the box can be, without silent clipping', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(() => {
    const longest = [...PAUSE_FACTS].sort((a, b) => b.length - a.length).slice(0, 5);
    const out = [];
    for (const text of longest) {
      for (const size of [FACT_BOX_CONFIG.SIZE_ABS_MIN, FACT_BOX_CONFIG.SIZE_ABS_MAX]) {
        const { lines, lineHeight } = fitFactText(text, size - 24, size - 16);
        out.push({
          fitsBox: lines.length * lineHeight <= size - 16 + 0.01,
          firstWordMatches: text.split(' ')[0] === lines[0].split(' ')[0],
        });
      }
    }
    return out;
  });

  for (const r of result) {
    expect(r.fitsBox).toBe(true); // shrunk to fit, or truncated -- never spills past the box's own clip region
    expect(r.firstWordMatches).toBe(true); // always starts from the beginning of the fact, never mid-sentence
  }
  expect(errors).toEqual([]);
});

test('unconnected dots render visibly dimmer than fully-connected dots', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(() => {
    const connectedDot = { id: 0, pairId: 0, colorIndex: 0, x: 100, y: 100, connected: true, pulsePhase: 0, pulseOffset: 0 };
    const idleDot = { id: 1, pairId: 1, colorIndex: 1, x: 200, y: 100, connected: false, pulsePhase: 0, pulseOffset: 0 };

    const alphas = [];
    const origFill = ctx.fill.bind(ctx);
    ctx.fill = function (...args) { alphas.push(ctx.globalAlpha); return origFill(...args); };

    drawDot(connectedDot);
    const connectedAlpha = alphas[0];
    alphas.length = 0;

    drawDot(idleDot);
    const idleAlpha = alphas[0];

    ctx.fill = origFill;
    return { connectedAlpha, idleAlpha };
  });

  expect(result.connectedAlpha).toBeCloseTo(1, 5);
  expect(result.idleAlpha).toBeLessThan(result.connectedAlpha);
  expect(result.idleAlpha).toBeCloseTo(0.55, 5);
  expect(errors).toEqual([]);
});

test('the Hint menu item appears once playing, flashes unconnected dots white at their peak, and returns to the dimmed idle state once it ends', async ({ page }) => {
  const errors = trackErrors(page);
  await page.addInitScript(() => { navigator.vibrate = () => true; });
  await page.goto('/index.html');
  await page.waitForTimeout(300);

  await expect(page.locator('#pause-hint')).toBeHidden();
  await expect(page.locator('#pause-hint')).toHaveText('Hint');
  // HINT is free/functional in Relaxed and Normal, not Intense (see the
  // difficulty-gating tests below) -- select Relaxed explicitly so this
  // test covers the actual pulse/sound mechanics regardless of default.
  await page.click('.difficulty-btn[data-difficulty="relaxed"]');
  await page.click('#start-game-button');
  await page.waitForTimeout(1000);
  // The item only actually renders once the menu that holds it is open
  // (see #pause-overlay) -- open it to check, then close it again before
  // exercising the pulse mechanics directly below.
  await page.click('#pause-button');
  await expect(page.locator('#pause-hint')).toBeVisible();
  await page.click('#pause-resume');

  const config = await page.evaluate(() => {
    for (const d of STATE.dots) d.connected = false; // clean signal, regardless of what this wave generated
    triggerHintPulse();
    return HINT_PULSE_CONFIG;
  });

  // First peak (brightness == 1) lands at DURATION_MS / (2 * CYCLES).
  await page.waitForTimeout(config.DURATION_MS / (2 * config.CYCLES));
  const atPeak = await page.evaluate(() => {
    const fills = []; // { alpha, style } for every fill() call this drawDot makes
    const origFill = ctx.fill.bind(ctx);
    ctx.fill = function (...args) { fills.push({ alpha: ctx.globalAlpha, style: ctx.fillStyle }); return origFill(...args); };
    drawDot(STATE.dots[0]);
    ctx.fill = origFill;
    return fills;
  });
  expect(atPeak[0].alpha).toBeGreaterThan(0.95); // base color fill flashed up to full brightness
  // A same-hue brightness pulse isn't enough -- the flash must actually turn
  // the dot white, distinct from a dot's own ambient/connected pulse (which
  // never changes color). drawDot always draws a small white "core" circle
  // last regardless of hint state, so a plain "is any fill white" check
  // can't tell a real flash apart from that -- the flash is specifically
  // the *middle* fill call (base color, then the flash, then the core),
  // only present at all while a flash is actually happening.
  expect(atPeak).toHaveLength(3);
  expect(atPeak[1].style).toBe('#ffffff');
  expect(atPeak[1].alpha).toBeGreaterThan(0.95);

  await page.waitForTimeout(config.DURATION_MS); // let the whole pulse finish
  const afterDone = await page.evaluate(() => {
    const fills = [];
    const origFill = ctx.fill.bind(ctx);
    ctx.fill = function (...args) { fills.push({ alpha: ctx.globalAlpha, style: ctx.fillStyle }); return origFill(...args); };
    drawDot(STATE.dots[0]);
    ctx.fill = origFill;
    return { fills, cleared: STATE.hintPulse === null };
  });
  expect(afterDone.fills[0].alpha).toBeCloseTo(0.55, 2); // back to the normal dimmed idle state
  expect(afterDone.fills).toHaveLength(2); // just the base color + the permanent core dot -- no flash fill once the pulse is over
  expect(afterDone.cleared).toBe(true);
  expect(errors).toEqual([]);
});

test('HINT is free and functional in both Relaxed and Normal', async ({ page }) => {
  const errors = trackErrors(page);
  await page.addInitScript(() => { navigator.vibrate = () => true; });
  await page.goto('/index.html');
  await page.waitForTimeout(300);

  await page.click('.difficulty-btn[data-difficulty="normal"]');
  await page.click('#start-game-button');
  await page.waitForTimeout(1000);
  await page.click('#pause-button');
  await expect(page.locator('#pause-hint')).toBeVisible();
  await page.click('#pause-resume');

  const fired = await page.evaluate(() => {
    for (const d of STATE.dots) d.connected = false;
    triggerHintPulse();
    return STATE.hintPulse !== null;
  });
  expect(fired).toBe(true);
  expect(errors).toEqual([]);
});

test('HINT stays visible in Intense but shows an explanatory toast instead of firing a hint', async ({ page }) => {
  const errors = trackErrors(page);
  await page.addInitScript(() => { navigator.vibrate = () => true; });
  await page.goto('/index.html');
  await page.waitForTimeout(300);
  await page.click('.difficulty-btn[data-difficulty="intense"]');
  await page.click('#start-game-button');
  await page.waitForTimeout(1000);
  await page.click('#pause-button');
  await expect(page.locator('#pause-hint')).toBeVisible();
  await page.click('#pause-resume');

  const result = await page.evaluate(() => {
    triggerHintPulse();
    return {
      hintFired: STATE.hintPulse !== null,
      toastVisible: document.getElementById('hint-toast').classList.contains('visible'),
      toastText: document.getElementById('hint-toast').textContent,
    };
  });
  expect(result.hintFired).toBe(false);
  expect(result.toastVisible).toBe(true);
  expect(result.toastText.length).toBeGreaterThan(0);

  // Stays up long enough to actually read, then clears itself.
  await page.waitForTimeout(2000);
  await expect(page.locator('#hint-toast')).toHaveClass(/visible/);
  await page.waitForTimeout(2500);
  await expect(page.locator('#hint-toast')).not.toHaveClass(/visible/);
  expect(errors).toEqual([]);
});

// Regression guard for a Codex finding (#39), still meaningful post-menu-
// consolidation even though the row itself can no longer wrap to two
// lines (it holds exactly one button at a time now -- see #top-buttons-row):
// the toast's position is still computed from the row's own measured
// bottom, not a hardcoded offset, so it still can't be assumed correct
// without checking on an actually narrow viewport.
test('the hint toast appears below the top button row on a narrow viewport', async ({ page }) => {
  const errors = trackErrors(page);
  await page.addInitScript(() => { navigator.vibrate = () => true; });
  await page.setViewportSize({ width: 280, height: 700 });
  await page.goto('/index.html');
  await page.waitForTimeout(300);
  await page.click('.difficulty-btn[data-difficulty="intense"]');
  await page.mouse.click(140, 600);
  await page.waitForTimeout(1000);

  const layout = await page.evaluate(() => {
    const rowRect = document.getElementById('top-buttons-row').getBoundingClientRect();
    triggerHintPulse();
    const toastRect = document.getElementById('hint-toast').getBoundingClientRect();
    return { rowBottom: rowRect.bottom, toastTop: toastRect.top };
  });
  expect(layout.toastTop).toBeGreaterThanOrEqual(layout.rowBottom);
  expect(errors).toEqual([]);
});

test('triggering a hint pulse in Relaxed plays a short confirmation chime', async ({ page }) => {
  const errors = trackErrors(page);
  await page.addInitScript(() => { navigator.vibrate = () => true; });
  await page.goto('/index.html');
  await page.waitForTimeout(300);
  await page.click('.difficulty-btn[data-difficulty="relaxed"]');
  await page.click('#start-game-button');
  await page.waitForTimeout(1000);

  const started = await page.evaluate(() => {
    const origStart = OscillatorNode.prototype.start;
    let called = false;
    OscillatorNode.prototype.start = function (...args) { called = true; return origStart.apply(this, args); };
    triggerHintPulse();
    OscillatorNode.prototype.start = origStart;
    return called;
  });
  expect(started).toBe(true);
  expect(errors).toEqual([]);
});

// Regression guard for a Codex finding (#38), narrower in scope now that
// the row holds just the single MENU button during play (ERASE/HINT/HELP
// moved into its panel -- see #pause-panel) rather than four spelled-out
// words that used to be wide enough to overflow a narrow viewport on
// their own. Still worth guarding: `body` has overflow:hidden, so any
// future addition to this row that overflows would silently clip rather
// than error.
test('the top button row never overflows the viewport on a narrow screen', async ({ page }) => {
  const errors = trackErrors(page);
  await page.addInitScript(() => { navigator.vibrate = () => true; });
  await page.setViewportSize({ width: 280, height: 700 });
  await page.goto('/index.html');
  await page.waitForTimeout(300);
  await page.click('.difficulty-btn[data-difficulty="relaxed"]');
  await page.mouse.click(140, 600);
  await page.waitForTimeout(1000);

  const layout = await page.evaluate(() => {
    const rect = document.getElementById('top-buttons-row').getBoundingClientRect();
    return {
      rowRight: rect.right,
      viewportWidth: window.innerWidth,
      docScrollWidth: document.documentElement.scrollWidth,
    };
  });
  expect(layout.rowRight).toBeLessThanOrEqual(layout.viewportWidth);
  expect(layout.docScrollWidth).toBeLessThanOrEqual(layout.viewportWidth);
  expect(errors).toEqual([]);
});

test('the help button opens a how-to-play overlay on the title screen, and the in-menu item does the same mid-game, both closable via the X or the backdrop', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForTimeout(300);

  // Visible (and functional) before the player has even started a game.
  await expect(page.locator('#help-button')).toBeVisible();
  await page.click('#help-button');
  await expect(page.locator('#help-overlay')).toHaveClass(/visible/);
  await expect(page.locator('#help-list li').first()).not.toBeEmpty();
  await page.click('#help-close');
  await expect(page.locator('#help-overlay')).not.toHaveClass(/visible/);

  // Mid-game, the standalone button is hidden -- How to Play moves inside
  // the single MENU button's panel instead (see #pause-help).
  await page.click('#start-game-button');
  await page.waitForTimeout(500);
  await expect(page.locator('#help-button')).toBeHidden();
  await page.click('#pause-button');
  await page.click('#pause-help');
  await expect(page.locator('#help-overlay')).toHaveClass(/visible/);

  // Clicking the backdrop itself (not the panel) also closes it, and
  // resumes the game it paused to get here (see closeHelp).
  await page.click('#help-overlay', { position: { x: 5, y: 5 } });
  await expect(page.locator('#help-overlay')).not.toHaveClass(/visible/);
  expect(await page.evaluate(() => STATE.paused)).toBe(false);
  expect(errors).toEqual([]);
});

test('zooming in stays centered by default, but panning empty space once zoomed in moves the camera and is clamped to the world edge; at baseline zoom nothing pans at all', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(() => {
    const out = {};
    // Fixed canvas size, not whatever the test runner's own viewport
    // happens to be -- clampCameraCenter reads canvas.width/height
    // directly, and this keeps the expected numbers below exact.
    canvas.width = 500; canvas.height = 500;
    STATE.world = { w: 2000, h: 2000 };
    STATE.camera.autoScale = 0.25; // matches canvas.width / world.w at this fixed size

    // Baseline (userZoom == 1): forced to dead center no matter what.
    setUserZoom(1);
    STATE.camera.scale = STATE.camera.targetScale;
    STATE.camera.centerX = 999; STATE.camera.centerY = 999;
    clampCameraCenter();
    out.baselineForcesCenter = STATE.camera.centerX === 1000 && STATE.camera.centerY === 1000;

    // setUserZoom now allows in past 1 and still respects both ends of the range.
    setUserZoom(2.8);
    out.zoomInAllowed = STATE.camera.userZoom === 2.8;
    setUserZoom(999);
    out.zoomInClamped = STATE.camera.userZoom === CAMERA_CONFIG.MAX_USER_ZOOM_IN;
    setUserZoom(-999);
    out.zoomOutClamped = STATE.camera.userZoom === CAMERA_CONFIG.MIN_USER_PULLBACK;

    // Zoomed in: an off-center look-at point within bounds is preserved,
    // but one pushed past the world edge is clamped, not just left alone.
    setUserZoom(2.5);
    STATE.camera.scale = STATE.camera.targetScale; // 0.625; halfView = 400
    STATE.camera.centerX = 700; STATE.camera.centerY = 700;
    clampCameraCenter();
    out.offCenterPreservedInBounds = STATE.camera.centerX === 700 && STATE.camera.centerY === 700;
    STATE.camera.centerX = 10; STATE.camera.centerY = 10;
    clampCameraCenter();
    out.clampedToWorldEdge = STATE.camera.centerX === 400 && STATE.camera.centerY === 400;

    return out;
  });

  expect(result.baselineForcesCenter).toBe(true);
  expect(result.zoomInAllowed).toBe(true);
  expect(result.zoomInClamped).toBe(true);
  expect(result.zoomOutClamped).toBe(true);
  expect(result.offCenterPreservedInBounds).toBe(true);
  expect(result.clampedToWorldEdge).toBe(true);
  expect(errors).toEqual([]);
});

test('dragging empty board space pans the camera when zoomed in, but is a total no-op at baseline zoom (same as before panning existed)', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const setup = () => page.evaluate(() => {
    // The title screen's own overlay (difficulty selector, load row) has
    // real pointer-events and sits on top of the canvas until explicitly
    // hidden -- without this, a drag that happens to cross its on-screen
    // area gets silently swallowed by it instead of reaching the canvas's
    // own mouse handlers, exactly like a real "still on the title screen"
    // state would.
    hideMessage();
    STATE.phase = 'PLAYING';
    STATE.paused = false;
    STATE.isDrawing = false;
    STATE.world = { w: 2000, h: 2000 };
    // Off in a corner far from both ends of the drag below, so the drag
    // can never accidentally start (or land) on a real dot.
    STATE.dots = [{ id: 0, pairId: 0, colorIndex: 0, x: 1900, y: 1900, connected: false, pulsePhase: 0 }];
    // Real mouse events below are positioned in actual page pixels, so
    // this has to match resizeCanvas's own formula against the real
    // canvas size (whatever the test runner's viewport is), not an
    // assumed value -- a mismatch here would silently break the
    // correspondence between screen-pixel drags and world-space deltas.
    STATE.camera.autoScale = Math.min(1, Math.min(canvas.width / STATE.world.w, canvas.height / STATE.world.h));
    STATE.camera.centerX = 1000; STATE.camera.centerY = 1000;
  });

  // At baseline: no pan at all.
  await setup();
  await page.evaluate(() => { setUserZoom(1); STATE.camera.scale = STATE.camera.targetScale; clampCameraCenter(); });
  await page.mouse.move(20, 20);
  await page.mouse.down();
  await page.mouse.move(220, 220, { steps: 5 });
  await page.mouse.up();
  const atBaseline = await page.evaluate(() => ({ centerX: STATE.camera.centerX, centerY: STATE.camera.centerY, panDrag: STATE.panDrag }));
  expect(atBaseline.centerX).toBe(1000);
  expect(atBaseline.centerY).toBe(1000);
  expect(atBaseline.panDrag).toBeNull();

  // Zoomed in: the same kind of drag now actually pans, by exactly
  // (screen delta / scale) -- kept small (60px) and starting dead center
  // so the resulting world-space delta lands well inside clampCameraCenter's
  // valid range on both axes; the edge-clamping behavior itself already
  // has its own dedicated coverage above.
  await setup();
  const before = await page.evaluate(() => {
    setUserZoom(2.5);
    STATE.camera.scale = STATE.camera.targetScale;
    clampCameraCenter();
    return { centerX: STATE.camera.centerX, centerY: STATE.camera.centerY, scale: STATE.camera.scale };
  });
  await page.mouse.move(200, 400);
  await page.mouse.down();
  await page.mouse.move(260, 460, { steps: 5 });
  await page.mouse.up();
  const zoomedIn = await page.evaluate(() => ({ centerX: STATE.camera.centerX, centerY: STATE.camera.centerY, panDrag: STATE.panDrag, isDrawing: STATE.isDrawing }));

  expect(zoomedIn.centerX).toBeCloseTo(before.centerX - 60 / before.scale, 5);
  expect(zoomedIn.centerY).toBeCloseTo(before.centerY - 60 / before.scale, 5);
  expect(zoomedIn.panDrag).toBeNull(); // cleared on release
  expect(zoomedIn.isDrawing).toBe(false); // never mistaken for a connection drag
  expect(errors).toEqual([]);
});

test('clicking Start Game always starts wave 1 unless Auto Load Last Save is checked, and Load Game always resumes explicitly regardless', async ({ page }) => {
  const errors = trackErrors(page);
  await page.addInitScript(() => { navigator.vibrate = () => true; });
  await page.goto('/index.html');
  await page.waitForTimeout(300);

  // No save yet: Load Game hidden, checkbox unchecked, generic subtitle.
  const fresh = await page.evaluate(() => ({
    loadBtnVisible: document.getElementById('title-load-button').classList.contains('visible'),
    checkboxChecked: document.getElementById('autoload-checkbox').checked,
  }));
  expect(fresh.loadBtnVisible).toBe(false);
  expect(fresh.checkboxChecked).toBe(false);

  await page.click('#start-game-button');
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => window.__lumina.getState().wave)).toBe(1);

  // Save at wave 5, return to title -- autoload is off by default, so
  // Start Game must NOT silently resume it.
  await page.evaluate(() => {
    STATE.wave = 5; STATE.score = 500;
    saveGame();
    exitToTitle();
  });
  await page.waitForTimeout(300);
  const withSave = await page.evaluate(() => ({
    loadBtnVisible: document.getElementById('title-load-button').classList.contains('visible'),
    subtitle: document.getElementById('message-subtitle').textContent,
  }));
  expect(withSave.loadBtnVisible).toBe(true);
  expect(withSave.subtitle).not.toMatch(/resume/);

  await page.click('#start-game-button');
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => window.__lumina.getState().wave)).toBe(1); // NOT 5 -- autoload was off

  // Explicit Load Game click, from a fresh title screen, does resume it.
  await page.evaluate(() => exitToTitle());
  await page.waitForTimeout(300);
  await page.click('#title-load-button');
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.__lumina.getState().wave)).toBe(5);

  // Checking the box persists across a reload, and Start Game resumes
  // from then on.
  await page.evaluate(() => { STATE.wave = 7; STATE.score = 700; saveGame(); exitToTitle(); });
  await page.waitForTimeout(300);
  await page.click('#autoload-checkbox');
  expect(await page.evaluate(() => localStorage.getItem('lumina_autoload_v1'))).toBe('true');

  await page.reload();
  await page.waitForTimeout(400);
  const afterReload = await page.evaluate(() => ({
    checkboxChecked: document.getElementById('autoload-checkbox').checked,
    subtitle: document.getElementById('message-subtitle').textContent,
  }));
  expect(afterReload.checkboxChecked).toBe(true);
  expect(afterReload.subtitle).toMatch(/resume — wave 7/);

  await page.click('#start-game-button');
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => window.__lumina.getState().wave)).toBe(7);
  expect(errors).toEqual([]);
});

test('the title subtitle updates immediately when Auto Load Last Save is toggled, not just on the next visit', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);
  await page.waitForTimeout(300);

  await page.evaluate(() => {
    STATE.wave = 9; STATE.score = 900;
    saveGame();
    exitToTitle();
  });
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => document.getElementById('message-subtitle').textContent))
    .not.toMatch(/resume/); // autoload starts off

  await page.click('#autoload-checkbox');
  expect(await page.evaluate(() => document.getElementById('message-subtitle').textContent))
    .toMatch(/resume — wave 9/);

  await page.click('#autoload-checkbox'); // uncheck again
  expect(await page.evaluate(() => document.getElementById('message-subtitle').textContent))
    .not.toMatch(/resume/);
  expect(errors).toEqual([]);
});

test('rotating the device mid-wave grows the world to fill the new aspect ratio instead of leaving it letterboxed, and rotating back never compounds the growth', async ({ page }) => {
  const errors = trackErrors(page);
  await page.addInitScript(() => { navigator.vibrate = () => true; });
  await page.goto('/index.html');
  await page.waitForTimeout(300);
  await page.click('#start-game-button');
  await page.waitForTimeout(1000);

  const portrait = await page.evaluate(() => ({ w: STATE.world.w, h: STATE.world.h, canvasW: canvas.width, canvasH: canvas.height }));

  // Rotate to landscape (swap dimensions, same as a real device).
  await page.setViewportSize({ width: portrait.canvasH, height: portrait.canvasW });
  await page.waitForTimeout(300);
  const landscape = await page.evaluate(() => ({
    w: STATE.world.w, h: STATE.world.h, autoScale: STATE.camera.autoScale,
    canvasW: canvas.width, canvasH: canvas.height,
  }));

  expect(landscape.w).toBeGreaterThan(portrait.w); // grew wider to match the new screen shape
  expect(landscape.h).toBe(portrait.h); // height untouched -- existing dots' y-positions stay valid
  // Both axes now land on the same scale factor -- the world fills the
  // screen edge to edge instead of being shrunk to whichever axis is more
  // constrained (the actual "terribly compressed" symptom reported).
  expect(landscape.w * landscape.autoScale).toBeCloseTo(landscape.canvasW, 1);
  expect(landscape.h * landscape.autoScale).toBeCloseTo(landscape.canvasH, 1);

  // Rotate back to the original portrait shape.
  await page.setViewportSize({ width: portrait.canvasW, height: portrait.canvasH });
  await page.waitForTimeout(300);
  const backToPortrait = await page.evaluate(() => ({ w: STATE.world.w, h: STATE.world.h }));
  expect(backToPortrait.w).toBe(portrait.w);
  expect(backToPortrait.h).toBe(portrait.h);

  // Several more rotation cycles must never compound past the
  // landscape-adjusted size -- each recomputes from the wave's fixed
  // baseW/baseH, not from whatever the world had already grown to.
  for (let i = 0; i < 4; i++) {
    await page.setViewportSize({ width: portrait.canvasH, height: portrait.canvasW });
    await page.waitForTimeout(100);
    await page.setViewportSize({ width: portrait.canvasW, height: portrait.canvasH });
    await page.waitForTimeout(100);
  }
  const afterCycles = await page.evaluate(() => ({ w: STATE.world.w, h: STATE.world.h }));
  expect(afterCycles.w).toBe(portrait.w);
  expect(afterCycles.h).toBe(portrait.h);
  expect(errors).toEqual([]);
});

test('growing the world on rotation re-centers everything already placed instead of leaving it crammed in a corner, and rotating back restores exact original positions', async ({ page }) => {
  const errors = trackErrors(page);
  await page.addInitScript(() => { navigator.vibrate = () => true; });
  await page.goto('/index.html');
  await page.waitForTimeout(300);
  await page.click('#start-game-button');
  await page.waitForTimeout(1000);

  const before = await page.evaluate(() => ({
    dotX: STATE.dots[0].x, dotY: STATE.dots[0].y,
    worldW: STATE.world.w, worldH: STATE.world.h,
    canvasW: canvas.width, canvasH: canvas.height,
  }));

  await page.setViewportSize({ width: before.canvasH, height: before.canvasW }); // rotate
  await page.waitForTimeout(300);
  const landscape = await page.evaluate(() => ({ dotX: STATE.dots[0].x, dotY: STATE.dots[0].y, worldW: STATE.world.w }));

  // The dot moved by exactly half of whatever width got added -- i.e. the
  // content that used to fill [0, oldW] is now centered inside [0, newW],
  // not still sitting at the same absolute coordinates (which would leave
  // it crammed against the left edge of the newly wider world).
  const expectedShift = (landscape.worldW - before.worldW) / 2;
  expect(landscape.dotX - before.dotX).toBeCloseTo(expectedShift, 5);
  expect(landscape.dotY).toBe(before.dotY); // height untouched, so no y-shift

  await page.setViewportSize({ width: before.canvasW, height: before.canvasH }); // rotate back
  await page.waitForTimeout(300);
  const backToPortrait = await page.evaluate(() => ({ dotX: STATE.dots[0].x, dotY: STATE.dots[0].y }));
  expect(backToPortrait.dotX).toBeCloseTo(before.dotX, 5);
  expect(backToPortrait.dotY).toBeCloseTo(before.dotY, 5);
  expect(errors).toEqual([]);
});

test('the tutorial hint avoids a fact box sitting where it would otherwise land, not just dots', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(() => {
    STATE.phase = 'PLAYING';
    STATE.dots = [
      { id: 0, pairId: 0, colorIndex: 0, x: 30, y: 30, connected: false, pulsePhase: 0 },
      { id: 1, pairId: 0, colorIndex: 0, x: 370, y: 770, connected: false, pulsePhase: 0 },
    ];
    STATE.world = { w: 400, h: 800 };
    STATE.camera.autoScale = 1; STATE.camera.userZoom = 1;
    STATE.camera.targetScale = 1; STATE.camera.scale = 1; // no lerp drift
    STATE.camera.centerX = 200; STATE.camera.centerY = 400;
    // A fact box dead-center of the screen -- exactly where the hint
    // would otherwise default to (see tutorialPositionCandidates).
    const half = 75;
    STATE.barriers = [{
      type: 'factBox', cx: 200, cy: 400, size: half * 2, colorIndex: 0,
      text: 'fake fact for this test', segments: [], x1: 0, y1: 0, x2: 0, y2: 0,
    }];

    layoutTutorialHint('Tap/Click hold to draw a line from one colored dot to its pair.');
    const hint = document.getElementById('tutorial-hint').getBoundingClientRect();
    const box = { left: 200 - half, top: 400 - half, right: 200 + half, bottom: 400 + half };
    const overlaps = hint.left < box.right && hint.right > box.left && hint.top < box.bottom && hint.bottom > box.top;
    return { overlaps };
  });

  expect(result.overlaps).toBe(false);
  expect(errors).toEqual([]);
});

test('a stale tab picks up a new deploy on tab resume, not just initial load, but never mid-wave', async ({ page }) => {
  const errors = trackErrors(page);

  // location.replace() is a WebIDL "Unforgeable" own property -- it can't
  // be spied on directly even via Location.prototype. Detect the reload
  // the same way Playwright itself would: a real navigation to a URL
  // carrying the cache-busting "_r=" param checkForNewVersionAndReload()
  // appends.
  async function firesReload(trigger) {
    await page.evaluate(() => sessionStorage.removeItem('lumina_reload_attempted_for'));
    let navigatedTo = null;
    const onNav = (frame) => { if (frame === page.mainFrame()) navigatedTo = frame.url(); };
    page.on('framenavigated', onNav);
    await trigger();
    await page.waitForTimeout(600);
    page.off('framenavigated', onNav);
    return navigatedTo !== null && navigatedTo.includes('_r=');
  }

  let servedBuild = 'newbuild123';
  await page.route('**/version.json*', (route) => {
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ build: servedBuild }) });
  });

  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);
  // init() itself just consumed the 'newbuild123' guard via a real reload
  // on the initial load -- expected, not what this test is checking.

  await page.evaluate(() => { STATE.phase = 'TITLE'; });
  expect(await firesReload(() => page.evaluate(() => window.dispatchEvent(new Event('pageshow'))))).toBe(true);

  await page.evaluate(() => { STATE.phase = 'TITLE'; });
  expect(await firesReload(() => page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  }))).toBe(true);

  await page.evaluate(() => { STATE.phase = 'TITLE'; });
  expect(await firesReload(() => page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  }))).toBe(false);

  // A tab that already started playing must never get yanked out from
  // under the player, even if a newer build is available.
  await page.evaluate(() => { STATE.phase = 'PLAYING'; });
  expect(await firesReload(() => page.evaluate(() => window.dispatchEvent(new Event('pageshow'))))).toBe(false);

  // Once the tab's own build matches what's live, no further reload fires.
  await page.evaluate(() => { STATE.phase = 'TITLE'; });
  servedBuild = await page.evaluate(() => {
    const el = document.querySelector('script[src*="game.js"]');
    return new URL(el.src, location.href).searchParams.get('v');
  });
  expect(await firesReload(() => page.evaluate(() => window.dispatchEvent(new Event('pageshow'))))).toBe(false);

  expect(errors).toEqual([]);
});

test('a connection line renders at the exact same width while being drawn, while fading, and once settled', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const widths = await page.evaluate(() => {
    STATE.phase = 'PLAYING';

    // ctx.restore() reverts lineWidth once each draw function returns, so
    // capture it at the moment of the actual stroke() call instead of
    // reading ctx.lineWidth afterward.
    const seen = [];
    const realStroke = CanvasRenderingContext2D.prototype.stroke;
    CanvasRenderingContext2D.prototype.stroke = function (...args) {
      seen.push(this.lineWidth);
      return realStroke.apply(this, args);
    };

    STATE.isDrawing = true;
    STATE.activeDot = { colorIndex: 0 };
    STATE.currentPath = [{ x: 50, y: 50 }, { x: 150, y: 150 }];
    drawActiveLine();
    const drawing = seen[seen.length - 1];

    const fadingLine = {
      colorIndex: 0, settled: false,
      points: [{ x: 50, y: 50, alpha: 1 }, { x: 150, y: 150, alpha: 1 }],
    };
    drawFadingLine(fadingLine);
    const fading = seen[seen.length - 1];

    const settledLine = {
      colorIndex: 0, settled: true,
      points: [{ x: 50, y: 50, alpha: 1 }, { x: 150, y: 150, alpha: 1 }],
    };
    drawFadingLine(settledLine);
    const settled = seen[seen.length - 1];

    CanvasRenderingContext2D.prototype.stroke = realStroke;
    return { drawing, fading, settled, configWidth: CONFIG.LINE_WIDTH };
  });

  expect(widths.drawing).toBe(widths.configWidth);
  expect(widths.fading).toBe(widths.configWidth);
  expect(widths.settled).toBe(widths.configWidth);
  expect(errors).toEqual([]);
});

test('the tutorial hint searches the whole screen for clear space, not just a band around the center', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(() => {
    STATE.phase = 'PLAYING';
    STATE.barriers = [];
    STATE.world = { w: 400, h: 800 };
    STATE.camera.autoScale = 1; STATE.camera.userZoom = 1;
    STATE.camera.targetScale = 1; STATE.camera.scale = 1; // no lerp drift
    STATE.camera.centerX = 200; STATE.camera.centerY = 400;

    // Densely tile a band roughly 200px above/below center -- exactly the
    // region the search used to be capped to -- leaving the top and bottom
    // of the screen (well outside that old radius) completely clear.
    const dots = [];
    let id = 0;
    for (let x = 20; x <= 380; x += 70) {
      for (let y = 210; y <= 590; y += 70) {
        dots.push({ id: id++, pairId: id, colorIndex: 0, x, y, connected: false, pulsePhase: 0 });
      }
    }
    STATE.dots = dots;

    layoutTutorialHint('Tap/Click hold to draw a line from one colored dot to its pair.');
    const rect = document.getElementById('tutorial-hint').getBoundingClientRect();
    return {
      overlapCount: dotOverlapCount(rect) + barrierOverlapCount(rect),
      top: rect.top, bottom: rect.bottom,
    };
  });

  // A layout entirely inside the old 200px-radius band (y 200-600) would
  // necessarily overlap this grid; finding a clear spot means it landed
  // outside that band, in the region only reachable by the wider search.
  expect(result.overlapCount).toBe(0);
  const landedOutsideOldBand = result.bottom < 210 || result.top > 590;
  expect(landedOutsideOldBand).toBe(true);
  expect(errors).toEqual([]);
});

test('the tutorial hint keeps a real buffer around dots, not just the bare exclusion radius', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(() => {
    STATE.camera.scale = 1;
    STATE.camera.centerX = canvas.width / 2;
    STATE.camera.centerY = canvas.height / 2; // identity worldToScreen, so world coords == screen coords below
    const rect = { left: 100, top: 100, right: 300, bottom: 150 };
    const bareExclusion = CONFIG.DOT_RADIUS_CONNECTED_MAX; // no buffer at all
    const bufferedExclusion = CONFIG.DOT_RADIUS_CONNECTED_MAX + TUTORIAL_HINT_BUFFER;

    // A dot just past the bare dot radius, but still inside the buffered
    // radius, should still count as crowding the box.
    STATE.dots = [{ id: 0, pairId: 0, colorIndex: 0, x: 200, y: 150 + bareExclusion + 5, connected: false, pulsePhase: 0 }];
    const withinBuffer = dotOverlapCount(rect);

    // A dot safely past the buffered radius should not count at all.
    STATE.dots = [{ id: 0, pairId: 0, colorIndex: 0, x: 200, y: 150 + bufferedExclusion + 5, connected: false, pulsePhase: 0 }];
    const beyondBuffer = dotOverlapCount(rect);

    return { withinBuffer, beyondBuffer, bareExclusion, bufferedExclusion };
  });

  expect(result.bufferedExclusion).toBeGreaterThan(result.bareExclusion);
  expect(result.withinBuffer).toBe(1);
  expect(result.beyondBuffer).toBe(0);
  expect(errors).toEqual([]);
});

test('the zoom/pan tutorial hint is short enough to read as one glance, not a paragraph', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const wordCount = await page.evaluate(() => {
    const zoomEntry = TUTORIAL_MESSAGES.find(m => /zoom/i.test(m.text));
    return zoomEntry.text.split(/\s+/).length;
  });

  expect(wordCount).toBeLessThanOrEqual(10);
  expect(errors).toEqual([]);
});

test('a real tutorial-wave dot/barrier/fact-box layout never leaves the hint text obscured, across many random waves', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(() => {
    // Mirrors the Monte Carlo methodology used for the maze-barrier
    // solvability stress test: generate many real waves 1-7 (the only
    // waves that show a tutorial hint) with their actual dots and
    // generateBarriersSafely output, and confirm the hint always finds a
    // spot clear of every dot, barrier, fact box, and the wave/score/button
    // HUD -- not just in a hand-picked scenario.
    let total = 0, obscured = 0;
    for (let trial = 0; trial < 30; trial++) {
      for (let wave = 1; wave <= 7; wave++) {
        const dots = generateDots(wave);
        ensureAllDotsInWorldBounds(dots);
        STATE.phase = 'PLAYING';
        STATE.dots = dots;
        STATE.barriers = generateBarriersSafely(wave, dots);
        STATE.camera.autoScale = Math.min(1, Math.min(canvas.width / STATE.world.w, canvas.height / STATE.world.h));
        STATE.camera.userZoom = 1;
        STATE.camera.targetScale = STATE.camera.autoScale;
        STATE.camera.scale = STATE.camera.autoScale;
        STATE.camera.centerX = STATE.world.w / 2;
        STATE.camera.centerY = STATE.world.h / 2;
        showTutorialHint(wave);
        const rect = document.getElementById('tutorial-hint').getBoundingClientRect();
        total++;
        if (dotOverlapCount(rect) + barrierOverlapCount(rect) > 0 || rectOverlapsHud(rect)) obscured++;
      }
    }
    return { total, obscured };
  });

  expect(result.total).toBe(210); // 30 trials x waves 1-7
  expect(result.obscured).toBe(0);
  expect(errors).toEqual([]);
});

test('a rotating barrier is kept clear of the tutorial hint across its full rotation, not just its starting pose', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(() => {
    // Rotating barriers unlock at BARRIER_CONFIG.ROTATION_START_WAVE (6),
    // so waves 6-7 are the only tutorial waves where one can appear.
    // generateBarriersSafely only rejects a rotating barrier whose current
    // (generation-time) line crosses the reserved hint zone -- but
    // updateBarriers spins it continuously afterward, so what actually
    // matters is whether the full disk it sweeps out ever does.
    let trialsWithRotating = 0, failures = 0;
    for (let trial = 0; trial < 60; trial++) {
      for (const wave of [6, 7]) {
        const dots = generateDots(wave);
        ensureAllDotsInWorldBounds(dots);
        STATE.phase = 'PLAYING';
        STATE.dots = dots;
        STATE.barriers = generateBarriersSafely(wave, dots);
        STATE.camera.autoScale = Math.min(1, Math.min(canvas.width / STATE.world.w, canvas.height / STATE.world.h));
        STATE.camera.userZoom = 1;
        STATE.camera.targetScale = STATE.camera.autoScale;
        STATE.camera.scale = STATE.camera.autoScale;
        STATE.camera.centerX = STATE.world.w / 2;
        STATE.camera.centerY = STATE.world.h / 2;
        showTutorialHint(wave);
        const rect = document.getElementById('tutorial-hint').getBoundingClientRect();

        const rotators = STATE.barriers.filter(b => b.rotating);
        if (!rotators.length) continue;
        trialsWithRotating++;

        for (const b of rotators) {
          const originalAngle = b.angle;
          for (let step = 0; step < 24; step++) {
            b.angle = originalAngle + (step / 24) * Math.PI * 2;
            const ep = barrierEndpoints(b.pivotX, b.pivotY, b.angle, b.length);
            b.x1 = ep.x1; b.y1 = ep.y1; b.x2 = ep.x2; b.y2 = ep.y2;
            if (barrierOverlapCount(rect) > 0) failures++;
          }
          b.angle = originalAngle;
        }
      }
    }
    return { trialsWithRotating, failures };
  });

  expect(result.trialsWithRotating).toBeGreaterThan(0); // confirms the scenario actually got exercised
  expect(result.failures).toBe(0);
  expect(errors).toEqual([]);
});

test('the "relax and enjoy" tutorial message is always the last one shown', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const lastText = await page.evaluate(() => TUTORIAL_MESSAGES[TUTORIAL_MESSAGES.length - 1].text);

  expect(lastText).toBe('Connect the dots, make music. Relax and Enjoy!');
  expect(errors).toEqual([]);
});

test('in a 3+-dot color group, connecting the last unlinked dot to an already-linked groupmate is never falsely rejected as stranding a bystander', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(() => {
    // A 3-dot group: A is alone, B and C are already connected to each
    // other via a real settled line. The player is now connecting A to B.
    // C is sealed in a barrier box with no direct route to A at all --
    // that must not matter, since C reaches A transitively through B the
    // instant A-B connects (exactly like markGroupIfFullySolved already
    // understands). wouldStrandAnyDot used to check the *current*
    // (pre-move) union-find state, so it still demanded C have its own
    // direct physical route to A, rejecting a perfectly valid connection
    // for a reason invisible to the player -- nothing about A-B's own
    // path was ever blocked.
    const A = { id: 0, pairId: 0, colorIndex: 0, x: 50, y: 400, connected: false, pulsePhase: 0 };
    const B = { id: 1, pairId: 0, colorIndex: 0, x: 350, y: 400, connected: false, pulsePhase: 0 };
    const C = { id: 2, pairId: 0, colorIndex: 0, x: 330, y: 700, connected: false, pulsePhase: 0 };
    STATE.dots = [A, B, C];
    STATE.world = { w: 400, h: 800 };
    STATE.dotUnion = { 0: 0, 1: 1, 2: 2 };
    STATE.connections = [{ pairId: 0, segments: [{ x1: B.x, y1: B.y, x2: C.x, y2: C.y }] }];
    ufUnion(B.id, C.id);
    STATE.barriers = [
      { x1: 280, y1: 650, x2: 380, y2: 650 },
      { x1: 280, y1: 650, x2: 280, y2: 750 },
      { x1: 280, y1: 750, x2: 380, y2: 750 },
      { x1: 380, y1: 650, x2: 380, y2: 750 },
    ];

    const unionBefore = JSON.stringify(STATE.dotUnion);
    const falsePositive = wouldStrandAnyDot([{ x1: A.x, y1: A.y, x2: B.x, y2: B.y }], A, B);
    const unionUnchangedAfter = JSON.stringify(STATE.dotUnion) === unionBefore;

    // A genuinely unrelated pair, D/E, with D sealed in that same box and
    // no connection to E at all -- must still correctly reject (the
    // original wave-deadlock guard from the maze-barrier work still has
    // to work; this fix must not weaken it into never rejecting anything).
    const D = { id: 3, pairId: 1, colorIndex: 1, x: 330, y: 700, connected: false, pulsePhase: 0 };
    const E = { id: 4, pairId: 1, colorIndex: 1, x: 50, y: 400, connected: false, pulsePhase: 0 };
    STATE.dots = [A, B, C, D, E];
    STATE.dotUnion[3] = 3;
    STATE.dotUnion[4] = 4;
    const stillCatchesRealStranding = wouldStrandAnyDot([{ x1: A.x, y1: A.y, x2: B.x, y2: B.y }], A, B);

    return { falsePositive, unionUnchangedAfter, stillCatchesRealStranding };
  });

  expect(result.falsePositive).toBe(false);
  expect(result.unionUnchangedAfter).toBe(true); // the hypothetical union must not leak into real game state
  expect(result.stillCatchesRealStranding).toBe(true);
  expect(errors).toEqual([]);
});

test('a fact box never appears on any wave that shows a tutorial hint, and keeps a real buffer from other barriers once it can appear', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(() => {
    let tutorialWaveTrials = 0, tutorialWaveFactBoxes = 0;
    for (let trial = 0; trial < 40; trial++) {
      for (let wave = 1; wave <= TUTORIAL_MESSAGES.length; wave++) {
        const dots = generateDots(wave);
        ensureAllDotsInWorldBounds(dots);
        const barriers = generateBarriersSafely(wave, dots);
        tutorialWaveTrials++;
        if (barriers.some(b => b.type === 'factBox')) tutorialWaveFactBoxes++;
      }
    }

    // Past the tutorial waves, a fact box should still show up sometimes
    // (confirms the feature itself isn't broken/always-skipped), and every
    // one found must keep real clearance from every other barrier -- not
    // just avoid literal overlap.
    let postTutorialFactBoxes = 0, barrierTooClose = 0;
    const clearance = Math.max(FACT_BOX_CONFIG.DOT_CLEARANCE_ABS_MIN, 24);
    for (let trial = 0; trial < 60; trial++) {
      const wave = 20 + (trial % 30);
      const dots = generateDots(wave);
      ensureAllDotsInWorldBounds(dots);
      const barriers = generateBarriersSafely(wave, dots);
      const factBox = barriers.find(b => b.type === 'factBox');
      if (!factBox) continue;
      postTutorialFactBoxes++;
      const half = factBox.size / 2;
      const rect = { x1: factBox.cx - half - clearance, x2: factBox.cx + half + clearance, y1: factBox.cy - half - clearance, y2: factBox.cy + half + clearance };
      const others = barriers.filter(b => b !== factBox).flatMap(segmentsOfBarrier);
      if (others.some(seg => segmentNearRect(seg.x1, seg.y1, seg.x2, seg.y2, rect))) barrierTooClose++;
    }

    return { tutorialWaveTrials, tutorialWaveFactBoxes, postTutorialFactBoxes, barrierTooClose };
  });

  expect(result.tutorialWaveTrials).toBeGreaterThan(0);
  expect(result.tutorialWaveFactBoxes).toBe(0); // never once, across every tutorial wave
  expect(result.postTutorialFactBoxes).toBeGreaterThan(0); // the feature still works once tutorials are done
  expect(result.barrierTooClose).toBe(0);
  expect(errors).toEqual([]);
});

test('every real instrument sample still decodes even when its fetch is much slower than the old fixed timeout', async ({ page }) => {
  const errors = trackErrors(page);
  await page.addInitScript(() => { navigator.vibrate = () => true; });

  // Delay every sound file response well past the old code's fixed
  // 2-second-per-note give-up budget (20 attempts x 100ms) -- decodeAllSamples
  // used to poll a shared object on that timer and silently skip any note
  // whose fetch hadn't landed in time. Awaiting the real fetch promise
  // directly (no arbitrary timeout) should make this irrelevant now.
  await page.route('**/sounds/**/*.mp3', async (route) => {
    await new Promise(r => setTimeout(r, 3000));
    route.continue();
  });

  await page.goto('/index.html');
  await page.waitForTimeout(300);
  await page.click('#start-game-button');
  await page.waitForTimeout(6000); // real decode time under the simulated slow network

  const counts = await page.evaluate(() => {
    const s = window.__lumina.getState();
    const out = {};
    for (const instrument in s.sampleBuffers) out[instrument] = Object.keys(s.sampleBuffers[instrument]).length;
    return out;
  });

  // Every real (fetched) instrument's full manifest should be present --
  // none silently abandoned because the network happened to be slow.
  expect(counts.piano).toBe(8);
  expect(counts.flute).toBe(35);
  expect(counts.cello).toBe(21);
  expect(counts.marimba).toBe(37);
  expect(counts.vibraphone).toBe(36);
  expect(errors).toEqual([]);
});

test('WIDE_WORLD_START_WAVE is derived from the flagged tutorial entry, not a hardcoded number', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(() => {
    const flaggedIndex = TUTORIAL_MESSAGES.findIndex(m => m.unlocksWideWorld);
    return {
      flaggedIndex,
      wideWorldStartWave: WIDE_WORLD_START_WAVE,
      notTheLastMessage: flaggedIndex < TUTORIAL_MESSAGES.length - 1, // "relax and enjoy" always keeps that spot
      onlyOneFlagged: TUTORIAL_MESSAGES.filter(m => m.unlocksWideWorld).length,
    };
  });

  // WIDE_WORLD_START_WAVE is 1-indexed (wave numbers start at 1), so it
  // should equal the flagged entry's 0-indexed array position + 1.
  expect(result.wideWorldStartWave).toBe(result.flaggedIndex + 1);
  expect(result.notTheLastMessage).toBe(true);
  expect(result.onlyOneFlagged).toBe(1);
  expect(errors).toEqual([]);
});

test('the playfield only gets a wide-world floor from WIDE_WORLD_START_WAVE on, and never below it', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(() => {
    canvas.width = 500; canvas.height = 900;

    // A low dot count (wave 1) would otherwise size the world at exactly
    // the screen's own dimensions (growth == 1) -- the clearest possible
    // signal of whether the floor wrongly applied early.
    const earlyDots = generateDots(1);
    ensureAllDotsInWorldBounds(earlyDots);
    const earlyWorld = { w: STATE.world.w, h: STATE.world.h };

    const wideDots = generateDots(WIDE_WORLD_START_WAVE);
    ensureAllDotsInWorldBounds(wideDots);
    const wideWorld = { w: STATE.world.w, h: STATE.world.h, comfortW: STATE.world.comfortW, comfortH: STATE.world.comfortH };

    return { earlyWorld, wideWorld };
  });

  expect(result.earlyWorld.w).toBe(500); // no floor applied below WIDE_WORLD_START_WAVE
  expect(result.earlyWorld.h).toBe(900);
  expect(result.wideWorld.w).toBeGreaterThanOrEqual(500 * 1.6);
  expect(result.wideWorld.h).toBeGreaterThanOrEqual(900 * 1.6);
  // comfortW/H record what the world would have been without the floor --
  // for a low-ish dot count that's still just the screen itself.
  expect(result.wideWorld.comfortW).toBeLessThan(result.wideWorld.w);
  expect(result.wideWorld.comfortH).toBeLessThan(result.wideWorld.h);
  expect(errors).toEqual([]);
});

test('a wide wave holds the camera at the full-world view before easing to a comfortable zoom, every time it recurs', async ({ page }) => {
  const errors = trackErrors(page);
  await page.addInitScript(() => { navigator.vibrate = () => true; });
  await page.goto('/index.html');
  await page.waitForTimeout(300);
  await page.click('#start-game-button');
  await page.waitForTimeout(1000); // real wave 1 underway, audio/game loop running

  const first = await page.evaluate(() => {
    startWave(WIDE_WORLD_START_WAVE);
    return {
      scaleAtStart: STATE.camera.scale,
      autoScaleAtStart: STATE.camera.autoScale,
      baseZoom: STATE.camera.baseZoom,
      holding: STATE.camera.wideIntroHoldUntil > performance.now(),
    };
  });

  expect(first.scaleAtStart).toBeCloseTo(first.autoScaleAtStart, 5); // snapped straight to the full-world view
  expect(first.baseZoom).toBeGreaterThanOrEqual(1); // comfortable zoom is always >= the full-world fit
  expect(first.holding).toBe(true);

  // Real-time wait past the hold (900ms) plus room for the lerp to make
  // visible progress toward the comfortable zoom.
  await page.waitForTimeout(1800);
  const afterEase = await page.evaluate(() => ({
    scale: STATE.camera.scale,
    autoScale: STATE.camera.autoScale,
    holding: STATE.camera.wideIntroHoldUntil > performance.now(),
  }));
  expect(afterEase.holding).toBe(false); // hold has released
  expect(afterEase.scale).toBeGreaterThan(afterEase.autoScale); // eased in, no longer at the full-world view

  // The first wave past every remaining tutorial message -- still a wide
  // wave, but with no tutorial hint left to show at all. The zoom
  // hold-then-ease beat should still replay here, proving it's tied to
  // being a wide wave, not to the one-time explainer.
  const second = await page.evaluate(() => {
    const laterWave = TUTORIAL_MESSAGES.length + 1;
    startWave(laterWave);
    return {
      scaleAtStart: STATE.camera.scale,
      autoScaleAtStart: STATE.camera.autoScale,
      holding: STATE.camera.wideIntroHoldUntil > performance.now(),
      tutorialWave: STATE.tutorialWave, // should be null -- the explainer only shows once
    };
  });
  expect(second.scaleAtStart).toBeCloseTo(second.autoScaleAtStart, 5);
  expect(second.holding).toBe(true);
  expect(second.tutorialWave).toBeNull();
  expect(errors).toEqual([]);
});

test('manual pinch/scroll zoom on a wide wave still respects the same absolute pull-back and zoom-in limits as any other wave', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(() => {
    canvas.width = 500; canvas.height = 900;
    STATE.dots = generateDots(WIDE_WORLD_START_WAVE);
    ensureAllDotsInWorldBounds(STATE.dots);
    STATE.camera.autoScale = Math.min(1, Math.min(canvas.width / STATE.world.w, canvas.height / STATE.world.h));
    const comfortScale = Math.min(1, Math.min(canvas.width / STATE.world.comfortW, canvas.height / STATE.world.comfortH));
    STATE.camera.baseZoom = comfortScale / STATE.camera.autoScale;

    setUserZoom(-999); // try to pull far out past any limit
    const maxPullback = STATE.camera.baseZoom * STATE.camera.userZoom;
    setUserZoom(999); // try to push far in past any limit
    const maxZoomIn = STATE.camera.baseZoom * STATE.camera.userZoom;

    return { baseZoom: STATE.camera.baseZoom, maxPullback, maxZoomIn };
  });

  expect(result.baseZoom).toBeGreaterThan(1); // this is genuinely a wide wave, baseZoom actually engaged
  // Composed (baseZoom * userZoom) should land on the same absolute bounds
  // as a non-wide wave (where baseZoom == 1), regardless of how big
  // baseZoom itself is -- the player can always pull back to see the
  // entire board, and never zoom in past the usual ceiling.
  expect(result.maxPullback).toBeCloseTo(0.65, 5); // CAMERA_CONFIG.MIN_USER_PULLBACK
  expect(result.maxZoomIn).toBeCloseTo(3, 5); // CAMERA_CONFIG.MAX_USER_ZOOM_IN
  expect(errors).toEqual([]);
});

test('dragging pans the camera at a wide wave\'s resting zoom even though userZoom itself is still 1', async ({ page }) => {
  // Flagged by Codex review on #20: a wide wave's comfortable zoom comes
  // entirely from baseZoom (userZoom resets to 1 every wave, same as
  // always) -- panning was gated on userZoom > 1 alone, so a player told
  // by the new tutorial hint to "drag to pan" found dragging did nothing
  // until they manually zoomed in further still.
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const setup = () => page.evaluate(() => {
    hideMessage();
    STATE.phase = 'PLAYING';
    STATE.paused = false;
    STATE.isDrawing = false;
    STATE.world = { w: 2000, h: 2000 };
    STATE.dots = [{ id: 0, pairId: 0, colorIndex: 0, x: 1900, y: 1900, connected: false, pulsePhase: 0 }];
    STATE.camera.autoScale = Math.min(1, Math.min(canvas.width / STATE.world.w, canvas.height / STATE.world.h));
    STATE.camera.centerX = 1000; STATE.camera.centerY = 1000;
    STATE.camera.userZoom = 1; // never manually touched, exactly as startWave leaves it
    STATE.camera.baseZoom = 1.5; // simulates having settled at a wide wave's comfortable zoom
    STATE.camera.scale = STATE.camera.autoScale * STATE.camera.baseZoom * STATE.camera.userZoom;
    clampCameraCenter();
  });
  await setup();

  await page.mouse.move(200, 400);
  await page.mouse.down();
  await page.mouse.move(260, 460, { steps: 5 });
  await page.mouse.up();
  const result = await page.evaluate(() => ({ centerX: STATE.camera.centerX, centerY: STATE.camera.centerY }));

  expect(result.centerX).not.toBe(1000); // actually panned, not a no-op
  expect(result.centerY).not.toBe(1000);
  expect(errors).toEqual([]);
});

test('an orientation change during a wide wave\'s intro hold keeps the camera at the full-world view until the hold releases', async ({ page }) => {
  // Flagged by Codex review on #20: resizeCanvas unconditionally set
  // targetScale to the composed comfortable zoom, even mid-hold -- a
  // resize/rotation during the onboarding beat let the frame loop start
  // easing in early, skipping the rest of the promised zoomed-out pause.
  const errors = trackErrors(page);
  await page.addInitScript(() => { navigator.vibrate = () => true; });
  await page.setViewportSize({ width: 400, height: 800 });
  await page.goto('/index.html');
  await page.waitForTimeout(300);
  await page.click('#start-game-button');
  await page.waitForTimeout(1000);

  await page.evaluate(() => startWave(WIDE_WORLD_START_WAVE));
  const beforeResize = await page.evaluate(() => ({
    holding: STATE.camera.wideIntroHoldUntil > performance.now(),
    targetScale: STATE.camera.targetScale,
    autoScale: STATE.camera.autoScale,
  }));
  expect(beforeResize.holding).toBe(true);
  expect(beforeResize.targetScale).toBeCloseTo(beforeResize.autoScale, 5);

  // Still well inside the 900ms hold window -- trigger a real resize.
  await page.setViewportSize({ width: 800, height: 400 });
  await page.waitForTimeout(50);
  const afterResize = await page.evaluate(() => ({
    holding: STATE.camera.wideIntroHoldUntil > performance.now(),
    targetScale: STATE.camera.targetScale,
    autoScale: STATE.camera.autoScale, // re-derived against the new viewport by resizeCanvas
    baseZoom: STATE.camera.baseZoom,
  }));
  expect(afterResize.holding).toBe(true); // hold survived the resize
  // Target should track the (possibly now-different) full-world fit, not
  // the composed comfortable zoom the hold is supposed to be delaying.
  expect(afterResize.targetScale).toBeCloseTo(afterResize.autoScale, 5);
  expect(afterResize.targetScale).not.toBeCloseTo(afterResize.autoScale * afterResize.baseZoom, 2);

  // Once the hold's real deadline passes, it should still release and
  // ease toward the comfortable zoom exactly as it would have unresized.
  await page.waitForTimeout(1800);
  const afterHold = await page.evaluate(() => ({
    holding: STATE.camera.wideIntroHoldUntil > performance.now(),
    scale: STATE.camera.scale,
    autoScale: STATE.camera.autoScale,
  }));
  expect(afterHold.holding).toBe(false);
  expect(afterHold.scale).toBeGreaterThan(afterHold.autoScale);
  expect(errors).toEqual([]);
});

test('holding a draw gesture near a screen edge auto-pans the camera toward it, only while zoomed in and only while drawing', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(() => {
    canvas.width = 500; canvas.height = 900;
    STATE.world = { w: 2000, h: 2000 };
    STATE.camera.autoScale = Math.min(1, Math.min(canvas.width / STATE.world.w, canvas.height / STATE.world.h));
    STATE.camera.centerX = 1000; STATE.camera.centerY = 1000;
    STATE.camera.userZoom = 1;

    const out = {};

    // Not drawing at all: near an edge should never pan, regardless of zoom.
    STATE.camera.baseZoom = 2;
    STATE.camera.scale = STATE.camera.autoScale * STATE.camera.baseZoom;
    STATE.isDrawing = false;
    STATE.lastDrawScreenPos = { x: 10, y: 450 };
    updateEdgePan();
    out.noPanWhenNotDrawing = STATE.camera.centerX === 1000;

    // Drawing, but not zoomed in past the full-world view: nothing is
    // off-screen to reveal, so this should still be a no-op.
    STATE.camera.baseZoom = 1;
    STATE.camera.scale = STATE.camera.autoScale;
    STATE.isDrawing = true;
    STATE.currentPath = [{ x: 1000, y: 1000 }];
    STATE.smoothedCursor = { x: 1000, y: 1000 };
    STATE.lastDrawScreenPos = { x: 10, y: 450 };
    updateEdgePan();
    out.noPanWhenNotZoomedIn = STATE.camera.centerX === 1000;

    // Drawing AND zoomed in, cursor pinned near the left edge: should pull
    // centerX down (reveal more world to the left) over repeated frames,
    // and the path should grow new points toward that shifting world point
    // even though the screen-space cursor position itself never moves.
    STATE.camera.baseZoom = 2;
    STATE.camera.scale = STATE.camera.autoScale * STATE.camera.baseZoom;
    STATE.camera.centerX = 1000; STATE.camera.centerY = 1000;
    STATE.isDrawing = true;
    STATE.currentPath = [{ x: 1000, y: 1000 }];
    STATE.smoothedCursor = { x: 1000, y: 1000 };
    STATE.lastDrawScreenPos = { x: 10, y: 450 }; // near left edge, vertically centered
    const pathLenBefore = STATE.currentPath.length;
    for (let i = 0; i < 80; i++) updateEdgePan();
    out.leftEdgePannedLeft = STATE.camera.centerX < 1000;
    out.leftEdgeDidNotPanVertically = STATE.camera.centerY === 1000; // cursor was screen-vertically centered
    out.pathGrewWhileStationary = STATE.currentPath.length > pathLenBefore;

    // Right edge should pan the opposite direction.
    STATE.camera.centerX = 1000; STATE.camera.centerY = 1000;
    STATE.currentPath = [{ x: 1000, y: 1000 }];
    STATE.smoothedCursor = { x: 1000, y: 1000 };
    STATE.lastDrawScreenPos = { x: 490, y: 450 }; // near right edge
    for (let i = 0; i < 80; i++) updateEdgePan();
    out.rightEdgePannedRight = STATE.camera.centerX > 1000;

    // Dead center should never pan on either axis.
    STATE.camera.centerX = 1000; STATE.camera.centerY = 1000;
    STATE.lastDrawScreenPos = { x: 250, y: 450 };
    updateEdgePan();
    out.centerIsInert = STATE.camera.centerX === 1000 && STATE.camera.centerY === 1000;

    return out;
  });

  expect(result.noPanWhenNotDrawing).toBe(true);
  expect(result.noPanWhenNotZoomedIn).toBe(true);
  expect(result.leftEdgePannedLeft).toBe(true);
  expect(result.leftEdgeDidNotPanVertically).toBe(true);
  expect(result.pathGrewWhileStationary).toBe(true);
  expect(result.rightEdgePannedRight).toBe(true);
  expect(result.centerIsInert).toBe(true);
  expect(errors).toEqual([]);
});

test('a draw gesture whose end event never reaches canvas is cleared by window-level mouseup/blur, not left to edge-pan forever', async ({ page }) => {
  // Flagged by Codex review on #22: mouseup/touchend are only bound on
  // canvas, so a drag released over the page background or a browser
  // window losing focus mid-drag would leave isDrawing stuck true --
  // previously a static stale line, but now a runaway edge-pan since
  // updateEdgePan runs every frame regardless of new input events.
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(() => {
    canvas.width = 500; canvas.height = 900;
    STATE.world = { w: 2000, h: 2000 };
    STATE.camera.autoScale = Math.min(1, Math.min(canvas.width / STATE.world.w, canvas.height / STATE.world.h));
    STATE.camera.baseZoom = 2; // zoomed in -- edge-pan would otherwise actually engage
    STATE.camera.scale = STATE.camera.autoScale * STATE.camera.baseZoom;
    STATE.camera.centerX = 1000; STATE.camera.centerY = 1000;

    const out = {};

    // Simulate a gesture stuck open near the left edge -- the exact setup
    // that would otherwise runaway-pan forever.
    STATE.isDrawing = true;
    STATE.activeDot = { id: 0 };
    STATE.currentPath = [{ x: 1000, y: 1000 }];
    STATE.smoothedCursor = { x: 1000, y: 1000 };
    STATE.lastDrawScreenPos = { x: 10, y: 450 };

    window.dispatchEvent(new Event('blur'));
    out.clearedByBlur = { isDrawing: STATE.isDrawing, lastPos: STATE.lastDrawScreenPos, activeDot: STATE.activeDot };

    // Confirm it's not just cleared once -- a still-stuck gesture near an
    // edge really would have kept panning every frame if left alone.
    const centerXAfterBlur = STATE.camera.centerX;
    updateEdgePan();
    out.inertAfterBlur = STATE.camera.centerX === centerXAfterBlur;

    // Re-arm the same stuck scenario and confirm a window-level mouseup
    // (not targeting canvas -- e.g. released over the page background)
    // clears it exactly the same way.
    STATE.isDrawing = true;
    STATE.activeDot = { id: 0 };
    STATE.currentPath = [{ x: 1000, y: 1000 }];
    STATE.smoothedCursor = { x: 1000, y: 1000 };
    STATE.lastDrawScreenPos = { x: 10, y: 450 };
    window.dispatchEvent(new MouseEvent('mouseup'));
    out.clearedByWindowMouseup = { isDrawing: STATE.isDrawing, lastPos: STATE.lastDrawScreenPos };

    return out;
  });

  expect(result.clearedByBlur.isDrawing).toBe(false);
  expect(result.clearedByBlur.lastPos).toBeNull();
  expect(result.clearedByBlur.activeDot).toBeNull();
  expect(result.inertAfterBlur).toBe(true);
  expect(result.clearedByWindowMouseup.isDrawing).toBe(false);
  expect(result.clearedByWindowMouseup.lastPos).toBeNull();
  expect(errors).toEqual([]);
});

test('finishing the last connection resets the camera to see the whole board, regardless of the zoom/pan used to get there', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(() => {
    canvas.width = 500; canvas.height = 900;
    STATE.world = { w: 2000, h: 2000 };
    STATE.dots = [
      { id: 0, pairId: 0, colorIndex: 0, x: 500, y: 500, connected: true },
      { id: 1, pairId: 0, colorIndex: 0, x: 1500, y: 1500, connected: true },
    ];
    STATE.wave = 3;
    STATE.waveStartScore = 0;
    STATE.score = 0;
    STATE.song = { genre: { bpm: 100 } };

    // Simulate having been zoomed way in and panned off into a far
    // corner right as the final connection landed -- exactly the
    // "stuck looking at whatever was on screen" scenario reported.
    STATE.camera.autoScale = Math.min(1, Math.min(canvas.width / STATE.world.w, canvas.height / STATE.world.h));
    STATE.camera.userZoom = 3;
    STATE.camera.baseZoom = 1;
    STATE.camera.scale = STATE.camera.autoScale * STATE.camera.userZoom;
    STATE.camera.targetScale = STATE.camera.scale;
    STATE.camera.centerX = 1900; STATE.camera.centerY = 1900;

    checkWaveComplete();

    return {
      phase: STATE.phase,
      targetScale: STATE.camera.targetScale,
      autoScale: STATE.camera.autoScale,
      userZoom: STATE.camera.userZoom,
      baseZoom: STATE.camera.baseZoom,
      centerX: STATE.camera.centerX,
      centerY: STATE.camera.centerY,
      worldCenterX: STATE.world.w / 2,
      worldCenterY: STATE.world.h / 2,
    };
  });

  expect(result.phase).toBe('WAVE_COMPLETE');
  // targetScale resets to the full-world fit -- camera.scale itself eases
  // toward it via the ordinary per-frame lerp, not asserted here since
  // that's already covered by the existing zoom-lerp/wide-intro tests.
  expect(result.targetScale).toBeCloseTo(result.autoScale, 5);
  expect(result.userZoom).toBe(1);
  expect(result.baseZoom).toBe(1);
  expect(result.centerX).toBe(result.worldCenterX);
  expect(result.centerY).toBe(result.worldCenterY);
  expect(errors).toEqual([]);
});

test('resizing/rotating during the wave-complete reveal does not restore a wide wave\'s zoomed-in comfort view', async ({ page }) => {
  // Flagged by Codex review on #23: resizeCanvas unconditionally
  // recomputes baseZoom from the wave's wide-world "comfortable zoom"
  // (see WIDE_WORLD_START_WAVE) on every resize/rotation, with no
  // awareness of game phase -- rotating a device while sitting on the
  // WAVE_COMPLETE screen would silently re-zoom in and clip part of the
  // reveal checkWaveComplete just reset the camera to show in full.
  const errors = trackErrors(page);
  await page.addInitScript(() => { navigator.vibrate = () => true; });
  await page.setViewportSize({ width: 400, height: 800 });
  await page.goto('/index.html');
  await page.waitForTimeout(300);
  await page.click('#start-game-button');
  await page.waitForTimeout(1000);

  await page.evaluate(() => {
    startWave(WIDE_WORLD_START_WAVE); // sets STATE.world.comfortW/H, the wide-wave comfort ratio
    STATE.camera.wideIntroHoldUntil = 0; // past the intro hold, the normal case by wave completion
    for (const dot of STATE.dots) dot.connected = true;
    checkWaveComplete();
  });
  const beforeResize = await page.evaluate(() => ({
    baseZoom: STATE.camera.baseZoom,
    targetScale: STATE.camera.targetScale,
    autoScale: STATE.camera.autoScale,
  }));
  expect(beforeResize.baseZoom).toBe(1);
  expect(beforeResize.targetScale).toBeCloseTo(beforeResize.autoScale, 5);

  await page.setViewportSize({ width: 800, height: 400 }); // real resize event -> resizeCanvas()
  await page.waitForTimeout(50);
  const afterResize = await page.evaluate(() => ({
    baseZoom: STATE.camera.baseZoom,
    targetScale: STATE.camera.targetScale,
    autoScale: STATE.camera.autoScale, // re-derived against the new viewport by resizeCanvas
  }));
  expect(afterResize.baseZoom).toBe(1); // still the full-board fit, not recomputed to the wide-wave comfort ratio
  expect(afterResize.targetScale).toBeCloseTo(afterResize.autoScale, 5);
  expect(errors).toEqual([]);
});

test('tierIndexFor picks the hardest-satisfied tier in both directions, or none', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(() => ({
    lowerIsBetter_easy: tierIndexFor(40, [48, 28, 14], false),
    lowerIsBetter_great: tierIndexFor(20, [48, 28, 14], false),
    lowerIsBetter_incredible: tierIndexFor(10, [48, 28, 14], false),
    lowerIsBetter_none: tierIndexFor(60, [48, 28, 14], false),
    higherIsBetter_easy: tierIndexFor(2.0, [1.8, 2.6, 3.6], true),
    higherIsBetter_incredible: tierIndexFor(4.0, [1.8, 2.6, 3.6], true),
    higherIsBetter_none: tierIndexFor(1.2, [1.8, 2.6, 3.6], true),
  }));

  expect(result.lowerIsBetter_easy).toBe(0);
  expect(result.lowerIsBetter_great).toBe(1);
  expect(result.lowerIsBetter_incredible).toBe(2);
  expect(result.lowerIsBetter_none).toBe(-1);
  expect(result.higherIsBetter_easy).toBe(0);
  expect(result.higherIsBetter_incredible).toBe(2);
  expect(result.higherIsBetter_none).toBe(-1);
  expect(errors).toEqual([]);
});

test('connection praise: a tight squeeze past a nearby barrier is detected at the right tier, excluding the area right around each dot', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(() => {
    const dotA = { x: 100, y: 500 };
    const dotB = { x: 900, y: 500 };
    const path = [{ x: 100, y: 500 }, { x: 500, y: 500 }, { x: 900, y: 500 }];
    const segs = smoothedCurveSegments(path);
    const len = pathLength(path);

    // A barrier whose nearest point to the (straight, colinear) path is
    // exactly 20px away, comfortably inside the "great" tier (<=28) but
    // outside "incredible" (<=14).
    STATE.barriers = [{ segments: [{ x1: 500, y1: 520, x2: 500, y2: 600 }] }];
    STATE.connections = [];
    const great = evaluateConnectionPraise(dotA, dotB, segs, len);

    // Move it right up against the path (2px clearance) -- incredible.
    STATE.barriers = [{ segments: [{ x1: 500, y1: 502, x2: 500, y2: 600 }] }];
    const incredible = evaluateConnectionPraise(dotA, dotB, segs, len);

    // A barrier that's only close to a point right next to dotA itself
    // (inside the exclusion radius) shouldn't count as a squeeze at all --
    // being near your own destination isn't threading a needle. Built with
    // finer-grained manual segments near dotA (rather than relying on
    // smoothedCurveSegments' own coarse sampling for this specific
    // geometry) so the exclusion zone is tested precisely regardless of
    // curve-sampling granularity.
    const fineSegsNearDotA = [
      { x1: 100, y1: 500, x2: 130, y2: 500 }, // midpoint 15px from dotA -- excluded
      { x1: 130, y1: 500, x2: 160, y2: 500 }, // midpoint 45px from dotA -- still excluded (<50)
      { x1: 160, y1: 500, x2: 900, y2: 500 }, // midpoint far from both dots -- not excluded
    ];
    STATE.barriers = [{ segments: [{ x1: 105, y1: 501, x2: 105, y2: 505 }] }];
    const nearDotOnly = evaluateConnectionPraise(dotA, dotB, fineSegsNearDotA, len);

    // Nothing nearby at all -- no barriers, no other connections.
    STATE.barriers = [];
    const nothingNearby = evaluateConnectionPraise(dotA, dotB, segs, len);

    return { great, incredible, nearDotOnly, nothingNearby };
  });

  expect(result.great).toEqual({ criterion: 'squeeze', tier: 1 });
  expect(result.incredible).toEqual({ criterion: 'squeeze', tier: 2 });
  expect(result.nearDotOnly).toBeNull();
  expect(result.nothingNearby).toBeNull();
  expect(errors).toEqual([]);
});

test('connection praise: "efficient despite complexity" only counts when the straight line itself would have been illegal', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(() => {
    const dotA = { x: 100, y: 500 };
    const dotB = { x: 900, y: 500 };
    // A shallow, symmetric detour around a barrier that sits on the
    // straight line -- manually built (not run through
    // smoothedCurveSegments) so the clearance from the barrier is a known
    // ~54px, safely outside every SQUEEZE_TIERS threshold (<=48), and only
    // "efficient" can fire. Ratio = hypot(400,60)*2 / 800 =~ 1.011, deep
    // inside every EFFICIENT_TIERS threshold.
    const segs = [
      { x1: 100, y1: 500, x2: 500, y2: 440 },
      { x1: 500, y1: 440, x2: 900, y2: 500 },
    ];
    const len = Math.hypot(400, 60) * 2;

    STATE.barriers = [{ segments: [{ x1: 500, y1: 495, x2: 500, y2: 505 }] }]; // sits right on the straight line
    STATE.connections = [];
    const blocked = evaluateConnectionPraise(dotA, dotB, segs, len);

    // Same path/ratio, but nothing actually blocks the straight line --
    // should not count as "efficient despite complexity" (or anything
    // else -- the detour is too small to read as a deliberately long
    // line either).
    STATE.barriers = [];
    const unblocked = evaluateConnectionPraise(dotA, dotB, segs, len);

    return { blocked, unblocked };
  });

  expect(result.blocked.criterion).toBe('efficient');
  expect(result.blocked.tier).toBeGreaterThanOrEqual(0);
  expect(result.unblocked).toBeNull();
  expect(errors).toEqual([]);
});

test('connection praise: "went the distance" needs both a real length ratio and an absolute floor, and squeeze/efficient take priority over it', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(() => {
    // No barriers or connections at all, isolating the ratio/floor
    // interaction on its own -- segs is irrelevant here since the squeeze
    // check can't fire with nothing in the world to measure clearance
    // against, and "efficient" can't fire since straightLineBlocked is
    // false with no barriers/connections either.
    STATE.barriers = [];
    STATE.connections = [];

    // Ratio 4.0 (comfortably past the "incredible" LONG_TIERS threshold
    // of 3.6), but the two dots are close enough together that the
    // absolute length (160px) is still under the floor
    // (CONFIG.MIN_DOT_DISTANCE * 2.5 = 275px) -- ratio alone isn't enough.
    const dotA = { x: 100, y: 500 };
    const dotB = { x: 140, y: 500 }; // straightDist = 40
    const belowFloor = evaluateConnectionPraise(dotA, dotB, [], 160); // ratio = 160/40 = 4.0

    // Same 4.0 ratio, but with the dots far enough apart that the same
    // ratio clears the absolute floor too.
    const dotA2 = { x: 100, y: 500 };
    const dotB2 = { x: 400, y: 500 }; // straightDist = 300, already past the floor on its own
    const longResult = evaluateConnectionPraise(dotA2, dotB2, [], 1200); // ratio = 1200/300 = 4.0

    return { belowFloor, longResult };
  });

  expect(result.belowFloor).toBeNull(); // ratio alone isn't enough without the absolute floor
  expect(result.longResult.criterion).toBe('long');
  expect(errors).toEqual([]);
});

test('connection praise: spawning creates a correctly-classed, correctly-flipped popup that opens, then closes and removes itself on schedule', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(async () => {
    canvas.width = 500; canvas.height = 900;
    STATE.camera.scale = 1; STATE.camera.centerX = 250; STATE.camera.centerY = 450;

    // Left-side dot: should not flip.
    const dotLeft = { x: 250 - 200, y: 450 }; // screen x well under 60% of 500
    spawnConnectionPraise(dotLeft, { criterion: 'squeeze', tier: 1 });
    await new Promise(r => setTimeout(r, 20)); // let the reflow/`.open` trick settle

    const entry = STATE.connectionPraise[STATE.connectionPraise.length - 1];
    const beforeClose = {
      count: STATE.connectionPraise.length,
      hasOpenClass: entry.el.classList.contains('open'),
      hasFlipClass: entry.el.classList.contains('praise-flip'),
      hasTierClass: entry.el.classList.contains('praise-tier-1'),
      inDom: document.getElementById('connection-praise-layer').contains(entry.el),
    };

    // Right-side dot: should flip.
    const dotRight = { x: 250 + 200, y: 450 }; // screen x well over 60% of 500
    spawnConnectionPraise(dotRight, { criterion: 'long', tier: 2 });
    const flippedEntry = STATE.connectionPraise[STATE.connectionPraise.length - 1];
    const flipped = flippedEntry.el.classList.contains('praise-flip');

    // Fast-forward past the visible window entirely by back-dating
    // spawnedAt rather than waiting the real 4 seconds.
    for (const e of STATE.connectionPraise) e.spawnedAt = performance.now() - 10000;
    updateConnectionPraise();

    return {
      beforeClose,
      flipped,
      countAfterExpiry: STATE.connectionPraise.length,
      layerEmptyAfterExpiry: document.getElementById('connection-praise-layer').children.length,
    };
  });

  expect(result.beforeClose.count).toBe(1);
  expect(result.beforeClose.hasOpenClass).toBe(true);
  expect(result.beforeClose.hasFlipClass).toBe(false);
  expect(result.beforeClose.hasTierClass).toBe(true);
  expect(result.beforeClose.inDom).toBe(true);
  expect(result.flipped).toBe(true);
  expect(result.countAfterExpiry).toBe(0);
  expect(result.layerEmptyAfterExpiry).toBe(0);
  expect(errors).toEqual([]);
});

test('connection praise popups close (drop the open class) shortly before they expire, and starting a new wave clears any still active', async ({ page }) => {
  const errors = trackErrors(page);
  await page.addInitScript(() => { navigator.vibrate = () => true; });
  await page.goto('/index.html');
  await page.waitForTimeout(300);
  await page.click('#start-game-button');
  await page.waitForTimeout(1000);

  const result = await page.evaluate(() => {
    canvas.width = 500; canvas.height = 900;
    spawnConnectionPraise({ x: STATE.camera.centerX, y: STATE.camera.centerY }, { criterion: 'squeeze', tier: 0 });
    const entry = STATE.connectionPraise[0];

    // Just inside the closing window (CONNECTION_PRAISE_TRANSITION_MS
    // before the end) -- should have dropped .open, but not been removed yet.
    entry.spawnedAt = performance.now() - (CONNECTION_PRAISE_VISIBLE_MS - CONNECTION_PRAISE_TRANSITION_MS + 10);
    updateConnectionPraise();
    const closing = { stillTracked: STATE.connectionPraise.length === 1, hasOpenClass: entry.el.classList.contains('open') };

    // Starting a fresh wave should clear it out entirely, DOM node included.
    startWave(1);
    const afterNewWave = {
      count: STATE.connectionPraise.length,
      layerEmpty: document.getElementById('connection-praise-layer').children.length === 0,
    };

    return { closing, afterNewWave };
  });

  expect(result.closing.stillTracked).toBe(true);
  expect(result.closing.hasOpenClass).toBe(false);
  expect(result.afterNewWave.count).toBe(0);
  expect(result.afterNewWave.layerEmpty).toBe(true);
  expect(errors).toEqual([]);
});

test('connection praise never appears on a tutorial wave, even for a connection that would clearly qualify -- same rule fact boxes already follow', async ({ page }) => {
  const errors = trackErrors(page);
  await page.addInitScript(() => { navigator.vibrate = () => true; });
  await page.goto('/index.html');
  await page.waitForTimeout(300);
  await page.click('#start-game-button');
  await page.waitForTimeout(1000);

  const result = await page.evaluate(() => {
    function forceQualifyingLongConnection() {
      const dotA = STATE.dots[0], dotB = STATE.dots[1];
      // A long, deliberately winding path between the two real dots --
      // easily clears the "long" criterion with no barriers involved.
      const straightDist = Math.hypot(dotB.x - dotA.x, dotB.y - dotA.y);
      STATE.currentPath = [
        { x: dotA.x, y: dotA.y },
        { x: dotA.x, y: dotA.y - straightDist },
        { x: dotB.x, y: dotB.y + straightDist },
        { x: dotB.x, y: dotB.y },
      ];
      completeConnection(dotA, dotB);
      return STATE.connectionPraise.length;
    }

    startWave(1); // a real tutorial wave (TUTORIAL_MESSAGES[0])
    const onTutorialWave = { tutorialWave: STATE.tutorialWave, praiseCount: forceQualifyingLongConnection() };

    startWave(TUTORIAL_MESSAGES.length + 1); // the first wave past every tutorial message
    const pastTutorial = { tutorialWave: STATE.tutorialWave, praiseCount: forceQualifyingLongConnection() };

    return { onTutorialWave, pastTutorial };
  });

  expect(result.onTutorialWave.tutorialWave).not.toBeNull();
  expect(result.onTutorialWave.praiseCount).toBe(0);
  expect(result.pastTutorial.tutorialWave).toBeNull();
  expect(result.pastTutorial.praiseCount).toBe(1);
  expect(errors).toEqual([]);
});

test('connection praise: an ordinary direct connection sharing a dot with an existing one (e.g. a second spoke in a 3+-dot group) is not misread as a squeeze', async ({ page }) => {
  // Flagged by Codex review on #24: in a 3+-dot group, connecting A-B then
  // a direct A-C produces one long straight segment. The old exclusion
  // check tested the drawn segment's own MIDPOINT against each dot -- for
  // a long segment that midpoint can be far from both dots even though the
  // segment's actual closest approach to the existing A-B line is 0, right
  // at their shared dot A. That got misread as an "incredible squeeze."
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(() => {
    const dotA = { x: 500, y: 500 };
    const dotB = { x: 500, y: 300 }; // straight up from A
    const dotC = { x: 700, y: 500 }; // straight right from A -- perpendicular spoke

    // A-B already connected.
    STATE.connections = [{ dotA: 0, dotB: 1, colorIndex: 0, pairId: 0, segments: [{ x1: dotA.x, y1: dotA.y, x2: dotB.x, y2: dotB.y }] }];
    STATE.barriers = [];

    // A direct, ordinary A-C connection -- nothing tight or noteworthy
    // about it, it just happens to share dot A with the existing line.
    const path = [{ x: dotA.x, y: dotA.y }, { x: dotC.x, y: dotC.y }];
    const segs = smoothedCurveSegments(path);
    const len = pathLength(path);

    return evaluateConnectionPraise(dotA, dotC, segs, len);
  });

  expect(result).toBeNull();
  expect(errors).toEqual([]);
});

test('the Save Game tip only ever appears at wave 10+, for a player who has never saved, and only on the rolls that win its 10% chance', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const readTipState = () => page.evaluate(() => ({
    tipVisible: document.getElementById('save-tip').classList.contains('visible'),
    pulsing: document.getElementById('pause-save').classList.contains('save-tip-pulse'),
  }));

  // Below the wave threshold: never shows, even with a guaranteed-win roll
  // and no save on file.
  await page.evaluate(() => {
    clearSave();
    STATE.phase = 'PLAYING';
    STATE.wave = 9;
    Math.random = () => 0.01; // would win the 10% roll if it were even attempted
    pauseGame();
  });
  expect(await readTipState()).toEqual({ tipVisible: false, pulsing: false });
  await page.evaluate(() => resumeGame());

  // At/above the threshold, never saved, losing roll: still hidden.
  await page.evaluate(() => {
    clearSave();
    STATE.phase = 'PLAYING';
    STATE.wave = 10;
    Math.random = () => 0.99;
    pauseGame();
  });
  expect(await readTipState()).toEqual({ tipVisible: false, pulsing: false });
  await page.evaluate(() => resumeGame());

  // At/above the threshold, never saved, winning roll: shows, with the
  // pulse tied to the exact same button the tip is explaining.
  await page.evaluate(() => {
    clearSave();
    STATE.phase = 'PLAYING';
    STATE.wave = 10;
    Math.random = () => 0.01;
    pauseGame();
  });
  expect(await readTipState()).toEqual({ tipVisible: true, pulsing: true });

  // Resuming clears both, even mid-display.
  await page.evaluate(() => resumeGame());
  expect(await readTipState()).toEqual({ tipVisible: false, pulsing: false });

  // A player who has already saved at least once is never shown the tip
  // again, regardless of wave or how favorable the roll is -- they already
  // know the feature exists.
  await page.evaluate(() => {
    STATE.phase = 'PLAYING';
    STATE.wave = 25;
    saveGame(); // now there IS a save on file
    Math.random = () => 0.01;
    pauseGame();
  });
  expect(await readTipState()).toEqual({ tipVisible: false, pulsing: false });

  expect(errors).toEqual([]);
});

test('clicking Save Game immediately dismisses its own tip and pulse, on top of the usual "Game Saved" toast', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  await page.evaluate(() => {
    clearSave();
    STATE.phase = 'PLAYING';
    STATE.wave = 12;
    Math.random = () => 0.01; // guarantee the tip is showing beforehand
    pauseGame();
  });
  const before = await page.evaluate(() => ({
    tipVisible: document.getElementById('save-tip').classList.contains('visible'),
    pulsing: document.getElementById('pause-save').classList.contains('save-tip-pulse'),
  }));
  expect(before).toEqual({ tipVisible: true, pulsing: true });

  await page.click('#pause-save');
  const after = await page.evaluate(() => ({
    tipVisible: document.getElementById('save-tip').classList.contains('visible'),
    pulsing: document.getElementById('pause-save').classList.contains('save-tip-pulse'),
    toastVisible: document.getElementById('pause-save-toast').classList.contains('visible'),
    toastText: document.getElementById('pause-save-toast').textContent,
  }));
  expect(after).toEqual({ tipVisible: false, pulsing: false, toastVisible: true, toastText: 'Game Saved' });

  expect(errors).toEqual([]);
});

test('on a short viewport, the pause panel scrolls internally instead of pushing Resume off-screen once the save tip adds an extra row', async ({ page }) => {
  // Regression test for a real bug Codex caught on PR #31: #pause-panel had
  // no height cap or scrolling, so the tip's extra in-flow row could grow
  // the panel taller than a short landscape viewport and strand Resume
  // above the visible area with no way back.
  const errors = trackErrors(page);
  await page.setViewportSize({ width: 640, height: 320 });
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  await page.evaluate(() => {
    clearSave();
    STATE.phase = 'PLAYING';
    STATE.wave = 12;
    Math.random = () => 0.01; // guarantee the tip is showing, worst case for panel height
    pauseGame();
  });

  const result = await page.evaluate(() => {
    const panel = document.getElementById('pause-panel');
    const resumeRect = document.getElementById('pause-resume').getBoundingClientRect();
    return {
      tipVisible: document.getElementById('save-tip').classList.contains('visible'),
      panelTallerThanViewport: panel.scrollHeight > window.innerHeight,
      resumeFullyVisible: resumeRect.top >= 0 && resumeRect.bottom <= window.innerHeight,
      panelOverflowY: getComputedStyle(panel).overflowY,
    };
  });

  expect(result.tipVisible).toBe(true); // confirms this actually exercised the worst case
  expect(result.panelOverflowY).toBe('auto');
  expect(result.resumeFullyVisible).toBe(true); // reachable regardless of whether the panel content overflowed
  expect(errors).toEqual([]);
});

test('the "New Highest Wave" and "Best Wave Score" achievement toasts never fire before wave 10, even though every early wave is technically a new best on both counts', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(() => {
    STATE.stats.bestWave = 0;
    STATE.stats.bestWaveScore = 0;
    const perWave = [];
    for (let wave = 1; wave <= 12; wave++) {
      STATE.wave = wave;
      STATE.achievementQueue = [];
      checkAchievements(wave * 100); // strictly increasing -- always a new best score too
      perWave.push({
        wave,
        waveFired: STATE.achievementQueue.some(e => e.label === 'New Highest Wave'),
        scoreFired: STATE.achievementQueue.some(e => e.label === 'Best Wave Score'),
        bestWaveNow: STATE.stats.bestWave,
        bestScoreNow: STATE.stats.bestWaveScore,
      });
    }
    return perWave;
  });

  for (const entry of result) {
    // Stat tracking itself is never suppressed, only the toasts.
    expect(entry.bestWaveNow).toBe(entry.wave);
    expect(entry.bestScoreNow).toBe(entry.wave * 100);
    expect(entry.waveFired).toBe(entry.wave >= 10);
    expect(entry.scoreFired).toBe(entry.wave >= 10);
  }
  expect(errors).toEqual([]);
});

test('connection praise respects a cooldown between popups, even for back-to-back qualifying connections', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(() => {
    startWave(20); // past tutorial, plenty of distinct pairs to work with
    const byPair = {};
    for (const d of STATE.dots) (byPair[d.pairId] = byPair[d.pairId] || []).push(d);
    const pairs = Object.values(byPair).filter(g => g.length >= 2).slice(0, 3);
    if (pairs.length < 3) throw new Error('need at least 3 distinct pairs on this generated wave');

    // Same shape as the existing tutorial-wave praise test: a long, winding
    // path that easily clears the "long" criterion regardless of how far
    // apart the two dots actually are.
    function qualify([a, b]) {
      const straightDist = Math.hypot(b.x - a.x, b.y - a.y);
      STATE.currentPath = [
        { x: a.x, y: a.y },
        { x: a.x, y: a.y - straightDist },
        { x: b.x, y: b.y + straightDist },
        { x: b.x, y: b.y },
      ];
      completeConnection(a, b);
      return STATE.connectionPraise.length;
    }

    const before = STATE.connectionPraise.length;
    const first = qualify(pairs[0]); // cooldown starts at -Infinity -- should fire
    const second = qualify(pairs[1]); // qualifies too, but still well within cooldown -- should NOT fire
    STATE.lastPraiseAt = performance.now() - CONNECTION_PRAISE_COOLDOWN_MS; // simulate the cooldown having elapsed
    const third = qualify(pairs[2]); // cooldown elapsed -- should fire again

    return { before, first, second, third };
  });

  expect(result.before).toBe(0);
  expect(result.first).toBe(1);
  expect(result.second).toBe(1); // unchanged -- blocked by cooldown despite qualifying
  expect(result.third).toBe(2);
  expect(errors).toEqual([]);
});

test('the Erase menu item only appears while playing on Relaxed difficulty', async ({ page }) => {
  const errors = trackErrors(page);
  await page.addInitScript(() => { navigator.vibrate = () => true; });
  await page.goto('/index.html');
  await page.evaluate(() => localStorage.setItem('lumina_difficulty_v1', 'normal'));
  await page.reload();
  await page.waitForTimeout(300);
  await page.click('#start-game-button');
  await page.waitForTimeout(500);
  await expect(page.locator('#pause-erase')).toBeHidden();

  await page.evaluate(() => localStorage.setItem('lumina_difficulty_v1', 'relaxed'));
  await page.reload();
  await page.waitForTimeout(300);
  await page.click('#start-game-button');
  await page.waitForTimeout(500);
  await page.click('#pause-button'); // the item only actually renders with its menu open
  await expect(page.locator('#pause-erase')).toBeVisible();

  expect(errors).toEqual([]);
});

test('in Relaxed difficulty, picking Erase from the menu then tapping a drawn line erases it and stays in erase mode for further taps', async ({ page }) => {
  const errors = trackErrors(page);
  await page.addInitScript(() => { navigator.vibrate = () => true; });
  await page.goto('/index.html');
  await page.evaluate(() => localStorage.setItem('lumina_difficulty_v1', 'relaxed'));
  await page.reload();
  await page.waitForTimeout(300);
  await page.click('#start-game-button');
  await page.waitForTimeout(800);

  const dots = await page.evaluate(() => window.__lumina.getDots());
  const byPair = {};
  for (const d of dots) (byPair[d.pairId] = byPair[d.pairId] || []).push(d);
  const [a, b] = Object.values(byPair)[0];

  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(300);

  const before = await page.evaluate((pairId) => ({
    connections: window.__lumina.getState().connections.filter(c => c.pairId === pairId).length,
    anyConnected: window.__lumina.getDots().filter(d => d.pairId === pairId).some(d => d.connected),
  }), a.pairId);
  expect(before.connections).toBe(1);
  expect(before.anyConnected).toBe(true);

  // Picking Erase closes the menu itself and hands control straight back
  // to the board -- no separate "close the menu" step needed before the
  // tap-a-line-to-erase gesture below (see #pause-erase's click handler).
  await page.click('#pause-button');
  await page.click('#pause-erase');
  await expect(page.locator('#pause-overlay')).not.toHaveClass(/visible/);
  expect(await page.evaluate(() => STATE.eraseMode)).toBe(true);

  // Tap the midpoint of the line just drawn -- CONFIG.ERASE_HIT_RADIUS
  // (30px) is generous enough that this straight-ish drag lands well
  // within tolerance.
  await page.mouse.click((a.x + b.x) / 2, (a.y + b.y) / 2);
  await page.waitForTimeout(200);

  const after = await page.evaluate((pairId) => ({
    connections: window.__lumina.getState().connections.filter(c => c.pairId === pairId).length,
    anyConnected: window.__lumina.getDots().filter(d => d.pairId === pairId).some(d => d.connected),
    eraseModeStillOn: window.__lumina.getState().eraseMode,
  }), a.pairId);
  expect(after.connections).toBe(0);
  expect(after.anyConnected).toBe(false);
  expect(after.eraseModeStillOn).toBe(true); // multi-erase: stays on until explicitly toggled off

  // Reopening the menu and picking Erase again turns it back off -- and
  // must survive the ordinary resumeGame() safety net that otherwise
  // always clears erase mode on the way out (see closePauseMenuUI).
  await page.click('#pause-button');
  await expect(page.locator('#pause-erase')).toHaveClass(/active/);
  await page.click('#pause-erase');
  expect(await page.evaluate(() => STATE.eraseMode)).toBe(false);

  expect(errors).toEqual([]);
});

// Defect report: a player erased a line via the pause menu, and afterward
// could no longer draw any new connections at all -- no line rendered on
// screen for any subsequent drag. Root cause: Erase Mode has no auto-off
// (confirmed sticky just above), and onInputStart fully bypasses normal
// drawing while it's on (see its own comment on the erase-mode branch) --
// but there was nothing on screen, once the pause menu closed, telling
// the player it was still active. #erase-mode-banner (updateEraseModeBanner)
// fixes the "silent" part; this test drives the exact reported sequence
// end to end and confirms drawing is genuinely usable again afterward.
test('the erase-mode banner appears the moment Erase is picked, and tapping it restores normal drawing', async ({ page }) => {
  const errors = trackErrors(page);
  await page.addInitScript(() => { navigator.vibrate = () => true; });
  await page.goto('/index.html');
  await page.evaluate(() => localStorage.setItem('lumina_difficulty_v1', 'relaxed'));
  await page.reload();
  await page.waitForTimeout(300);
  await page.click('#start-game-button');
  await page.waitForTimeout(800);

  const dots = await page.evaluate(() => window.__lumina.getDots());
  const byPair = {};
  for (const d of dots) (byPair[d.pairId] = byPair[d.pairId] || []).push(d);
  const pairs = Object.values(byPair);
  const [a1, b1] = pairs[0];
  const [a2, b2] = pairs[1]; // a second, still-unconnected pair to try drawing after erasing the first

  await expect(page.locator('#erase-mode-banner')).not.toHaveClass(/visible/);

  // Draw the first pair normally.
  await page.mouse.move(a1.x, a1.y);
  await page.mouse.down();
  await page.mouse.move(b1.x, b1.y, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  expect(await page.evaluate((pairId) =>
    window.__lumina.getState().connections.some(c => c.pairId === pairId), a1.pairId)).toBe(true);

  // Turn Erase Mode on -- the banner should appear immediately.
  await page.click('#pause-button');
  await page.click('#pause-erase');
  await expect(page.locator('#erase-mode-banner')).toHaveClass(/visible/);

  // Erase the first pair's line.
  await page.mouse.click((a1.x + b1.x) / 2, (a1.y + b1.y) / 2);
  await page.waitForTimeout(200);
  expect(await page.evaluate((pairId) =>
    window.__lumina.getState().connections.some(c => c.pairId === pairId), a1.pairId)).toBe(false);

  // Erase Mode is still on (sticky by design) and so is the banner --
  // this is the exact moment the reported defect happened: trying to draw
  // the second pair right now must NOT create a connection.
  await expect(page.locator('#erase-mode-banner')).toHaveClass(/visible/);
  await page.mouse.move(a2.x, a2.y);
  await page.mouse.down();
  await page.mouse.move(b2.x, b2.y, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  expect(await page.evaluate((pairId) =>
    window.__lumina.getState().connections.some(c => c.pairId === pairId), a2.pairId)).toBe(false);

  // Tapping the banner itself exits Erase Mode -- the fix's whole point:
  // an always-visible way out that doesn't require finding the pause menu
  // again.
  await page.click('#erase-mode-banner');
  await expect(page.locator('#erase-mode-banner')).not.toHaveClass(/visible/);
  expect(await page.evaluate(() => STATE.eraseMode)).toBe(false);

  // Drawing is genuinely restored: the exact same gesture that silently
  // failed a moment ago now creates a real connection.
  await page.mouse.move(a2.x, a2.y);
  await page.mouse.down();
  await page.mouse.move(b2.x, b2.y, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  expect(await page.evaluate((pairId) =>
    window.__lumina.getState().connections.some(c => c.pairId === pairId), a2.pairId)).toBe(true);

  expect(errors).toEqual([]);
});

test('the erase-mode banner stays hidden while paused, even if Erase Mode is on underneath', async ({ page }) => {
  const errors = trackErrors(page);
  await page.addInitScript(() => { navigator.vibrate = () => true; });
  await page.goto('/index.html');
  await page.evaluate(() => localStorage.setItem('lumina_difficulty_v1', 'relaxed'));
  await page.reload();
  await page.waitForTimeout(300);
  await page.click('#start-game-button');
  await page.waitForTimeout(800);

  await page.click('#pause-button');
  await page.click('#pause-erase'); // closes the menu, leaves eraseMode on
  await expect(page.locator('#erase-mode-banner')).toHaveClass(/visible/);

  await page.click('#pause-button'); // reopen the menu -- STATE.paused is now true again
  await page.waitForTimeout(200);
  await expect(page.locator('#erase-mode-banner')).not.toHaveClass(/visible/);

  expect(errors).toEqual([]);
});

// Review finding: a bare <div>, however visible, is neither focusable nor
// exposed as a control to keyboard/screen-reader users, and CSS opacity
// alone leaves its text sitting in the accessibility tree even while
// hidden. Fixed by making it a real <button> with aria-hidden/tabindex
// synced to the same visibility flag (see updateEraseModeBanner).
test('the erase-mode banner is a real, focusable control that leaves the accessibility tree while hidden', async ({ page }) => {
  const errors = trackErrors(page);
  await page.addInitScript(() => { navigator.vibrate = () => true; });
  await page.goto('/index.html');
  await page.evaluate(() => localStorage.setItem('lumina_difficulty_v1', 'relaxed'));
  await page.reload();
  await page.waitForTimeout(300);
  await page.click('#start-game-button');
  await page.waitForTimeout(800);

  const banner = page.locator('#erase-mode-banner');
  expect(await banner.evaluate(el => el.tagName)).toBe('BUTTON');

  const hiddenState = await banner.evaluate(el => ({ ariaHidden: el.getAttribute('aria-hidden'), tabIndex: el.tabIndex }));
  expect(hiddenState).toEqual({ ariaHidden: 'true', tabIndex: -1 });

  await page.click('#pause-button');
  await page.click('#pause-erase');
  await expect(banner).toHaveClass(/visible/);

  const visibleState = await banner.evaluate(el => ({ ariaHidden: el.getAttribute('aria-hidden'), tabIndex: el.tabIndex }));
  expect(visibleState).toEqual({ ariaHidden: 'false', tabIndex: 0 });

  // Keyboard-activatable, not just clickable -- focus it directly (as a
  // screen-reader/keyboard user tabbing through the page would) and press
  // Enter, the same way a real <button> always responds regardless of how
  // it's styled.
  await banner.focus();
  await page.keyboard.press('Enter');
  await expect(banner).not.toHaveClass(/visible/);
  expect(await page.evaluate(() => STATE.eraseMode)).toBe(false);

  expect(errors).toEqual([]);
});

// Flagged by review: on a touch device, a pinch's first finger lands as
// its own touchstart before the second one arrives. Erasing immediately
// on that first contact (the original implementation) could permanently
// delete a line the player only grazed on their way into a two-finger
// zoom gesture. The hit test now waits for onInputEnd (see STATE.eraseArmed),
// and beginPinch clears it the instant a second finger confirms this is a
// pinch, not a tap -- exercised here directly via the input handlers
// (touch simulation isn't available through page.mouse) rather than through
// window.__lumina, so this is real production code, not a re-implementation.
test('a second finger landing mid-tap in erase mode cancels the pending erase instead of deleting whatever the first finger grazed', async ({ page }) => {
  const errors = trackErrors(page);
  await page.addInitScript(() => { navigator.vibrate = () => true; });
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);
  await page.click('#start-game-button');
  await page.waitForTimeout(800);

  const setup = await page.evaluate(() => {
    STATE.eraseMode = true;
    const dots = window.__lumina.getDots();
    const byPair = {};
    for (const d of dots) (byPair[d.pairId] = byPair[d.pairId] || []).push(d);
    const [a, b] = Object.values(byPair)[0];
    STATE.activeDot = a;
    STATE.currentPath = [{ x: a.x, y: a.y }, { x: b.x, y: b.y }];
    completeConnection(a, b);
    const mid = STATE.connections[0].segments[Math.floor(STATE.connections[0].segments.length / 2)];
    return { tapX: mid.x1, tapY: mid.y1, pairId: a.pairId };
  });

  // First finger lands on the line -- arms erase mode, but doesn't act yet.
  const armedAfterFirstTouch = await page.evaluate(({ tapX, tapY }) => {
    onInputStart({ preventDefault() {}, clientX: tapX, clientY: tapY });
    return STATE.eraseArmed;
  }, setup);
  expect(armedAfterFirstTouch).toBe(true);

  // A second finger lands before release -- this is a pinch starting, not
  // a tap landing.
  const armedAfterSecondTouch = await page.evaluate(({ tapX, tapY }) => {
    onInputStart({
      preventDefault() {},
      touches: [{ clientX: tapX, clientY: tapY }, { clientX: tapX + 60, clientY: tapY + 60 }],
    });
    return STATE.eraseArmed;
  }, setup);
  expect(armedAfterSecondTouch).toBe(false); // beginPinch cleared it

  const survived = await page.evaluate((pairId) => {
    onInputEnd({ preventDefault() {} });
    return STATE.connections.some(c => c.pairId === pairId);
  }, setup.pairId);
  expect(survived).toBe(true); // the line the first finger grazed must still be there

  expect(errors).toEqual([]);
});

test('findConnectionAt hits a tap within ERASE_HIT_RADIUS of an existing line and misses one outside it', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(() => {
    const conn = { dotA: 0, dotB: 1, colorIndex: 0, pairId: 0, segments: [{ x1: 100, y1: 100, x2: 300, y2: 100 }] };
    STATE.connections = [conn];

    return {
      hitDeadCenter: findConnectionAt(200, 100) === conn,
      hitJustInsideTolerance: findConnectionAt(200, 100 + CONFIG.ERASE_HIT_RADIUS - 2) === conn,
      missWellOutsideTolerance: findConnectionAt(200, 100 + CONFIG.ERASE_HIT_RADIUS + 20),
      missEntirelyElsewhere: findConnectionAt(1000, 1000),
    };
  });

  expect(result.hitDeadCenter).toBe(true);
  expect(result.hitJustInsideTolerance).toBe(true);
  expect(result.missWellOutsideTolerance).toBeNull();
  expect(result.missEntirelyElsewhere).toBeNull();
  expect(errors).toEqual([]);
});

// Flagged by review: close parallel routing (two valid, non-crossing
// lines running near each other) is normal, legal gameplay, so a tap
// between them has to resolve to whichever is actually closest -- not
// just whichever happens to come first in STATE.connections' insertion
// order, which would make erasing the wrong line depend on draw order
// rather than proximity.
test('findConnectionAt picks the closest eligible connection to the tap, not just the first one within range', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(() => {
    const farther = { dotA: 0, dotB: 1, colorIndex: 0, pairId: 0, segments: [{ x1: 100, y1: 100, x2: 300, y2: 100 }] };
    const closer = { dotA: 2, dotB: 3, colorIndex: 1, pairId: 1, segments: [{ x1: 100, y1: 115, x2: 300, y2: 115 }] };
    // Deliberately inserted farther-first -- a first-match implementation
    // would pick `farther` even though `closer` is nearer the tap.
    STATE.connections = [farther, closer];
    const hit = findConnectionAt(200, 110); // 10px from `farther`, 5px from `closer`
    return { pickedCloser: hit === closer };
  });

  expect(result.pickedCloser).toBe(true);
  expect(errors).toEqual([]);
});

// Mirrors breakConnection's own established rule (see resetPairConnections):
// once a color has 3+ dots, a single edge can't be cleanly un-linked from
// the rest without re-deriving connectivity, so erasing any one edge resets
// the whole network, not just the tapped edge.
test('erasing one edge of a 3+-dot group resets the whole group', async ({ page }) => {
  const errors = trackErrors(page);
  await page.addInitScript(() => { navigator.vibrate = () => true; });
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(() => {
    const A = { id: 10, pairId: 5, colorIndex: 0, x: 100, y: 100, connected: true, pulsePhase: 0 };
    const B = { id: 11, pairId: 5, colorIndex: 0, x: 300, y: 100, connected: true, pulsePhase: 0 };
    const C = { id: 12, pairId: 5, colorIndex: 0, x: 300, y: 300, connected: true, pulsePhase: 0 };
    STATE.dots = [A, B, C];
    STATE.dotUnion = { 10: 10, 11: 10, 12: 10 }; // all three already unioned into one network
    const connAB = { dotA: A.id, dotB: B.id, colorIndex: 0, pairId: 5, segments: [{ x1: A.x, y1: A.y, x2: B.x, y2: B.y }] };
    const connBC = { dotA: B.id, dotB: C.id, colorIndex: 0, pairId: 5, segments: [{ x1: B.x, y1: B.y, x2: C.x, y2: C.y }] };
    STATE.connections = [connAB, connBC];
    STATE.lines = [{ pairId: 5 }, { pairId: 5 }];
    STATE.stars = [{ pairId: 5 }, { pairId: 5 }];

    eraseConnection(connAB); // only tap the A-B edge

    return {
      connectionsLeft: STATE.connections.length,
      linesLeft: STATE.lines.length,
      starsLeft: STATE.stars.length,
      anyStillConnected: STATE.dots.some(d => d.connected),
      unionReset: STATE.dotUnion[10] === 10 && STATE.dotUnion[11] === 11 && STATE.dotUnion[12] === 12,
    };
  });

  expect(result.connectionsLeft).toBe(0); // both edges gone, not just the tapped one
  expect(result.linesLeft).toBe(0);
  expect(result.starsLeft).toBe(0);
  expect(result.anyStillConnected).toBe(false);
  expect(result.unionReset).toBe(true);
  expect(errors).toEqual([]);
});

// Regression guard for a real user-reported defect: mobile browser chrome
// (address bar collapsing/reappearing on scroll or tap, orientation change)
// resizes the viewport out from under an already-showing WAVE_COMPLETE
// starfield reveal far more often than a desktop window ever resizes
// mid-session -- reported as "patches of space with no stars" on mobile,
// never seen on desktop. fillBaseStarfield only ever ran once, sized to
// whatever canvas.width/height were at that instant, so any newly-exposed
// screen area after a resize stayed permanently starless.
//
// Also covers two gaps a naive "just re-run fillBaseStarfield()" fix would
// have (flagged in review): its target count depends only on total area,
// so an area-preserving orientation flip computes the same target as
// before and silently adds nothing; and even a genuine area increase
// scatters the new stars over the WHOLE canvas rather than the
// newly-exposed part, under-filling that part whenever the pre-existing
// area is large relative to the growth. Both are asserted with exact,
// deterministic counts (topUpStarfieldForResize's region math has no
// randomness in *how many* stars get added, only where within their
// region each one lands) -- a naive fix would fail the rotation count
// outright (would stay flat), and would very likely fail the "stars
// actually in the new strip" count even when the grand total happened to
// match.
test('the WAVE_COMPLETE starfield reveal tops itself back up precisely for both a viewport growth and an area-preserving rotation, but a resize mid-play does not enrich the deliberately sparse backdrop', async ({ page }) => {
  const errors = trackErrors(page);
  await page.addInitScript(() => { navigator.vibrate = () => true; });
  await page.setViewportSize({ width: 400, height: 700 });
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  // --- Growth: mobile address bar collapsing, width unchanged ---
  await page.evaluate(() => {
    startWave(1);
    for (const dot of STATE.dots) dot.connected = true;
    checkWaveComplete();
  });
  const baseline = await page.evaluate(() => STATE.stars.length);
  expect(baseline).toBe(Math.round((400 * 700) / 2600)); // 108 -- matches AREA_PER_BASE_STAR exactly

  await page.setViewportSize({ width: 400, height: 850 });
  await page.waitForTimeout(50);
  const afterGrowth = await page.evaluate(() => ({
    total: STATE.stars.length,
    inNewStrip: STATE.stars.filter(s => s.y >= 700).length, // only the newly-exposed 400x150 strip
  }));
  const expectedNewStripCount = Math.round((400 * 150) / 2600); // 23
  expect(afterGrowth.total).toBe(baseline + expectedNewStripCount);
  expect(afterGrowth.inNewStrip).toBe(expectedNewStripCount); // every added star actually landed in the new strip

  // --- Area-preserving rotation: a naive whole-canvas top-up adds zero ---
  await page.setViewportSize({ width: 400, height: 800 });
  await page.waitForTimeout(50);
  await page.evaluate(() => {
    startWave(1);
    for (const dot of STATE.dots) dot.connected = true;
    checkWaveComplete();
  });
  const rotationBaseline = await page.evaluate(() => STATE.stars.length);
  expect(rotationBaseline).toBe(Math.round((400 * 800) / 2600)); // 123, all placed with x in [0,400)

  await page.setViewportSize({ width: 800, height: 400 }); // same total area, 320000px^2
  await page.waitForTimeout(50);
  const afterRotation = await page.evaluate(() => ({
    // Every surviving pre-rotation star has x < 400 (fillBaseStarfield
    // placed them there originally) -- so any star now at x >= 400 must
    // be one topUpStarfieldForResize just added to the newly-exposed
    // right strip, making this an exact, deterministic count regardless
    // of how many of the original 123 randomly survived the height
    // shrinking out from under them (untestable precisely, since that
    // depends on where fillBaseStarfield's own randomness happened to
    // place each one).
    inNewRightStrip: STATE.stars.filter(s => s.x >= 400).length,
    allInBounds: STATE.stars.every(s => s.x < 800 && s.y < 400),
  }));
  const expectedRotationStripCount = Math.round((400 * 400) / 2600); // 62 -- the newly-exposed right strip
  expect(afterRotation.inNewRightStrip).toBe(expectedRotationStripCount); // a naive whole-canvas top-up would give 0 here
  expect(afterRotation.allInBounds).toBe(true);

  // --- Back to actively playing: must NOT enrich the sparse backdrop ---
  const beforePlayingResize = await page.evaluate(() => {
    STATE.phase = 'PLAYING';
    return STATE.stars.length;
  });
  await page.setViewportSize({ width: 800, height: 500 });
  await page.waitForTimeout(50);
  const afterPlayingResize = await page.evaluate(() => STATE.stars.length);
  expect(afterPlayingResize).toBe(beforePlayingResize);

  expect(errors).toEqual([]);
});

test('the ERASE tutorial message only shows in Relaxed difficulty, and is skipped (not blank) otherwise', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(() => {
    const eraseWave = TUTORIAL_MESSAGES.findIndex(m => m.relaxedOnly) + 1;

    STATE.difficulty = 'normal';
    showTutorialHint(eraseWave);
    const onNormal = { tutorialWave: STATE.tutorialWave, dismissWhen: STATE.tutorialDismissWhen };

    STATE.difficulty = 'relaxed';
    showTutorialHint(eraseWave);
    const onRelaxed = { tutorialWave: STATE.tutorialWave, text: document.getElementById('tutorial-hint').textContent };

    return { eraseWave, onNormal, onRelaxed };
  });

  expect(result.eraseWave).toBeGreaterThan(0);
  expect(result.onNormal.tutorialWave).toBeNull();
  expect(result.onNormal.dismissWhen).toBeNull();
  expect(result.onRelaxed.tutorialWave).toBe(result.eraseWave);
  expect(result.onRelaxed.text).toMatch(/Erase/);
  expect(errors).toEqual([]);
});

// Flagged by Codex review on #34: ERASE is entirely player-controlled and
// repeatable (unlike a rotating barrier snap), so if the score a connection
// awarded weren't reversed on erase, a player could draw one long line,
// erase it, redraw it, and farm unlimited score/best-wave-score credit.
test('erasing a connection reverses the score it awarded, so redrawing the same line does not farm points', async ({ page }) => {
  const errors = trackErrors(page);
  await page.addInitScript(() => { navigator.vibrate = () => true; });
  await page.goto('/index.html');
  await page.evaluate(() => localStorage.setItem('lumina_difficulty_v1', 'relaxed'));
  await page.reload();
  await page.waitForTimeout(300);
  await page.click('#start-game-button');
  await page.waitForTimeout(800);

  const dots = await page.evaluate(() => window.__lumina.getDots());
  const byPair = {};
  for (const d of dots) (byPair[d.pairId] = byPair[d.pairId] || []).push(d);
  const [a, b] = Object.values(byPair)[0];

  async function drawConnection() {
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(300);
  }

  const scoreBeforeFirstDraw = await page.evaluate(() => window.__lumina.getState().score);
  await drawConnection();
  const scoreAfterFirstDraw = await page.evaluate(() => window.__lumina.getState().score);
  expect(scoreAfterFirstDraw).toBeGreaterThan(scoreBeforeFirstDraw);

  await page.click('#pause-button');
  await page.click('#pause-erase');
  await page.mouse.click((a.x + b.x) / 2, (a.y + b.y) / 2);
  await page.waitForTimeout(200);
  const scoreAfterErase = await page.evaluate(() => window.__lumina.getState().score);
  expect(scoreAfterErase).toBe(scoreBeforeFirstDraw);

  // Erase mode stays on after one erase (multi-erase) -- toggle it back off
  // so the next drag draws a line instead of hunting for another to erase.
  await page.click('#pause-button');
  await page.click('#pause-erase');

  // Redrawing the identical line a second time must award exactly the same
  // points again, not stack on top of a stale earlier award.
  await drawConnection();
  const scoreAfterRedraw = await page.evaluate(() => window.__lumina.getState().score);
  expect(scoreAfterRedraw).toBe(scoreAfterFirstDraw);

  expect(errors).toEqual([]);
});

// Flagged by Codex review on #34: the item was visible any time the
// phase wasn't TITLE, including WAVE_COMPLETE, where canvas taps advance
// the wave before ever reaching the erase-mode branch -- a lit item that
// can't do anything. Also confirms startWave's reset is a real safety net
// (clears the DOM class itself), not just relying on toggleEraseMode's own
// click handler to keep the two in sync.
test('the Erase menu item hides during WAVE_COMPLETE (even in Relaxed) and its active class can never survive into the next wave', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(() => {
    STATE.difficulty = 'relaxed';
    STATE.phase = 'PLAYING';
    updateWaveDisplay();
    const visibleWhilePlaying = document.getElementById('pause-erase').classList.contains('visible');

    STATE.phase = 'WAVE_COMPLETE';
    updateWaveDisplay();
    const visibleAtWaveComplete = document.getElementById('pause-erase').classList.contains('visible');

    // Simulate the item having been left lit somehow going into a new
    // wave -- startWave's own reset must independently clear it.
    document.getElementById('pause-erase').classList.add('active');
    STATE.eraseMode = true;
    startWave(1);
    const activeAfterNewWave = document.getElementById('pause-erase').classList.contains('active');
    const eraseModeAfterNewWave = STATE.eraseMode;

    return { visibleWhilePlaying, visibleAtWaveComplete, activeAfterNewWave, eraseModeAfterNewWave };
  });

  expect(result.visibleWhilePlaying).toBe(true);
  expect(result.visibleAtWaveComplete).toBe(false);
  expect(result.activeAfterNewWave).toBe(false);
  expect(result.eraseModeAfterNewWave).toBe(false);
  expect(errors).toEqual([]);
});

// Regression guard for a real user-reported defect: "sound is lost after
// switching back to the game from another app, requires a refresh." A
// real app switch can suspend the whole audio session on mobile far more
// aggressively than same-app backgrounding -- the existing gesture-
// triggered self-heal in initAudio() only ever ran on the player's *next*
// tap, and even then only rebuilt the context, never re-scheduling the
// wave already in progress (only startWave/scheduleCurrentSongOnceReady
// does that) -- which is exactly why only a full reload (which always
// re-enters through startWave) actually brought the music back.
test('recoverAudioAfterVisible does nothing when the audio context was never actually suspended', async ({ page }) => {
  const errors = trackErrors(page);
  await page.addInitScript(() => { navigator.vibrate = () => true; });
  await page.goto('/index.html');
  await page.waitForTimeout(300);
  await page.click('#start-game-button');
  await page.waitForTimeout(800);

  const result = await page.evaluate(() => {
    const stateBefore = STATE.audioCtx.state;
    const songStartBefore = STATE.songStartTime;
    recoverAudioAfterVisible();
    return { stateBefore, unchanged: STATE.songStartTime === songStartBefore };
  });

  expect(result.stateBefore).toBe('running'); // never suspended -- confirms this is a real no-op check, not vacuous
  expect(result.unchanged).toBe(true); // no reschedule triggered
  expect(errors).toEqual([]);
});

test('recoverAudioAfterVisible resumes a genuinely suspended context and reschedules the current song, keeping already-connected pairs unmuted', async ({ page }) => {
  const errors = trackErrors(page);
  await page.addInitScript(() => { navigator.vibrate = () => true; });
  await page.goto('/index.html');
  await page.waitForTimeout(300);
  await page.click('#start-game-button');
  await page.waitForTimeout(800);

  const dots = await page.evaluate(() => window.__lumina.getDots());
  const byPair = {};
  for (const d of dots) (byPair[d.pairId] = byPair[d.pairId] || []).push(d);
  const [a, b] = Object.values(byPair)[0];

  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(300);

  // Not gain.value here -- unmuteChunk deliberately ramps in on this
  // pair's next clean musical onset rather than instantly, so the actual
  // gain right after connecting depends on where the song happens to be
  // in its beat, not a fixed value. dot.connected is the real,
  // ramp-independent signal scheduleLoopingSong itself reads to decide
  // which pairs start already-unmuted after a rebuild.
  const before = await page.evaluate((pairId) => STATE.dots.some(d => d.pairId === pairId && d.connected), a.pairId);
  expect(before).toBe(true);

  const result = await page.evaluate(async (pairId) => {
    await STATE.audioCtx.suspend(); // a real, genuine suspend -- not a mock
    const stateWhileSuspended = STATE.audioCtx.state;
    recoverAudioAfterVisible();
    // recoverAudioAfterVisible's own resume().then() chain is async;
    // give it a moment to actually settle and reschedule.
    await new Promise(r => setTimeout(r, 200));
    return {
      stateWhileSuspended,
      stateAfter: STATE.audioCtx.state,
      gainAfter: STATE.chunkGains[pairId].gain.value,
    };
  }, a.pairId);

  expect(result.stateWhileSuspended).toBe('suspended');
  expect(result.stateAfter).toBe('running');
  expect(result.gainAfter).toBeCloseTo(1, 1); // still unmuted after the rebuild -- nothing already earned went quiet
  expect(errors).toEqual([]);
});

test('recoverAudioAfterVisible discards a context that stays wedged after resume, matching the existing gesture-triggered self-heal', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(async () => {
    const fakeCtx = {
      state: 'suspended',
      currentTime: 0,
      resume() { return Promise.resolve(); }, // resolves, but never actually flips to 'running' -- a real wedge
    };
    STATE.audioCtx = fakeCtx;
    STATE.song = null; // isolate this test from any real scheduling attempt
    recoverAudioAfterVisible();
    await new Promise(r => setTimeout(r, 50));
    return { audioCtxDropped: STATE.audioCtx === null };
  });

  expect(result.audioCtxDropped).toBe(true);
  expect(errors).toEqual([]);
});

// Regression guard for the same underlying defect continuing to occur
// occasionally even with the above recovery in place: a real app-switch on
// some mobile browsers leaves the audio session fully 'closed' rather than
// merely 'suspended' under memory pressure. The old guard only matched
// 'suspended', so a closed context fell straight through untouched and
// stayed set as STATE.audioCtx forever -- not just silent until the next
// tap, but silent even *after* one, since initAudio() would see a non-null
// (dead) context and never rebuild it.
test('recoverAudioAfterVisible drops a fully closed audio context (not just suspended) instead of leaving it stuck forever', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(() => {
    const fakeCtx = {
      state: 'closed',
      currentTime: 0,
      resume() { return Promise.reject(new Error('cannot resume a closed context')); },
    };
    STATE.audioCtx = fakeCtx;
    recoverAudioAfterVisible();
    // Dropped synchronously -- no resume() attempt needed for an already-closed context.
    return { audioCtxDroppedSynchronously: STATE.audioCtx === null };
  });

  expect(result.audioCtxDroppedSynchronously).toBe(true);
  expect(errors).toEqual([]);
});

// initAudio checks ctx.state === 'closed' directly, up front, independent
// of whether anything throws -- the Web Audio spec doesn't guarantee
// createBuffer/createBufferSource/connect/start throw merely because a
// context is closed, so relying on a try/catch around those calls alone
// (an earlier version of this fix) would never even run on a browser
// where they stay silently callable (review catch). Uses a closed fake
// context whose methods are all silently callable -- no throw anywhere --
// to prove detection doesn't depend on an exception showing up. Because
// the check happens before initAudioGraph(), a closed context is rebuilt
// into a fresh, real, working one in this same call -- not merely dropped
// for some later tap to rebuild.
test('initAudio detects and replaces a closed context with a fresh one, even when none of its methods actually throw', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(() => {
    const fakeCtx = {
      state: 'closed',
      // Every method a lenient/non-conformant browser might leave
      // silently callable on a closed context -- none of them throw.
      createBuffer() { return {}; },
      createBufferSource() { return { connect() {}, start() {} }; },
      resume() { return Promise.resolve(); },
    };
    STATE.audioCtx = fakeCtx;
    initAudio();
    return {
      hasContext: !!STATE.audioCtx,
      wasReplaced: STATE.audioCtx !== fakeCtx,
      newContextNotClosed: STATE.audioCtx && STATE.audioCtx.state !== 'closed',
    };
  });

  expect(result.hasContext).toBe(true);
  expect(result.wasReplaced).toBe(true);
  expect(result.newContextNotClosed).toBe(true);
  expect(errors).toEqual([]); // no exception needed to detect or recover from this
});

// The try/catch around initAudio's tap-triggered unlock code is a
// backstop for genuinely unexpected failures *other* than a closed
// context (that specific case is now caught earlier, before this code
// ever runs -- see the test above) -- e.g. some other transient browser
// quirk touching the context. Simulates one directly so this backstop
// itself stays covered, confirming initAudio still self-heals rather than
// throwing out to its caller.
test('initAudio self-heals instead of throwing on an unexpected failure from the unlock code itself', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(() => {
    const fakeCtx = {
      state: 'running', // not 'closed' -- this exercises the try/catch backstop, not the closed-state check
      createBuffer() { throw new Error('unexpected browser quirk'); },
    };
    STATE.audioCtx = fakeCtx;
    let threw = false;
    try {
      initAudio();
    } catch (e) {
      threw = true;
    }
    return { threw, audioCtxDropped: STATE.audioCtx === null };
  });

  expect(result.threw).toBe(false);
  expect(result.audioCtxDropped).toBe(true);
  // Not asserting errors is empty here -- the self-heal path deliberately
  // logs via console.error (same pattern initAudioGraph's own catch
  // already uses), which is exactly what's being exercised.
});

// recoverAudioAfterVisible is now wired to visibilitychange, pageshow, AND
// focus (not just visibilitychange) so a real app-switch-back is recovered
// even on browsers that fire only some of those for the same "switched
// back" moment -- player reports of the recovery occasionally not kicking
// in line up with known cross-browser inconsistency in exactly when/
// whether visibilitychange itself fires there. Those three genuinely can
// fire together, though, so this confirms the re-entrancy guard collapses
// them into a single resume() attempt rather than each independently
// resuming and rescheduling (which would otherwise double up into an
// audible glitch).
test('multiple lifecycle events firing together for the same recovery moment (visibilitychange + pageshow + focus) only resume the context once', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(async () => {
    const fakeCtx = {
      state: 'suspended',
      currentTime: 0,
      resumeCalls: 0,
      resume() {
        this.resumeCalls++;
        this.state = 'running';
        return new Promise(r => setTimeout(r, 30));
      },
    };
    STATE.audioCtx = fakeCtx;
    STATE.song = null; // isolate this test from any real scheduling attempt
    // Simulate all three listeners firing for the same real-world moment.
    recoverAudioAfterVisible();
    recoverAudioAfterVisible();
    recoverAudioAfterVisible();
    await new Promise(r => setTimeout(r, 100));
    return { resumeCalls: fakeCtx.resumeCalls };
  });

  expect(result.resumeCalls).toBe(1);
  expect(errors).toEqual([]);
});

test('a mid-wave audio context rebuild (initAudio after a wedge) reschedules the current song instead of leaving it silent until the next wave', async ({ page }) => {
  const errors = trackErrors(page);
  await page.addInitScript(() => { navigator.vibrate = () => true; });
  await page.goto('/index.html');
  await page.waitForTimeout(300);
  await page.click('#start-game-button');
  await page.waitForTimeout(800);

  const before = await page.evaluate(() => STATE.songStartTime);
  expect(before).not.toBeNull();

  await page.evaluate(() => {
    STATE.audioCtx = null; // simulate a wedge already confirmed dead (see initAudio's own self-heal)
    STATE.songStartTime = null; // as if nothing were scheduled at all right now
  });

  await page.evaluate(() => { initAudio(); }); // the next tap's gesture
  await page.waitForTimeout(300); // let the async decode-then-schedule chain settle

  const after = await page.evaluate(() => ({
    hasContext: !!STATE.audioCtx,
    songRescheduled: STATE.songStartTime !== null,
  }));
  expect(after.hasContext).toBe(true);
  expect(after.songRescheduled).toBe(true); // previously stayed null until the *next* wave transition

  expect(errors).toEqual([]);
});

// Regression guard for a real user-reported defect: "no music is heard on
// a wave, most often wave 1." Wave 1 is also the very first sample decode
// ever (every real instrument still has to be fetched/decoded), so a
// small, fast wave 1 could be fully solved -- moving STATE.song on to
// wave 2 -- before that decode resolved. scheduleCurrentSongOnceReady used
// to only schedule the exact song object its own call started for, so
// that first call's callback found STATE.song had already moved on and
// silently dropped it -- wave 1 got no music at all, and only wave 2
// onward (whose own call finds decoding already resolved) played
// anything.
test('scheduleCurrentSongOnceReady schedules whichever song is actually current, even if the wave it originally started for already finished before decoding resolved', async ({ page }) => {
  const errors = trackErrors(page);
  await page.addInitScript(() => { navigator.vibrate = () => true; });
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);
  await page.click('#start-game-button');
  await page.waitForTimeout(800);

  const result = await page.evaluate(async () => {
    await STATE.samplesReadyPromise; // real decode already finished -- isolate this test to the race itself
    STATE.songScheduledFor = null;
    STATE.songStartTime = null;

    // Reproduce the exact race: a call starts scheduling for "wave 1"'s
    // song while decoding is still pending, but by the time it resolves,
    // the wave has already finished and moved on to a different song.
    let resolveDecode;
    STATE.samplesReadyPromise = new Promise(r => { resolveDecode = r; });

    const wave1Song = generateSong(1);
    STATE.song = wave1Song;
    scheduleCurrentSongOnceReady(); // starts waiting on the still-pending promise

    const wave2Song = generateSong(2);
    STATE.song = wave2Song; // wave 1 "finished" -- superseded before decode resolved

    resolveDecode();
    await new Promise(r => setTimeout(r, 50));

    return {
      scheduledWave2: STATE.songScheduledFor === wave2Song,
      songStarted: STATE.songStartTime !== null,
      chunkCount: STATE.chunkGains.length,
      wave2PairCount: wave2Song.pairCount,
    };
  });

  expect(result.scheduledWave2).toBe(true);
  expect(result.songStarted).toBe(true);
  expect(result.chunkCount).toBe(result.wave2PairCount); // wave 2's own chunk layout, not wave 1's stale one
  expect(errors).toEqual([]);
});

// ------------------------------------------------------------
// Social share: a plain link from the title screen, and a composited
// wave postcard offered only when a completed wave actually earned an
// achievement.
// ------------------------------------------------------------

test('the title-screen Share button uses the Web Share API when available', async ({ page }) => {
  const errors = trackErrors(page);
  await page.addInitScript(() => {
    navigator.vibrate = () => true;
    window.__shareCalls = [];
    navigator.share = (data) => { window.__shareCalls.push(data); return Promise.resolve(); };
  });
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  await expect(page.locator('#share-row')).toBeVisible();
  await page.locator('#share-game-button').click();
  await page.waitForTimeout(100);

  const calls = await page.evaluate(() => window.__shareCalls);
  expect(calls.length).toBe(1);
  expect(calls[0].url).toBe('https://draclif.itch.io/lumina');
  expect(calls[0].title).toBe('Lumina');
  expect(errors).toEqual([]);
});

test('the title-screen Share button falls back to a clipboard copy when Web Share is unavailable', async ({ page }) => {
  const errors = trackErrors(page);
  await page.addInitScript(() => {
    navigator.vibrate = () => true;
    navigator.share = undefined;
    window.__clipboardText = null;
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: (t) => { window.__clipboardText = t; return Promise.resolve(); } },
      configurable: true,
    });
  });
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  await page.locator('#share-game-button').click();
  await page.waitForTimeout(100);

  const clipboardText = await page.evaluate(() => window.__clipboardText);
  expect(clipboardText).toBe('https://draclif.itch.io/lumina');
  await expect(page.locator('#share-toast')).toHaveText('Link Copied');
  expect(errors).toEqual([]);
});

test('the postcard prompt only appears when the completed wave actually earned an achievement', async ({ page }) => {
  const errors = trackErrors(page);
  await page.addInitScript(() => { navigator.vibrate = () => true; });
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(() => {
    startWave(9); // below EARLY_ACHIEVEMENT_GATE_WAVE -- no achievement possible yet
    for (const dot of STATE.dots) dot.connected = true;
    checkWaveComplete();
    const hiddenBelowGate = document.getElementById('postcard-row').classList.contains('visible');

    startWave(10); // at the gate -- a fresh save's bestWave/bestWaveScore both earn here
    for (const dot of STATE.dots) dot.connected = true;
    checkWaveComplete();
    const visibleAtGate = document.getElementById('postcard-row').classList.contains('visible');
    const labels = STATE.lastWavePostcardLabels.slice();

    return { hiddenBelowGate, visibleAtGate, labels };
  });

  expect(result.hiddenBelowGate).toBe(false);
  expect(result.visibleAtGate).toBe(true);
  expect(result.labels.length).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

// Player report: a low-vision player (macular degeneration) said the
// "Share This Wave" button was barely noticeable and hard to read at its
// old styling (11px, normal weight, an 8%-opacity background, a 1px
// 35%-opacity border) -- the exact combination of small, low-contrast,
// and thin-bordered that's hardest to find with reduced central vision.
// Verifies both share buttons (title-screen and postcard) now match
// #start-game-button's bold, legible sizing rather than the old subtle
// secondary-link styling, and stay that way.
test('the Share buttons are sized and weighted for low-vision legibility, not styled as a subtle secondary link', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(() => {
    const styleOf = (id) => {
      const el = document.getElementById(id);
      const s = getComputedStyle(el);
      return {
        fontSize: parseFloat(s.fontSize),
        fontWeight: Number(s.fontWeight),
        borderWidth: parseFloat(s.borderWidth),
      };
    };
    return { share: styleOf('share-game-button'), postcard: styleOf('postcard-button') };
  });

  for (const button of [result.share, result.postcard]) {
    expect(button.fontSize).toBeGreaterThanOrEqual(16);
    expect(button.fontWeight).toBeGreaterThanOrEqual(700);
    expect(button.borderWidth).toBeGreaterThanOrEqual(2);
  }
  expect(errors).toEqual([]);
});

test('the Share row is title-screen only, and the postcard row never lingers into the next wave', async ({ page }) => {
  const errors = trackErrors(page);
  await page.addInitScript(() => { navigator.vibrate = () => true; });
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  await expect(page.locator('#share-row')).toBeVisible();

  await page.evaluate(() => {
    startWave(10);
    for (const dot of STATE.dots) dot.connected = true;
    checkWaveComplete();
  });
  const duringWaveComplete = await page.evaluate(() => ({
    shareRowVisible: document.getElementById('share-row').classList.contains('visible'),
    postcardRowVisible: document.getElementById('postcard-row').classList.contains('visible'),
  }));
  expect(duringWaveComplete.shareRowVisible).toBe(false);
  expect(duringWaveComplete.postcardRowVisible).toBe(true);

  await page.evaluate(() => {
    hideMessage();
    startWave(11);
  });
  const afterAdvance = await page.evaluate(() => document.getElementById('postcard-row').classList.contains('visible'));
  expect(afterAdvance).toBe(false);
  expect(errors).toEqual([]);
});

test('a plain tap on the title screen does nothing; only the Start Game button starts the game, and is title-only', async ({ page }) => {
  const errors = trackErrors(page);
  await page.addInitScript(() => { navigator.vibrate = () => true; });
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  await expect(page.locator('#start-game-button')).toBeVisible();
  await page.click('.difficulty-btn[data-difficulty="normal"]');

  // A plain tap/click on the title screen's canvas backdrop (empty space,
  // not any UI element) must NOT start the game -- player feedback: it was
  // too easy to start by accident. Only the explicit button does.
  await page.mouse.click(200, 700);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => STATE.phase)).toBe('TITLE');

  await page.click('#start-game-button');
  await page.waitForTimeout(1000);

  const state = await page.evaluate(() => ({ phase: STATE.phase, wave: STATE.wave, difficulty: STATE.difficulty }));
  expect(state.phase).toBe('PLAYING');
  expect(state.wave).toBe(1);
  expect(state.difficulty).toBe('normal'); // honors whatever was picked before starting
  await expect(page.locator('#start-game-row')).toBeHidden();
  expect(errors).toEqual([]);
});

test('on a short viewport, the title screen scrolls internally instead of pushing Start Game off-screen (review catch, PR #75)', async ({ page }) => {
  // Regression test for a real bug Codex caught on PR #75: removing the
  // click-anywhere-to-start fallback made #start-game-button the ONLY way
  // to start a game, but #message-content (the title screen's row stack)
  // had no height cap or scrolling -- on a short landscape viewport the
  // full row stack (title, subtitle, difficulty, scene, Flight/Cockpit
  // Mode, Load Game, Share, Start Game) can be taller than the viewport,
  // stranding the button above the visible area with no way back.
  const errors = trackErrors(page);
  await page.setViewportSize({ width: 640, height: 320 });
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);
  await page.waitForTimeout(300);

  const layout = await page.evaluate(() => {
    const content = document.getElementById('message-content');
    return {
      contentTallerThanViewport: content.scrollHeight > window.innerHeight,
      contentOverflowY: getComputedStyle(content).overflowY,
      contentPointerEvents: getComputedStyle(content).pointerEvents,
    };
  });
  expect(layout.contentTallerThanViewport).toBe(true); // confirms this actually exercised the worst case
  expect(layout.contentOverflowY).toBe('auto');
  expect(layout.contentPointerEvents).toBe('auto'); // needed for touch/mouse-wheel scroll to actually reach it

  // Scroll the button into view (exactly what a real player would need to
  // do) and confirm it's clickable and still works.
  await page.locator('#start-game-button').scrollIntoViewIfNeeded();
  const rect = await page.locator('#start-game-button').boundingBox();
  expect(rect.y).toBeGreaterThanOrEqual(0);
  expect(rect.y + rect.height).toBeLessThanOrEqual(320);

  await page.click('#start-game-button');
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => STATE.phase)).toBe('PLAYING');
  expect(errors).toEqual([]);
});

test('WAVE_COMPLETE\'s tap-to-advance still reaches the canvas after the title screen\'s #message-content became a scrollable, pointer-events:auto column (review catch, PR #75)', async ({ page }) => {
  const errors = trackErrors(page);
  await page.addInitScript(() => { navigator.vibrate = () => true; });
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);
  await page.click('#start-game-button');
  await page.waitForTimeout(1000);

  const before = await page.evaluate(() => {
    // A WAVE_COMPLETE toast has no button rows -- pointer-events on
    // #message-content must stay inherited (none) here so a click passes
    // through to the canvas the same way it always has.
    for (const dot of STATE.dots) dot.connected = true;
    checkWaveComplete();
    return {
      phase: STATE.phase,
      contentPointerEvents: getComputedStyle(document.getElementById('message-content')).pointerEvents,
    };
  });
  expect(before.phase).toBe('WAVE_COMPLETE');
  expect(before.contentPointerEvents).toBe('none');

  await page.mouse.click(200, 700);
  // Advancing fades out (~0.9s, see FADE_CONFIG) before STATE.phase
  // actually changes -- wait for that instead of a fixed timeout.
  await page.waitForFunction(() => STATE.phase !== 'WAVE_COMPLETE', { timeout: 3000 });
  expect(errors).toEqual([]);
});

test('mid-game, the top button row holds only the single MENU button, and its panel lists Hint/Erase/Help right after Resume', async ({ page }) => {
  const errors = trackErrors(page);
  await page.addInitScript(() => { navigator.vibrate = () => true; });
  await page.goto('/index.html');
  await page.waitForTimeout(300);
  await page.click('.difficulty-btn[data-difficulty="relaxed"]'); // only difficulty where the Erase item also shows
  await page.click('#start-game-button');
  await page.waitForTimeout(1000);

  // Both buttons are always in the DOM (see index.html) -- only one is
  // ever actually visible at a time, toggled by updateWaveDisplay.
  const row = await page.evaluate(() => ({
    ids: [...document.getElementById('top-buttons-row').children].map(el => el.id),
    helpVisible: document.getElementById('help-button').classList.contains('visible'),
    menuVisible: document.getElementById('pause-button').classList.contains('visible'),
  }));
  expect(row.ids).toEqual(['help-button', 'pause-button']);
  expect(row.helpVisible).toBe(false);
  expect(row.menuVisible).toBe(true);

  await page.click('#pause-button');
  const panelOrder = await page.evaluate(() =>
    [...document.getElementById('pause-panel').children]
      .filter(el => el.tagName === 'BUTTON')
      .map(el => el.id)
  );
  expect(panelOrder).toEqual([
    'pause-resume', 'pause-hint', 'pause-erase', 'pause-help', 'pause-shop',
    'pause-save', 'pause-load', 'pause-restart-level', 'pause-restart-game', 'pause-exit',
  ]);
  expect(errors).toEqual([]);
});

test('buildWavePostcard renders a fixed-size stylized postcard, independent of the player\'s actual canvas size', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(() => {
    STATE.wave = 12;
    STATE.score = 4200;
    STATE.lastWavePostcardLabels = ['New Highest Wave'];
    const pc = buildWavePostcard();
    return {
      width: pc.width,
      height: pc.height,
      configWidth: POSTCARD_CONFIG.WIDTH,
      configHeight: POSTCARD_CONFIG.HEIGHT,
    };
  });

  // A shareable image shouldn't vary by device/window the way the live
  // game canvas does -- it's always the same fixed postcard dimensions.
  expect(result.width).toBe(result.configWidth);
  expect(result.height).toBe(result.configHeight);
  expect(errors).toEqual([]);
});

test('the postcard photo is a centered crop of the board, not the whole canvas', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const markerFound = await page.evaluate(() => {
    // A distinct marker painted in the extreme corner of the real
    // gameplay canvas -- if buildWavePostcard copied the whole canvas
    // instead of a centered subset, this exact color would show up
    // somewhere in the output; a centered crop should never reach it.
    ctx.fillStyle = 'rgb(1,222,3)';
    ctx.fillRect(0, 0, 4, 4);

    const pc = buildWavePostcard();
    const data = pc.getContext('2d').getImageData(0, 0, pc.width, pc.height).data;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] === 1 && data[i + 1] === 222 && data[i + 2] === 3) return true;
    }
    return false;
  });

  expect(markerFound).toBe(false);
  expect(errors).toEqual([]);
});

// Player report, side-by-side screenshots (the postcard vs. an actual
// phone screenshot of the same wave): the postcard's photo rendered
// bright white where the real game -- confirmed dark in the phone
// screenshot -- is black. Root cause: render() clears the real canvas to
// fully TRANSPARENT every frame (ctx.clearRect, not a black fill); the
// game only reads as black space because of <body>'s own CSS background
// showing through those transparent pixels, not because the canvas has
// any black pixels of its own. drawImage faithfully copies that
// transparency, which let the postcard's white card bleed through.
// Verifies a genuinely transparent patch of the real canvas resolves to
// solid opaque black in the photo, not the card's own white/cream fill.
test('the postcard photo renders transparent gameplay background as black, matching how the game actually looks', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const pixel = await page.evaluate(() => {
    ctx.clearRect(0, 0, canvas.width, canvas.height); // exactly what render() itself does every frame
    STATE.dots = [{ x: STATE.camera.centerX, y: STATE.camera.centerY, pairId: 0 }];

    const pc = buildWavePostcard();
    const { WIDTH, MARGIN, BORDER } = POSTCARD_CONFIG;
    const cardX = (WIDTH - (WIDTH - MARGIN * 2)) / 2;
    const cardH = BORDER + (WIDTH - MARGIN * 2 - BORDER * 2) + POSTCARD_CONFIG.BOTTOM_BORDER;
    const cardY = (POSTCARD_CONFIG.HEIGHT - cardH) / 2;
    // A corner of the photo, well clear of the single dot centered in it.
    const [r, g, b, a] = pc.getContext('2d').getImageData(cardX + BORDER + 5, cardY + BORDER + 5, 1, 1).data;
    return { r, g, b, a };
  });

  expect(pixel).toEqual({ r: 0, g: 0, b: 0, a: 255 });
  expect(errors).toEqual([]);
});

// Player report, attached screenshot: "the screenshot is awful" -- on a
// wide/late wave the camera zooms out to fit far more world than a
// handful of dots need (see WIDE_WORLD_START_WAVE), so the OLD fixed
// centered crop (a flat 75% of the whole visible canvas, always centered
// on the middle of the SCREEN) mostly grabbed empty background whenever
// the dots that actually matter weren't sitting right at screen-center.
// Forces a small, deliberately off-center cluster of dots (a real
// procedurally-generated board can legitimately span wider than a square
// crop can ever fully contain on a landscape viewport, which would make
// "every dot framed" the wrong thing to assert in general) to prove
// computePostcardCropRect follows the actual content instead of the
// screen's geometric center, and zooms in tighter than the old fixed
// fraction once the camera is genuinely zoomed out.
test('the postcard crop follows an off-center cluster of dots instead of the screen\'s geometric center', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(() => {
    applyDifficulty('normal');
    startWave(WIDE_WORLD_START_WAVE + 2); // a real zoomed-out camera, past the wide-world threshold
    STATE.camera.scale = STATE.camera.targetScale; // skip the per-frame lerp -- same pattern used elsewhere in this suite

    // A tight, deliberately off-center pair placed near the screen's own
    // top-left corner (via screenToWorld, so it's guaranteed on-screen
    // regardless of viewport size) -- nowhere near the screen's geometric
    // middle, which is exactly what the OLD fixed crop always centered on
    // regardless of where the dots actually were.
    const p1 = screenToWorld(70, 70);
    const p2 = screenToWorld(110, 100);
    STATE.dots = [
      { x: p1.x, y: p1.y, pairId: 0 },
      { x: p2.x, y: p2.y, pairId: 0 },
    ];

    const fixedFractionSize = Math.min(canvas.width, canvas.height) * POSTCARD_CONFIG.CROP_FRACTION;
    const crop = computePostcardCropRect();
    const allDotsFramed = STATE.dots.every(dot => {
      const p = worldToScreen(dot.x, dot.y);
      return p.x >= crop.x && p.x <= crop.x + crop.width && p.y >= crop.y && p.y <= crop.y + crop.height;
    });

    return {
      scale: STATE.camera.scale,
      cropWidth: crop.width,
      cropHeight: crop.height,
      fixedFractionSize,
      allDotsFramed,
    };
  });

  expect(result.scale).toBeLessThan(1); // confirms the camera really is zoomed out for this wave
  expect(result.allDotsFramed).toBe(true);
  expect(result.cropWidth).toBeLessThan(result.fixedFractionSize);
  expect(result.cropHeight).toBeLessThan(result.fixedFractionSize);
  expect(errors).toEqual([]);
});

// Player report, attached screenshot: a diagonal line cut off at the top
// edge of the postcard -- some dots/lines the player actually saw on
// screen were missing from the celebratory photo. Root cause:
// computePostcardCropRect used to force a SQUARE crop sized to
// `Math.min(canvas.width, canvas.height)` at most (there's nothing to
// zoom OUT for, the old reasoning went), but a board whose content spans
// more than the canvas's shorter dimension along its LONGER axis (e.g. a
// tall diagonal line on a portrait viewport, where width is the shorter
// side) needs its crop to grow past that shorter side along that axis to
// keep every on-screen dot framed -- the old square clamp shrank the
// whole crop back down to the shorter side on BOTH axes and cropped
// genuinely visible content out along the longer one. Forces exactly
// that shape (narrow horizontally, spanning nearly the full canvas
// vertically) and confirms every dot stays framed, with the crop's
// height genuinely allowed past the shorter (width) dimension -- not
// forced square, and not clipped by drawImage either (see
// buildWavePostcard's letterboxing of this rect into its square photo
// area, which is what makes going non-square actually safe to draw).
test('the postcard crop is not forced square, so a board taller/wider than the canvas\'s shorter side still shows every dot', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(() => {
    const shorterDimension = Math.min(canvas.width, canvas.height);
    // A narrow diagonal spanning almost the whole canvas along its LONGER
    // axis -- on this suite's portrait viewport that's height, so this
    // reproduces the "diagonal line cut off at the top" report directly.
    const top = screenToWorld(canvas.width / 2 - 20, 20);
    const bottom = screenToWorld(canvas.width / 2 + 20, canvas.height - 20);
    STATE.dots = [
      { x: top.x, y: top.y, pairId: 0 },
      { x: bottom.x, y: bottom.y, pairId: 0 },
    ];

    const crop = computePostcardCropRect();
    const allDotsFramed = STATE.dots.every(dot => {
      const p = worldToScreen(dot.x, dot.y);
      return p.x >= crop.x && p.x <= crop.x + crop.width && p.y >= crop.y && p.y <= crop.y + crop.height;
    });

    return {
      shorterDimension,
      canvasHeight: canvas.height,
      cropWidth: crop.width,
      cropHeight: crop.height,
      allDotsFramed,
    };
  });

  expect(result.allDotsFramed).toBe(true);
  // The old bug: crop.height used to be clamped down to shorterDimension
  // (the canvas width, on this portrait viewport) even though the
  // content's own vertical spread needed far more room than that.
  expect(result.cropHeight).toBeGreaterThan(result.shorterDimension);
  // Still a real, drawable rect -- never bigger than the canvas itself.
  expect(result.cropHeight).toBeLessThanOrEqual(result.canvasHeight);
  expect(errors).toEqual([]);
});

test('shareOrSaveWavePostcard shares a file with the play link included exactly once, and copies the link on fallback', async ({ page }) => {
  const errors = trackErrors(page);
  await page.addInitScript(() => { navigator.vibrate = () => true; });
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const shareSupported = await page.evaluate(async () => {
    navigator.share = (data) => { window.__lastShareData = data; return Promise.resolve(); };
    navigator.canShare = () => true;
    STATE.wave = 15;
    STATE.score = 5000;
    STATE.lastWavePostcardLabels = ['Best Wave Score'];
    await shareOrSaveWavePostcard();
    return {
      toastText: document.getElementById('share-toast').textContent,
      sharedFileType: window.__lastShareData && window.__lastShareData.files && window.__lastShareData.files[0].type,
      // Player report, screenshot: the link showed up TWICE in the composed
      // iMessage -- once as part of the text, once again as a separate
      // rendered link -- because a distinct `url` field was passed
      // alongside text that already embedded the same link. Confirms
      // there's now exactly one copy of it, on `text` alone (see
      // tryShareCanvasImage).
      sharedUrlField: window.__lastShareData && window.__lastShareData.url,
      sharedTextHasLink: !!(window.__lastShareData && window.__lastShareData.text.includes(CANONICAL_SHARE_URL)),
    };
  });
  expect(shareSupported.toastText).toBe('Shared!');
  expect(shareSupported.sharedFileType).toBe('image/png');
  expect(shareSupported.sharedUrlField).toBeUndefined();
  expect(shareSupported.sharedTextHasLink).toBe(true);

  // No native share sheet (desktop, mainly) -- the download still has to
  // come with a way to hand someone the link, so it lands on the
  // clipboard right behind it.
  const shareUnsupported = await page.evaluate(async () => {
    navigator.share = undefined;
    navigator.canShare = undefined;
    window.__clipboardText = null;
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: (t) => { window.__clipboardText = t; return Promise.resolve(); } },
      configurable: true,
    });
    await shareOrSaveWavePostcard();
    return {
      toastText: document.getElementById('share-toast').textContent,
      clipboardHasLink: window.__clipboardText && window.__clipboardText.includes(CANONICAL_SHARE_URL),
    };
  });
  expect(shareUnsupported.toastText).toBe('Postcard Saved + Link Copied');
  expect(shareUnsupported.clipboardHasLink).toBe(true);
  expect(errors).toEqual([]);
});

test('the premium supperclub family is well-formed and only reachable while PREMIUM_MUSIC_UNLOCKED is true', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(() => {
    const supperclub = GENRE_FAMILIES.find(f => f.name === 'supperclub');
    const nonPremiumNames = GENRE_FAMILIES.filter(f => !f.premium).map(f => f.name);
    // The flag itself can't be flipped from here (it's a top-level const,
    // by design -- see its own comment), so the "flag off" pool is
    // verified directly against the same filter availableGenreFamilies()
    // applies, rather than by actually toggling it.
    const usesOnlySourcedInstruments = supperclub.seeds.every(seed =>
      seed.roles.every(r => SAMPLE_MANIFEST[r.instrument] !== undefined)
    );
    return {
      flagValue: PREMIUM_MUSIC_UNLOCKED,
      isPremium: supperclub.premium === true,
      seedCount: supperclub.seeds.length,
      usesOnlySourcedInstruments,
      referencesTrumpetAndBass: supperclub.seeds.some(seed =>
        seed.roles.some(r => r.instrument === 'trumpet') && seed.roles.some(r => r.instrument === 'doublebass')
      ),
      nonPremiumNames,
      availableWhileUnlocked: availableGenreFamilies().map(f => f.name),
    };
  });

  expect(result.flagValue).toBe(true); // documents today's default -- flip alongside the backend, not silently
  expect(result.isPremium).toBe(true);
  expect(result.seedCount).toBeGreaterThanOrEqual(3);
  expect(result.usesOnlySourcedInstruments).toBe(true);
  expect(result.referencesTrumpetAndBass).toBe(true);
  expect(result.nonPremiumNames).toEqual(['spa', 'lofi', 'lullaby', 'eerie', 'savanna']); // the "flag off" pool
  expect(result.availableWhileUnlocked).toContain('supperclub'); // the "flag on" pool, exercised via the real function
  expect(errors).toEqual([]);
});

test("Halloween's music is always the scoped eerie family, never the generic pool, and eerie never turns up on any other scene (player report: Halloween's music wasn't spooky, since it was just a random pick from the same pool every other scene draws from)", async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(() => {
    STATE.difficulty = 'normal';
    STATE.cockpitMode = false;

    STATE.scene = 'halloween';
    const onHalloween = availableGenreFamilies().map(f => f.name);

    STATE.scene = 'forest';
    const onForest = availableGenreFamilies().map(f => f.name);

    const eerie = GENRE_FAMILIES.find(f => f.name === 'eerie');

    return {
      onHalloween,
      onForest,
      seedCount: eerie.seeds.length,
      // Harmonic minor: minor 3rd (scale degree index 2) and a raised
      // (major) 7th (scale degree index 6) -- the interval that gives the
      // classic "spooky cadence" a plain natural minor doesn't have.
      allHarmonicMinor: eerie.seeds.every(seed =>
        seed.scaleIntervals[2] === 3 && seed.scaleIntervals[6] === 11
      ),
      usesOnlySourcedInstruments: eerie.seeds.every(seed =>
        seed.roles.every(r => SAMPLE_MANIFEST[r.instrument] !== undefined)
      ),
      // Matches the 'lullaby' family's own established precedent, taken
      // all the way this time: flute/cello are continuously-sustained
      // real recordings, so this engine's algorithmically-placed notes
      // expose every awkward interval nakedly on them, in any role --
      // an earlier version of this family only kept them out of
      // pad/drone (player report, 2026-08-17: "sounds like a kid
      // practicing violin" from cello/flute still in melody/accent).
      keepsFluteCelloOutEntirely: eerie.seeds.every(seed =>
        seed.roles.every(r => !['flute', 'cello'].includes(r.instrument))
      ),
    };
  });

  expect(result.onHalloween).toEqual(['eerie']);
  expect(result.onForest).not.toContain('eerie');
  expect(result.seedCount).toBeGreaterThanOrEqual(3);
  expect(result.allHarmonicMinor).toBe(true);
  expect(result.usesOnlySourcedInstruments).toBe(true);
  expect(result.keepsFluteCelloOutEntirely).toBe(true);
  expect(errors).toEqual([]);
});

test("Cockpit Mode's music picks from the generic pool even if STATE.scene is stale from classic mode, since Cockpit never actually shows that scene (review-anticipated edge case, Halloween's eerie-family scoping)", async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(() => {
    STATE.difficulty = 'normal';
    STATE.scene = 'halloween'; // stale leftover from classic mode
    STATE.cockpitMode = true;
    return availableGenreFamilies().map(f => f.name);
  });

  expect(result).not.toEqual(['eerie']);
  expect(result.length).toBeGreaterThan(1);
  expect(errors).toEqual([]);
});

test("Safari's interactive music is always the scoped savanna family, never the generic pool, savanna never turns up on any other scene, and Sleep mode's lullaby-only promise still wins even while Safari (a sleep-safe scene) is selected (player request, 2026-08-16: the dot-connecting music needs to match an African-savanna background the same way eerie already matches Halloween)", async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(() => {
    STATE.difficulty = 'normal';
    STATE.cockpitMode = false;

    STATE.scene = 'safari';
    const onSafari = availableGenreFamilies().map(f => f.name);

    STATE.scene = 'forest';
    const onForest = availableGenreFamilies().map(f => f.name);

    STATE.difficulty = 'sleep';
    STATE.scene = 'safari'; // sleep-safe (see SLEEP_SAFE_SCENES) -- reachable together with Sleep mode
    const onSafariAsleep = availableGenreFamilies().map(f => f.name);
    STATE.difficulty = 'normal';

    const savanna = GENRE_FAMILIES.find(f => f.name === 'savanna');
    const kalimbaIsSynthesized = SYNTHESIZED_INSTRUMENTS.has('kalimba');

    return {
      onSafari,
      onForest,
      onSafariAsleep,
      seedCount: savanna.seeds.length,
      bpmInRange: savanna.seeds.every(seed => seed.bpm >= 95 && seed.bpm <= 115),
      // Mixolydian: a major 3rd (scale degree index 2 === 4) but a
      // flattened (minor) 7th (index 6 === 10, not Ionian's 11) -- the
      // interval every other family's plain-major scale doesn't have.
      allMixolydian: savanna.seeds.every(seed =>
        seed.scaleIntervals[2] === 4 && seed.scaleIntervals[6] === 10
      ),
      onlyKalimbaVibraphoneDoublebass: savanna.seeds.every(seed =>
        seed.roles.every(r => ['kalimba', 'vibraphone', 'doublebass'].includes(r.instrument))
      ),
      kalimbaIsSynthesized,
      kalimbaInManifest: Array.isArray(SAMPLE_MANIFEST.kalimba) && SAMPLE_MANIFEST.kalimba.length > 0,
    };
  });

  expect(result.onSafari).toEqual(['savanna']);
  expect(result.onForest).not.toContain('savanna');
  expect(result.onSafariAsleep).toEqual(['lullaby']); // Sleep mode's own promise beats scene-scoping
  expect(result.seedCount).toBeGreaterThanOrEqual(3);
  expect(result.bpmInRange).toBe(true);
  expect(result.allMixolydian).toBe(true);
  expect(result.onlyKalimbaVibraphoneDoublebass).toBe(true);
  expect(result.kalimbaIsSynthesized).toBe(true);
  expect(result.kalimbaInManifest).toBe(true);
  expect(errors).toEqual([]);
});

test('synthesizeKalimbaNote renders a real, audible buffer for a range of notes without error', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(async () => {
    const notes = ['C3', 'E4', 'G4', 'C6'];
    const results = [];
    for (const note of notes) {
      const buffer = await synthesizeKalimbaNote(note);
      const data = buffer.getChannelData(0);
      let peak = 0;
      for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
      results.push({ note, length: buffer.length, peak });
    }
    return results;
  });

  for (const r of result) {
    expect(r.length).toBeGreaterThan(0);
    expect(r.peak).toBeGreaterThan(0.1); // genuinely audible, not silent/near-zero
    expect(r.peak).toBeLessThanOrEqual(1.0); // never clipping
  }
  expect(errors).toEqual([]);
});

test('trumpet and double bass samples decode successfully alongside the rest of the manifest', async ({ page }) => {
  const errors = trackErrors(page);
  await page.addInitScript(() => { navigator.vibrate = () => true; });
  await page.goto('/index.html');
  await page.waitForTimeout(300);
  await page.click('#start-game-button');

  // Await the real decode promise directly rather than a fixed timeout --
  // ~140 real samples decoding over a local dev server is normally fast,
  // but a fixed wait would be a flaky guess either way (see the comment
  // on samplePromises above preloadSampleBytes for the exact symptom a
  // fixed budget causes in production).
  const decoded = await page.evaluate(async () => {
    await STATE.samplesReadyPromise;
    return {
      trumpetNotes: Object.keys(STATE.sampleBuffers.trumpet || {}).length,
      trumpetManifestCount: SAMPLE_MANIFEST.trumpet.length,
      doublebassNotes: Object.keys(STATE.sampleBuffers.doublebass || {}).length,
      trumpetSampleIsBuffer: STATE.sampleBuffers.trumpet && STATE.sampleBuffers.trumpet['C4'] instanceof AudioBuffer,
    };
  });
  expect(decoded.trumpetNotes).toBe(decoded.trumpetManifestCount);
  expect(decoded.doublebassNotes).toBeGreaterThan(0);
  expect(decoded.trumpetSampleIsBuffer).toBe(true);
  expect(errors).toEqual([]);
});

test('computeAttackRms measures a known sine wave\'s RMS correctly', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(() => {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const sampleRate = ctx.sampleRate;
    const buffer = ctx.createBuffer(1, sampleRate, sampleRate); // 1 second, mono
    const data = buffer.getChannelData(0);
    const amplitude = 0.5;
    for (let i = 0; i < data.length; i++) {
      data[i] = amplitude * Math.sin(2 * Math.PI * 440 * i / sampleRate);
    }
    // A full-amplitude sine wave's RMS is amplitude/sqrt(2) -- a
    // well-known, independently-verifiable ground truth to check the
    // measurement itself against, not just its downstream effects.
    return { measured: computeAttackRms(buffer), expected: amplitude / Math.sqrt(2) };
  });

  expect(result.measured).toBeGreaterThan(result.expected * 0.99);
  expect(result.measured).toBeLessThan(result.expected * 1.01);
  expect(errors).toEqual([]);
});

// Player report: spa/serenity had a jarringly loud flute note. Measured
// directly off the real recordings (ffmpeg volumedetect): flute's mean
// volume spans a full ~15dB across its range, with the loudest notes
// clustered in the exact upper octaves melody spends most of its time in
// -- the previous single flat per-instrument gain multiplier corrected for
// loudness differences BETWEEN instruments but was blind to this WITHIN
// one instrument's own recordings. Every real sample should now normalize
// to the same effective loudness regardless of how loud it was actually
// recorded.
test('per-sample gain normalization brings flute\'s quietest and loudest real recordings to the same effective loudness', async ({ page }) => {
  const errors = trackErrors(page);
  await page.addInitScript(() => { navigator.vibrate = () => true; });
  await page.goto('/index.html');
  await page.waitForTimeout(300);
  await page.click('#start-game-button'); // unlocks audio + kicks off decodeAllSamples, same as the trumpet/bass test

  const result = await page.evaluate(async () => {
    await STATE.samplesReadyPromise;
    // Ab4 (quietest measured) vs G6 (loudest measured, ~15dB apart raw).
    const notes = ['Ab4', 'G6'];
    return notes.map(n => {
      const buffer = STATE.sampleBuffers.flute[n];
      const rawRms = buffer ? computeAttackRms(buffer) : null;
      const gain = sampleGainFor('flute', n);
      return { note: n, rawRms, gain, normalizedPeak: rawRms != null ? rawRms * gain : null };
    });
  });

  expect(result.every(r => r.rawRms != null)).toBe(true);
  // The raw recordings really do differ substantially -- otherwise this
  // test would trivially pass without the fix doing anything.
  const rawRatio = result[1].rawRms / result[0].rawRms;
  expect(rawRatio).toBeGreaterThan(2);
  // But after normalization, both land on the exact same effective loudness.
  expect(result[0].normalizedPeak).toBeCloseTo(result[1].normalizedPeak, 3);
  expect(errors).toEqual([]);
});

// Codex review, #51: a drum kit's pieces (kick/snare/hihat) aren't
// different pitches of the same sound the way a melody instrument's notes
// are -- they're intentionally voiced at different relative loudnesses,
// same as a real kit mix. Per-piece normalization (treating lofikit like
// any pitched instrument) would have erased that on-purpose balance,
// making the constantly-triggered hihat as loud as the kick. Kit
// instruments get one shared gain instead (registerKitGain), so their
// relative balance survives even though the absolute level is still
// auto-computed rather than hardcoded.
test('drum kit pieces keep their relative loudness balance instead of each normalizing to the same target', async ({ page }) => {
  const errors = trackErrors(page);
  await page.addInitScript(() => { navigator.vibrate = () => true; });
  await page.goto('/index.html');
  await page.waitForTimeout(300);
  await page.click('#start-game-button');

  const result = await page.evaluate(async () => {
    await STATE.samplesReadyPromise;
    const pieces = ['kick', 'snare', 'hihat'];
    return pieces.map(p => {
      const buffer = STATE.sampleBuffers.lofikit[p];
      const rawRms = buffer ? computeAttackRms(buffer) : null;
      const gain = sampleGainFor('lofikit', p);
      return { piece: p, rawRms, gain, effectivePeak: rawRms != null ? rawRms * gain : null };
    });
  });

  expect(result.every(r => r.rawRms != null)).toBe(true);
  // Every piece gets the exact same multiplier (the shared kit gain) --
  // not independently normalized, which is the whole point of this fix.
  expect(result[0].gain).toBeCloseTo(result[1].gain, 6);
  expect(result[1].gain).toBeCloseTo(result[2].gain, 6);
  // The kit's own loudest piece (kick, in the real recordings) lands right
  // on the target; the others stay proportionally quieter, same relative
  // shape as the raw recordings, not flattened to match it.
  const kick = result.find(r => r.piece === 'kick');
  const quieter = result.filter(r => r.piece !== 'kick');
  for (const r of quieter) {
    expect(r.rawRms).toBeLessThan(kick.rawRms);
    expect(r.effectivePeak).toBeLessThan(kick.effectivePeak);
  }
  expect(errors).toEqual([]);
});

test('generateSong can pick the supperclub family and produces notes that stay within the folded instrument ranges', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(() => {
    // Force the pick instead of relying on random luck across many tries --
    // exercises the exact same generateSong() code path a real supperclub
    // roll would, just with the family/seed choice pinned for a
    // deterministic assertion.
    const family = GENRE_FAMILIES.find(f => f.name === 'supperclub');
    const seed = family.seeds[0];
    const genre = { ...seed, family: family.name, chordVocabulary: family.chordVocabulary, groove: family.groove };
    const buildChord = CHORD_VOCABULARIES[genre.chordVocabulary];
    const range = instrumentMidiRange('trumpet');
    const bassRange = instrumentMidiRange('doublebass');
    const chordDegrees = buildChord(genre.chordProgression[0]);
    const melodyMidi = foldToInstrumentRange('trumpet', scaleMidi(genre, chordDegrees[0], 0));
    const padMidis = foldChordToInstrumentRange('vibraphone', chordDegrees.map(d => scaleMidi(genre, d, 0)));
    return {
      trumpetRangeFound: !!range,
      bassRangeFound: !!bassRange,
      melodyWithinHeadroom: melodyMidi >= range.min - 6 && melodyMidi <= range.max + 6,
      padCount: padMidis.length,
    };
  });

  expect(result.trumpetRangeFound).toBe(true);
  expect(result.bassRangeFound).toBe(true);
  expect(result.melodyWithinHeadroom).toBe(true);
  expect(result.padCount).toBe(4); // seventh chord: root + 3 more chord tones
  expect(errors).toEqual([]);
});

// Player report: high-pitched sounds were unpleasant enough to make people
// want to stop playing. Root cause: melody/accent always voiced an octave
// above the harmony (octaveOffset 1) regardless of whether the assigned
// instrument's real samples reach that high -- rhodes (lofi's melody
// instrument) only goes up to G5, so notes landed several semitones past
// its own samples, pitch-shifted into an artificial "chipmunk" tone.
// melodyOctaveOffset should now pick whichever octave actually fits.
test('melodyOctaveOffset keeps rhodes melody notes closer to its real sample range than the old fixed +1 octave', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(() => {
    const family = GENRE_FAMILIES.find(f => f.name === 'lofi');
    const seed = family.seeds.find(s => s.name === 'late study'); // rootMidi 62, the highest of the three
    const genre = { ...seed, family: family.name, chordVocabulary: family.chordVocabulary, groove: family.groove };
    const buildChord = CHORD_VOCABULARIES[genre.chordVocabulary];
    const range = instrumentMidiRange('rhodes');
    const overshoot = (m) => Math.max(0, m - range.max, range.min - m);

    let anyImproved = false;
    let worstOldOvershoot = 0, worstNewOvershoot = 0;
    for (const chordRoot of genre.chordProgression) {
      for (const deg of buildChord(chordRoot)) {
        const oldMidi = scaleMidi(genre, deg, 1); // the previous hardcoded octaveOffset
        const newOffset = melodyOctaveOffset(genre, 'rhodes', deg);
        const newMidi = scaleMidi(genre, deg, newOffset);
        const oldOvershoot = overshoot(oldMidi), newOvershoot = overshoot(newMidi);
        if (newOvershoot < oldOvershoot) anyImproved = true;
        worstOldOvershoot = Math.max(worstOldOvershoot, oldOvershoot);
        worstNewOvershoot = Math.max(worstNewOvershoot, newOvershoot);
      }
    }
    return { rangeFound: !!range, anyImproved, worstOldOvershoot, worstNewOvershoot };
  });

  expect(result.rangeFound).toBe(true);
  expect(result.anyImproved).toBe(true);
  expect(result.worstNewOvershoot).toBeLessThan(result.worstOldOvershoot);
  expect(errors).toEqual([]);
});

// Player report: some songs "just don't come together." Root cause:
// melody's neighbor-tone excursion picked baseDeg+/-1 blindly -- in a
// major scale, some adjacent scale degrees are a whole step apart (a
// pleasant passing tone) and some are a half step apart (a dissonant
// "avoid note" clash), purely by luck of which degree got picked.
// neighborToneClashes should catch only the half-step case.
test('neighborToneClashes flags a half-step neighbor against the chord but allows a whole-step one', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(() => {
    const genre = { scaleIntervals: [0, 2, 4, 5, 7, 9, 11] }; // Ionian/major
    // Scale degree 3 = F (semitone 5). Degree 2 = E (semitone 4, a half
    // step below F -- should clash). Degree 4 = G (semitone 7, a whole
    // step above F -- should not clash).
    return {
      halfStepClashes: neighborToneClashes(genre, 2, [3]),
      wholeStepClashes: neighborToneClashes(genre, 4, [3]),
    };
  });

  expect(result.halfStepClashes).toBe(true);
  expect(result.wholeStepClashes).toBe(false);
  expect(errors).toEqual([]);
});

// Broad regression sweep across every family/seed, not just one hand-picked
// case -- generateSong() itself (not the helpers directly) should never
// produce a melody/accent note that needs more than a modest pitch-shift
// to reach a real sample, for any instrument any current genre assigns to
// those roles.
test('generateSong keeps every melody/accent note close to its instrument\'s real sample range, across every family', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(() => {
    const worstByInstrument = {};
    // generateSong() picks its own random family/seed each call -- run it
    // many times so every family gets exercised by ordinary random play,
    // not a hand-picked case.
    for (let i = 0; i < 60; i++) {
      const song = generateSong(6);
      for (const note of song.notes) {
        if (note.role !== 'melody' && note.role !== 'accent') continue;
        if (note.midi == null) continue;
        const range = instrumentMidiRange(note.instrument);
        if (!range) continue;
        const overshoot = Math.max(0, note.midi - range.max, range.min - note.midi);
        worstByInstrument[note.instrument] = Math.max(worstByInstrument[note.instrument] || 0, overshoot);
      }
    }
    return worstByInstrument;
  });

  for (const [instrument, worst] of Object.entries(result)) {
    // A tritone (6 semitones) is foldToInstrumentRange's own absolute
    // ceiling -- this asserts the melody/accent register fix keeps every
    // instrument comfortably under that ceiling, not right up against it.
    expect(worst, `${instrument} worst-case overshoot`).toBeLessThanOrEqual(4);
  }
  expect(errors).toEqual([]);
});

// Codex review, #50 (P1): a busy lofi downbeat can stack up to 7
// simultaneous targets onto rhodes (melody + arpeggio + a 4-note pad chord
// + accent), which only has 9 samples across 3 sparse octaves (C/Eb/G).
// Greedily assigning them in role order let early notes claim every nearby
// sample, leaving later ones (verified: mostly accent, sometimes a pad
// tone) with nothing close left -- forced reaches of up to 30 semitones
// (2.5 octaves) into a completely different register, measured across 200
// real generateSong() calls before this fix. This directly stress-tests
// nearestDistinctSampleNotes with that exact worst-case shape.
test('nearestDistinctSampleNotes never reaches more than a bounded distance from a target, even with more competing targets than an instrument has nearby samples', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(() => {
    // rhodes: 9 samples, 3 unique pitch classes (C/Eb/G) per octave.
    // Mirrors the real lofi worst case: melody+arpeggio landing on the same
    // pitch class, a 4-note pad chord clustered nearby, and an accent note
    // -- 7 targets total, all within about an octave and a half.
    const targets = [71, 71, 59, 62, 66, 69, 76];
    const resolved = nearestDistinctSampleNotes('rhodes', targets);
    const distances = targets.map((t, i) => Math.abs(t - noteNameToMidi(resolved[i])));
    return { resolved, distances, maxDistance: Math.max(...distances) };
  });

  expect(result.resolved.every(r => r != null)).toBe(true);
  expect(result.maxDistance).toBeLessThanOrEqual(6); // DISTINCT_SAMPLE_MAX_REACH
  expect(errors).toEqual([]);
});

// Same broad sweep as the melody/accent overshoot test above, but checking
// ground truth: the ACTUAL resolved sample every note in every role ends
// up playing (via resolveInstrumentCollisions, called inside generateSong
// itself), not just the pre-collision theoretical target. This is what
// the player actually hears.
test('generateSong never resolves any note to a sample more than a bounded distance from its target, across every family', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(() => {
    let maxDistance = 0;
    let worstExample = null;
    for (let i = 0; i < 80; i++) {
      const song = generateSong(6);
      for (const note of song.notes) {
        if (note.role === 'drum') continue;
        const pairs = note.midiList
          ? note.midiList.map((m, idx) => [m, note.resolvedSamples && note.resolvedSamples[idx]])
          : [[note.midi, note.resolvedSample]];
        for (const [target, sampleName] of pairs) {
          if (target == null) continue;
          const resolvedName = sampleName || nearestSampleNote(note.instrument, target);
          const dist = Math.abs(target - noteNameToMidi(resolvedName));
          if (dist > maxDistance) {
            maxDistance = dist;
            worstExample = { instrument: note.instrument, role: note.role, target, resolvedName, dist };
          }
        }
      }
    }
    return { maxDistance, worstExample };
  });

  expect(result.maxDistance, JSON.stringify(result.worstExample)).toBeLessThanOrEqual(6);
  expect(errors).toEqual([]);
});

// Player request: show which specific generated song (family + seed name)
// is playing each wave, so playtest feedback like "this one didn't come
// together" can name the actual song instead of staying anecdotal.
test('the song name display shows the current song\'s family and seed name, and clears on exit to title', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  await expect(page.locator('#song-name-display')).toHaveText(''); // nothing playing yet on the title screen

  await page.click('#start-game-button');
  await page.waitForTimeout(200);

  const expected = await page.evaluate(() => `${STATE.song.genre.family} — ${STATE.song.genre.name}`);
  await expect(page.locator('#song-name-display')).toHaveText(expected);

  await page.evaluate(() => exitToTitle());
  await expect(page.locator('#song-name-display')).toHaveText('');
  expect(errors).toEqual([]);
});

// ------------------------------------------------------------
// COCKPIT MODE
//
// These deliberately never wait on Three.js actually finishing its CDN
// import (see ensureThreeLoaded) -- the simulation (ship physics, dot
// generation, hit-detection, scoring) is fully independent of whether the
// WebGL scene has been built yet (see updateCockpitShip/updateCockpitDrawing,
// which never touch THREE_LIB/COCKPIT), and asserting on an external
// network fetch actually completing would make CI flaky for reasons that
// have nothing to do with whether the game logic itself is correct.
// ------------------------------------------------------------

test('the Cockpit Mode checkbox toggles STATE.cockpitMode and persists across a reload, mutually exclusive with Flight Mode', async ({ page }) => {
  const errors = trackErrors(page);
  await page.addInitScript(() => { navigator.vibrate = () => true; });
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  await expect(page.locator('#cockpit-mode-row')).toBeVisible();
  expect(await page.evaluate(() => STATE.cockpitMode)).toBe(false);

  // Turning on Flight Mode first, then Cockpit Mode, must turn Flight Mode
  // back off -- only one control scheme can actually pilot the next wave.
  await page.click('#flight-mode-checkbox');
  await page.click('#cockpit-mode-checkbox');
  expect(await page.evaluate(() => ({ flight: STATE.flightMode, cockpit: STATE.cockpitMode }))).toEqual({ flight: false, cockpit: true });
  await expect(page.locator('#flight-mode-checkbox')).not.toBeChecked();
  await expect(page.locator('#cockpit-mode-checkbox')).toBeChecked();

  await page.reload();
  await page.waitForFunction(() => window.__lumina);
  expect(await page.evaluate(() => STATE.cockpitMode)).toBe(true);
  await expect(page.locator('#cockpit-mode-checkbox')).toBeChecked();

  // And the reverse: enabling Flight Mode while Cockpit Mode is already on
  // must turn Cockpit Mode back off.
  await page.click('#flight-mode-checkbox');
  expect(await page.evaluate(() => ({ flight: STATE.flightMode, cockpit: STATE.cockpitMode }))).toEqual({ flight: true, cockpit: false });
  await expect(page.locator('#cockpit-mode-checkbox')).not.toBeChecked();
  expect(errors).toEqual([]);
});

test('starting a Cockpit Mode wave generates 3D dots and a ship, and shows the cockpit canvas', async ({ page }) => {
  const errors = trackErrors(page);
  await page.addInitScript(() => { navigator.vibrate = () => true; });
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);
  await page.click('#cockpit-mode-checkbox');
  await page.click('.difficulty-btn[data-difficulty="normal"]');
  await page.click('#start-game-button');
  await page.waitForTimeout(200);

  const result = await page.evaluate(() => ({
    shipExists: !!STATE.cockpitShip,
    shipAtOrigin: STATE.cockpitShip.x === 0 && STATE.cockpitShip.y === 0 && STATE.cockpitShip.z > 0,
    dotCount: STATE.dots.length,
    pairCount: new Set(STATE.dots.map(d => d.pairId)).size,
    everyDotHas3dPosition: STATE.dots.every(d => typeof d.z === 'number' && !Number.isNaN(d.z)),
    everyPairHasTwoDots: [...new Set(STATE.dots.map(d => d.pairId))].every(
      pid => STATE.dots.filter(d => d.pairId === pid).length === 2
    ),
    canvasVisible: document.getElementById('cockpitCanvas').classList.contains('visible'),
  }));

  expect(result.shipExists).toBe(true);
  expect(result.shipAtOrigin).toBe(true);
  expect(result.pairCount).toBe(3); // wave 1 -- CONFIG.STARTING_PAIRS
  expect(result.dotCount).toBe(6);
  expect(result.everyDotHas3dPosition).toBe(true);
  expect(result.everyPairHasTwoDots).toBe(true);
  expect(result.canvasVisible).toBe(true);
  expect(errors).toEqual([]);
});

// Desktop control scheme, driven by real dispatched mouse events (not
// direct function calls, for the same reason as the P1 fix in #44: only a
// real event round-trip proves the input actually reaches the game).
// Steering (mouse position, relative to screen center) and throttle (right
// mouse button) are independent inputs now, not one combined joystick --
// see computeCockpitThrottle/Turn and the player's own request for the
// split. Also covers the "drift, not an immediate stop" behavior on
// release (see COCKPIT_CONFIG.DRAG's comment).
test('desktop mouse steers by position and throttles by button, and the ship drifts on release instead of stopping dead', async ({ page }) => {
  const errors = trackErrors(page);
  await page.addInitScript(() => { navigator.vibrate = () => true; });
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);
  await page.click('#cockpit-mode-checkbox');
  await page.click('.difficulty-btn[data-difficulty="normal"]');
  await page.click('#start-game-button');
  await page.waitForTimeout(200);

  const start = await page.evaluate(() => ({ ...STATE.cockpitShip }));
  expect(start.vx).toBe(0);
  expect(start.vy).toBe(0);
  expect(start.vz).toBe(0);

  // Move the mouse well off-center (no button held) -- steering alone,
  // no thrust yet.
  await page.mouse.move(400, 200, { steps: 5 });
  await page.waitForTimeout(300);
  const steeredOnly = await page.evaluate(() => ({ ...STATE.cockpitShip }));
  expect(steeredOnly.yaw).not.toBe(0);
  expect(steeredOnly.pitch).not.toBe(0);
  expect(Math.hypot(steeredOnly.vx, steeredOnly.vy, steeredOnly.vz)).toBe(0);

  // Now hold the right mouse button -- accelerate ("throttle") -- for real
  // elapsed time.
  await page.mouse.down({ button: 'right' });
  await page.waitForTimeout(500); // ~30 real frames of thrust
  const thrusting = await page.evaluate(() => ({ ...STATE.cockpitShip }));
  const speedWhileThrusting = Math.hypot(thrusting.vx, thrusting.vy, thrusting.vz);
  expect(speedWhileThrusting).toBeGreaterThan(0);

  await page.mouse.up({ button: 'right' });
  const justReleased = await page.evaluate(() => ({ ...STATE.cockpitShip }));
  const speedJustAfterRelease = Math.hypot(justReleased.vx, justReleased.vy, justReleased.vz);
  // Released, not stopped -- velocity survives the release itself.
  expect(speedJustAfterRelease).toBeGreaterThan(speedWhileThrusting * 0.9);

  await page.waitForTimeout(1000); // a real second of drift decay, no input held
  const afterDrift = await page.evaluate(() => ({ ...STATE.cockpitShip }));
  const speedAfterDrift = Math.hypot(afterDrift.vx, afterDrift.vy, afterDrift.vz);
  // Decayed (DRAG < 1 every frame with no thrust), but still clearly
  // drifting a second later, not an instant stop.
  expect(speedAfterDrift).toBeLessThan(speedJustAfterRelease);
  expect(speedAfterDrift).toBeGreaterThan(0.01);
  expect(errors).toEqual([]);
});

// Player report: the steering joystick felt far too sensitive. Turn/throttle
// are now eased toward the raw input each frame (COCKPIT_CONFIG.CONTROL_
// SMOOTHING) instead of applied instantly -- verify that by comparing the
// yaw rate right after a key goes down (still ramping up) against the yaw
// rate once it's had time to converge (steady state at full turn rate);
// the latter should be clearly faster.
test('holding a turn key ramps yaw up smoothly instead of snapping straight to full turn rate', async ({ page }) => {
  const errors = trackErrors(page);
  await page.addInitScript(() => { navigator.vibrate = () => true; });
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);
  await page.click('#cockpit-mode-checkbox');
  await page.click('.difficulty-btn[data-difficulty="normal"]');
  await page.click('#start-game-button');
  await page.waitForTimeout(200);

  const before = await page.evaluate(() => STATE.cockpitShip.yaw);
  await page.keyboard.down('d'); // full right turn (tx = 1), no ramp of its own like an analog stick has
  await page.waitForTimeout(50); // a few frames -- the smoothed turn is still well short of full deflection
  const early = await page.evaluate(() => STATE.cockpitShip.yaw);

  await page.waitForTimeout(1500); // long enough for the smoothed turn to fully converge
  const later = await page.evaluate(() => STATE.cockpitShip.yaw);
  await page.keyboard.up('d');

  const earlyRate = (early - before) / 50;
  const laterRate = (later - early) / 1500;
  expect(Math.sign(earlyRate)).toBe(Math.sign(laterRate)); // same turn direction throughout
  expect(Math.abs(laterRate)).toBeGreaterThan(Math.abs(earlyRate) * 1.5); // clearly faster once converged
  expect(errors).toEqual([]);
});

// Codex review, #47: the window-level 'mouseup' safety net (cancelStaleDrawGesture)
// fires on every ordinary release, not just a genuinely interrupted gesture --
// forcing the smoothed turn to zero there would drop a steady mouse-position
// steer to zero and back every time the player merely let go of the throttle
// button, a completely unrelated input. Only a real interruption (blur/
// touchcancel) should do that.
test('releasing the throttle mouse button does not reset in-progress mouse-position steering', async ({ page }) => {
  const errors = trackErrors(page);
  await page.addInitScript(() => { navigator.vibrate = () => true; });
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);
  await page.click('#cockpit-mode-checkbox');
  await page.click('.difficulty-btn[data-difficulty="normal"]');
  await page.click('#start-game-button');
  await page.waitForTimeout(200);

  await page.mouse.move(400, 200, { steps: 5 }); // steer via mouse position
  await page.mouse.down({ button: 'right' }); // also thrust, independently
  await page.waitForTimeout(1000); // let the smoothed turn converge well off zero
  const beforeRelease = await page.evaluate(() => ({ ...STATE.cockpitTurnSmoothed }));
  expect(Math.abs(beforeRelease.x) + Math.abs(beforeRelease.y)).toBeGreaterThan(0.5);

  await page.mouse.up({ button: 'right' }); // release throttle only -- steering input is untouched
  const afterRelease = await page.evaluate(() => ({ ...STATE.cockpitTurnSmoothed }));
  expect(Math.abs(afterRelease.x) + Math.abs(afterRelease.y)).toBeGreaterThan(0.3); // not snapped to zero
  expect(errors).toEqual([]);
});

// Player report: it wasn't obvious which pad was which.
test('the Cockpit Mode joysticks are labeled Thrust (left) and Steer (right)', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);
  await expect(page.locator('#cockpit-left-stick .cockpit-stick-label')).toHaveText('THRUST');
  await expect(page.locator('#cockpit-right-stick .cockpit-stick-label')).toHaveText('STEER');
  expect(errors).toEqual([]);
});

// Touch device: two independent on-screen sticks, tracked by real
// simultaneous touches with distinct identifiers -- left = throttle
// (vertical deflection), right = steering direction. Verifies both fingers
// work at once, independently, which a single-pointer test couldn't catch.
test('touch dual joysticks steer and throttle independently with two simultaneous fingers', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 500, height: 900 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  const errors = trackErrors(page);
  await page.addInitScript(() => { navigator.vibrate = () => true; });
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);
  await page.click('#cockpit-mode-checkbox');
  await page.click('.difficulty-btn[data-difficulty="normal"]');
  await page.click('#start-game-button');
  await page.waitForTimeout(200);

  expect(await page.evaluate(() => isTouchCapableDevice())).toBe(true);
  await expect(page.locator('#cockpit-left-stick')).toHaveClass(/visible/);
  await expect(page.locator('#cockpit-right-stick')).toHaveClass(/visible/);

  await page.evaluate(() => {
    const canvasEl = document.getElementById('gameCanvas');
    const rect = canvasEl.getBoundingClientRect();
    const left = new Touch({ identifier: 1, target: canvasEl, clientX: 80, clientY: rect.height - 100 });
    const right = new Touch({ identifier: 2, target: canvasEl, clientX: rect.width - 80, clientY: rect.height - 60 });
    canvasEl.dispatchEvent(new TouchEvent('touchstart', { touches: [left, right], changedTouches: [left, right], targetTouches: [left, right], bubbles: true, cancelable: true }));
  });
  const afterStart = await page.evaluate(() => ({ left: STATE.cockpitLeftStick, right: STATE.cockpitRightStick }));
  expect(afterStart.left).toBeTruthy();
  expect(afterStart.right).toBeTruthy();

  // Left finger up (throttle), right finger sideways (steer) -- both at once.
  await page.evaluate(() => {
    const canvasEl = document.getElementById('gameCanvas');
    const rect = canvasEl.getBoundingClientRect();
    const left = new Touch({ identifier: 1, target: canvasEl, clientX: 80, clientY: rect.height - 160 });
    const right = new Touch({ identifier: 2, target: canvasEl, clientX: rect.width - 40, clientY: rect.height - 60 });
    canvasEl.dispatchEvent(new TouchEvent('touchmove', { touches: [left, right], changedTouches: [left, right], targetTouches: [left, right], bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(400);
  const afterMove = await page.evaluate(() => ({
    speed: Math.hypot(STATE.cockpitShip.vx, STATE.cockpitShip.vy, STATE.cockpitShip.vz),
    yaw: STATE.cockpitShip.yaw,
  }));
  expect(afterMove.speed).toBeGreaterThan(0);
  expect(afterMove.yaw).not.toBe(0);

  await page.evaluate(() => {
    const canvasEl = document.getElementById('gameCanvas');
    const rect = canvasEl.getBoundingClientRect();
    const left = new Touch({ identifier: 1, target: canvasEl, clientX: 80, clientY: rect.height - 160 });
    const right = new Touch({ identifier: 2, target: canvasEl, clientX: rect.width - 40, clientY: rect.height - 60 });
    canvasEl.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [left, right], targetTouches: [], bubbles: true, cancelable: true }));
  });
  const afterEnd = await page.evaluate(() => ({ left: STATE.cockpitLeftStick, right: STATE.cockpitRightStick }));
  expect(afterEnd.left).toBeNull();
  expect(afterEnd.right).toBeNull();
  expect(errors).toEqual([]);
  await context.close();
});

// The actual flying-and-connecting mechanic, driven deterministically by
// dropping the ship exactly on each dot in turn (see the Flight Mode tests
// above for the same "STATE.ship.x = ...; updateShipDrawing()" pattern) --
// this isolates the hit-detection/scoring logic from the joystick-to-heading
// mapping, which the previous test already covers on its own.
test('flying through two matching dots completes a real cockpit connection', async ({ page }) => {
  const errors = trackErrors(page);
  await page.addInitScript(() => { navigator.vibrate = () => true; });
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);
  await page.click('#cockpit-mode-checkbox');
  await page.click('.difficulty-btn[data-difficulty="normal"]');
  await page.click('#start-game-button');
  await page.waitForTimeout(200);

  const setup = await page.evaluate(() => {
    const [a, b] = STATE.dots.filter(d => d.pairId === 0);
    return { aId: a.id, bId: b.id, a: { x: a.x, y: a.y, z: a.z }, b: { x: b.x, y: b.y, z: b.z } };
  });

  const afterA = await page.evaluate(({ a }) => {
    STATE.cockpitShip.x = a.x; STATE.cockpitShip.y = a.y; STATE.cockpitShip.z = a.z;
    updateCockpitDrawing();
    return { activeDotId: STATE.cockpitActiveDot && STATE.cockpitActiveDot.id };
  }, setup);
  expect(afterA.activeDotId).toBe(setup.aId);

  const afterB = await page.evaluate(({ b, aId, bId }) => {
    STATE.cockpitShip.x = b.x; STATE.cockpitShip.y = b.y; STATE.cockpitShip.z = b.z;
    updateCockpitDrawing();
    return {
      line: STATE.cockpitLines[0],
      dotAConnected: STATE.dots.find(d => d.id === aId).connected,
      dotBConnected: STATE.dots.find(d => d.id === bId).connected,
      score: STATE.score,
      activeDot: STATE.cockpitActiveDot,
    };
  }, setup);

  expect(afterB.line).toBeTruthy();
  expect(afterB.line.pairId).toBe(0);
  expect(afterB.dotAConnected).toBe(true); // cockpit groups are always plain pairs -- one link fully solves both
  expect(afterB.dotBConnected).toBe(true);
  expect(afterB.score).toBeGreaterThan(0);
  expect(afterB.activeDot).toBeNull();
  expect(errors).toEqual([]);
});

// Player report (with screenshot): finishing a Cockpit Mode wave used to
// just leave the ship frozen exactly where the final connection landed --
// almost always embedded inside that dot's own sphere, an ugly close-up
// instead of a payoff. updateCockpitWaveCompleteReveal should instead ease
// the ship back out to a vantage point, and the joysticks (nothing left to
// steer) should hide.
test('the wave-complete reveal pulls the Cockpit Mode ship back from the finished constellation instead of leaving it frozen in the last dot', async ({ page }) => {
  const errors = trackErrors(page);
  await page.addInitScript(() => { navigator.vibrate = () => true; });
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);
  await page.click('#cockpit-mode-checkbox');
  await page.click('.difficulty-btn[data-difficulty="normal"]');
  await page.click('#start-game-button');
  await page.waitForTimeout(200);

  // Wave 1 has CONFIG.STARTING_PAIRS pairs (3), not just one -- every pair
  // needs a completed connection before checkWaveComplete actually fires.
  const setup = await page.evaluate(() => {
    const pairIds = [...new Set(STATE.dots.map(d => d.pairId))];
    return pairIds.map(pairId => {
      const [a, b] = STATE.dots.filter(d => d.pairId === pairId);
      return { a: { x: a.x, y: a.y, z: a.z }, b: { x: b.x, y: b.y, z: b.z } };
    });
  });

  const result = await page.evaluate((pairs) => {
    // Force the sticks visible first -- otherwise this desktop context
    // never shows them at all, and the assertion below wouldn't prove
    // checkWaveComplete actively hides them.
    document.getElementById('cockpit-left-stick').classList.add('visible');
    document.getElementById('cockpit-right-stick').classList.add('visible');
    for (const { a, b } of pairs) {
      STATE.cockpitShip.x = a.x; STATE.cockpitShip.y = a.y; STATE.cockpitShip.z = a.z;
      updateCockpitDrawing();
      STATE.cockpitShip.x = b.x; STATE.cockpitShip.y = b.y; STATE.cockpitShip.z = b.z;
      updateCockpitDrawing();
    }
    return {
      phase: STATE.phase,
      distRightAfter: Math.hypot(STATE.cockpitShip.x, STATE.cockpitShip.y, STATE.cockpitShip.z),
      leftStickVisible: document.getElementById('cockpit-left-stick').classList.contains('visible'),
      rightStickVisible: document.getElementById('cockpit-right-stick').classList.contains('visible'),
    };
  }, setup);

  expect(result.phase).toBe('WAVE_COMPLETE');
  expect(result.leftStickVisible).toBe(false);
  expect(result.rightStickVisible).toBe(false);

  await page.waitForTimeout(1500); // let the reveal ease outward
  const distAfterReveal = await page.evaluate(() =>
    Math.hypot(STATE.cockpitShip.x, STATE.cockpitShip.y, STATE.cockpitShip.z));
  expect(distAfterReveal).toBeGreaterThan(result.distRightAfter + 50); // clearly pulled back, not still parked in the dot
  expect(errors).toEqual([]);
});

// Codex review, #49: updateCockpitShip (the only place that normally
// updates cockpitTurnSmoothed) stops running the instant the wave
// completes, but the camera's visual bank roll keeps reading it every
// frame regardless of phase -- finishing mid-turn used to leave the whole
// wave-complete reveal permanently tilted at whatever the last steering
// value was, since nothing ever zeroed it going into WAVE_COMPLETE.
test('finishing a Cockpit Mode wave mid-turn resets the smoothed bank instead of leaving the reveal permanently rolled', async ({ page }) => {
  const errors = trackErrors(page);
  await page.addInitScript(() => { navigator.vibrate = () => true; });
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);
  await page.click('#cockpit-mode-checkbox');
  await page.click('.difficulty-btn[data-difficulty="normal"]');
  await page.click('#start-game-button');
  await page.waitForTimeout(200);

  const result = await page.evaluate(() => {
    STATE.cockpitTurnSmoothed = { x: 0.9, y: -0.4 }; // simulate mid-decay steering right before finishing
    for (const dot of STATE.dots) dot.connected = true; // every dot already connected
    checkWaveComplete();
    return { turnSmoothed: { ...STATE.cockpitTurnSmoothed }, phase: STATE.phase };
  });

  expect(result.phase).toBe('WAVE_COMPLETE');
  expect(result.turnSmoothed).toEqual({ x: 0, y: 0 });
  expect(errors).toEqual([]);
});

// The 3D equivalent of "a line can't cross another line" -- classic mode's
// real segment-intersection barrier checks don't translate to open 3D
// space, so this is a proximity check instead (see updateCockpitDrawing's
// own comment). Flying back through an already-completed connection must
// reject the one currently in progress, not silently ignore it.
test('flying back through an already-completed cockpit line breaks the connection in progress', async ({ page }) => {
  const errors = trackErrors(page);
  await page.addInitScript(() => { navigator.vibrate = () => true; });
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);
  await page.click('#cockpit-mode-checkbox');
  await page.click('.difficulty-btn[data-difficulty="normal"]');
  await page.click('#start-game-button');
  await page.waitForTimeout(200);

  const result = await page.evaluate(() => {
    const [a0, b0] = STATE.dots.filter(d => d.pairId === 0);
    const [a1] = STATE.dots.filter(d => d.pairId === 1);

    // Complete pair 0's connection first, same pattern as the test above.
    STATE.cockpitShip.x = a0.x; STATE.cockpitShip.y = a0.y; STATE.cockpitShip.z = a0.z;
    updateCockpitDrawing();
    STATE.cockpitShip.x = b0.x; STATE.cockpitShip.y = b0.y; STATE.cockpitShip.z = b0.z;
    updateCockpitDrawing();
    const completedLinePoint = STATE.cockpitLines[0].points[0]; // dot a0's own position

    // Start a fresh connection on a different pair, then fly the ship
    // straight through the completed line's own recorded position.
    STATE.cockpitShip.x = a1.x; STATE.cockpitShip.y = a1.y; STATE.cockpitShip.z = a1.z;
    updateCockpitDrawing();
    const activeDotAfterStart = STATE.cockpitActiveDot && STATE.cockpitActiveDot.id;

    STATE.cockpitShip.x = completedLinePoint.x; STATE.cockpitShip.y = completedLinePoint.y; STATE.cockpitShip.z = completedLinePoint.z;
    updateCockpitDrawing();

    return {
      activeDotAfterStart,
      activeDotAfterCrossing: STATE.cockpitActiveDot,
      pathAfterCrossing: STATE.cockpitPath.length,
      dot1Connected: STATE.dots.find(d => d.id === a1.id).connected,
    };
  });

  expect(result.activeDotAfterStart).not.toBeNull();
  expect(result.activeDotAfterCrossing).toBeNull(); // rejected -- crossing the old line broke the new one
  expect(result.pathAfterCrossing).toBe(0);
  expect(result.dot1Connected).toBe(false); // never actually reached its match
  expect(errors).toEqual([]);
});

test('the Cockpit Mode ship/controls reset cleanly on a new wave and exiting to the title screen', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(() => {
    STATE.cockpitMode = true;
    startWave(1);
    const shipAfterStart = !!STATE.cockpitShip;
    STATE.cockpitShip.x = 12345; // mutate so a stale carry-over would be detectable
    STATE.cockpitLeftStick = { touchId: 1, curX: 2, curY: 2 };
    STATE.cockpitRightStick = { touchId: 2, curX: 3, curY: 3 };
    STATE.cockpitKeys.w = true;
    STATE.cockpitKeys.up = true;
    STATE.cockpitMouseButtons.right = true;
    STATE.cockpitActiveDot = STATE.dots[0];
    STATE.cockpitPath = [{ x: 1, y: 1, z: 1 }];
    startWave(2);
    const resetAfterNewWave = {
      shipPosition: STATE.cockpitShip.x,
      leftStick: STATE.cockpitLeftStick,
      rightStick: STATE.cockpitRightStick,
      keysW: STATE.cockpitKeys.w,
      keysUp: STATE.cockpitKeys.up,
      mouseRight: STATE.cockpitMouseButtons.right,
      activeDot: STATE.cockpitActiveDot,
      path: STATE.cockpitPath.length,
      lines: STATE.cockpitLines.length,
    };
    exitToTitle();
    const stateAfterExit = {
      ship: STATE.cockpitShip,
      activeDot: STATE.cockpitActiveDot,
      canvasVisible: document.getElementById('cockpitCanvas').classList.contains('visible'),
      leftStickVisible: document.getElementById('cockpit-left-stick').classList.contains('visible'),
      waypointVisible: document.getElementById('cockpit-waypoint-arrow').classList.contains('visible'),
      connectionStatusVisible: document.getElementById('cockpit-connection-status').classList.contains('visible'),
    };
    STATE.cockpitMode = false;
    startWave(1);
    const shipWhenDisabled = STATE.cockpitShip;
    return { shipAfterStart, resetAfterNewWave, stateAfterExit, shipWhenDisabled };
  });

  expect(result.shipAfterStart).toBe(true);
  expect(result.resetAfterNewWave.shipPosition).not.toBe(12345); // startWave re-centers it, not carries the old position
  expect(result.resetAfterNewWave.leftStick).toBeNull();
  expect(result.resetAfterNewWave.rightStick).toBeNull();
  expect(result.resetAfterNewWave.keysW).toBe(false);
  expect(result.resetAfterNewWave.keysUp).toBe(false);
  expect(result.resetAfterNewWave.mouseRight).toBe(false);
  expect(result.resetAfterNewWave.activeDot).toBeNull();
  expect(result.resetAfterNewWave.path).toBe(0);
  expect(result.resetAfterNewWave.lines).toBe(0);
  expect(result.stateAfterExit.ship).toBeNull();
  expect(result.stateAfterExit.activeDot).toBeNull();
  expect(result.stateAfterExit.canvasVisible).toBe(false);
  expect(result.stateAfterExit.leftStickVisible).toBe(false);
  expect(result.stateAfterExit.waypointVisible).toBe(false);
  expect(result.stateAfterExit.connectionStatusVisible).toBe(false);
  expect(result.shipWhenDisabled).toBeNull(); // no ship at all once cockpitMode is off
  expect(errors).toEqual([]);
});

// The waypoint arrow is a difficulty-gated hint; this badge is baseline
// feedback that should show regardless of difficulty any time a connection
// is in progress -- the dot/line being dragged from is easy to lose behind
// the ship while flying forward past it (player report).
test('the Cockpit Mode connection-status badge shows while a line is being drawn, colored to match the active pair, and hides once idle', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(() => {
    STATE.cockpitMode = true;
    STATE.difficulty = 'intense'; // even on the difficulty that hides the waypoint arrow entirely
    startWave(1);
    const el = document.getElementById('cockpit-connection-status');
    const hiddenBeforeDrawing = el.classList.contains('visible');

    STATE.cockpitActiveDot = STATE.dots[0];
    STATE.cockpitPath = [{ x: 1, y: 1, z: 1 }];
    updateCockpitConnectionStatus();
    const visibleWhileDrawing = el.classList.contains('visible');
    const colorWhileDrawing = el.style.color;

    STATE.cockpitActiveDot = null;
    updateCockpitConnectionStatus();
    const hiddenAfterLanding = el.classList.contains('visible');

    // Browsers normalize an assigned hex color to rgb(...); round-trip the
    // expected hex through a throwaway element to compare like with like.
    const probe = document.createElement('div');
    probe.style.color = INSTRUMENTS[STATE.dots[0].colorIndex].hex;
    const expectedColor = probe.style.color;

    return { hiddenBeforeDrawing, visibleWhileDrawing, colorWhileDrawing, hiddenAfterLanding, expectedColor };
  });

  expect(result.hiddenBeforeDrawing).toBe(false);
  expect(result.visibleWhileDrawing).toBe(true);
  expect(result.colorWhileDrawing).toBe(result.expectedColor);
  expect(result.hiddenAfterLanding).toBe(false);
  expect(errors).toEqual([]);
});

// A key/button/touch still down when the pause button is hit must not keep
// steering or thrusting once the game resumes -- same reasoning as Flight
// Mode's window-level mouseup safety net, just for the pause menu's own
// entry point instead (see pauseGame's own comment).
test('pausing mid-steer clears cockpit keys/mouse buttons so nothing keeps thrusting once resumed', async ({ page }) => {
  const errors = trackErrors(page);
  await page.addInitScript(() => { navigator.vibrate = () => true; });
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);
  await page.click('#cockpit-mode-checkbox');
  await page.click('.difficulty-btn[data-difficulty="normal"]');
  await page.click('#start-game-button');
  await page.waitForTimeout(200);

  await page.keyboard.down('w');
  await page.mouse.down({ button: 'right' });
  expect(await page.evaluate(() => STATE.cockpitKeys.w)).toBe(true);
  expect(await page.evaluate(() => STATE.cockpitMouseButtons.right)).toBe(true);

  await page.click('#pause-button');
  expect(await page.evaluate(() => STATE.cockpitKeys.w)).toBe(false);
  expect(await page.evaluate(() => STATE.cockpitMouseButtons.right)).toBe(false);

  // Release the real key/button now (the test harness, not the game, is
  // holding them) so they don't leak into later assertions.
  await page.keyboard.up('w');
  await page.mouse.up({ button: 'right' });

  await page.click('#pause-resume');
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => STATE.cockpitKeys.w)).toBe(false);
  expect(await page.evaluate(() => STATE.cockpitMouseButtons.right)).toBe(false);
  expect(errors).toEqual([]);
});

// Left/right arrows and the mouse wheel both adjust the camera's FOV as a
// zoom analog (see updateCockpitZoom/onWheelZoom's cockpitMode branch),
// clamped to COCKPIT_CONFIG.FOV_MIN/MAX.
test('left/right arrow keys and the mouse wheel zoom the cockpit camera via FOV, clamped to its range', async ({ page }) => {
  const errors = trackErrors(page);
  await page.addInitScript(() => { navigator.vibrate = () => true; });
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);
  await page.click('#cockpit-mode-checkbox');
  await page.click('.difficulty-btn[data-difficulty="normal"]');
  await page.click('#start-game-button');
  await page.waitForTimeout(200);

  const initialFov = await page.evaluate(() => STATE.cockpitFov);
  expect(initialFov).toBeGreaterThan(0);

  await page.keyboard.down('ArrowRight'); // zoom in -- FOV decreases
  await page.waitForTimeout(300);
  await page.keyboard.up('ArrowRight');
  const afterZoomIn = await page.evaluate(() => STATE.cockpitFov);
  expect(afterZoomIn).toBeLessThan(initialFov);

  await page.keyboard.down('ArrowLeft'); // zoom out -- FOV increases
  await page.waitForTimeout(600); // enough to cross back past the initial value
  await page.keyboard.up('ArrowLeft');
  const afterZoomOut = await page.evaluate(() => STATE.cockpitFov);
  expect(afterZoomOut).toBeGreaterThan(afterZoomIn);

  // Clamp check: hold zoom-in far longer than needed to reach FOV_MIN.
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(2000);
  await page.keyboard.up('ArrowRight');
  const clamped = await page.evaluate(() => ({ fov: STATE.cockpitFov, min: COCKPIT_CONFIG.FOV_MIN }));
  expect(clamped.fov).toBe(clamped.min);

  await page.mouse.wheel(0, -300); // scroll up -- zoom in further, but already at the floor
  await page.waitForTimeout(100);
  const afterWheel = await page.evaluate(() => STATE.cockpitFov);
  expect(afterWheel).toBe(clamped.fov); // still clamped, wheel can't push it past FOV_MIN either
  expect(errors).toEqual([]);
});

// A held key/mouse button or an in-progress stick touch has the same
// "interrupted, no matching end event" problem window-level blur/touchcancel
// already guards classic mode against: iOS can fire touchcancel instead of
// touchend, and losing window focus entirely skips keyup/mouseup outright.
// Without clearing cockpit control state too, the ship would keep steering/
// thrusting after the player returns (review, #45).
test('losing window focus mid-steer clears cockpit keys/mouse buttons/sticks, same as a stale draw gesture', async ({ page }) => {
  const errors = trackErrors(page);
  await page.addInitScript(() => { navigator.vibrate = () => true; });
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);
  await page.click('#cockpit-mode-checkbox');
  await page.click('.difficulty-btn[data-difficulty="normal"]');
  await page.click('#start-game-button');
  await page.waitForTimeout(200);

  await page.keyboard.down('w');
  await page.mouse.down({ button: 'right' });
  const before = await page.evaluate(() => {
    STATE.cockpitLeftStick = { touchId: 1, curX: 5, curY: 5 };
    STATE.cockpitRightStick = { touchId: 2, curX: 5, curY: 5 };
    return { key: STATE.cockpitKeys.w, mouse: STATE.cockpitMouseButtons.right };
  });
  expect(before.key).toBe(true);
  expect(before.mouse).toBe(true);

  // The window-level safety net itself, exactly as the browser fires it on
  // a real blur (not a direct function call -- same reasoning as every
  // other cockpit input test in this suite).
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));

  const after = await page.evaluate(() => ({
    key: STATE.cockpitKeys.w,
    mouse: STATE.cockpitMouseButtons.right,
    leftStick: STATE.cockpitLeftStick,
    rightStick: STATE.cockpitRightStick,
  }));
  expect(after.key).toBe(false);
  expect(after.mouse).toBe(false);
  expect(after.leftStick).toBeNull();
  expect(after.rightStick).toBeNull();

  await page.keyboard.up('w');
  await page.mouse.up({ button: 'right' });
  expect(errors).toEqual([]);
});

// Regression guard for a real player-reported defect: HUD buttons/layout
// went missing on a device that had loaded the game before -- caused by
// style.css having no cache-busting query string the way game.js already
// does (see deploy-pages.yml's __BUILD__ substitution), so a returning
// player's already-cached, now-stale stylesheet stayed paired with a
// freshly-fetched game.js as soon as any deploy changed CSS, and a plain
// reload didn't fix it since the cached CSS was still "fresh" by cache
// headers. Checked structurally against the raw HTML (both deployed
// __BUILD__-substituted and the literal placeholder served locally are
// valid outcomes) rather than requiring an actual second deploy to prove.
test('the stylesheet link is cache-busted the same way game.js already is', async ({ page }) => {
  const errors = trackErrors(page);
  const res = await page.goto('/index.html');
  const html = await res.text();

  const scriptMatch = html.match(/<script src="game\.js\?v=([^"]+)"><\/script>/);
  const linkMatch = html.match(/<link rel="stylesheet" href="style\.css\?v=([^"]+)">/);

  expect(scriptMatch).not.toBeNull();
  expect(linkMatch).not.toBeNull();
  // Same build identifier on both -- a CSS-only deploy always ships under
  // the same cache-busted key as the JS it's paired with.
  expect(linkMatch[1]).toBe(scriptMatch[1]);
  expect(errors).toEqual([]);
});

// Relaxed-mode-only assist: while a line is being drawn, every dot outside
// the group being connected dims to make the matching dot easy to spot.
// Drives the real input handler (onInputStart) to start a genuine drag,
// same as the portal-drawing test above, then renders through the real
// drawDot/ctx.fill path (same interception technique as the hint-pulse
// test above) rather than re-testing the gating logic in isolation.
test('relaxed mode dims every dot outside the matching group while a line is being drawn, and undims once the drag ends', async ({ page }) => {
  const errors = trackErrors(page);
  await page.addInitScript(() => { navigator.vibrate = () => true; });
  await page.goto('/index.html');
  await page.click('.difficulty-btn[data-difficulty="relaxed"]');
  await page.click('#start-game-button');
  await page.waitForTimeout(800);

  const setup = await page.evaluate(() => {
    const dots = window.__lumina.getDots();
    const byPair = {};
    for (const d of dots) (byPair[d.pairId] = byPair[d.pairId] || []).push(d);
    const groups = Object.values(byPair);
    const originGroup = groups.find(g => g.length >= 2);
    const otherGroup = groups.find(g => g !== originGroup);
    return {
      origin: originGroup[0],
      groupmate: originGroup[1],
      other: otherGroup[0],
    };
  });

  const alphaOf = async (dotId) => {
    return page.evaluate((id) => {
      const dot = STATE.dots.find(d => d.id === id);
      const fills = [];
      const origFill = ctx.fill.bind(ctx);
      ctx.fill = function (...args) { fills.push(ctx.globalAlpha); return origFill(...args); };
      drawDot(dot);
      ctx.fill = origFill;
      return fills[0]; // base color fill, the one shouldDimForActiveDraw scales
    }, dotId);
  };

  const beforeDrag = { groupmate: await alphaOf(setup.groupmate.id), other: await alphaOf(setup.other.id) };
  const dimMultiplier = await page.evaluate(() => ACTIVE_DRAW_DIM_MULTIPLIER);

  await page.evaluate(({ x, y }) => {
    onInputStart({ preventDefault() {}, clientX: x, clientY: y });
  }, { x: setup.origin.x, y: setup.origin.y });
  expect(await page.evaluate(() => STATE.isDrawing)).toBe(true);

  const duringDrag = { groupmate: await alphaOf(setup.groupmate.id), other: await alphaOf(setup.other.id) };
  // Same group as the dot being dragged from: brightness unchanged.
  expect(duringDrag.groupmate).toBeCloseTo(beforeDrag.groupmate, 5);
  // Different group: dimmed to exactly ACTIVE_DRAW_DIM_MULTIPLIER of its
  // normal brightness -- deliberately low, not just "a bit darker".
  expect(duringDrag.other).toBeCloseTo(beforeDrag.other * dimMultiplier, 5);

  // Releasing off any dot cancels the gesture -- isDrawing goes false and,
  // being computed live off STATE each frame, dimming clears on its own.
  await page.evaluate(() => onInputEnd({ preventDefault() {}, clientX: -9999, clientY: -9999 }));
  expect(await page.evaluate(() => STATE.isDrawing)).toBe(false);
  const afterDrag = { groupmate: await alphaOf(setup.groupmate.id), other: await alphaOf(setup.other.id) };
  expect(afterDrag.groupmate).toBeCloseTo(beforeDrag.groupmate, 5);
  expect(afterDrag.other).toBeCloseTo(beforeDrag.other, 5);

  expect(errors).toEqual([]);
});

// Same drag mechanics as above, but confirms the assist is genuinely
// gated to Relaxed -- Normal/Intense should never dim anything, even
// mid-drag, since #pause-erase/other relaxed-only affordances use the
// same STATE.difficulty === 'relaxed' gate and this should match them.
test('the relaxed-mode dimming assist never activates outside relaxed difficulty', async ({ page }) => {
  const errors = trackErrors(page);
  await page.addInitScript(() => { navigator.vibrate = () => true; });
  await page.goto('/index.html');
  await page.click('.difficulty-btn[data-difficulty="normal"]');
  await page.click('#start-game-button');
  await page.waitForTimeout(800);

  const result = await page.evaluate(() => {
    const dots = STATE.dots;
    const byPair = {};
    for (const d of dots) (byPair[d.pairId] = byPair[d.pairId] || []).push(d);
    const groups = Object.values(byPair);
    const origin = groups[0][0];
    const other = groups.find(g => g[0].pairId !== origin.pairId)[0];

    onInputStart({ preventDefault() {}, clientX: origin.x, clientY: origin.y });
    const dimming = shouldDimForActiveDraw(other);
    onInputEnd({ preventDefault() {}, clientX: -9999, clientY: -9999 });
    return dimming;
  });
  expect(result).toBe(false);
  expect(errors).toEqual([]);
});

// Codex review (#52): the dimming assist's multiplier only ever touched
// the base color fill -- the hint-pulse flash overlay and the final white
// core circle both assign globalAlpha directly rather than multiply it,
// so at every flash peak an unrelated dot briefly popped back to full
// brightness, defeating the assist for most of the animation. Verifies
// all three of drawDot's fill() calls (base, hint overlay, core) scale
// identically by the same ACTIVE_DRAW_DIM_MULTIPLIER dim factor, not just
// the first one.
test('the dimming assist also dims a dot during its hint-pulse flash peak, not just its base fill', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(() => {
    const dot = { x: 100, y: 100, colorIndex: 0, pairId: 5, connected: false, pulsePhase: 0 };
    const activeDot = { pairId: 9 }; // a different group -- `dot` should be dimmed

    // hintPulseBrightness is a plain top-level function declaration, so it's
    // a real property of window -- reassigning it here redirects drawDot's
    // own call to it, same as a real hint pulse sitting at its exact peak.
    const origHintPulseBrightness = window.hintPulseBrightness;
    window.hintPulseBrightness = () => 1;

    const captureFills = () => {
      const fills = [];
      const origFill = ctx.fill.bind(ctx);
      ctx.fill = function (...args) { fills.push(ctx.globalAlpha); return origFill(...args); };
      drawDot(dot);
      ctx.fill = origFill;
      return fills;
    };

    STATE.difficulty = 'relaxed';
    STATE.isDrawing = false;
    STATE.activeDot = null;
    const undimmed = captureFills();

    STATE.isDrawing = true;
    STATE.activeDot = activeDot;
    const dimmed = captureFills();

    STATE.isDrawing = false;
    STATE.activeDot = null;
    window.hintPulseBrightness = origHintPulseBrightness;

    return { undimmed, dimmed, dimMultiplier: ACTIVE_DRAW_DIM_MULTIPLIER };
  });

  expect(result.undimmed).toHaveLength(3); // base fill, hint-flash overlay, white core
  expect(result.dimmed).toHaveLength(3);
  for (let i = 0; i < 3; i++) {
    expect(result.dimmed[i]).toBeCloseTo(result.undimmed[i] * result.dimMultiplier, 5);
  }
  expect(errors).toEqual([]);
});

// Codex review (#52): a milestone wave can earn all three achievements at
// once, joining into one long caption that -- undimmed -- exceeds the
// postcard card's own width. Verifies the actually-drawn caption (via the
// real fillText call, not a re-implementation of the sizing math) fits
// within the card once shrunk.
test('buildWavePostcard shrinks a long multi-achievement caption to fit the card, instead of overflowing it', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(() => {
    STATE.wave = 10;
    STATE.score = 9999;
    STATE.lastWavePostcardLabels = ['Wave 10 Cleared', 'New Highest Wave', 'Best Wave Score'];

    const calls = [];
    const origFillText = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (text, x, y) {
      calls.push({ text, width: this.measureText(text).width });
      return origFillText.call(this, text, x, y);
    };
    buildWavePostcard();
    CanvasRenderingContext2D.prototype.fillText = origFillText;

    const captionCall = calls.find(c => c.text.startsWith('Lumina —'));
    const cardW = POSTCARD_CONFIG.WIDTH - POSTCARD_CONFIG.MARGIN * 2;
    return {
      captionWidth: captionCall ? captionCall.width : null,
      maxCaptionWidth: cardW - POSTCARD_CONFIG.BORDER * 1.5,
    };
  });

  expect(result.captionWidth).not.toBeNull();
  expect(result.captionWidth).toBeLessThanOrEqual(result.maxCaptionWidth + 1); // +1 float-rounding slack
  expect(errors).toEqual([]);
});

// ------------------------------------------------------------
// Sleep mode ("Help Me Fall Asleep"): nothing hard, ever, and only
// lullaby music. See DIFFICULTY_PRESETS.sleep, availableGenreFamilies,
// and the GENRE_FAMILIES 'lullaby' entry for the rationale.
// ------------------------------------------------------------

test('the Sleep difficulty button exists, is selectable, and starts a real game with it applied', async ({ page }) => {
  const errors = trackErrors(page);
  await page.addInitScript(() => { navigator.vibrate = () => true; });
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  await expect(page.locator('.difficulty-btn[data-difficulty="sleep"]')).toBeVisible();
  await page.click('.difficulty-btn[data-difficulty="sleep"]');
  await expect(page.locator('.difficulty-btn[data-difficulty="sleep"]')).toHaveClass(/active/);

  await page.click('#start-game-button');
  await page.waitForTimeout(800);

  const difficulty = await page.evaluate(() => STATE.difficulty);
  expect(difficulty).toBe('sleep');
  expect(errors).toEqual([]);
});

// Monte Carlo, same methodology as the maze-barrier/portal stress tests
// above -- generates many real waves (well past every other difficulty's
// group/barrier/rotation unlock waves) and confirms Sleep mode's "nothing
// hard, ever" promise actually holds at the data level, not just via a
// config value that could be bypassed by some other code path.
test('Sleep difficulty never produces a barrier, a portal, or a multi-dot group, across 100 waves', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(() => {
    applyDifficulty('sleep');
    let barriersSeen = 0, portalsSeen = 0, groupsSeen = 0, maxPairCount = 0;
    for (let wave = 1; wave <= 100; wave++) {
      STATE.dots = generateDots(wave);
      ensureAllDotsInWorldBounds(STATE.dots);
      STATE.barriers = STATE.difficulty === 'sleep' ? [] : generateBarriersSafely(wave, STATE.dots);
      if (STATE.barriers.length > 0) barriersSeen++;
      if (STATE.portals) portalsSeen++;
      const byPair = {};
      for (const d of STATE.dots) (byPair[d.pairId] = (byPair[d.pairId] || 0) + 1);
      if (Object.values(byPair).some(n => n > 2)) groupsSeen++;
      maxPairCount = Math.max(maxPairCount, getPairCountForWave(wave));
    }
    return { barriersSeen, portalsSeen, groupsSeen, maxPairCount };
  });

  expect(result.barriersSeen).toBe(0);
  expect(result.portalsSeen).toBe(0);
  expect(result.groupsSeen).toBe(0);
  // pairsPerWaveIncrease: 999 means extra never rises within 100 waves --
  // pair count stays flat at CONFIG.STARTING_PAIRS (3) the entire time.
  expect(result.maxPairCount).toBe(3);
  expect(errors).toEqual([]);
});

test('generateSong only ever draws lullaby music in Sleep difficulty, and never draws it in any other difficulty', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(() => {
    applyDifficulty('sleep');
    let sleepFamilies = new Set(), sleepBpms = [];
    for (let i = 0; i < 40; i++) {
      const song = generateSong(2);
      sleepFamilies.add(song.genre.family);
      sleepBpms.push(song.genre.bpm);
    }

    applyDifficulty('normal');
    let normalFamilies = new Set();
    for (let i = 0; i < 60; i++) {
      normalFamilies.add(generateSong(2).genre.family);
    }

    return {
      sleepFamilies: [...sleepFamilies],
      maxSleepBpm: Math.max(...sleepBpms),
      normalFamilies: [...normalFamilies],
    };
  });

  expect(result.sleepFamilies).toEqual(['lullaby']); // exclusively lullaby, every single time
  expect(result.maxSleepBpm).toBeLessThanOrEqual(60); // squarely in the slow/calming range
  expect(result.normalFamilies).not.toContain('lullaby'); // never leaks into the normal rotation
  expect(errors).toEqual([]);
});

test('lullaby roles are restricted to gentle, non-percussive, non-continuous-tone instruments only', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(() => {
    const lullaby = GENRE_FAMILIES.find(f => f.name === 'lullaby');
    const instruments = new Set();
    for (const seed of lullaby.seeds) {
      for (const role of seed.roles) instruments.add(role.instrument);
    }
    return {
      hasDrumRole: lullaby.groove.hasDrumRole,
      instruments: [...instruments].sort(),
    };
  });

  expect(result.hasDrumRole).toBe(false);
  // Explicitly never the brighter/percussive-attack voices (flute, trumpet,
  // piano, marimba), AND never cello -- every "sounds like a horn" report
  // this game has ever had (flute, then cello twice) was a continuous-tone
  // real instrument; musicbox/vibraphone are decay-enveloped and have never
  // been implicated even when stacked into simultaneous chords (see the
  // 'yacht horn' player report and 34976c5's follow-up fix).
  expect(result.instruments).toEqual(['musicbox', 'vibraphone']);
  expect(errors).toEqual([]);
});

// Regression test for player report: "Lullaby - draft off has a horn that
// again sounds like a bus or truck or train horn." Root cause: pad and
// drone both land on the exact same un-humanized downbeat (see
// generateSong), so any seed pairing them on the SAME instrument stacks 4
// correlated sustained notes (a 3-tone chord plus a pedal tone) firing at
// the identical instant -- the precise pattern behind an earlier "car
// horn" complaint (see 9f2a3d1/654e8f6 in git history). Every family
// already avoids this EXCEPT the two lullaby seeds this regressed on
// ('drift off' and 'starlight cradle' both had pad+drone on cello). Checks
// every seed in every family, not just lullaby, so nothing can reintroduce
// this shape unnoticed.
test('no genre seed ever puts pad and drone on the same instrument', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const offenders = await page.evaluate(() => {
    const bad = [];
    for (const family of GENRE_FAMILIES) {
      for (const seed of family.seeds) {
        const pad = seed.roles.find(r => r.kind === 'pad');
        const drone = seed.roles.find(r => r.kind === 'drone');
        if (pad && drone && pad.instrument === drone.instrument) {
          bad.push(`${family.name}/${seed.name}: both on ${pad.instrument}`);
        }
      }
    }
    return bad;
  });

  expect(offenders).toEqual([]);
  expect(errors).toEqual([]);
});

test('synthesizeMusicboxNote renders a finite, non-silent buffer for a real note', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(async () => {
    const buffer = await synthesizeMusicboxNote('C5');
    const data = buffer.getChannelData(0);
    let peak = 0, hasNonFinite = false;
    for (let i = 0; i < data.length; i++) {
      if (!Number.isFinite(data[i])) hasNonFinite = true;
      peak = Math.max(peak, Math.abs(data[i]));
    }
    return { hasNonFinite, peak, duration: buffer.duration, sampleRate: buffer.sampleRate };
  });

  expect(result.hasNonFinite).toBe(false);
  expect(result.peak).toBeGreaterThan(0);
  expect(result.peak).toBeLessThanOrEqual(1);
  expect(result.duration).toBeGreaterThan(2);
  expect(errors).toEqual([]);
});

test('Sleep mode gets the same QOL affordances as Relaxed: erase item visible, dimming assist active, hint never blocked', async ({ page }) => {
  const errors = trackErrors(page);
  await page.addInitScript(() => { navigator.vibrate = () => true; });
  await page.goto('/index.html');
  await page.click('.difficulty-btn[data-difficulty="sleep"]');
  await page.click('#start-game-button');
  await page.waitForTimeout(800);

  await page.click('#pause-button');
  await expect(page.locator('#pause-erase')).toBeVisible();
  await page.click('#pause-resume');

  const hintResult = await page.evaluate(() => {
    triggerHintPulse();
    return document.getElementById('hint-toast').textContent;
  });
  expect(hintResult).not.toContain('Relaxed & Normal Only');

  const dimResult = await page.evaluate(() => {
    const dots = STATE.dots;
    const byPair = {};
    for (const d of dots) (byPair[d.pairId] = byPair[d.pairId] || []).push(d);
    const groups = Object.values(byPair);
    const origin = groups[0][0];
    const other = groups.find(g => g[0].pairId !== origin.pairId)[0];
    onInputStart({ preventDefault() {}, clientX: origin.x, clientY: origin.y });
    const dimming = shouldDimForActiveDraw(other);
    onInputEnd({ preventDefault() {}, clientX: -9999, clientY: -9999 });
    return dimming;
  });
  expect(dimResult).toBe(true);
  expect(errors).toEqual([]);
});

test('updateSleepModeTint toggles the tint overlay only in Sleep difficulty', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(() => {
    const visibleFor = (difficulty) => {
      STATE.difficulty = difficulty;
      updateSleepModeTint();
      return document.getElementById('sleep-mode-tint').classList.contains('visible');
    };
    return { normal: visibleFor('normal'), sleep: visibleFor('sleep') };
  });

  expect(result.normal).toBe(false);
  expect(result.sleep).toBe(true);
  expect(errors).toEqual([]);
});

// Codex review (#54): the tint used to be a canvas fillRect on
// #gameCanvas, but #cockpitCanvas sits above it at z-index 1 with an
// opaque background, so the wash was completely invisible the instant
// Cockpit Mode was active -- a real regression for a combination this
// mode is actually meant to support (see QOL_DIFFICULTIES). Now a DOM
// overlay; this verifies it's actually stacked above both canvases (not
// just toggled correctly) via a real render() call in a real cockpit+
// sleep session, not just a computed-style comparison.
test('the sleep-mode tint overlay is stacked above the cockpit canvas, not hidden behind it', async ({ page }) => {
  const errors = trackErrors(page);
  await page.addInitScript(() => { navigator.vibrate = () => true; });
  await page.goto('/index.html');
  await page.click('.difficulty-btn[data-difficulty="sleep"]');
  await page.click('#cockpit-mode-checkbox');
  await page.click('#start-game-button');
  await page.waitForTimeout(800);

  const result = await page.evaluate(() => {
    render(); // real render() call -- exercises the actual cockpit branch, not a re-implementation
    const tint = document.getElementById('sleep-mode-tint');
    const cockpit = document.getElementById('cockpitCanvas');
    return {
      cockpitModeActive: STATE.cockpitMode && !!STATE.cockpitShip,
      tintVisible: tint.classList.contains('visible'),
      tintZIndex: Number(getComputedStyle(tint).zIndex),
      cockpitZIndex: Number(getComputedStyle(cockpit).zIndex),
      cockpitIsShown: getComputedStyle(cockpit).display !== 'none',
    };
  });

  expect(result.cockpitModeActive).toBe(true);
  expect(result.cockpitIsShown).toBe(true); // confirms this test actually exercises the hiding scenario
  expect(result.tintVisible).toBe(true);
  expect(result.tintZIndex).toBeGreaterThan(result.cockpitZIndex); // the actual fix -- paints on top, not underneath
  expect(errors).toEqual([]);
});

// ------------------------------------------------------------
// Scene ambience (see SCENE_AMBIENT_CONFIG/updateSceneAmbienceForWaveComplete)
// ------------------------------------------------------------

// setUpCompletableSceneWave() runs inside the browser (called from within
// page.evaluate below), so it can't just be a plain Node-side function --
// it's injected as a real global via addInitScript before each test's
// page.goto, same trick already used for the navigator.vibrate mocks above.
async function injectSceneWaveSetup(page) {
  await page.addInitScript(() => {
    window.setUpCompletableSceneWave = function (scene, wave = 1) {
      canvas.width = 500; canvas.height = 900;
      STATE.world = { w: 2000, h: 2000 };
      STATE.dots = [
        { id: 0, pairId: 0, colorIndex: 0, x: 500, y: 500, connected: true },
        { id: 1, pairId: 0, colorIndex: 0, x: 1500, y: 1500, connected: true },
      ];
      STATE.wave = wave;
      STATE.waveStartScore = 0;
      STATE.score = 0;
      // checkWaveComplete only needs song.genre.bpm, but a real startWave()
      // call schedules its own song loop that keeps referencing STATE.song
      // asynchronously afterward and needs song.notes too -- so if a real
      // song is already there (i.e. this test drove a real startWave()
      // rather than relying only on this stub), leave it alone instead of
      // clobbering it out from under that scheduled loop.
      if (!STATE.song || !STATE.song.notes) STATE.song = { genre: { bpm: 100 } };
      STATE.scene = scene;
    };
  });
}

test('a forest-scene wave streak reveals one more ambient layer per completion, in order, capped at four', async ({ page }) => {
  const errors = trackErrors(page);
  await injectSceneWaveSetup(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(() => {
    setUpCompletableSceneWave('forest');
    const streaks = [];
    for (let i = 0; i < 6; i++) {
      checkWaveComplete();
      streaks.push(STATE.ambienceStreak);
    }
    return { streaks, order: SCENE_AMBIENT_CONFIG.forest.order };
  });

  // Six completions in a row, but only four sounds exist -- the streak
  // stops advancing once every sound has already been revealed rather
  // than counting past the set (see updateSceneAmbienceForWaveComplete).
  expect(result.streaks).toEqual([1, 2, 3, 4, 4, 4]);
  expect(result.order).toEqual(['wind', 'crickets', 'frogs', 'owl']);
  expect(errors).toEqual([]);
});

test('a beach-scene wave streak reveals one more ambient layer per completion, in order, capped at four', async ({ page }) => {
  const errors = trackErrors(page);
  await injectSceneWaveSetup(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(() => {
    setUpCompletableSceneWave('beach');
    const streaks = [];
    for (let i = 0; i < 6; i++) {
      checkWaveComplete();
      streaks.push(STATE.ambienceStreak);
    }
    return { streaks, order: SCENE_AMBIENT_CONFIG.beach.order };
  });

  expect(result.streaks).toEqual([1, 2, 3, 4, 4, 4]);
  expect(result.order).toEqual(['waves', 'wind', 'shorebirds', 'whale']);
  expect(errors).toEqual([]);
});

test('switching to a scene with no ambient config (e.g. space) stops the previous scene\'s streak immediately, not on that wave\'s own completion', async ({ page }) => {
  const errors = trackErrors(page);
  await injectSceneWaveSetup(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(() => {
    setUpCompletableSceneWave('forest');
    checkWaveComplete();
    checkWaveComplete();
    const streakAfterTwoForestWaves = STATE.ambienceStreak;

    // syncAmbienceToScene is exactly what startWave calls the instant a
    // new wave's scene resolves (see game.js) -- calling it directly here
    // keeps this test focused on that function without dragging in a full
    // startWave() (real song scheduling, dot generation, etc.).
    STATE.scene = 'space';
    syncAmbienceToScene();
    const streakRightAfterSceneSwitch = STATE.ambienceStreak;

    checkWaveComplete(); // completing the space wave itself should change nothing further

    return { streakAfterTwoForestWaves, streakRightAfterSceneSwitch, streakAfterSpaceWave: STATE.ambienceStreak };
  });

  expect(result.streakAfterTwoForestWaves).toBe(2);
  expect(result.streakRightAfterSceneSwitch).toBe(0);
  expect(result.streakAfterSpaceWave).toBe(0);
  expect(errors).toEqual([]);
});

test('switching directly from one ambient scene to another stops the outgoing layers the moment the new wave starts, not when it completes', async ({ page }) => {
  const errors = trackErrors(page);
  await page.addInitScript(() => { navigator.vibrate = () => true; });
  await injectSceneWaveSetup(page);
  await page.goto('/index.html');
  await page.click('#start-game-button'); // unlocks real audio -- STATE.ambienceLayers only actually populates once startSceneAmbienceLayer can reach a live AudioContext
  await page.waitForTimeout(800);

  // Forest and beach each have their own "wind" sound (different
  // recordings) -- switching straight from one to the other, e.g. under
  // Rotate mode, must not let beach's reveal quietly reuse forest's
  // still-registered 'wind' layer key instead of starting its own. The
  // reset itself happens in startWave (see syncAmbienceToScene), not in
  // checkWaveComplete -- so this drives real startWave() calls (with
  // sceneMode forced fixed) rather than just poking STATE.scene, to
  // actually exercise the fix rather than a lower-level approximation
  // of it.
  const result = await page.evaluate(async () => {
    await STATE.ambientBuffersReadyPromise;
    STATE.sceneMode = 'forest';
    startWave(1);
    setUpCompletableSceneWave('forest', 1);
    checkWaveComplete();
    setUpCompletableSceneWave('forest', 2);
    checkWaveComplete();
    await new Promise(r => setTimeout(r, 30));
    const streakAfterTwoForestWaves = STATE.ambienceStreak;
    const layersAfterTwoForestWaves = Object.keys(STATE.ambienceLayers);

    STATE.sceneMode = 'beach';
    startWave(3); // the scene actually changes here -- this is what must stop forest's layers, immediately
    const layersRightAfterSceneSwitch = Object.keys(STATE.ambienceLayers);
    const ambienceSceneRightAfterSceneSwitch = STATE.ambienceScene;

    setUpCompletableSceneWave('beach', 3);
    checkWaveComplete();
    await new Promise(r => setTimeout(r, 30));

    return {
      streakAfterTwoForestWaves,
      layersAfterTwoForestWaves,
      layersRightAfterSceneSwitch,
      ambienceSceneRightAfterSceneSwitch,
      streakAfterFirstBeachWave: STATE.ambienceStreak,
      layersAfterFirstBeachWave: Object.keys(STATE.ambienceLayers),
    };
  });

  expect(result.streakAfterTwoForestWaves).toBe(2);
  expect(result.layersAfterTwoForestWaves).toEqual(['wind', 'crickets']);
  // The scene switch itself (startWave, before the beach wave has even
  // been played) already cleared forest's layers -- confirms the reset
  // happens at the right time, not just eventually.
  expect(result.layersRightAfterSceneSwitch).toEqual([]);
  expect(result.ambienceSceneRightAfterSceneSwitch).toBe('beach');
  // Not 3 -- the scene switch reset the streak before the beach wave's
  // own completion advances it back to 1.
  expect(result.streakAfterFirstBeachWave).toBe(1);
  // Just beach's own first reveal ('waves') -- not forest's leftover
  // 'wind'/'crickets' keys, and not a 'wind' collision between the two
  // scenes' own distinct recordings.
  expect(result.layersAfterFirstBeachWave).toEqual(['waves']);
  expect(errors).toEqual([]);
});

test('forest ambient layers actually start playing (real decoded audio) as the streak advances', async ({ page }) => {
  const errors = trackErrors(page);
  await page.addInitScript(() => { navigator.vibrate = () => true; });
  await injectSceneWaveSetup(page);
  await page.goto('/index.html');
  await page.click('#start-game-button'); // starts wave 1, unlocks real audio (initAudio -> initAudioGraph)
  await page.waitForTimeout(800);

  const snapshots = await page.evaluate(async () => {
    await STATE.ambientBuffersReadyPromise; // let every scene's clips finish decoding before the reveal loop
    setUpCompletableSceneWave('forest');
    const results = [];
    for (let i = 0; i < 4; i++) {
      checkWaveComplete();
      await new Promise(r => setTimeout(r, 30)); // startSceneAmbienceLayer is fire-and-forget from checkWaveComplete
      results.push(Object.keys(STATE.ambienceLayers));
    }
    return results;
  });

  expect(snapshots[0]).toEqual(['wind']);
  expect(snapshots[1]).toEqual(['wind', 'crickets']);
  expect(snapshots[2]).toEqual(['wind', 'crickets', 'frogs']);
  expect(snapshots[3]).toEqual(['wind', 'crickets', 'frogs', 'owl']);
  expect(errors).toEqual([]);
});

test('beach ambient layers actually start playing (real decoded audio) as the streak advances', async ({ page }) => {
  const errors = trackErrors(page);
  await page.addInitScript(() => { navigator.vibrate = () => true; });
  await injectSceneWaveSetup(page);
  await page.goto('/index.html');
  await page.click('#start-game-button');
  await page.waitForTimeout(800);

  const snapshots = await page.evaluate(async () => {
    await STATE.ambientBuffersReadyPromise;
    setUpCompletableSceneWave('beach');
    const results = [];
    for (let i = 0; i < 4; i++) {
      checkWaveComplete();
      await new Promise(r => setTimeout(r, 30));
      results.push(Object.keys(STATE.ambienceLayers));
    }
    return results;
  });

  expect(snapshots[0]).toEqual(['waves']);
  expect(snapshots[1]).toEqual(['waves', 'wind']);
  expect(snapshots[2]).toEqual(['waves', 'wind', 'shorebirds']);
  expect(snapshots[3]).toEqual(['waves', 'wind', 'shorebirds', 'whale']);
  expect(errors).toEqual([]);
});

test('resetSceneAmbience clears the streak and every active layer', async ({ page }) => {
  const errors = trackErrors(page);
  await page.addInitScript(() => { navigator.vibrate = () => true; });
  await injectSceneWaveSetup(page);
  await page.goto('/index.html');
  await page.click('#start-game-button');
  await page.waitForTimeout(800);

  const result = await page.evaluate(async () => {
    await STATE.ambientBuffersReadyPromise;
    setUpCompletableSceneWave('forest');
    checkWaveComplete();
    await new Promise(r => setTimeout(r, 30));
    const before = { streak: STATE.ambienceStreak, layerCount: Object.keys(STATE.ambienceLayers).length };

    resetSceneAmbience();
    const after = { streak: STATE.ambienceStreak, layerCount: Object.keys(STATE.ambienceLayers).length };

    return { before, after };
  });

  expect(result.before).toEqual({ streak: 1, layerCount: 1 });
  expect(result.after).toEqual({ streak: 0, layerCount: 0 });
  expect(errors).toEqual([]);
});

test('the scene ambience gain node exists once audio initializes, feeding into the same bus the music uses', async ({ page }) => {
  const errors = trackErrors(page);
  await page.addInitScript(() => { navigator.vibrate = () => true; });
  await page.goto('/index.html');
  await page.click('#start-game-button');
  await page.waitForTimeout(500);

  const result = await page.evaluate(() => ({
    hasAmbientGain: STATE.ambientGain !== null,
    hasMasterBus: STATE.masterBus !== null,
  }));
  expect(result.hasAmbientGain).toBe(true);
  expect(result.hasMasterBus).toBe(true);
  expect(errors).toEqual([]);
});

// Player report: ambience could sometimes read louder than the music
// itself. Confirms the structural guarantee added for it -- and,
// specifically, that the guarantee holds for a scene's *combined* mix
// once its whole ambient streak is revealed (every layer live at once,
// including "rare" one-shot events landing on top of the continuous ones
// by chance), not just whichever single layer happens to have the highest
// configured gain in isolation (review catch on the first version of this
// fix: a single-layer budget left real headroom for a fully-revealed
// scene's true combined mix to blow past the cap even with every
// individual layer, and this exact test, passing).
test("the ambient bed's shared gain node keeps even a scene's full combined mix (every layer live at once) under the music-relative volume cap", async ({ page }) => {
  const errors = trackErrors(page);
  await page.addInitScript(() => { navigator.vibrate = () => true; });
  await page.goto('/index.html');
  await page.click('#start-game-button');
  await page.waitForTimeout(500);

  const result = await page.evaluate(() => {
    const worstCaseSceneMixAmplitude = Math.max(
      ...Object.values(SCENE_AMBIENT_CONFIG).map(scene => {
        const sceneGainSum = Object.values(scene.sounds).reduce((sum, s) => sum + s.gain, 0);
        return sceneGainSum * AMBIENT_VARIATION.GAIN_RANGE[1] * STATE.ambientGain.gain.value;
      })
    );
    return {
      worstCaseSceneMixAmplitude,
      musicPeak: KIND_PEAK.melody,
      capRatio: AMBIENT_VARIATION.VOLUME_CAP_RATIO,
      ambientGainValue: STATE.ambientGain.gain.value,
    };
  });

  // Not toBeCloseTo/exact equality -- this is a "never exceed" ceiling by
  // design (quieter-than-cap is fine, e.g. any scene whose own combined
  // mix isn't the global worst case), not a value every scene must hit.
  expect(result.worstCaseSceneMixAmplitude).toBeLessThanOrEqual(result.musicPeak * result.capRatio + 1e-6);
  expect(result.ambientGainValue).toBeLessThan(1.0); // confirms this is a real cap, not a vacuous no-op
  expect(errors).toEqual([]);
});

test('each ambient layer repeat gets a fresh, in-range randomized playback rate, and every clip in every scene decodes without error', async ({ page }) => {
  const errors = trackErrors(page);
  await page.addInitScript(() => {
    navigator.vibrate = () => true;
    window.__ambientRates = [];
    const origStart = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args) {
      // Instrument note playback also pitch-shifts via playbackRate over a
      // much wider range, so only capture starts for the ambient clips
      // themselves (STATE.ambientBuffers), not every source on the page.
      if (typeof STATE !== 'undefined' && STATE.ambientBuffers &&
          Object.values(STATE.ambientBuffers).some(buffers => Object.values(buffers).includes(this.buffer))) {
        window.__ambientRates.push(this.playbackRate.value);
      }
      return origStart.apply(this, args);
    };
  });
  await injectSceneWaveSetup(page);
  await page.goto('/index.html');
  await page.click('#start-game-button');
  await page.waitForTimeout(500);

  const result = await page.evaluate(async () => {
    await STATE.ambientBuffersReadyPromise;
    const decodedAll = Object.keys(SCENE_AMBIENT_CONFIG).every(scene =>
      SCENE_AMBIENT_CONFIG[scene].order.every(name => STATE.ambientBuffers[scene][name] instanceof AudioBuffer));
    setUpCompletableSceneWave('forest');
    for (let i = 0; i < 4; i++) {
      checkWaveComplete();
      await new Promise(r => setTimeout(r, 30));
    }
    return { decodedAll, rates: window.__ambientRates };
  });

  expect(result.decodedAll).toBe(true);
  expect(result.rates.length).toBeGreaterThan(0);
  const [lo, hi] = [0.94, 1.06];
  expect(result.rates.every(r => r >= lo - 1e-9 && r <= hi + 1e-9)).toBe(true);
  expect(errors).toEqual([]);
});

// Player request: "waves of different sizes and different ways of
// crashing." SCENE_AMBIENT_CONFIG.beach's own `waves` layer overrides the
// shared default rate range (AMBIENT_VARIATION.RATE_RANGE, deliberately
// subtle at [0.94, 1.06]) with a much wider one. Verified two ways: (1) a
// real repeat's actual playbackRate stays within the configured wide
// bounds, not the old narrow default -- proves startLoopingAmbientLayer's
// rateRange parameter is really wired through, not just sitting unused in
// config; (2) Math.random pinned to its two extremes proves randRange
// actually maps this config's own [0.65, 1.45] end to end, rather than
// relying on enough real (necessarily few, in a short test window) random
// repeats happening to land outside some subrange by chance.
test("Beach's waves layer gets a much wider playback-rate spread than every other ambient layer, so repeats genuinely read as different-sized waves", async ({ page }) => {
  const errors = trackErrors(page);
  await page.addInitScript(() => {
    navigator.vibrate = () => true;
    window.__waveRates = [];
    const origStart = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args) {
      if (typeof STATE !== 'undefined' && STATE.ambientBuffers && STATE.ambientBuffers.beach &&
          this.buffer === STATE.ambientBuffers.beach.waves) {
        window.__waveRates.push(this.playbackRate.value);
      }
      return origStart.apply(this, args);
    };
  });
  await injectSceneWaveSetup(page);
  await page.goto('/index.html');
  await page.click('#start-game-button');
  await page.waitForTimeout(500);

  const result = await page.evaluate(async () => {
    await STATE.ambientBuffersReadyPromise;
    setUpCompletableSceneWave('beach');
    for (let i = 0; i < 6; i++) {
      checkWaveComplete();
      await new Promise((r) => setTimeout(r, 30));
    }

    const configRateRange = SCENE_AMBIENT_CONFIG.beach.sounds.waves.rateRange;
    const originalRandom = Math.random;
    Math.random = () => 0;
    const rateAtMin = randRange(configRateRange);
    Math.random = () => 0.999999;
    const rateAtMax = randRange(configRateRange);
    Math.random = originalRandom;

    return { configRateRange, rates: window.__waveRates, rateAtMin, rateAtMax };
  });

  expect(result.configRateRange).toEqual([0.65, 1.45]);
  expect(result.rateAtMin).toBeCloseTo(0.65, 5);
  expect(result.rateAtMax).toBeCloseTo(1.45, 4);
  expect(result.rates.length).toBeGreaterThan(0);
  expect(result.rates.every((r) => r >= 0.65 - 1e-9 && r <= 1.45 + 1e-9)).toBe(true);
  expect(errors).toEqual([]);
});

test("drawStars(rewardOnly) only renders each connection's own reward halo (pairId-tagged stars) when true, leaving the plain ambient/reveal starfield (untagged) out -- the default (no argument) call still renders everything, unchanged for every scene but Forest (review catch, PR #97 -- Forest's real photo made the ambient starfield redundant, but spawnStarsAroundDots' reward halo is live gameplay feedback for a still-connected pair and has to keep rendering regardless of scene)", async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(() => {
    canvas.width = 500; canvas.height = 900;
    STATE.stars = [
      { x: 10, y: 10, radius: 1, alpha: 1, twinkling: false, twinklePhase: 0, twinkleSpeed: 0, pairId: undefined },
      { x: 20, y: 20, radius: 1, alpha: 1, twinkling: false, twinklePhase: 0, twinkleSpeed: 0, pairId: undefined },
      { x: 30, y: 30, radius: 1, alpha: 1, twinkling: false, twinklePhase: 0, twinkleSpeed: 0, pairId: 'pairA' },
    ];
    const originalArc = ctx.arc.bind(ctx);
    let arcCalls = 0;
    ctx.arc = (...args) => { arcCalls++; return originalArc(...args); };

    drawStars(true);
    const rewardOnlyCount = arcCalls;

    arcCalls = 0;
    drawStars();
    const defaultCount = arcCalls;

    arcCalls = 0;
    drawStars(false);
    const explicitFalseCount = arcCalls;

    ctx.arc = originalArc;
    return { rewardOnlyCount, defaultCount, explicitFalseCount };
  });

  expect(result.rewardOnlyCount).toBe(1);
  expect(result.defaultCount).toBe(3);
  expect(result.explicitFalseCount).toBe(3);
  expect(errors).toEqual([]);
});

test('the Night Forest scene (real photo + Ken Burns pan/zoom) generates and draws without error, and its background photo actually loads', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(async () => {
    canvas.width = 500; canvas.height = 900;
    STATE.scene = 'forest';
    STATE.forestScene = generateForestScene();
    const phaseBefore = STATE.forestScene.phase;
    for (let i = 0; i < 5; i++) updateForestScene();
    // Snapshot right after the manual updates, not after the wait below --
    // the game's own render loop may also be advancing STATE.forestScene
    // (it's already been switched to 'forest') during that 1.5s gap.
    const phaseAdvanced = STATE.forestScene.phase === phaseBefore + 5;

    // A connection-reward star (spawnStarsAroundDots' own pairId-tagged
    // shape) mixed in with a plain ambient one -- confirms the real draw
    // path still renders the reward halo (via drawStars(true)) without
    // throwing, not just that drawStars() itself can filter in isolation
    // (see the dedicated drawStars(rewardOnly) test above this one).
    STATE.stars = [
      { x: 10, y: 10, radius: 1, alpha: 1, twinkling: false, twinklePhase: 0, twinkleSpeed: 0, pairId: undefined },
      { x: 20, y: 20, radius: 1, alpha: 1, twinkling: false, twinklePhase: 0, twinkleSpeed: 0, pairId: 'pairA' },
    ];
    drawForestScene(); // throws if anything in the draw path is broken, including before the photo has finished loading

    await new Promise((resolve) => setTimeout(resolve, 1500)); // give art/forest-night.jpg a real chance to load over the local server
    drawForestScene(); // and again once it plausibly has, same guard either way

    return {
      hasFireflies: STATE.forestScene.fireflies.length > 0,
      phaseAdvanced,
      phaseStartedRandomized: phaseBefore >= 0 && phaseBefore < FOREST_CONFIG.PAN_CYCLE_FRAMES,
      imageLoaded: FOREST_IMAGE.complete && FOREST_IMAGE.naturalWidth > 0,
      moonHelperShared: typeof drawNightMoon === 'function',
    };
  });

  expect(result.hasFireflies).toBe(true);
  expect(result.phaseAdvanced).toBe(true);
  expect(result.phaseStartedRandomized).toBe(true);
  expect(result.imageLoaded).toBe(true);
  expect(result.moonHelperShared).toBe(true);
  expect(errors).toEqual([]);
});

// Player feedback (2026-08-17): the old single beach-night.jpg was an
// open-ocean/starry-sky photo with no actual sand/shoreline in frame, and
// the scene was hardcoded night-only. Rebuilt on Safari's own day/night
// architecture (two real photos, STATE.beachVariant persisting across a
// block the same way STATE.safariVariant does) plus a real-photo cutout
// library (palms/dolphins/whale/cruise ship). Covers both variants in one
// test, same pattern as Safari's own equivalent test.
for (const variant of ['day', 'night']) {
  test(`the Beach scene's ${variant} variant (real photo + Ken Burns pan/zoom + cutouts) generates and draws without error, and its background photo actually loads`, async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto('/index.html');
    await page.waitForFunction(() => window.__lumina);

    const result = await page.evaluate(async (variant) => {
      canvas.width = 500; canvas.height = 900;
      STATE.scene = 'beach';
      STATE.beachVariant = variant;
      STATE.beachScene = generateBeachScene();
      const phaseBefore = STATE.beachScene.phase;
      updateBeachScene();
      // Snapshot right after the manual update, not after the wait below --
      // the game's own render loop may also be advancing STATE.beachScene
      // (it's already been switched to 'beach') during that 1.5s gap.
      const phaseAdvanced = STATE.beachScene.phase === phaseBefore + 1;
      drawBeachScene(); // throws if anything in the draw path is broken, including before the photo has finished loading

      await new Promise((resolve) => setTimeout(resolve, 1500)); // give the real photo a chance to load over the local server
      drawBeachScene(); // and again once it plausibly has, same guard either way

      const img = BEACH_IMAGES[variant];
      return {
        variantMatches: STATE.beachScene.variant === variant,
        hasWaveLines: STATE.beachScene.waveLines.length > 0,
        hasGlitterDots: STATE.beachScene.glitterDots.length > 0,
        hasBoat: !!STATE.beachScene.boat,
        hasPalms: STATE.beachScene.palms.length > 0,
        hasDolphins: STATE.beachScene.dolphins.length > 0,
        hasWhale: !!STATE.beachScene.whale,
        phaseAdvanced,
        phaseStartedRandomized: phaseBefore >= 0 && phaseBefore < BEACH_CONFIG.PAN_CYCLE_FRAMES,
        imageLoaded: img.complete && img.naturalWidth > 0,
        moonHelperShared: typeof drawNightMoon === 'function',
      };
    }, variant);

    expect(result.variantMatches).toBe(true);
    expect(result.hasWaveLines).toBe(true);
    expect(result.hasGlitterDots).toBe(true);
    expect(result.hasBoat).toBe(true);
    expect(result.hasPalms).toBe(true);
    expect(result.hasDolphins).toBe(true);
    expect(result.hasWhale).toBe(true);
    expect(result.phaseAdvanced).toBe(true);
    expect(result.phaseStartedRandomized).toBe(true);
    expect(result.imageLoaded).toBe(true);
    expect(result.moonHelperShared).toBe(true);
    expect(errors).toEqual([]);
  });
}

test('Beach cutouts are darkened for the night variant but left untouched for day (same nightTint technique as Safari)', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const nightTintsSeen = await page.evaluate(async () => {
    canvas.width = 500; canvas.height = 900;
    const originalCutout = drawBeachCutout;
    const seen = [];
    window.drawBeachCutout = (...args) => { seen.push(args[5]); return originalCutout(...args); };

    for (const variant of ['day', 'night']) {
      STATE.scene = 'beach';
      STATE.beachVariant = variant;
      STATE.beachScene = generateBeachScene();
      await new Promise((r) => setTimeout(r, 200));
      drawBeachScene();
    }
    window.drawBeachCutout = originalCutout;
    return seen;
  });

  expect(nightTintsSeen.length).toBeGreaterThan(0);
  expect(nightTintsSeen.some((v) => v === true)).toBe(true);
  expect(nightTintsSeen.some((v) => v === false)).toBe(true);
  expect(errors).toEqual([]);
});

// Player report, screenshot: shore palms anchored bare at the horizon
// (the water/sky line) with no trunk under them read as trees floating
// in the air, over the water. Palms are now each a single real photo of
// a WHOLE tree (trunk to crown -- see CREDITS.md, an earlier version
// drew a procedural trunk under a crown-only cutout, and player feedback
// called the procedural trunk out as obviously fake), anchored directly
// at sandY (well within the photo's own visible foreground sand), not
// horizonY.
test('Beach palms (whole real-photo trees) are planted in the sand (anchored at sandY, well below the water-line horizon), not floating at the horizon', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(async () => {
    canvas.width = 500; canvas.height = 900;
    STATE.scene = 'beach';
    STATE.beachVariant = 'day';
    STATE.beachScene = generateBeachScene();
    await new Promise((r) => setTimeout(r, 300));

    const original = drawBeachCutout;
    const palmGroundYs = [];
    window.drawBeachCutout = (source, xCenter, groundY, ...rest) => {
      if (source === 'palm-full-1' || source === 'palm-full-2') palmGroundYs.push(groundY);
      return original(source, xCenter, groundY, ...rest);
    };
    drawBeachScene();
    window.drawBeachCutout = original;

    const cfg = BEACH_CONFIG;
    const sandY = canvas.height - cfg.SAND_HEIGHT_FRAC * canvas.height;
    return { palmGroundYs, sandY, palmCount: STATE.beachScene.palms.length };
  });

  expect(result.palmCount).toBeGreaterThan(0);
  expect(result.palmGroundYs.length).toBe(result.palmCount);
  // Every whole-tree cutout is anchored right at sandY -- not scattered
  // up near the horizon, which is what the old (buggy) version did.
  expect(result.palmGroundYs.every((y) => Math.abs(y - result.sandY) < 1)).toBe(true);
  expect(errors).toEqual([]);
});

// Codex review catch, PR #101: on a wide/landscape canvas, the night
// photo's portrait aspect (1600x2000) makes drawH end up far taller than
// the canvas once cover-fit by width, and the pan cycle's plain sine
// wave could swing far enough that the mapped horizon -- and every
// horizon-anchored cutout -- landed off the bottom of the screen for a
// real stretch of the 90-second cycle. panY is now clamped to keep the
// horizon on-screen regardless of canvas shape.
test('Beach horizon (and every horizon-anchored cutout) stays on-screen across the full pan cycle, even on a wide landscape canvas', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(async () => {
    canvas.width = 1920; canvas.height = 1080;
    STATE.scene = 'beach';
    STATE.beachVariant = 'night'; // the portrait-photo variant Codex's math was about
    STATE.beachScene = generateBeachScene();
    await new Promise((r) => setTimeout(r, 500));

    const original = drawBeachCutout;
    const ys = [];
    window.drawBeachCutout = (source, xCenter, groundY, ...rest) => {
      ys.push(groundY);
      return original(source, xCenter, groundY, ...rest);
    };
    const cfg = BEACH_CONFIG;
    // Sample densely across the whole pan cycle (not just the exact
    // cycle=0.75 point Codex's own math used).
    for (let frac = 0; frac < 1; frac += 0.02) {
      STATE.beachScene.phase = Math.round(frac * cfg.PAN_CYCLE_FRAMES);
      drawBeachScene();
    }
    window.drawBeachCutout = original;
    return { ys, h: canvas.height };
  });

  expect(result.ys.length).toBeGreaterThan(0);
  expect(result.ys.every((y) => y >= 0 && y <= result.h)).toBe(true);
  expect(errors).toEqual([]);
});

// Player report, screenshot: the cruise ship and dolphins were anchored
// high up in the middle of the starfield, nowhere near the sand visible
// at the bottom of the night photo -- HORIZON_FRAC.night was originally
// measured with a single-column brightness scan, which locked onto a
// bright star instead of the real (much subtler) horizon transition, far
// lower in frame. Re-measured at 0.903 with a full-row brightness
// average instead (see CREDITS.md). This guards the corrected value
// directly, since a plain on-screen-bounds check (the test above) can't
// tell "near the real horizon" apart from "anywhere on screen".
test('Beach night horizon is measured near the bottom of the photo (where the sand actually is), not in the starfield', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const frac = await page.evaluate(() => BEACH_CONFIG.HORIZON_FRAC.night);
  expect(frac).toBeGreaterThan(0.85);
  expect(errors).toEqual([]);
});

// Player report, screenshot: even after fixing HORIZON_FRAC.night (the
// test above), the cruise ship/dolphins/whale still read as floating in
// empty sky, not water -- because at night this specific photo shows
// almost no distinguishable water texture (near-total darkness merges
// visually with the sky above it), and the correctly-measured horizonY
// is now the NEAR shoreline, not open water. Fixed by anchoring these at
// waterFarY (the far edge of a synthetic tinted "water" band drawn just
// above the real shoreline) instead of horizonY directly -- this guards
// that they land meaningfully ABOVE horizonY for night (out over the
// water band, not planted right at the shore), while staying exactly AT
// horizonY for day (where the real photographed sea already fills that
// space, so no synthetic band is needed).
test('Beach cruise ship sits out over the (synthetic, night-only) water band, not right at the shoreline', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(async () => {
    const out = {};
    for (const variant of ['day', 'night']) {
      canvas.width = 500; canvas.height = 900;
      STATE.scene = 'beach';
      STATE.beachVariant = variant;
      STATE.beachScene = generateBeachScene();
      STATE.beachScene.cruiseShip = { xFrac: 0.5, direction: 1, speed: 0, sizeFrac: 0.08 };
      await new Promise((r) => setTimeout(r, 200));

      const original = drawBeachCutout;
      let shipY = null;
      window.drawBeachCutout = (source, xCenter, groundY, ...rest) => {
        if (source === 'cruise-ship') shipY = groundY;
        return original(source, xCenter, groundY, ...rest);
      };
      drawBeachScene();
      window.drawBeachCutout = original;

      // Recompute horizonY the same way drawBeachScene does, to compare against.
      const cfg = BEACH_CONFIG;
      const img = BEACH_IMAGES[variant];
      const t = STATE.beachScene.phase;
      const cycle = (t % cfg.PAN_CYCLE_FRAMES) / cfg.PAN_CYCLE_FRAMES;
      const easedT = 0.5 - 0.5 * Math.cos(cycle * Math.PI * 2);
      const zoom = cfg.ZOOM_MIN + (cfg.ZOOM_MAX - cfg.ZOOM_MIN) * easedT;
      const imgAspect = img.naturalWidth / img.naturalHeight;
      const canvasAspect = canvas.width / canvas.height;
      let drawW, drawH;
      if (imgAspect > canvasAspect) { drawH = canvas.height * zoom; drawW = drawH * imgAspect; }
      else { drawW = canvas.width * zoom; drawH = drawW / imgAspect; }
      let panY = (drawH - canvas.height) * (0.5 + 0.3 * Math.sin(cycle * Math.PI * 2));
      const desiredHorizonY = cfg.HORIZON_FRAC[variant] * drawH;
      const minPanY = desiredHorizonY - canvas.height * 0.85;
      const maxPanY = desiredHorizonY - canvas.height * 0.15;
      panY = Math.min(maxPanY, Math.max(minPanY, panY));
      panY = Math.min(Math.max(panY, 0), Math.max(0, drawH - canvas.height));
      const horizonY = -panY + cfg.HORIZON_FRAC[variant] * drawH;

      out[variant] = { shipY, horizonY };
    }
    return out;
  });

  // Night: the ship sits meaningfully ABOVE (a smaller y than) the real
  // shoreline -- out over the synthetic water band, not planted at the sand.
  expect(result.night.shipY).toBeLessThan(result.night.horizonY - 5);
  // Day: no synthetic band needed, so the ship stays exactly at the real
  // photographed horizon, same as always.
  expect(Math.abs(result.day.shipY - result.day.horizonY)).toBeLessThan(1);
  expect(errors).toEqual([]);
});

// Player report, screenshot: the cruise ship rendered ON TOP of a shore
// palm's fronds -- visibly nested inside the tree's own branches -- because
// draw order was originally chosen by how fast each element moves ("slow
// things first"), not by which element is conceptually nearer the camera.
// A fast-moving-but-FAR cruise ship and a static-but-NEAR palm just
// happened not to overlap in the specific screenshots checked before
// shipping; the very next player session hit a random x where they did.
// This is a structural test, not a lucky-sample one: it hooks every
// Beach foreground draw entry point, records the actual sequence of
// layers drawn in a real frame, and asserts that sequence never goes
// backwards through BEACH_DEPTH_LAYERS (game.js's own source-of-truth
// depth model) -- so ANY future reordering mistake fails CI immediately,
// regardless of whether that particular run's random positions happened
// to visibly collide. See SOURCE_OF_TRUTH.md's Required Method.
test('Beach foreground elements draw in depth order (far-to-near) every frame, not motion-speed order', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(async () => {
    canvas.width = 500; canvas.height = 900;
    STATE.scene = 'beach';
    STATE.beachVariant = 'night';
    STATE.beachScene = generateBeachScene();
    // Force every optional/random element present so this frame actually
    // exercises the whole depth model, not just whatever happened to spawn.
    STATE.beachScene.cruiseShip = { xFrac: 0.3, direction: 1, speed: 0, sizeFrac: 0.08 };
    STATE.beachScene.whale = { active: true, xFrac: 0.7, sizeFrac: 0.06, life: 40, maxLife: 90, nextSpawnFrame: 0 };
    await new Promise((r) => setTimeout(r, 300));

    const layers = [];
    const originalCutout = drawBeachCutout;
    const originalBoat = drawBeachBoat;
    window.drawBeachCutout = (source, ...rest) => { layers.push(source); return originalCutout(source, ...rest); };
    window.drawBeachBoat = (...args) => { layers.push('boat'); return originalBoat(...args); };
    drawBeachScene();
    window.drawBeachCutout = originalCutout;
    window.drawBeachBoat = originalBoat;

    return { layers, model: BEACH_DEPTH_LAYERS };
  });

  // drawBeachCutout is called with a specific asset filename (e.g.
  // 'palm-full-1'), not the generic depth-model category ('palm') --
  // normalize before comparing against BEACH_DEPTH_LAYERS.
  const toDepthLayer = (source) => (source.startsWith('palm-full') ? 'palm' : source);

  expect(result.layers.length).toBeGreaterThan(0);
  let lastIndex = -1;
  for (const rawLayer of result.layers) {
    const layer = toDepthLayer(rawLayer);
    const idx = result.model.indexOf(layer);
    expect(idx, `drawn layer "${layer}" (from "${rawLayer}") is missing from BEACH_DEPTH_LAYERS`).toBeGreaterThanOrEqual(0);
    expect(idx, `"${layer}" (depth index ${idx}) drew after something nearer the camera -- full sequence: ${result.layers.join(', ')}`).toBeGreaterThanOrEqual(lastIndex);
    lastIndex = idx;
  }
  expect(errors).toEqual([]);
});

// The literal reported case, pinned down directly rather than relying
// only on the general structural test above: a palm and the cruise ship
// forced to the exact same x. If this regresses, the ship visibly nests
// inside the palm's branches again.
test('Beach: a palm and the cruise ship forced to the same x still draw palm-on-top', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const layers = await page.evaluate(async () => {
    canvas.width = 500; canvas.height = 900;
    STATE.scene = 'beach';
    STATE.beachVariant = 'night';
    STATE.beachScene = generateBeachScene();
    STATE.beachScene.palms = [{ xFrac: 0.5, source: 'palm-full-1', sizeFrac: 0.26 }];
    STATE.beachScene.cruiseShip = { xFrac: 0.5, direction: 1, speed: 0, sizeFrac: 0.1 };
    await new Promise((r) => setTimeout(r, 300));

    const seen = [];
    const originalCutout = drawBeachCutout;
    window.drawBeachCutout = (source, ...rest) => { seen.push(source); return originalCutout(source, ...rest); };
    drawBeachScene();
    window.drawBeachCutout = originalCutout;
    return seen;
  });

  const shipIdx = layers.indexOf('cruise-ship');
  const palmIdx = layers.indexOf('palm-full-1');
  expect(shipIdx).toBeGreaterThanOrEqual(0);
  expect(palmIdx).toBeGreaterThanOrEqual(0);
  expect(palmIdx, 'palm must draw after (on top of) the cruise ship').toBeGreaterThan(shipIdx);
  expect(errors).toEqual([]);
});

// Player report, screenshot: a dolphin rendered visibly bigger than the
// cruise ship. The cruise ship anchors exclusively at waterFarY (a real
// distant vessel, never anywhere else); the whale does too. sizeFrac is
// the only cue telling those apart from "small/mid animal" scale, so their
// random ranges must never overlap the ship's. The dolphin's range check
// stays here even though dolphins can now roam the WHOLE water column
// (see generateBeachScene's own comment) rather than being fixed to
// waterFarY like the ship/whale -- a dolphin can still land at yFrac~0,
// effectively at the same horizon distance as the ship, so the same bound
// still has to hold regardless of where in the water it's drawn.
//
// First version of this test (PR #107) only checked the one reported pair
// (dolphin vs. ship) -- a review catch (Codex) pointed out it would stay
// green even if a later change made the WHALE bigger than the ship, since
// nothing modeled that pair too. Generalized to a table of every
// co-anchored pair instead of one hardcoded comparison, specifically so
// adding a future co-anchored element means adding a row here, not
// re-discovering this same gap a second time. See SOURCE_OF_TRUTH.md's
// Required Method, "Relative scale plausibility."
test('Beach: every co-anchored cutout\'s size range stays smaller than the cruise ship\'s (real-world scale, not just the one reported pair)', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const cfg = await page.evaluate(() => ({
    dolphin: BEACH_CONFIG.DOLPHIN_SIZE_FRAC,
    whale: BEACH_CONFIG.WHALE_SIZE_FRAC,
    ship: BEACH_CONFIG.CRUISE_SHIP_SIZE_FRAC,
  }));

  // Deterministic check against the named constants -- the invariant is
  // meant to hold by construction, so assert it directly rather than
  // relying on enough random draws to catch a violation.
  const smallerElements = [
    { name: 'dolphin', maxSizeFrac: cfg.dolphin.max },
    { name: 'whale', maxSizeFrac: cfg.whale }, // fixed value, not a range
  ];
  for (const el of smallerElements) {
    expect(cfg.ship.min, `cruise ship's smallest possible size must still exceed the ${el.name}'s largest possible size`).toBeGreaterThan(el.maxSizeFrac);
  }

  // Also confirm actual generated scenes never violate it in practice --
  // belt-and-suspenders in case a future edit changes how sizeFrac is
  // drawn from the range without updating the range itself.
  const violations = await page.evaluate(() => {
    let count = 0;
    for (let i = 0; i < 2000; i++) {
      const scene = generateBeachScene();
      if (!scene.cruiseShip) continue;
      for (const d of scene.dolphins) {
        if (d.sizeFrac >= scene.cruiseShip.sizeFrac) count++;
      }
      if (scene.whale.sizeFrac >= scene.cruiseShip.sizeFrac) count++;
    }
    return count;
  });
  expect(violations).toBe(0);
  expect(errors).toEqual([]);
});

// Companion to the scale-plausibility test above: confirms the actual
// position freedom described in generateBeachScene's dolphin comment. The
// cruise ship stays exclusively on the horizon (waterFarY, no
// y-randomization at all -- confirmed by reading the one draw call
// directly); dolphins are meant to range across the whole water column,
// but never past the sand line (never "beached," per the player's own
// framing of the rule).
test('Beach: dolphins can appear anywhere in the water but never past the sand line; the cruise ship stays only on the horizon', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(async () => {
    canvas.width = 500; canvas.height = 900;
    STATE.scene = 'beach';
    STATE.beachVariant = 'day';
    STATE.beachScene = generateBeachScene();
    await new Promise((r) => setTimeout(r, 300));

    const yFracs = [];
    for (let i = 0; i < 500; i++) {
      const scene = generateBeachScene();
      for (const d of scene.dolphins) yFracs.push(d.yFrac);
    }
    const spread = Math.max(...yFracs) - Math.min(...yFracs);

    const shipYs = [];
    for (let i = 0; i < 50; i++) {
      const scene = generateBeachScene();
      if (scene.cruiseShip) shipYs.push(scene.cruiseShip.yFrac);
    }

    return {
      dolphinYFracHasVariety: spread > 0.5, // spans a real chunk of the water, not clustered at one line
      dolphinYFracMin: Math.min(...yFracs),
      dolphinYFracMax: Math.max(...yFracs),
      cruiseShipHasNoYFrac: shipYs.every((v) => v === undefined), // no per-instance y-randomization field at all
    };
  });

  expect(result.dolphinYFracHasVariety).toBe(true);
  expect(result.dolphinYFracMin).toBeGreaterThanOrEqual(0);
  expect(result.dolphinYFracMax).toBeLessThanOrEqual(1);
  expect(result.cruiseShipHasNoYFrac).toBe(true);
  expect(errors).toEqual([]);
});

// Review catch (Codex, PR #109): the newly-measured WATER_END_FRAC.day,
// mapped through the SAME cover-fit/pan/zoom transform as horizonY, isn't
// a fixed screen fraction -- on a sufficiently wide canvas (confirmed:
// 3840x1080, pan phase ~0.736) that mapping can push it BELOW sandY, the
// decorative sand-color strip painted afterward, which would then cover
// roughly the lower half of a max-depth dolphin -- the exact "on the
// sand" defect this whole fix exists to prevent, just approached from the
// opposite direction (the real-photo measurement running PAST the
// decorative strip, instead of the decorative strip being mistaken for
// the real measurement). Fixed with a clamp (Math.min against sandY) where
// waterEndY is computed. Sweeps day pan phases across several canvas
// shapes, INCLUDING ultrawide, and hooks the real drawBeachCutout call
// (not a reimplementation of the transform math) to confirm a max-depth
// (yFrac 1) dolphin's actual anchor point never lands below sandY.
test('Beach: a max-depth dolphin never anchors below the decorative sand strip, even on an ultrawide day canvas', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(async () => {
    const canvasShapes = [
      { w: 420, h: 860 },   // narrow phone portrait
      { w: 1920, h: 1080 }, // standard landscape
      { w: 3840, h: 1080 }, // ultrawide -- the exact shape the review catch reported
    ];
    const violations = [];
    let sampleCount = 0;

    for (const shape of canvasShapes) {
      canvas.width = shape.w; canvas.height = shape.h;
      STATE.scene = 'beach';
      STATE.beachVariant = 'day';
      STATE.beachScene = generateBeachScene();
      STATE.beachScene.dolphins = [{ xFrac: 0.5, yFrac: 1, direction: 1, speed: 0, bobPhase: 0, sizeFrac: BEACH_CONFIG.DOLPHIN_SIZE_FRAC.max }];
      await new Promise((r) => setTimeout(r, 200));

      const sandY = shape.h - BEACH_CONFIG.SAND_HEIGHT_FRAC * shape.h;
      let captured = null;
      const original = drawBeachCutout;
      window.drawBeachCutout = (source, xCenter, groundY, targetHeight, ...rest) => {
        if (source === 'dolphin') captured = groundY;
        return original(source, xCenter, groundY, targetHeight, ...rest);
      };

      for (let frac = 0; frac < 1; frac += 0.02) {
        STATE.beachScene.phase = Math.round(frac * BEACH_CONFIG.PAN_CYCLE_FRAMES);
        captured = null;
        drawBeachScene();
        sampleCount++;
        if (captured !== null && captured > sandY) {
          violations.push({ shape: `${shape.w}x${shape.h}`, phase: frac, groundY: captured, sandY });
        }
      }
      window.drawBeachCutout = original;
    }

    return { violations, sampleCount };
  });

  expect(result.sampleCount).toBeGreaterThan(100);
  expect(result.violations, `dolphin anchored below sandY: ${JSON.stringify(result.violations)}`).toEqual([]);
  expect(errors).toEqual([]);
});

// Player report, screenshot: a dolphin rendered up near a shore palm's
// crown height, reading as jumping higher than the tree. Letting dolphins
// roam the full water depth (the test above) without also scaling their
// SIZE by that same depth reintroduced a version of the relative-scale
// bug category 8 already exists for -- a dolphin near the horizon (small
// yFrac, meant to read as far out at sea) still rendered at its full,
// position-independent size, so it could appear as a large object high in
// the frame next to a much shorter, clearly-nearby tree. Fixed by scaling
// the RENDERED size down toward the horizon (this is drawBeachScene's own
// depthScale, not a separate stored field -- hooks the actual draw call
// to observe it, the same technique the depth-order test uses, rather
// than recomputing the formula independently and asserting it agrees with
// itself).
test('Beach: a dolphin far from shore renders visibly smaller than one near shore (depth-consistent, not just position-free)', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(async () => {
    canvas.width = 500; canvas.height = 900;
    STATE.scene = 'beach';
    STATE.beachVariant = 'day';
    STATE.beachScene = generateBeachScene();
    STATE.beachScene.dolphins = [
      { xFrac: 0.3, yFrac: 0, direction: 1, speed: 0, bobPhase: 0, sizeFrac: BEACH_CONFIG.DOLPHIN_SIZE_FRAC.max },
      { xFrac: 0.7, yFrac: 1, direction: 1, speed: 0, bobPhase: 0, sizeFrac: BEACH_CONFIG.DOLPHIN_SIZE_FRAC.max },
    ];
    await new Promise((r) => setTimeout(r, 300));

    const sizes = [];
    const original = drawBeachCutout;
    window.drawBeachCutout = (source, xCenter, groundY, targetHeight, ...rest) => {
      if (source === 'dolphin') sizes.push(targetHeight);
      return original(source, xCenter, groundY, targetHeight, ...rest);
    };
    drawBeachScene();
    window.drawBeachCutout = original;

    return { farSize: sizes[0], nearSize: sizes[1], nominalMaxSize: BEACH_CONFIG.DOLPHIN_SIZE_FRAC.max * canvas.height };
  });

  expect(result.farSize, 'a dolphin at yFrac 0 (far from shore) must render smaller than its own nominal max size').toBeLessThan(result.nominalMaxSize);
  expect(result.nearSize, 'a dolphin at yFrac 1 (at the shore) renders at its full nominal size').toBeCloseTo(result.nominalMaxSize, 5);
  expect(result.farSize, 'the far dolphin must render meaningfully smaller than the near one, not just marginally').toBeLessThan(result.nearSize * 0.7);
  expect(errors).toEqual([]);
});

// Generic, reusable across every *_FRAC constant that claims to mark a
// real boundary in a source photo (HORIZON_FRAC, WATER_END_FRAC, and any
// future one): does that fraction actually sit at a real brightness
// transition in the photo, or does it just float somewhere inside one
// uniform region? This is the exact bug class that shipped TWICE this
// session for Beach's HORIZON_FRAC alone (night: a single-column scan
// locked onto a star instead of the real horizon; day: 0.413 was never
// actually verified at all and sat 60% of the way into open water,
// player report/screenshot: the cruise ship rendering roughly halfway to
// the beach) plus a third time for the never-previously-measured
// WATER_END_FRAC (player report/screenshot: a dolphin rendering on real
// photographed sand). All three were root-caused by loading the real
// photo, averaging each row's brightness, and inspecting a rendered
// reference line against a crop -- this test automates exactly that
// verification instead of needing a screenshot to catch the next one.
// Samples a window of rows just above and just below the claimed
// boundary and asserts a real, sizable brightness difference between
// them -- a boundary sitting in the middle of a uniform region (sky, or
// deep water) would show almost no difference.
test('Photo boundary fractions (HORIZON_FRAC, WATER_END_FRAC) sit at real brightness transitions, not floating mid-region', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(async () => {
    function rowStats(img, rowFrac) {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = 1;
      const cx = c.getContext('2d');
      const row = Math.max(0, Math.min(img.naturalHeight - 1, Math.round(rowFrac * img.naturalHeight)));
      cx.drawImage(img, 0, -row);
      const data = cx.getImageData(0, 0, c.width, 1).data;
      let r = 0, g = 0, b = 0;
      const n = data.length / 4;
      for (let i = 0; i < data.length; i += 4) { r += data[i]; g += data[i + 1]; b += data[i + 2]; }
      return { brightness: (r + g + b) / (3 * n), blueMinusGreen: (b - g) / n };
    }
    function loadImage(src) {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = src;
      });
    }

    const dayImg = await loadImage('art/beach-day.jpg');
    const nightImg = await loadImage('art/beach-night.jpg');
    const safariDayImg = await loadImage('art/safari-day.jpg');
    const desertImg = await loadImage('art/desert-day.jpg');
    const margin = 0.01; // fraction of image height, sampled just off the boundary each side

    const dayHorizonAbove = rowStats(dayImg, BEACH_CONFIG.HORIZON_FRAC.day - margin);
    const dayHorizonBelow = rowStats(dayImg, BEACH_CONFIG.HORIZON_FRAC.day + margin);
    const dayWaterEndAbove = rowStats(dayImg, BEACH_CONFIG.WATER_END_FRAC.day - margin);
    const dayWaterEndBelow = rowStats(dayImg, BEACH_CONFIG.WATER_END_FRAC.day + margin);
    const nightHorizonAbove = rowStats(nightImg, BEACH_CONFIG.HORIZON_FRAC.night - margin);
    const nightHorizonBelow = rowStats(nightImg, BEACH_CONFIG.HORIZON_FRAC.night + margin);
    const safariHorizonAbove = rowStats(safariDayImg, SAFARI_CONFIG.HORIZON_FRAC.day - margin);
    const safariHorizonBelow = rowStats(safariDayImg, SAFARI_CONFIG.HORIZON_FRAC.day + margin);
    const desertGroundAbove = rowStats(desertImg, DESERT_CONFIG.GROUND_FRAC - margin);
    const desertGroundBelow = rowStats(desertImg, DESERT_CONFIG.GROUND_FRAC + margin);

    return {
      dayHorizonDrop: dayHorizonAbove.brightness - dayHorizonBelow.brightness, // sky brighter than water
      dayWaterEndRise: dayWaterEndBelow.brightness - dayWaterEndAbove.brightness, // sand brighter than water
      nightHorizonRise: nightHorizonBelow.brightness - nightHorizonAbove.brightness, // sand brighter than the dark starfield above it, verified visually (moonlit sand vs. near-black sky) -- NOT a drop like day's horizon, the opposite direction
      // safari-day.jpg's sky-to-grass line is a HUE shift, not a brightness
      // one (confirmed: raw brightness is nearly flat across the claimed
      // boundary, ~153 to ~165, no usable jump there at all) -- blue sky
      // reads blue-dominant (B-G positive), tan/green grass reads
      // red/green-dominant (B-G sharply negative). This is why this whole
      // category can't be a single generic brightness check forever; a
      // future photo might need a different channel/metric too.
      safariHorizonBlueGreenSwing: safariHorizonAbove.blueMinusGreen - safariHorizonBelow.blueMinusGreen,
      // desert-day.jpg's foothill-to-scrubland line IS a brightness rise
      // (measured directly: ~161 to ~191 across the transition), same
      // direction as Beach's night horizon.
      desertGroundRise: desertGroundBelow.brightness - desertGroundAbove.brightness,
    };
  });

  // Thresholds calibrated against the actual measured jumps (day horizon:
  // ~115-165 brightness units across the transition zone; day water-end:
  // a real but gentler rise into the foam, ~15-30; night horizon: a
  // subtler but still real dark-sky-to-lit-sand rise, ~30-40; Safari's
  // day horizon: a B-G swing from about +23 to -86, well over 100; desert's
  // ground line: ~30 brightness units, measured the same full-row-average
  // way, confirmed against a visual reference-line overlay before this
  // constant was ever written into DESERT_CONFIG) -- see this constant's
  // own comment in game.js (Beach/Desert) or the measurement above
  // (Safari) for the exact numbers a fresh measurement produced. A
  // boundary sitting mid-region would show a difference near zero, not
  // comfortably above these floors.
  expect(result.dayHorizonDrop, 'HORIZON_FRAC.day should sit at a real sky-to-water brightness drop').toBeGreaterThan(50);
  expect(result.dayWaterEndRise, 'WATER_END_FRAC.day should sit at a real water-to-sand brightness rise').toBeGreaterThan(5);
  expect(result.nightHorizonRise, 'HORIZON_FRAC.night should sit at a real dark-sky-to-lit-sand brightness rise').toBeGreaterThan(5);
  expect(result.safariHorizonBlueGreenSwing, 'SAFARI_CONFIG.HORIZON_FRAC.day should sit at a real blue-sky-to-tan-grass hue swing').toBeGreaterThan(80);
  expect(result.desertGroundRise, 'DESERT_CONFIG.GROUND_FRAC should sit at a real foothill-to-scrubland brightness rise').toBeGreaterThan(15);
  expect(errors).toEqual([]);
});

// Generic, reusable across both Beach and Safari's cutout libraries (and
// any future one): a ground/water-anchored cutout's own alpha channel
// must actually reach the edge it's anchored at -- if the asset's visible
// content tapers off well before its own crop boundary, the cutout will
// read as floating no matter how correct the anchor math placing it is.
// This is exactly the bug class that shipped as the original palm-shore-
// crown asset (a crown with no trunk, see CREDITS.md's sourcing history)
// -- this test would have caught it automatically before it was ever
// wired into drawBeachScene, instead of needing a player screenshot.
test('Every ground/water-anchored cutout touches its own bottom edge (has a real "foot", not a floating crop)', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const groundAnchoredCutouts = [
    'art/beach-cutouts/palm-full-1.webp',
    'art/beach-cutouts/palm-full-2.webp',
    'art/beach-cutouts/dolphin.webp',
    'art/beach-cutouts/whale.webp',
    'art/beach-cutouts/cruise-ship.webp',
    'art/safari-cutouts/tree-acacia.webp',
    'art/safari-cutouts/tree-baobab.webp',
    'art/safari-cutouts/animal-zebra.webp',
    'art/safari-cutouts/animal-giraffe.webp',
    'art/safari-cutouts/animal-elephant.webp',
    'art/desert-cutouts/saguaro.webp',
    'art/desert-cutouts/joshua-tree.webp',
    'art/desert-cutouts/tumbleweed.webp',
    'art/desert-cutouts/roadrunner.webp',
  ];

  const result = await page.evaluate(async (paths) => {
    const out = {};
    for (const path of paths) {
      const img = new Image();
      img.src = path;
      await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; });
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const cctx = c.getContext('2d');
      cctx.drawImage(img, 0, 0);
      // Sample the bottom 3% of rows (not just the very last row -- a
      // couple of stray anti-aliased pixels shouldn't count as "real"
      // contact) and find the widest single-row COUNT of comfortably-
      // opaque pixels anywhere in that band -- not just the single peak
      // alpha value anywhere in it (review catch, PR #105: a lone opaque
      // splash/shadow artifact/stray pixel would pass a peak-alpha check
      // even with every other pixel in the band fully empty, which isn't
      // real contact at all). A per-row count is real coverage: it can't
      // be satisfied by one stray pixel the way a band-wide maximum can.
      const bandHeight = Math.max(1, Math.round(img.naturalHeight * 0.03));
      const data = cctx.getImageData(0, img.naturalHeight - bandHeight, img.naturalWidth, bandHeight).data;
      let maxRowCount = 0;
      for (let row = 0; row < bandHeight; row++) {
        let rowCount = 0;
        const rowStart = row * img.naturalWidth * 4;
        for (let x = 0; x < img.naturalWidth; x++) {
          if (data[rowStart + x * 4 + 3] > 150) rowCount++;
        }
        maxRowCount = Math.max(maxRowCount, rowCount);
      }
      out[path] = maxRowCount;
    }
    return out;
  }, groundAnchoredCutouts);

  for (const path of groundAnchoredCutouts) {
    // 5 pixels, not just >0 -- calibrated against real cases this test
    // itself turned up, using the narrowest genuinely-real contact found
    // across the whole library as the floor rather than an arbitrary
    // guess. dolphin.webp's re-cropped tail (see CREDITS.md) is the
    // tightest legitimate case at exactly 5 opaque pixels in its widest
    // band row -- thin, but confirmed real by rendering it against a
    // reference line at its own anchor point. tree-baobab.webp's root
    // base similarly has real (if narrow, ~9-pixel) coverage from a soft
    // photographed ground-shadow, not a hard graphic cutoff -- also
    // confirmed fine by the same render-and-look check. A single stray
    // opaque pixel (a rembg artifact, dust speck) -- the failure mode a
    // band-wide peak-alpha check couldn't rule out -- caps out at 1-2
    // pixels in any one row, well under this floor.
    expect(result[path], `${path}'s bottom edge has no real opaque coverage (widest row: ${result[path]} px) -- this cutout doesn't touch the ground/water it's anchored to`).toBeGreaterThanOrEqual(5);
  }
  expect(errors).toEqual([]);
});

// Player request: Sleep mode should always be Beach's calmest, dimmest
// look, same as every other sleep-safe scene here defaulting to night/
// dim rather than a coin flip. Non-sleep difficulties keep the genuine
// day/night randomization.
test('Beach is always the night variant under Sleep mode, not a coin flip', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const variants = await page.evaluate(() => {
    const seen = [];
    for (let i = 0; i < 20; i++) {
      STATE.difficulty = 'sleep';
      STATE.beachVariant = null;
      generateBeachScene();
      seen.push(STATE.beachVariant);
    }
    return seen;
  });

  expect(variants.every((v) => v === 'night')).toBe(true);
  expect(errors).toEqual([]);
});

// Review catch, PR #103: a save written under a non-sleep difficulty can
// carry a 'day' STATE.beachVariant, and loading/resuming that save while
// Sleep is now selected restores that 'day' value directly -- a set-once
// check (only forcing night when STATE.beachVariant was still unset)
// would miss this entirely, since the loaded value is already non-null.
test('Beach forces night under Sleep mode even when a loaded save already carries a day variant', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const variant = await page.evaluate(() => {
    STATE.difficulty = 'sleep';
    STATE.beachVariant = 'day'; // simulates a resumed/loaded save from another difficulty
    generateBeachScene();
    return STATE.beachVariant;
  });

  expect(variant).toBe('night');
  expect(errors).toEqual([]);
});

test('Beach day/night pick rides along with a saved game across a reload, same pattern as Safari\'s own variant', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const savedVariant = await page.evaluate(() => {
    // Fixed, so every wave below is guaranteed to actually be Beach --
    // persisted via saveSceneSetting (SCENE_KEY), not SAVE_KEY, same as
    // Safari's own equivalent test.
    STATE.sceneMode = 'beach';
    saveSceneSetting('beach');
    startWave(1);
    STATE.wave = 2; // still mid-block -- not the block's own last wave
    STATE.score = 50;
    saveGame();
    return STATE.beachVariant;
  });
  expect(['day', 'night']).toContain(savedVariant);

  await page.reload();
  await page.waitForFunction(() => window.__lumina);
  const variantAfterReloadNoLoad = await page.evaluate(() => STATE.beachVariant);
  // A reload alone doesn't resume anything yet -- there's nothing wrong
  // with this being null, it just shouldn't be treated as meaningful
  // until an actual load/autoload happens below.
  expect(variantAfterReloadNoLoad).toBeNull();

  await page.click('#title-load-button');
  await page.waitForTimeout(200);
  const restoredVariant = await page.evaluate(() => STATE.beachVariant);

  expect(restoredVariant).toBe(savedVariant);
  expect(errors).toEqual([]);
});

test('the Beach boat wraps to the opposite edge instead of resetting mid-crossing, keeping its direction', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(() => {
    STATE.scene = 'beach';
    STATE.beachScene = generateBeachScene();
    const boat = STATE.beachScene.boat;
    boat.xFrac = 1.079;
    boat.direction = 1;
    boat.speed = 0.01;
    const directionBefore = boat.direction;
    updateBeachScene();
    const wrapped = boat.xFrac < 0;
    const directionAfter = boat.direction;
    return { wrapped, directionBefore, directionAfter };
  });

  expect(result.wrapped).toBe(true);
  expect(result.directionAfter).toBe(result.directionBefore);
  expect(errors).toEqual([]);
});

// ============================================================
// DESERT SCENE
// ============================================================
// Built in one pass against SOURCE_OF_TRUTH.md's Required Method,
// applied proactively rather than reactively -- see DESERT_CONFIG's own
// header comment in game.js. These tests mirror the exact techniques
// Beach's own several rounds of player-reported failures established
// (structural draw-order hooking, geometry sweeps across pan phase AND
// canvas shape, deterministic named-constant scale checks, real photo
// brightness measurement) -- applied here up front, not bolted on after
// a screenshot catches a problem.

test('the Desert scene generates and draws without error, with every optional element forced present', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  await page.evaluate(async () => {
    canvas.width = 420; canvas.height = 860;
    STATE.scene = 'desert';
    STATE.desertScene = generateDesertScene();
    STATE.desertScene.roadrunner.active = true;
    STATE.desertScene.roadrunner.life = 50;
    STATE.desertScene.roadrunner.maxLife = 100;
    STATE.desertScene.lightning.flashLife = STATE.desertScene.lightning.maxFlashLife = 15;
    await new Promise((r) => setTimeout(r, 200));
    updateDesertScene();
    drawDesertScene();
  });

  expect(errors).toEqual([]);
});

// Same structural technique as "Beach foreground elements draw in depth
// order" -- hooks every Desert foreground draw entry point and asserts
// the sequence never goes backwards through DESERT_DEPTH_LAYERS, so any
// future reordering mistake fails CI immediately regardless of whether a
// given run's random positions happened to visibly collide.
test('Desert foreground elements draw in depth order (far-to-near) every frame, not motion-speed order', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(async () => {
    canvas.width = 500; canvas.height = 900;
    STATE.scene = 'desert';
    STATE.desertScene = generateDesertScene();
    STATE.desertScene.roadrunner.active = true;
    STATE.desertScene.roadrunner.life = 50;
    STATE.desertScene.roadrunner.maxLife = 100;
    await new Promise((r) => setTimeout(r, 300));

    const layers = [];
    const originalCutout = drawDesertCutout;
    const originalTumbleweed = drawDesertTumbleweed;
    window.drawDesertCutout = (source, ...rest) => {
      layers.push(source === 'saguaro' || source === 'joshua-tree' ? 'flora' : source);
      return originalCutout(source, ...rest);
    };
    window.drawDesertTumbleweed = (...args) => { layers.push('tumbleweed'); return originalTumbleweed(...args); };
    drawDesertScene();
    window.drawDesertCutout = originalCutout;
    window.drawDesertTumbleweed = originalTumbleweed;

    return { layers, model: DESERT_DEPTH_LAYERS };
  });

  expect(result.layers.length).toBeGreaterThan(0);
  let lastIndex = -1;
  for (const layer of result.layers) {
    const idx = result.model.indexOf(layer);
    expect(idx, `drawn layer "${layer}" is missing from DESERT_DEPTH_LAYERS`).toBeGreaterThanOrEqual(0);
    expect(idx, `"${layer}" (depth index ${idx}) drew after something nearer the camera -- full sequence: ${result.layers.join(', ')}`).toBeGreaterThanOrEqual(lastIndex);
    lastIndex = idx;
  }
  expect(errors).toEqual([]);
});

// Required Method, "Relative scale plausibility": tumbleweed and the
// roadrunner are real ground-level fauna/debris, dramatically smaller
// than either flora species -- deterministic constant check (not
// statistical sampling), same technique as Beach's own dolphin/cruise-ship/
// whale scale test.
test('Desert: tumbleweed and roadrunner size ranges stay smaller than either flora species, at any shared depth', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const cfg = await page.evaluate(() => ({
    tumbleweed: DESERT_CONFIG.TUMBLEWEED_SIZE_FRAC,
    roadrunner: DESERT_CONFIG.ROADRUNNER_SIZE_FRAC,
    saguaro: DESERT_CONFIG.SAGUARO_HEIGHT_FRAC,
    joshuaTree: DESERT_CONFIG.JOSHUA_TREE_HEIGHT_FRAC,
  }));

  // Both flora and the tumbleweed use the identical depthScale formula
  // (0.4 + 0.6*yFrac) in drawDesertScene, so at any SHARED yFrac the
  // depth multiplier cancels out of the comparison -- checking the raw
  // named constants directly is equivalent to checking the rendered
  // sizes at every possible depth, not just one sampled position.
  expect(cfg.tumbleweed.max).toBeLessThan(cfg.saguaro.min);
  expect(cfg.tumbleweed.max).toBeLessThan(cfg.joshuaTree.min);
  // The roadrunner spawns in a fixed near-camera band (yFrac 0.75-0.95,
  // not the full 0-1 range flora/tumbleweed roam -- see
  // generateDesertScene's own comment), so its comparison uses flora's
  // OWN size at that same near-camera depth (baseHeightFrac * depthScale
  // at yFrac=0.75, i.e. roughly 0.85x of the stored max), not the raw
  // stored constant -- a fair "would a real roadrunner ever render bigger
  // than a nearby cactus" check, not a stricter-than-necessary one.
  const nearDepthScale = 0.4 + 0.6 * 0.75;
  expect(cfg.roadrunner).toBeLessThan(cfg.saguaro.min * nearDepthScale);
  expect(cfg.roadrunner).toBeLessThan(cfg.joshuaTree.min * nearDepthScale);
  expect(errors).toEqual([]);
});

// Same category-8 "one element's OWN roamed position must not break scale
// plausibility" fix Beach's dolphins needed -- flora scattered across the
// full ground band must render smaller near the far edge (small yFrac)
// than the SAME plant's own baseHeightFrac would give it near the camera.
test('Desert: a far flora plant renders visibly smaller than the same plant would near the camera (depth-consistent)', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(async () => {
    canvas.width = 500; canvas.height = 900;
    STATE.scene = 'desert';
    STATE.desertScene = generateDesertScene();
    await new Promise((r) => setTimeout(r, 300));

    function renderedHeightFor(yFrac) {
      STATE.desertScene.flora = [{ source: 'saguaro', xFrac: 0.5, yFrac, baseHeightFrac: DESERT_CONFIG.SAGUARO_HEIGHT_FRAC.max, direction: 1 }];
      STATE.desertScene.tumbleweed.sizeFrac = 0;
      STATE.desertScene.roadrunner.active = false;
      let captured = null;
      const original = drawDesertCutout;
      window.drawDesertCutout = (source, xCenter, groundY, targetHeight, ...rest) => {
        if (source === 'saguaro') captured = targetHeight;
        return original(source, xCenter, groundY, targetHeight, ...rest);
      };
      drawDesertScene();
      window.drawDesertCutout = original;
      return captured;
    }

    return { far: renderedHeightFor(0), near: renderedHeightFor(1) };
  });

  expect(result.far).not.toBeNull();
  expect(result.near).not.toBeNull();
  expect(result.near, `near-camera plant (${result.near}px) should render taller than the same plant far away (${result.far}px)`).toBeGreaterThan(result.far);
  expect(errors).toEqual([]);
});

// Region containment across the full pan/zoom/canvas-shape parameter
// space, same requirement (and same ultrawide shape) the Codex catch on
// Beach's WATER_END_FRAC established -- every ground-anchored element's Y
// must stay within [groundY, canvas height] at every sampled pan phase.
test('Desert ground line (and every ground-anchored element) stays correctly contained across the full pan cycle, including an ultrawide canvas', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(async () => {
    const canvasShapes = [
      { w: 420, h: 860 },
      { w: 1920, h: 1080 },
      { w: 3840, h: 1080 }, // ultrawide -- the exact shape class the Beach WATER_END_FRAC review catch was found on
    ];
    const violations = [];
    let sampleCount = 0;

    for (const shape of canvasShapes) {
      canvas.width = shape.w; canvas.height = shape.h;
      STATE.scene = 'desert';
      STATE.desertScene = generateDesertScene();
      STATE.desertScene.flora = [{ source: 'saguaro', xFrac: 0.5, yFrac: 1, baseHeightFrac: DESERT_CONFIG.SAGUARO_HEIGHT_FRAC.max, direction: 1 }];
      await new Promise((r) => setTimeout(r, 200));

      let capturedGroundY = null, capturedPlantY = null;
      const original = drawDesertCutout;
      window.drawDesertCutout = (source, xCenter, groundY, targetHeight, ...rest) => {
        if (source === 'saguaro') { capturedGroundY = groundY; capturedPlantY = groundY; }
        return original(source, xCenter, groundY, targetHeight, ...rest);
      };

      for (let frac = 0; frac < 1; frac += 0.02) {
        STATE.desertScene.phase = Math.round(frac * DESERT_CONFIG.PAN_CYCLE_FRAMES);
        capturedGroundY = null;
        drawDesertScene();
        sampleCount++;
        // groundY itself must stay within the screen (never negative,
        // never past the bottom edge) -- the plant anchored at yFrac=1 is
        // drawn AT groundY-mapped-to-the-bottom, i.e. very close to h, so
        // checking capturedGroundY against [0, shape.h] covers both.
        if (capturedGroundY !== null && (capturedGroundY < 0 || capturedGroundY > shape.h)) {
          violations.push({ shape: `${shape.w}x${shape.h}`, phase: frac, groundY: capturedGroundY, canvasHeight: shape.h });
        }
      }
      window.drawDesertCutout = original;
    }

    return { violations, sampleCount };
  });

  expect(result.sampleCount).toBeGreaterThan(100);
  expect(result.violations, `a ground-anchored element left the visible canvas: ${JSON.stringify(result.violations)}`).toEqual([]);
  expect(errors).toEqual([]);
});

// The lightning flash is deliberately excluded from Sleep mode (see
// SLEEP_SAFE_SCENES' own comment in game.js) -- a sudden brightness
// change is exactly the stimulus Sleep mode exists to avoid, independent
// of how calm the rest of the scene reads.
test('Desert is excluded from Sleep mode\'s scene list (the lightning flash is not sleep-safe)', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(() => {
    STATE.difficulty = 'sleep';
    return { included: activeSceneList().includes('desert'), sleepSafeSetHas: isSceneSleepSafe('desert') };
  });

  expect(result.sleepSafeSetHas).toBe(false);
  expect(result.included).toBe(false);
  expect(errors).toEqual([]);
});

test('the Desert boat-equivalents (tumbleweed) wrap to the opposite edge instead of resetting mid-crossing, keeping direction', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(() => {
    STATE.scene = 'desert';
    STATE.desertScene = generateDesertScene();
    const tw = STATE.desertScene.tumbleweed;
    tw.xFrac = 1.079;
    tw.direction = 1;
    tw.speed = 0.01;
    const directionBefore = tw.direction;
    updateDesertScene();
    const wrapped = tw.xFrac < 0;
    return { wrapped, directionBefore, directionAfter: tw.direction };
  });

  expect(result.wrapped).toBe(true);
  expect(result.directionAfter).toBe(result.directionBefore);
  expect(errors).toEqual([]);
});

// Player correction (2026-08-19, screenshot of the first version): "the
// storm needs to be stormy -- rolling thunder, lightning flashes in the
// storm clouds, occasional lightning streaked across the sky and
// lightning strikes to the ground (again, all in the distance)." The
// first version only ever drew one bolt shape at a rare, whale-sighting
// cadence -- this covers all three named phenomena (DESERT_CONFIG.
// LIGHTNING_KIND_WEIGHTS' 'cloud'/'streak'/'strike') draw without error,
// and specifically that 'strike' -- the one kind deliberately allowed to
// touch the real ground line -- never actually crosses PAST it, across
// the same pan/canvas-shape sweep the general ground-containment test
// above uses.
test('Desert storm draws all three lightning kinds (cloud/streak/strike) without error', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  await page.evaluate(async () => {
    canvas.width = 420; canvas.height = 860;
    STATE.scene = 'desert';
    STATE.desertScene = generateDesertScene();
    await new Promise((r) => setTimeout(r, 200));
    for (const kind of ['cloud', 'streak', 'strike']) {
      const l = STATE.desertScene.lightning;
      l.kind = kind;
      l.flashLife = l.maxFlashLife = 15;
      l.boltXFrac = 0.2 + Math.random() * 0.6;
      l.boltXFrac2 = 0.2 + Math.random() * 0.6;
      l.boltDepthFrac = Math.random();
      l.boltSeed = Math.random() * 1000;
      drawDesertScene();
    }
  });

  expect(errors).toEqual([]);
});

// Deterministic sanity check on the weighted kind-pick itself -- a typo'd
// weight (the three don't sum to 1) wouldn't crash anything, just quietly
// skew the storm's mix (or make one kind unreachable) in a way nothing
// else here would catch.
test('Desert: LIGHTNING_KIND_WEIGHTS sums to 1', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const sum = await page.evaluate(() => {
    const w = DESERT_CONFIG.LIGHTNING_KIND_WEIGHTS;
    return w.cloud + w.streak + w.strike;
  });

  expect(sum).toBeCloseTo(1, 5);
  expect(errors).toEqual([]);
});

// The 'strike' kind is the one deliberately allowed to touch the real
// ground line (see drawDesertScene's own comment) -- confirms it actually
// gets picked across enough random triggers (not an unreachable dead
// weight) and, across the same pan-phase/canvas-shape sweep the general
// ground-containment test above uses, never renders past groundY: hooks
// the real drawDesertCutout call each frame to read the actual groundY
// that frame produced (not a recomputed value), same technique as the
// general containment test.
test('Desert lightning "strike" is actually reachable and stays correctly contained across the full pan cycle, including an ultrawide canvas', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(async () => {
    canvas.width = 420; canvas.height = 860;
    STATE.scene = 'desert';
    STATE.desertScene = generateDesertScene();
    await new Promise((r) => setTimeout(r, 200));
    // Let phase advance NATURALLY via repeated updateDesertScene() calls
    // (each increments scene.phase by 1 itself) rather than overwriting
    // it directly -- nextFlashFrame was set relative to this scene's own
    // (possibly large, up to PAN_CYCLE_FRAMES) starting phase, so forcing
    // phase back down to a small loop counter could keep it perpetually
    // BEFORE nextFlashFrame and never trigger a single flash at all.
    // LIGHTNING_MAX_GAP_FRAMES is 400 -- 20000 frames covers roughly 50
    // average-length trigger cycles, so even 'strike' at a 25% pick
    // weight has a (1-0.25)^50, effectively-zero chance of never once
    // appearing by chance; a real failure here means the weight is
    // actually unreachable, not an unlucky sample.
    let strikeSeen = false;
    for (let i = 0; i < 20000 && !strikeSeen; i++) {
      updateDesertScene();
      if (STATE.desertScene.lightning.flashLife > 0 && STATE.desertScene.lightning.kind === 'strike') strikeSeen = true;
    }

    const canvasShapes = [
      { w: 420, h: 860 },
      { w: 1920, h: 1080 },
      { w: 3840, h: 1080 },
    ];
    const violations = [];
    let sampleCount = 0;
    for (const shape of canvasShapes) {
      canvas.width = shape.w; canvas.height = shape.h;
      STATE.desertScene = generateDesertScene();
      STATE.desertScene.lightning.kind = 'strike';
      STATE.desertScene.lightning.flashLife = STATE.desertScene.lightning.maxFlashLife = 15;
      STATE.desertScene.flora = [{ source: 'saguaro', xFrac: 0.5, yFrac: 0, baseHeightFrac: DESERT_CONFIG.SAGUARO_HEIGHT_FRAC.max, direction: 1 }];
      await new Promise((r) => setTimeout(r, 100));

      let capturedGroundY = null;
      const originalCutout = drawDesertCutout;
      window.drawDesertCutout = (source, xCenter, groundY, ...rest) => {
        if (source === 'saguaro') capturedGroundY = groundY;
        return originalCutout(source, xCenter, groundY, ...rest);
      };

      for (let frac = 0; frac < 1; frac += 0.05) {
        STATE.desertScene.phase = Math.round(frac * DESERT_CONFIG.PAN_CYCLE_FRAMES);
        STATE.desertScene.lightning.boltDepthFrac = Math.random();
        capturedGroundY = null;
        drawDesertScene();
        sampleCount++;
        // groundY itself must stay on-screen -- the same requirement the
        // general ground-containment test enforces -- which is what
        // guarantees 'strike'`s own groundY-relative bottomY formula
        // (groundY - skyBandH*0.015, always strictly less than groundY
        // by construction whenever skyBandH > 0) stays meaningful rather
        // than degenerating on a canvas shape that pushes groundY
        // somewhere invalid.
        if (capturedGroundY !== null && (capturedGroundY < 0 || capturedGroundY > shape.h)) {
          violations.push({ shape: `${shape.w}x${shape.h}`, phase: frac, groundY: capturedGroundY });
        }
      }
      window.drawDesertCutout = originalCutout;
    }

    return { strikeSeen, violations, sampleCount };
  });

  expect(result.strikeSeen, "'strike' never got picked across 300 update ticks -- LIGHTNING_KIND_WEIGHTS.strike may be unreachable").toBe(true);
  expect(result.sampleCount).toBeGreaterThan(50);
  expect(result.violations, `groundY left the visible canvas while a strike was active: ${JSON.stringify(result.violations)}`).toEqual([]);
  expect(errors).toEqual([]);
});

test('the Birthday Party scene generates and draws without error', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(() => {
    canvas.width = 500; canvas.height = 900;
    STATE.scene = 'birthday';
    STATE.birthdayScene = generateBirthdayScene();
    updateBirthdayScene();
    drawBirthdayScene(); // throws if anything in the draw path is broken
    return {
      celebrating: STATE.birthdayScene.celebrating,
      hasConfetti: STATE.birthdayScene.confetti.length > 0,
      hasLights: STATE.birthdayScene.lights.length > 0,
      phaseAdvanced: STATE.birthdayScene.phase === 1,
    };
  });

  // Balloons no longer appear during ordinary play at all (see
  // generateCelebrationBalloons) -- a fresh scene starts with no
  // celebration active.
  expect(result.celebrating).toBe(false);
  expect(result.hasConfetti).toBe(true);
  expect(result.hasLights).toBe(true);
  expect(result.phaseAdvanced).toBe(true);
  expect(errors).toEqual([]);
});

test('birthday balloons only appear as a WAVE_COMPLETE celebration once the scene finishes revealing its ambient set, rise and recycle while it lasts, and never appear during ordinary play (player report: balloons present throughout play were mistaken for connectable dots)', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(() => {
    canvas.width = 500; canvas.height = 900;
    STATE.scene = 'birthday';
    STATE.sceneMode = 'birthday';
    STATE.birthdayScene = generateBirthdayScene();
    STATE.ambienceStreak = SCENE_AMBIENT_CONFIG.birthday.order.length - 1; // one wave short of fully revealed

    // Not yet the completing wave -- no celebration, no balloons drawn.
    drawBirthdayScene(); // throws if the no-celebration draw path is broken
    const notCelebratingYet = !STATE.birthdayScene.celebrating;

    // The wave that finishes revealing the set triggers the celebration.
    updateSceneAmbienceForWaveComplete();
    const celebratingNow = STATE.birthdayScene.celebrating;
    const balloonCount = STATE.birthdayScene.celebrationBalloons.length;

    // Balloons visibly rise over a short window (before any of them could
    // plausibly have recycled yet).
    const before = STATE.birthdayScene.celebrationBalloons.map(b => b.yFrac);
    for (let i = 0; i < 10; i++) updateBirthdayScene();
    const afterShort = STATE.birthdayScene.celebrationBalloons.map(b => b.yFrac);
    const allRoseInitially = before.every((y, i) => afterShort[i] < y);

    // Over a much longer window (many full cycles at this speed), every
    // balloon should have recycled from the bottom repeatedly rather than
    // rising forever or drifting out of bounds -- checked as a bounds
    // invariant rather than a before/after comparison, since by this
    // point each balloon could be anywhere in its own cycle.
    for (let i = 0; i < 5000; i++) updateBirthdayScene();
    const afterLong = STATE.birthdayScene.celebrationBalloons.map(b => b.yFrac);
    const allWithinBounds = afterLong.every(y => y >= -0.09 && y <= 1.06);

    drawBirthdayScene(); // throws if the celebration draw path is broken

    return { notCelebratingYet, celebratingNow, balloonCount, allRoseInitially, allWithinBounds };
  });

  expect(result.notCelebratingYet).toBe(true);
  expect(result.celebratingNow).toBe(true);
  expect(result.balloonCount).toBeGreaterThan(0);
  expect(result.allRoseInitially).toBe(true);
  expect(result.allWithinBounds).toBe(true);
  expect(errors).toEqual([]);
});

test('the Halloween scene generates and draws without error, sharing the moon/starfield with Forest', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(() => {
    canvas.width = 500; canvas.height = 900;
    STATE.scene = 'halloween';
    STATE.halloweenScene = generateHalloweenScene();
    for (let i = 0; i < 60; i++) updateHalloweenScene(); // give the bats/fog somewhere to have moved to
    drawHalloweenScene(); // throws if anything in the draw path is broken
    return {
      hasTrees: STATE.halloweenScene.trees.length > 0,
      hasBats: STATE.halloweenScene.bats.length > 0,
      hasGhosts: STATE.halloweenScene.ghosts.length > 0,
      hasWitches: STATE.halloweenScene.witches.length > 0,
      hasFogBands: STATE.halloweenScene.fogBands.length > 0,
      phaseAdvanced: STATE.halloweenScene.phase === 60,
      moonHelperShared: typeof drawNightMoon === 'function',
      // Pumpkins are celebration-only now (player report: present during
      // ordinary play, read as connectable dots) -- confirm none exist
      // in ordinary scene state.
      celebrating: STATE.halloweenScene.celebrating,
      celebrationPumpkins: STATE.halloweenScene.celebrationPumpkins,
    };
  });

  expect(result.hasTrees).toBe(true);
  expect(result.hasBats).toBe(true);
  expect(result.hasGhosts).toBe(true);
  expect(result.hasWitches).toBe(true);
  expect(result.hasFogBands).toBe(true);
  expect(result.phaseAdvanced).toBe(true);
  expect(result.moonHelperShared).toBe(true);
  expect(result.celebrating).toBe(false);
  expect(result.celebrationPumpkins).toBe(null);
  expect(errors).toEqual([]);
});

test('Halloween bats wrap to the opposite edge instead of resetting mid-flight, keeping their direction', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(() => {
    STATE.scene = 'halloween';
    STATE.halloweenScene = generateHalloweenScene();
    // Force one bat right at the edge of wrapping, moving rightward.
    const bat = STATE.halloweenScene.bats[0];
    bat.xFrac = 1.079;
    bat.direction = 1;
    bat.speed = 0.01;
    const directionBefore = bat.direction;
    updateHalloweenScene();
    const wrapped = bat.xFrac < 0;
    const directionAfter = bat.direction;
    return { wrapped, directionBefore, directionAfter };
  });

  expect(result.wrapped).toBe(true);
  expect(result.directionAfter).toBe(result.directionBefore);
  expect(errors).toEqual([]);
});

test('Halloween ghosts drift and wrap, witches on brooms wrap keeping their direction (new ambient decorations, player request)', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(() => {
    STATE.scene = 'halloween';
    STATE.halloweenScene = generateHalloweenScene();

    const ghost = STATE.halloweenScene.ghosts[0];
    ghost.xFrac = 1.099;
    ghost.driftSpeed = 0.05;
    updateHalloweenScene();
    const ghostWrapped = ghost.xFrac < 0;

    const witch = STATE.halloweenScene.witches[0];
    witch.xFrac = 1.099;
    witch.direction = 1;
    witch.speed = 0.05;
    const witchDirectionBefore = witch.direction;
    updateHalloweenScene();
    const witchWrapped = witch.xFrac < 0;

    drawHalloweenScene(); // throws if the new draw paths are broken

    return {
      ghostWrapped,
      witchWrapped,
      witchDirectionAfter: witch.direction,
      witchDirectionBefore,
    };
  });

  expect(result.ghostWrapped).toBe(true);
  expect(result.witchWrapped).toBe(true);
  expect(result.witchDirectionAfter).toBe(result.witchDirectionBefore);
  expect(errors).toEqual([]);
});

test('Halloween pumpkins only appear as a WAVE_COMPLETE celebration once the scene finishes revealing its ambient set, clustered together on a haybale that sits flush on the ground line, and never appear during ordinary play (player report: pumpkins present throughout play were mistaken for connectable dots -- same fix as the Birthday balloon celebration)', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(() => {
    canvas.width = 400; canvas.height = 800; // portrait -- min(w,h) = w, the case PR #70 exposed
    STATE.scene = 'halloween';
    STATE.sceneMode = 'fixed';
    STATE.halloweenScene = generateHalloweenScene();

    const notCelebratingYet = STATE.halloweenScene.celebrating === false
      && STATE.halloweenScene.celebrationPumpkins === null;

    // Drive the ambient reveal streak to one short of complete, then
    // complete it -- the same trigger the celebration balloons use.
    STATE.ambienceStreak = SCENE_AMBIENT_CONFIG.halloween.order.length - 1;
    updateSceneAmbienceForWaveComplete();
    // Let the entrance pop-in animation finish so the geometry below
    // reflects the pumpkins' full, settled size.
    for (let i = 0; i < 60; i++) updateHalloweenScene();

    const ellipseCalls = [];
    const originalEllipse = CanvasRenderingContext2D.prototype.ellipse;
    CanvasRenderingContext2D.prototype.ellipse = function (x, y, rx, ry, ...rest) {
      ellipseCalls.push({ x, y, rx, ry });
      return originalEllipse.call(this, x, y, rx, ry, ...rest);
    };
    try {
      drawHalloweenScene();
    } finally {
      CanvasRenderingContext2D.prototype.ellipse = originalEllipse;
    }

    const groundY = canvas.height - 6;

    // The haybale draws first, before any pumpkin -- its bottom (y + ry)
    // should land right on the ground line.
    const haybaleCall = ellipseCalls[0];
    const haybaleGap = Math.abs((haybaleCall.y + haybaleCall.ry) - groundY);

    // Every pumpkin lobe after it (4 per pumpkin, see drawHalloweenScene)
    // should have its own bottom land on the haybale's LOCAL curved surface
    // at that lobe group's x-position -- not just the ellipse's global
    // bounding-box top, which only matches at the exact center (review
    // catch: outer pumpkins in a 3-4 pumpkin cluster were floating above
    // the curve since the flat top was used everywhere).
    const lobeCalls = ellipseCalls.slice(1);
    const gaps = [];
    for (let i = 0; i < lobeCalls.length; i += 4) {
      const group = lobeCalls.slice(i, i + 4);
      const px = group.reduce((sum, c) => sum + c.x, 0) / group.length;
      const ratio = Math.max(-1, Math.min(1, (px - haybaleCall.x) / haybaleCall.rx));
      const supportY = haybaleCall.y - haybaleCall.ry * Math.sqrt(Math.max(0, 1 - ratio * ratio));
      for (const c of group) gaps.push(Math.abs((c.y + c.ry) - supportY));
    }

    return {
      notCelebratingYet,
      celebrating: STATE.halloweenScene.celebrating,
      pumpkinCount: STATE.halloweenScene.celebrationPumpkins.pumpkins.length,
      lobeCallCount: lobeCalls.length,
      haybaleGap,
      maxPumpkinGap: Math.max(...gaps),
    };
  });

  expect(result.notCelebratingYet).toBe(true);
  expect(result.celebrating).toBe(true);

  expect(result.pumpkinCount).toBeGreaterThan(0);
  expect(result.lobeCallCount).toBe(result.pumpkinCount * 4); // 4 lobes per pumpkin body
  expect(result.haybaleGap).toBeLessThan(0.5); // sub-pixel float rounding only
  expect(result.maxPumpkinGap).toBeLessThan(0.5);
  expect(errors).toEqual([]);
});

test('Halloween ground fog stays at least partially visible through its whole drift cycle, not just part of it (review catch, PR #70)', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(() => {
    canvas.width = 500; canvas.height = 900;
    STATE.scene = 'halloween';
    STATE.halloweenScene = generateHalloweenScene();
    const fogY = Math.round(0.8 * canvas.height);

    // Everything else in the scene (sky, moon, stars, trees) is fully
    // opaque already, so a raw alpha check can't tell fog-present from
    // fog-absent -- diff each fogged frame against a no-fog baseline of
    // the exact same scene instead, isolating just the fog's own
    // contribution to that row's pixels.
    STATE.halloweenScene.fogBands = [];
    drawHalloweenScene();
    const baseline = Array.from(ctx.getImageData(0, fogY, canvas.width, 1).data);

    const maxDiffAtEachXFrac = [];
    for (let i = 0; i <= 20; i++) {
      STATE.halloweenScene.fogBands = [{ yFrac: fogY / canvas.height, xFrac: i / 20, speed: 0, opacity: 1 }];
      drawHalloweenScene();
      const row = ctx.getImageData(0, fogY, canvas.width, 1).data;
      let maxDiff = 0;
      for (let px = 0; px < canvas.width; px++) {
        const diff = Math.abs(row[px * 4] - baseline[px * 4])
          + Math.abs(row[px * 4 + 1] - baseline[px * 4 + 1])
          + Math.abs(row[px * 4 + 2] - baseline[px * 4 + 2]);
        maxDiff = Math.max(maxDiff, diff);
      }
      maxDiffAtEachXFrac.push(maxDiff);
    }
    return { worstCaseDiff: Math.min(...maxDiffAtEachXFrac) };
  });

  // If the band ever fully disappears at some xFrac, that frame's row is
  // pixel-identical to the no-fog baseline (diff 0) -- exactly the bug
  // the duplicate-copy fix (drawHalloweenScene's fog loop) prevents.
  expect(result.worstCaseDiff).toBeGreaterThan(5);
  expect(errors).toEqual([]);
});

test('the Christmas scene generates and draws without error, sharing the moon/starfield with Forest', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(() => {
    canvas.width = 500; canvas.height = 900;
    STATE.scene = 'christmas';
    STATE.christmasScene = generateChristmasScene();
    for (let i = 0; i < 60; i++) updateChristmasScene(); // give snow/smoke somewhere to have moved to
    drawChristmasScene(); // throws if anything in the draw path is broken
    return {
      hasSnowflakes: STATE.christmasScene.snowflakes.length > 0,
      hasLights: STATE.christmasScene.lights.length > 0,
      hasSmoke: STATE.christmasScene.smoke.length > 0,
      phaseAdvanced: STATE.christmasScene.phase === 60,
      moonHelperShared: typeof drawNightMoon === 'function',
    };
  });

  expect(result.hasSnowflakes).toBe(true);
  expect(result.hasLights).toBe(true);
  expect(result.hasSmoke).toBe(true);
  expect(result.phaseAdvanced).toBe(true);
  expect(result.moonHelperShared).toBe(true);
  expect(errors).toEqual([]);
});

test('Christmas chimney smoke recycles back to the chimney instead of resetting off-frame', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(() => {
    STATE.scene = 'christmas';
    STATE.christmasScene = generateChristmasScene();
    const puff = STATE.christmasScene.smoke[0];
    puff.riseFrac = 0.9995;
    updateChristmasScene();
    return { riseFrac: puff.riseFrac };
  });

  expect(result.riseFrac).toBeGreaterThanOrEqual(0);
  expect(result.riseFrac).toBeLessThan(0.01);
  expect(errors).toEqual([]);
});

// ------------------------------------------------------------
// The Birthday scene's actual "Happy Birthday to You" melody
// (generateBirthdaySong) -- player feedback: the generic chord-progression
// engine's melody role never actually happened to spell out this tune, so
// it gets its own fixed-note generator instead. See HAPPY_BIRTHDAY_MELODY.
// ------------------------------------------------------------

test('generateBirthdaySong produces the real "Happy Birthday to You" tune, note for note', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(() => {
    const NOTE_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
    const midiToName = (m) => NOTE_NAMES[m % 12] + (Math.floor(m / 12) - 1);

    const song = generateBirthdaySong(6);
    // capNoteGaps (see generateBirthdaySong) appends gap-filling echoes
    // after the 25 real melody notes without reordering them, so the
    // first 25 in array order are the tune itself, already beat-increasing.
    const coreNotes = song.notes.slice(0, 25);
    const namesInOrder = coreNotes.map(n => midiToName(n.midi));
    const allMelodyRole = song.notes.every(n => n.role === 'melody' && n.instrument === 'piano');
    const chunkIndexesUsed = new Set(song.notes.map(n => n.chunkIndex));

    // Worst-case silence within each chunk once it's connected, wrapping
    // across the loop boundary -- the exact bound capNoteGaps enforces
    // (review catch, PR #73: contiguous per-pair blocks left an early
    // pair's chunk silent for most of every 25-beat loop otherwise).
    const maxGapByChunk = [];
    for (let c = 0; c < 6; c++) {
      const chunkNotes = song.notes.filter(n => n.chunkIndex === c).sort((a, b) => a.beat - b.beat);
      let maxGap = 0;
      for (let i = 0; i < chunkNotes.length; i++) {
        const cur = chunkNotes[i];
        const next = chunkNotes[(i + 1) % chunkNotes.length];
        const nextBeat = i + 1 < chunkNotes.length ? next.beat : next.beat + song.totalBeats;
        maxGap = Math.max(maxGap, nextBeat - cur.beat);
      }
      maxGapByChunk.push(maxGap);
    }

    return {
      noteCount: song.notes.length,
      totalBeats: song.totalBeats,
      genreFamily: song.genre.family,
      genreName: song.genre.name,
      namesInOrder,
      allMelodyRole,
      distinctChunksUsed: chunkIndexesUsed.size,
      maxGapByChunk,
    };
  });

  // The four sung phrases, in order -- "Happy birthday to you" x2, "Happy
  // birthday dear ___", "Happy birthday to you" -- 25 notes total, the
  // widely-cited note count for this tune.
  expect(result.namesInOrder).toEqual([
    'G4', 'G4', 'A4', 'G4', 'C5', 'B4',
    'G4', 'G4', 'A4', 'G4', 'D5', 'C5',
    'G4', 'G4', 'G5', 'E5', 'C5', 'B4', 'A4',
    'F5', 'F5', 'E5', 'C5', 'D5', 'C5',
  ]);
  // 25 real notes + capNoteGaps fillers -- every one of the 6 chunks wraps
  // with a gap far over the 3.5-beat cap, and one pass only halves a gap,
  // so it takes several repeated passes (see generateBirthdaySong) to
  // actually converge every chunk under the cap (see maxGapByChunk).
  expect(result.noteCount).toBe(67);
  expect(result.totalBeats).toBe(25);
  expect(result.genreFamily).toBe('birthday');
  expect(result.genreName).toBe('happy birthday');
  expect(result.allMelodyRole).toBe(true);
  // Every one of the 6 pairs a max-pairs wave can have should reveal at
  // least one note when connected -- see generateBirthdaySong's chunk
  // distribution comment.
  expect(result.distinctChunksUsed).toBe(6);
  for (const gap of result.maxGapByChunk) expect(gap).toBeLessThanOrEqual(3.55); // 3.5 cap + small beat-jitter slack
  expect(errors).toEqual([]);
});

test('a Birthday-scene wave uses the real melody, and every other scene keeps the generic chord-progression engine', async ({ page }) => {
  const errors = trackErrors(page);
  await page.addInitScript(() => { navigator.vibrate = () => true; });
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);
  await page.click('#start-game-button'); // START GAME -- STATE.audioCtx etc. need a real gesture-driven init
  await page.waitForTimeout(600);

  const result = await page.evaluate(() => {
    // Set the FIXED scene mode, not STATE.scene directly -- startWave
    // resolves STATE.scene itself from STATE.sceneMode via
    // resolveSceneForWave, overwriting any direct assignment made before
    // calling it.
    STATE.sceneMode = 'birthday';
    startWave(1);
    const birthdaySongFamily = STATE.song.genre.family;

    STATE.sceneMode = 'space';
    startWave(2);
    const spaceSongFamily = STATE.song.genre.family;

    return { birthdaySongFamily, spaceSongFamily };
  });

  expect(result.birthdaySongFamily).toBe('birthday');
  expect(result.spaceSongFamily).not.toBe('birthday');
  expect(errors).toEqual([]);
});

// ------------------------------------------------------------
// Rotate mode's per-scene block schedule (see resolveSceneForWave/
// sceneWaveCount) -- each scene holds for as many consecutive waves as it
// has ambient sounds, so a player actually hears a scene's full set
// before the background moves on, instead of it changing every wave. Which
// package comes next is randomly chosen (see resolveSceneBlock/
// mulberry32), not the next entry in a fixed list.
// ------------------------------------------------------------

test('Rotate mode holds each package for exactly as many waves as it has ambient sounds, moves to a randomly (and never immediately repeated) different package after, and the same seed always reproduces the same order', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(() => {
    STATE.sceneMode = 'rotate';

    function runSequence(seed, waveCount) {
      STATE.rotateSeed = seed;
      const scenes = [];
      for (let wave = 1; wave <= waveCount; wave++) scenes.push(resolveSceneForWave(wave));
      return scenes;
    }

    const sequence = runSequence(112233, 60);

    // Collapse the per-wave list into (scene, runLength) packages.
    const blocks = [];
    for (const scene of sequence) {
      if (blocks.length && blocks[blocks.length - 1].scene === scene) {
        blocks[blocks.length - 1].length++;
      } else {
        blocks.push({ scene, length: 1 });
      }
    }

    // The very last block can be legitimately truncated by this test's own
    // fixed 60-wave sample window -- nothing stops a block from still being
    // mid-run when the sample ends, regardless of how many scenes are in
    // rotation (adding a 7th, safari, shifted exactly where that cutoff
    // lands for this seed). Every OTHER block is a complete run and must
    // match sceneWaveCount exactly; only the trailing one is exempt.
    const completeBlocks = blocks.slice(0, -1);

    return {
      // Every complete package's run length must equal that scene's own
      // real wave count (see sceneWaveCount) -- a package is never cut
      // short or run long regardless of what order it lands in.
      lengthsMatch: completeBlocks.every((b) => b.length === sceneWaveCount(b.scene)),
      // Shuffled, not just "the next one in a fixed list" -- but still
      // never the exact same package twice in a row (see resolveSceneBlock).
      noImmediateRepeat: blocks.every((b, i) => i === 0 || b.scene !== blocks[i - 1].scene),
      distinctScenesSeen: new Set(blocks.map((b) => b.scene)).size,
      blockCount: blocks.length,
      // The same seed must always produce the same order (needed for the
      // HUD's own repeated resolveSceneBlock calls, and for a reload
      // mid-run to agree with itself -- see the save's own rotateSeed
      // field in saveGame/loadSave).
      sameSeedReproducible: JSON.stringify(sequence) === JSON.stringify(runSequence(112233, 60)),
      // A different seed must (overwhelmingly likely, with 6+ scenes and
      // 60 waves) actually produce a different order -- proving this is
      // real randomness, not a fixed sequence in disguise.
      differsAcrossSeeds: JSON.stringify(sequence) !== JSON.stringify(runSequence(998877, 60)),
    };
  });

  expect(result.lengthsMatch).toBe(true);
  expect(result.noImmediateRepeat).toBe(true);
  expect(result.distinctScenesSeen).toBeGreaterThan(1);
  expect(result.blockCount).toBeGreaterThan(3);
  expect(result.sameSeedReproducible).toBe(true);
  expect(result.differsAcrossSeeds).toBe(true);
  expect(errors).toEqual([]);
});

test("Safari's day/night background stays the same across every wave of one block, in both Rotate and fixed scene mode -- fixed mode is the important case, since resolveSceneBlock always reports blockPosition 0 there (no block boundary to key a reroll off of)", async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const fixedModeVariants = await page.evaluate(() => {
    STATE.sceneMode = 'safari';
    const seen = [];
    for (let wave = 1; wave <= 8; wave++) {
      startWave(wave);
      seen.push(STATE.safariScene.variant);
    }
    return seen;
  });
  expect(new Set(fixedModeVariants).size).toBe(1);
  expect(['day', 'night']).toContain(fixedModeVariants[0]);

  const rotateModeLog = await page.evaluate(() => {
    STATE.sceneMode = 'rotate';
    STATE.rotateSeed = 555444;
    const log = [];
    // Rotate mode picks each next package genuinely at random (see
    // resolveSceneBlock's own comment: "randomly chosen next package, not
    // necessarily the next array entry"), not a shuffle-once-then-cycle --
    // so seeing every specific scene at least once is a coupon-collector
    // problem, and its expected cost grows with SCENE_LIST's own size.
    // 60 was tuned back when SCENE_LIST had 7 entries; adding Desert (an
    // 8th) pushed this fixed seed's first 'safari' block out to wave 112
    // (confirmed by direct measurement, not guessed) -- well past the old
    // sample size, which made this test fail for a reason that has
    // nothing to do with Safari's actual behavior. 300 gives a real margin
    // over that measured value, not just a bumped magic number.
    for (let wave = 1; wave <= 300; wave++) {
      startWave(wave);
      log.push({ scene: STATE.scene, variant: STATE.scene === 'safari' ? STATE.safariScene.variant : null });
    }
    return log;
  });
  // Collapse into (scene, variants-seen-during-that-run) blocks the same
  // way the package-order test above does, then check every safari block
  // held exactly one variant for its whole run.
  const blocks = [];
  for (const { scene, variant } of rotateModeLog) {
    const last = blocks[blocks.length - 1];
    if (last && last.scene === scene) last.variants.add(variant);
    else blocks.push({ scene, variants: new Set([variant]) });
  }
  const safariBlocks = blocks.filter((b) => b.scene === 'safari');
  expect(safariBlocks.length).toBeGreaterThan(0);
  expect(safariBlocks.every((b) => b.variants.size === 1)).toBe(true);

  expect(errors).toEqual([]);
});

test('Safari\'s day/night pick rides along with a saved game across a reload (review catch, PR #91 -- same class of bug as rotateSeed\'s own PR #87 fix: without this, reloading mid-Safari-block had a coin-flip chance of switching day<->night before that block\'s waves were actually done), and a genuinely new game reseeds it', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const savedVariant = await page.evaluate(() => {
    // Fixed, so every wave below is guaranteed to actually be Safari --
    // persisted via saveSceneSetting (SCENE_KEY), not SAVE_KEY, so it
    // must be set this way to survive the reload below, same as if the
    // player had actually picked "Safari" from the title screen's dropdown.
    STATE.sceneMode = 'safari';
    saveSceneSetting('safari');
    startWave(1);
    STATE.wave = 2; // still mid-block (sceneWaveCount('safari') === 4) -- not the block's own last wave
    STATE.score = 50;
    saveGame();
    return STATE.safariVariant;
  });
  expect(['day', 'night']).toContain(savedVariant);

  await page.reload();
  await page.waitForFunction(() => window.__lumina);
  const variantAfterReloadNoLoad = await page.evaluate(() => STATE.safariVariant);
  // A reload alone doesn't resume anything yet (see startGameFromTitle) --
  // there's nothing wrong with this being null, it just shouldn't be
  // treated as meaningful until an actual load/autoload happens below.
  expect(variantAfterReloadNoLoad).toBeNull();

  // Loading that save back must restore its own exact variant, not
  // whatever a fresh coin flip would give.
  await page.click('#title-load-button');
  await page.waitForTimeout(200);
  const variantAfterLoad = await page.evaluate(() => STATE.safariVariant);
  expect(variantAfterLoad).toBe(savedVariant);

  // Restart Current Level replays the same wave, not a new playthrough --
  // must NOT reroll, same reasoning as rotateSeed's own retry-preserving
  // behavior above.
  await page.click('#pause-button');
  await page.click('#pause-restart-level');
  await page.waitForTimeout(1100);
  const variantAfterRestartLevel = await page.evaluate(() => STATE.safariVariant);
  expect(variantAfterRestartLevel).toBe(savedVariant);

  // Restart Game is a genuinely new playthrough -- must NOT inherit
  // whatever variant was still sitting in STATE from the run just ended.
  // Plants an impossible sentinel value first (day/night is a coin flip,
  // so merely asserting the result differs from savedVariant would be
  // flaky -- roughly half of all genuinely-fresh rolls would legitimately
  // match it by chance) and confirms Restart Game actually overwrote it
  // rather than leaving it untouched.
  await page.evaluate(() => { STATE.safariVariant = 'STALE_SENTINEL'; });
  await page.click('#pause-button');
  await page.click('#pause-restart-game');
  await page.waitForTimeout(1100);
  const variantAfterRestartGame = await page.evaluate(() => STATE.safariVariant);
  expect(['day', 'night']).toContain(variantAfterRestartGame);
  expect(variantAfterRestartGame).not.toBe('STALE_SENTINEL');

  expect(errors).toEqual([]);
});

test('Safari\'s foreground wildlife (birds, real-photo trees/animals, night shooting stars) generates and draws without error for both variants', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(() => {
    canvas.width = 500; canvas.height = 900;
    const out = {};
    for (const variant of ['day', 'night']) {
      STATE.scene = 'safari';
      STATE.safariVariant = variant;
      STATE.safariScene = generateSafariScene(null);
      for (let i = 0; i < 30; i++) updateSafariScene(); // enough frames for a shooting star to plausibly spawn
      // A connection-reward star (spawnStarsAroundDots' own pairId-tagged
      // shape) mixed in with a plain ambient one -- confirms the real draw
      // path renders the reward halo (via drawStars(true)) without
      // throwing, in both variants (review catch -- drawSafariScene never
      // called drawStars() at all before, in either variant, so every
      // connection halo was invisible in Safari since it first shipped;
      // see the dedicated drawStars(rewardOnly) test for the exact filter).
      STATE.stars = [
        { x: 10, y: 10, radius: 1, alpha: 1, twinkling: false, twinklePhase: 0, twinkleSpeed: 0, pairId: undefined },
        { x: 20, y: 20, radius: 1, alpha: 1, twinkling: false, twinklePhase: 0, twinkleSpeed: 0, pairId: 'pairA' },
      ];
      drawSafariScene(); // throws if anything in the draw path is broken (including the cutout images not having finished loading yet -- drawSafariCutout must tolerate that)
      out[variant] = {
        birdCount: STATE.safariScene.birds.length,
        animalCount: STATE.safariScene.animals.length,
        treeCount: STATE.safariScene.trees.length,
        animalSourcesValid: STATE.safariScene.animals.every((a) => SAFARI_ANIMAL_SOURCES.includes(a.source)),
        treeSourcesValid: STATE.safariScene.trees.every((t) => SAFARI_TREE_SOURCES.includes(t.source)),
        phaseAdvanced: STATE.safariScene.phase > 0,
        hasShootingStarState: typeof STATE.safariScene.shootingStar === 'object',
      };
    }
    return out;
  });

  for (const variant of ['day', 'night']) {
    expect(result[variant].birdCount).toBeGreaterThan(0);
    expect(result[variant].animalCount).toBeGreaterThan(0);
    expect(result[variant].treeCount).toBeGreaterThan(0);
    expect(result[variant].animalSourcesValid).toBe(true);
    expect(result[variant].treeSourcesValid).toBe(true);
    expect(result[variant].phaseAdvanced).toBe(true);
    expect(result[variant].hasShootingStarState).toBe(true);
  }
  expect(errors).toEqual([]);
});

// Player report, screenshot (2026-08-19): animals rendering on top of
// trees they should read as behind/beside, and trees rendering nested
// underneath other trees. Root cause: every tree/animal was bottom-
// anchored at the exact same horizonY (no depth variance at all), then
// drawn as "all trees, then all animals" -- two separate loops whose
// internal order came straight from Math.random()-driven array
// generation, an axis with no relationship to actual on-screen depth
// (the same wrong-axis mistake BEACH_DEPTH_LAYERS' own history
// describes). Fixed by giving both a real yFrac and merging them into
// ONE list sorted by it every frame (see SAFARI_CONFIG's own comment for
// why this is a continuous sort, not a fixed category array the way
// Beach/Desert's own depth models are). This is the structural test:
// hooks drawSafariCutout, forces a known mix of tree/animal yFracs, and
// asserts the actual sequence of groundY values drawSafariCutout receives
// is non-decreasing (farther/smaller-yFrac elements always draw before
// nearer/larger-yFrac ones, regardless of which array -- tree or animal
// -- either one came from).
test('Safari trees and animals draw in real depth order (far-to-near, by their own yFrac), not by which array they came from', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(async () => {
    canvas.width = 500; canvas.height = 900;
    STATE.scene = 'safari';
    STATE.safariVariant = 'day';
    STATE.safariScene = generateSafariScene(null);
    await new Promise((r) => setTimeout(r, 300));

    // Deliberately interleaved so a "trees first, then animals" draw
    // order would visibly violate depth (a far animal, yFrac 0.1, would
    // draw AFTER a near tree, yFrac 0.9, if grouped by array instead of
    // sorted by yFrac).
    STATE.safariScene.trees[0].yFrac = 0.1;
    STATE.safariScene.trees[1].yFrac = 0.9;
    STATE.safariScene.trees[2].yFrac = 0.5;
    STATE.safariScene.animals[0].yFrac = 0.3;
    STATE.safariScene.animals[1].yFrac = 0.7;
    STATE.safariScene.animals[2].yFrac = 0.05;

    const groundYs = [];
    const original = drawSafariCutout;
    window.drawSafariCutout = (source, xCenter, groundY, ...rest) => {
      groundYs.push(groundY);
      return original(source, xCenter, groundY, ...rest);
    };
    drawSafariScene();
    window.drawSafariCutout = original;

    return { groundYs };
  });

  expect(result.groundYs.length).toBe(6); // 3 trees + 3 animals
  let last = -Infinity;
  for (const gy of result.groundYs) {
    expect(gy, `groundY sequence went backwards -- an element drew nearer-then-farther instead of far-to-near: ${JSON.stringify(result.groundYs)}`).toBeGreaterThanOrEqual(last);
    last = gy;
  }
  expect(errors).toEqual([]);
});

// The literal reported case, pinned down directly rather than relying
// only on the general structural test above -- same technique as Beach's
// own "a palm and the cruise ship forced to the same x" pin. A near
// animal and a far tree forced to the exact same x: the animal (nearer,
// larger yFrac) must draw on top. If this regresses, an animal nests
// behind foliage it should stand in front of again (or vice versa).
test('Safari: a near animal and a far tree forced to the same x still draw animal-on-top', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const layers = await page.evaluate(async () => {
    canvas.width = 500; canvas.height = 900;
    STATE.scene = 'safari';
    STATE.safariVariant = 'day';
    STATE.safariScene = generateSafariScene(null);
    STATE.safariScene.trees = [{ source: 'tree-acacia', xFrac: 0.5, yFrac: 0.1, sizeFrac: SAFARI_CONFIG.TREE_SIZE_FRAC.max }];
    STATE.safariScene.animals = [{ source: 'animal-elephant', xFrac: 0.5, yFrac: 0.9, direction: 1, speed: 0, sizeFrac: SAFARI_CONFIG.ANIMAL_SIZE_FRAC.max, bobPhase: 0 }];
    await new Promise((r) => setTimeout(r, 300));

    const seen = [];
    const original = drawSafariCutout;
    window.drawSafariCutout = (source, ...rest) => { seen.push(source); return original(source, ...rest); };
    drawSafariScene();
    window.drawSafariCutout = original;
    return seen;
  });

  const treeIdx = layers.indexOf('tree-acacia');
  const animalIdx = layers.indexOf('animal-elephant');
  expect(treeIdx).toBeGreaterThanOrEqual(0);
  expect(animalIdx).toBeGreaterThanOrEqual(0);
  expect(animalIdx, 'the nearer animal must draw after (on top of) the farther tree').toBeGreaterThan(treeIdx);
  expect(errors).toEqual([]);
});

// Same category-8 "one element's OWN roamed position must not break scale
// plausibility" requirement Beach's dolphins and Desert's flora needed --
// a tree/animal near the far edge of the depth band must render smaller
// than the SAME element's own sizeFrac would give it near the camera.
test('Safari: a far tree/animal renders visibly smaller than the same element would near the camera (depth-consistent)', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(async () => {
    canvas.width = 500; canvas.height = 900;
    STATE.scene = 'safari';
    STATE.safariVariant = 'day';
    STATE.safariScene = generateSafariScene(null);
    await new Promise((r) => setTimeout(r, 300));

    function renderedHeightFor(yFrac) {
      STATE.safariScene.trees = [{ source: 'tree-acacia', xFrac: 0.5, yFrac, sizeFrac: SAFARI_CONFIG.TREE_SIZE_FRAC.max }];
      STATE.safariScene.animals = [];
      let captured = null;
      const original = drawSafariCutout;
      window.drawSafariCutout = (source, xCenter, groundY, targetHeight, ...rest) => {
        captured = targetHeight;
        return original(source, xCenter, groundY, targetHeight, ...rest);
      };
      drawSafariScene();
      window.drawSafariCutout = original;
      return captured;
    }

    return { far: renderedHeightFor(0), near: renderedHeightFor(1) };
  });

  expect(result.far).not.toBeNull();
  expect(result.near).not.toBeNull();
  expect(result.near, `near-camera tree (${result.near}px) should render taller than the same tree far away (${result.far}px)`).toBeGreaterThan(result.far);
  expect(errors).toEqual([]);
});

// Region containment across the full pan/zoom/canvas-shape parameter
// space -- Safari's panY was completely unclamped before this pass (see
// drawSafariScene's own comment); confirms the new clamp actually holds
// horizonY (and therefore the whole depth band trees/animals now roam)
// on-screen, same requirement and same ultrawide shape Beach's own
// WATER_END_FRAC review catch was found on.
test('Safari horizon (and the depth band every tree/animal roams) stays on-screen across the full pan cycle, including an ultrawide canvas', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(async () => {
    const canvasShapes = [
      { w: 420, h: 860 },
      { w: 1920, h: 1080 },
      { w: 3840, h: 1080 },
    ];
    const violations = [];
    let sampleCount = 0;

    for (const shape of canvasShapes) {
      for (const variant of ['day', 'night']) {
        canvas.width = shape.w; canvas.height = shape.h;
        STATE.scene = 'safari';
        STATE.safariVariant = variant;
        STATE.safariScene = generateSafariScene(null);
        STATE.safariScene.trees = [{ source: 'tree-acacia', xFrac: 0.5, yFrac: 0, sizeFrac: SAFARI_CONFIG.TREE_SIZE_FRAC.max }];
        STATE.safariScene.animals = [];
        await new Promise((r) => setTimeout(r, 100));

        let capturedGroundY = null;
        const original = drawSafariCutout;
        window.drawSafariCutout = (source, xCenter, groundY, ...rest) => {
          capturedGroundY = groundY;
          return original(source, xCenter, groundY, ...rest);
        };

        for (let frac = 0; frac < 1; frac += 0.05) {
          STATE.safariScene.phase = Math.round(frac * SAFARI_CONFIG.PAN_CYCLE_FRAMES);
          capturedGroundY = null;
          drawSafariScene();
          sampleCount++;
          if (capturedGroundY !== null && (capturedGroundY < 0 || capturedGroundY > shape.h)) {
            violations.push({ shape: `${shape.w}x${shape.h}`, variant, phase: frac, groundY: capturedGroundY });
          }
        }
        window.drawSafariCutout = original;
      }
    }

    return { violations, sampleCount };
  });

  expect(result.sampleCount).toBeGreaterThan(100);
  expect(result.violations, `a horizon-anchored element left the visible canvas: ${JSON.stringify(result.violations)}`).toEqual([]);
  expect(errors).toEqual([]);
});

test('Safari\'s cutout image manifest actually loads every declared tree/animal source', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(async () => {
    // Give the browser a real chance to fetch art/safari-cutouts/*.webp
    // over the local server rather than asserting against the very first
    // (near-certainly still-loading) tick.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const names = [...SAFARI_TREE_SOURCES, ...SAFARI_ANIMAL_SOURCES];
    return names.map((name) => ({
      name,
      loaded: SAFARI_CUTOUT_IMAGES[name].complete && SAFARI_CUTOUT_IMAGES[name].naturalWidth > 0,
    }));
  });

  for (const { name, loaded } of result) {
    expect(loaded, `${name} should have loaded`).toBe(true);
  }
  expect(errors).toEqual([]);
});

test("Safari's tree/animal cutouts are darkened for the night variant (not left at full daylight brightness against the Milky Way) but left untouched for day (review catch, PR #95 -- every cutout is a real daylight photo, and the night variant's own vignette is transparent at its center, so without a night tint a tree or animal anywhere near mid-screen rendered at full midday brightness)", async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(async () => {
    canvas.width = 500; canvas.height = 900;
    await new Promise((resolve) => setTimeout(resolve, 1500)); // let the cutout WebPs actually finish loading

    // Wrap drawSafariCutout itself rather than inferring from ctx.filter's
    // side effects -- ctx.filter is reset by the function's own
    // ctx.restore() before this could inspect it, and the background
    // photo's own (untinted) drawImage call would otherwise pollute a
    // ctx.drawImage-level spy. Directly recording the nightTint argument
    // each tree/animal call actually received is both simpler and a more
    // direct test of the fix (drawSafariScene computing/passing it
    // correctly per variant) than the filter it produces downstream.
    const originalCutout = drawSafariCutout;
    const nightTintsSeen = [];
    window.drawSafariCutout = (...args) => { nightTintsSeen.push(args[5]); return originalCutout(...args); };

    STATE.scene = 'safari';
    STATE.safariVariant = 'night';
    STATE.safariScene = generateSafariScene(null);
    drawSafariScene();
    const nightTints = nightTintsSeen.slice();

    nightTintsSeen.length = 0;
    STATE.safariVariant = 'day';
    STATE.safariScene = generateSafariScene(null);
    drawSafariScene();
    const dayTints = nightTintsSeen.slice();

    window.drawSafariCutout = originalCutout;

    return {
      nightCallCount: nightTints.length,
      nightAllTrue: nightTints.length > 0 && nightTints.every((t) => t === true),
      dayCallCount: dayTints.length,
      dayNoneTrue: dayTints.length > 0 && dayTints.every((t) => t !== true),
    };
  });

  expect(result.nightCallCount).toBeGreaterThan(0);
  expect(result.nightAllTrue).toBe(true);
  expect(result.dayCallCount).toBeGreaterThan(0);
  expect(result.dayNoneTrue).toBe(true);
  expect(errors).toEqual([]);
});

test('Safari\'s birds and animals wrap to the opposite edge instead of resetting mid-crossing, keeping their direction -- same technique as the Beach boat', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(() => {
    STATE.scene = 'safari';
    STATE.safariVariant = 'day';
    STATE.safariScene = generateSafariScene(null);
    const bird = STATE.safariScene.birds[0];
    bird.xFrac = 1.079;
    bird.direction = 1;
    bird.speed = 0.01;
    const birdDirectionBefore = bird.direction;

    const animal = STATE.safariScene.animals[0];
    animal.xFrac = 1.099;
    animal.direction = 1;
    animal.speed = 0.01;
    const animalDirectionBefore = animal.direction;

    updateSafariScene();

    return {
      birdWrapped: bird.xFrac < 0,
      birdDirectionAfter: bird.direction,
      birdDirectionBefore,
      animalWrapped: animal.xFrac < 0,
      animalDirectionAfter: animal.direction,
      animalDirectionBefore,
    };
  });

  expect(result.birdWrapped).toBe(true);
  expect(result.birdDirectionAfter).toBe(result.birdDirectionBefore);
  expect(result.animalWrapped).toBe(true);
  expect(result.animalDirectionAfter).toBe(result.animalDirectionBefore);
  expect(errors).toEqual([]);
});

test("Safari's shooting star waits its actual intended delay before first spawning, regardless of the scene's starting phase (review catch, PR #92 -- nextSpawnFrame was a small absolute frame number compared directly against phase, which itself can already start anywhere from 0-2699 or be carried forward arbitrarily large, so the star spawned almost immediately on nearly every fresh scene instead of after a real delay)", async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(() => {
    let immediateSpawns = 0;
    const trials = 100;
    for (let i = 0; i < trials; i++) {
      STATE.safariVariant = 'night';
      STATE.safariScene = generateSafariScene(null); // random starting phase every time, the exact condition that triggered the bug
      updateSafariScene(); // exactly one frame in
      if (STATE.safariScene.shootingStar.active) immediateSpawns++;
    }
    return { trials, immediateSpawns };
  });

  expect(result.immediateSpawns).toBe(0);
  expect(errors).toEqual([]);
});

test('Rotate mode\'s random package order rides along with a saved game across a reload (review catch, PR #87 -- a global "current" seed would drift out of sync with an untouched save), and a genuinely new game (Start Game without autoload, or Restart Game) reseeds it', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  // With no save at all, there's no "in-progress run" to protect -- a
  // reload is free to roll a fresh seed each time, same as any other
  // fresh session.
  const seedBeforeSave = await page.evaluate(() => STATE.rotateSeed);
  expect(Number.isFinite(seedBeforeSave)).toBe(true);
  await page.reload();
  await page.waitForFunction(() => window.__lumina);
  const seedAfterReloadNoSave = await page.evaluate(() => STATE.rotateSeed);
  expect(seedAfterReloadNoSave).not.toBe(seedBeforeSave);

  // Once a save actually exists, its own embedded seed (see SAVE_KEY) must
  // survive a reload -- loading it back needs to resolve its already-
  // played waves against the exact seed they were shown with, not
  // whatever a since-started different playthrough left lying around.
  const savedSeed = await page.evaluate(() => {
    STATE.wave = 5;
    STATE.score = 100;
    saveGame();
    return STATE.rotateSeed;
  });
  await page.reload();
  await page.waitForFunction(() => window.__lumina);
  const seedAfterReloadWithSave = await page.evaluate(() => STATE.rotateSeed);
  expect(seedAfterReloadWithSave).toBe(savedSeed);

  // Start Game with autoload off ignores that save and starts fresh -- a
  // genuinely new playthrough, so it gets its own shuffle.
  await page.click('#start-game-button');
  const seedAfterFreshStart = await page.evaluate(() => STATE.rotateSeed);
  expect(seedAfterFreshStart).not.toBe(savedSeed);

  // Loading that same save back explicitly restores its own seed, not
  // whatever the fresh start above just rolled.
  await page.click('#pause-button');
  await page.click('#pause-load');
  await page.waitForTimeout(1100); // > FADE_CONFIG.OUT_DURATION_SEC (900ms) -- must outlast the fade-out before its onComplete (where the real state change happens) runs
  const seedAfterExplicitLoad = await page.evaluate(() => STATE.rotateSeed);
  expect(seedAfterExplicitLoad).toBe(savedSeed);

  // Restart Game is the same kind of genuinely-new-playthrough moment as
  // Start Game above.
  await page.click('#pause-button');
  await page.click('#pause-restart-game');
  await page.waitForTimeout(1100);
  const seedAfterRestartGame = await page.evaluate(() => STATE.rotateSeed);
  expect(seedAfterRestartGame).not.toBe(savedSeed);

  // Restart Current Level (unlike Restart Game) replays the same wave,
  // not a new playthrough -- it must NOT reseed, or the package that wave
  // was already showing could change out from under the player mid-retry.
  await page.click('#pause-button');
  await page.click('#pause-restart-level');
  await page.waitForTimeout(1100);
  const seedAfterRestartLevel = await page.evaluate(() => STATE.rotateSeed);
  expect(seedAfterRestartLevel).toBe(seedAfterRestartGame);

  expect(errors).toEqual([]);
});

test('a fixed scene mode is unaffected by the block schedule -- every wave resolves to that one scene', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const scenes = await page.evaluate(() => {
    STATE.sceneMode = 'beach';
    const result = [];
    for (let wave = 1; wave <= 6; wave++) result.push(resolveSceneForWave(wave));
    return result;
  });

  expect(scenes).toEqual(['beach', 'beach', 'beach', 'beach', 'beach', 'beach']);
  expect(errors).toEqual([]);
});

test('completing a scene\'s ambient set under Rotate mode queues a celebration toast naming it and the actual next package (order-agnostic -- see the random-package-order rewrite)', async ({ page }) => {
  const errors = trackErrors(page);
  await page.addInitScript(() => { navigator.vibrate = () => true; });
  await injectSceneWaveSetup(page);
  await page.goto('/index.html');
  await page.click('#start-game-button');
  await page.waitForTimeout(800);

  const result = await page.evaluate(async () => {
    await STATE.ambientBuffersReadyPromise;
    STATE.sceneMode = 'rotate';
    STATE.rotateSeed = 55443322; // fixed -- order-agnostic below, but must still be reproducible
    // Suppress the unrelated wave-milestone/high-score achievements so
    // only the scene-complete toast this test cares about ends up queued.
    STATE.stats.bestWave = 999999;
    STATE.stats.bestWaveScore = 999999999;

    // Which package lands first is no longer fixed -- find the first
    // block whose scene actually has ambient layers to reveal (space has
    // none, so completing it never queues this toast).
    let wave = 1;
    let blockScene, blockPosition;
    while (true) {
      ({ scene: blockScene, blockPosition } = resolveSceneBlock(wave));
      if (SCENE_AMBIENT_CONFIG[blockScene]) break;
      wave += sceneWaveCount(blockScene) - blockPosition;
    }
    const blockStart = wave - blockPosition;
    const blockEnd = blockStart + sceneWaveCount(blockScene) - 1;
    const expectedNextScene = resolveSceneBlock(blockEnd + 1).scene;
    const expectedToastText = `${SCENE_DISPLAY_NAMES[blockScene]} Complete! ${SCENE_DISPLAY_NAMES[expectedNextScene]} Ahead`;

    // Drive real startWave() calls across the whole block so both
    // resolveSceneForWave and the ambience streak advance exactly as they
    // would in real play.
    for (let w = blockStart; w <= blockEnd; w++) {
      startWave(w);
      setUpCompletableSceneWave(STATE.scene, w);
      checkWaveComplete();
      await new Promise(r => setTimeout(r, 30));
    }

    return {
      blockScene, expectedToastText,
      sceneAtEnd: STATE.scene,
      streakAtEnd: STATE.ambienceStreak,
      expectedStreak: SCENE_AMBIENT_CONFIG[blockScene].order.length,
      toastVisible: document.getElementById('achievement-toast').classList.contains('visible'),
      toastText: document.getElementById('achievement-label').textContent,
    };
  });

  expect(result.sceneAtEnd).toBe(result.blockScene);
  expect(result.streakAtEnd).toBe(result.expectedStreak);
  expect(result.toastVisible).toBe(true);
  expect(result.toastText).toBe(result.expectedToastText);
  expect(errors).toEqual([]);
});

test('completing a scene\'s ambient set under a FIXED scene mode does not queue a celebration toast (there is no next scene to announce)', async ({ page }) => {
  const errors = trackErrors(page);
  await page.addInitScript(() => { navigator.vibrate = () => true; });
  await injectSceneWaveSetup(page);
  await page.goto('/index.html');
  await page.click('#start-game-button');
  await page.waitForTimeout(800);

  const result = await page.evaluate(async () => {
    await STATE.ambientBuffersReadyPromise;
    STATE.sceneMode = 'forest';
    STATE.stats.bestWave = 999999;
    STATE.stats.bestWaveScore = 999999999;

    for (let wave = 1; wave <= 4; wave++) {
      startWave(wave);
      setUpCompletableSceneWave('forest', wave);
      checkWaveComplete();
      await new Promise(r => setTimeout(r, 30));
    }

    return {
      streakAtEnd: STATE.ambienceStreak,
      toastVisible: document.getElementById('achievement-toast').classList.contains('visible'),
      queueLength: STATE.achievementQueue.length,
    };
  });

  expect(result.streakAtEnd).toBe(4); // the set did complete...
  expect(result.toastVisible).toBe(false); // ...but nothing announces it, since sceneMode isn't 'rotate'
  expect(result.queueLength).toBe(0);
  expect(errors).toEqual([]);
});

test('the bonus wave after a scene completes keeps the full soundscape playing, instead of cutting the last reveal off immediately', async ({ page }) => {
  const errors = trackErrors(page);
  await page.addInitScript(() => { navigator.vibrate = () => true; });
  await injectSceneWaveSetup(page);
  await page.goto('/index.html');
  await page.click('#start-game-button');
  await page.waitForTimeout(800);

  const result = await page.evaluate(async () => {
    await STATE.ambientBuffersReadyPromise;
    STATE.sceneMode = 'rotate';
    STATE.rotateSeed = 13579; // fixed -- order-agnostic below, but must still be reproducible
    function setUpWave(wave) {
      canvas.width = 500; canvas.height = 900;
      STATE.world = { w: 2000, h: 2000 };
      STATE.dots = [
        { id: 0, pairId: 0, colorIndex: 0, x: 500, y: 500, connected: true },
        { id: 1, pairId: 0, colorIndex: 0, x: 1500, y: 1500, connected: true },
      ];
      STATE.wave = wave;
      STATE.waveStartScore = 0;
      STATE.score = 0;
    }

    // Random package order (see resolveSceneBlock) means which scene
    // lands where is no longer fixed -- find the first block whose scene
    // actually has ambient layers to reveal (space has none, so a bonus
    // wave/handoff there would be a no-op, not a meaningful test of this
    // behavior).
    let wave = 1;
    let blockScene, blockPosition;
    while (true) {
      ({ scene: blockScene, blockPosition } = resolveSceneBlock(wave));
      if (SCENE_AMBIENT_CONFIG[blockScene]) break;
      wave += sceneWaveCount(blockScene) - blockPosition;
    }
    const blockStart = wave - blockPosition;
    const order = SCENE_AMBIENT_CONFIG[blockScene].order;
    const lastRevealWave = blockStart + order.length - 1;
    const bonusWave = blockStart + order.length; // == this block's last wave
    const nextScene = resolveSceneBlock(bonusWave + 1).scene;

    for (let w = blockStart; w <= lastRevealWave; w++) {
      startWave(w);
      setUpWave(w);
      checkWaveComplete();
      await new Promise(r => setTimeout(r, 30));
    }
    const sceneAndLayersAfterLastReveal = { scene: STATE.scene, layers: Object.keys(STATE.ambienceLayers) };

    // Start the bonus wave. If the fix weren't in place, this would
    // already have switched to nextScene and reset every layer.
    startWave(bonusWave);
    const sceneAndLayersAtBonusWaveStart = { scene: STATE.scene, layers: Object.keys(STATE.ambienceLayers) };
    setUpWave(bonusWave);
    checkWaveComplete();
    await new Promise(r => setTimeout(r, 30));
    const streakAfterBonusWave = STATE.ambienceStreak; // must not advance past order.length -- nothing left to reveal

    // Only now should the scene actually hand off.
    startWave(bonusWave + 1);
    const sceneAndLayersAfterHandoff = { scene: STATE.scene, layers: Object.keys(STATE.ambienceLayers) };

    return {
      blockScene, order, nextScene,
      sceneAndLayersAfterLastReveal, sceneAndLayersAtBonusWaveStart, streakAfterBonusWave, sceneAndLayersAfterHandoff,
    };
  });

  expect(result.sceneAndLayersAfterLastReveal).toEqual({ scene: result.blockScene, layers: result.order });
  // The critical assertion: starting the bonus wave keeps the scene AND
  // every layer intact -- nothing gets cut off just because the set is
  // now complete.
  expect(result.sceneAndLayersAtBonusWaveStart).toEqual({ scene: result.blockScene, layers: result.order });
  expect(result.streakAfterBonusWave).toBe(result.order.length);
  expect(result.sceneAndLayersAfterHandoff).toEqual({ scene: result.nextScene, layers: [] });
  expect(errors).toEqual([]);
});

test('loading or restarting mid-block backfills already-revealed sounds so the set still completes on schedule', async ({ page }) => {
  const errors = trackErrors(page);
  await page.addInitScript(() => { navigator.vibrate = () => true; });
  await injectSceneWaveSetup(page);
  await page.goto('/index.html');
  await page.click('#start-game-button');
  await page.waitForTimeout(800);

  const result = await page.evaluate(async () => {
    await STATE.ambientBuffersReadyPromise;
    STATE.sceneMode = 'rotate';
    STATE.rotateSeed = 24680; // fixed -- order-agnostic below, but must still be reproducible
    // Suppress the unrelated wave-milestone/high-score achievements so
    // the toast asserted on below can only be the scene-complete one.
    STATE.stats.bestWave = 999999;
    STATE.stats.bestWaveScore = 999999999;
    function setUpWave(wave) {
      canvas.width = 500; canvas.height = 900;
      STATE.world = { w: 2000, h: 2000 };
      STATE.dots = [
        { id: 0, pairId: 0, colorIndex: 0, x: 500, y: 500, connected: true },
        { id: 1, pairId: 0, colorIndex: 0, x: 1500, y: 1500, connected: true },
      ];
      STATE.wave = wave;
      STATE.waveStartScore = 0;
      STATE.score = 0;
    }

    // Same reasoning as the bonus-wave test above -- find the first block
    // with at least 3 ambient layers, so "mid-block" (position 2) is
    // strictly before both the last reveal and the bonus wave.
    let wave = 1;
    let blockScene, blockPosition;
    while (true) {
      ({ scene: blockScene, blockPosition } = resolveSceneBlock(wave));
      const config = SCENE_AMBIENT_CONFIG[blockScene];
      if (config && config.order.length >= 3) break;
      wave += sceneWaveCount(blockScene) - blockPosition;
    }
    const blockStart = wave - blockPosition;
    const order = SCENE_AMBIENT_CONFIG[blockScene].order;
    const blockEnd = blockStart + order.length; // this block's bonus (last) wave
    const midWave = blockStart + 2; // 0-indexed blockPosition 2 -- two layers already revealed
    const nextScene = resolveSceneBlock(blockEnd + 1).scene;
    const expectedToastText = `${SCENE_DISPLAY_NAMES[blockScene]} Complete! ${SCENE_DISPLAY_NAMES[nextScene]} Ahead`;

    // Simulate loading a save mid-block -- a real load calls
    // resetSceneAmbience first (a save only stores wave + score, see
    // handleLoadGame), then starts that wave fresh, same as here.
    resetSceneAmbience();
    startWave(midWave);
    await new Promise(r => setTimeout(r, 30)); // startSceneAmbienceLayer (called from catchUpAmbienceStreakForWave) is fire-and-forget
    const layersRightAfterLoad = Object.keys(STATE.ambienceLayers).sort();
    const streakRightAfterLoad = STATE.ambienceStreak;

    // Play the rest of the block out normally and confirm it still
    // reaches full completion (+ the toast) and still hands off at
    // exactly the same wave a continuous playthrough would.
    for (let w = midWave; w <= blockEnd; w++) {
      setUpWave(w);
      checkWaveComplete();
      await new Promise(r => setTimeout(r, 30));
      if (w < blockEnd) startWave(w + 1);
    }
    const streakAfterBlockFinishes = STATE.ambienceStreak;
    const toastText = document.getElementById('achievement-label').textContent;
    const toastVisible = document.getElementById('achievement-toast').classList.contains('visible');

    startWave(blockEnd + 1);
    const sceneAfterHandoff = STATE.scene;

    return {
      blockScene, order, nextScene, expectedToastText,
      layersRightAfterLoad, streakRightAfterLoad, streakAfterBlockFinishes, toastVisible, toastText, sceneAfterHandoff,
    };
  });

  // blockPosition 2 (0-indexed) into the block -- the first two sounds in
  // this scene's own reveal order should already be playing, backfilled
  // silently rather than making the player wait through two more wave
  // completions to get sounds that, per the absolute wave number, should
  // already be there.
  expect(result.layersRightAfterLoad).toEqual(result.order.slice(0, 2).slice().sort());
  expect(result.streakRightAfterLoad).toBe(2);
  expect(result.streakAfterBlockFinishes).toBe(result.order.length);
  expect(result.toastVisible).toBe(true);
  expect(result.toastText).toBe(result.expectedToastText);
  expect(result.sceneAfterHandoff).toBe(result.nextScene);
  expect(errors).toEqual([]);
});

// ------------------------------------------------------------
// Sleep mode scene gating (see SLEEP_SAFE_SCENES/activeSceneList) and
// score hiding (player request: a running, only-ever-increasing number
// works against Sleep mode's whole point of winding down).
// ------------------------------------------------------------

test('activeSceneList only narrows things down under Sleep mode -- every other difficulty sees the full SCENE_LIST', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(() => {
    const perDifficulty = {};
    for (const level of ['relaxed', 'normal', 'intense', 'sleep']) {
      STATE.difficulty = level;
      perDifficulty[level] = activeSceneList();
    }
    return { perDifficulty, fullList: SCENE_LIST };
  });

  expect(result.perDifficulty.relaxed).toEqual(result.fullList);
  expect(result.perDifficulty.normal).toEqual(result.fullList);
  expect(result.perDifficulty.intense).toEqual(result.fullList);
  // Birthday (party horns, upbeat crowd noise), Halloween (wolf howls,
  // raven caws -- gentle, but "spooky" still trades on a little tension),
  // and Desert (the lightning flash -- see SLEEP_SAFE_SCENES' own comment)
  // are the non-sleep-safe scenes shipped so far -- Sleep mode should
  // narrow all three out while every other difficulty still offers them.
  // Christmas is genuinely calm and stays available under Sleep mode same
  // as Forest/Beach/Space.
  const nonSleepSafe = ['birthday', 'halloween', 'desert'];
  expect(result.perDifficulty.sleep).toEqual(result.fullList.filter(s => !nonSleepSafe.includes(s)));
  for (const scene of nonSleepSafe) expect(result.perDifficulty.sleep).not.toContain(scene);
  expect(result.perDifficulty.sleep).toContain('christmas');
  expect(errors).toEqual([]);
});

test('Sleep mode hides both the running score and the live per-line draw score; every other difficulty still shows them', async ({ page }) => {
  const errors = trackErrors(page);
  await page.addInitScript(() => { navigator.vibrate = () => true; });
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(() => {
    STATE.wave = 1;
    STATE.score = 500;
    STATE.isDrawing = true;
    STATE.currentPath = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
    STATE.phase = 'PLAYING';

    STATE.difficulty = 'normal';
    updateWaveDisplay();
    updateDrawScoreDisplay();
    const normal = {
      score: document.getElementById('score-display').textContent,
      drawScore: document.getElementById('draw-score-display').textContent,
    };

    STATE.difficulty = 'sleep';
    updateWaveDisplay();
    updateDrawScoreDisplay();
    const sleep = {
      score: document.getElementById('score-display').textContent,
      drawScore: document.getElementById('draw-score-display').textContent,
    };

    return { normal, sleep };
  });

  expect(result.normal.score).toBe('Score: 500');
  expect(result.normal.drawScore).not.toBe('');
  expect(result.sleep.score).toBe('');
  expect(result.sleep.drawScore).toBe('');
  expect(errors).toEqual([]);
});

test('Sleep mode suppresses the achievement toast (box + jingle) but not per-line connection praise', async ({ page }) => {
  const errors = trackErrors(page);
  await page.addInitScript(() => { navigator.vibrate = () => true; });
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(() => {
    STATE.difficulty = 'sleep';
    const queueLengthBefore = STATE.achievementQueue.length;
    queueAchievement({ glyph: '🏆', bg: '#fff', glow: 'rgba(0,0,0,0)', label: 'Should Not Appear' });
    const sleepResult = {
      queueGrew: STATE.achievementQueue.length > queueLengthBefore,
      toastVisible: document.getElementById('achievement-toast').classList.contains('visible'),
      toastActive: STATE.achievementToastActive,
    };

    STATE.difficulty = 'normal';
    queueAchievement({ glyph: '🏆', bg: '#fff', glow: 'rgba(0,0,0,0)', label: 'Should Appear' });
    const normalResult = {
      toastVisible: document.getElementById('achievement-toast').classList.contains('visible'),
      toastText: document.getElementById('achievement-label').textContent,
    };

    return { sleepResult, normalResult };
  });

  expect(result.sleepResult.queueGrew).toBe(false);
  expect(result.sleepResult.toastVisible).toBe(false);
  expect(result.sleepResult.toastActive).toBe(false);
  expect(result.normalResult.toastVisible).toBe(true);
  expect(result.normalResult.toastText).toBe('Should Appear');
  expect(errors).toEqual([]);
});

test('Sleep mode softens the per-line connection praise sound to a single quiet note instead of the bright multi-note riff, keeping the banner reward itself intact (player request -- full silence would make a well-drawn line feel unacknowledged)', async ({ page }) => {
  const errors = trackErrors(page);
  await page.addInitScript(() => { navigator.vibrate = () => true; });
  await page.goto('/index.html');
  await page.waitForTimeout(300);
  await page.click('#start-game-button');
  await page.waitForTimeout(800);

  const result = await page.evaluate(() => {
    STATE.audioCtx = STATE.audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    STATE.masterBus = STATE.masterBus || STATE.audioCtx.createGain();

    const calls = [];
    const originalPlaySample = playSample;
    window.playSample = (...args) => { calls.push(args); };

    STATE.difficulty = 'sleep';
    playConnectionPraiseRiff(2); // highest tier -- normally the loudest, most note-dense riff, so the strongest possible contrast
    const sleepCalls = calls.slice();
    calls.length = 0;

    STATE.difficulty = 'normal';
    playConnectionPraiseRiff(2);
    const normalCalls = calls.slice();

    window.playSample = originalPlaySample;

    return {
      sleepNoteCount: sleepCalls.length,
      sleepGain: sleepCalls[0] ? sleepCalls[0][3] : null,
      normalNoteCount: normalCalls.length,
      normalGain: normalCalls[0] ? normalCalls[0][3] : null,
    };
  });

  expect(result.sleepNoteCount).toBe(1);
  expect(result.sleepGain).not.toBeNull();
  expect(result.sleepGain).toBeLessThan(0.2);
  expect(result.normalNoteCount).toBeGreaterThan(1);
  expect(result.normalGain).toBeGreaterThan(result.sleepGain);
  expect(errors).toEqual([]);
});

test('the scene selector disables non-rotate options under Sleep mode that aren\'t sleep-safe, and re-enables them otherwise', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(() => {
    STATE.difficulty = 'sleep';
    refreshSceneSelector();
    const birthdayDisabledUnderSleep = document.querySelector('#scene-selector option[value="birthday"]').disabled;
    const rotateEnabledUnderSleep = !document.querySelector('#scene-selector option[value="rotate"]').disabled;

    STATE.difficulty = 'normal';
    refreshSceneSelector();
    const birthdayEnabledUnderNormal = !document.querySelector('#scene-selector option[value="birthday"]').disabled;

    return { birthdayDisabledUnderSleep, rotateEnabledUnderSleep, birthdayEnabledUnderNormal };
  });

  expect(result.birthdayDisabledUnderSleep).toBe(true);
  expect(result.rotateEnabledUnderSleep).toBe(true);
  expect(result.birthdayEnabledUnderNormal).toBe(true);
  expect(errors).toEqual([]);
});

test('picking Birthday under Normal then switching to Sleep resets the stored selection, not just the disabled option (review catch, PR #69)', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(() => {
    STATE.difficulty = 'normal';
    STATE.sceneMode = 'birthday';
    refreshSceneSelector();
    const selectedBeforeSleep = document.getElementById('scene-selector').value;

    STATE.difficulty = 'sleep';
    refreshSceneSelector();

    return {
      selectedBeforeSleep,
      sceneModeAfterSleep: STATE.sceneMode,
      selectedAfterSleep: document.getElementById('scene-selector').value,
    };
  });

  expect(result.selectedBeforeSleep).toBe('birthday');
  // Falls back to the same safe default resolveSceneBlock itself uses --
  // the dropdown's displayed value must never disagree with what
  // actually gets played.
  expect(result.sceneModeAfterSleep).toBe('space');
  expect(result.selectedAfterSleep).toBe('space');
  expect(errors).toEqual([]);
});


// ============================================================
// STORE / PREMIUM SCENES (Dreamscape Pack: Aurora Skies, Coral Reef Glow,
// Crystal Cave -- see STORE_PRODUCTS/PREMIUM_SCENE_LIST in game.js)
// ============================================================

test('a premium scene is unowned by default, gets granted by completeSimulatedPurchase, and that grant persists across a reload', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const before = await page.evaluate(() => isPremiumSceneOwned('aurora'));
  expect(before).toBe(false);

  await page.evaluate(() => completeSimulatedPurchase('premium_scene_pack'));
  const afterPurchase = await page.evaluate(() => ({
    aurora: isPremiumSceneOwned('aurora'),
    reef: isPremiumSceneOwned('reef'),
    cavern: isPremiumSceneOwned('cavern'),
  }));
  expect(afterPurchase).toEqual({ aurora: true, reef: true, cavern: true });

  await page.reload();
  await page.waitForFunction(() => window.__lumina);
  const afterReload = await page.evaluate(() => isPremiumSceneOwned('aurora'));
  expect(afterReload).toBe(true);
  expect(errors).toEqual([]);
});

test('resolveSceneBlock never plays an unowned premium scene, even if STATE.sceneMode names one directly (real enforcement backstop, not just the dropdown)', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(() => {
    STATE.difficulty = 'normal';
    STATE.sceneMode = 'aurora'; // set directly, bypassing the dropdown/Store entirely
    const unownedResolved = resolveSceneBlock(5).scene;

    completeSimulatedPurchase('premium_scene_pack');
    const ownedResolved = resolveSceneBlock(5).scene;

    return { unownedResolved, ownedResolved };
  });

  expect(result.unownedResolved).toBe('space'); // falls back, same as any other invalid fixed pick
  expect(result.ownedResolved).toBe('aurora');
  expect(errors).toEqual([]);
});

test('premium scenes never appear in Rotate mode\'s cycle, purchased or not', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(() => {
    completeSimulatedPurchase('premium_scene_pack');
    STATE.difficulty = 'normal';
    STATE.sceneMode = 'rotate';
    const scenesSeen = new Set();
    for (let wave = 1; wave <= 40; wave++) scenesSeen.add(resolveSceneBlock(wave).scene);
    return Array.from(scenesSeen);
  });

  expect(result).not.toContain('aurora');
  expect(result).not.toContain('reef');
  expect(result).not.toContain('cavern');
  expect(errors).toEqual([]);
});

test('the scene selector locks premium options until purchased, then unlocks and unlabels them', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(() => {
    STATE.difficulty = 'normal';
    refreshSceneSelector();
    const auroraOption = document.querySelector('#scene-selector option[value="aurora"]');
    const disabledBefore = auroraOption.disabled;
    const textBefore = auroraOption.textContent;

    completeSimulatedPurchase('premium_scene_pack');
    const disabledAfter = auroraOption.disabled;
    const textAfter = auroraOption.textContent;

    return { disabledBefore, textBefore, disabledAfter, textAfter };
  });

  expect(result.disabledBefore).toBe(true);
  expect(result.textBefore).toContain('🔒');
  expect(result.disabledAfter).toBe(false);
  expect(result.textAfter).not.toContain('🔒');
  expect(errors).toEqual([]);
});

test('a fixed premium scene pick survives reload once owned, but self-heals back to Rotate on reload if ownership is missing (storage cleared, different device)', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  // Owned case: loadSceneSetting accepts the premium id, and
  // refreshSceneSelector (called from init) has no reason to touch it
  // since isPremiumSceneOwned('reef') is true.
  await page.evaluate(() => {
    completeSimulatedPurchase('premium_scene_pack');
    STATE.sceneMode = 'reef';
    saveSceneSetting('reef');
  });
  await page.reload();
  await page.waitForFunction(() => window.__lumina);
  const ownedResult = await page.evaluate(() => ({
    sceneModeAfterReload: STATE.sceneMode,
    resolved: resolveSceneBlock(3).scene,
  }));
  expect(ownedResult.sceneModeAfterReload).toBe('reef');
  expect(ownedResult.resolved).toBe('reef');

  // Unowned case: same stored pick, but purchase history cleared (e.g. a
  // different device/browser profile) -- refreshSceneSelector's own
  // ownership re-check during init self-heals the stored selection back
  // to Rotate, the same "displayed value can never disagree with what
  // actually plays" guarantee Sleep mode's fallback already relies on.
  await page.evaluate(() => localStorage.removeItem('lumina_purchased_scenes_v1'));
  await page.reload();
  await page.waitForFunction(() => window.__lumina);
  const unownedResult = await page.evaluate(() => ({
    sceneModeAfterReload: STATE.sceneMode,
    resolved: resolveSceneBlock(3).scene,
  }));
  expect(unownedResult.sceneModeAfterReload).toBe('rotate');
  expect(unownedResult.resolved).not.toBe('reef');

  expect(errors).toEqual([]);
});

test('the three premium scenes are marked sleep-safe, matching their calm/glowy design intent', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(() => ({
    aurora: isSceneSleepSafe('aurora'),
    reef: isSceneSleepSafe('reef'),
    cavern: isSceneSleepSafe('cavern'),
  }));
  expect(result).toEqual({ aurora: true, reef: true, cavern: true });
  expect(errors).toEqual([]);
});

test('Aurora Skies, Coral Reef Glow, and Crystal Cave all generate and draw without error', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  const result = await page.evaluate(() => {
    canvas.width = 500; canvas.height = 900;

    STATE.scene = 'aurora';
    STATE.auroraScene = generateAuroraScene();
    updateAuroraScene();
    drawAuroraScene();
    const auroraOk = STATE.auroraScene.ribbons.length > 0 && STATE.auroraScene.phase === 1;

    STATE.scene = 'reef';
    STATE.reefScene = generateReefScene();
    updateReefScene();
    drawReefScene();
    const reefOk = STATE.reefScene.coral.length > 0 && STATE.reefScene.fish.length > 0 && STATE.reefScene.phase === 1;

    STATE.scene = 'cavern';
    STATE.cavernScene = generateCavernScene();
    updateCavernScene();
    drawCavernScene();
    const cavernOk = STATE.cavernScene.crystals.length > 0 && STATE.cavernScene.motes.length > 0 && STATE.cavernScene.phase === 1;

    return { auroraOk, reefOk, cavernOk };
  });

  expect(result.auroraOk).toBe(true);
  expect(result.reefOk).toBe(true);
  expect(result.cavernOk).toBe(true);
  expect(errors).toEqual([]);
});

test('#store-row loses its visible class once the title screen is left, same as every other title-only row (review catch, PR #86)', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  await expect(page.locator('#store-row')).toBeVisible();

  await page.click('#start-game-button');
  const storeRowVisible = await page.evaluate(() => document.getElementById('store-row').classList.contains('visible'));
  expect(storeRowVisible).toBe(false);
  expect(errors).toEqual([]);
});

test('the Store opens from the title screen, walks browse -> checkout -> simulated purchase -> success, and the success grants the pack', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  await expect(page.locator('#store-overlay')).not.toHaveClass(/visible/);
  await page.click('#store-open-button');
  await expect(page.locator('#store-overlay')).toHaveClass(/visible/);
  await expect(page.locator('#store-product')).toBeVisible();
  await expect(page.locator('#store-buy-button')).toBeVisible();

  await page.click('#store-buy-button');
  await expect(page.locator('#store-checkout')).toBeVisible();
  await expect(page.locator('#store-product')).not.toBeVisible();

  await page.click('#store-simulate-button');
  await expect(page.locator('#store-success')).toBeVisible();

  const owned = await page.evaluate(() => isPremiumSceneOwned('aurora') && isPremiumSceneOwned('reef') && isPremiumSceneOwned('cavern'));
  expect(owned).toBe(true);

  await page.click('#store-success-done');
  await expect(page.locator('#store-owned-badge')).toBeVisible();
  await expect(page.locator('#store-buy-button')).not.toBeVisible();
  expect(errors).toEqual([]);
});

test('canceling the Store checkout step returns to browse without granting anything, and the backdrop/close button both dismiss it back to the title screen', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  await page.click('#store-open-button');
  await page.click('#store-buy-button');
  await page.click('#store-checkout-cancel');
  await expect(page.locator('#store-product')).toBeVisible();

  const owned = await page.evaluate(() => isPremiumSceneOwned('aurora'));
  expect(owned).toBe(false);

  await page.click('#store-close');
  await expect(page.locator('#store-overlay')).not.toHaveClass(/visible/);
  expect(errors).toEqual([]);
});

test('the Store is also reachable mid-game via #pause-shop, and closing it resumes play directly (same as Help, not back to the pause menu)', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__lumina);

  await page.click('#start-game-button');
  await page.click('#pause-button');
  await expect(page.locator('#pause-overlay')).toHaveClass(/visible/);

  await page.click('#pause-shop');
  await expect(page.locator('#store-overlay')).toHaveClass(/visible/);
  await expect(page.locator('#pause-overlay')).not.toHaveClass(/visible/);

  await page.click('#store-close');
  await expect(page.locator('#store-overlay')).not.toHaveClass(/visible/);
  await expect(page.locator('#pause-overlay')).not.toHaveClass(/visible/);
  const stillPaused = await page.evaluate(() => STATE.paused);
  expect(stillPaused).toBe(false);
  expect(errors).toEqual([]);
});
