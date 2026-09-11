/**
 * =========================================================
 * BLACKRANK 3.1 — Real-Time Blackness Analysis & Object Tracking System
 * Core Computer Vision & Single Unified Indexing Engine
 * Primary Palette: Dark Brown, Beige, and Tactical Green
 * =========================================================
 */

'use strict';

// ─── DATA MODEL & CONFIG ───────────────────────────────────────────────────
const CONFIG = {
  procWidth: 480,          // Processing canvas resolution
  procHeight: 270,
  darkThreshold: 55,       // Max brightness for a pixel to count as dark
  minContourArea: 400,     // Minimum pixel cluster area
  maxContourAreaRatio: 0.45,
  maxMatchDistance: 80,    // Centroid tracking max distance in px
  trailHistoryLength: 16,  // Trail history points on main feed
};

// Application State
const state = {
  isCameraActive: false,
  isAnalyzing: true,
  isFrozen: false,
  feedMode: 'SIMULATION',  // 'WEBCAM' or 'SIMULATION'
  selectedObjectId: null,
  trackedObjects: [],      // Array of TrackedObject instances
  nextObjectId: 1,
  
  // Toggles
  showTrails: true,
  showVectors: true,
  showLighting: true,

  // Performance Telemetry
  fps: 0,
  frameCount: 0,
  lastFpsTime: performance.now(),
  cameraRes: '1280x720',
  
  // Lighting Environment
  lighting: {
    ambientBrightness: 64.2,
    sceneContrast: 31.7,
    state: 'NORMAL',
    confidence: 92
  },

  // Simulated objects generator state (dark targets in dark brown room)
  simObjects: [
    { x: 120, y: 80,  w: 70, h: 65, vx: 1.1, vy: 0.7, color: [14, 11, 9] },
    { x: 300, y: 140, w: 85, h: 75, vx: -0.8, vy: 0.5, color: [6, 5, 4] },
    { x: 200, y: 190, w: 55, h: 50, vx: 0.5, vy: -1.0, color: [22, 17, 14] },
    { x: 380, y: 60,  w: 60, h: 60, vx: -0.6, vy: -0.4, color: [18, 14, 12] }
  ]
};

/** TrackedObject Data Structure */
class TrackedObject {
  constructor(id, bbox, rgb) {
    this.id = id;                       // integer ID (e.g. 1 -> "OBJECT #01")
    this.bbox = bbox;                   // {x, y, w, h}
    this.centroid = { cx: bbox.x + bbox.w / 2, cy: bbox.y + bbox.h / 2 };
    this.history = [ { ...this.centroid } ];
    
    // Position & Movement
    this.posX = (this.centroid.cx / CONFIG.procWidth) * 100;
    this.posY = (this.centroid.cy / CONFIG.procHeight) * 100;
    this.region = this.calculateRegion(this.posX, this.posY);
    this.vx = 0;
    this.vy = 0;
    this.speed = 0;                     // px/s
    this.direction = 'STATIONARY';
    
    // Color & Blackness Metrics
    this.rgb = rgb;                     // [R, G, B]
    this.hsv = this.rgbToHsv(rgb[0], rgb[1], rgb[2]);
    this.brightness = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
    this.rawBlackness = 100 - (this.brightness / 255 * 100);
    this.localIllumination = 58.3;
    this.lightingAdjustment = (this.localIllumination / 255) * 8.5;
    this.adjustedBlackness = Math.min(100, Math.max(0, this.rawBlackness + this.lightingAdjustment));
    this.blacknessIndex = parseFloat(this.adjustedBlackness.toFixed(1));
    this.classification = this.getClassification(this.blacknessIndex);
    
    // Status & Tracking
    this.rank = 0;
    this.detConfidence = Math.floor(88 + Math.random() * 10);
    this.trkConfidence = Math.floor(85 + Math.random() * 12);
    this.status = 'NEW';
    this.unmatchedFrames = 0;
  }

  update(bbox, rgb, dt) {
    this.bbox = bbox;
    const newCx = bbox.x + bbox.w / 2;
    const newCy = bbox.y + bbox.h / 2;

    // Movement calculation
    const dx = newCx - this.centroid.cx;
    const dy = newCy - this.centroid.cy;
    this.vx = dt > 0 ? (dx / dt) * 1000 : 0;
    this.vy = dt > 0 ? (dy / dt) * 1000 : 0;
    this.speed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);

    this.centroid = { cx: newCx, cy: newCy };
    this.posX = (this.centroid.cx / CONFIG.procWidth) * 100;
    this.posY = (this.centroid.cy / CONFIG.procHeight) * 100;
    this.region = this.calculateRegion(this.posX, this.posY);
    this.direction = this.calculateDirection(this.vx, this.vy, this.speed);

    // Append history
    this.history.push({ ...this.centroid });
    if (this.history.length > CONFIG.trailHistoryLength) {
      this.history.shift();
    }

    // Update Color & Blackness Metrics
    this.rgb = rgb;
    this.hsv = this.rgbToHsv(rgb[0], rgb[1], rgb[2]);
    this.brightness = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
    this.rawBlackness = 100 - (this.brightness / 255 * 100);
    this.lightingAdjustment = (state.lighting.ambientBrightness / 255) * 6.0;
    this.adjustedBlackness = Math.min(100, Math.max(0, this.rawBlackness + this.lightingAdjustment));
    this.blacknessIndex = parseFloat(this.adjustedBlackness.toFixed(1));
    this.classification = this.getClassification(this.blacknessIndex);

    this.status = this.speed > 8 ? 'MOVING' : 'STATIONARY';
    this.unmatchedFrames = 0;
  }

  calculateRegion(x, y) {
    const col = x < 33.3 ? 'LEFT' : x < 66.6 ? 'CENTER' : 'RIGHT';
    const row = y < 33.3 ? 'TOP' : y < 66.6 ? 'CENTER' : 'BOTTOM';
    return row === 'CENTER' && col === 'CENTER' ? 'CENTER' : `${row}-${col}`;
  }

  calculateDirection(vx, vy, speed) {
    if (speed < 5) return 'STATIONARY';
    const angle = Math.atan2(vy, vx) * (180 / Math.PI);
    if (angle >= -22.5 && angle < 22.5) return '→ RIGHT';
    if (angle >= 22.5 && angle < 67.5) return '↘ DOWN-RIGHT';
    if (angle >= 67.5 && angle < 112.5) return '↓ DOWN';
    if (angle >= 112.5 && angle < 157.5) return '↙ DOWN-LEFT';
    if (angle >= 157.5 || angle < -157.5) return '← LEFT';
    if (angle >= -157.5 && angle < -112.5) return '↖ UP-LEFT';
    if (angle >= -112.5 && angle < -67.5) return '↑ UP';
    if (angle >= -67.5 && angle < -22.5) return '↗ UP-RIGHT';
    return 'STATIONARY';
  }

  rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s, v = max;
    const d = max - min;
    s = max === 0 ? 0 : d / max;
    if (max === min) {
      h = 0;
    } else {
      switch (max) {
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        case b: h = (r - g) / d + 4; break;
      }
      h /= 6;
    }
    return [Math.round(h * 360), Math.round(s * 100), Math.round(v * 100)];
  }

  getClassification(bi) {
    if (bi < 20) return 'NOT BLACK';
    if (bi < 40) return 'SUSPICIOUSLY DARK';
    if (bi < 60) return 'BLACK-ISH';
    if (bi < 80) return 'QUITE BLACK';
    if (bi < 95) return 'VERY BLACK';
    if (bi < 99) return 'EXTREMELY BLACK';
    return 'WHY IS THIS SO BLACK?';
  }
}

// ─── DOM ELEMENTS ─────────────────────────────────────────────────────────
const DOM = {
  video: document.getElementById('webcamVideo'),
  cameraCanvas: document.getElementById('cameraCanvas'),
  
  // Header Telemetry
  statusDot: document.getElementById('statusDot'),
  statusBadgeText: document.getElementById('statusBadgeText'),
  fpsCounter: document.getElementById('fpsCounter'),
  headerObjectCount: document.getElementById('headerObjectCount'),
  headerRes: document.getElementById('headerRes'),
  feedModeBadge: document.getElementById('feedModeBadge'),

  // Leaderboard & Result Card
  leaderId: document.getElementById('leaderId'),
  leaderScore: document.getElementById('leaderScore'),
  leaderClassification: document.getElementById('leaderClassification'),
  leaderComparison: document.getElementById('leaderComparison'),

  // Controls
  btnAnalyze: document.getElementById('btnAnalyze'),
  btnToggleCamera: document.getElementById('btnToggleCamera'),
  btnFreeze: document.getElementById('btnFreeze'),
  btnResetTrack: document.getElementById('btnResetTrack'),
  chkTrails: document.getElementById('chkTrails'),
  chkVectors: document.getElementById('chkVectors'),
  chkLighting: document.getElementById('chkLighting'),

  // Lists & Cards
  objectCardsContainer: document.getElementById('objectCardsContainer'),
  listObjectCount: document.getElementById('listObjectCount'),
  
  // Lighting
  lightAmbient: document.getElementById('lightAmbient'),
  lightContrast: document.getElementById('lightContrast'),
  lightState: document.getElementById('lightState'),
  lightConfidence: document.getElementById('lightConfidence'),

  // Status Bar
  sbAnalysis: document.getElementById('sbAnalysis'),
  sbObjects: document.getElementById('sbObjects'),
  sbTracking: document.getElementById('sbTracking'),
  sbFps: document.getElementById('sbFps'),
  sbLighting: document.getElementById('sbLighting'),
  sbCamera: document.getElementById('sbCamera'),
};

// ─── OFFSCREEN PROCESSING CANVAS ──────────────────────────────────────────
const procCanvas = document.createElement('canvas');
procCanvas.width = CONFIG.procWidth;
procCanvas.height = CONFIG.procHeight;
const procCtx = procCanvas.getContext('2d', { willReadFrequently: true });

const camCtx = DOM.cameraCanvas.getContext('2d');

let lastFrameTime = performance.now();

// ─── INITIALIZATION ───────────────────────────────────────────────────────
function init() {
  resizeCanvases();
  window.addEventListener('resize', resizeCanvases);

  setupEventListeners();
  tryStartCamera();

  // Begin Render Loop
  requestAnimationFrame(loop);
}

function resizeCanvases() {
  const rect = DOM.cameraCanvas.parentElement.getBoundingClientRect();
  DOM.cameraCanvas.width = rect.width;
  DOM.cameraCanvas.height = rect.height;
}

// ─── CAMERA / SIMULATION MANAGEMENT ─────────────────────────────────────
async function tryStartCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 } }
    });
    DOM.video.srcObject = stream;
    await DOM.video.play();
    
    state.isCameraActive = true;
    state.feedMode = 'WEBCAM';
    DOM.feedModeBadge.textContent = 'WEBCAM LIVE';
    DOM.btnToggleCamera.textContent = 'STOP CAMERA';
    updateStatusBadge('CAMERA LIVE', true);
  } catch (err) {
    console.warn('Webcam access not available, using synthetic CV stream fallback:', err);
    state.isCameraActive = false;
    state.feedMode = 'SIMULATION';
    DOM.feedModeBadge.textContent = 'SIMULATION FEED';
    DOM.btnToggleCamera.textContent = 'START CAMERA';
    updateStatusBadge('SIMULATION ACTIVE', true);
  }
}

function stopCamera() {
  if (DOM.video.srcObject) {
    DOM.video.srcObject.getTracks().forEach(track => track.stop());
    DOM.video.srcObject = null;
  }
  state.isCameraActive = false;
  state.feedMode = 'SIMULATION';
  DOM.feedModeBadge.textContent = 'SIMULATION FEED';
  DOM.btnToggleCamera.textContent = 'START CAMERA';
  updateStatusBadge('STANDBY / SIMULATION', true);
}

function updateStatusBadge(text, isActive) {
  DOM.statusBadgeText.textContent = text;
  if (isActive) {
    DOM.statusDot.style.backgroundColor = 'var(--accent-green)';
    DOM.statusDot.style.boxShadow = '0 0 10px var(--accent-green)';
  } else {
    DOM.statusDot.style.backgroundColor = 'var(--text-muted)';
    DOM.statusDot.style.boxShadow = 'none';
  }
}

// ─── MAIN LOOP ────────────────────────────────────────────────────────────
function loop(now) {
  requestAnimationFrame(loop);

  const dt = now - lastFrameTime;
  lastFrameTime = now;

  // FPS Telemetry
  state.frameCount++;
  if (now - state.lastFpsTime >= 1000) {
    state.fps = Math.round((state.frameCount * 1000) / (now - state.lastFpsTime));
    state.frameCount = 0;
    state.lastFpsTime = now;
    DOM.fpsCounter.textContent = String(state.fps).padStart(2, '0');
    DOM.sbFps.textContent = state.fps;
  }

  if (!state.isFrozen) {
    // 1. Capture Frame into Processing Canvas
    captureFrame();

    // 2. Perform Computer Vision Dark Object Detection
    if (state.isAnalyzing) {
      const rawDetections = detectDarkObjects();
      trackObjects(rawDetections, dt);
      rankObjects();
    }
  }

  // 3. Render Pristine Camera Feed & Overlays (No floating sub-windows)
  renderCameraFeed();

  // 4. Update Single Continuous Intelligence Feed
  updateUIPanels();
}

// ─── FRAME CAPTURE ────────────────────────────────────────────────────────
function captureFrame() {
  if (state.feedMode === 'WEBCAM' && state.isCameraActive && DOM.video.readyState === 4) {
    procCtx.drawImage(DOM.video, 0, 0, CONFIG.procWidth, CONFIG.procHeight);
  } else {
    renderSyntheticDarkScene();
  }
}

/** Render a dark brown / black synthetic scene with floating dark objects */
function renderSyntheticDarkScene() {
  // Dark Brown base
  procCtx.fillStyle = '#18120e';
  procCtx.fillRect(0, 0, CONFIG.procWidth, CONFIG.procHeight);

  // Subtle warm beige grid lines
  procCtx.strokeStyle = 'rgba(201, 186, 168, 0.05)';
  procCtx.lineWidth = 1;
  for (let x = 0; x < CONFIG.procWidth; x += 40) {
    procCtx.beginPath(); procCtx.moveTo(x, 0); procCtx.lineTo(x, CONFIG.procHeight); procCtx.stroke();
  }
  for (let y = 0; y < CONFIG.procHeight; y += 40) {
    procCtx.beginPath(); procCtx.moveTo(0, y); procCtx.lineTo(CONFIG.procWidth, y); procCtx.stroke();
  }

  // Update & Draw simulated dark targets
  state.simObjects.forEach(obj => {
    obj.x += obj.vx;
    obj.y += obj.vy;

    if (obj.x <= 20 || obj.x + obj.w >= CONFIG.procWidth - 20) obj.vx *= -1;
    if (obj.y <= 20 || obj.y + obj.h >= CONFIG.procHeight - 20) obj.vy *= -1;

    // Draw dark object body
    procCtx.fillStyle = `rgb(${obj.color[0]}, ${obj.color[1]}, ${obj.color[2]})`;
    procCtx.fillRect(obj.x, obj.y, obj.w, obj.h);
  });
}

// ─── COMPUTER VISION DETECTION PIPELINE ──────────────────────────────────
function detectDarkObjects() {
  const imgData = procCtx.getImageData(0, 0, CONFIG.procWidth, CONFIG.procHeight);
  const pixels = imgData.data;
  const width = CONFIG.procWidth;
  const height = CONFIG.procHeight;

  // Grid-based connected component clustering
  const gridSize = 10;
  const cols = Math.floor(width / gridSize);
  const rows = Math.floor(height / gridSize);
  const grid = new Array(cols * rows).fill(false);

  let totalLum = 0;

  // 1. Threshold dark pixels into grid cells
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let darkPixels = 0;
      let cellLum = 0;

      for (let py = 0; py < gridSize; py += 2) {
        for (let px = 0; px < gridSize; px += 2) {
          const ix = ((r * gridSize + py) * width + (c * gridSize + px)) * 4;
          const lum = 0.299 * pixels[ix] + 0.587 * pixels[ix + 1] + 0.114 * pixels[ix + 2];
          cellLum += lum;
          if (lum < CONFIG.darkThreshold) darkPixels++;
        }
      }
      totalLum += cellLum;
      if (darkPixels > 12) {
        grid[r * cols + c] = true;
      }
    }
  }

  state.lighting.ambientBrightness = parseFloat((totalLum / (cols * rows * 25)).toFixed(1));

  // 2. Group adjacent grid cells into bounding boxes
  const visited = new Array(cols * rows).fill(false);
  const detections = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      if (grid[idx] && !visited[idx]) {
        // BFS / Flood Fill
        const queue = [ { r, c } ];
        visited[idx] = true;
        let minC = c, maxC = c, minR = r, maxR = r;

        while (queue.length > 0) {
          const cell = queue.shift();
          minC = Math.min(minC, cell.c);
          maxC = Math.max(maxC, cell.c);
          minR = Math.min(minR, cell.r);
          maxR = Math.max(maxR, cell.r);

          const neighbors = [
            { r: cell.r - 1, c: cell.c }, { r: cell.r + 1, c: cell.c },
            { r: cell.r, c: cell.c - 1 }, { r: cell.r, c: cell.c + 1 }
          ];

          for (const n of neighbors) {
            if (n.r >= 0 && n.r < rows && n.c >= 0 && n.c < cols) {
              const nIdx = n.r * cols + n.c;
              if (grid[nIdx] && !visited[nIdx]) {
                visited[nIdx] = true;
                queue.push(n);
              }
            }
          }
        }

        const bbox = {
          x: minC * gridSize,
          y: minR * gridSize,
          w: (maxC - minC + 1) * gridSize,
          h: (maxR - minR + 1) * gridSize
        };

        const area = bbox.w * bbox.h;
        if (area >= CONFIG.minContourArea && area <= width * height * CONFIG.maxContourAreaRatio) {
          const rgb = getAverageRGB(pixels, width, bbox);
          detections.push({ bbox, rgb });
        }
      }
    }
  }

  return detections;
}

function getAverageRGB(pixels, imgWidth, bbox) {
  let r = 0, g = 0, b = 0, count = 0;
  const step = 4;

  for (let y = bbox.y; y < bbox.y + bbox.h; y += step) {
    for (let x = bbox.x; x < bbox.x + bbox.w; x += step) {
      const idx = (y * imgWidth + x) * 4;
      r += pixels[idx];
      g += pixels[idx + 1];
      b += pixels[idx + 2];
      count++;
    }
  }
  return count > 0 ? [Math.round(r / count), Math.round(g / count), Math.round(b / count)] : [10, 8, 7];
}

// ─── OBJECT TRACKING ENGINE ───────────────────────────────────────────────
function trackObjects(rawDetections, dt) {
  const updatedTracked = [];
  const unmatchedDetections = [ ...rawDetections ];

  // Match existing objects by minimum centroid distance
  for (const obj of state.trackedObjects) {
    let bestIdx = -1;
    let minDistance = CONFIG.maxMatchDistance;

    for (let i = 0; i < unmatchedDetections.length; i++) {
      const det = unmatchedDetections[i];
      const detCx = det.bbox.x + det.bbox.w / 2;
      const detCy = det.bbox.y + det.bbox.h / 2;
      const dist = Math.hypot(detCx - obj.centroid.cx, detCy - obj.centroid.cy);

      if (dist < minDistance) {
        minDistance = dist;
        bestIdx = i;
      }
    }

    if (bestIdx !== -1) {
      const matched = unmatchedDetections.splice(bestIdx, 1)[0];
      obj.update(matched.bbox, matched.rgb, dt);
      updatedTracked.push(obj);
    } else {
      obj.unmatchedFrames++;
      if (obj.unmatchedFrames < 15) {
        obj.status = 'LOST';
        updatedTracked.push(obj);
      }
    }
  }

  // Create new TrackedObject instances for unmatched detections
  for (const det of unmatchedDetections) {
    const newObj = new TrackedObject(state.nextObjectId++, det.bbox, det.rgb);
    updatedTracked.push(newObj);
  }

  state.trackedObjects = updatedTracked;
}

// ─── RANKING ENGINE ───────────────────────────────────────────────────────
function rankObjects() {
  state.trackedObjects.sort((a, b) => b.blacknessIndex - a.blacknessIndex);
  state.trackedObjects.forEach((obj, idx) => {
    obj.rank = idx + 1;
  });
}

// ─── PRISTINE CAMERA RENDERING (ZERO FLOATING INSETS) ────────────────────
function renderCameraFeed() {
  const canvas = DOM.cameraCanvas;
  const ctx = camCtx;
  const cw = canvas.width;
  const ch = canvas.height;

  // Clear & Draw base processing image scaled to canvas
  ctx.fillStyle = '#120e0b';
  ctx.fillRect(0, 0, cw, ch);

  ctx.drawImage(procCanvas, 0, 0, cw, ch);

  const scaleX = cw / CONFIG.procWidth;
  const scaleY = ch / CONFIG.procHeight;

  // Draw detected object bounding boxes and clean HUD overlays
  state.trackedObjects.forEach(obj => {
    const isSelected = obj.id === state.selectedObjectId;
    const isLeader = obj.rank === 1;

    const bx = obj.bbox.x * scaleX;
    const by = obj.bbox.y * scaleY;
    const bw = obj.bbox.w * scaleX;
    const bh = obj.bbox.h * scaleY;

    // Draw Movement Trails in Tactical Green
    if (state.showTrails && obj.history.length > 1) {
      ctx.beginPath();
      ctx.moveTo(obj.history[0].cx * scaleX, obj.history[0].cy * scaleY);
      for (let i = 1; i < obj.history.length; i++) {
        ctx.lineTo(obj.history[i].cx * scaleX, obj.history[i].cy * scaleY);
      }
      ctx.strokeStyle = isLeader ? 'rgba(34, 197, 94, 0.65)' : 'rgba(74, 222, 128, 0.4)';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Bounding Box Colors: Tactical Green & Bright Highlights
    let strokeColor = '#22c55e';
    if (isSelected) strokeColor = '#4ade80';
    else if (isLeader) strokeColor = '#f5efe6';

    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = isSelected || isLeader ? 2 : 1.5;
    ctx.strokeRect(bx, by, bw, bh);

    // Tactical Corner Brackets (Precision Instrument Look)
    const cornerSize = 9;
    ctx.strokeStyle = isLeader ? '#4ade80' : strokeColor;
    ctx.lineWidth = 3;
    // Top-Left
    ctx.beginPath(); ctx.moveTo(bx, by + cornerSize); ctx.lineTo(bx, by); ctx.lineTo(bx + cornerSize, by); ctx.stroke();
    // Top-Right
    ctx.beginPath(); ctx.moveTo(bx + bw - cornerSize, by); ctx.lineTo(bx + bw, by); ctx.lineTo(bx + bw, by + cornerSize); ctx.stroke();
    // Bottom-Left
    ctx.beginPath(); ctx.moveTo(bx, by + bh - cornerSize); ctx.lineTo(bx, by + bh); ctx.lineTo(bx + cornerSize, by + bh); ctx.stroke();
    // Bottom-Right
    ctx.beginPath(); ctx.moveTo(bx + bw - cornerSize, by + bh); ctx.lineTo(bx + bw, by + bh); ctx.lineTo(bx + bw, by + bh - cornerSize); ctx.stroke();

    // Centroid Indicator Dot
    ctx.fillStyle = '#22c55e';
    ctx.beginPath();
    ctx.arc(obj.centroid.cx * scaleX, obj.centroid.cy * scaleY, 3.5, 0, Math.PI * 2);
    ctx.fill();

    // High-contrast Dark Brown & Beige Overlay Label Tag
    const tagWidth = Math.max(bw, 135);
    ctx.fillStyle = 'rgba(26, 19, 16, 0.92)';
    ctx.fillRect(bx, by - 24, tagWidth, 22);
    ctx.strokeStyle = 'rgba(82, 65, 54, 0.8)';
    ctx.lineWidth = 1;
    ctx.strokeRect(bx, by - 24, tagWidth, 22);

    ctx.fillStyle = '#f5efe6';
    ctx.font = 'bold 11px "JetBrains Mono", monospace';
    ctx.fillText(`OBJ #${String(obj.id).padStart(2, '0')}`, bx + 6, by - 9);

    ctx.fillStyle = '#4ade80';
    ctx.font = 'bold 11px "JetBrains Mono", monospace';
    ctx.fillText(`BI ${obj.blacknessIndex}%`, bx + 68, by - 9);

    // Direction & Speed Vector
    if (state.showVectors && obj.speed > 5) {
      ctx.fillStyle = '#22c55e';
      ctx.font = '10px "JetBrains Mono", monospace';
      ctx.fillText(`${obj.direction} (${Math.round(obj.speed)} px/s)`, bx + 6, by + bh + 14);
    }
  });
}

// ─── UI PANELS SYNC (SINGLE UNIFIED SCROLL FEED) ──────────────────────────
function updateUIPanels() {
  const count = state.trackedObjects.length;
  DOM.headerObjectCount.textContent = count;
  DOM.listObjectCount.textContent = `${count} OBJECTS`;
  DOM.sbObjects.textContent = count;

  // 1. Blackness Leader Card Update
  if (count > 0) {
    const leader = state.trackedObjects[0];
    DOM.leaderId.textContent = `OBJECT #${String(leader.id).padStart(2, '0')}`;
    DOM.leaderScore.textContent = `${leader.blacknessIndex.toFixed(1)}%`;
    DOM.leaderClassification.textContent = leader.classification;

    if (count > 1) {
      const runnerUp = state.trackedObjects[1];
      const diff = (leader.blacknessIndex - runnerUp.blacknessIndex).toFixed(1);
      DOM.leaderComparison.textContent = `OBJECT #${String(leader.id).padStart(2, '0')} IS ${diff} POINTS BLACKER THAN OBJECT #${String(runnerUp.id).padStart(2, '0')}.`;
    } else {
      DOM.leaderComparison.textContent = `OBJECT #${String(leader.id).padStart(2, '0')} IS UNCONTESTED LEADER.`;
    }
  } else {
    DOM.leaderId.textContent = 'NO LEADER';
    DOM.leaderScore.textContent = '00.0%';
    DOM.leaderClassification.textContent = 'AWAITING TARGETS';
    DOM.leaderComparison.textContent = 'AWAITING DARK OBJECT DETECTION...';
  }

  // 2. Render Ranked Object Cards List (Position, Blackness %, and subtle inline telemetry)
  renderObjectCardsList();

  // 3. Update Lighting Metrics
  DOM.lightAmbient.textContent = state.lighting.ambientBrightness;
  DOM.lightContrast.textContent = state.lighting.sceneContrast;
  DOM.lightState.textContent = state.lighting.ambientBrightness < 40 ? 'LOW' : 'NORMAL';
  DOM.sbLighting.textContent = DOM.lightState.textContent;
}

/** Render Streamlined Ranked Cards in the Single Scroll Panel */
function renderObjectCardsList() {
  const container = DOM.objectCardsContainer;
  container.innerHTML = '';

  if (state.trackedObjects.length === 0) {
    container.innerHTML = `<div class="empty-state-notice">NO QUALIFYING BLACK OBJECTS DETECTED</div>`;
    return;
  }

  state.trackedObjects.forEach(obj => {
    const isSelected = obj.id === state.selectedObjectId;
    const card = document.createElement('div');
    card.className = `obj-card ${isSelected ? 'selected' : ''} ${obj.rank === 1 ? 'rank-1' : ''}`;
    card.onclick = () => selectObject(obj.id);

    card.innerHTML = `
      <div class="obj-main-row">
        <div class="obj-identity">
          <span class="obj-rank-pill">#${obj.rank}</span>
          <span class="obj-title">OBJECT #${String(obj.id).padStart(2, '0')}</span>
        </div>
        <div class="obj-blackness-wrap">
          <span class="obj-blackness-val">${obj.blacknessIndex}%</span>
          <span class="obj-blackness-class">${obj.classification}</span>
        </div>
      </div>

      <div class="bi-meter-container">
        <div class="bi-meter-fill" style="width: ${Math.min(100, Math.max(0, obj.blacknessIndex))}%"></div>
      </div>

      <div class="obj-pos-telemetry-row">
        <div class="obj-primary-pos">
          <span class="pos-icon">📍</span>
          <span>POS: <strong>${obj.posX.toFixed(1)}%, ${obj.posY.toFixed(1)}%</strong> (${obj.region})</span>
        </div>
        <div class="obj-subtle-extras">
          <span>RGB <span class="extra-val">${obj.rgb.join(',')}</span></span>
          <span>•</span>
          <span>HSV <span class="extra-val">${obj.hsv[0]}°,${obj.hsv[1]}%,${obj.hsv[2]}%</span></span>
          <span>•</span>
          <span><span class="extra-val">${Math.round(obj.speed)} px/s</span></span>
          <span>•</span>
          <span>BRT <span class="extra-val">${obj.brightness.toFixed(1)}</span></span>
        </div>
      </div>
    `;
    container.appendChild(card);
  });
}

function selectObject(id) {
  state.selectedObjectId = state.selectedObjectId === id ? null : id;
  updateUIPanels();
}

// ─── EVENT LISTENERS ──────────────────────────────────────────────────────
function setupEventListeners() {
  DOM.btnAnalyze.onclick = () => {
    state.isAnalyzing = !state.isAnalyzing;
    DOM.btnAnalyze.style.opacity = state.isAnalyzing ? '1' : '0.5';
    DOM.sbAnalysis.textContent = state.isAnalyzing ? 'ACTIVE' : 'PAUSED';
  };

  DOM.btnToggleCamera.onclick = () => {
    if (state.isCameraActive) {
      stopCamera();
    } else {
      tryStartCamera();
    }
  };

  DOM.btnFreeze.onclick = () => {
    state.isFrozen = !state.isFrozen;
    DOM.btnFreeze.textContent = state.isFrozen ? 'RESUME CAMERA' : 'FREEZE FRAME';
    DOM.btnFreeze.style.borderColor = state.isFrozen ? 'var(--accent-green)' : 'var(--border-bright)';
  };

  DOM.btnResetTrack.onclick = () => {
    state.trackedObjects = [];
    state.nextObjectId = 1;
    state.selectedObjectId = null;
    DOM.sbTracking.textContent = 'RESETTING...';
    setTimeout(() => { DOM.sbTracking.textContent = 'STABLE'; }, 800);
  };

  DOM.chkTrails.onchange = (e) => state.showTrails = e.target.checked;
  DOM.chkVectors.onchange = (e) => state.showVectors = e.target.checked;
  DOM.chkLighting.onchange = (e) => state.showLighting = e.target.checked;

  // Click on camera canvas to select object
  DOM.cameraCanvas.onclick = (e) => {
    const rect = DOM.cameraCanvas.getBoundingClientRect();
    const clickX = ((e.clientX - rect.left) / rect.width) * CONFIG.procWidth;
    const clickY = ((e.clientY - rect.top) / rect.height) * CONFIG.procHeight;

    let found = null;
    for (const obj of state.trackedObjects) {
      if (
        clickX >= obj.bbox.x && clickX <= obj.bbox.x + obj.bbox.w &&
        clickY >= obj.bbox.y && clickY <= obj.bbox.y + obj.bbox.h
      ) {
        found = obj.id;
        break;
      }
    }
    selectObject(found);
  };
}

// Launch on DOM ready
document.addEventListener('DOMContentLoaded', init);
