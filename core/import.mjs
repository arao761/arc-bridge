import { parse } from "parse5";
import { readArchive, buildPlan } from "./archive.mjs";
const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (v) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        v
      ],
  );
const content = (n) =>
  n.nodeName === "#text" ? n.value : (n.childNodes || []).map(content).join("");
const attrs = (n) =>
  Object.fromEntries((n.attrs || []).map((a) => [a.name, a.value]));
export function importSource(source) {
  if (typeof source !== "string" || source.length > 20 * 1024 * 1024)
    throw new Error("Choose a file smaller than 20 MB.");
  const trimmed = source.trim();
  if (!trimmed) throw new Error("This export is empty.");
  if (trimmed.startsWith("{")) {
    let value;
    try {
      value = JSON.parse(trimmed);
    } catch {
      throw new Error("This JSON file is incomplete or malformed.");
    }
    if (value.format === "arc-bridge")
      return {
        archive: readArchive(value),
        adapter: "Arc Bridge archive v1",
        warnings: [],
      };
    if (Array.isArray(value.sidebar?.containers)) return sidebar(value);
    throw new Error(
      "Unrecognized JSON format. Choose StorableSidebar.json, bookmark HTML, or an Arc Bridge archive.",
    );
  }
  if (!/<(?:!doctype|html|a|dl|h1)\b/i.test(trimmed))
    throw new Error(
      "Unsupported export. Choose bookmark HTML or a supported JSON file.",
    );
  const root = parse(trimmed);
  const links = [];
  let index = 0;
  function walk(node, path = [], depth = 0) {
    if (depth > 60) throw new Error("The folder hierarchy is too deep.");
    if (node.tagName === "script" || node.tagName === "style") return;
    if (node.tagName === "a") {
      const a = attrs(node);
      if (a.href)
        links.push({
          id: `html-tab-${++index}`,
          title: content(node).trim() || a.href,
          url: a.href,
          pinned: a["data-pinned"] === "true",
          folder: path,
        });
      return;
    }
    const children = node.childNodes || [];
    // Netscape bookmark folders use a heading followed by a sibling or nested DL.
    let pending = null;
    for (const child of children) {
      const heading =
        child.tagName === "h3"
          ? child
          : child.tagName === "dt"
            ? child.childNodes?.find((n) => n.tagName === "h3")
            : null;
      if (heading) {
        pending = content(heading).trim() || "Untitled folder";
        for (const nested of child.childNodes || [])
          if (nested.tagName === "dl")
            walk(nested, [...path, pending], depth + 1);
        // An anchor in this DT, if any, must still be collected.
        for (const nested of child.childNodes || [])
          if (nested.tagName === "a") walk(nested, path, depth + 1);
      } else if (child.tagName === "dl" && pending) {
        walk(child, [...path, pending], depth + 1);
        pending = null;
      } else walk(child, path, depth + 1);
    }
  }
  walk(root);
  if (!links.length)
    throw new Error("No links were found in this HTML export.");
  const spaces = new Map();
  for (const tab of links) {
    const name = tab.folder[0] || "Imported tabs";
    if (!spaces.has(name))
      spaces.set(name, { id: `html-space-${spaces.size}`, name, tabs: [] });
    spaces.get(name).tabs.push({ ...tab, folder: tab.folder.slice(1) });
  }
  // Each top-level section begins isolated until the user explicitly chooses where it belongs.
  const profiles = [...spaces.values()].map((space, i) => ({
    id: `html-profile-${i}`,
    name: space.name,
    spaces: [space],
  }));
  return {
    archive: readArchive({ format: "arc-bridge", version: 1, profiles }),
    adapter: "HTML links / bookmarks",
    warnings: [
      "HTML does not establish browser-profile identity. Each top-level section is isolated; explicitly regroup sections only if they belong to the same Arc profile.",
      "Only hierarchy and pin metadata present in this file can be restored. A flat export cannot recover missing Spaces or folders.",
    ],
  };
}
function pairs(value, label) {
  if (!Array.isArray(value) || value.length % 2)
    throw new Error(`Unsupported sidebar ${label} layout.`);
  const map = new Map();
  for (let i = 0; i < value.length; i += 2) {
    if (
      typeof value[i] !== "string" ||
      !value[i + 1] ||
      typeof value[i + 1] !== "object" ||
      map.has(value[i])
    )
      throw new Error(`Unsupported sidebar ${label} entry.`);
    map.set(value[i], value[i + 1]);
  }
  return map;
}
function sidebar(value) {
  const profiles = [],
    warnings = [
      "Arc sidebar data is an undocumented format. Review counts and profile assignments before migrating. Split views become ordinary tabs.",
    ];
  let count = 0,
    index = 0;
  for (const container of value.sidebar.containers) {
    if (!container.items || !container.spaces) continue;
    const items = pairs(container.items, "items"),
      spaces = pairs(container.spaces, "spaces");
    const assigned = new Set();
    function collect(id, path, pinned, stack = new Set()) {
      if (stack.size > 60 || stack.has(id))
        throw new Error("A cycle or excessive depth was found in the sidebar.");
      const item = items.get(id);
      if (!item) {
        warnings.push("Some referenced sidebar items are missing.");
        return [];
      }
      if (assigned.has(id)) return [];
      assigned.add(id);
      const data = item.data || {};
      if (data.tab) {
        const url = data.tab.savedURL;
        if (typeof url !== "string" || !url) {
          warnings.push("A sidebar tab has no saved URL and was skipped.");
          return [];
        }
        count++;
        return [
          {
            id: `sidebar-tab-${++index}`,
            title: item.title || data.tab.savedTitle || url,
            url,
            pinned,
            folder: path,
          },
        ];
      }
      const folder = data.list
        ? [...path, item.title || "Folder"]
        : data.splitView
          ? [...path, item.title || "Split view"]
          : path;
      if (!data.list && !data.splitView && !data.itemContainer) {
        warnings.push("An unsupported sidebar item was skipped.");
        return [];
      }
      const next = new Set(stack);
      next.add(id);
      return (item.childrenIds || []).flatMap((child) =>
        collect(child, folder, pinned, next),
      );
    }
    for (const [id, space] of spaces) {
      if (
        !Array.isArray(space.newContainerIDs) ||
        space.newContainerIDs.length % 2
      )
        throw new Error("Unsupported Space container layout.");
      const tabs = [];
      for (let i = 0; i < space.newContainerIDs.length; i += 2) {
        const marker = space.newContainerIDs[i],
          root = space.newContainerIDs[i + 1];
        if (
          marker &&
          typeof marker === "object" &&
          typeof root === "string" &&
          ("pinned" in marker || "unpinned" in marker)
        )
          tabs.push(...collect(root, [], "pinned" in marker));
      }
      const key = `sidebar-profile-${profiles.length}`;
      profiles.push({
        id: key,
        name: space.title || `Space ${profiles.length + 1}`,
        spaces: [
          {
            id: `sidebar-space-${id}`,
            name: space.title || "Untitled Space",
            tabs,
          },
        ],
      });
    }
    for (const id of container.topAppsContainerIDs || []) {
      if (typeof id !== "string" || assigned.has(id)) continue;
      const tabs = collect(id, [], true);
      if (tabs.length)
        profiles.push({
          id: `sidebar-favorites-${index}`,
          name: "Favorites · confirm profile",
          spaces: [
            { id: `sidebar-favorites-space-${index}`, name: "Favorites", tabs },
          ],
        });
    }
  }
  if (!count)
    throw new Error("No supported saved tabs found in this sidebar layout.");
  warnings.push(
    "Sidebar Spaces are isolated initially because this adapter does not infer authentication profiles. Regroup them explicitly if they share a profile.",
  );
  return {
    archive: readArchive({ format: "arc-bridge", version: 1, profiles }),
    adapter: "Arc sidebar · experimental adapter",
    warnings: [...new Set(warnings)],
  };
}
export function mergeSections(archive, grouping) {
  const groups = new Map();
  for (const p of readArchive(archive).profiles) {
    const name = (grouping[p.id] || p.name).trim();
    if (!name || name.length > 100)
      throw new Error("Give each source profile a name of 1–100 characters.");
    if (!groups.has(name))
      groups.set(name, { id: `source-${groups.size}`, name, spaces: [] });
    groups.get(name).spaces.push(...p.spaces);
  }
  return readArchive({
    format: "arc-bridge",
    version: 1,
    profiles: [...groups.values()],
  });
}
export function bookmarkHTML(archiveInput) {
  const archive = readArchive(archiveInput);
  const lines = [
    "<!DOCTYPE NETSCAPE-Bookmark-file-1>",
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
    "<TITLE>Arc Bridge backup</TITLE>",
    "<H1>Arc Bridge backup</H1>",
    "<DL><p>",
  ];
  function folder(name, fn) {
    lines.push(`<DT><H3>${esc(name)}</H3><DL><p>`);
    fn();
    lines.push("</DL><p>");
  }
  for (const p of archive.profiles)
    folder(p.name, () => {
      for (const s of p.spaces)
        folder(s.name, () => {
          const tree = { tabs: [], children: new Map() };
          for (const t of s.tabs) {
            let n = tree;
            for (const part of t.folder) {
              if (!n.children.has(part))
                n.children.set(part, { tabs: [], children: new Map() });
              n = n.children.get(part);
            }
            n.tabs.push(t);
          }
          const render = (node) => {
            for (const t of node.tabs) {
              try {
                const u = new URL(t.url);
                if (
                  !["http:", "https:"].includes(u.protocol) ||
                  u.username ||
                  u.password
                )
                  continue;
              } catch {
                continue;
              }
              lines.push(
                `<DT><A HREF="${esc(t.url)}" data-pinned="${t.pinned}">${esc(t.title)}</A>`,
              );
            }
            for (const [name, n] of node.children)
              folder(name, () => render(n));
          };
          render(tree);
        });
    });
  lines.push("</DL>");
  return lines.join("\n");
}
