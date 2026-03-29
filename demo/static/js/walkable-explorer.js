'use strict';
/**
 * walkable-explorer.js  v2
 * Canvas-based top-down walkable world explorer.
 * Features:
 *   - Real spritesheet animation (walk/run/idle/attack/death rows)
 *   - Smooth lerp camera that tracks the player with a deadzone
 *   - Direction-aware sprite flipping (left/right)
 *   - Door proximity detection + "Press E" prompt + entry/exit handling
 *   - Puppeteer API for scripted demo playback
 *   - Zero jitter (all movement eased, camera lerped)
 *
 * Usage:
 *   const explorer = new WalkableExplorer(canvasEl, 'bg_town_ironpeaks_palette_cycle', {
 *     spriteSrc: '/static/img/tiles/standard_rpg/spritesheets/sprite_kael.png',
 *     spriteMeta: { frame_w:128, frame_h:256, rows:[...] },
 *     playerName: 'Kael',
 *     onDoorEnter: (door) => { ... },
 *     onMapLoaded: (mapData) => { ... },
 *   });
 *   await explorer.load();
 *   explorer.start();
 */

class WalkableExplorer {
  constructor(canvas, mapId, opts = {}) {
    this.canvas  = canvas;
    this.ctx     = canvas.getContext('2d');
    this.mapId   = mapId;
    this.opts    = Object.assign({
      // Sprite
      spriteSrc:      null,          // path to spritesheet PNG
      spriteMeta:     null,          // { frame_w, frame_h, rows:[{row,action,frames}] }
      playerName:     'Hero',
      playerColor:    '#a78bfa',     // fallback dot colour
      playerScale:    1.0,           // scale multiplier for drawn sprite

      // Movement
      moveSpeed:      2.8,           // px/frame at 60fps
      runMultiplier:  1.85,
      animFPS:        8,             // sprite animation frames per second

      // Camera
      cameraLerp:     0.10,          // 0.08–0.15 for smoothness
      cameraDeadzone: 60,            // px radius before camera starts moving

      // Door handling
      doorRadius:     40,            // px proximity to trigger "Press E" prompt
      onDoorEnter:    null,          // (doorData) => void
      onDoorExit:          null,          // () => void
      onEncounterTrigger:  null,          // (data) => void — called on random encounter
      onExitReached:       null,          // () => void — alias for onDoorExit

      // Overlay
      showOverlay:    false,
      overlayOpacity: 0.18,

      // Callbacks
      onMapLoaded:    null,
    }, opts);

    // Map data
    this.mapData     = null;
    this.bgImg       = null;
    this.walkImg     = null;
    this.walkPixels  = null;
    this.doors       = [];            // [{x,y,facing,label,targetMapId}]

    // Player state
    this.player = { x: 0, y: 0 };
    this.facing = 'right';           // 'left' | 'right'

    // Random encounter step counter
    this._stepPx       = 0;          // accumulated movement distance in px
    this._encounterCooldown = 0;     // frames remaining before next encounter can trigger
    this._ENCOUNTER_STEP_THRESHOLD = 320; // px walked before a random encounter rolls
    this.moving = false;
    this.running = false;

    // Camera (in map-space)
    this.cam = { x: 0, y: 0 };      // top-left of viewport in map coords
    this._camTarget = { x: 0, y: 0 };

    // Sprite
    this.spriteImg   = null;
    this.spriteRows  = {};           // { action: { row, frames } }
    this._frameIndex = 0;
    this._frameTick  = 0;
    this._action     = 'idle';

    // Door UI
    this._nearDoor   = null;
    this._doorPromptAlpha = 0;

    // Input
    this.keys        = {};
    this._running    = false;
    this.rafId       = null;

    // Puppeteer
    this._puppet     = null;         // { steps: [], stepIndex, timer }

    this._bindKeys();
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  async load(mapId) {
    this.mapId = mapId || this.mapId;

    const maps = window.WALKABLE_MAPS || [];
    this.mapData = maps.find(m => m.map_id === this.mapId);
    if (!this.mapData) throw new Error(`Map not found: ${this.mapId}`);

    this.canvas.width  = this.canvas.width  || 1280;
    this.canvas.height = this.canvas.height || 720;

    const spawn = this.mapData.spawn_point || { x: this.mapData.width / 2, y: this.mapData.height / 2 };
    this.player = { ...spawn };
    this.cam    = {
      x: spawn.x - this.canvas.width  / 2,
      y: spawn.y - this.canvas.height / 2,
    };
    this._camTarget = { ...this.cam };

    // Parallel load: bg + walkable + sprite
    const loads = [
      this._loadImage(this.mapData.bg_src),
      this.mapData.walkable_src ? this._loadImage(this.mapData.walkable_src) : Promise.resolve(null),
    ];
    if (this.opts.spriteSrc) loads.push(this._loadImage(this.opts.spriteSrc));

    const [bg, wk, spr] = await Promise.all(loads);
    this.bgImg   = bg;
    this.walkImg = wk;
    if (spr) {
      this.spriteImg = spr;
      this._buildSpriteRows();
    }

    // Extract walkable pixel buffer
    if (wk) {
      const off  = document.createElement('canvas');
      off.width  = this.mapData.width;
      off.height = this.mapData.height;
      const octx = off.getContext('2d');
      octx.drawImage(wk, 0, 0, this.mapData.width, this.mapData.height);
      this.walkPixels = octx.getImageData(0, 0, this.mapData.width, this.mapData.height).data;
    }

    // Load door data
    await this._loadDoors();

    if (this.opts.onMapLoaded) this.opts.onMapLoaded(this.mapData);
    return this;
  }

  start() {
    this._running = true;
    this._lastTime = performance.now();
    this._loop(this._lastTime);
    return this;
  }

  stop() {
    this._running = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
  }

  teleport(x, y) {
    this.player = { x, y };
    this.cam = {
      x: x - this.canvas.width  / 2,
      y: y - this.canvas.height / 2,
    };
    this._camTarget = { ...this.cam };
  }

  /**
   * Puppeteer: run a scripted sequence for demo recording.
   * steps: [{ type:'walk', dx, dy, duration }, { type:'wait', duration },
   *          { type:'run', dx, dy, duration }, { type:'door' }]
   */
  puppet(steps) {
    this._puppet = { steps, stepIndex: 0, timer: 0 };
  }

  // ── Sprite setup ───────────────────────────────────────────────────────────

  _buildSpriteRows() {
    const meta = this.opts.spriteMeta;
    if (!meta || !meta.rows) return;
    for (const r of meta.rows) {
      this.spriteRows[r.action] = { row: r.row, frames: r.frames };
    }
  }

  // ── Door loading ───────────────────────────────────────────────────────────

  async _loadDoors() {
    this.doors = [];
    if (!this.mapData) return;

    // Try loading _doors.json adjacent to the bg image
    const bgSrc = this.mapData.bg_src || '';
    const doorsUrl = bgSrc.replace(/\.png$/, '').replace(/\/([^/]+)$/, '/layers/$1_doors.json');

    try {
      const resp = await fetch(doorsUrl);
      if (!resp.ok) return;
      const data = await resp.json();
      // data is array of {x, y, facing, confidence}
      // Cluster into actual doors (group points within 48px of each other)
      this.doors = this._clusterDoorMarkers(data);
    } catch (_) {
      // No door file — that's fine
    }
  }

  _clusterDoorMarkers(markers) {
    if (!markers || !markers.length) return [];
    const clusters = [];
    const used = new Set();
    for (let i = 0; i < markers.length; i++) {
      if (used.has(i)) continue;
      const cluster = [markers[i]];
      used.add(i);
      for (let j = i + 1; j < markers.length; j++) {
        if (used.has(j)) continue;
        const dx = markers[i].x - markers[j].x;
        const dy = markers[i].y - markers[j].y;
        if (Math.sqrt(dx*dx + dy*dy) < 48) {
          cluster.push(markers[j]);
          used.add(j);
        }
      }
      // Use centroid
      const cx = cluster.reduce((s,m) => s + m.x, 0) / cluster.length;
      const cy = cluster.reduce((s,m) => s + m.y, 0) / cluster.length;
      clusters.push({ x: cx, y: cy, facing: cluster[0].facing, label: 'Enter' });
    }
    return clusters;
  }

  // ── Main loop ──────────────────────────────────────────────────────────────

  _loop(now) {
    if (!this._running) return;
    const dt = Math.min((now - (this._lastTime || now)) / (1000 / 60), 3); // clamp dt
    this._lastTime = now;

    this._processPuppet(dt);
    this._processInput(dt);
    this._updateCamera();
    this._updateAnimation(dt);
    this._checkDoorProximity();
    this._draw();

    this.rafId = requestAnimationFrame(t => this._loop(t));
  }

  // ── Input ─────────────────────────────────────────────────────────────────

  _bindKeys() {
    window.addEventListener('keydown', e => {
      this.keys[e.code] = true;
      if (e.code === 'KeyE') this._tryEnterDoor();
    });
    window.addEventListener('keyup', e => { this.keys[e.code] = false; });
  }

  _processInput(dt) {
    if (this._puppet) return; // puppeteer overrides player input

    const base = this.opts.moveSpeed;
    const spd  = (this.keys['ShiftLeft'] || this.keys['ShiftRight'])
      ? base * this.opts.runMultiplier : base;
    this.running = spd > base;

    let dx = 0, dy = 0;
    if (this.keys['ArrowUp']    || this.keys['KeyW']) dy -= spd;
    if (this.keys['ArrowDown']  || this.keys['KeyS']) dy += spd;
    if (this.keys['ArrowLeft']  || this.keys['KeyA']) dx -= spd;
    if (this.keys['ArrowRight'] || this.keys['KeyD']) dx += spd;

    // Normalise diagonal
    if (dx !== 0 && dy !== 0) { dx *= 0.707; dy *= 0.707; }

    this.moving = (dx !== 0 || dy !== 0);
    if (this.moving) {
      if (dx < 0) this.facing = 'left';
      if (dx > 0) this.facing = 'right';
    }
    this._applyMove(dx * dt, dy * dt);
  }

  _applyMove(dx, dy) {
    const nx = this.player.x + dx;
    const ny = this.player.y + dy;
    if (this._isWalkable(nx, this.player.y)) this.player.x = nx;
    if (this._isWalkable(this.player.x, ny)) this.player.y = ny;

    // Track distance walked for random encounter rolls
    const moved = Math.hypot(nx - this.player.x, ny - this.player.y);
    if (moved > 0 && (dx !== 0 || dy !== 0)) {
      this._stepPx += Math.hypot(dx, dy);
      if (this._encounterCooldown > 0) this._encounterCooldown--;
      if (this._stepPx >= this._ENCOUNTER_STEP_THRESHOLD && this._encounterCooldown <= 0) {
        this._stepPx = 0;
        this._encounterCooldown = 120; // ~2s cooldown at 60fps
        // 40% chance per threshold crossing
        if (Math.random() < 0.40) {
          const cb = this.opts.onEncounterTrigger;
          if (typeof cb === 'function') {
            cb({ x: Math.round(this.player.x), y: Math.round(this.player.y) });
          }
        }
      }
    }
  }

  // ── Puppeteer ─────────────────────────────────────────────────────────────

  _processPuppet(dt) {
    if (!this._puppet) return;
    const p = this._puppet;
    if (p.stepIndex >= p.steps.length) {
      this._puppet = null;
      this.moving  = false;
      this._action = 'idle';
      return;
    }
    const step = p.steps[p.stepIndex];
    p.timer += dt;

    switch (step.type) {
      case 'walk':
      case 'run': {
        const spd = step.type === 'run'
          ? this.opts.moveSpeed * this.opts.runMultiplier
          : this.opts.moveSpeed;
        const mag = Math.sqrt(step.dx*step.dx + step.dy*step.dy) || 1;
        const nx  = (step.dx / mag) * spd;
        const ny  = (step.dy / mag) * spd;
        this.moving  = true;
        this.running = step.type === 'run';
        if (nx < 0) this.facing = 'left';
        if (nx > 0) this.facing = 'right';
        this._applyMove(nx * dt, ny * dt);
        if (p.timer >= step.duration) { p.stepIndex++; p.timer = 0; }
        break;
      }
      case 'wait':
        this.moving  = false;
        this.running = false;
        if (p.timer >= step.duration) { p.stepIndex++; p.timer = 0; }
        break;
      case 'door':
        this._tryEnterDoor();
        p.stepIndex++;
        p.timer = 0;
        break;
    }
  }

  // ── Camera ────────────────────────────────────────────────────────────────

  _updateCamera() {
    const vw = this.canvas.width;
    const vh = this.canvas.height;
    const mw = this.mapData?.width  || vw;
    const mh = this.mapData?.height || vh;
    const lerp = this.opts.cameraLerp;
    const dz   = this.opts.cameraDeadzone;

    // Desired camera top-left to centre the player
    const desiredX = this.player.x - vw / 2;
    const desiredY = this.player.y - vh / 2;

    // Only move camera if player leaves deadzone
    const midX = this.cam.x + vw / 2;
    const midY = this.cam.y + vh / 2;
    const distX = this.player.x - midX;
    const distY = this.player.y - midY;

    if (Math.abs(distX) > dz) this._camTarget.x = this.cam.x + (distX - Math.sign(distX) * dz);
    if (Math.abs(distY) > dz) this._camTarget.y = this.cam.y + (distY - Math.sign(distY) * dz);

    // Lerp toward target
    this.cam.x += (this._camTarget.x - this.cam.x) * lerp;
    this.cam.y += (this._camTarget.y - this.cam.y) * lerp;

    // Clamp to map bounds
    this.cam.x = Math.max(0, Math.min(this.cam.x, mw - vw));
    this.cam.y = Math.max(0, Math.min(this.cam.y, mh - vh));
  }

  // ── Animation ─────────────────────────────────────────────────────────────

  _updateAnimation(dt) {
    const prevAction = this._action;
    if (this.moving) {
      this._action = this.running ? 'run' : 'walk';
    } else {
      this._action = 'idle';
    }
    if (this._action !== prevAction) this._frameIndex = 0;

    this._frameTick += dt;
    const frameDur = 60 / this.opts.animFPS;
    if (this._frameTick >= frameDur) {
      this._frameTick -= frameDur;
      const row = this.spriteRows[this._action] || this.spriteRows['idle'];
      const frames = row ? row.frames : 1;
      this._frameIndex = (this._frameIndex + 1) % frames;
    }
  }

  // ── Door logic ─────────────────────────────────────────────────────────────

  _checkDoorProximity() {
    const r2 = this.opts.doorRadius ** 2;
    let nearest = null;
    let nearestDist = Infinity;
    for (const door of this.doors) {
      const dx = this.player.x - door.x;
      const dy = this.player.y - door.y;
      const d2 = dx*dx + dy*dy;
      if (d2 < r2 && d2 < nearestDist) {
        nearest    = door;
        nearestDist = d2;
      }
    }
    this._nearDoor = nearest;
    // Fade prompt in/out
    const target = nearest ? 1 : 0;
    this._doorPromptAlpha += (target - this._doorPromptAlpha) * 0.15;
  }

  _tryEnterDoor() {
    if (!this._nearDoor) return;
    if (this.opts.onDoorEnter) this.opts.onDoorEnter(this._nearDoor);
    // Fire exit callbacks if this is an exit door
    const isExit = !this._nearDoor.targetMapId || this._nearDoor.label === 'Exit';
    if (isExit) {
      if (typeof this.opts.onDoorExit === 'function') this.opts.onDoorExit(this._nearDoor);
      if (typeof this.opts.onExitReached === 'function') this.opts.onExitReached(this._nearDoor);
    }
  }

  // ── Walkability ───────────────────────────────────────────────────────────

  _isWalkable(x, y) {
    if (!this.walkPixels) return true;
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const mw = this.mapData.width;
    const mh = this.mapData.height;
    if (ix < 0 || iy < 0 || ix >= mw || iy >= mh) return false;
    const idx = (iy * mw + ix) * 4;
    const r   = this.walkPixels[idx];
    const g   = this.walkPixels[idx + 1];
    const b   = this.walkPixels[idx + 2];
    const a   = this.walkPixels[idx + 3];
    // Red = blocked
    return !(a > 80 && r > 150 && g < 100 && b < 100);
  }

  // ── Draw ──────────────────────────────────────────────────────────────────

  _draw() {
    const ctx = this.ctx;
    const vw  = this.canvas.width;
    const vh  = this.canvas.height;
    const mw  = this.mapData?.width  || vw;
    const mh  = this.mapData?.height || vh;
    const cx  = Math.round(this.cam.x);
    const cy  = Math.round(this.cam.y);

    ctx.clearRect(0, 0, vw, vh);

    // ── Background ──
    if (this.bgImg) {
      ctx.drawImage(this.bgImg, -cx, -cy, mw, mh);
    } else {
      ctx.fillStyle = '#0d0d18';
      ctx.fillRect(0, 0, vw, vh);
    }

    // ── Walkable overlay (debug) ──
    if (this.opts.showOverlay && this.walkImg) {
      ctx.save();
      ctx.globalAlpha = this.opts.overlayOpacity;
      ctx.drawImage(this.walkImg, -cx, -cy, mw, mh);
      ctx.globalAlpha = 1;
      ctx.restore();
    }

    // ── Door markers ──
    for (const door of this.doors) {
      const sx = door.x - cx;
      const sy = door.y - cy;
      const dx2 = this.player.x - door.x;
      const dy2 = this.player.y - door.y;
      const dist = Math.sqrt(dx2*dx2 + dy2*dy2);
      const alpha = Math.max(0, 1 - dist / (this.opts.doorRadius * 2));
      if (alpha < 0.05) continue;
      ctx.save();
      ctx.globalAlpha = alpha * 0.7;
      ctx.beginPath();
      ctx.arc(sx, sy, 8, 0, Math.PI * 2);
      ctx.fillStyle = '#fbbf24';
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.restore();
    }

    // ── Player ──
    const px = Math.round(this.player.x - cx);
    const py = Math.round(this.player.y - cy);
    this._drawPlayer(ctx, px, py);

    // ── Door prompt ──
    if (this._doorPromptAlpha > 0.05) {
      this._drawDoorPrompt(ctx, px, py);
    }

    // ── Player name tag ──
    this._drawNameTag(ctx, px, py);
  }

  _drawPlayer(ctx, px, py) {
    const meta  = this.opts.spriteMeta;
    const scale = this.opts.playerScale;

    if (this.spriteImg && meta) {
      const rowData  = this.spriteRows[this._action] || this.spriteRows['idle'] || this.spriteRows['walk'];
      if (!rowData) { this._drawDot(ctx, px, py); return; }

      const fw = meta.frame_w;
      const fh = meta.frame_h;
      const fi = Math.min(this._frameIndex, rowData.frames - 1);
      const sx = fi * fw;
      const sy = rowData.row * fh;
      const dw = Math.round(fw * scale);
      const dh = Math.round(fh * scale);

      ctx.save();
      if (this.facing === 'left') {
        ctx.scale(-1, 1);
        ctx.drawImage(this.spriteImg,
          sx, sy, fw, fh,
          -px - dw / 2, py - dh, dw, dh);
      } else {
        ctx.drawImage(this.spriteImg,
          sx, sy, fw, fh,
          px - dw / 2, py - dh, dw, dh);
      }
      ctx.restore();
    } else {
      this._drawDot(ctx, px, py);
    }
  }

  _drawDot(ctx, px, py) {
    const ps = 12;
    ctx.save();
    // Shadow
    ctx.beginPath();
    ctx.ellipse(px, py + ps * 0.6, ps * 0.8, ps * 0.3, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fill();
    // Glow
    const grd = ctx.createRadialGradient(px, py, 0, px, py, ps * 1.8);
    grd.addColorStop(0, 'rgba(167,139,250,0.6)');
    grd.addColorStop(1, 'rgba(167,139,250,0)');
    ctx.beginPath();
    ctx.arc(px, py, ps * 1.8, 0, Math.PI * 2);
    ctx.fillStyle = grd;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(px, py, ps, 0, Math.PI * 2);
    ctx.fillStyle = this.opts.playerColor;
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }

  _drawNameTag(ctx, px, py) {
    const name = this.opts.playerName;
    if (!name) return;
    const meta   = this.opts.spriteMeta;
    const tagY   = meta ? py - Math.round(meta.frame_h * this.opts.playerScale) - 8 : py - 32;
    ctx.save();
    ctx.font         = 'bold 13px "Segoe UI", sans-serif';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'bottom';
    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillText(name, px + 1, tagY + 1);
    ctx.fillStyle = '#e2e8f0';
    ctx.fillText(name, px, tagY);
    ctx.restore();
  }

  _drawDoorPrompt(ctx, px, py) {
    if (!this._nearDoor) return;
    const alpha = Math.min(1, this._doorPromptAlpha);
    const text  = `[E] ${this._nearDoor.label || 'Enter'}`;
    const sx    = Math.round(this._nearDoor.x - this.cam.x);
    const sy    = Math.round(this._nearDoor.y - this.cam.y) - 28;
    ctx.save();
    ctx.globalAlpha  = alpha;
    ctx.font         = 'bold 14px "Segoe UI", sans-serif';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    const tw = ctx.measureText(text).width;
    // Badge background
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.beginPath();
    ctx.roundRect(sx - tw/2 - 8, sy - 11, tw + 16, 22, 6);
    ctx.fill();
    // Border
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    // Text
    ctx.fillStyle = '#fef3c7';
    ctx.fillText(text, sx, sy);
    ctx.restore();
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  _loadImage(src) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload  = () => res(img);
      img.onerror = () => rej(new Error(`Failed to load: ${src}`));
      img.src = src;
    });
  }
}

// Export
if (typeof module !== 'undefined') module.exports = { WalkableExplorer };
if (typeof window  !== 'undefined') window.WalkableExplorer = WalkableExplorer;
