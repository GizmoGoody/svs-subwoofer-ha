/**
 * Runs in Home Assistant's own page, with its real frontend components: the
 * SVS Subwoofer card, the panel prototype, their editors and features,
 * against the fake subwoofers. Each test acts the way the editor's form does
 * (the same events), and plays Home Assistant's part of handing every saved
 * configuration back to the editor, as the dashboard editor does.
 */
(() => {
  const hass = () => document.querySelector("home-assistant").hass;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function until(check, what, ms = 10000) {
    const end = Date.now() + ms;
    let last;
    while (Date.now() < end) {
      try {
        const value = await check();
        if (value) return value;
      } catch (err) {
        last = err;
      }
      await sleep(50);
    }
    throw new Error(`Timed out waiting for ${what}${last ? ` (${last})` : ""}`);
  }
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  function expectEqual(actual, expected, what) {
    if (!same(actual, expected)) throw new Error(`${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }

  function stage() {
    let el = document.getElementById("svs-stage");
    if (!el) {
      el = document.createElement("div");
      el.id = "svs-stage";
      Object.assign(el.style, {
        position: "absolute", left: "0", top: "0", width: "460px", padding: "16px", zIndex: "10000",
        display: "grid", gap: "12px", boxSizing: "border-box",
        background: "var(--primary-background-color)", color: "var(--primary-text-color)",
      });
      document.body.append(el);
    }
    return el;
  }

  // The dashboard's lovelace object, which the dashboard gives every editor
  function findDeep(root, selector, depth = 8) {
    const found = root.querySelector?.(selector);
    if (found || depth === 0) return found;
    for (const el of root.querySelectorAll?.("*") ?? []) {
      const hit = el.shadowRoot && findDeep(el.shadowRoot, selector, depth - 1);
      if (hit) return hit;
    }
    return null;
  }
  const lovelace = () => findDeep(document, "hui-root")?.lovelace;

  // An editor as the dashboard hosts it: hass and lovelace set, and every
  // saved configuration handed back to it (kept here for the test to check)
  function hosted(type, extra = {}) {
    const el = document.createElement(type);
    Object.assign(el, extra);
    el.hass = hass();
    if (lovelace()) el.lovelace = lovelace();
    const saved = [];
    el.addEventListener("config-changed", (ev) => {
      saved.push(ev.detail.config);
      el.setConfig(ev.detail.config);
    });
    stage().append(el);
    return { el, saved };
  }

  // The tile card's editor inside one of our editors, once it has rendered
  const tileEditorIn = (root, not) => until(() => [...(root.shadowRoot?.querySelectorAll("*") ?? [])].find(
    (e) => e !== not && e.tagName.toLowerCase().endsWith("tile-card-editor") && e.shadowRoot?.querySelector("ha-form")), "the tile card editor");
  const mainForm = (tileEditor) => tileEditor.shadowRoot.querySelector("ha-form");
  const setFormValue = (form, changes) => form.dispatchEvent(new CustomEvent("value-changed", { detail: { value: { ...form.data, ...changes } } }));
  const featuresEditor = (tileEditor) => tileEditor.shadowRoot.querySelector("hui-card-features-editor");
  const setFeatures = (tileEditor, features) => featuresEditor(tileEditor).dispatchEvent(
    new CustomEvent("features-changed", { detail: { features } }));

  const entities = () => Object.values(hass().entities).filter((e) => e.platform === "svs_subwoofer");
  const subVolumes = () => entities().filter((e) => e.translation_key === "volume").map((e) => e.entity_id).sort();
  const groupVolume = () => entities().find((e) => e.translation_key === "group_volume")?.entity_id;

  window.svsUiTests = async () => {
    const results = [];
    // Page errors (an element that throws while drawing) are recorded with
    // the test they happen in, and fail it
    let errors = [];
    const onError = (ev) => errors.push(String(ev.error?.stack ?? ev.error ?? ev.message ?? ev.reason?.stack ?? ev.reason));
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onError);
    // Errors Home Assistant's own editors raise when hosted outside the
    // dashboard's edit dialog (found by the control test): not ours
    let baseline = new Set();
    const firstLine = (e) => e.split("\n")[0];
    async function test(name, fn, { control = false } = {}) {
      errors = [];
      try {
        await fn();
        await sleep(200);
        if (control) {
          baseline = new Set(errors.map(firstLine));
          results.push({ name, ok: true, detail: errors.length ? `baseline errors: ${[...baseline].join("; ")}` : "" });
          stage().replaceChildren();
          return;
        }
        const ours = errors.filter((e) => !baseline.has(firstLine(e)));
        if (ours.length) throw new Error(`page errors:\n${ours.join("\n---\n")}`);
        results.push({ name, ok: true });
      } catch (err) {
        results.push({ name, ok: false, detail: String(err?.stack ?? err) });
      }
      stage().replaceChildren();
    }
    const [first, second] = subVolumes();

    // A control: Home Assistant's own tile card editor, hosted the same way.
    // If this one has page errors, the harness is missing something.
    await test("control: Home Assistant's tile card editor, hosted the same way", async () => {
      if (!lovelace()) throw new Error("no lovelace object found on the dashboard");
      const helpers = await window.loadCardHelpers();
      helpers.createCardElement({ type: "tile", entity: first });
      await customElements.whenDefined("hui-tile-card");
      const { el } = hosted((await customElements.get("hui-tile-card").getConfigElement()).tagName.toLowerCase());
      el.setConfig({ type: "tile", entity: first, state_content: ["state"] });
      await until(() => el.shadowRoot?.querySelector("ha-form"), "the tile card editor");
      await sleep(500);
    }, { control: true });

    await test("card shows the driver and the Bluetooth badge", async () => {
      const card = document.createElement("svs-subwoofer-card");
      card.setConfig({ type: "custom:svs-subwoofer-card", entity: first, features: [{ type: "custom:svs-subwoofer-volume" }] });
      card.hass = hass();
      stage().append(card);
      await until(() => card.shadowRoot.querySelector("hui-tile-card")?.shadowRoot?.querySelector("ha-tile-icon"), "the tile card");
      const img = await until(() => card.shadowRoot.querySelector("hui-tile-card").shadowRoot.querySelector("ha-tile-icon")
        .shadowRoot?.querySelector("img"), "the driver picture");
      if (!img.src.startsWith("data:image/svg")) throw new Error(`the icon is not the driver: ${img.src.slice(0, 40)}`);
      await until(() => card.shadowRoot.querySelector(".badge.on"), "the Bluetooth badge");
    });

    await test("card editor: a removed state content stays removed", async () => {
      const { el, saved } = hosted("svs-subwoofer-card-editor");
      el.setConfig({ type: "custom:svs-subwoofer-card", entity: first, state_content: ["state", "preset", "standby_mode"] });
      const tile = await tileEditorIn(el);
      setFormValue(mainForm(tile), { state_content: ["state", "preset"] });
      await until(() => same(tile._config?.state_content, ["state", "preset"]), "the form to show two state contents");
      expectEqual(saved.at(-1).state_content, ["state", "preset"], "saved state content");
    });

    await test("card editor: an added feature appears in the list", async () => {
      const { el, saved } = hosted("svs-subwoofer-card-editor");
      el.setConfig({ type: "custom:svs-subwoofer-card", entity: first });
      const tile = await tileEditorIn(el);
      setFeatures(tile, [{ type: "custom:svs-subwoofer-volume" }]);
      await until(() => featuresEditor(tile)?.features?.length === 1, "the features list to show the new feature");
      expectEqual(saved.at(-1).features, [{ type: "custom:svs-subwoofer-volume" }], "saved features");
    });

    await test("panel editor: the card above numbered tabs, duplicate, and edits that stay", async () => {
      if (!second) throw new Error("two subwoofers are needed");
      const { el, saved } = hosted("svs-subwoofer-panel-card-editor");
      const thresholds = [{ below: -20, color: "green" }, { color: "red" }];
      el.setConfig({
        type: "custom:svs-subwoofer-panel-card", entity: groupVolume() ?? first,
        features: [{ type: "custom:svs-subwoofer-volume", min: -50, max: 0, volume_thresholds: thresholds }],
        members: [{ entity: first, state_content: ["state", "preset", "standby_mode"], features: [{ type: "custom:svs-subwoofer-volume" }], features_position: "inline" }],
      });
      const tabs = () => [...el.shadowRoot.querySelectorAll(".tab")];
      await until(() => tabs().length === 1, "the tabs");
      expectEqual(tabs().map((t) => t.textContent), ["1"], "tab labels");
      const heading = el.shadowRoot.querySelector("h3");
      expectEqual(heading?.textContent, "Subwoofers in the collapsible section", "the heading above the tabs");
      // The main subwoofer's editor is in a collapsed section above the heading, not on a tab
      const section = el.shadowRoot.querySelector("ha-expansion-panel");
      expectEqual(section?.getAttribute("header"), "Main subwoofer", "the main subwoofer's section");
      if (section.expanded) throw new Error("the main subwoofer's section starts expanded");
      const cardAbove = section.querySelector("svs-subwoofer-card-editor");
      if (!cardAbove) throw new Error("the card's editor is not in the main subwoofer's section");
      if (!(section.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING)) throw new Error("the main subwoofer's section is not before the heading");

      // A subwoofer's tab (the first one is open): its volume settings can
      // copy the main subwoofer's
      const tile = await tileEditorIn(el);
      expectEqual(tile.svsMainVolume?.(), { type: "custom:svs-subwoofer-volume", min: -50, max: 0, volume_thresholds: thresholds }, "the main subwoofer's volume offered to the row");

      // State content and features stay as edited
      setFormValue(mainForm(tile), { state_content: ["state", "preset"] });
      await until(() => same(tile._config?.state_content, ["state", "preset"]), "the row's form to show two state contents");
      expectEqual(saved.at(-1).members[0].state_content, ["state", "preset"], "saved row state content");
      setFeatures(tile, [{ type: "custom:svs-subwoofer-volume" }, { type: "custom:svs-subwoofer-presets", style: "presets_cycle" }]);
      await until(() => featuresEditor(tile)?.features?.length === 2, "the row's features list to show two features");
      expectEqual(saved.at(-1).members[0].features.length, 2, "saved row features");

      // Duplicate: the copy takes the next subwoofer
      const duplicate = [...el.shadowRoot.querySelectorAll("ha-icon-button")].find((b) => b.label === "Duplicate");
      if (!duplicate) throw new Error("no Duplicate button");
      duplicate.click();
      await until(() => tabs().length === 2, "a second tab");
      expectEqual(tabs().map((t) => t.textContent), ["1", "2"], "tab labels after duplicating");
      expectEqual(saved.at(-1).members.map((m) => m.entity), [first, second], "the rows' subwoofers");
      expectEqual(saved.at(-1).members[1].state_content, ["state", "preset"], "the copy's state content");

      // The card: its edits stay, and the rows are kept
      const cardTile = await tileEditorIn(cardAbove);
      setFormValue(mainForm(cardTile), { state_content: ["state"] });
      await until(() => same(cardTile._config?.state_content, ["state"]), "the card's form to show one state content");
      expectEqual(saved.at(-1).state_content, ["state"], "saved card state content");
      expectEqual(saved.at(-1).members.length, 2, "rows kept after a card edit");
    });

    await test("unknown options are errors", async () => {
      const panel = document.createElement("svs-subwoofer-panel-card");
      let message = "";
      try {
        panel.setConfig({ type: "custom:svs-subwoofer-panel-card", entity: first, member_features: ["volume"] });
      } catch (err) {
        message = String(err.message);
      }
      if (!message.includes("member_features")) throw new Error(`no error for member_features (got "${message}")`);
      const card = document.createElement("svs-subwoofer-card");
      message = "";
      try {
        card.setConfig({ type: "custom:svs-subwoofer-card", entity: first, finish_area: "card" });
      } catch (err) {
        message = String(err.message);
      }
      if (!message.includes("finish_area")) throw new Error(`no error for finish_area (got "${message}")`);
    });

    await test("volume editor: an emptied field stays empty", async () => {
      const { el, saved } = hosted("svs-subwoofer-volume-editor");
      el.setConfig({ type: "custom:svs-subwoofer-volume", min: -40 });
      const form = await until(() => el.querySelector("ha-form"), "the form");
      setFormValue(form, { min: undefined });
      await sleep(300);
      if (form.data.min !== undefined) throw new Error(`the field was refilled with ${form.data.min}`);
      if (!saved.length) throw new Error("nothing was saved");
    });

    await test("volume: a cancelled drag ends where it was, not at the left end", async () => {
      const calls = [];
      const feature = document.createElement("svs-subwoofer-volume");
      feature.setConfig({ type: "custom:svs-subwoofer-volume", min: -30 });
      feature.hass = { ...hass(), callService: (domain, service, data) => calls.push(data) };
      feature.context = { entity_id: first };
      stage().append(feature);
      const control = await until(() => feature.shadowRoot.querySelector(".control"), "the slider");
      // A drag at the right end (0 dB), then the browser cancels it (its
      // cancel event reports position 0)
      feature._dragging = 0;
      control.dispatchEvent(new PointerEvent("pointercancel", { clientX: 0, bubbles: true }));
      expectEqual(calls.map((c) => c.value), [0], "the value sent");
    });

    await test("volume: the value callout shows above the slider, and nothing clips it", async () => {
      const card = document.createElement("svs-subwoofer-card");
      card.setConfig({
        type: "custom:svs-subwoofer-card", entity: first, finish: "black_ash",
        features: [{ type: "custom:svs-subwoofer-volume" }],
      });
      card.hass = { ...hass(), callService: () => {} };
      stage().append(card);
      const feature = await until(() => findDeep(card.shadowRoot, "svs-subwoofer-volume"), "the volume slider");
      const control = await until(() => feature.shadowRoot.querySelector(".control[aria-valuenow]"), "the slider's value");
      const tooltip = feature.shadowRoot.querySelector(".tooltip");
      if (control.contains(tooltip)) throw new Error("the callout is inside the control, which clips");
      control.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
      await until(() => tooltip.classList.contains("visible"), "the callout to show");
      if (!/dB$/.test(tooltip.textContent)) throw new Error(`the callout says "${tooltip.textContent}"`);
      const tip = tooltip.getBoundingClientRect(), slider = control.getBoundingClientRect();
      if (tip.bottom > slider.top) throw new Error("the callout is not above the slider");
      // Only the finish is clipped to the card's outline, not the tile card
      const frame = card.shadowRoot.querySelector(".frame");
      if (getComputedStyle(frame).overflow !== "visible") throw new Error("the card's frame clips its tile card");
      if (getComputedStyle(card.shadowRoot.querySelector(".clip")).overflow !== "hidden") throw new Error("the finish is not clipped to the outline");
      const panel = document.createElement("svs-subwoofer-panel-card");
      panel.setConfig({ type: "custom:svs-subwoofer-panel-card", entity: first, finish: "black_ash", members: [{ entity: first }] });
      panel.hass = hass();
      stage().append(panel);
      const box = await until(() => panel.shadowRoot.querySelector(".panel"), "the panel");
      if (getComputedStyle(box).overflow !== "visible") throw new Error("the panel clips its rows");
      await until(() => !tooltip.classList.contains("visible"), "the callout to hide after the key", 3000);
    });

    await test("volume editor: copies the main subwoofer's volume in a panel row only", async () => {
      const main = { type: "custom:svs-subwoofer-volume", min: -40, volume_thresholds: [{ below: -20, color: "green" }, { color: "red" }] };
      // Outside a panel row: no copy button
      const alone = hosted("svs-subwoofer-volume-editor").el;
      alone.setConfig({ type: "custom:svs-subwoofer-volume" });
      const aloneCopy = await until(() => alone.querySelector("ha-button"), "the copy button");
      if (!aloneCopy.hidden) throw new Error("the copy button shows outside a panel row");
      // In a row (an ancestor offers the main subwoofer's volume)
      const row = document.createElement("div");
      row.svsMainVolume = () => main;
      stage().append(row);
      const el = document.createElement("svs-subwoofer-volume-editor");
      el.hass = hass();
      const saved = [];
      el.addEventListener("config-changed", (ev) => {
        saved.push(ev.detail.config);
        el.setConfig(ev.detail.config);
      });
      row.append(el);
      el.setConfig({ type: "custom:svs-subwoofer-volume", max: -5 });
      const copy = await until(() => !el.querySelector("ha-button")?.hidden && el.querySelector("ha-button"), "the copy button");
      expectEqual(copy.textContent, "Copy from main", "the copy button's label");
      copy.click();
      await until(() => saved.length, "a save");
      expectEqual(saved.at(-1), main, "the copied settings");
      await until(() => el.querySelector("ha-form").data.min === -40, "the form to show the copied settings");
    });

    await test("presets editor: reordered presets keep their order", async () => {
      const { el, saved } = hosted("svs-subwoofer-presets-editor", { context: { entity_id: first } });
      el.setConfig({ type: "custom:svs-subwoofer-presets" });
      const form = await until(() => el.querySelector("ha-form")?.data?.presets_shown?.length, "the form") && el.querySelector("ha-form");
      const reversed = [...form.data.presets_shown].reverse();
      setFormValue(form, { presets_shown: reversed });
      await until(() => same(form.data.presets_shown, reversed), "the form to keep the new order");
      expectEqual(saved.at(-1).presets_shown, reversed, "saved order");
    });

    await test("presets editor: Default is left out, with no color or icon of its own", async () => {
      const { el } = hosted("svs-subwoofer-presets-editor", { context: { entity_id: first } });
      el.setConfig({ type: "custom:svs-subwoofer-presets" });
      const form = await until(() => el.querySelector("ha-form")?.data?.presets_shown?.length && el.querySelector("ha-form"), "the form");
      const options = form.schema.find((s) => s.name === "presets_shown").selector.select.options;
      if (!options.includes("Default")) throw new Error(`the fake subwoofer has no Default preset (options ${JSON.stringify(options)})`);
      if (form.data.presets_shown.includes("Default")) throw new Error("Default is shown by default");
      const names = JSON.stringify(form.schema);
      if (names.includes("color_Default") || names.includes("icon_Default")) throw new Error("Default has a color or icon field");
    });

    await test("entity pickers offer only SVS Subwoofer volumes", async () => {
      const entityField = (schema) => {
        for (const item of schema ?? []) {
          if (item.name === "entity") return item;
          const inner = entityField(item.schema);
          if (inner) return inner;
        }
        return undefined;
      };
      const offered = (tile) => entityField(mainForm(tile).schema)?.selector?.entity?.include_entities;
      const { el } = hosted("svs-subwoofer-card-editor");
      el.setConfig({ type: "custom:svs-subwoofer-card", entity: first });
      const tile = await tileEditorIn(el);
      const cardList = await until(() => offered(tile), "the card's entity list");
      expectEqual(cardList, [...subVolumes(), ...(groupVolume() ? [groupVolume()] : [])].sort(), "the card's entities");

      stage().replaceChildren();
      const panel = hosted("svs-subwoofer-panel-card-editor").el;
      panel.setConfig({ type: "custom:svs-subwoofer-panel-card", entity: groupVolume() ?? first, members: [{ entity: first }] });
      const row = await tileEditorIn(panel);
      expectEqual(await until(() => offered(row), "the row's entity list"), subVolumes(), "a row's entities");
    });

    await test("standby: the selected mode's text is readable from the first render", async () => {
      const card = document.createElement("svs-subwoofer-card");
      card.setConfig({
        type: "custom:svs-subwoofer-card", entity: first, finish: "gloss_white", features_style: "match",
        features: [{ type: "custom:svs-subwoofer-standby" }],
      });
      card.hass = hass();
      card.style.setProperty("--feature-color", "#ffffff");
      stage().append(card);
      const standby = await until(() => findDeep(card.shadowRoot, "svs-subwoofer-standby")?.style.getPropertyValue("--svs-on-color") && findDeep(card.shadowRoot, "svs-subwoofer-standby"), "the standby text color");
      const color = standby.style.getPropertyValue("--svs-on-color");
      const featureColor = getComputedStyle(standby).getPropertyValue("--feature-color").trim();
      if (/^#f/i.test(featureColor) && color === "#fff") throw new Error(`white text on the feature color ${featureColor}`);
      const labels = [...(standby.shadowRoot ?? standby).querySelectorAll("*")].map((e) => e.textContent).join("|");
      if (/Auto On/.test(labels)) throw new Error("the card says Auto On, not Auto");
    });

    return results;
  };

  // The cards in every finish, for screenshots; returns the area to capture
  window.svsUiGallery = async () => {
    const [first, second] = subVolumes();
    const box = stage();
    box.replaceChildren();
    const features = [
      { type: "custom:svs-subwoofer-presets" },
      { type: "custom:svs-subwoofer-volume", volume_thresholds: [{ below: -30, color: "green" }, { below: -15, color: "yellow" }, { color: "red" }] },
      { type: "custom:svs-subwoofer-standby" },
    ];
    const looks = [
      ["none", "match"], ["black_ash", "match"], ["black_ash", "inset"], ["black_oak", "flat"],
      ["gloss_black", "match"], ["gloss_white", "inset"], ["fabric", "match"], ["grille", "inset"],
    ];
    for (const [finish, style] of looks) {
      const card = document.createElement("svs-subwoofer-card");
      card.setConfig({
        type: "custom:svs-subwoofer-card", entity: first, name: `${finish} · ${style}`,
        state_content: ["state", "preset", "standby_mode"], features, features_position: "inline",
        finish, features_style: style, standby_badge: true,
      });
      card.hass = hass();
      box.append(card);
    }
    // The plain loupe (no thresholds), and no ring around the driver
    const plain = document.createElement("svs-subwoofer-card");
    plain.setConfig({
      type: "custom:svs-subwoofer-card", entity: first, name: "black_oak · inset · no thresholds, no ring",
      features: [{ type: "custom:svs-subwoofer-volume" }], features_position: "inline",
      finish: "black_oak", features_style: "inset", driver_ring: false,
    });
    plain.hass = hass();
    box.append(plain);
    if (second) {
      const panel = document.createElement("svs-subwoofer-panel-card");
      panel.setConfig({
        type: "custom:svs-subwoofer-panel-card", entity: groupVolume() ?? first, name: "Panel",
        finish: "black_ash", features_style: "match", features: [{ type: "custom:svs-subwoofer-presets" }, features[1]], features_position: "inline",
        members: [first, second].map((entity) => ({
          entity, state_content: ["state", "preset"], features: [{ type: "custom:svs-subwoofer-volume" }], features_position: "inline",
        })),
      });
      panel.hass = hass();
      box.append(panel);
    }
    await sleep(2500);
    const rect = box.getBoundingClientRect();
    return { x: rect.left + window.scrollX, y: rect.top + window.scrollY, width: Math.ceil(rect.width), height: Math.ceil(rect.height) };
  };
})();
