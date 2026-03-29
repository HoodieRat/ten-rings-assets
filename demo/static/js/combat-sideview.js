'use strict';
/**
 * combat-sideview.js
 * Canvas-based side-view combat system (Ring 2+ mode).
 * Renders: BG + player sprite (left) + enemy sprite (right) + HP bars + round log + effects.
 * Drives itself from a combat state object, ties into TenRings.powerUp.
 */

const SIDEVIEW_SHEET_RULES = Object.freeze([
  {
    id: 'skeleton_scavenger',
    match: (src) => String(src || '').toLowerCase().includes('skeleton_universal.png'),
    frameWidth: 64,
    frameHeight: 64,
    cols: 13,
    frameIndex: 143,
  },
]);

function _sideviewSheetRule(src) {
  const source = String(src || '').trim().toLowerCase();
  return SIDEVIEW_SHEET_RULES.find((rule) => rule.match(source)) || null;
}

function _sideviewFrameRect(rule) {
  const col = rule.frameIndex % rule.cols;
  const row = Math.floor(rule.frameIndex / rule.cols);
  return {
    sx: col * rule.frameWidth,
    sy: row * rule.frameHeight,
    sw: rule.frameWidth,
    sh: rule.frameHeight,
  };
}

class SideViewCombat {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.ctx    = canvas.getContext('2d');
    this.opts   = Object.assign({
      bgSrc:           './static/img/combat/bg_cave_combat_street.png',
      playerSrc:       './static/img/combat/ashborn_combat_frame.png',
      enemySrc:        './static/img/combat/skeleton_universal.png',
      playerName:      'Hero',
      enemyName:       'Skeleton Scavenger',
      playerHp:        100,
      enemyHp:         100,
      onCombatEnd:     null,
      autoPlay:        false,
      autoPlayDelay:   1400,
    }, opts);

    this.state = {
      phase:         'idle',   // idle | player_atk | enemy_atk | player_powerup | enemy_powerup | end
      playerHp:      this.opts.playerHp,
      playerMaxHp:   this.opts.playerHp,
      enemyHp:       this.opts.enemyHp,
      enemyMaxHp:    this.opts.enemyHp,
      round:         0,
      log:           [],
      playerX:       0,    // offset for attack lunge animation
      enemyX:        0,
      playerPowered: false,
      enemyPowered:  false,
      slashAlpha:    0,    // slash effect
      slashX:        0,
      slashY:        0,
      flashAlpha:    0,
      result:        null,   // 'player_win' | 'enemy_win'
    };

    this.assets  = {};
    this.rafId   = null;
    this.animQueue = [];   // Scheduled animation steps
    this._setupCanvas();
  }

  // â”€â”€ Public API â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  async load() {
    const [bg, player, enemy] = await Promise.all([
      this._loadImage(this.opts.bgSrc),
      this._loadImage(this.opts.playerSrc),
      this._loadImage(this.opts.enemySrc),
    ]);
    this.assets.bg     = bg;
    this.assets.player = player;
    this.assets.enemy  = enemy;
    this._draw();
    if (this.opts.autoPlay) {
      setTimeout(() => this.startRound(), this.opts.autoPlayDelay);
    }
    return this;
  }

  startRound() {
    if (this.state.phase !== 'idle') return;
    if (this.state.result) return;
    this.state.round++;
    this._runRound();
  }

  // Force a power-up on player or enemy (for scripted demo)
  triggerPowerUp(who, tier = 2) {
    const isPlayer = (who === 'player');
    const color    = isPlayer ? 'gold' : 'red';

    this.state.phase = isPlayer ? 'player_powerup' : 'enemy_powerup';
    this._addLog(isPlayer
      ? `âš¡ ${this.opts.playerName} channels arcane power!`
      : `âš ï¸ ${this.opts.enemyName} surges with hostile power!`
    );

    // Boost stats
    if (isPlayer) {
      this.state.playerPowered = true;
    } else {
      this.state.enemyPowered = true;
      // NPC visually "glows up" â€” double its max HP for phase 2
      const bonus = Math.floor(this.state.enemyMaxHp * 0.5);
      this.state.enemyHp    = Math.min(this.state.enemyHp + bonus, this.state.enemyMaxHp + bonus);
      this.state.enemyMaxHp = this.state.enemyMaxHp + bonus;
    }

    this._draw();

    // Use the DOM powerup system if available, on a small overlay canvas marker
    if (window.TenRings && window.TenRings.powerUp) {
      const rect = this.canvas.getBoundingClientRect();
      const fake = document.createElement('div');
      fake.style.cssText = `position:fixed;left:${rect.left + (isPlayer ? rect.width*0.22 : rect.width*0.72)}px;top:${rect.top + rect.height*0.4}px;width:1px;height:1px;`;
      document.body.appendChild(fake);
      window.TenRings.powerUp(fake, { tier, color });
      setTimeout(() => { if (fake.parentNode) fake.parentNode.removeChild(fake); }, 6000);
    }

    setTimeout(() => {
      this.state.phase = 'idle';
      this._draw();
    }, 2500);
  }

  // â”€â”€ Rendering â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  _setupCanvas() {
    this.canvas.width  = 800;
    this.canvas.height = 420;
  }

  _draw() {
    const ctx = this.ctx;
    const W   = this.canvas.width;
    const H   = this.canvas.height;

    // BG
    if (this.assets.bg) {
      ctx.drawImage(this.assets.bg, 0, 0, W, H);
    } else {
      ctx.fillStyle = '#0a0612';
      ctx.fillRect(0, 0, W, H);
    }

    // Vignette
    const vig = ctx.createRadialGradient(W/2, H/2, H*0.3, W/2, H/2, W*0.8);
    vig.addColorStop(0, 'transparent');
    vig.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, W, H);

    // Sprites
    this._drawSprite('player');
    this._drawSprite('enemy');

    // HP bars
    this._drawHpBar(20, 12, W * 0.38, this.opts.playerName,
      this.state.playerHp, this.state.playerMaxHp, '#a78bfa', this.state.playerPowered);
    this._drawHpBar(W - 20 - W * 0.38, 12, W * 0.38, this.opts.enemyName,
      this.state.enemyHp, this.state.enemyMaxHp, '#f87171', this.state.enemyPowered, true);

    // Round indicator
    this._drawRoundLabel();

    // Slash effect
    if (this.state.slashAlpha > 0) {
      this._drawSlash();
    }

    // Screen flash
    if (this.state.flashAlpha > 0) {
      ctx.save();
      ctx.globalAlpha = this.state.flashAlpha;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }

    // Combat log (bottom 2 lines)
    this._drawLog();

    // End screen
    if (this.state.result) {
      this._drawEndScreen();
    }
  }

  _drawSprite(who) {
    const ctx    = this.ctx;
    const W      = this.canvas.width;
    const H      = this.canvas.height;
    const img    = this.assets[who];
    if (!img) return;

    const isPlayer = (who === 'player');
    const powered  = isPlayer ? this.state.playerPowered : this.state.enemyPowered;
    const xOffset  = isPlayer ? this.state.playerX : this.state.enemyX;
    const sourceUrl = isPlayer ? this.opts.playerSrc : this.opts.enemySrc;
    const sheetRule = _sideviewSheetRule(sourceUrl);

    // Sprite dimensions â€” fit to ~35% height of canvas
    const sprH = H * 0.72;
    const refWidth = sheetRule ? sheetRule.frameWidth : img.width;
    const refHeight = sheetRule ? sheetRule.frameHeight : img.height;
    const sprW = (refWidth / refHeight) * sprH;

    const baseX = isPlayer
      ? W * 0.10  + xOffset
      : W * 0.90 - sprW + xOffset;
    const baseY = H * 0.94 - sprH;

    ctx.save();

    // Mirror enemy to face left
    if (!isPlayer) {
      ctx.translate(baseX + sprW, baseY);
      ctx.scale(-1, 1);
      ctx.translate(-baseX, -baseY);
    }

    // Power-up glow
    if (powered) {
      ctx.shadowColor  = isPlayer ? '#ffd700' : '#ff4444';
      ctx.shadowBlur   = 28;
    }

    if (sheetRule) {
      const frame = _sideviewFrameRect(sheetRule);
      ctx.drawImage(img, frame.sx, frame.sy, frame.sw, frame.sh, baseX, baseY, sprW, sprH);
    } else {
      ctx.drawImage(img, baseX, baseY, sprW, sprH);
    }
    ctx.restore();
  }

  _drawHpBar(x, y, w, name, hp, maxHp, color, powered, rightAlign = false) {
    const ctx  = this.ctx;
    const barH = 14;
    const pct  = Math.max(0, hp / maxHp);

    ctx.save();
    // Name
    ctx.font         = 'bold 11px monospace';
    ctx.fillStyle    = '#e2e8f0';
    ctx.shadowColor  = '#000';
    ctx.shadowBlur   = 3;
    ctx.textAlign    = rightAlign ? 'right' : 'left';
    ctx.fillText(`${name}${powered ? ' âš¡' : ''}`, rightAlign ? x + w : x, y + 11);

    // Bar bg
    ctx.shadowBlur   = 0;
    ctx.fillStyle    = 'rgba(0,0,0,0.5)';
    ctx.fillRect(x, y + 15, w, barH);

    // Bar fill
    const fillColor = pct > 0.5 ? color : pct > 0.25 ? '#facc15' : '#ef4444';
    ctx.fillStyle   = fillColor;
    ctx.fillRect(x, y + 15, w * pct, barH);

    // Powered glow
    if (powered) {
      ctx.strokeStyle = '#ffd700';
      ctx.lineWidth   = 2;
      ctx.shadowColor = '#ffd700';
      ctx.shadowBlur  = 8;
      ctx.strokeRect(x, y + 15, w, barH);
    }

    // HP text
    ctx.shadowBlur  = 0;
    ctx.font        = '10px monospace';
    ctx.fillStyle   = '#fff';
    ctx.textAlign   = rightAlign ? 'right' : 'left';
    ctx.fillText(`${Math.max(0, Math.round(hp))} / ${Math.round(maxHp)}`, rightAlign ? x + w : x, y + 38);

    ctx.restore();
  }

  _drawRoundLabel() {
    const ctx = this.ctx;
    const W   = this.canvas.width;
    ctx.save();
    ctx.font        = 'bold 14px monospace';
    ctx.fillStyle   = 'rgba(255,255,255,0.7)';
    ctx.textAlign   = 'center';
    ctx.shadowColor = '#000';
    ctx.shadowBlur  = 6;
    ctx.fillText(
      this.state.phase === 'idle' && this.state.round > 0
        ? `â€” ROUND ${this.state.round} â€”`
        : this.state.phase === 'player_powerup' ? 'âš¡ POWER UP âš¡'
        : this.state.phase === 'enemy_powerup'  ? 'âš ï¸ ENEMY SURGE âš ï¸'
        : this.state.phase !== 'idle'           ? 'âš”ï¸  ACTION âš”ï¸'
        : 'PRESS [SPACE] TO FIGHT',
      W / 2, 26
    );
    ctx.restore();
  }

  _drawSlash() {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = this.state.slashAlpha;
    ctx.strokeStyle = '#fff9c4';
    ctx.lineWidth   = 4;
    ctx.shadowColor = '#ffd700';
    ctx.shadowBlur  = 12;
    const cx = this.state.slashX;
    const cy = this.state.slashY;
    ctx.beginPath();
    ctx.moveTo(cx - 30, cy - 40);
    ctx.lineTo(cx + 30, cy + 40);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx + 15, cy - 40);
    ctx.lineTo(cx - 15, cy + 40);
    ctx.stroke();
    ctx.restore();
  }

  _drawLog() {
    const ctx  = this.ctx;
    const W    = this.canvas.width;
    const H    = this.canvas.height;
    const logs = this.state.log.slice(-2);
    ctx.save();
    ctx.font      = '11px monospace';
    ctx.textAlign = 'center';
    logs.forEach((line, i) => {
      const y = H - 18 + (i - logs.length + 1) * 16;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      const tw = ctx.measureText(line).width;
      ctx.fillRect(W/2 - tw/2 - 6, y - 11, tw + 12, 14);
      ctx.fillStyle = '#e2e8f0';
      ctx.shadowColor = '#000';
      ctx.shadowBlur  = 2;
      ctx.fillText(line, W/2, y);
    });
    ctx.restore();
  }

  _drawEndScreen() {
    const ctx = this.ctx;
    const W   = this.canvas.width;
    const H   = this.canvas.height;
    const win = this.state.result === 'player_win';
    ctx.save();
    ctx.fillStyle = win ? 'rgba(167,139,250,0.25)' : 'rgba(239,68,68,0.25)';
    ctx.fillRect(0, 0, W, H);
    ctx.font        = 'bold 38px serif';
    ctx.textAlign   = 'center';
    ctx.fillStyle   = win ? '#ffd700' : '#f87171';
    ctx.shadowColor = '#000';
    ctx.shadowBlur  = 18;
    ctx.fillText(win ? 'VICTORY!' : 'DEFEATED', W/2, H/2 - 10);
    ctx.font      = '15px monospace';
    ctx.fillStyle = '#e2e8f0';
    ctx.shadowBlur = 4;
    ctx.fillText(win ? 'The hero triumphs!' : 'The darkness wins...', W/2, H/2 + 22);
    ctx.restore();
  }

  // â”€â”€ Combat Logic â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  _runRound() {
    const s = this.state;
    if (s.result) return;

    // Player attacks first
    const playerDmg = this._rollDamage(12, 22, s.playerPowered);
    const enemyDmg  = this._rollDamage(8,  18, s.enemyPowered);

    this._addLog(`âš”ï¸  ${this.opts.playerName} attacks for ${playerDmg} dmg!`);

    // Animate: player lunge â†’ slash â†’ enemy recoil
    this._animateLunge('player', () => {
      this._showSlash(this.canvas.width * 0.62, this.canvas.height * 0.5);
      s.enemyHp = Math.max(0, s.enemyHp - playerDmg);
      this._flashScreen(0.3);
      this._draw();

      // Check enemy powering up at 50% HP (happens once)
      if (s.enemyHp <= s.enemyMaxHp * 0.5 && !s.enemyPowered && s.round >= 2) {
        setTimeout(() => {
          this.triggerPowerUp('enemy', 2);
          setTimeout(() => this._enemyCounterAttack(enemyDmg), 3000);
        }, 800);
      } else {
        setTimeout(() => this._enemyCounterAttack(enemyDmg), 900);
      }
    });
  }

  _enemyCounterAttack(dmg) {
    const s = this.state;
    if (s.enemyHp <= 0) {
      s.result = 'player_win';
      this._addLog(`ðŸ’€ ${this.opts.enemyName} is defeated!`);
      this._draw();
      if (this.opts.onCombatEnd) this.opts.onCombatEnd('player_win');
      return;
    }

    this._addLog(`âš”ï¸ ${this.opts.enemyName} retaliates for ${dmg} dmg!`);
    this._animateLunge('enemy', () => {
      this._showSlash(this.canvas.width * 0.30, this.canvas.height * 0.5);
      s.playerHp = Math.max(0, s.playerHp - dmg);
      this._flashScreen(0.25);
      this._draw();

      setTimeout(() => {
        if (s.playerHp <= 0) {
          s.result = 'enemy_win';
          this._addLog(`ðŸ’€ ${this.opts.playerName} falls!`);
          this._draw();
          if (this.opts.onCombatEnd) this.opts.onCombatEnd('enemy_win');
          return;
        }
        s.phase = 'idle';
        this._draw();

        // Power-up player at low HP (once)
        if (s.playerHp <= s.playerMaxHp * 0.3 && !s.playerPowered) {
          setTimeout(() => {
            this.triggerPowerUp('player', 3);
            // Heal player slightly and boost
            setTimeout(() => {
              s.playerHp = Math.min(s.playerMaxHp, s.playerHp + 25);
              s.phase = 'idle';
              this._draw();
            }, 2800);
          }, 500);
        }

        if (this.opts.autoPlay) {
          setTimeout(() => this.startRound(), this.opts.autoPlayDelay);
        }
      }, 800);
    });
  }

  _rollDamage(min, max, powered) {
    const base = min + Math.floor(Math.random() * (max - min + 1));
    return powered ? Math.floor(base * 1.6) : base;
  }

  _addLog(msg) {
    this.state.log.push(msg);
    if (this.state.log.length > 6) this.state.log.shift();
  }

  // â”€â”€ Animations (rAF-driven) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  _animateLunge(who, onHit) {
    const s       = this.state;
    const isPlayer = (who === 'player');
    s.phase = isPlayer ? 'player_atk' : 'enemy_atk';

    const target  = isPlayer ? 60 : -60;
    const key     = isPlayer ? 'playerX' : 'enemyX';
    let progress  = 0;
    const step    = () => {
      progress += 0.12;
      if (progress < 1) {
        // ease-out lunge
        const t   = 1 - Math.pow(1 - progress, 3);
        s[key]    = t * target;
        this._draw();
        requestAnimationFrame(step);
      } else {
        s[key] = target;
        this._draw();
        if (onHit) onHit();
        // Recoil back
        setTimeout(() => {
          let rp = 0;
          const recoil = () => {
            rp += 0.1;
            if (rp < 1) {
              s[key] = target * (1 - rp);
              this._draw();
              requestAnimationFrame(recoil);
            } else {
              s[key] = 0;
              this._draw();
            }
          };
          requestAnimationFrame(recoil);
        }, 180);
      }
    };
    requestAnimationFrame(step);
  }

  _showSlash(x, y) {
    const s   = this.state;
    s.slashX  = x;
    s.slashY  = y;
    s.slashAlpha = 1;
    let f = 0;
    const fade = () => {
      f += 0.08;
      s.slashAlpha = Math.max(0, 1 - f * 1.5);
      this._draw();
      if (s.slashAlpha > 0) requestAnimationFrame(fade);
    };
    requestAnimationFrame(fade);
  }

  _flashScreen(strength) {
    const s = this.state;
    s.flashAlpha = strength;
    let f = 0;
    const fade = () => {
      f += 0.12;
      s.flashAlpha = Math.max(0, strength - f);
      this._draw();
      if (s.flashAlpha > 0) requestAnimationFrame(fade);
    };
    requestAnimationFrame(fade);
  }

  _loadImage(src) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload  = () => res(img);
      img.onerror = () => { console.warn('Img load failed:', src); res(null); };
      img.src     = src;
    });
  }

  // â”€â”€ Spritesheet support â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  /**
   * Load spritesheets for player and/or enemy.
   * Call after load(). Replaces static sprite with animated sheet.
   * opts: { playerSheet, playerMeta, enemySheet, enemyMeta }
   * meta: { frame_w, frame_h, rows: [{row, action, frames}] }
   */
  async loadSpritesheets(opts = {}) {
    if (opts.playerSheet) {
      this.assets.playerSheet = await this._loadImage(opts.playerSheet);
      this.assets.playerMeta  = opts.playerMeta;
      this._buildRowMap('player', opts.playerMeta);
    }
    if (opts.enemySheet) {
      this.assets.enemySheet = await this._loadImage(opts.enemySheet);
      this.assets.enemyMeta  = opts.enemyMeta;
      this._buildRowMap('enemy', opts.enemyMeta);
    }
    // Start animation loop
    this._animFrame  = { player: 0, enemy: 0 };
    this._animAction = { player: 'idle', enemy: 'idle' };
    this._animTick   = { player: 0, enemy: 0 };
    this._animFPS    = 8;
    this._animActive = true;
    this._tickAnim();
  }

  _buildRowMap(who, meta) {
    if (!meta || !meta.rows) return;
    const map = {};
    for (const r of meta.rows) map[r.action] = r;
    this.assets[who + 'RowMap'] = map;
  }

  _tickAnim() {
    if (!this._animActive) return;
    const FPS = this._animFPS;
    for (const who of ['player', 'enemy']) {
      const map = this.assets[who + 'RowMap'];
      if (!map) continue;
      const action = this._animAction[who] || 'idle';
      const row    = map[action] || map['idle'];
      if (!row) continue;
      this._animTick[who] = (this._animTick[who] || 0) + 1;
      if (this._animTick[who] >= Math.round(60 / FPS)) {
        this._animTick[who] = 0;
        this._animFrame[who] = ((this._animFrame[who] || 0) + 1) % row.frames;
      }
    }
    this._draw();
    requestAnimationFrame(() => this._tickAnim());
  }

  setAction(who, action) {
    if (!this._animAction) this._animAction = { player: 'idle', enemy: 'idle' };
    this._animAction[who] = action;
    this._animFrame[who]  = 0;
    this._animTick[who]   = 0;
  }

  _drawSpriteFromSheet(who, baseX, baseY, sprW, sprH, powered, mirror) {
    const ctx    = this.ctx;
    const sheet  = this.assets[who + 'Sheet'];
    const meta   = this.assets[who + 'Meta'];
    const rowMap = this.assets[who + 'RowMap'];
    if (!sheet || !meta || !rowMap) return false;

    const action  = (this._animAction && this._animAction[who]) || 'idle';
    const rowData = rowMap[action] || rowMap['idle'];
    if (!rowData) return false;

    const fw = meta.frame_w;
    const fh = meta.frame_h;
    const fi = Math.min((this._animFrame && this._animFrame[who]) || 0, rowData.frames - 1);
    const sx = fi * fw;
    const sy = rowData.row * fh;

    ctx.save();
    if (powered) {
      ctx.shadowColor = who === 'player' ? '#ffd700' : '#ff4444';
      ctx.shadowBlur  = 28;
    }
    if (mirror) {
      ctx.translate(baseX + sprW, baseY);
      ctx.scale(-1, 1);
      ctx.drawImage(sheet, sx, sy, fw, fh, 0, 0, sprW, sprH);
    } else {
      ctx.drawImage(sheet, sx, sy, fw, fh, baseX, baseY, sprW, sprH);
    }
    ctx.restore();
    return true;
  }

  // Override _drawSprite to try sheet first, fall back to static
  _drawSpriteOverride(who) {
    const ctx    = this.ctx;
    const W      = this.canvas.width;
    const H      = this.canvas.height;
    const isPlayer = who === 'player';
    const powered  = isPlayer ? this.state.playerPowered : this.state.enemyPowered;
    const xOffset  = isPlayer ? this.state.playerX : this.state.enemyX;

    const sprH = H * 0.72;
    const refImg = this.assets[who + 'Sheet'] || this.assets[who];
    if (!refImg) return;
    const fw = this.assets[who + 'Meta']?.frame_w || refImg.width;
    const fh = this.assets[who + 'Meta']?.frame_h || refImg.height;
    const sprW = (fw / fh) * sprH;

    const baseX = isPlayer
      ? W * 0.10 + xOffset
      : W * 0.90 - sprW + xOffset;
    const baseY = H * 0.94 - sprH;

    const mirror = !isPlayer;
    const usedSheet = this._drawSpriteFromSheet(who, baseX, baseY, sprW, sprH, powered, mirror);
    if (!usedSheet) {
      // Fall back to original static sprite
      const img = this.assets[who];
      if (!img) return;
      ctx.save();
      if (!isPlayer) {
        ctx.translate(baseX + sprW, baseY);
        ctx.scale(-1, 1);
        ctx.translate(-baseX, -baseY);
      }
      if (powered) { ctx.shadowColor = isPlayer ? '#ffd700' : '#ff4444'; ctx.shadowBlur = 28; }
      ctx.drawImage(img, baseX, baseY, sprW, sprH);
      ctx.restore();
    }
  }

  // â”€â”€ Climax kill sequence â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  /**
   * triggerClimaxKill(): Epic 3-second kill sequence for the demo climax.
   * 1. Player action â†’ 'attack', slow-mo zoom begins
   * 2. Camera shake (subtle)
   * 3. Slow-motion impact flash
   * 4. Enemy action â†’ 'death', HP drops to 0
   * 5. Ring glow on player
   * 6. Silence beat (freeze frame 0.5s)
   * 7. onCombatEnd called with player_win
   */
  triggerClimaxKill(onComplete) {
    const s   = this.state;
    const ctx = this.ctx;
    const W   = this.canvas.width;
    const H   = this.canvas.height;

    // Phase 1: player charges (200ms lunge)
    this.setAction('player', 'attack');
    this._animatePlayerLunge(W * 0.25, 200, () => {
      // Phase 2: impact flash + screen shake
      this._screenShake(8, 350);
      this._flashScreen(0.9);

      // Phase 3: enemy hit â†’ death
      setTimeout(() => {
        this.setAction('enemy', 'death');
        s.enemyHp = 0;
        this._draw();

        // Phase 4: slow ring glow on player
        setTimeout(() => {
          s.playerPowered = true;
          this._draw();

          // Phase 5: freeze 600ms, then resolve
          setTimeout(() => {
            s.result = 'player_win';
            s.phase  = 'end';
            if (s.playerHp > 0) {
              this._addLog(`âš” ${this.opts.playerName} drives the blade through â€” the hunt is over.`);
            }
            this._draw();
            this._animActive = false;
            if (onComplete) onComplete('player_win');
            if (this.opts.onCombatEnd) this.opts.onCombatEnd('player_win');
          }, 600);
        }, 400);
      }, 320);
    });
  }

  _animatePlayerLunge(distance, duration, callback) {
    const start = performance.now();
    const step = (now) => {
      const t = Math.min((now - start) / duration, 1);
      const ease = t < 0.5 ? 2*t*t : -1+(4-2*t)*t;
      // Lunge forward then partial return
      this.state.playerX = distance * Math.sin(ease * Math.PI);
      this._draw();
      if (t < 1) requestAnimationFrame(step);
      else { this.state.playerX = 0; if (callback) callback(); }
    };
    requestAnimationFrame(step);
  }

  _screenShake(magnitude, duration) {
    const canvas = this.canvas;
    const origTransform = canvas.style.transform;
    const start = performance.now();
    const shake = (now) => {
      const t = (now - start) / duration;
      if (t >= 1) { canvas.style.transform = origTransform; return; }
      const decay = 1 - t;
      const dx = (Math.random() - 0.5) * 2 * magnitude * decay;
      const dy = (Math.random() - 0.5) * 2 * magnitude * decay;
      canvas.style.transform = `translate(${dx}px, ${dy}px)`;
      requestAnimationFrame(shake);
    };
    requestAnimationFrame(shake);
  }
}

if (typeof module !== 'undefined') module.exports = { SideViewCombat };
if (typeof window !== 'undefined') window.SideViewCombat = SideViewCombat;

