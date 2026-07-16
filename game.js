(function () {
  const canvas = document.getElementById('gameCanvas');
  const ctx = canvas.getContext('2d');
  const messageEl = document.getElementById('message');
  const waveLabelEl = document.getElementById('waveLabel');

  const PALETTE = ['#00FFFF', '#FF00FF', '#FFD700', '#00FF88', '#FF4444'];
  const FREQS = [261.63, 329.63, 392.00, 523.25, 659.25];
  const DOT_BASE_RADIUS = 18;
  const MIN_DOT_DIST = 80;
  const EDGE_MARGIN = 60;
  const TOUCH_RADIUS = 40;
  const FADE_STEP = 0.004;
  const FADE_UNLOCK = 0.05;

  let width, height;
  function resize() {
    const dpr = window.devicePixelRatio || 1;
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', resize);
  resize();

  let audioCtx = null;
  function ensureAudio() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
  }

  function playTone(instrument) {
    ensureAudio();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.value = FREQS[instrument];
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    const now = audioCtx.currentTime;
    const attackEnd = now + 0.02;
    const holdEnd = attackEnd + 0.05;
    const decayEnd = holdEnd + 1.2;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.3, attackEnd);
    gain.gain.setValueAtTime(0.3, holdEnd);
    gain.gain.linearRampToValueAtTime(0, decayEnd);
    osc.start(now);
    osc.stop(decayEnd + 0.05);
  }

  let dots = [];
  let lines = [];
  let currentLine = null;
  let activeDot = null;
  let wave = 1;
  let gameStarted = false;

  function dist(x1, y1, x2, y2) {
    return Math.hypot(x2 - x1, y2 - y1);
  }

  function spawnDots() {
    dots = [];
    for (let i = 0; i < 5; i++) {
      let x, y, tries = 0, ok;
      do {
        ok = true;
        x = EDGE_MARGIN + Math.random() * (width - 2 * EDGE_MARGIN);
        y = EDGE_MARGIN + Math.random() * (height - 2 * EDGE_MARGIN);
        for (const d of dots) {
          if (dist(x, y, d.x, d.y) < MIN_DOT_DIST) { ok = false; break; }
        }
        tries++;
      } while (!ok && tries < 500);
      dots.push({
        x, y,
        radius: DOT_BASE_RADIUS,
        color: PALETTE[i],
        pulsePhase: Math.random() * Math.PI * 2,
        connected: false,
        instrument: i
      });
    }
  }

  function allConnected() {
    return dots.every(d => d.connected);
  }

  function startWave() {
    lines = [];
    currentLine = null;
    activeDot = null;
    spawnDots();
    waveLabelEl.textContent = 'WAVE ' + wave;
  }

  function showMessage(html, duration) {
    messageEl.innerHTML = html;
    if (duration) {
      setTimeout(() => { messageEl.innerHTML = ''; }, duration);
    }
  }

  function completeWave() {
    dots.forEach((d, i) => {
      setTimeout(() => playTone(d.instrument), i * 100);
    });
    if (navigator.vibrate) navigator.vibrate([80, 40, 80]);
    showMessage('<div class="title">WAVE COMPLETE</div>', 2000);
    setTimeout(() => {
      wave++;
      startWave();
    }, 2000);
  }

  function getPos(evt) {
    const rect = canvas.getBoundingClientRect();
    const t = (evt.touches && evt.touches[0]) || (evt.changedTouches && evt.changedTouches[0]);
    if (t) return { x: t.clientX - rect.left, y: t.clientY - rect.top };
    return { x: evt.clientX - rect.left, y: evt.clientY - rect.top };
  }

  function findDotNear(x, y, radius, filterFn) {
    let best = null, bestDist = Infinity;
    for (const d of dots) {
      if (filterFn && !filterFn(d)) continue;
      const dd = dist(x, y, d.x, d.y);
      if (dd <= radius && dd < bestDist) { best = d; bestDist = dd; }
    }
    return best;
  }

  function handleStart(evt) {
    ensureAudio();
    if (!gameStarted) {
      gameStarted = true;
      showMessage('');
      startWave();
      evt.preventDefault();
      return;
    }
    const pos = getPos(evt);
    const dot = findDotNear(pos.x, pos.y, TOUCH_RADIUS, d => !d.connected);
    if (dot) {
      activeDot = dot;
      currentLine = { points: [{ x: pos.x, y: pos.y, alpha: 1.0 }], color: dot.color };
    }
    evt.preventDefault();
  }

  function handleMove(evt) {
    if (!activeDot || !currentLine) return;
    const pos = getPos(evt);
    const last = currentLine.points[currentLine.points.length - 1];
    if (!last || dist(pos.x, pos.y, last.x, last.y) >= 3) {
      currentLine.points.push({ x: pos.x, y: pos.y, alpha: 1.0 });
    }
    evt.preventDefault();
  }

  function handleEnd(evt) {
    if (!activeDot || !currentLine) { activeDot = null; currentLine = null; return; }
    const pos = getPos(evt);
    const target = findDotNear(pos.x, pos.y, TOUCH_RADIUS, d => d !== activeDot);
    if (target) {
      const targetWasUnconnected = !target.connected;
      activeDot.connected = true;
      target.connected = true;
      lines.push(currentLine);
      playTone(activeDot.instrument);
      if (targetWasUnconnected) setTimeout(() => playTone(target.instrument), 60);
      if (navigator.vibrate) navigator.vibrate(40);
      if (allConnected()) setTimeout(completeWave, 150);
    }
    activeDot = null;
    currentLine = null;
    evt.preventDefault();
  }

  canvas.addEventListener('touchstart', handleStart, { passive: false });
  canvas.addEventListener('touchmove', handleMove, { passive: false });
  canvas.addEventListener('touchend', handleEnd, { passive: false });
  canvas.addEventListener('mousedown', handleStart);
  canvas.addEventListener('mousemove', handleMove);
  canvas.addEventListener('mouseup', handleEnd);

  function updateLines() {
    for (const line of lines) {
      const pts = line.points;
      for (let i = 0; i < pts.length; i++) {
        const unlocked = i === 0 || pts[i - 1].alpha < FADE_UNLOCK;
        if (unlocked) pts[i].alpha = Math.max(0, pts[i].alpha - FADE_STEP);
      }
    }
    lines = lines.filter(line => line.points.some(p => p.alpha > 0));
  }

  function hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  function drawLine(points, color, forcedAlpha) {
    if (points.length < 2) return;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3;
    ctx.shadowBlur = 15;
    ctx.shadowColor = color;
    for (let i = 1; i < points.length; i++) {
      const p0 = points[i - 1], p1 = points[i];
      const a = forcedAlpha !== undefined ? forcedAlpha : Math.min(p0.alpha, p1.alpha);
      if (a <= 0) continue;
      ctx.strokeStyle = hexToRgba(color, a);
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
  }

  function drawDots() {
    for (const d of dots) {
      d.pulsePhase += 0.05;
      const r = d.connected
        ? 22 + Math.sin(d.pulsePhase) * 4
        : 19 + Math.sin(d.pulsePhase) * 1;
      ctx.beginPath();
      ctx.shadowBlur = 20;
      ctx.shadowColor = d.color;
      ctx.fillStyle = d.color;
      ctx.arc(d.x, d.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  }

  function loop() {
    ctx.clearRect(0, 0, width, height);
    updateLines();
    for (const line of lines) drawLine(line.points, line.color);
    if (currentLine) drawLine(currentLine.points, currentLine.color, 1.0);
    drawDots();
    requestAnimationFrame(loop);
  }

  showMessage('<div class="title">LUMINA</div><div class="subtitle">connect the dots</div>');
  requestAnimationFrame(loop);

  window.__lumina = {
    getDots: () => dots.map(d => ({ x: d.x, y: d.y, color: d.color, connected: d.connected })),
    getWave: () => wave,
    getLineCount: () => lines.length
  };
})();
