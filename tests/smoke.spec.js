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
