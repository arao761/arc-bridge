import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { webcrypto } from "node:crypto";
import { createRunner, summary, validateJob } from "../core/runner.mjs";
const tick = () => new Promise((resolve) => setImmediate(resolve));
test("companion serializes polling while downloading a plan", async () => {
  const values = {
    receiver: { id: "receiver", label: "Synthetic", enabled: true },
  };
  let messageListener,
    nativeListener,
    polls = 0,
    chunk;
  const port = {
    onMessage: {
      addListener: (fn) => {
        nativeListener = fn;
      },
    },
    onDisconnect: { addListener: () => {} },
    postMessage(m) {
      if (m.type === "chunk") {
        chunk = m;
        return;
      }
      let response = { ok: true };
      if (m.type === "poll") {
        polls++;
        response = {
          job: {
            id: "synthetic-job",
            runToken: "run",
            action: "migrate",
            total: 1,
          },
        };
      }
      queueMicrotask(() =>
        nativeListener({ ...response, requestId: m.requestId }),
      );
    },
  };
  const browser = {
    tabs: {},
    permissions: { contains: async () => false },
    storage: {
      local: {
        get: async (k) => ({ [k]: values[k] }),
        set: async (v) => Object.assign(values, v),
        remove: async (k) => {
          delete values[k];
        },
      },
    },
    runtime: {
      connectNative: () => port,
      onMessage: {
        addListener: (fn) => {
          messageListener = fn;
        },
      },
    },
  };
  const source = (await readFile("extension/background.mjs", "utf8")).replace(
    /^import[^\n]+\n/,
    "",
  );
  const context = vm.createContext({
    browser,
    crypto: webcrypto,
    createRunner,
    summary,
    validateJob,
    setTimeout,
    clearTimeout,
    setInterval: () => 0,
    queueMicrotask,
  });
  vm.runInContext(source + "\nglobalThis.audit={poll,ready};", context);
  await context.audit.ready;
  for (let i = 0; i < 50 && !chunk; i++) await tick();
  assert.ok(chunk, "first poll is waiting on a native chunk");
  await context.audit.poll();
  assert.equal(polls, 1, "another poll cannot download the same plan");
  await assert.rejects(
    messageListener({ type: "import", confirmed: true, job: {} }),
    /active receiver/,
  );
  nativeListener({
    requestId: chunk.requestId,
    cancelRequested: true,
    total: 1,
    operations: [],
  });
  for (let i = 0; i < 10; i++) await tick();
  assert.equal(values.lastReport.status, "cancelled");
});
test("selecting another migration file resets consent and shows its URLs", async () => {
  const elements = new Map();
  const node = (id) => {
    if (!elements.has(id))
      elements.set(id, {
        value: "",
        checked: false,
        disabled: false,
        textContent: "",
        files: [],
      });
    return elements.get(id);
  };
  const context = vm.createContext({
    document: { getElementById: node },
    browser: {
      tabs: {},
      runtime: {
        sendMessage: async () => ({
          config: { id: "receiver", label: "Synthetic", enabled: true },
          busy: false,
        }),
      },
    },
    setInterval: () => 0,
    window: { addEventListener: () => {} },
    confirm: () => true,
  });
  vm.runInContext(await readFile("extension/popup.js", "utf8"), context);
  await tick();
  node("confirm").checked = true;
  node("file").files = [
    {
      size: 100,
      text: async () =>
        JSON.stringify({
          format: "arc-bridge-migration",
          targetProfileId: "receiver",
          operations: [{ title: "Synthetic tab", url: "https://example.com/" }],
        }),
    },
  ];
  await node("file").onchange();
  assert.equal(node("confirm").checked, false);
  assert.equal(node("import").disabled, true);
  assert.match(node("preview").textContent, /https:\/\/example.com\//);
  node("confirm").checked = true;
  node("confirm").onchange();
  assert.equal(node("import").disabled, false);
  node("file").files = [{ size: 100, text: async () => "not json" }];
  await node("file").onchange();
  assert.equal(node("import").disabled, true);
  assert.equal(node("confirm").checked, false);
});
