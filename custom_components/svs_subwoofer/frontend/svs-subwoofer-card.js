/**
 * SVS Subwoofer dashboard card and tile features.
 *
 * Tile features (they work in any tile card, and in the SVS card):
 * - custom:svs-subwoofer-presets  one button per preset, each in its own color
 * - custom:svs-subwoofer-volume   a volume slider, optionally colored by volume thresholds
 * - custom:svs-subwoofer-standby  the standby mode as a segmented control
 * Each finds its entity on the same device as the card's entity, so a card
 * for a subwoofer group controls the group, and a card for one subwoofer
 * controls that subwoofer.
 *
 * custom:svs-subwoofer-card is Home Assistant's tile card, wrapped: the tile card still
 * draws the name, state, actions and features. The SVS card adds a driver in
 * place of the icon (its size follows the volume, and it shakes when the
 * volume or preset changes), a Bluetooth badge when a subwoofer is not
 * connected, and an optional cabinet finish behind the card.
 *
 * Every corner, color and size comes from the theme's variables.
 */

const VERSION = "1.0.0";
const DOMAIN = "svs_subwoofer";
const CARD_TYPE = "svs-subwoofer-card";
const EDITOR_TYPE = "svs-subwoofer-card-editor";
const TILE_EDITOR_TYPE = "svs-subwoofer-tile-card-editor";

// The entities a feature or the card looks for on a device, by translation key
// (group entities first)
const ROLES = {
  preset: ["group_preset", "preset"],
  volume: ["group_volume", "volume"],
  standby: ["group_standby_mode", "standby_mode"],
  connected: ["connected"],
};
// States that are not presets: never shown as a preset button
const NOT_PRESETS = ["Manual", "Mixed"];

// Home Assistant's named colors (the tile card's color picker)
const HA_COLORS = [
  "primary", "accent", "red", "pink", "purple", "deep-purple", "indigo", "blue", "light-blue", "cyan",
  "teal", "green", "light-green", "lime", "yellow", "amber", "orange", "deep-orange", "brown",
  "light-grey", "grey", "dark-grey", "blue-grey", "black", "white", "disabled",
];
// Named colors light enough to need dark text on top
const LIGHT_COLORS = ["yellow", "amber", "lime", "light-green", "white", "light-grey"];
const cssColor = (color) => (HA_COLORS.includes(color) ? `var(--${color}-color)` : color);
const isLight = (color) => LIGHT_COLORS.includes(color) || /^#(f|e)/i.test(color || "");

// Defaults for the usual preset names; anything else uses the theme's feature color
function presetDefaults(name) {
  const n = name.toLowerCase();
  if (n.includes("low")) return { color: "green", icon: "mdi:volume-low" };
  if (n.includes("med")) return { color: "yellow", icon: "mdi:volume-medium" };
  if (n.includes("high")) return { color: "red", icon: "mdi:volume-high" };
  return {};
}

/** The entity with this role on the same device as entityId, or undefined. */
function sibling(hass, entityId, role) {
  const entities = hass?.entities;
  const device = entities?.[entityId]?.device_id;
  if (!device) return undefined;
  for (const key of ROLES[role]) {
    const found = Object.values(entities).find(
      (e) => e.device_id === device && e.platform === DOMAIN && e.translation_key === key,
    );
    if (found) return found.entity_id;
  }
  return undefined;
}

const isSvs = (hass, entityId) => hass?.entities?.[entityId]?.platform === DOMAIN;

/**
 * The subwoofer's preset, standby mode and volume, for the tile card's state
 * content. They are added as attributes of the card's entity (only for the
 * tile card inside this card), so "State content" can show them next to the
 * entity's own state. The card's own entity is left out.
 */
function subwooferAttributes(hass, entityId) {
  const extra = {};
  for (const [role, attribute] of [["preset", "preset"], ["standby", "standby_mode"], ["volume", "volume"]]) {
    const id = sibling(hass, entityId, role);
    const stateObj = id && id !== entityId ? hass.states[id] : undefined;
    if (!stateObj || unavailable(stateObj) || stateObj.state === "unknown") continue;
    const unit = stateObj.attributes.unit_of_measurement;
    extra[attribute] = unit ? `${stateObj.state} ${unit}` : stateObj.state;
  }
  return extra;
}

/** hass with the card's entity carrying the subwoofer attributes (and a picture). */
function withSubwooferAttributes(hass, entityId, picture) {
  const stateObj = hass?.states[entityId];
  if (!stateObj) return hass;
  const attributes = { ...stateObj.attributes, ...subwooferAttributes(hass, entityId) };
  if (picture) attributes.entity_picture = picture;
  return { ...hass, states: { ...hass.states, [entityId]: { ...stateObj, attributes } } };
}
const unavailable = (stateObj) => !stateObj || stateObj.state === "unavailable";

const fire = (el, type, detail) =>
  el.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));

// ---------------------------------------------------------------------------
// Shared feature styles: Home Assistant's feature variables, with a solid
// backing behind each control when the SVS card draws a finish
// ---------------------------------------------------------------------------
const FEATURE_CSS = `
  :host { display: block; }
  .control {
    position: relative; height: var(--feature-height, 42px);
    border-radius: var(--feature-border-radius, 12px); overflow: hidden;
    background: var(--svs-feature-backing, transparent);
  }
  .tint { position: absolute; inset: 0; background: var(--c, var(--feature-color)); opacity: .2; pointer-events: none; }
  [disabled], .disabled { opacity: .5; pointer-events: none; }
`;

// ---------------------------------------------------------------------------
// Feature: preset buttons
// ---------------------------------------------------------------------------
class SvsPresetButtons extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = `
      <style>${FEATURE_CSS}
        .row { display: flex; gap: var(--feature-button-spacing, 12px); height: var(--feature-height, 42px); }
        button {
          flex: 1 1 0; min-width: 0; height: 100%; padding: 0 4px; border: 0; cursor: pointer;
          position: relative; overflow: hidden; display: grid; place-items: center;
          border-radius: var(--feature-border-radius, 12px);
          background: var(--svs-feature-backing, transparent);
          color: var(--primary-text-color); font: inherit; font-size: var(--ha-font-size-s, 12px); font-weight: 500;
        }
        button::before { content: ""; position: absolute; inset: 0; background: var(--c, var(--feature-color)); opacity: .2; transition: opacity 180ms ease-in-out; }
        button:hover::before { opacity: .35; }
        button[aria-pressed="true"]::before { opacity: 1; }
        button[aria-pressed="true"] { color: var(--svs-on-color, #fff); }
        button:focus-visible { outline: 2px solid var(--c, var(--feature-color)); outline-offset: 2px; }
        button > * { position: relative; }
        ha-icon { --mdc-icon-size: 22px; }
        span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      </style>
      <div class="row" role="group" aria-label="Preset"></div>`;
    this._row = this.shadowRoot.querySelector(".row");
  }

  static getStubConfig() {
    return { type: "custom:svs-subwoofer-presets" };
  }

  static getConfigElement() {
    return document.createElement("svs-subwoofer-presets-editor");
  }

  setConfig(config) {
    if (!config) throw new Error("Invalid configuration");
    this._config = config;
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  set context(context) {
    this._context = context;
    this._render();
  }

  get _entity() {
    return sibling(this._hass, this._context?.entity_id, "preset");
  }

  _render() {
    if (!this._hass || !this._config || !this._context) return;
    const entity = this._entity;
    const stateObj = entity ? this._hass.states[entity] : undefined;
    // The subwoofer's own preset order (its slots) until the user reorders them
    const names = (stateObj?.attributes.options ?? []).filter((n) => !NOT_PRESETS.includes(n));
    const show = Array.isArray(this._config.presets_shown) ? this._config.presets_shown : null;
    const shown = show ? show.filter((n) => names.includes(n)) : names;
    const key = JSON.stringify([shown, stateObj?.state, this._config.presets, unavailable(stateObj)]);
    if (key === this._key) return;
    this._key = key;
    this._row.classList.toggle("disabled", unavailable(stateObj));
    this._row.replaceChildren(...shown.map((name) => {
      const own = this._config.presets?.[name] ?? {};
      const look = { ...presetDefaults(name), ...own };
      const button = document.createElement("button");
      button.type = "button";
      button.title = name;
      button.setAttribute("aria-label", name);
      button.setAttribute("aria-pressed", String(stateObj?.state === name));
      if (look.color) {
        button.style.setProperty("--c", cssColor(look.color));
        if (isLight(look.color)) button.style.setProperty("--svs-on-color", "rgba(0, 0, 0, .85)");
      }
      if (look.icon) {
        const icon = document.createElement("ha-icon");
        icon.icon = look.icon;
        icon.setAttribute("icon", look.icon);
        button.append(icon);
      } else {
        const label = document.createElement("span");
        label.textContent = name;
        button.append(label);
      }
      button.addEventListener("click", (ev) => {
        ev.stopPropagation();
        // Always sent, even for the preset that is already shown: loading it
        // again puts the subwoofer back to that preset's settings
        this._hass.callService("select", "select_option", { entity_id: entity, option: name });
      });
      return button;
    }));
  }
}

class SvsPresetButtonsEditor extends HTMLElement {
  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  set context(context) {
    this._context = context;
    this._render();
  }

  setConfig(config) {
    this._config = config;
    this._render();
  }

  _render() {
    if (!this._hass || !this._config) return;
    if (!this._form) {
      this._form = document.createElement("ha-form");
      this._form.computeLabel = (s) => s.label ?? s.name;
      this._form.addEventListener("value-changed", (ev) => {
        ev.stopPropagation();
        const value = ev.detail.value;
        const presets = {};
        for (const name of this._names()) {
          const color = value[`color_${name}`], icon = value[`icon_${name}`];
          if (color || icon) presets[name] = { ...(color ? { color } : {}), ...(icon ? { icon } : {}) };
        }
        const config = { type: this._config.type, presets };
        // Kept only when it differs from the default (every preset, in slot order)
        if (Array.isArray(value.presets_shown) && JSON.stringify(value.presets_shown) !== JSON.stringify(this._names())) {
          config.presets_shown = value.presets_shown;
        }
        this._config = config;
        fire(this, "config-changed", { config });
      });
      this.append(this._form);
    }
    const names = this._names();
    this._form.hass = this._hass;
    this._form.schema = [
      {
        name: "presets_shown", label: "Presets shown, in order",
        selector: { select: { multiple: true, reorder: true, mode: "dropdown", options: names } },
      },
      ...names.map((name) => ({
        type: "grid", name: "", schema: [
          { name: `color_${name}`, label: `${name} color`, selector: { ui_color: {} } },
          { name: `icon_${name}`, label: `${name} icon`, selector: { icon: {} } },
        ],
      })),
    ];
    const data = { presets_shown: this._config.presets_shown ?? names };
    for (const name of names) {
      const look = { ...presetDefaults(name), ...(this._config.presets?.[name] ?? {}) };
      data[`color_${name}`] = look.color;
      data[`icon_${name}`] = look.icon;
    }
    this._form.data = data;
  }

  _names() {
    const entity = sibling(this._hass, this._context?.entity_id, "preset");
    const options = entity ? this._hass.states[entity]?.attributes.options ?? [] : [];
    return options.filter((n) => !NOT_PRESETS.includes(n));
  }
}

// ---------------------------------------------------------------------------
// Feature: volume slider, optionally colored by volume thresholds
// ---------------------------------------------------------------------------

/** The volume thresholds, lowest first: [{below, color}, ..., {color}]. */
function colorRanges(config) {
  const ranges = Array.isArray(config?.volume_thresholds) ? config.volume_thresholds : [];
  const bounded = ranges.filter((r) => typeof r?.below === "number").sort((a, b) => a.below - b.below);
  const rest = ranges.find((r) => r && typeof r.below !== "number");
  return rest ? [...bounded, rest] : bounded;
}

function rangeColor(ranges, value) {
  for (const range of ranges) {
    if (typeof range.below !== "number" || value < range.below) return range.color;
  }
  return undefined;
}

class SvsVolume extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = `
      <style>${FEATURE_CSS}
        .control { cursor: pointer; touch-action: none; outline: none; }
        .control:focus-visible { box-shadow: 0 0 0 2px var(--fill, var(--feature-color)); }
        .zones { position: absolute; inset: 0; display: flex; }
        .zones i { display: block; height: 100%; opacity: .2; }
        .control:not(.ranged) .zones { background: var(--feature-color); opacity: .2; }
        .fill { position: absolute; inset: 0 auto 0 0; background: var(--fill, var(--feature-color)); }
        .tick { position: absolute; top: 25%; bottom: 25%; width: 2px; margin-left: -1px; border-radius: 1px; background: var(--primary-text-color); opacity: .35; }
        .handle { position: absolute; top: 25%; bottom: 25%; width: 4px; margin-left: -10px; border-radius: 2px; background: #fff; box-shadow: 0 0 2px rgba(0, 0, 0, .45); }
      </style>
      <div class="control" role="slider" tabindex="0" aria-label="Volume">
        <div class="zones"></div><div class="fill"></div><div class="ticks"></div><div class="handle"></div>
      </div>`;
    this._control = this.shadowRoot.querySelector(".control");
    this._control.addEventListener("pointerdown", (ev) => this._down(ev));
    this._control.addEventListener("pointermove", (ev) => this._move(ev));
    this._control.addEventListener("pointerup", (ev) => this._up(ev));
    this._control.addEventListener("pointercancel", (ev) => this._up(ev));
    this._control.addEventListener("keydown", (ev) => this._key(ev));
    this._control.addEventListener("keyup", () => this._keyUp());
  }

  static getStubConfig() {
    return { type: "custom:svs-subwoofer-volume" };
  }

  static getConfigElement() {
    return document.createElement("svs-subwoofer-volume-editor");
  }

  setConfig(config) {
    if (!config) throw new Error("Invalid configuration");
    this._config = config;
    this._ranges = colorRanges(config);
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  set context(context) {
    this._context = context;
    this._render();
  }

  get _entity() {
    return sibling(this._hass, this._context?.entity_id, "volume");
  }

  get _limits() {
    const a = this._hass?.states[this._entity]?.attributes ?? {};
    return { min: a.min ?? -60, max: a.max ?? 0, step: a.step ?? 1 };
  }

  _render() {
    if (!this._hass || !this._config || !this._context) return;
    const stateObj = this._hass.states[this._entity];
    const { min, max } = this._limits;
    const value = this._dragging ?? Number(stateObj?.state);
    const known = Number.isFinite(value);
    const at = (v) => ((v - min) / (max - min)) * 100;
    const pct = known ? Math.max(0, Math.min(100, at(value))) : 0;
    const ranged = this._ranges.length > 0;
    const key = JSON.stringify([pct, ranged, this._ranges, unavailable(stateObj)]);
    if (key === this._key) return;
    this._key = key;
    const c = this._control;
    c.classList.toggle("ranged", ranged);
    c.classList.toggle("disabled", unavailable(stateObj));
    c.setAttribute("aria-valuemin", min);
    c.setAttribute("aria-valuemax", max);
    if (known) c.setAttribute("aria-valuenow", value);
    const zones = c.querySelector(".zones"), ticks = c.querySelector(".ticks");
    zones.replaceChildren();
    ticks.replaceChildren();
    if (ranged) {
      let from = min;
      for (const range of this._ranges) {
        const to = typeof range.below === "number" ? Math.max(min, Math.min(max, range.below)) : max;
        const zone = document.createElement("i");
        zone.style.width = `${Math.max(0, at(to) - at(from))}%`;
        zone.style.background = cssColor(range.color ?? "primary");
        zones.append(zone);
        if (to < max && to > min) {
          const tick = document.createElement("div");
          tick.className = "tick";
          tick.style.left = `${at(to)}%`;
          ticks.append(tick);
        }
        from = to;
      }
    }
    const color = ranged && known ? rangeColor(this._ranges, value) : undefined;
    c.style.setProperty("--fill", color ? cssColor(color) : "var(--feature-color)");
    c.querySelector(".fill").style.width = `${pct}%`;
    const handle = c.querySelector(".handle");
    handle.style.left = `${pct}%`;
    handle.style.display = known ? "" : "none";
  }

  _valueAt(ev) {
    const { min, max, step } = this._limits;
    const rect = this._control.getBoundingClientRect();
    const f = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
    return Math.round((min + f * (max - min)) / step) * step;
  }

  _down(ev) {
    ev.stopPropagation();
    this._control.setPointerCapture(ev.pointerId);
    this._dragging = this._valueAt(ev);
    this._moved(true);
  }

  _move(ev) {
    if (this._dragging === undefined) return;
    this._dragging = this._valueAt(ev);
    this._moved(true);
  }

  _up(ev) {
    if (this._dragging === undefined) return;
    const value = this._valueAt(ev);
    this._dragging = undefined;
    this._send(value);
    this._moved(false, value);
  }

  _key(ev) {
    const { min, max, step } = this._limits;
    const delta = { ArrowRight: step, ArrowUp: step, ArrowLeft: -step, ArrowDown: -step, PageUp: 5 * step, PageDown: -5 * step }[ev.key];
    if (delta === undefined) return;
    ev.preventDefault();
    const current = this._dragging ?? Number(this._hass.states[this._entity]?.state);
    if (!Number.isFinite(current)) return;
    this._dragging = Math.max(min, Math.min(max, current + delta));
    this._moved(true);
    clearTimeout(this._keyTimer);
    this._keyTimer = setTimeout(() => this._keyUp(), 600);
  }

  _keyUp() {
    if (this._dragging === undefined) return;
    const value = this._dragging;
    this._dragging = undefined;
    clearTimeout(this._keyTimer);
    this._send(value);
    this._moved(false, value);
  }

  // Tells the SVS card the slider is moving, so its driver can shake
  _moved(active, value = this._dragging) {
    this._key = undefined;
    this._render();
    const { min, max } = this._limits;
    const color = this._ranges.length ? rangeColor(this._ranges, value) : undefined;
    fire(this, "svs-volume-input", { active, level: (value - min) / (max - min), color });
  }

  _send(value) {
    this._hass.callService("number", "set_value", { entity_id: this._entity, value });
  }
}

class SvsVolumeEditor extends HTMLElement {
  set hass(hass) {
    this._hass = hass;
    if (this._form) this._form.hass = hass;
  }

  setConfig(config) {
    this._config = config;
    this._render();
  }

  _render() {
    if (!this._form) {
      this.innerHTML = `<style>.note { color: var(--secondary-text-color); font-size: var(--ha-font-size-s, 12px); margin-top: 8px; min-height: 1em; }</style>`;
      this._form = document.createElement("ha-form");
      this._form.computeLabel = (s) => s.label ?? s.name;
      this._form.computeHelper = (s) => s.helper;
      this._form.addEventListener("value-changed", (ev) => this._changed(ev));
      this._note = document.createElement("div");
      this._note.className = "note";
      this._note.setAttribute("role", "status");
      this.append(this._form, this._note);
    }
    if (this._hass) this._form.hass = this._hass;
    const ranges = colorRanges(this._config);
    const on = ranges.length > 0;
    this._form.schema = [
      {
        name: "colored", label: "Volume thresholds",
        helper: "Split the slider into three volume ranges, each with its own color.",
        selector: { boolean: {} },
      },
      ...(on ? [
        { type: "grid", name: "", schema: [
          { name: "color_1", label: "Quietest color", selector: { ui_color: {} } },
          { name: "split_1", label: "Up to (dB)", selector: { number: { mode: "box", step: 1, min: -60, max: 0 } } },
        ] },
        { type: "grid", name: "", schema: [
          { name: "color_2", label: "Middle color", selector: { ui_color: {} } },
          { name: "split_2", label: "Up to (dB)", selector: { number: { mode: "box", step: 1, min: -60, max: 0 } } },
        ] },
        { name: "color_3", label: "Loudest color", selector: { ui_color: {} } },
      ] : []),
    ];
    this._form.data = on
      ? {
        colored: true,
        color_1: ranges[0]?.color, split_1: ranges[0]?.below,
        color_2: ranges[1]?.color, split_2: ranges[1]?.below,
        color_3: ranges[2]?.color,
      }
      : { colored: false };
  }

  _changed(ev) {
    ev.stopPropagation();
    const v = ev.detail.value;
    this._note.textContent = "";
    let config = { type: this._config.type };
    if (v.colored) {
      let a = Number.isFinite(v.split_1) ? v.split_1 : -30;
      let b = Number.isFinite(v.split_2) ? v.split_2 : -15;
      let c1 = v.color_1 ?? "green", c3 = v.color_3 ?? "red";
      // Splits entered the other way round are put back in order, and the
      // outer colors move with them, so each color stays on the volumes meant
      if (a > b) {
        [a, b] = [b, a];
        [c1, c3] = [c3, c1];
        this._note.textContent = "The two volumes were the other way round, so they were swapped, and the quietest and loudest colors moved with them.";
      } else if (a === b) {
        this._note.textContent = "Both volumes are the same, so the middle color is not used.";
      }
      config.volume_thresholds = [
        { below: a, color: c1 },
        { below: b, color: v.color_2 ?? "yellow" },
        { color: c3 },
      ];
    }
    this._config = config;
    this._render();
    fire(this, "config-changed", { config });
  }
}

// ---------------------------------------------------------------------------
// Feature: standby mode
// ---------------------------------------------------------------------------
class SvsStandby extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = `
      <style>${FEATURE_CSS}
        .control { display: flex; }
        button {
          position: relative; flex: 1 1 0; min-width: 0; border: 0; cursor: pointer; background: transparent;
          border-radius: var(--feature-border-radius, 12px);
          color: var(--primary-text-color); font: inherit; font-size: var(--ha-font-size-s, 12px); font-weight: 500;
        }
        /* The selected mode's text takes the color behind the control, so it reads on any feature color */
        button[aria-pressed="true"] { background: var(--feature-color); color: var(--svs-feature-backing, var(--card-background-color, var(--primary-background-color))); }
        button:focus-visible { outline: 2px solid var(--feature-color); outline-offset: -2px; }
      </style>
      <div class="control" role="group" aria-label="Standby mode"><div class="tint"></div></div>`;
    this._control = this.shadowRoot.querySelector(".control");
  }

  static getStubConfig() {
    return { type: "custom:svs-subwoofer-standby" };
  }

  setConfig(config) {
    if (!config) throw new Error("Invalid configuration");
    this._config = config;
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  set context(context) {
    this._context = context;
    this._render();
  }

  _render() {
    if (!this._hass || !this._config || !this._context) return;
    const entity = sibling(this._hass, this._context.entity_id, "standby");
    const stateObj = entity ? this._hass.states[entity] : undefined;
    const options = (stateObj?.attributes.options ?? []).filter((o) => !NOT_PRESETS.includes(o));
    const key = JSON.stringify([options, stateObj?.state, unavailable(stateObj)]);
    if (key === this._key) return;
    this._key = key;
    this._control.classList.toggle("disabled", unavailable(stateObj));
    const tint = this._control.querySelector(".tint");
    this._control.replaceChildren(tint, ...options.map((option) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = option;
      button.setAttribute("aria-pressed", String(stateObj.state === option));
      button.addEventListener("click", (ev) => {
        ev.stopPropagation();
        this._hass.callService("select", "select_option", { entity_id: entity, option });
      });
      return button;
    }));
  }
}

// ---------------------------------------------------------------------------
// Finishes, drawn on a canvas behind the card
// ---------------------------------------------------------------------------
const FINISHES = [
  ["none", "None (theme)"],
  ["black_ash", "Premium Black Ash"],
  ["black_oak", "Black Oak Real Wood Veneer"],
  ["gloss_black", "Piano Gloss Black"],
  ["gloss_white", "Piano Gloss White"],
];
const WOOD = ["black_ash", "black_oak"];
const finishTone = (finish) => (finish === "gloss_white" ? "light" : finish === "none" ? null : "dark");
// The solid backing behind each feature control on a finish
const BACKING = { dark: "#1e1f22", light: "#eceef1" };
const DEFAULT_PATTERN = 4242;

function rng(seed) {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
}

function valueNoise(seed) {
  const R = rng(seed), perm = new Uint8Array(512), vals = new Float32Array(256);
  for (let i = 0; i < 256; i++) { perm[i] = i; vals[i] = R(); }
  for (let i = 255; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
  for (let i = 0; i < 256; i++) perm[i + 256] = perm[i];
  const sm = (t) => t * t * (3 - 2 * t);
  const n2 = (x, y) => {
    let xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    xi &= 255; yi &= 255;
    const a = vals[perm[perm[xi] + yi]], b = vals[perm[perm[xi + 1] + yi]];
    const c = vals[perm[perm[xi] + yi + 1]], d = vals[perm[perm[xi + 1] + yi + 1]];
    const u = sm(xf), v = sm(yf);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  return (x, y, octaves) => {
    let sum = 0, amp = .5, f = 1, norm = 0;
    for (let k = 0; k < octaves; k++) { sum += n2(x * f, y * f) * amp; norm += amp; amp *= .5; f *= 2.03; }
    return sum / norm;
  };
}

/**
 * Draw a finish. Wood runs vertically or horizontally (a couple of degrees of
 * tilt at most) at a zoom from the pattern; gloss reflections fall at any angle.
 */
function drawFinish(ctx, finish, pattern, w, h) {
  const r = rng(pattern * 31 + 7);
  const wood = WOOD.includes(finish);
  const angle = wood ? (r() < .5 ? 0 : Math.PI / 2) + (r() - .5) * .07 : r() * Math.PI;
  const zoom = wood ? .6 + r() * 1.1 : 1;
  const D = Math.ceil(Math.sqrt(w * w + h * h) / Math.min(zoom, 1)) + 20;
  const half = D / 2;
  if (finish === "black_ash") {
    // Wide, wavy grey bands with a rough, porous texture on black, pinching
    // together and swirling into long ovals: the contour rings of a warped
    // noise field, stretched along the grain
    const img = ctx.createImageData(w, h), px = img.data;
    const noise = valueNoise(pattern * 7 + 1);
    const ca = Math.cos(angle), sa = Math.sin(angle);
    const period = 21 + r() * 6, warp = 3 + r() * 1.2, share = .46 + r() * .08;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dx = x - w / 2, dy = y - h / 2;
        const u = (dx * ca + dy * sa) / zoom, v = (-dx * sa + dy * ca) / zoom;
        const t = u / period + noise(u * .008, v * .0045, 3) * warp;
        const ring = t - Math.floor(t);
        const width = share + (noise(u * .02 + 40, v * .007, 2) - .5) * .6;
        const pore = noise(u * .7 + 90, v * .05, 2);
        let tone;
        if (ring - width + (pore - .5) * .45 < 0) {
          tone = 74 + (pore - .5) * 60 + (noise(u * .9 + 7, v * .25, 1) - .5) * 30;
          if (pore < .3) tone -= 32;
        } else {
          tone = 20 + (pore - .5) * 10;
        }
        tone = Math.max(10, Math.min(120, tone));
        const o = (y * w + x) * 4;
        px[o] = tone; px[o + 1] = tone; px[o + 2] = tone + 3; px[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    const lx = r() * w, g = ctx.createRadialGradient(lx, 0, 0, lx, 0, Math.max(w, h) * 1.1);
    g.addColorStop(0, "rgba(255,255,255,.07)");
    g.addColorStop(1, "rgba(0,0,0,.22)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  } else if (finish === "black_oak") {
    // Matte near-black with fine, low-contrast straight grain and open pores
    ctx.fillStyle = "#151516";
    ctx.fillRect(0, 0, w, h);
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.rotate(angle);
    ctx.scale(zoom, zoom);
    const drift = (r() - .5) * .04;
    for (let j = 0; j < D / 1.4; j++) {
      const gx = -half + r() * D;
      ctx.beginPath();
      ctx.moveTo(gx, -half);
      ctx.quadraticCurveTo(gx + (r() - .5) * 3 + drift * D, 0, gx + drift * D * 2, half);
      ctx.strokeStyle = `rgba(92,92,96,${(.05 + r() * .12).toFixed(3)})`;
      ctx.lineWidth = .3 + r() * .9;
      ctx.stroke();
    }
    if (r() < .7) {
      const cx = (r() - .5) * D * .5, top = -half * (.1 + r() * .6);
      for (let k = 0; k < 14; k++) {
        const sp = 8 + k * (6 + r() * 3);
        ctx.beginPath();
        ctx.moveTo(cx - sp, half);
        ctx.quadraticCurveTo(cx - sp * .55, top + k * 9, cx, top + k * 9 - 6);
        ctx.quadraticCurveTo(cx + sp * .55, top + k * 9, cx + sp, half);
        ctx.strokeStyle = `rgba(96,94,92,${(.04 + r() * .05).toFixed(3)})`;
        ctx.lineWidth = .6 + r() * .8;
        ctx.stroke();
      }
    }
    for (let p = 0; p < D * 2.5; p++) {
      ctx.fillStyle = r() < .5 ? "rgba(0,0,0,.5)" : "rgba(110,110,114,.12)";
      ctx.fillRect(-half + r() * D, -half + r() * D, .6, 1.5 + r() * 4);
    }
    ctx.restore();
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "rgba(255,255,255,.03)");
    g.addColorStop(1, "rgba(0,0,0,.18)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  } else {
    const dark = finish === "gloss_black";
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, dark ? "#22252b" : "#fbfbfc");
    g.addColorStop(1, dark ? "#060708" : "#d8dbe0");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.rotate(angle);
    const n = 2 + Math.floor(r() * 3);
    for (let s = 0; s < n; s++) {
      const x = -half + r() * D, wd = 18 + r() * 110, peak = dark ? .05 + r() * .1 : .5 + r() * .4;
      const sg = ctx.createLinearGradient(x, 0, x + wd, 0);
      sg.addColorStop(0, "rgba(255,255,255,0)");
      sg.addColorStop(.5, `rgba(255,255,255,${peak.toFixed(3)})`);
      sg.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = sg;
      ctx.fillRect(x, -half, wd, D);
    }
    ctx.restore();
  }
}

// ---------------------------------------------------------------------------
// The driver picture shown in place of the tile icon
// ---------------------------------------------------------------------------
function driverPicture(ring) {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">` +
    `<circle cx="20" cy="20" r="15.5" fill="#15171a" stroke="${ring}" stroke-width="2.4"/>` +
    `<circle cx="20" cy="20" r="12.6" fill="#24272c" stroke="#3a3e45" stroke-width="1.6"/>` +
    `<circle cx="20" cy="20" r="9.6" fill="#1a1c20"/>` +
    `<circle cx="20" cy="20" r="5.4" fill="#3d424a"/>` +
    `<circle cx="18.6" cy="18.4" r="2" fill="#5b616b" opacity=".7"/>` +
    `</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const BT_OFF = "M13 5.83l1.88 1.88-1.6 1.6 1.41 1.41 3.02-3.02L12 2h-1v5.03l2 2zM5.41 4L4 5.41 10.59 12 5 17.59 6.41 19 11 14.41V22h1l4.29-4.29 2.3 2.29L20 18.59 5.41 4zM13 18.17v-3.76l1.88 1.88L13 18.17z";

// Options this card adds to the tile card's
const OWN_KEYS = ["finish", "pattern", "vibration"];

function tileConfig(config) {
  const tile = { ...config, type: "tile", show_entity_picture: true };
  for (const key of OWN_KEYS) delete tile[key];
  return tile;
}

const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// ---------------------------------------------------------------------------
// The card
// ---------------------------------------------------------------------------
class SvsCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; height: 100%; }
        .frame {
          position: relative; height: 100%; box-sizing: border-box; overflow: hidden; isolation: isolate;
          /* Exactly the tile card's own corners (ha-card), from the theme */
          border-radius: var(--ha-card-border-radius, var(--ha-border-radius-lg));
        }
        canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: none; pointer-events: none; }
        .finished canvas { display: block; }
        .finished::after {
          content: ""; position: absolute; inset: 0; border-radius: inherit; pointer-events: none; z-index: 2;
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, .16), inset 0 -1px 0 rgba(0, 0, 0, .4);
        }
        .tile { position: relative; display: block; height: 100%; }
        .finished .tile {
          --ha-card-background: transparent; --card-background-color: transparent;
          --ha-card-box-shadow: none; --ha-card-border-color: transparent;
          --ha-card-backdrop-filter: none;
        }
        .tile.dark {
          --primary-text-color: rgba(255, 255, 255, .95); --secondary-text-color: rgba(235, 235, 240, .7);
          --svs-feature-backing: ${BACKING.dark};
        }
        .tile.light {
          --primary-text-color: rgba(0, 0, 0, .85); --secondary-text-color: rgba(40, 40, 48, .62);
          --svs-feature-backing: ${BACKING.light};
        }
        .badge {
          position: absolute; z-index: 3; width: 16px; height: 16px; display: none; place-items: center;
          border-radius: var(--ha-border-radius-pill, 9999px);
          background: var(--ha-card-background, var(--card-background-color, #fff));
          color: var(--secondary-text-color); pointer-events: none;
        }
        .badge.on { display: grid; }
        .badge svg { width: 12px; height: 12px; }
      </style>
      <div class="frame">
        <canvas></canvas>
        <div class="badge" title="Not connected"><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="${BT_OFF}"/></svg></div>
      </div>`;
    this._frame = this.shadowRoot.querySelector(".frame");
    this._canvas = this.shadowRoot.querySelector("canvas");
    this._badge = this.shadowRoot.querySelector(".badge");
    this._resize = new ResizeObserver(() => this._layout());
    this._resize.observe(this._frame);
    // The volume feature reports while its slider moves
    this._frame.addEventListener("svs-volume-input", (ev) => this._sliderMoved(ev.detail));
  }

  static getConfigElement() {
    return document.createElement(EDITOR_TYPE);
  }

  static getStubConfig(hass) {
    const all = Object.values(hass.entities ?? {});
    const pick = (key) => all.find((e) => e.platform === DOMAIN && e.translation_key === key)?.entity_id;
    const entity = pick("group_volume") ?? pick("volume") ?? "";
    return {
      entity,
      finish: "none",
      vibration: true,
      features: [{ type: "custom:svs-subwoofer-presets" }, { type: "custom:svs-subwoofer-volume" }],
      features_position: "bottom",
    };
  }

  setConfig(config) {
    if (!config?.entity) throw new Error("Choose an SVS Subwoofer entity");
    const finish = config.finish ?? "none";
    if (!FINISHES.some(([id]) => id === finish)) throw new Error(`Unknown finish: ${finish}`);
    this._config = { ...config, finish };
    const tile = tileConfig(this._config);
    if (this._tile) {
      this._tile.setConfig(tile);
    } else if (customElements.get("hui-tile-card")) {
      this._createTile(tile);
    } else {
      // The tile card is loaded on demand; the card helpers load it
      window.loadCardHelpers?.().then(async (helpers) => {
        helpers.createCardElement({ type: "tile", entity: tile.entity });
        await customElements.whenDefined("hui-tile-card");
        if (!this._tile) this._createTile(tileConfig(this._config));
      });
    }
    this._drawn = undefined;
    this._layout();
  }

  _createTile(tile) {
    this._tile = document.createElement("hui-tile-card");
    this._tile.classList.add("tile");
    this._tile.setConfig(tile);
    if (this._hass) this._tile.hass = this._innerHass(this._hass);
    if (this._preview !== undefined) this._tile.preview = this._preview;
    if (this._layoutValue !== undefined) this._tile.layout = this._layoutValue;
    this._frame.insertBefore(this._tile, this._badge);
    this._layout();
  }

  set hass(hass) {
    const before = this._hass;
    this._hass = hass;
    if (this._tile) this._tile.hass = this._innerHass(hass);
    this._watchChanges(before, hass);
    this._updateBadge();
    this._sizeDriver();
  }

  get hass() {
    return this._hass;
  }

  // Dashboard properties the tile card uses
  set preview(value) {
    this._preview = value;
    if (this._tile) this._tile.preview = value;
  }

  set layout(value) {
    this._layoutValue = value;
    if (this._tile) this._tile.layout = value;
  }

  getCardSize() {
    if (this._tile?.getCardSize) return this._tile.getCardSize();
    return 1 + (this._config?.features?.length ?? 0);
  }

  getGridOptions() {
    if (this._tile?.getGridOptions) return this._tile.getGridOptions();
    return { columns: 6, rows: 1 + (this._config?.features?.length ?? 0), min_columns: 6, min_rows: 1 };
  }

  get _entities() {
    const id = this._config?.entity;
    return {
      preset: sibling(this._hass, id, "preset"),
      volume: this._hass?.entities?.[id]?.translation_key?.endsWith("volume") ? id : sibling(this._hass, id, "volume"),
      connected: sibling(this._hass, id, "connected"),
    };
  }

  /** The volume as a fraction of its range (0 at the quietest, 1 at the loudest). */
  _level(value) {
    const id = this._entities.volume;
    const stateObj = id ? this._hass?.states[id] : undefined;
    const v = value ?? Number(stateObj?.state);
    if (!Number.isFinite(v)) return 0;
    const min = stateObj?.attributes.min ?? -60, max = stateObj?.attributes.max ?? 0;
    return Math.max(0, Math.min(1, (v - min) / (max - min)));
  }

  /**
   * The driver's ring: while the volume slider moves, the color of the volume
   * threshold it is in; otherwise the active preset's color; with no preset
   * (Manual), the threshold color of the volume; and a neutral ring if none apply.
   */
  _ringColor() {
    if (this._dragColor) return this._resolve(this._dragColor);
    const features = this._config?.features ?? [];
    const preset = this._entities.preset;
    const name = preset ? this._hass?.states[preset]?.state : undefined;
    const isPreset = name && !NOT_PRESETS.includes(name) && name !== "unavailable" && name !== "unknown";
    if (isPreset) {
      const presetFeature = features.find((f) => f.type === "custom:svs-subwoofer-presets");
      const color = presetFeature?.presets?.[name]?.color ?? presetDefaults(name).color;
      if (color) return this._resolve(color);
    }
    const thresholds = colorRanges(features.find((f) => f.type === "custom:svs-subwoofer-volume"));
    const volume = this._entities.volume;
    const value = volume ? Number(this._hass?.states[volume]?.state) : NaN;
    if (thresholds.length && Number.isFinite(value)) {
      const color = rangeColor(thresholds, value);
      if (color) return this._resolve(color);
    }
    return isPreset ? "#9aa0a8" : "#6b7079";
  }

  // A theme color as a value the picture can use
  _resolve(color) {
    const value = HA_COLORS.includes(color) ? getComputedStyle(this).getPropertyValue(`--${color}-color`).trim() : color;
    return value || "#9aa0a8";
  }

  /**
   * The Home Assistant object the tile card sees: the same, except that the
   * card's entity has the driver as its picture. The changed state object is
   * reused until the real one or the picture changes.
   */
  _innerHass(hass) {
    const entity = this._config?.entity;
    const stateObj = hass.states[entity];
    if (!stateObj) return hass;
    const picture = driverPicture(this._ringColor());
    const extra = subwooferAttributes(hass, entity);
    const extraKey = JSON.stringify(extra);
    if (this._sourceState !== stateObj || this._lastPicture !== picture || this._lastExtra !== extraKey) {
      this._sourceState = stateObj;
      this._lastPicture = picture;
      this._lastExtra = extraKey;
      this._innerState = { ...stateObj, attributes: { ...stateObj.attributes, ...extra, entity_picture: picture } };
    }
    return { ...hass, states: { ...hass.states, [entity]: this._innerState } };
  }

  // The driver picture inside the tile card's icon; undefined if the tile
  // card ever changes how it shows a picture (the card then just does not move it)
  get _driver() {
    const icon = this._tile?.shadowRoot?.querySelector("ha-tile-icon");
    return icon?.shadowRoot?.querySelector("img") ?? icon?.querySelector?.("img") ?? undefined;
  }

  // The driver's size follows the volume: small when quiet, filling the icon when loud
  _sizeDriver(level = this._level()) {
    const driver = this._driver;
    if (!driver) {
      // The tile card renders after this card; try again once it has
      if (this._tile && !this._sizeRetry) {
        this._sizeRetry = true;
        this._tile.updateComplete?.then(() => {
          this._sizeRetry = false;
          if (this._driver) this._sizeDriver();
        });
      }
      return;
    }
    driver.style.transition = reducedMotion() ? "none" : "scale 350ms cubic-bezier(.3, 1.5, .5, 1)";
    driver.style.scale = String(.7 + level * .5);
  }

  // A preset or volume change from anywhere shakes the driver briefly, harder
  // at a higher volume
  _watchChanges(before, hass) {
    if (!before || !this._config) return;
    const { preset, volume } = this._entities;
    const changed = (id) => id && before.states[id]?.state !== hass.states[id]?.state &&
      before.states[id] !== undefined && hass.states[id]?.state !== "unavailable";
    // The slider shakes the driver itself; its own volume change arriving
    // afterwards does not shake it again
    const fromSlider = this._sliding || Date.now() - (this._slideEnded ?? 0) < 2500;
    if (changed(preset) || (changed(volume) && !fromSlider)) this._shake(this._level(), 650);
  }

  _sliderMoved({ active, level, color }) {
    this._sliding = active;
    // The ring shows the threshold color while the slider moves
    const dragColor = active ? color : undefined;
    if (dragColor !== this._dragColor) {
      this._dragColor = dragColor;
      if (this._tile && this._hass) this._tile.hass = this._innerHass(this._hass);
    }
    if (!active) this._slideEnded = Date.now();
    this._sizeDriver(level);
    if (active) this._shake(level);
    else this._shake(level, 450);
  }

  /** Shake the driver; with no duration, until the slider stops. */
  _shake(level, duration) {
    if (this._config?.vibration === false || reducedMotion()) return;
    const driver = this._driver;
    if (!driver?.animate) return;
    const a = (.3 + level * 1.4).toFixed(2), s = (1 + level * .06).toFixed(3);
    const frames = [
      { transform: "translate(0, 0) scale(1)" },
      { transform: `translate(${a}px, ${-a / 2}px) scale(${s})` },
      { transform: "translate(0, 0) scale(1)" },
      { transform: `translate(${-a}px, ${a / 2}px) scale(${s})` },
      { transform: "translate(0, 0) scale(1)" },
    ];
    this._shaking?.cancel();
    this._shaking = driver.animate(frames, { duration: 90, iterations: duration ? Math.max(1, Math.round(duration / 90)) : Infinity });
  }

  // The Bluetooth badge on the icon while a subwoofer is not connected
  _updateBadge() {
    const id = this._entities.connected;
    const off = !!id && this._hass?.states[id]?.state === "off";
    this._badge.classList.toggle("on", off);
    if (off) this._placeBadge();
  }

  _placeBadge() {
    const icon = this._tile?.shadowRoot?.querySelector("ha-tile-icon");
    if (!icon) return;
    const frame = this._frame.getBoundingClientRect(), box = icon.getBoundingClientRect();
    const scale = frame.width / this._frame.offsetWidth || 1;
    this._badge.style.left = `${(box.right - frame.left) / scale - 13}px`;
    this._badge.style.top = `${(box.top - frame.top) / scale - 3}px`;
  }

  _layout() {
    if (!this._config) return;
    const finish = this._config.finish;
    const tone = finishTone(finish);
    this._frame.classList.toggle("finished", !!tone);
    if (this._tile) {
      this._tile.classList.toggle("dark", tone === "dark");
      this._tile.classList.toggle("light", tone === "light");
    }
    if (this._badge.classList.contains("on")) this._placeBadge();
    if (!tone) return;
    const w = this._frame.clientWidth, h = this._frame.clientHeight;
    if (!w || !h) return;
    const pattern = Number.isFinite(this._config.pattern) ? this._config.pattern : DEFAULT_PATTERN;
    const key = `${finish}|${pattern}|${w}x${h}`;
    if (key === this._drawn) return;
    this._drawn = key;
    this._canvas.width = w;
    this._canvas.height = h;
    drawFinish(this._canvas.getContext("2d"), finish, pattern, w, h);
  }
}

// ---------------------------------------------------------------------------
// The editor: the tile card's own editor, plus a panel for the SVS look
// ---------------------------------------------------------------------------

// Tile card options this card sets itself, so they are left out of its editor
const HIDDEN_TILE_OPTIONS = ["icon", "show_entity_picture"];

function hideOptions(schema) {
  return schema
    .filter((item) => !HIDDEN_TILE_OPTIONS.includes(item.name))
    .map((item) => (Array.isArray(item.schema) ? { ...item, schema: hideOptions(item.schema) } : item));
}

/**
 * The tile card's editor, with the options above left out. It is the tile
 * card's own editor class, so it keeps every future change to it. If a Home
 * Assistant update renames its form layout, the editor still works and simply
 * shows those options again.
 */
function tileEditorType() {
  if (customElements.get(TILE_EDITOR_TYPE)) return TILE_EDITOR_TYPE;
  const Base = customElements.get("hui-tile-card-editor");
  if (!Base) return null;
  customElements.define(TILE_EDITOR_TYPE, class extends Base {
    constructor() {
      super();
      const original = this._schema;
      if (typeof original !== "function") return;
      let lastIn, lastOut;
      this._schema = (...args) => {
        const schema = original.apply(this, args);
        if (schema !== lastIn) {
          lastIn = schema;
          lastOut = Array.isArray(schema) ? hideOptions(schema) : schema;
        }
        return lastOut;
      };
    }
  });
  return TILE_EDITOR_TYPE;
}

const RANDOMIZE_LABEL = {
  black_ash: "Randomize grain",
  black_oak: "Randomize grain",
  gloss_black: "Randomize reflections",
  gloss_white: "Randomize reflections",
};

class SvsCardEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = `
      <style>
        #tile { display: block; }
        ha-expansion-panel {
          display: block; margin-top: 24px;
          --expansion-panel-content-padding: 0;
          border-radius: var(--ha-border-radius-md, 8px);
          --ha-card-border-radius: var(--ha-border-radius-md, 8px);
        }
        ha-expansion-panel > [slot="header"] { margin: 0; font-size: inherit; font-weight: inherit; }
        .content { padding: 12px; display: grid; gap: 16px; }
        .row { display: flex; align-items: center; gap: 12px; }
      </style>
      <div id="tile"></div>
      <ha-expansion-panel outlined expanded>
        <div slot="header" role="heading" aria-level="3">SVS style</div>
        <div class="content">
          <ha-form id="form"></ha-form>
          <div class="row" id="row"><ha-button id="randomize"></ha-button></div>
        </div>
      </ha-expansion-panel>`;
    this._form = this.shadowRoot.getElementById("form");
    this._form.computeLabel = (s) => s.label ?? s.name;
    this._form.computeHelper = (s) => s.helper;
    this._form.addEventListener("value-changed", (ev) => {
      ev.stopPropagation();
      const v = ev.detail.value;
      this._update({ finish: v.finish ?? "none", vibration: v.vibration !== false });
    });
    this.shadowRoot.getElementById("randomize").addEventListener("click", () => {
      this._update({ pattern: 1 + Math.floor(Math.random() * 99999) });
    });
  }

  set hass(hass) {
    this._hass = hass;
    this._form.hass = hass;
    if (this._tileEditor) this._tileEditor.hass = withSubwooferAttributes(hass, this._config?.entity);
  }

  set lovelace(lovelace) {
    this._lovelace = lovelace;
    if (this._tileEditor) this._tileEditor.lovelace = lovelace;
  }

  setConfig(config) {
    this._config = explicit(config);
    this._render();
    this._setTileEditorConfig();
    if (JSON.stringify(this._config) !== JSON.stringify(config)) this._fire();
  }

  async _setTileEditorConfig() {
    if (!this._tileEditor) {
      this._loading ??= (async () => {
        const helpers = await window.loadCardHelpers();
        helpers.createCardElement({ type: "tile", entity: this._config.entity });
        await customElements.whenDefined("hui-tile-card");
        const original = await customElements.get("hui-tile-card").getConfigElement();
        const type = tileEditorType();
        const editor = type ? document.createElement(type) : original;
        editor.addEventListener("config-changed", (ev) => {
          // The tile card's options changed: keep ours and pass the whole card on
          ev.stopPropagation();
          const own = Object.fromEntries(OWN_KEYS.filter((k) => k in this._config).map((k) => [k, this._config[k]]));
          const next = { ...ev.detail.config, ...own, type: this._config.type };
          delete next.show_entity_picture;  // always on: the driver is shown there
          this._config = next;
          this._fire();
        });
        editor.hass = withSubwooferAttributes(this._hass, this._config.entity);
        if (this._lovelace) editor.lovelace = this._lovelace;
        this.shadowRoot.getElementById("tile").replaceWith(editor);
        this._tileEditor = editor;
      })();
      await this._loading;
    }
    this._tileEditor.setConfig(tileConfig(this._config));
  }

  _render() {
    const c = this._config;
    this._form.schema = [
      { name: "finish", label: "Finish", selector: { select: { mode: "dropdown", options: FINISHES.map(([value, label]) => ({ value, label })) } } },
      {
        name: "vibration", label: "Shake when the volume or preset changes",
        helper: "The driver shakes harder at a higher volume. It stays still for anyone who has reduced motion turned on.",
        selector: { boolean: {} },
      },
    ];
    this._form.data = { finish: c.finish, vibration: c.vibration !== false };
    const label = RANDOMIZE_LABEL[c.finish];
    this.shadowRoot.getElementById("row").style.display = label ? "" : "none";
    this.shadowRoot.getElementById("randomize").textContent = label ?? "";
  }

  _update(changes) {
    this._config = explicit({ ...this._config, ...changes });
    this._render();
    this._fire();
  }

  _fire() {
    fire(this, "config-changed", { config: this._config });
  }
}

/**
 * The configuration as the editor saves it: finish and vibration written
 * out, and the pattern only for a finish that has one.
 */
function explicit(config) {
  const c = { ...config };
  c.finish = FINISHES.some(([id]) => id === c.finish) ? c.finish : "none";
  c.vibration = c.vibration !== false;
  if (c.finish === "none") delete c.pattern;
  else c.pattern = Number.isFinite(c.pattern) ? c.pattern : DEFAULT_PATTERN;
  return c;
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------
const define = (name, cls) => {
  if (!customElements.get(name)) customElements.define(name, cls);
};

if (!customElements.get(CARD_TYPE)) {
  define("svs-subwoofer-presets", SvsPresetButtons);
  define("svs-subwoofer-presets-editor", SvsPresetButtonsEditor);
  define("svs-subwoofer-volume", SvsVolume);
  define("svs-subwoofer-volume-editor", SvsVolumeEditor);
  define("svs-subwoofer-standby", SvsStandby);
  define(CARD_TYPE, SvsCard);
  define(EDITOR_TYPE, SvsCardEditor);

  const supports = (role) => (hass, context) => isSvs(hass, context?.entity_id) && !!sibling(hass, context.entity_id, role);
  window.customCardFeatures = window.customCardFeatures || [];
  window.customCardFeatures.push(
    { type: "svs-subwoofer-presets", name: "SVS Subwoofer presets", isSupported: supports("preset"), configurable: true },
    { type: "svs-subwoofer-volume", name: "SVS Subwoofer volume", isSupported: supports("volume"), configurable: true },
    { type: "svs-subwoofer-standby", name: "SVS Subwoofer standby mode", isSupported: supports("standby") },
  );

  window.customCards = window.customCards || [];
  window.customCards.push({
    type: CARD_TYPE,
    name: "SVS Subwoofer",
    description: "A tile card for an SVS subwoofer or subwoofer group, with an optional SVS cabinet finish.",
    preview: true,
    documentationURL: "https://github.com/dangerouslaser/svs-subwoofer-ha#dashboard-card",
  });
  console.info(`%c SVS SUBWOOFER CARD %c ${VERSION} `, "color: #fff; background: #555; font-weight: bold", "color: #fff; background: #c8102e");
}
