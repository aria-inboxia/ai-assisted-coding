import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// The server is import-safe (it only listens when run as main). We point it at a
// temp data dir, listen on an ephemeral port, and drive it over real HTTP.
let server;
let store;
let recoverStaleRuns;
let base;

beforeAll(async () => {
  process.env.WORKBENCH_DATA = mkdtempSync(path.join(tmpdir(), "wb-it-"));
  delete process.env.WORKBENCH_SECRET;
  store = await import("./store.js");
  const mod = await import("./index.js");
  server = mod.server;
  recoverStaleRuns = mod.recoverStaleRuns;
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

const post = (p, body, headers) =>
  fetch(base + p, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body ?? {}),
  });
const createEpic = async (title) =>
  (await (await post("/api/epics", { title, input: "do a thing" })).json())
    .data;

describe("workbench HTTP API", () => {
  it("serves health", async () => {
    const r = await fetch(`${base}/api/health`);
    expect(r.status).toBe(200);
    expect((await r.json()).success).toBe(true);
  });

  it("creates an epic and validates input", async () => {
    const good = await post("/api/epics", { title: "API test", input: "x" });
    expect(good.status).toBe(201);
    const created = (await good.json()).data;
    expect(created.id).toBeTruthy();
    expect((await post("/api/epics", { title: "", input: "x" })).status).toBe(
      400,
    );
    expect(
      (await post("/api/epics", { title: "ok", input: "x".repeat(20001) }))
        .status,
    ).toBe(400);
    expect((await fetch(`${base}/api/epics/${created.id}`)).status).toBe(200);
    expect((await fetch(`${base}/api/epics/not-a-uuid`)).status).toBe(400);
    expect(
      (await fetch(`${base}/api/epics/00000000-0000-0000-0000-000000000000`))
        .status,
    ).toBe(404);
  });

  it("enforces phase preconditions (412) without spawning", async () => {
    const epic = await createEpic("Precond");
    expect(
      (await post(`/api/epics/${epic.id}/phases/implement/run`)).status,
    ).toBe(412);
  });

  it("blocks a foreign Origin (403)", async () => {
    const r = await fetch(`${base}/api/epics`, {
      headers: { Origin: "http://evil.example" },
    });
    expect(r.status).toBe(403);
  });

  it("approves a gate and sanitises answers", async () => {
    const epic = await createEpic("Gate");
    const r = await post(
      `/api/epics/${epic.id}/gate/challengeAnswered/approve`,
      {
        answers: "reviewedok",
      },
    );
    expect(r.status).toBe(200);
    const updated = (await r.json()).data;
    expect(updated.gates.challengeAnswered).toBe(true);
    expect(updated.answers).toBe("reviewedok"); // control char stripped
  });

  it("cleans up an epic with no worktree (removed:false)", async () => {
    const epic = await createEpic("Clean");
    const r = await post(`/api/epics/${epic.id}/cleanup`);
    expect((await r.json()).data.removed).toBe(false);
  });

  it("recovers stale 'running' phases on restart", () => {
    const epic = store.createEpic({ title: "Stale", input: "x", links: [] });
    store.patchPhase(epic.id, "challenge", {
      status: "running",
      endedAt: null,
    });
    recoverStaleRuns();
    const after = store.getEpic(epic.id);
    expect(after.phases.challenge.status).toBe("error");
    expect(after.phases.challenge.resultSubtype).toBe("backend_restart");
  });
});
