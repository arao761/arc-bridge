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
  if (!Array.isArray(job.operations) || job.operations.length > 20000)
    throw new Error("Invalid migration size.");
  const ids = new Set();
  for (const op of job.operations) {
    if (
      !op ||
      typeof op.sourceId !== "string" ||
      op.sourceId.length > 4096 ||
      ids.has(op.sourceId) ||
      op.targetProfileId !== profileId ||
      typeof op.spaceId !== "string" ||
      typeof op.title !== "string" ||
      typeof op.spaceName !== "string" ||
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
          delete journal.pending;
          throw e;
        }
        delete journal.pending;
        return result;
      };
      const folder = async (key, title, parentId) => {
        if (journal.folders[key]) {
          try {
            await api.bookmarks.get(journal.folders[key].id);
            return journal.folders[key].id;
          } catch {
            throw new Error(
              "An imported bookmark folder was removed. Start a new migration instead of recreating it silently.",
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
      const root = await folder("root", `Arc Bridge · ${job.id.slice(0, 8)}`);
      for (const op of job.operations) {
        if (await options.isCancelled?.()) {
          journal.status = "cancelled";
          await checkpoint();
          return journal;
        }
        let entry = journal.entries[op.sourceId];
        if (entry?.done) continue;
        const groupMode = op.spaceMode === "groups" && groups;
        const windowKey = groupMode ? "profile" : op.spaceId;
        let win = journal.windows[windowKey];
        if (win) {
          try {
            await api.windows.get(win.id);
          } catch {
            throw new Error(
              "An imported window was closed. Start a new migration rather than silently reopening it.",
            );
          }
        } else {
          const created = await create(`window:${windowKey}`, () =>
            api.windows.create({ url: "about:blank", focused: false }),
          );
          win = { id: created.id, placeholderId: created.tabs?.[0]?.id };
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
        if (!entry.tab) {
          const tab = await create(`tab:${op.sourceId}`, () =>
            api.tabs.create({
              windowId: win.id,
              url: op.url,
              pinned: op.pinned,
              active: false,
              ...(!op.pinned ? { discarded: true, title: op.title } : {}),
            }),
          );
          entry.tab = {
            id: tab.id,
            url: op.url,
            pinned: op.pinned,
            windowId: win.id,
          };
          await checkpoint();
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
            if (tab.url === "about:blank") await api.tabs.remove(tab.id);
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
      let preserved = 0;
      for (const e of Object.values(j.entries).reverse()) {
        if (e.tab && !e.tab.removed) {
          try {
            const t = await api.tabs.get(e.tab.id);
            if (
              t.url === e.tab.url &&
              !!t.pinned === e.tab.pinned &&
              t.windowId === e.tab.windowId
            ) {
              await api.tabs.remove(t.id);
              e.tab.removed = true;
            } else preserved++;
          } catch {
            e.tab.removed = true;
          }
          await save(j);
        }
        if (e.bookmark && !e.bookmark.removed) {
          try {
            const [b] = await api.bookmarks.get(e.bookmark.id);
            if (
              b.url === e.bookmark.url &&
              b.title === e.bookmark.title &&
              b.parentId === e.bookmark.parentId
            ) {
              await api.bookmarks.remove(b.id);
              e.bookmark.removed = true;
            } else preserved++;
          } catch {
            e.bookmark.removed = true;
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
            if (t.url === "about:blank" && t.windowId === win.id)
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
