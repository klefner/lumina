// @ts-check
// A deliberately small, fast suite — enough to catch "the game is
// actually broken" before it reaches main, not a substitute for the
// deeper manual/scripted testing a real feature change gets before a PR
// is opened. Runs against window.__lumina, the debug hook game.js
// exposes (getState/getDots) specifically so tests like these don't need
// to reach into internals any other way.
const { test, expect } = require('@playwright/test');

function trackErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  return errors;
}

test('loads cleanly and shows the title screen', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await expect(page.locator('#message-title')).toHaveText('LUMINA');
  await expect(page.locator('#difficulty-selector')).toBeVisible();
  expect(errors).toEqual([]);
});

test('tapping to begin starts the game and initializes audio', async ({ page }) => {
  const errors = trackErrors(page);
  await page.addInitScript(() => { navigator.vibrate = () => true; });
  await page.goto('/index.html');
  await page.waitForTimeout(300);

  // Well below the title/tagline/difficulty-selector block — see the
  // session note about that region intercepting clicks.
  await page.mouse.click(200, 700);
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
  await page.mouse.click(200, 700);
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
  await page.mouse.click(200, 700);
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
  await page.mouse.click(200, 700);
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
  await page.click('body');
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
  await page.click('body');
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
// afterward is correctly rejected forever by pathCrossesBarriers, which
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
  await page.mouse.click(200, 700);
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
        if (!allDotsReachableGivenBarriers(dots, barriers)) unsolvable++;
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
      crosses: pathCrossesBarriers(pathThroughBox),
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

test('the HINT button appears once playing, flashes unconnected dots white at their peak, and returns to the dimmed idle state once it ends', async ({ page }) => {
  const errors = trackErrors(page);
  await page.addInitScript(() => { navigator.vibrate = () => true; });
  await page.goto('/index.html');
  await page.waitForTimeout(300);

  await expect(page.locator('#hint-button')).toBeHidden();
  await expect(page.locator('#hint-button')).toHaveText('HINT');
  await page.mouse.click(200, 700);
  await page.waitForTimeout(1000);
  await expect(page.locator('#hint-button')).toBeVisible();

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

test('the help button opens a how-to-play overlay on both the title screen and mid-game, closable via the X or the backdrop', async ({ page }) => {
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

  // Still reachable once a wave is actually in progress.
  await page.mouse.click(200, 700);
  await page.waitForTimeout(500);
  await expect(page.locator('#help-button')).toBeVisible();
  await page.click('#help-button');
  await expect(page.locator('#help-overlay')).toHaveClass(/visible/);

  // Clicking the backdrop itself (not the panel) also closes it.
  await page.click('#help-overlay', { position: { x: 5, y: 5 } });
  await expect(page.locator('#help-overlay')).not.toHaveClass(/visible/);
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

test('a plain tap on the title screen always starts wave 1 unless Auto Load Last Save is checked, and Load Game always resumes explicitly regardless', async ({ page }) => {
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

  await page.mouse.click(200, 700);
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => window.__lumina.getState().wave)).toBe(1);

  // Save at wave 5, return to title -- autoload is off by default, so a
  // plain tap must NOT silently resume it.
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

  await page.mouse.click(200, 700);
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => window.__lumina.getState().wave)).toBe(1); // NOT 5 -- autoload was off

  // Explicit Load Game click, from a fresh title screen, does resume it.
  await page.evaluate(() => exitToTitle());
  await page.waitForTimeout(300);
  await page.click('#title-load-button');
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.__lumina.getState().wave)).toBe(5);

  // Checking the box persists across a reload, and a plain tap resumes
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

  await page.mouse.click(200, 700);
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
  await page.mouse.click(200, 700);
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
  await page.mouse.click(200, 700);
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
  await page.mouse.click(200, 700);
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
      isSecondToLast: flaggedIndex === TUTORIAL_MESSAGES.length - 2,
      onlyOneFlagged: TUTORIAL_MESSAGES.filter(m => m.unlocksWideWorld).length,
    };
  });

  // WIDE_WORLD_START_WAVE is 1-indexed (wave numbers start at 1), so it
  // should equal the flagged entry's 0-indexed array position + 1.
  expect(result.wideWorldStartWave).toBe(result.flaggedIndex + 1);
  expect(result.isSecondToLast).toBe(true);
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
  await page.mouse.click(200, 700);
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

  // Two waves later is past every tutorial message (the wide-world
  // explainer's own wave, then the final "Relax and Enjoy!" wave right
  // after it) -- still a wide wave, but with no tutorial hint left to
  // show at all. The zoom hold-then-ease beat should still replay here,
  // proving it's tied to being a wide wave, not to the one-time explainer.
  const second = await page.evaluate(() => {
    const laterWave = STATE.wave + 2;
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
  await page.mouse.click(200, 700);
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
  await page.mouse.click(200, 700);
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
  await page.mouse.click(200, 700);
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
  await page.mouse.click(200, 700);
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

    startWave(9); // past every tutorial message (TUTORIAL_MESSAGES.length === 8)
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
