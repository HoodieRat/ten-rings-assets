/**
 * graphical-assets.js
 * Dynamic asset wiring for TEN RINGS graphical conversion.
 * standard_rpg template - Portrait and NPC asset injection.
 *
 * This module:
 * 1. Detects the active world template from game state
 * 2. Sets body[data-world-template] for CSS targeting
 * 3. Injects portrait images into race selection tiles
 * 4. Wires portrait images into character identity cards
 * 5. Sets shopkeeper NPC type for CSS sprite positioning
 * 6. Handles template changes on world transition
 *
 * RULES: Does NOT modify existing game logic. Purely visual layer.
 */

(function () {
  "use strict";

  // ============================================================
  // ASSET MAP — race code -> portrait file
  // ============================================================
  const PORTRAIT_MAP = {
    human:    "/static/img/tiles/standard_rpg/portrait_human.png",
    dwarf:    "/static/img/tiles/standard_rpg/portrait_dwarf.png",
    elf:      "/static/img/tiles/standard_rpg/portrait_elf.png",
    orc:      "/static/img/tiles/standard_rpg/portrait_orc.png",
    tiefling: "/static/img/tiles/standard_rpg/portrait_rogue.png", // closest match
    halfling: "/static/img/tiles/standard_rpg/portrait_rogue.png", // nimble/rogue energy
    gnome:    "/static/img/tiles/standard_rpg/portrait_mage.png",  // inventive/arcane
  };

  // Hybrid portraits — dedicated image for each combination
  const HYBRID_PORTRAIT_MAP = {
    "dwarf-elf":        "/static/img/tiles/standard_rpg/hybrid_dwarf-elf.png",
    "dwarf-human":      "/static/img/tiles/standard_rpg/hybrid_dwarf-human.png",
    "elf-human":        "/static/img/tiles/standard_rpg/hybrid_elf-human.png",
    "human-orc":        "/static/img/tiles/standard_rpg/hybrid_human-orc.png",
    "elf-orc":          "/static/img/tiles/standard_rpg/hybrid_elf-orc.png",
    "halfling-human":   "/static/img/tiles/standard_rpg/hybrid_halfling-human.png",
    "dwarf-halfling":   "/static/img/tiles/standard_rpg/hybrid_dwarf-halfling.png",
    "halfling-orc":     "/static/img/tiles/standard_rpg/hybrid_halfling-orc.png",
    "gnome-human":      "/static/img/tiles/standard_rpg/hybrid_gnome-human.png",
    "elf-gnome":        "/static/img/tiles/standard_rpg/hybrid_elf-gnome.png",
    "dwarf-gnome":      "/static/img/tiles/standard_rpg/hybrid_dwarf-gnome.png",
    "gnome-halfling":   "/static/img/tiles/standard_rpg/hybrid_gnome-halfling.png",
    "gnome-orc":        "/static/img/tiles/standard_rpg/hybrid_gnome-orc.png",
    "elf-halfling":     "/static/img/tiles/standard_rpg/hybrid_elf-halfling.png",
    "elf-tiefling":     "/static/img/tiles/standard_rpg/hybrid_elf-tiefling.png",
    "human-tiefling":   "/static/img/tiles/standard_rpg/hybrid_human-tiefling.png",
    "dwarf-tiefling":   "/static/img/tiles/standard_rpg/hybrid_dwarf-tiefling.png",
    "halfling-tiefling":"/static/img/tiles/standard_rpg/hybrid_halfling-tiefling.png",
    "gnome-tiefling":   "/static/img/tiles/standard_rpg/hybrid_gnome-tiefling.png",
    "orc-tiefling":     "/static/img/tiles/standard_rpg/hybrid_orc-tiefling.png",
    "dwarf-orc":        "/static/img/tiles/standard_rpg/hybrid_dwarf-orc.png",
  };

  function getPortraitForCode(code) {
    if (!code) return null;
    const clean = code.toLowerCase().trim();
    // Dedicated hybrid portrait first
    if (HYBRID_PORTRAIT_MAP[clean]) return HYBRID_PORTRAIT_MAP[clean];
    // Base race portrait
    if (PORTRAIT_MAP[clean]) return PORTRAIT_MAP[clean];
    // Hybrid fallback: normalise order and try again (e.g. "orc-elf" -> "elf-orc")
    if (clean.includes("-")) {
      const parts = clean.split("-").sort();
      const normalised = parts.join("-");
      if (HYBRID_PORTRAIT_MAP[normalised]) return HYBRID_PORTRAIT_MAP[normalised];
      // Last resort: first parent base portrait
      return PORTRAIT_MAP[parts[0]] || null;
    }
    return null;
  }

  // ============================================================
  // TEMPLATE DETECTION
  // Reads from lastGameState (injected by main.js globally)
  // Falls back to world-framing-select dropdown during creation
  // ============================================================
  function detectActiveTemplate() {
    // In-game: read from game state (world_template is the confirmed field name in payload)
    if (window.lastGameState) {
      const tmpl = window.lastGameState?.world_template
        || window.lastGameState?.world?.framing?.template
        || window.lastGameState?.framing?.template
        || null;
      if (tmpl) return tmpl;
    }
    // During creation: read from dropdown
    const sel = document.getElementById("world-framing-select");
    if (sel && sel.value) return sel.value;
    return null;
  }

  function applyTemplateToBody(template) {
    if (!template) return;
    document.body.setAttribute("data-world-template", template);
  }

  // ============================================================
  // RACE TILE PORTRAITS
  // Injects portrait background layer into each race checkbox label
  // ============================================================
  function injectRacePortraits() {
    const racesEl = document.getElementById("hero-races");
    if (!racesEl) return;

    const labels = racesEl.querySelectorAll("label");
    labels.forEach((label) => {
      const input = label.querySelector("input[type='checkbox']");
      if (!input) return;
      const raceCode = input.dataset.race;
      if (!raceCode) return;

      // Only inject once
      if (label.querySelector(".race-portrait-bg")) return;

      const portrait = getPortraitForCode(raceCode);
      if (!portrait) return;

      const bg = document.createElement("div");
      bg.className = "race-portrait-bg";
      bg.style.backgroundImage = `url(${portrait})`;
      bg.setAttribute("aria-hidden", "true");
      label.insertBefore(bg, label.firstChild);

      // Sync selected state for CSS
      input.addEventListener("change", () => {
        label.classList.toggle("race-selected", input.checked);
      });
      // Sync on load if already checked
      if (input.checked) label.classList.add("race-selected");
    });
  }

  // ============================================================
  // RACE IDENTITY CARDS (in-game character sheet / party panel)
  // Adds a portrait img at the top of each identity card
  // ============================================================
  function enhanceRaceIdentityCards() {
    const cards = document.querySelectorAll(
      ".race-identity-card:not(.portrait-enhanced)"
    );
    cards.forEach((card) => {
      card.classList.add("portrait-enhanced");

      // Extract race code from the card's name element
      const nameEl = card.querySelector(".race-identity-name, .identity-name");
      if (!nameEl) return;
      const displayName = nameEl.textContent.trim().toLowerCase();

      // Try to match display name to a code
      const matchedCode = Object.keys(PORTRAIT_MAP).find((k) =>
        displayName.includes(k)
      );
      if (!matchedCode) return;

      const portrait = PORTRAIT_MAP[matchedCode];
      if (!portrait) return;

      const img = document.createElement("img");
      img.src = portrait;
      img.alt = `${nameEl.textContent} portrait`;
      img.className = "race-portrait-img";
      img.loading = "lazy";

      card.classList.add("with-portrait");
      card.insertBefore(img, card.firstChild);
    });
  }

  // ============================================================
  // SHOPKEEPER NPC TYPE DETECTION
  // Sets data-shop-type on .shopkeeper-portrait based on shop name
  // ============================================================
  function tagShopkeeperPortrait() {
    const portraits = document.querySelectorAll(".shopkeeper-portrait");
    portraits.forEach((el) => {
      if (el.dataset.shopType) return; // already tagged

      // Walk up to find shop name context
      const container = el.closest(".card, .shop-panel, [aria-label]");
      const nameEl = container
        ? container.querySelector(
            "#shopkeeper-role, .shopkeeper-role, .shopkeeper-name, #shopkeeper-name"
          )
        : null;
      const name = (nameEl?.textContent || "").toLowerCase();

      let shopType = "general";
      if (name.includes("black") || name.includes("smith") || name.includes("forge")) {
        shopType = "blacksmith";
      } else if (
        name.includes("weapon") ||
        name.includes("sword") ||
        name.includes("armor") ||
        name.includes("arms")
      ) {
        shopType = "weapon";
      } else if (
        name.includes("apoth") ||
        name.includes("potion") ||
        name.includes("herb") ||
        name.includes("alch")
      ) {
        shopType = "apothecary";
      }

      el.setAttribute("data-shop-type", shopType);
    });
  }

  // ============================================================
  // MUTATION OBSERVER
  // Watches for DOM additions (race tiles, identity cards, shop panels)
  // and re-applies visual enhancements
  // ============================================================
  let enhanceTimer = null;
  function scheduleEnhance() {
    if (enhanceTimer) clearTimeout(enhanceTimer);
    enhanceTimer = setTimeout(() => {
      const tmpl = detectActiveTemplate();
      applyTemplateToBody(tmpl || "standard_rpg"); // default to standard_rpg
      injectRacePortraits();
      enhanceRaceIdentityCards();
      tagShopkeeperPortrait();
    }, 80);
  }

  const observer = new MutationObserver((mutations) => {
    const relevant = mutations.some((m) => {
      for (const node of m.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (
          node.classList?.contains("race-identity-card") ||
          node.id === "hero-races" ||
          node.querySelector?.("#hero-races, .race-identity-card, .shopkeeper-portrait")
        ) {
          return true;
        }
      }
      return false;
    });
    if (relevant) scheduleEnhance();
  });

  // ============================================================
  // WORLD FRAMING DROPDOWN — re-apply template on change
  // ============================================================
  function watchFramingDropdown() {
    const sel = document.getElementById("world-framing-select");
    if (!sel) return;
    sel.addEventListener("change", () => {
      const tmpl = sel.value;
      applyTemplateToBody(tmpl);
      // Re-inject race portraits in case template changes visual set
      injectRacePortraits();
    });
  }

  // ============================================================
  // GAME STATE WATCHER
  // Polls lastGameState for template changes (world transitions)
  // ============================================================
  let lastKnownTemplate = null;
  function watchGameState() {
    setInterval(() => {
      const tmpl = detectActiveTemplate();
      if (tmpl && tmpl !== lastKnownTemplate) {
        lastKnownTemplate = tmpl;
        applyTemplateToBody(tmpl);
      }
    }, 2000);
  }

  // ============================================================
  // INIT
  // ============================================================
  function init() {
    // Set default template immediately
    applyTemplateToBody("standard_rpg");

    // Start observing DOM
    observer.observe(document.body, { childList: true, subtree: true });

    // Watch framing dropdown
    watchFramingDropdown();

    // Watch game state for template transitions
    watchGameState();

    // Initial pass
    scheduleEnhance();

    console.log("[graphical-assets] standard_rpg visual layer loaded");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
