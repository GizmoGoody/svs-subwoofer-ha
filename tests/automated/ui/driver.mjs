/**
 * Drives a headless Chrome through the Chrome DevTools Protocol, with no
 * packages to install: Node's built-in WebSocket and fetch.
 *
 * Usage: node driver.mjs <home assistant url> <access token> <output dir> <page script>
 *
 * Opens Home Assistant logged in with the token, loads the page script
 * (which defines window.svsUiTests and window.svsUiGallery), runs the tests,
 * and saves report.json plus screenshots of the gallery in light and dark.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [, , url, token, outDir, pageScript] = process.argv;
const chrome = process.env.CHROME ?? "google-chrome";
const port = 9333;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(outDir, { recursive: true });

const browser = spawn(chrome, [
  "--headless=new", `--remote-debugging-port=${port}`,
  `--user-data-dir=${mkdtempSync(join(tmpdir(), "svs-chrome-"))}`,
  "--no-sandbox", "--disable-gpu", "--window-size=1280,2400", "about:blank",
], { stdio: "ignore" });

let socket;
try {
  let page;
  for (let i = 0; i < 100 && !page; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      page = list.find((t) => t.type === "page");
    } catch {
      await sleep(100);
    }
  }
  if (!page) throw new Error("Chrome did not start");

  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });
  let nextId = 0;
  const pending = new Map();
  const logs = [];
  socket.onmessage = (message) => {
    const data = JSON.parse(message.data);
    if (data.id && pending.has(data.id)) {
      const { resolve, reject } = pending.get(data.id);
      pending.delete(data.id);
      if (data.error) reject(new Error(data.error.message));
      else resolve(data.result);
    } else if (data.method === "Runtime.consoleAPICalled") {
      logs.push(`${data.params.type}: ${data.params.args.map((a) => a.value ?? a.description).join(" ")}`);
    } else if (data.method === "Runtime.exceptionThrown") {
      const d = data.params.exceptionDetails;
      logs.push(`exception: ${d.exception?.description ?? d.exception?.value ?? d.text} at ${d.url ?? ""}:${d.lineNumber}`);
    }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    }
    return result.result.value;
  };

  await send("Page.enable");
  await send("Runtime.enable");
  // Logged in: the frontend reads its tokens from local storage
  const base = new URL(url).origin;
  const tokens = {
    access_token: token, token_type: "Bearer", expires_in: 86400,
    hassUrl: base, clientId: `${base}/`, expires: Date.now() + 86400000, refresh_token: "",
  };
  await send("Page.addScriptToEvaluateOnNewDocument", {
    source: `localStorage.setItem("hassTokens", ${JSON.stringify(JSON.stringify(tokens))});`,
  });
  await send("Page.navigate", { url: `${base}/` });
  // The card file, from the address the integration serves it at (current
  // Home Assistant opens its Home dashboard, which loads no dashboard resources)
  const loaded = await evaluate(`(async () => {
    let imported = false;
    for (let i = 0; i < 600; i++) {
      const hass = document.querySelector("home-assistant")?.hass;
      if (hass?.connected && !imported) {
        imported = true;
        await import("/svs_subwoofer/svs-subwoofer-card.js");
      }
      if (hass?.connected && customElements.get("svs-subwoofer-card")) return { ok: true };
      await new Promise((r) => setTimeout(r, 100));
    }
    const hass = document.querySelector("home-assistant")?.hass;
    return {
      ok: false, url: location.href, title: document.title,
      app: !!document.querySelector("home-assistant"), hass: !!hass, connected: !!hass?.connected,
      card: !!customElements.get("svs-subwoofer-card"),
      resources: [...document.querySelectorAll("script")].map((s) => s.src).filter(Boolean),
      body: document.body?.innerText?.slice(0, 500),
    };
  })()`);
  if (!loaded.ok) {
    const shot = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(outDir, "not-loaded.png"), Buffer.from(shot.data, "base64"));
    writeFileSync(join(outDir, "console.log"), logs.join("\n"));
    throw new Error(`Home Assistant or the SVS Subwoofer card did not load: ${JSON.stringify(loaded)}`);
  }
  await evaluate(readFileSync(pageScript, "utf8"));

  const report = await evaluate("window.svsUiTests()");
  writeFileSync(join(outDir, "report.json"), JSON.stringify(report, null, 2));

  // Screenshots of the gallery, in the light and the dark scheme
  for (const scheme of ["light", "dark"]) {
    await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }] });
    await sleep(600);
    const rect = await evaluate("window.svsUiGallery()");
    const shot = await send("Page.captureScreenshot", {
      format: "png", captureBeyondViewport: true,
      clip: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, scale: 1 },
    });
    writeFileSync(join(outDir, `gallery-${scheme}.png`), Buffer.from(shot.data, "base64"));
  }
  writeFileSync(join(outDir, "console.log"), logs.join("\n"));
  console.log(JSON.stringify(report, null, 2));
} catch (err) {
  writeFileSync(join(outDir, "report.json"), JSON.stringify([{ name: "driver", ok: false, detail: String(err?.stack ?? err) }], null, 2));
  console.error(err);
} finally {
  socket?.close();
  browser.kill();
}
