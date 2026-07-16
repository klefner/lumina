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

  // Audio
  MASTER_VOLUME: 0.28,
  TONE_ATTACK: 0.025,        // seconds
  TONE_SUSTAIN: 0.4,         // seconds
  TONE_RELEASE: 1.4,         // seconds
  BEAT_BPM: 60,

  // Wave
  STARTING_PAIRS: 3,         // Number of color pairs in Wave 1
  PAIRS_PER_WAVE_INCREASE: 2,// Add one pair every N waves
  MAX_PAIRS: 6,              // Maximum color pairs ever shown
  WAVE_COMPLETE_DELAY: 2200, // ms before starting next wave
  ARPEGGIO_INTERVAL: 130,    // ms between tones in wave complete arpeggio
};

// Color palette — each index is one instrument/color
const INSTRUMENTS = [
  { hex: '#00FFFF', glow: 'rgba(0,255,255,',   freq: 261.63, name: 'crystal' },  // C4
  { hex: '#FF00FF', glow: 'rgba(255,0,255,',   freq: 329.63, name: 'bloom'   },  // E4
  { hex: '#FFD700', glow: 'rgba(255,215,0,',   freq: 392.00, name: 'gold'    },  // G4
  { hex: '#00FF88', glow: 'rgba(0,255,136,',   freq: 523.25, name: 'jade'    },  // C5
  { hex: '#FF6644', glow: 'rgba(255,102,68,',  freq: 659.25, name: 'ember'   },  // E5
  { hex: '#AA88FF', glow: 'rgba(170,136,255,', freq: 783.99, name: 'violet'  },  // G5
];

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

  activeDot: null,     // The dot currently being dragged from
  currentPath: [],     // Points being drawn right now [{x, y}]
  isDrawing: false,

  audioCtx: null,      // Created on first gesture
  beatInterval: null,  // setInterval reference for beat pulse
  beatTick: 0,          // Increments each beat
};

// ============================================================
// SECTION 3: AUDIO ENGINE
// ============================================================
function initAudio() {
  if (STATE.audioCtx) return;
  STATE.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
}

function playTone(colorIndex) {
  if (!STATE.audioCtx) return;

  const instrument = INSTRUMENTS[colorIndex];
  const ctx = STATE.audioCtx;
  const now = ctx.currentTime;

  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(instrument.freq, now);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(CONFIG.MASTER_VOLUME, now + CONFIG.TONE_ATTACK);
  gain.gain.setValueAtTime(CONFIG.MASTER_VOLUME, now + CONFIG.TONE_ATTACK + CONFIG.TONE_SUSTAIN);
  gain.gain.exponentialRampToValueAtTime(0.001, now + CONFIG.TONE_ATTACK + CONFIG.TONE_SUSTAIN + CONFIG.TONE_RELEASE);

  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + CONFIG.TONE_ATTACK + CONFIG.TONE_SUSTAIN + CONFIG.TONE_RELEASE + 0.1);
}

function playWaveCompleteArpeggio() {
  const colorIndexes = STATE.connections.map(c => c.colorIndex).sort((a, b) => a - b);
  colorIndexes.forEach((ci, i) => {
    setTimeout(() => playTone(ci), i * CONFIG.ARPEGGIO_INTERVAL);
  });
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

function drawDot(dot) {
  const instrument = INSTRUMENTS[dot.colorIndex];

  let radius;
  const pulse = (Math.sin(dot.pulsePhase) + 1) / 2; // 0 to 1

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

function drawFadingLine(line) {
  const instrument = INSTRUMENTS[line.colorIndex];

  ctx.save();
  ctx.lineWidth = CONFIG.LINE_WIDTH;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (let i = 1; i < line.points.length; i++) {
    const p0 = line.points[i - 1];
    const p1 = line.points[i];
    const alpha = Math.min(p0.alpha, p1.alpha);

    if (alpha <= 0.01) continue;

    ctx.beginPath();
    ctx.strokeStyle = instrument.glow + alpha + ')';
    ctx.shadowBlur = CONFIG.LINE_GLOW_BLUR;
    ctx.shadowColor = instrument.hex;
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawActiveLine() {
  if (!STATE.isDrawing || STATE.currentPath.length < 2 || !STATE.activeDot) return;

  const instrument = INSTRUMENTS[STATE.activeDot.colorIndex];

  ctx.save();
  ctx.lineWidth = CONFIG.LINE_WIDTH + 1;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = instrument.hex;
  ctx.shadowBlur = CONFIG.LINE_GLOW_BLUR;
  ctx.shadowColor = instrument.hex;

  ctx.beginPath();
  ctx.moveTo(STATE.currentPath[0].x, STATE.currentPath[0].y);
  for (let i = 1; i < STATE.currentPath.length; i++) {
    ctx.lineTo(STATE.currentPath[i].x, STATE.currentPath[i].y);
  }
  ctx.stroke();
  ctx.restore();
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
}

function onInputMove(e) {
  e.preventDefault();
  if (!STATE.isDrawing || STATE.phase !== 'PLAYING') return;

  const pos = getEventPos(e);
  const lastPoint = STATE.currentPath[STATE.currentPath.length - 1];
  const dist = Math.hypot(pos.x - lastPoint.x, pos.y - lastPoint.y);

  if (dist >= CONFIG.LINE_POINT_INTERVAL) {
    STATE.currentPath.push({ x: pos.x, y: pos.y });
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

  if (pathCrossesExistingConnections(STATE.currentPath)) {
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

  playTone(dotA.colorIndex);

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

  playWaveCompleteArpeggio();

  haptic('waveComplete');

  showMessage('WAVE COMPLETE', 'wave ' + STATE.wave);

  STATE.score += STATE.wave * 100;

  setTimeout(() => {
    hideMessage();
    startWave(STATE.wave + 1);
  }, CONFIG.WAVE_COMPLETE_DELAY);
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

  updateWaveDisplay();

  if (!STATE.beatInterval) startBeat();
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
}

function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  for (const line of STATE.lines) {
    drawFadingLine(line);
  }

  drawActiveLine();

  for (const dot of STATE.dots) {
    drawDot(dot);
  }
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
