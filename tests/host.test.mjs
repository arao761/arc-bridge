import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
function client(child) {
  let buffer = Buffer.alloc(0),
    seq = 0;
  const pending = new Map();
  child.stdout.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 4) {
      const size = buffer.readUInt32LE(0);
      if (buffer.length < 4 + size) return;
      const m = JSON.parse(buffer.subarray(4, 4 + size));
      buffer = buffer.subarray(4 + size);
      pending.get(m.requestId)?.(m);
      pending.delete(m.requestId);
    }
  });
  return async (message, fragment = false) => {
    const requestId = ++seq;
    const result = new Promise((r) => pending.set(requestId, r));
    const body = Buffer.from(JSON.stringify({ ...message, requestId })),
      head = Buffer.alloc(4);
    head.writeUInt32LE(body.length);
    const packet = Buffer.concat([head, body]);
    if (fragment) {
      child.stdin.write(packet.subarray(0, 2));
      child.stdin.write(packet.subarray(2));
    } else child.stdin.write(packet);
    return result;
  };
}
test("native host framing, profile binding, chunking, report ownership and terminal-state filtering", async () => {
  const dir = await mkdtemp(join(tmpdir(), "arc-host-"));
  const child = spawn(process.execPath, ["desktop/host.cjs"], {
    env: { ...process.env, ARCBRIDGE_DATA: dir },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const send = client(child);
  try {
    await mkdir(join(dir, "jobs"));
    const job = {
      format: "arc-bridge-migration",
      version: 1,
      id: "job-1",
      targetProfileId: "receiver-one",
      authorized: true,
      state: "queued",
      runToken: "run-one",
      action: "migrate",
      operations: Array.from({ length: 105 }, (_, i) => ({
        sourceId: String(i),
        title: "Synthetic",
      })),
    };
    await writeFile(join(dir, "jobs/job-1.json"), JSON.stringify(job));
    assert.ok((await send({ type: "poll" })).error);
    assert.ok(
      (
        await send(
          {
            type: "hello",
            profileId: "receiver-one",
            label: "Test profile",
            enabled: true,
            groups: false,
          },
          true,
        )
      ).ok,
    );
    const poll = await send({ type: "poll" });
    assert.equal(poll.job.id, "job-1");
    const chunk = await send({
      type: "chunk",
      id: "job-1",
      runToken: "run-one",
      offset: 0,
    });
    assert.equal(chunk.operations.length, 50);
    assert.equal(chunk.nextOffset, 50);
    assert.ok(
      (
        await send({
          type: "chunk",
          id: "../escape",
          runToken: "run-one",
          offset: 0,
        })
      ).error,
    );
    assert.ok(
      (await send({ type: "chunk", id: "job-1", runToken: "wrong", offset: 0 }))
        .error,
    );
    assert.ok(
      (
        await send({
          type: "hello",
          profileId: "different-profile",
          label: "Other",
          enabled: true,
        })
      ).error,
    );
    assert.ok(
      (
        await send({
          type: "report",
          id: "job-1",
          runToken: "run-one",
          report: { id: "job-1", status: "completed", done: 105 },
        })
      ).ok,
    );
    assert.equal((await send({ type: "poll" })).job, null);
    const report = JSON.parse(
      await readFile(join(dir, "reports/job-1.json"), "utf8"),
    );
    assert.equal(report.done, 105);
  } finally {
    const exited = once(child, "exit");
    child.stdin.end();
    await exited;
    await rm(dir, { recursive: true, force: true });
  }
});
