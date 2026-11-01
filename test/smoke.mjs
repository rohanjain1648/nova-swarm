/**
 * Headless smoke test — CI-style confidence that the built game boots, loads
 * its 3D robot asset, renders, and survives a real play session without
 * runtime errors.
 *
 * It self-hosts the production build via Vite's preview server, drives the
 * game with Playwright (wait for the GLB to load past the "loading" state →
 * start → play ~20s auto-picking upgrades → reach a level-up), and fails
 * (non-zero exit) on any console error, page error, or if the core loop
 * never advances. WebGL needs to be explicitly enabled for headless Chromium
 * (via SwiftShader software rendering) since it's off by default.
 *
 * Prereqs:  npm run build   &&   npx playwright install chromium
 * Run:      npm run smoke
 */
import { preview } from "vite";
import { chromium } from "playwright";

const server = await preview({ preview: { port: 4187, strictPort: true } });
const url = server.resolvedUrls.local[0];
const errors = [];
let exitCode = 0;

const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-webgl"] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push("console: " + m.text());
  });

  await page.goto(url + "?debug", { waitUntil: "networkidle" });

  // Wait for the RobotExpressive.glb fetch + Three.js scene setup to finish.
  await page.waitForFunction(() => window.__nova && window.__nova().state !== "loading", {
    timeout: 20000,
  });

  const boot = await page.evaluate(() => window.__nova());
  if (boot.state !== "menu") throw new Error(`expected menu after load, got "${boot.state}"`);

  // WebGL must have actually produced a context (not silently no-op'd).
  const gl = await page.evaluate(() => {
    const c = document.getElementById("scene");
    return !!(c && (c.getContext("webgl2") || c.getContext("webgl")));
  });
  if (!gl) throw new Error("WebGL context unavailable — 3D scene cannot render");

  await page.mouse.click(640, 500); // start (Play button)
  await page.waitForTimeout(300);

  // Play ~22s: ping-pong to survive + collect XP, auto-pick upgrades.
  let dir = "d";
  await page.keyboard.down(dir);
  let sawLevelUp = false;
  let maxTime = 0;
  for (let i = 0; i < 48; i++) {
    await page.keyboard.press("Digit1");
    await page.waitForTimeout(450);
    if (i % 11 === 10) {
      await page.keyboard.up(dir);
      dir = dir === "d" ? "a" : "d";
      await page.keyboard.down(dir);
    }
    const s = await page.evaluate(() => window.__nova());
    maxTime = Math.max(maxTime, s.time);
    if (s.level > 1) sawLevelUp = true;
  }

  if (maxTime < 5) throw new Error(`sim time did not advance (t=${maxTime})`);
  if (!sawLevelUp) throw new Error("never reached level 2 — XP/leveling broken");
  console.log(`OK: sim advanced to t=${maxTime}s, leveled up, no runtime errors`);
} catch (e) {
  console.error("SMOKE FAIL:", e.message);
  exitCode = 1;
} finally {
  await browser.close();
  await new Promise((r) => server.httpServer.close(r));
}

if (errors.length) {
  console.error("Runtime errors:\n  " + errors.join("\n  "));
  exitCode = 1;
}
process.exit(exitCode);
