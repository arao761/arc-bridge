import { createRunner, summary, validateJob } from "../core/runner.mjs";
let config,
  port,
  runner,
  busy = false,
  polling = false,
  activeId = null,
  requestIndex = 0,
  lastError = "";
const requests = new Map();
async function setup() {
  config = (await browser.storage.local.get("receiver")).receiver;
  if (!config) {
    config = {
      id: crypto.randomUUID(),
      label: "My Firefox profile",
      enabled: false,
    };
    await browser.storage.local.set({ receiver: config });
  }
  runner = createRunner(browser, browser.storage.local, config.id);
}
function request(message) {
  return new Promise((resolve, reject) => {
    if (!port)
      return reject(
        Error("Install the desktop bridge first, or import a migration file."),
      );
    const requestId = ++requestIndex;
    const timer = setTimeout(() => {
      requests.delete(requestId);
      reject(Error("Desktop bridge did not respond."));
    }, 10000);
    requests.set(requestId, { resolve, reject, timer });
    port.postMessage({ ...message, requestId });
  });
}
async function hasGroups() {
  return (
    !!browser.tabs.group &&
    !!browser.tabGroups &&
    (await browser.permissions
      .contains({ permissions: ["tabGroups"] })
      .catch(() => false))
  );
}
async function connect() {
  if (port) return;
  try {
    port = browser.runtime.connectNative("dev.arcbridge");
    port.onMessage.addListener((m) => {
      const pending = requests.get(m.requestId);
      if (!pending) return;
      clearTimeout(pending.timer);
      requests.delete(m.requestId);
      m.error ? pending.reject(Error(m.error)) : pending.resolve(m);
    });
    port.onDisconnect.addListener(() => {
      port = null;
      lastError =
        "Desktop bridge unavailable. Install it from Arc Bridge or use a migration file.";
      for (const p of requests.values()) {
        clearTimeout(p.timer);
        p.reject(Error(lastError));
      }
      requests.clear();
    });
    await request({
      type: "hello",
      profileId: config.id,
      label: config.label,
      enabled: config.enabled,
      groups: await hasGroups(),
    });
    lastError = "";
  } catch (e) {
    lastError = e.message;
    port = null;
  }
}
async function report(meta, value) {
  await browser.storage.local.set({ lastReport: value });
  if (meta)
    await request({
      type: "report",
      id: meta.id,
      runToken: meta.runToken,
      report: value,
    });
}
async function runJob(job, meta, reserved = false) {
  if (busy && !reserved) throw Error("Another migration is active.");
  validateJob(job, config.id);
  busy = true;
  activeId = job.id;
  try {
    const result = await runner.execute(job, {
      onProgress: (r) => report(meta, r),
      isCancelled: async () => {
        const local = (await browser.storage.local.get("cancel")).cancel;
        if (local === job.id) return true;
        return meta
          ? (
              await request({
                type: "status",
                id: meta.id,
                runToken: meta.runToken,
              })
            ).cancelRequested
          : false;
      },
    });
    await report(meta, summary(result));
  } catch (e) {
    const j = await runner.get(job.id);
    const r = j
      ? { ...summary(j), status: "failed", error: e.message }
      : {
          id: job.id,
          status: "failed",
          total: job.operations.length,
          done: 0,
          notes: [],
          error: e.message,
        };
    await report(meta, r).catch(() => {});
    throw e;
  } finally {
    busy = false;
    activeId = null;
  }
}
async function poll() {
  if (polling || busy) return;
  polling = true;
  try {
    await pollOnce();
  } finally {
    polling = false;
  }
}
async function pollOnce() {
  if (busy) return;
  await connect();
  if (!port || !config.enabled) return;
  try {
    await request({
      type: "hello",
      profileId: config.id,
      label: config.label,
      enabled: config.enabled,
      groups: await hasGroups(),
    });
    const { job: meta } = await request({ type: "poll" });
    if (!meta) return;
    if (meta.action === "undo") {
      busy = true;
      try {
        const j = await runner.undo(meta.id, {
          onProgress: (r) => report(meta, r),
        });
        await report(meta, summary(j));
      } catch (e) {
        const j = await runner.get(meta.id);
        await report(meta, {
          ...(j
            ? summary(j)
            : { id: meta.id, total: meta.total, done: 0, notes: [] }),
          status: "failed",
          error: e.message,
        }).catch(() => {});
        throw e;
      } finally {
        busy = false;
      }
      return;
    }
    let offset = 0,
      job,
      operations = [];
    do {
      const part = await request({
        type: "chunk",
        id: meta.id,
        runToken: meta.runToken,
        offset,
      });
      if (part.cancelRequested) {
        const previous = await runner.get(meta.id);
        await report(meta, {
          ...(previous
            ? summary(previous)
            : { id: meta.id, done: 0, total: part.total, notes: [] }),
          status: "cancelled",
        });
        return;
      }
      operations.push(...part.operations);
      offset = part.nextOffset;
      job = {
        format: part.format,
        version: part.version,
        id: part.id,
        targetProfileId: part.targetProfileId,
      };
    } while (offset < meta.total);
    await browser.storage.local.remove("cancel");
    await runJob({ ...job, operations }, meta);
  } catch (e) {
    lastError = e.message;
  }
}
browser.runtime.onMessage.addListener(async (m) => {
  if (!config) await ready;
  if (m.type === "state")
    return {
      config,
      connected: !!port,
      busy,
      error: lastError,
      report: (await browser.storage.local.get("lastReport")).lastReport,
    };
  if (m.type === "configure") {
    if (
      typeof m.label !== "string" ||
      !m.label.trim() ||
      m.label.length > 100 ||
      typeof m.enabled !== "boolean"
    )
      throw Error("Enter a receiver label.");
    config = { ...config, label: m.label.trim(), enabled: m.enabled };
    await browser.storage.local.set({ receiver: config });
    await connect();
    if (port)
      await request({
        type: "hello",
        profileId: config.id,
        label: config.label,
        enabled: config.enabled,
        groups: await hasGroups(),
      });
    return { ok: true };
  }
  if (m.type === "import") {
    if (!m.confirmed)
      throw Error("Confirm the target profile before importing.");
    if (busy || polling)
      throw Error("Wait for the active receiver operation to finish.");
    validateJob(m.job, config.id);
    busy = true;
    try {
      await browser.storage.local.remove("cancel");
    } catch (e) {
      busy = false;
      throw e;
    }
    void runJob(m.job, null, true).catch((e) => {
      lastError = e.message;
    });
    return { ok: true };
  }
  if (m.type === "cancel") {
    if (activeId) await browser.storage.local.set({ cancel: activeId });
    return { ok: true };
  }
  if (m.type === "undo") {
    if (m.confirmed !== true) throw Error("Confirm undo first.");
    const r = (await browser.storage.local.get("lastReport")).lastReport;
    if (!r) throw Error("No migration to undo.");
    if (busy || polling)
      throw Error("Wait for the active receiver operation to finish.");
    busy = true;
    try {
      const j = await runner.undo(r.id);
      await report(null, summary(j));
      return { ok: true };
    } finally {
      busy = false;
    }
  }
  throw Error("Unknown extension request.");
});
const ready = setup();
ready.then(() => {
  void poll();
  setInterval(() => void poll(), 2500);
});
