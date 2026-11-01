/**
 * Two-browser co-op smoke test — proves a real host and a real joiner can
 * meet through the relay and play one run together.
 *
 * It starts the relay (server/) on a spare port, builds the game with
 * VITE_RELAY_URL pointing at it (into dist-coop/, leaving dist/ alone), serves
 * that build, and drives two isolated Playwright browser contexts:
 *
 *   A hosts -> B joins via the ?room= invite link -> both see 2 players in the
 *   lobby -> A starts -> both reach "playing" -> B's movement shows up on A ->
 *   both fight until a squad level-up huddle resolves on both screens.
 *
 * Fails (non-zero exit) on any console/page error in either browser.
 *
 * Prereqs:  npm --prefix server install   &&   npx playwright install chromium
 * Run:      npm run smoke:coop      (SHOT_DIR=<dir> also saves screenshots)
 */
import { spawn, execSync } from "node:child_process";
import { build, preview } from "vite";
import { chromium } from "playwright";

const RELAY_PORT = 8788;
const WEB_PORT = 4188;
const SHOT_DIR = process.env.SHOT_DIR;
const errors = [];
let exitCode = 0;

// ---- Relay -------------------------------------------------------------------
const relayProc = spawn("npm", ["--prefix", "server", "start"], {
  env: { ...process.env, PORT: String(RELAY_PORT) },
  shell: true,
  stdio: ["ignore", "pipe", "pipe"],
});
relayProc.stderr.on("data", (d) => process.stderr.write(`[relay] ${d}`));
function stopRelay() {
  if (relayProc.exitCode !== null) return;
  if (process.platform === "win32") {
    try {
      execSync(`taskkill /pid ${relayProc.pid} /T /F`, { stdio: "ignore" });
    } catch {
      /* already gone */
    }
  } else {
    relayProc.kill("SIGTERM");
  }
}
async function waitForRelay() {
  const end = Date.now() + 30_000;
  while (Date.now() < end) {
    try {
      const res = await fetch(`http://localhost:${RELAY_PORT}/health`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("relay did not come up");
}

// ---- Helpers -------------------------------------------------------------------
const nova = (page) => page.evaluate(() => window.__nova());
async function waitFor(page, pred, what, timeout = 20_000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    last = await nova(page);
    if (pred(last)) return last;
    await page.waitForTimeout(150);
  }
  throw new Error(`timed out waiting for ${what} (last: ${JSON.stringify({ state: last?.state, mode: last?.mode, roster: last?.roster, coop: last?.coop })})`);
}
const center = (r) => [r.x + r.w / 2, r.y + r.h / 2];
async function shot(page, name) {
  if (SHOT_DIR) await page.screenshot({ path: `${SHOT_DIR}/${name}.png` });
}

let server;
let browser;
try {
  await waitForRelay();
  process.env.VITE_RELAY_URL = `ws://localhost:${RELAY_PORT}`;
  await build({ logLevel: "warn", build: { outDir: "dist-coop" } });
  server = await preview({ logLevel: "warn", build: { outDir: "dist-coop" }, preview: { port: WEB_PORT, strictPort: true } });
  const url = server.resolvedUrls.local[0];

  browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-webgl"] });
  const open = async (label, path) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`${label} pageerror: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(`${label} console: ${m.text()}`);
    });
    await page.goto(url + path, { waitUntil: "networkidle" });
    return page;
  };

  // A: host a room.
  const a = await open("A", "?debug");
  const aMenu = await waitFor(a, (s) => s.state === "menu" && s.coop === "ready", "A menu with co-op ready", 30_000);
  await shot(a, "1-title");
  await a.mouse.click(...center(aMenu.ui.title.host));
  const aLobby = await waitFor(a, (s) => s.state === "lobby" && s.code, "A in lobby with a code");
  const code = aLobby.code;

  // B: join through the invite link.
  const b = await open("B", `?debug&room=${code.toLowerCase()}`);
  await waitFor(b, (s) => s.state === "lobby" && s.mode === "client", "B in lobby", 30_000);
  await waitFor(a, (s) => s.roster === 2, "A roster of 2");
  await waitFor(b, (s) => s.roster === 2, "B roster of 2");
  await shot(a, "2-lobby");

  // A starts the run; both should be playing with 2 active players.
  await a.mouse.click(...center(aLobby.ui.lobby.start));
  await waitFor(a, (s) => s.state === "playing" && s.players === 2, "A playing with 2 players");
  await waitFor(b, (s) => s.state === "playing" && s.players === 2, "B playing with 2 players");

  // B walks right; A must see (most of) the distance B's own screen moved.
  // Compare against B's local delta, not wall-clock speed: two software-GL
  // browsers can run at a few fps, and the game loop drops sim time per frame.
  const before = (await nova(a)).peers.find((p) => p.slot === 1);
  const bBefore = (await nova(b)).px;
  await b.keyboard.down("d");
  await b.waitForTimeout(2000);
  await b.keyboard.up("d");
  await b.waitForTimeout(800);
  const after = (await nova(a)).peers.find((p) => p.slot === 1);
  const bMoved = (await nova(b)).px - bBefore;
  const aSaw = after && before ? after.x - before.x : 0;
  if (bMoved < 40 || aSaw < bMoved * 0.7) {
    throw new Error(`host did not see the joiner move (joiner moved ${bMoved}, host saw ${aSaw})`);
  }
  await shot(b, "3-joiner-view");

  // Both fight (mouse held = aim + fire), ping-ponging, picking cards when offered.
  for (const p of [a, b]) {
    await p.mouse.move(900, 400);
    await p.mouse.down();
  }
  const dirs = { a: "d", b: "a" };
  await a.keyboard.down(dirs.a);
  await b.keyboard.down(dirs.b);
  let aLevel = false;
  let bLevel = false;
  let sawHuddle = false;
  for (let i = 0; i < 120 && !(aLevel && bLevel); i++) {
    await a.waitForTimeout(350);
    if (i % 10 === 9) {
      for (const [k, p] of [["a", a], ["b", b]]) {
        await p.keyboard.up(dirs[k]);
        dirs[k] = dirs[k] === "d" ? "a" : "d";
        await p.keyboard.down(dirs[k]);
      }
    }
    const [sa, sb] = [await nova(a), await nova(b)];
    // Pick a card only on a screen that is actually showing the huddle cards.
    for (const [s, p] of [[sa, a], [sb, b]]) {
      if (s.state !== "levelup") continue;
      if (!sawHuddle) await shot(p, "4-huddle");
      sawHuddle = true;
      await p.keyboard.press("Digit1");
    }
    if (sa.state === "gameover" || sb.state === "gameover") throw new Error("squad wiped before reaching level 2");
    // Level counts once the huddle has closed again on that screen.
    if (sa.level > 1 && sa.state === "playing" && sa.pending === 0) aLevel = true;
    if (sb.level > 1 && sb.state === "playing") bLevel = true;
  }
  await a.keyboard.up(dirs.a);
  await b.keyboard.up(dirs.b);
  await shot(a, "5-host-view");
  if (!aLevel || !bLevel) throw new Error(`no completed squad level-up (host=${aLevel} joiner=${bLevel})`);
  if (!sawHuddle) throw new Error("level rose without either player seeing the level-up cards");

  const fa = await nova(a);
  console.log(`OK: room ${code}, 2 players, joiner movement seen by host, squad reached Lv ${fa.level} at t=${fa.time}s, no runtime errors`);
} catch (e) {
  console.error("COOP SMOKE FAIL:", e.message);
  exitCode = 1;
} finally {
  await browser?.close();
  if (server) await new Promise((r) => server.httpServer.close(r));
  stopRelay();
}

if (errors.length) {
  console.error("Runtime errors:\n  " + errors.join("\n  "));
  exitCode = 1;
}
process.exit(exitCode);
