import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readArchive, buildPlan } from "../core/archive.mjs";
const fixture = JSON.parse(
  await readFile(
    new URL("../fixtures/workspaces.json", import.meta.url),
    "utf8",
  ),
);
const mappings = {
  work: { profileId: "firefox-work", spaces: "groups" },
  personal: { profileId: "firefox-personal", spaces: "windows" },
};

test("plan preserves order, pins, folder paths and separate profiles", () => {
  const plan = buildPlan(fixture, mappings);
  assert.deepEqual(
    plan.operations.map((o) => o.sourceId),
    ["docs", "issues", "read"],
  );
  assert.equal(plan.operations[0].pinned, true);
  assert.deepEqual(plan.operations[0].folder, ["Reference"]);
  assert.equal(plan.operations[0].targetProfileId, "firefox-work");
  assert.equal(plan.operations[2].targetProfileId, "firefox-personal");
  assert.equal(
    plan.operations.length,
    3,
    "same URL in different profiles must survive",
  );
});
test("missing mappings and merged authentication boundaries fail explicitly", () => {
  assert.throws(() => buildPlan(fixture, {}), /Choose a Firefox profile/);
  assert.throws(
    () => buildPlan(fixture, { ...mappings, personal: mappings.work }),
    /separate Firefox profiles/,
  );
});
test("unsafe URL schemes and credential-bearing URLs are reported rather than opened", () => {
  const archive = structuredClone(fixture);
  archive.profiles[0].spaces[0].tabs.push(
    ...[
      "javascript:alert(1)",
      "file:///tmp/private",
      "data:text/html,hi",
      "https://user:secret@example.com",
    ].map((url, i) => ({ id: `unsafe-${i}`, url })),
  );
  const plan = buildPlan(archive, mappings);
  assert.equal(plan.operations.length, 3);
  assert.equal(plan.skipped.length, 4);
  assert.ok(plan.skipped.every((s) => !JSON.stringify(s).includes("secret")));
});
test("reject unknown formats, duplicate IDs and invalid pinned states", () => {
  assert.throws(() => readArchive({ version: 2 }), /Unsupported archive/);
  const archive = structuredClone(fixture);
  archive.profiles[0].spaces[0].tabs[1].id = "docs";
  assert.throws(() => readArchive(archive), /Duplicate source ID/);
  const invalid = structuredClone(fixture);
  invalid.profiles[0].spaces[0].tabs[0].pinned = "true";
  assert.throws(() => readArchive(invalid), /pinned/);
});
test("planning never modifies the source archive", () => {
  const before = JSON.stringify(fixture);
  const plan = buildPlan(fixture, mappings);
  plan.operations[0].folder.push("Changed");
  assert.equal(JSON.stringify(fixture), before);
});
test("portable archives reject IDs reserved by object prototypes", () => {
  const value = structuredClone(fixture);
  value.profiles[0].spaces[0].tabs[0].id = "__proto__";
  assert.throws(() => readArchive(value), /Reserved source ID/);
});
