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

  // An editor as the dashboard hosts it: every saved configuration is
  // handed back to it, and kept here for the test to check
  function hosted(type, extra = {}) {
    const el = document.createElement(type);
    Object.assign(el, extra);
    el.hass = hass();
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
    async function test(name, fn) {
      errors = [];
      try {
        await fn();
        await sleep(200);
        if (errors.length) throw new Error(`page errors:\n${errors.join("\n---\n")}`);
        results.push({ name, ok: true });
      } catch (err) {
        results.push({ name, ok: false, detail: String(err?.stack ?? err) });
      }
      stage().replaceChildren();
    }
    const [first, second] = subVolumes();

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

    await test("panel editor: numbered tabs, duplicate, and edits that stay", async () => {
      if (!second) throw new Error("two subwoofers are needed");
      const { el, saved } = hosted("svs-subwoofer-panel-card-editor");
      el.setConfig({
        type: "custom:svs-subwoofer-panel-card", entity: groupVolume() ?? first,
        members: [{ entity: first, state_content: ["state", "preset", "standby_mode"], features: [{ type: "custom:svs-subwoofer-volume" }], features_position: "inline" }],
      });
      const tabs = () => [...el.shadowRoot.querySelectorAll(".tab")];
      await until(() => tabs().length === 2, "the tabs");
      expectEqual(tabs().map((t) => t.textContent), ["Card", "1"], "tab labels");

      // A subwoofer's tab: state content and features stay as edited
      tabs()[1].click();
      const tile = await tileEditorIn(el);
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
      await until(() => tabs().length === 3, "a third tab");
      expectEqual(tabs().map((t) => t.textContent), ["Card", "1", "2"], "tab labels after duplicating");
      expectEqual(saved.at(-1).members.map((m) => m.entity), [first, second], "the rows' subwoofers");
      expectEqual(saved.at(-1).members[1].state_content, ["state", "preset"], "the copy's state content");

      // The Card tab: its edits stay, and the rows are kept
      tabs()[0].click();
      const cardEditor = await until(() => el.shadowRoot.querySelector("svs-subwoofer-card-editor"), "the card's editor");
      const cardTile = await tileEditorIn(cardEditor);
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

    await test("presets editor: reordered presets keep their order", async () => {
      const { el, saved } = hosted("svs-subwoofer-presets-editor", { context: { entity_id: first } });
      el.setConfig({ type: "custom:svs-subwoofer-presets" });
      const form = await until(() => el.querySelector("ha-form")?.data?.presets_shown?.length, "the form") && el.querySelector("ha-form");
      const reversed = [...form.data.presets_shown].reverse();
      setFormValue(form, { presets_shown: reversed });
      await until(() => same(form.data.presets_shown, reversed), "the form to keep the new order");
      expectEqual(saved.at(-1).presets_shown, reversed, "saved order");
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
