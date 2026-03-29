'use strict';
/**
 * powerup-system.js
 * Universal power-up / aura system â€” works for any player char or NPC element.
 * 
 * Usage:
 *   window.TenRings.powerUp(entityEl, { tier: 2, color: 'gold' })
 *   window.TenRings.powerUp('#player-sprite', { tier: 3 })
 */

(function (root) {
  const AURA_IMG = './static/img/fx/fx_powerup_aura_alpha.png';

  const TIER_CONFIG = {
    1: { // Ring 1 â€” simple shimmer, brief white flash
      duration:   1800,
      pulses:     2,
      flashColor: '#ffffff',
      auraColor:  '#ffffffcc',
      ringCount:  1,
      particleCount: 0,
      screenFlash: false,
      sound: null,
    },
    2: { // Ring 2 â€” golden aura rings, particles, soft screen edge glow
      duration:   3200,
      pulses:     4,
      flashColor: '#ffd700',
      auraColor:  '#ffd700cc',
      ringCount:  3,
      particleCount: 20,
      screenFlash: true,
      screenFlashColor: 'rgba(255,215,0,0.15)',
      sound: null,
    },
    3: { // Ring 3+ â€” full Saiyan-tier: sustained aura, arcs, color shift, intense
      duration:   5500,
      pulses:     8,
      flashColor: '#fff9c4',
      auraColor:  '#ffe066ee',
      ringCount:  6,
      particleCount: 60,
      screenFlash: true,
      screenFlashColor: 'rgba(255,230,100,0.3)',
      sound: null,
    },
  };

  const COLOR_PRESETS = {
    gold:   ['#ffd700', '#fff176', '#ffe066'],
    blue:   ['#60a5fa', '#93c5fd', '#bfdbfe'],
    red:    ['#f87171', '#fca5a5', '#ef4444'],
    purple: ['#a78bfa', '#c4b5fd', '#7c3aed'],
    white:  ['#ffffff', '#f1f5f9', '#e2e8f0'],
    dark:   ['#1e1b4b', '#312e81', '#4c1d95'],
  };

  function resolveEl(target) {
    if (typeof target === 'string') return document.querySelector(target);
    return target;
  }

  function getColors(color) {
    return COLOR_PRESETS[color] || COLOR_PRESETS['gold'];
  }

  function createRing(x, y, radius, color, opacity) {
    const ring = document.createElement('div');
    ring.style.cssText = `
      position: fixed;
      pointer-events: none;
      border-radius: 50%;
      border: 3px solid ${color};
      opacity: ${opacity};
      transform: translate(-50%, -50%) scale(0.1);
      transition: transform 1.2s cubic-bezier(0.2, 0.8, 0.4, 1), opacity 1.2s ease-out;
      z-index: 9999;
      left: ${x}px;
      top: ${y}px;
      width: ${radius * 2}px;
      height: ${radius * 2}px;
    `;
    return ring;
  }

  function createParticle(x, y, colors) {
    const p = document.createElement('div');
    const size = 4 + Math.random() * 8;
    const angle = Math.random() * Math.PI * 2;
    const dist  = 60 + Math.random() * 140;
    const dx = Math.cos(angle) * dist;
    const dy = Math.sin(angle) * dist;
    const color = colors[Math.floor(Math.random() * colors.length)];
    const dur = 0.8 + Math.random() * 0.8;
    p.style.cssText = `
      position: fixed;
      pointer-events: none;
      z-index: 9999;
      left: ${x}px;
      top: ${y}px;
      width: ${size}px;
      height: ${size}px;
      border-radius: 50%;
      background: ${color};
      box-shadow: 0 0 ${size * 2}px ${color};
      transform: translate(-50%, -50%) translate(0px, 0px);
      opacity: 1;
      transition: transform ${dur}s ease-out, opacity ${dur}s ease-out;
    `;
    setTimeout(() => {
      p.style.transform = `translate(-50%, -50%) translate(${dx}px, ${dy}px)`;
      p.style.opacity = '0';
    }, 20);
    return p;
  }

  function createAuraOverlay(x, y, size, colors) {
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: fixed;
      pointer-events: none;
      z-index: 9998;
      left: ${x}px;
      top: ${y}px;
      width: ${size}px;
      height: ${size * 1.5}px;
      transform: translate(-50%, -50%);
      background: radial-gradient(ellipse at 50% 60%, ${colors[0]}44 0%, ${colors[1]}22 40%, transparent 70%);
      animation: tenrings-aura-pulse 0.4s ease-in-out infinite alternate;
      border-radius: 50%;
    `;
    return overlay;
  }

  function createScreenFlash(color) {
    const flash = document.createElement('div');
    flash.style.cssText = `
      position: fixed;
      inset: 0;
      pointer-events: none;
      z-index: 9997;
      background: radial-gradient(ellipse at 50% 50%, ${color} 0%, transparent 70%);
      opacity: 0;
      transition: opacity 0.15s ease-in;
    `;
    return flash;
  }

  // Inject keyframes once
  function ensureStyles() {
    if (document.getElementById('tenrings-powerup-styles')) return;
    const style = document.createElement('style');
    style.id = 'tenrings-powerup-styles';
    style.textContent = `
      @keyframes tenrings-aura-pulse {
        0%   { transform: translate(-50%, -50%) scale(0.92); opacity: 0.7; }
        100% { transform: translate(-50%, -50%) scale(1.08); opacity: 1.0; }
      }
      @keyframes tenrings-entity-bounce {
        0%   { transform: translateY(0) scale(1); }
        15%  { transform: translateY(-12px) scale(1.06); }
        30%  { transform: translateY(0) scale(0.96); }
        45%  { transform: translateY(-8px) scale(1.04); }
        60%  { transform: translateY(0) scale(0.98); }
        75%  { transform: translateY(-4px) scale(1.02); }
        100% { transform: translateY(0) scale(1); }
      }
      .tenrings-powering-up {
        animation: tenrings-entity-bounce 0.6s ease-in-out !important;
        filter: brightness(2) saturate(1.5) !important;
        transition: filter 0.2s ease !important;
      }
      .tenrings-powered-up {
        filter: brightness(1.3) saturate(1.2) !important;
        transition: filter 1s ease !important;
      }
    `;
    document.head.appendChild(style);
  }

  /**
   * triggerPowerUp(target, options)
   * @param {Element|string} target - DOM element or CSS selector
   * @param {object} opts
   *   - tier: 1|2|3 (defaults to 2)
   *   - color: 'gold'|'blue'|'red'|'purple'|'white'|'dark'
   *   - duration_ms: override duration
   *   - onComplete: callback
   */
  function triggerPowerUp(target, opts = {}) {
    ensureStyles();
    const el = resolveEl(target);
    if (!el) { console.warn('[PowerUp] Element not found:', target); return; }

    const tier    = opts.tier || 2;
    const cfg     = TIER_CONFIG[Math.min(Math.max(tier, 1), 3)];
    const colors  = getColors(opts.color || 'gold');
    const dur     = opts.duration_ms || cfg.duration;

    // Get element center in viewport
    const rect    = el.getBoundingClientRect();
    const cx      = rect.left + rect.width  / 2;
    const cy      = rect.top  + rect.height / 2;
    const baseR   = Math.max(rect.width, rect.height) * 0.8;

    const toClean = [];

    // Screen flash
    if (cfg.screenFlash) {
      const flash = createScreenFlash(cfg.screenFlashColor);
      document.body.appendChild(flash);
      toClean.push(flash);
      setTimeout(() => { flash.style.opacity = '1'; }, 50);
      setTimeout(() => { flash.style.opacity = '0'; }, 300);
    }

    // Aura overlay behind entity
    const aura = createAuraOverlay(cx, cy, baseR * 3, colors);
    document.body.appendChild(aura);
    toClean.push(aura);

    // Expanding rings
    for (let i = 0; i < cfg.ringCount; i++) {
      setTimeout(() => {
        const ring = createRing(cx, cy, baseR * (1 + i * 0.5), colors[i % colors.length], 0.8);
        document.body.appendChild(ring);
        toClean.push(ring);
        setTimeout(() => {
          ring.style.transform = `translate(-50%, -50%) scale(${2 + i * 0.6})`;
          ring.style.opacity   = '0';
        }, 50);
        setTimeout(() => { if (ring.parentNode) ring.parentNode.removeChild(ring); }, 1400);
      }, i * (dur / (cfg.ringCount * 2)));
    }

    // Particles
    for (let i = 0; i < cfg.particleCount; i++) {
      setTimeout(() => {
        const p = createParticle(cx, cy, colors);
        document.body.appendChild(p);
        toClean.push(p);
        setTimeout(() => { if (p.parentNode) p.parentNode.removeChild(p); }, 1800);
      }, Math.random() * (dur * 0.4));
    }

    // Entity animation
    el.classList.add('tenrings-powering-up');
    setTimeout(() => {
      el.classList.remove('tenrings-powering-up');
      el.classList.add('tenrings-powered-up');
    }, 600);

    // Sustained pulse for tier 3
    let pulseInterval = null;
    if (tier >= 3) {
      let pulseCount = 0;
      pulseInterval = setInterval(() => {
        pulseCount++;
        if (pulseCount >= cfg.pulses) { clearInterval(pulseInterval); return; }
        const ring = createRing(cx, cy, baseR, colors[0], 0.5);
        document.body.appendChild(ring);
        setTimeout(() => {
          ring.style.transform = `translate(-50%, -50%) scale(3)`;
          ring.style.opacity   = '0';
        }, 50);
        setTimeout(() => { if (ring.parentNode) ring.parentNode.removeChild(ring); }, 1200);
      }, dur / cfg.pulses);
    }

    // Cleanup
    setTimeout(() => {
      if (pulseInterval) clearInterval(pulseInterval);
      el.classList.remove('tenrings-powered-up');
      toClean.forEach(e => { if (e.parentNode) e.parentNode.removeChild(e); });
      if (opts.onComplete) opts.onComplete(el);
    }, dur);
  }

  // â”€â”€ Public namespace â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  root.TenRings = root.TenRings || {};
  root.TenRings.powerUp = triggerPowerUp;
  root.TenRings.POWER_UP_TIERS = TIER_CONFIG;

  if (typeof module !== 'undefined') module.exports = { triggerPowerUp };

})(typeof window !== 'undefined' ? window : global);

