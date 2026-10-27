import { test } from "node:test";
import assert from "node:assert/strict";
import { createRunner, validateJob } from "../core/runner.mjs";
function mock() {
  let next = 1;
  const tabs = new Map(),
    bookmarks = new Map(),
    windows = new Map(),
    values = {};
  let fail = false;
  const storage = {
    get: async (k) => ({ [k]: structuredClone(values[k]) }),
    set: async (v) => Object.assign(values, structuredClone(v)),
  };
  const api = {
    sessions: {
      setTabValue: async (id, key, value) => {
        tabs.get(id)[key] = value;
      },
      getTabValue: async (id, key) => tabs.get(id)?.[key],
      setWindowValue: async (id, key, value) => {
        windows.get(id)[key] = value;
      },
      getWindowValue: async (id, key) => windows.get(id)?.[key],
    },
    tabs: {
      query: async () => [...tabs.values()],
      create: async (o) => {
        if (fail) {
          fail = false;
          throw Error("Simulated browser error");
        }
        const t = { id: next++, ...o };
        tabs.set(t.id, t);
        return t;
      },
      get: async (id) => {
        if (!tabs.has(id)) throw Error("gone");
        return tabs.get(id);
      },
      remove: async (id) => tabs.delete(id),
    },
    windows: {
      getAll: async () => [...windows.values()],
      create: async () => {
        const w = { id: next++, tabs: [] };
        const tab = await api.tabs.create({
          windowId: w.id,
          url: "about:blank",
          pinned: false,
        });
        w.tabs = [tab];
        windows.set(w.id, w);
        return w;
      },
      get: async (id) => {
        if (!windows.has(id)) throw Error("gone");
        return windows.get(id);
      },
    },
    bookmarks: {
      create: async (o) => {
        const b = { id: String(next++), parentId: "unfiled", ...o };
        bookmarks.set(b.id, b);
        return b;
      },
      get: async (id) => {
        if (!bookmarks.has(id)) throw Error("gone");
        return [bookmarks.get(id)];
      },
      getChildren: async (id) =>
        [...bookmarks.values()].filter((b) => b.parentId === id),
      remove: async (id) => bookmarks.delete(id),
    },
  };
  return {
    api,
    storage,
    tabs,
    bookmarks,
    windows,
    values,
    failNext: () => {
      fail = true;
    },
  };
}
function job(count = 2) {
  return {
    format: "arc-bridge-migration",
    version: 1,
    id: "test-job",
    targetProfileId: "receiver",
    operations: Array.from({ length: count }, (_, i) => ({
      sourceId: `source-${i}`,
      targetProfileId: "receiver",
      spaceId: `space-${i}`,
      spaceName: `Space ${i}`,
      spaceMode: "groups",
      title: `Tab ${i}`,
      url: `https://example.com/${i}`,
      pinned: i === 0,
      folder: ["Folder"],
    })),
  };
}
test("creates windows, folder paths and pins; repeat execution does not duplicate resources", async () => {
  const m = mock(),
    r = createRunner(m.api, m.storage, "receiver");
  const j = await r.execute(job());
  assert.equal(j.status, "completed");
  assert.equal(m.tabs.size, 2);
  assert.equal(m.windows.size, 2);
  assert.equal([...m.tabs.values()][0].pinned, true);
  assert.match(j.notes.join(" "), /separate window/);
  const count = m.bookmarks.size;
  await r.execute(job());
  assert.equal(m.tabs.size, 2);
  assert.equal(m.bookmarks.size, count);
});
test("rejects wrong profiles and unsafe migration files", () => {
  assert.throws(() => validateJob(job(), "other"), /different Firefox/);
  const j = job();
  j.operations[0].url = "javascript:alert(1)";
  assert.throws(() => validateJob(j, "receiver"), /Unsafe/);
});
test("pause and resume preserve completed operations", async () => {
  const m = mock(),
    r = createRunner(m.api, m.storage, "receiver");
  let checks = 0;
  const paused = await r.execute(job(3), {
    isCancelled: async () => ++checks > 1,
  });
  assert.equal(paused.status, "cancelled");
  assert.equal(Object.keys(paused.entries).length, 1);
  await r.execute(job(3));
  assert.equal(m.tabs.size, 3);
});
test("failed creation retries without repeating already checkpointed resources", async () => {
  const m = mock(),
    r = createRunner(m.api, m.storage, "receiver");
  let progress = 0;
  await assert.rejects(
    r.execute(job(), {
      onProgress: async () => {
        if (++progress === 3) m.failNext();
      },
    }),
    /Simulated/,
  );
  const count = m.bookmarks.size;
  await r.execute(job());
  assert.equal(m.tabs.size, 2);
  assert.ok(m.bookmarks.size >= count);
  assert.equal([...m.bookmarks.values()].filter((b) => b.url).length, 2);
});
test("interrupted pending operations pause replay rather than duplicating unknown resources", async () => {
  const m = mock(),
    r = createRunner(m.api, m.storage, "receiver");
  m.values["job:test-job"] = {
    id: "test-job",
    profileId: "receiver",
    entries: {},
    folders: {},
    windows: {},
    groups: {},
    notes: [],
    total: 2,
    pending: "tab:source-0",
  };
  const j = await r.execute(job());
  assert.equal(j.status, "needs-review");
  assert.equal(m.tabs.size, 0);
});
test("undo preserves edited/moved resources and never touches unrelated tabs or bookmarks", async () => {
  const m = mock(),
    r = createRunner(m.api, m.storage, "receiver");
  await r.execute(job());
  const t = [...m.tabs.values()][0];
  t.url = "https://example.org/changed";
  const b = [...m.bookmarks.values()].find((b) => b.url);
  b.title = "User renamed";
  await m.api.tabs.create({
    url: "https://unrelated.example/",
    windowId: 999,
    pinned: false,
  });
  const undone = await r.undo("test-job");
  assert.equal(undone.status, "undone");
  assert.equal(undone.preserved, 2);
  assert.equal(m.tabs.size, 2);
  assert.ok([...m.bookmarks.values()].some((b) => b.title === "User renamed"));
});
test("a migration ID cannot be replayed with a different plan", async () => {
  const m = mock(),
    r = createRunner(m.api, m.storage, "receiver");
  await r.execute(job());
  const changed = job();
  changed.operations[0].url = "https://example.org/changed";
  await assert.rejects(r.execute(changed), /different plan/);
});
test("group-capable receivers use one migration window and keep pinned tabs outside groups", async () => {
  const m = mock(),
    calls = [];
  m.api.tabs.group = async (o) => {
    calls.push(o);
    return 70 + calls.length;
  };
  m.api.tabGroups = { update: async () => {} };
  m.api.permissions = { contains: async () => true };
  const r = createRunner(m.api, m.storage, "receiver");
  await r.execute(job(3));
  assert.equal(m.windows.size, 1);
  assert.equal(calls.length, 2);
  assert.ok(calls.every((c) => !m.tabs.get(c.tabIds[0]).pinned));
});
test("missing optional group permission falls back to separate windows", async () => {
  const m = mock();
  m.api.tabs.group = async () => {
    throw Error("Must not call without permission");
  };
  m.api.tabGroups = { update: async () => {} };
  m.api.permissions = { contains: async () => false };
  const r = createRunner(m.api, m.storage, "receiver");
  const j = await r.execute(job());
  assert.equal(j.status, "completed");
  assert.equal(m.windows.size, 2);
});
test("untrusted migration IDs cannot write inherited journal properties", () => {
  for (const id of ["__proto__", "constructor", "toString"]) {
    const value = job();
    value.operations[0].sourceId = id;
    assert.throws(() => validateJob(value, "receiver"), /Invalid migration/);
    const other = job();
    other.operations[0].spaceId = id;
    assert.throws(() => validateJob(other, "receiver"), /Invalid migration/);
  }
});
test("undo resolves restored IDs by ownership and preserves recycled IDs", async () => {
  const m = mock(),
    r = createRunner(m.api, m.storage, "receiver");
  await r.execute(job());
  const originals = [...m.tabs.values()];
  for (const t of originals) {
    m.tabs.set(t.id, { ...t, "arc-bridge-owner": undefined });
    m.tabs.set(t.id + 1000, { ...t, id: t.id + 1000 });
  }
  const result = await createRunner(m.api, m.storage, "receiver").undo(
    "test-job",
  );
  assert.equal(result.status, "undone");
  assert.equal(m.tabs.size, 2);
  assert.ok(
    originals.every((t) => m.tabs.has(t.id) && !m.tabs.has(t.id + 1000)),
  );
});
test("resume resolves restored window IDs and rejects a recycled window", async () => {
  const m = mock(),
    r = createRunner(m.api, m.storage, "receiver"),
    j = job(2);
  j.operations.forEach((o) => {
    o.spaceId = "same";
    o.spaceMode = "windows";
  });
  let checks = 0;
  await r.execute(j, { isCancelled: async () => ++checks > 1 });
  const original = [...m.windows.values()][0];
  m.windows.set(original.id, { ...original, "arc-bridge-owner": undefined });
  m.windows.set(2000, { ...original, id: 2000 });
  await createRunner(m.api, m.storage, "receiver").execute(j);
  assert.equal(
    [...m.tabs.values()].find((t) => t.url.endsWith("/1")).windowId,
    2000,
  );
});
test("undo failures stay retryable and do not claim removal", async () => {
  const m = mock(),
    r = createRunner(m.api, m.storage, "receiver");
  await r.execute(job());
  const remove = m.api.tabs.remove;
  m.api.tabs.remove = async () => {
    throw Error("Temporary browser failure");
  };
  await assert.rejects(r.undo("test-job"), /Temporary/);
  assert.equal((await r.get("test-job")).status, "failed");
  assert.equal(m.tabs.size, 2);
  m.api.tabs.remove = remove;
  assert.equal((await r.undo("test-job")).status, "undone");
  assert.equal(m.tabs.size, 0);
});
test("resume stops when an imported folder was changed", async () => {
  const m = mock(),
    r = createRunner(m.api, m.storage, "receiver");
  let checks = 0;
  await r.execute(job(), { isCancelled: async () => ++checks > 1 });
  [...m.bookmarks.values()][0].title = "User renamed root";
  await assert.rejects(r.execute(job()), /renamed or moved/);
  assert.equal([...m.bookmarks.values()].filter((b) => b.url).length, 1);
});
test("ownership marker failure pauses replay instead of duplicating a created tab", async () => {
  const m = mock(),
    r = createRunner(m.api, m.storage, "receiver");
  const set = m.api.sessions.setTabValue;
  m.api.sessions.setTabValue = async (id, key, value) => {
    if (m.tabs.get(id).url !== "about:blank") throw Error("Storage failed");
    return set(id, key, value);
  };
  await assert.rejects(r.execute(job()), /ownership marker/);
  assert.equal((await r.execute(job())).status, "needs-review");
  assert.equal(
    [...m.tabs.values()].filter((t) => t.url.startsWith("https:")).length,
    1,
  );
});
test("empty and oversized migration fields are rejected", () => {
  const empty = job(0);
  assert.throws(() => validateJob(empty, "receiver"), /size/);
  for (const field of ["title", "spaceName", "spaceId", "url"]) {
    const j = job();
    j.operations[0][field] = "x".repeat(17000);
    assert.throws(() => validateJob(j, "receiver"), /Invalid/);
  }
});
