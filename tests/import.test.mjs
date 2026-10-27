import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { importSource, bookmarkHTML, mergeSections } from "../core/import.mjs";
const fixture = JSON.parse(
  await readFile(
    new URL("../fixtures/workspaces.json", import.meta.url),
    "utf8",
  ),
);
test("HTML bookmarks preserve hierarchy, entities and pin metadata without executing markup", () => {
  const html =
    '<!DOCTYPE NETSCAPE-Bookmark-file-1><DL><p><DT><H3>Work &amp; tools</H3><DL><p><DT><H3>Reference</H3><DL><p><DT><A HREF="https://example.com/?a=1&amp;b=2" data-pinned="true">Docs &amp; notes</A></DL><p></DL><p><DT><H3>Personal</H3><DL><p><DT><A HREF="https://example.org/">Reading</A></DL><p></DL>';
  const result = importSource(html);
  assert.equal(result.archive.profiles.length, 2);
  const tab = result.archive.profiles[0].spaces[0].tabs[0];
  assert.equal(tab.title, "Docs & notes");
  assert.equal(tab.url, "https://example.com/?a=1&b=2");
  assert.equal(tab.pinned, true);
  assert.deepEqual(tab.folder, ["Reference"]);
});
test("bookmark export escapes HTML and filters dangerous URLs", () => {
  const value = structuredClone(fixture);
  value.profiles[0].spaces[0].tabs.push({
    id: "bad",
    url: "javascript:alert(1)",
    title: "<script>bad</script>",
  });
  value.profiles[0].name = "<script>hello</script>";
  const html = bookmarkHTML(value);
  assert.match(html, /&lt;script&gt;hello/);
  assert.doesNotMatch(html, /javascript:|<script>/);
  const restored = importSource(html);
  assert.equal(
    restored.archive.profiles.flatMap((p) => p.spaces.flatMap((s) => s.tabs))
      .length,
    3,
  );
});
test("flat exports disclose missing profile metadata; explicit regrouping keeps all tabs", () => {
  const result = importSource(
    '<html><a href="https://example.com">One</a><a href="https://example.org">Two</a></html>',
  );
  assert.equal(result.archive.profiles.length, 1);
  assert.match(result.warnings.join(" "), /profile/);
  const merged = mergeSections(fixture, { work: "Both", personal: "Both" });
  assert.equal(merged.profiles.length, 1);
  assert.equal(merged.profiles[0].spaces.length, 2);
});
test("unsupported JSON, empty HTML and malformed sidebar shapes fail clearly", () => {
  assert.throws(() => importSource("{bad"), /malformed/);
  assert.throws(() => importSource('{"surprise":[]}'), /Unrecognized/);
  assert.throws(() => importSource("<html>No links</html>"), /No links/);
  assert.throws(
    () =>
      importSource(
        JSON.stringify({
          sidebar: { containers: [{ spaces: ["odd"], items: [] }] },
        }),
      ),
    /Unsupported/,
  );
});
test("sidebar adapter walks documented roots with folder and pin state; cycles are rejected", () => {
  const value = {
    sidebar: {
      containers: [
        {
          spaces: [
            "space",
            { title: "Work", newContainerIDs: [{ pinned: {} }, "root"] },
          ],
          items: [
            "root",
            { data: { itemContainer: {} }, childrenIds: ["folder"] },
            "folder",
            { title: "Reference", data: { list: {} }, childrenIds: ["tab"] },
            "tab",
            {
              data: {
                tab: { savedURL: "https://example.com", savedTitle: "Docs" },
              },
            },
          ],
        },
      ],
    },
  };
  const result = importSource(JSON.stringify(value));
  const tab = result.archive.profiles[0].spaces[0].tabs[0];
  assert.equal(tab.pinned, true);
  assert.deepEqual(tab.folder, ["Reference"]);
  assert.equal(result.adapter, "Arc sidebar · experimental adapter");
  value.sidebar.containers[0].items[3].childrenIds = ["root"];
  assert.throws(() => importSource(JSON.stringify(value)), /cycle/);
});
