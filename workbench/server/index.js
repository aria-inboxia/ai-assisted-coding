// Workbench control-plane HTTP + SSE server. Binds 127.0.0.1 only — it spawns
// `claude` with the user's own credentials and must never be reachable off-box.

import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  validateEpicInput,
  isPhase,
  isId,
  isGate,
  sanitizeText,
  MAX_ANSWERS,
} from "./validate.js";
import {
  createEpic,
  getEpic,
  listEpics,
  writeEpic,
  patchPhase,
  readSpentToday,
  readPhaseLog,
} from "./store.js";
import {
  startPhase,
  cancelEpic,
  cleanupEpic,
  isEpicBusy,
  atCapacity,
  shutdownAll,
} from "./runner.js";
import { subscribe, pingAll } from "./sse.js";

const execFileP = promisify(execFile);
const PORT = Number(process.env.WORKBENCH_PORT ?? 4319);
const HOST = "127.0.0.1";
const EPIC_BUDGET_CAP = Number(process.env.WORKBENCH_EPIC_CAP ?? 45);
const DAILY_BUDGET_CAP = Number(process.env.WORKBENCH_BUDGET_DAILY ?? 200);
const SECRET = process.env.WORKBENCH_SECRET || null;
const TRACE_TOOL = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../tools/trace/trace.js",
);
const ALLOWED_ORIGINS = new Set([
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
  `http://localhost:${PORT}`,
  `http://127.0.0.1:${PORT}`,
]);

function send(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}
const ok = (res, data) => send(res, 200, { success: true, data });
const fail = (res, status, error) =>
  send(res, status, { success: false, error });

async function readJson(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return null;
  }
}

function precondition(epic, phase) {
  if (phase === "challenge") return null;
  if (phase === "testplan") {
    return epic.gates.challengeAnswered
      ? null
      : "review the challenge phase first";
  }
  if (phase === "implement") {
    return epic.gates.featuresApproved
      ? null
      : "approve the feature scenarios first";
  }
  if (phase === "ship") {
    return epic.phases.implement.status === "done"
      ? null
      : "complete implementation first";
  }
  return "unknown phase";
}

function epicCost(epic) {
  return Object.values(epic.phases).reduce((n, p) => n + (p.costUsd ?? 0), 0);
}

async function traceability(epic) {
  if (!epic.worktreePath) return { status: "absent" };
  const resolved = path.resolve(epic.worktreePath);
  if (
    resolved.includes("..") ||
    !resolved.includes(`${path.sep}.workbench-trees${path.sep}`)
  ) {
    return { status: "error", error: "invalid worktree path" };
  }
  try {
    const { stdout } = await execFileP(
      "node",
      [
        TRACE_TOOL,
        "matrix",
        "--root",
        resolved,
        "--results",
        "test-results-acceptance/results.json",
      ],
      { encoding: "utf8" },
    );
    return { status: "ok", ...JSON.parse(stdout) };
  } catch (err) {
    return {
      status: "error",
      error: String(err?.message ?? err).slice(0, 500),
    };
  }
}

// Mark phases left mid-run by a crashed/killed backend as errored, so they aren't
// stuck "running" forever and the user can re-run.
function recoverStaleRuns() {
  for (const epic of listEpics()) {
    for (const [phase, st] of Object.entries(epic.phases)) {
      if (st.status === "running" && !st.endedAt) {
        patchPhase(epic.id, phase, {
          status: "error",
          resultSubtype: "backend_restart",
          endedAt: new Date().toISOString(),
        });
      }
    }
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  const parts = url.pathname.split("/").filter(Boolean);

  // Origin guard: block any request carrying a non-allowlisted Origin (browser
  // cross-origin / DNS-rebind). Header-less requests (curl/CLI) pass.
  const origin = req.headers.origin;
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return fail(res, 403, "forbidden origin");
  }

  // GET /events/:runId  (Server-Sent Events — EventSource cannot send headers,
  // so it is not bearer-protected; it relies on the Origin guard + unguessable id.)
  if (req.method === "GET" && parts[0] === "events" && parts[1]) {
    return subscribe(parts[1], res);
  }

  if (parts[0] !== "api") return fail(res, 404, "not found");

  // Opt-in shared-secret auth on the API surface (off unless WORKBENCH_SECRET set).
  if (SECRET && req.headers.authorization !== `Bearer ${SECRET}`) {
    return fail(res, 401, "unauthorized");
  }

  if (req.method === "GET" && parts[1] === "health") {
    return ok(res, { ok: true, spentTodayUsd: readSpentToday() });
  }

  if (req.method === "POST" && parts[1] === "epics" && parts.length === 2) {
    const body = await readJson(req);
    if (body === null) return fail(res, 400, "invalid JSON");
    const result = validateEpicInput(body);
    if (!result.ok) return fail(res, 400, result.errors.join("; "));
    return send(res, 201, { success: true, data: createEpic(result.value) });
  }

  if (req.method === "GET" && parts[1] === "epics" && parts.length === 2) {
    return ok(res, listEpics());
  }

  if (parts[1] === "epics" && parts[2]) {
    const id = parts[2];
    if (!isId(id)) return fail(res, 400, "invalid epic id");
    const epic = getEpic(id);
    if (!epic) return fail(res, 404, "epic not found");

    if (req.method === "GET" && parts.length === 3) return ok(res, epic);

    if (
      req.method === "GET" &&
      parts[3] === "traceability" &&
      parts.length === 4
    ) {
      return ok(res, await traceability(epic));
    }

    // GET /api/epics/:id/phases/:phase/log
    if (req.method === "GET" && parts[3] === "phases" && parts[5] === "log") {
      const phase = parts[4];
      if (!isPhase(phase)) return fail(res, 400, "invalid phase");
      return ok(res, { phase, log: readPhaseLog(id, phase) });
    }

    if (req.method === "POST" && parts[3] === "phases" && parts[5] === "run") {
      const phase = parts[4];
      if (!isPhase(phase)) return fail(res, 400, "invalid phase");
      if (isEpicBusy(id))
        return fail(res, 409, "a phase is already running for this epic");
      if (atCapacity())
        return fail(res, 429, "too many concurrent runs; try again shortly");
      const pre = precondition(epic, phase);
      if (pre) return fail(res, 412, pre);
      if (epicCost(epic) >= EPIC_BUDGET_CAP) {
        return fail(res, 402, `epic budget cap ($${EPIC_BUDGET_CAP}) reached`);
      }
      if (readSpentToday() >= DAILY_BUDGET_CAP) {
        return fail(
          res,
          402,
          `daily budget cap ($${DAILY_BUDGET_CAP}) reached`,
        );
      }
      const runId = randomUUID();
      startPhase(epic, phase, runId);
      return send(res, 202, { success: true, data: { runId } });
    }

    if (
      req.method === "POST" &&
      parts[3] === "phases" &&
      parts[5] === "cancel"
    ) {
      return ok(res, { cancelled: cancelEpic(id) });
    }

    if (req.method === "POST" && parts[3] === "cleanup" && parts.length === 4) {
      try {
        return ok(res, cleanupEpic(epic));
      } catch (err) {
        return fail(res, 409, err.message);
      }
    }

    if (
      req.method === "POST" &&
      parts[3] === "gate" &&
      parts[5] === "approve"
    ) {
      const gate = parts[4];
      if (!isGate(gate)) return fail(res, 400, "invalid gate");
      const body = await readJson(req);
      const patch = { gates: { ...epic.gates, [gate]: true } };
      if (gate === "challengeAnswered" && typeof body?.answers === "string") {
        patch.answers = sanitizeText(body.answers, MAX_ANSWERS);
      }
      return ok(res, writeEpic({ ...epic, ...patch }));
    }
  }

  return fail(res, 404, "not found");
});

export { server, recoverStaleRuns };

// Only listen + install process-wide handlers when run directly (not when
// imported by a test).
const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? "").href;

if (isMain) {
  const heartbeat = setInterval(pingAll, 15000);
  heartbeat.unref();

  const gracefulShutdown = (signal) => {
    console.log(`\n[workbench] ${signal} — stopping runs and server…`);
    clearInterval(heartbeat);
    shutdownAll();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 8000).unref();
  };
  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));

  recoverStaleRuns();

  server.listen(PORT, HOST, () => {
    console.log(
      `Workbench backend on http://${HOST}:${PORT} — epic cap $${EPIC_BUDGET_CAP}, daily cap $${DAILY_BUDGET_CAP}${SECRET ? ", auth on" : ""}.`,
    );
    console.log(
      "Runs consume your own Claude usage up to the per-phase --max-budget-usd caps.",
    );
  });
}
