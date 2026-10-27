export function validateJob(job, profileId) {
  if (
    !job ||
    job.format !== "arc-bridge-migration" ||
    job.version !== 1 ||
    !/^[a-zA-Z0-9-]{1,100}$/.test(job.id || "")
  )
    throw new Error("Unsupported migration file.");
  if (job.targetProfileId !== profileId)
    throw new Error(
      "This file belongs to a different Firefox receiver. Return to Arc Bridge and choose this profile.",
    );
  if (
    !Array.isArray(job.operations) ||
    !job.operations.length ||
    job.operations.length > 20000
  )
    throw new Error("Invalid migration size.");
  const ids = new Set();
  for (const op of job.operations) {
    if (
      !op ||
      typeof op.sourceId !== "string" ||
      !op.sourceId.trim() ||
      Object.hasOwn(Object.prototype, op.sourceId) ||
      Object.hasOwn(Object.prototype, op.spaceId || "") ||
      op.sourceId.length > 4096 ||
      ids.has(op.sourceId) ||
      op.targetProfileId !== profileId ||
      typeof op.spaceId !== "string" ||
      typeof op.title !== "string" ||
      typeof op.spaceName !== "string" ||
      !op.spaceId.trim() ||
      op.spaceId.length > 4096 ||
      op.title.length > 4096 ||
      op.spaceName.length > 4096 ||
      typeof op.url !== "string" ||
      op.url.length > 16384 ||
      !["windows", "groups"].includes(op.spaceMode) ||
      !Array.isArray(op.folder) ||
      op.folder.length > 20 ||
      op.folder.some((v) => typeof v !== "string" || v.length > 4096) ||
      typeof op.pinned !== "boolean"
    )
      throw new Error("Invalid migration operation or mixed profiles.");
    ids.add(op.sourceId);
    const u = new URL(op.url);
    if (!["http:", "https:"].includes(u.protocol) || u.username || u.password)
      throw new Error("Unsafe URL in migration file.");
  }
  return job;
}
export function createRunner(api, storage, profileId) {
  let busy = false;
  const ownerKey = "arc-bridge-owner";
  const token = () => crypto.randomUUID();
  const ownedTab = async (t, resource) =>
    !!resource.owner &&
    (await api.sessions.getTabValue(t.id, ownerKey)) === resource.owner;
  const ownedWindow = async (w, resource) =>
    !!resource.owner &&
    (await api.sessions.getWindowValue(w.id, ownerKey)) === resource.owner;
  // IDs can be reassigned by Firefox. Resolve extension-owned markers instead.
  const findWindow = async (resource) => {
    const matches = [];
    for (const w of await api.windows.getAll())
      if (await ownedWindow(w, resource)) matches.push(w);
    if (matches.length === 1) return matches[0];
    throw Error(
      "An imported window is no longer available or its ownership cannot be verified. Start a new migration.",
    );
  };
  const get = async (id) => (await storage.get(`job:${id}`))[`job:${id}`];
  const save = async (j) => {
    j.updatedAt = new Date().toISOString();
    await storage.set({ [`job:${j.id}`]: j });
  };
  async function execute(input, options = {}) {
    if (busy)
      throw new Error("Another migration is running in this Firefox profile.");
    const job = validateJob(input, profileId);
    busy = true;
    let journal;
    try {
      journal = (await get(job.id)) || {
        id: job.id,
        profileId,
        status: "ready",
        entries: {},
        folders: {},
        windows: {},
        groups: {},
        notes: [],
        total: job.operations.length,
      };
      // Bind a migration ID to its exact plan so edited/replayed files cannot reuse ownership.
      const bytes = new TextEncoder().encode(JSON.stringify(job.operations));
      const planHash = [
        ...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
      ]
        .map((v) => v.toString(16).padStart(2, "0"))
        .join("");
      if (journal.planHash && journal.planHash !== planHash)
        throw new Error(
          "This migration ID was already used for a different plan.",
        );
      journal.planHash = planHash;
      if (journal.status === "undone")
        throw Error(
          "This migration was undone. Choose a new migration ID to import it again.",
        );
      if (journal.pending) {
        journal.status = "needs-review";
        journal.error =
          "An operation was interrupted before its result was saved. Review the new browser resources before retrying; automatic replay is paused to avoid duplicates.";
        await save(journal);
        return journal;
      }
      const groups =
        !!api.tabs.group &&
        !!api.tabGroups?.update &&
        (!api.permissions ||
          (await api.permissions
            .contains({ permissions: ["tabGroups"] })
            .catch(() => false)));
      if (
        job.operations.some((o) => o.spaceMode === "groups") &&
        !groups &&
        !journal.notes.includes(
          "Tab groups are unavailable; each Space uses a separate window.",
        )
      )
        journal.notes.push(
          "Tab groups are unavailable; each Space uses a separate window.",
        );
      journal.status = "running";
      delete journal.error;
      await save(journal);
      const checkpoint = async () => {
        await save(journal);
        await options.onProgress?.(summary(journal));
      };
      const create = async (label, fn) => {
        journal.pending = label;
        await save(journal);
        let result;
        try {
          result = await fn();
        } catch (e) {
          if (!String(e.message).includes("ownership marker"))
            delete journal.pending;
          throw e;
        }
        delete journal.pending;
        return result;
      };
      const folder = async (key, title, parentId) => {
        if (journal.folders[key]) {
          try {
            const [current] = await api.bookmarks.get(journal.folders[key].id);
            const expected = journal.folders[key];
            if (
              current.title !== expected.title ||
              current.parentId !== expected.parentId
            )
              throw Error("changed folder");
            return current.id;
          } catch {
            throw new Error(
              "An imported bookmark folder was removed, renamed or moved. Start a new migration instead of recreating it silently.",
            );
          }
        }
        const created = await create(`folder:${key}`, () =>
          api.bookmarks.create({ title, ...(parentId ? { parentId } : {}) }),
        );
        journal.folders[key] = {
          id: created.id,
          title: created.title,
          parentId: created.parentId,
        };
        await checkpoint();
        return created.id;
      };
      const root = await folder("root", `Arc Bridge · ${job.id.slice(-8)}`);
      for (const op of job.operations) {
        if (await options.isCancelled?.()) {
          journal.status = "cancelled";
          await checkpoint();
          return journal;
        }
        let entry = journal.entries[op.sourceId];
        if (entry?.done) continue;
        const groupMode = op.spaceMode === "groups" && groups;
        const windowKey = groupMode ? "grouped:profile" : `space:${op.spaceId}`;
        let win = journal.windows[windowKey];
        if (win) {
          const current = await findWindow(win);
          if (win.id !== current.id) {
            win.id = current.id;
            // Group IDs also change across restarts. Recreate groups for remaining tabs.
            journal.groups = {};
          }
        } else {
          const owner = token(),
            placeholderOwner = token();
          const created = await create(`window:${windowKey}`, async () => {
            const w = await api.windows.create({
              url: "about:blank",
              focused: false,
            });
            await api.sessions
              .setWindowValue(w.id, ownerKey, owner)
              .catch(() => {
                throw Error(
                  "Could not save ownership marker; review the created window.",
                );
              });
            if (w.tabs?.[0])
              await api.sessions
                .setTabValue(w.tabs[0].id, ownerKey, placeholderOwner)
                .catch(() => {
                  throw Error(
                    "Could not save ownership marker; review the created placeholder.",
                  );
                });
            return w;
          });
          win = {
            id: created.id,
            owner,
            placeholderOwner,
            placeholderId: created.tabs?.[0]?.id,
          };
          journal.windows[windowKey] = win;
          await checkpoint();
        }
        let parent = await folder(`space:${op.spaceId}`, op.spaceName, root);
        const path = [];
        for (const part of op.folder) {
          path.push(part);
          parent = await folder(
            JSON.stringify([op.spaceId, ...path]),
            part,
            parent,
          );
        }
        entry ||= {};
        journal.entries[op.sourceId] = entry;
        if (!entry.bookmark) {
          const bookmark = await create(`bookmark:${op.sourceId}`, () =>
            api.bookmarks.create({
              parentId: parent,
              title: op.title,
              url: op.url,
            }),
          );
          entry.bookmark = {
            id: bookmark.id,
            url: op.url,
            title: op.title,
            parentId: parent,
          };
          await checkpoint();
        }
        const hadTab = !!entry.tab;
        if (!entry.tab) {
          const owner = token();
          const tab = await create(`tab:${op.sourceId}`, async () => {
            const created = await api.tabs.create({
              windowId: win.id,
              url: op.url,
              pinned: op.pinned,
              active: false,
              ...(!op.pinned ? { discarded: true, title: op.title } : {}),
            });
            await api.sessions
              .setTabValue(created.id, ownerKey, owner)
              .catch(() => {
                throw Error(
                  "Could not save ownership marker; review the created tab.",
                );
              });
            return created;
          });
          entry.tab = {
            owner,
            windowOwner: win.owner,
            id: tab.id,
            url: op.url,
            pinned: op.pinned,
            windowId: win.id,
          };
          await checkpoint();
        }
        if (hadTab) {
          const current = await api.tabs.query({});
          let found;
          for (const t of current)
            if (await ownedTab(t, entry.tab)) {
              found = t;
              break;
            }
          if (!found)
            throw Error(
              "An unfinished imported tab is no longer available. Review the browser before starting a new migration.",
            );
          entry.tab.id = found.id;
        }
        if (groupMode && !op.pinned && !entry.grouped) {
          try {
            let group = journal.groups[op.spaceId];
            if (!group) {
              const id = await create(`group:${op.spaceId}`, () =>
                api.tabs.group({ tabIds: [entry.tab.id] }),
              );
              group = { id };
              journal.groups[op.spaceId] = group;
              await checkpoint();
              await api.tabGroups.update(id, {
                title: op.spaceName,
                collapsed: true,
              });
            } else
              await api.tabs.group({
                groupId: group.id,
                tabIds: [entry.tab.id],
              });
            entry.grouped = true;
          } catch {
            if (
              !journal.notes.includes(
                "Some tabs could not be grouped; they remain in the migration window.",
              )
            )
              journal.notes.push(
                "Some tabs could not be grouped; they remain in the migration window.",
              );
          }
        }
        entry.done = true;
        await checkpoint();
        await new Promise((r) => setTimeout(r, 20));
      }
      for (const win of Object.values(journal.windows))
        if (win.placeholderId) {
          try {
            const tab = await api.tabs.get(win.placeholderId);
            if (
              tab.url === "about:blank" &&
              (await ownedTab(tab, { owner: win.placeholderOwner }))
            )
              await api.tabs.remove(tab.id);
          } catch {}
        }
      journal.status = "completed";
      await checkpoint();
      return journal;
    } catch (e) {
      if (journal) {
        journal.status = "failed";
        journal.error = e.message;
        await save(journal);
        await options.onProgress?.(summary(journal));
      }
      throw e;
    } finally {
      busy = false;
    }
  }
  async function undo(id, options = {}) {
    if (busy)
      throw new Error("Wait for the active migration to stop before undoing.");
    busy = true;
    try {
      const j = await get(id);
      if (!j || j.profileId !== profileId)
        throw new Error("No owned migration found in this profile.");
      j.status = "running";
      delete j.error;
      await save(j);
      await options.onProgress?.(summary(j));
      let preserved = 0;
      const liveTabs = await api.tabs.query({});
      const byOwner = new Map();
      for (const tab of liveTabs) {
        const owner = await api.sessions.getTabValue(tab.id, ownerKey);
        if (owner) byOwner.set(owner, byOwner.has(owner) ? null : tab);
      }
      for (const e of Object.values(j.entries).reverse()) {
        if (e.tab && !e.tab.removed) {
          const t = byOwner.get(e.tab.owner);
          if (byOwner.has(e.tab.owner) && !t) {
            // Copies can carry the same marker. Preserve both rather than guessing.
            preserved++;
          } else if (!t) {
            // Legacy journals without markers must never use a recycled numeric ID.
            if (e.tab.owner) e.tab.removed = true;
            else preserved++;
          } else if (
            t.url === e.tab.url &&
            !!t.pinned === e.tab.pinned &&
            (await api.sessions.getWindowValue(t.windowId, ownerKey)) ===
              e.tab.windowOwner
          ) {
            await api.tabs.remove(t.id);
            e.tab.removed = true;
          } else preserved++;
          await save(j);
        }
        if (e.bookmark && !e.bookmark.removed) {
          let b;
          try {
            [b] = await api.bookmarks.get(e.bookmark.id);
          } catch {
            preserved++;
          }
          if (b) {
            if (
              b.url === e.bookmark.url &&
              b.title === e.bookmark.title &&
              b.parentId === e.bookmark.parentId
            ) {
              await api.bookmarks.remove(b.id);
              e.bookmark.removed = true;
            } else preserved++;
          }
          await save(j);
        }
      }
      for (const f of Object.values(j.folders).reverse()) {
        try {
          const [current] = await api.bookmarks.get(f.id);
          if (
            current.title === f.title &&
            current.parentId === f.parentId &&
            (await api.bookmarks.getChildren(f.id)).length === 0
          )
            await api.bookmarks.remove(f.id);
        } catch {}
      }
      for (const win of Object.values(j.windows)) {
        if (win.placeholderId) {
          try {
            const t = await api.tabs.get(win.placeholderId);
            if (
              t.url === "about:blank" &&
              (await ownedTab(t, { owner: win.placeholderOwner }))
            )
              await api.tabs.remove(t.id);
          } catch {}
        }
      }
      j.status = "undone";
      j.preserved = preserved;
      if (j.pending)
        j.notes.push(
          "An interrupted operation may have left untracked resources; review the browser manually.",
        );
      await save(j);
      await options.onProgress?.(summary(j));
      return j;
    } catch (e) {
      const j = await get(id);
      if (j) {
        j.status = "failed";
        j.error = `Undo stopped: ${e.message}. You can retry undo.`;
        await save(j);
        await options.onProgress?.(summary(j));
      }
      throw e;
    } finally {
      busy = false;
    }
  }
  return { execute, undo, get };
}
export function summary(j) {
  return {
    id: j.id,
    status: j.status,
    total: j.total,
    done: Object.values(j.entries || {}).filter((e) => e.done).length,
    notes: j.notes || [],
    error: j.error || null,
    preserved: j.preserved || 0,
    updatedAt: j.updatedAt,
  };
}
