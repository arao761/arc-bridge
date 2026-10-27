import { chromium } from "playwright";
import electronPath from "electron";
import { Builder } from "selenium-webdriver";
import firefox from "selenium-webdriver/firefox.js";
import { download as downloadGecko } from "geckodriver";
import { mkdtemp, mkdir, cp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import assert from "node:assert/strict";
const temp = await mkdtemp(join(tmpdir(), "arc-bridge-live-test-"));
const suffix = randomUUID().replaceAll("-", "");
const extensionId = `arcbridge-smoke-${suffix}@local`,
  extensionUUID = randomUUID(),
  hostName = `dev.arcbridge.smoke_${suffix}`;
const nativeDir = join(
    homedir(),
    "Library/Application Support/Mozilla/NativeMessagingHosts",
  ),
  manifestFile = join(nativeDir, `${hostName}.json`);
let app,
  driver,
  desktopChild,
  inspection = null,
  command = null;
const server = createServer((req, res) => {
  if (req.url === "/inspect" && req.method === "POST") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        inspection = JSON.parse(body);
      } catch {}
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(command || {}));
      command = null;
    });
    return;
  }
  res.setHeader("Content-Type", "text/html");
  res.end(
    "<title>Synthetic migration fixture</title><p>Temporary integration test.</p>",
  );
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const base = `http://127.0.0.1:${server.address().port}`;
const wait = async (fn, label) => {
  for (let i = 0; i < 100; i++) {
    const result = await fn();
    if (result) return result;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw Error(`Timed out: ${label}`);
};
try {
  const portProbe = createServer();
  portProbe.listen(0, "127.0.0.1");
  await once(portProbe, "listening");
  const debugPort = portProbe.address().port;
  await new Promise((r) => portProbe.close(r));
  desktopChild = spawn(
    process.argv[2] ? resolve(process.argv[2]) : electronPath,
    [
      ...(process.argv[2] ? [] : ["."]),
      `--remote-debugging-port=${debugPort}`,
      "--hidden",
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PATH: "/usr/bin:/bin",
        ARCBRIDGE_TEST_DATA: join(temp, "data"),
        ARCBRIDGE_NATIVE_DIR: join(temp, "native"),
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let startup = "";
  desktopChild.stderr.on("data", (c) => (startup += c.toString()));
  await wait(async () => {
    if (desktopChild.exitCode !== null)
      throw Error(`Desktop exited: ${startup}`);
    return fetch(`http://127.0.0.1:${debugPort}/json/version`).then(
      (r) => r.ok,
      () => false,
    );
  }, "desktop CDP startup");
  app = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`);
  const page =
    app.contexts()[0].pages()[0] ||
    (await new Promise((resolve) => app.contexts()[0].once("page", resolve)));
  const rendererErrors = [];
  page.on("pageerror", (e) => rendererErrors.push(e.message));
  await page.waitForFunction(() => !!window.arcBridge);
  await page.evaluate(() => window.arcBridge.install());
  const original = JSON.parse(
    await readFile(join(temp, "native/dev.arcbridge.json"), "utf8"),
  );
  await mkdir(nativeDir, { recursive: true });
  await writeFile(
    manifestFile,
    JSON.stringify({
      ...original,
      name: hostName,
      allowed_extensions: [extensionId],
    }),
    { mode: 0o600 },
  );
  const ext = join(temp, "extension");
  await cp("dist-extension", ext, { recursive: true });
  const manifest = JSON.parse(
    await readFile(join(ext, "manifest.json"), "utf8"),
  );
  manifest.browser_specific_settings.gecko.id = extensionId;
  manifest.permissions.push("http://127.0.0.1/*");
  await writeFile(join(ext, "manifest.json"), JSON.stringify(manifest));
  const code = await readFile(join(ext, "background.js"), "utf8");
  await writeFile(
    join(ext, "background.js"),
    code.replaceAll("dev.arcbridge", hostName).replace(
      /\}\)\(\);\s*$/,
      `
;ready.then(async()=>{config={...config,label:'Isolated Firefox test',enabled:true};await browser.storage.local.set({receiver:config});await connect();setInterval(async()=>{try{const tabs=(await browser.tabs.query({})).filter(t=>t.url&&t.url.startsWith(${JSON.stringify(base)}));const response=await fetch(${JSON.stringify(base + "/inspect")},{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({receiver:config.id,tabs})});const command=await response.json();if(command.modifyJob){const key='job:'+command.modifyJob;const j=(await browser.storage.local.get(key))[key];const entry=Object.values(j.entries)[0];await browser.tabs.update(entry.tab.id,{url:${JSON.stringify(base + "/changed")}});await browser.bookmarks.update(entry.bookmark.id,{title:'User changed this bookmark'});}}catch{}},300);});
})();`,
    ),
  );
  const xpi = join(temp, "companion.zip");
  execFileSync("zip", ["-rq", xpi, "."], { cwd: ext });
  const gecko = await downloadGecko("0.37.1");
  const options = new firefox.Options()
    .setBinary("/Applications/Firefox.app/Contents/MacOS/firefox")
    .addArguments("-headless")
    .setPreference(
      "extensions.webextensions.uuids",
      JSON.stringify({ [extensionId]: extensionUUID }),
    )
    .setPreference("browser.shell.checkDefaultBrowser", false)
    .setPreference("browser.startup.homepage", "about:blank");
  driver = await new Builder()
    .forBrowser("firefox")
    .setFirefoxOptions(options)
    .setFirefoxService(new firefox.ServiceBuilder(gecko))
    .build();
  await driver.manage().setTimeouts({ script: 20000 });
  await driver.installAddon(xpi, true);
  const receiver = await wait(
    async () => inspection?.receiver,
    "extension receiver ID",
  );
  await wait(async () => {
    const s = await page.evaluate(() => window.arcBridge.state());
    return s.receivers.find((r) => r.id === receiver && r.online && r.enabled);
  }, "native messaging pairing");
  const operations = [0, 1].map((i) => ({
    sourceId: `synthetic-${i}`,
    targetProfileId: receiver,
    spaceId: `space-${i}`,
    spaceName: `Synthetic Space ${i}`,
    spaceMode: "windows",
    title: `Synthetic tab ${i}`,
    url: `${base}/tab-${i}`,
    pinned: i === 0,
    folder: ["Reference"],
  }));
  const job = {
    format: "arc-bridge-migration",
    version: 1,
    id: `smoke-${suffix}`,
    targetProfileId: receiver,
    operations,
  };
  await page.evaluate((jobs) => window.arcBridge.stage(jobs), [job]);
  const first = await wait(async () => {
    const s = await page.evaluate(() => window.arcBridge.state());
    const j = s.jobs.find((j) => j.id === job.id);
    if (j?.status === "failed") throw Error(j.error);
    return j?.status === "completed" ? j : null;
  }, "real Firefox migration");
  assert.equal(first.done, 2);
  const query = async () => inspection?.tabs || [];
  let tabs = await wait(async () => {
    const rows = await query();
    return rows.length === 2 ? rows : null;
  }, "inspection after tab creation");
  assert.equal(tabs.length, 2);
  assert.equal(tabs.filter((t) => t.pinned).length, 1);
  await page.evaluate((id) => window.arcBridge.control(id, "resume"), job.id);
  await wait(async () => {
    const s = await page.evaluate(() => window.arcBridge.state());
    return s.jobs.find((j) => j.id === job.id && j.status === "completed");
  }, "idempotent retry");
  assert.equal((await query()).length, 2);
  command = { modifyJob: job.id };
  await wait(async () => {
    const t = await query();
    return t.some((v) => v.url === `${base}/changed`);
  }, "changed browser item");
  await page.evaluate((id) => window.arcBridge.control(id, "undo"), job.id);
  const undone = await wait(async () => {
    const s = await page.evaluate(() => window.arcBridge.state());
    const j = s.jobs.find((j) => j.id === job.id);
    if (j?.status === "failed") throw Error(j.error);
    return j?.status === "undone" ? j : null;
  }, "ownership-scoped undo");
  assert.equal(undone.preserved, 2);
  await wait(async () => (await query()).length === 1, "inspection after undo");
  assert.equal((await query()).length, 1);
  assert.deepEqual(rendererErrors, []);
  await page.screenshot({ path: join(temp, "desktop.png") });
  console.log(
    JSON.stringify(
      {
        passed: true,
        temporaryFirefoxProfile: true,
        nativeMessaging: true,
        systemNodeRequired: false,
        rendererErrors: 0,
        actualTabsCreated: 2,
        pinnedTabs: 1,
        retryDidNotDuplicate: true,
        undoKeptModifiedResources: 2,
        desktopRuntime: process.argv[2] ? "packaged" : "development",
      },
      null,
      2,
    ),
  );
} finally {
  await driver?.quit().catch(() => {});
  await app?.close().catch(() => {});
  desktopChild?.kill("SIGTERM");
  await rm(manifestFile, { force: true });
  await new Promise((r) => server.close(r));
  await rm(temp, { recursive: true, force: true });
}
