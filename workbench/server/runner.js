// Spawns `claude -p` headless per phase, parses its stream-json output into
// typed SSE events, and manages per-epic git-worktree isolation plus timeout,
// budget, concurrency, audit logging, and independent verification.

import { spawn, execFile, execFileSync } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdirSync, existsSync, symlinkSync, createWriteStream } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";

import { PHASES, buildArgs } from "./phases.js";
import { publish, closeChannel } from "./sse.js";
import {
  getEpic,
  writeEpic,
  patchPhase,
  addSpend,
  phaseLogPath,
} from "./store.js";

const execFileP = promisify(execFile);
const GLOBAL_CONCURRENCY = 3;
const REPORT_CAP = 24000; // max chars of agent narration kept in deliverable.report
const live = new Map(); // epicId -> { child, phase, runId, cancelled, timedOut }
const TRACE_TOOL = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../tools/trace/trace.js",
);

// Env vars the child genuinely needs (shell/runtime + AI/VCS auth). Everything
// else on the machine (AWS/GCP/DB/3rd-party secrets) is withheld from the agent.
const ENV_ALLOW = new Set([
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "LANG",
  "TERM",
  "TMPDIR",
  "TZ",
  "COLORTERM",
  "WORKBENCH_MODEL",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_BASE_URL",
  "GITHUB_TOKEN",
]);

export function buildChildEnv() {
  const env = {};
  for (const key of Object.keys(process.env)) {
    if (
      ENV_ALLOW.has(key) ||
      key.startsWith("CLAUDE_") ||
      key.startsWith("LC_") ||
      key.startsWith("GH_") ||
      key.startsWith("NPM_") ||
      key.startsWith("npm_") ||
      key.startsWith("PNPM_")
    ) {
      env[key] = process.env[key];
    }
  }
  return env;
}

export { live };

export function isEpicBusy(epicId) {
  return live.has(epicId);
}

export function atCapacity() {
  return live.size >= GLOBAL_CONCURRENCY;
}

// SIGTERM all live children, escalating to SIGKILL; used on graceful shutdown.
export function shutdownAll() {
  for (const entry of live.values()) {
    try {
      entry.child?.kill("SIGTERM");
    } catch {
      // already gone
    }
  }
  setTimeout(() => {
    for (const entry of live.values()) {
      try {
        entry.child?.kill("SIGKILL");
      } catch {
        // already gone
      }
    }
  }, 5000).unref();
}

// ---- stream-json → SSE mapping (pure, exported for tests) -----------------

function summarise(content) {
  const text =
    typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content
            .map((b) => (typeof b === "string" ? b : (b?.text ?? "")))
            .join(" ")
        : "";
  return text.length > 500 ? `${text.slice(0, 500)}…` : text;
}

export function mapClaudeEvent(evt) {
  if (!evt || typeof evt !== "object") return [];
  switch (evt.type) {
    case "system":
      if (evt.subtype === "init") {
        return [
          {
            event: "init",
            data: {
              sessionId: evt.session_id,
              model: evt.model,
              permissionMode: evt.permissionMode,
              slashCommands: evt.slash_commands ?? [],
            },
          },
        ];
      }
      return [];
    case "assistant": {
      const out = [];
      for (const block of evt.message?.content ?? []) {
        if (block.type === "text" && block.text) {
          out.push({ event: "assistant_text", data: { text: block.text } });
        } else if (block.type === "tool_use") {
          out.push({
            event: "tool_use",
            data: { id: block.id, name: block.name, input: block.input },
          });
        }
      }
      return out;
    }
    case "user": {
      const out = [];
      for (const block of evt.message?.content ?? []) {
        if (block.type === "tool_result") {
          out.push({
            event: "tool_result",
            data: {
              toolUseId: block.tool_use_id,
              isError: !!block.is_error,
              summary: summarise(block.content),
            },
          });
        }
      }
      return out;
    }
    case "result":
      return [
        {
          event: "result",
          data: {
            subtype: evt.subtype,
            isError: !!evt.is_error,
            finalText: evt.result ?? "",
            costUsd: evt.total_cost_usd ?? 0,
            sessionId: evt.session_id,
            numTurns: evt.num_turns ?? 0,
          },
        },
      ];
    default:
      return [];
  }
}

// ---- git worktree isolation -----------------------------------------------

function repoRoot() {
  const common = execFileSync("git", ["rev-parse", "--git-common-dir"], {
    encoding: "utf8",
  }).trim();
  const abs = path.resolve(common);
  return path.basename(abs) === ".git" ? path.dirname(abs) : abs;
}

function slugify(title) {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32) || "epic"
  );
}

// A fresh worktree has no node_modules; symlink the repo's so the agent's own
// `pnpm test/build` work without a slow per-epic install.
function linkNodeModules(root, dir) {
  const src = path.join(root, "node_modules");
  const dest = path.join(dir, "node_modules");
  if (existsSync(src) && !existsSync(dest)) {
    try {
      symlinkSync(src, dest, "dir");
    } catch {
      // best effort — the agent can pnpm install if needed
    }
  }
}

// Create (once) a git worktree for the epic, branched off origin/main (override
// with WORKBENCH_BASE), outside this checkout. Throws a clear error on failure.
function ensureWorktree(epic) {
  if (epic.worktreePath && existsSync(epic.worktreePath)) {
    return { dir: epic.worktreePath, branch: epic.branch };
  }
  const root = repoRoot();
  const treesDir = path.join(root, ".workbench-trees");
  mkdirSync(treesDir, { recursive: true });
  const dir = path.join(treesDir, epic.id);
  const branch = `workbench/${slugify(epic.title)}-${epic.id.slice(0, 8)}`;
  const base = process.env.WORKBENCH_BASE || "origin/main";
  try {
    if (base === "origin/main") {
      execFileSync("git", ["-C", root, "fetch", "origin", "main"], {
        stdio: "ignore",
      });
    }
    execFileSync(
      "git",
      ["-C", root, "worktree", "add", dir, "-b", branch, base],
      { stdio: "ignore" },
    );
  } catch (err) {
    throw new Error(
      `could not create git worktree off ${base}: ${err.message}`,
    );
  }
  linkNodeModules(root, dir);
  writeEpic({ ...epic, branch, worktreePath: dir });
  return { dir, branch };
}

// ---- phase execution -------------------------------------------------------

function extractDeliverable(phase, finalText) {
  if (phase === "ship") {
    const m = finalText.match(/https:\/\/github\.com\/\S+\/pull\/\d+/);
    return { kind: "ship", prUrl: m ? m[0] : null, finalText };
  }
  return { kind: phase, finalText };
}

// Independent verification: don't trust the agent's "done" — run the traceability
// gate over its artifacts in the worktree. Returns { verified, detail }.
async function verifyImplement(dir) {
  try {
    await execFileP(
      "node",
      [
        TRACE_TOOL,
        "check",
        "--root",
        dir,
        "--results",
        "test-results-acceptance/results.json",
      ],
      { cwd: dir, encoding: "utf8" },
    );
    return {
      verified: true,
      detail: "traceability gate passed (covered + passing)",
    };
  } catch (err) {
    const out = `${err.stdout ?? ""}${err.stderr ?? ""}`.trim();
    return { verified: false, detail: (out || err.message).slice(0, 1200) };
  }
}

async function finalize(epicId, phase, result, code, stderr, flags) {
  const def = PHASES[phase];
  const { cancelled, timedOut, dir, report } = flags;
  const success = !!result && result.subtype === "success" && !result.isError;
  let status = cancelled
    ? "cancelled"
    : success
      ? def.gate
        ? "awaiting_approval"
        : "done"
      : "error";
  const resultSubtype = timedOut
    ? "timeout"
    : (result?.subtype ?? (code === 0 ? "unknown" : "process_error"));
  let deliverable = result
    ? extractDeliverable(phase, result.finalText)
    : { kind: phase, finalText: "", error: stderr.slice(0, 1000) };
  // Persist the full agent narration (e.g. the challenge questions) so the
  // cockpit can show it — result.finalText is only the closing summary.
  if (report && report.trim()) {
    deliverable = { ...deliverable, report: report.slice(0, REPORT_CAP) };
  }

  if (phase === "implement" && success && dir) {
    const verification = await verifyImplement(dir);
    deliverable = { ...deliverable, verification };
    if (!verification.verified) status = "error"; // gate failed → not actually done
  }

  try {
    patchPhase(epicId, phase, {
      status,
      endedAt: new Date().toISOString(),
      costUsd: result?.costUsd ?? 0,
      resultSubtype,
      deliverable,
    });
    if (result?.costUsd) addSpend(result.costUsd);
    if (result?.sessionId) {
      const epic = getEpic(epicId);
      if (epic && !epic.sessionId)
        writeEpic({ ...epic, sessionId: result.sessionId });
    }
  } catch (err) {
    console.error(
      `[workbench] finalize persistence failed for ${epicId}/${phase}: ${err.message}`,
    );
  }
  return status;
}

// Fire-and-forget: reserves the epic, starts the child, streams to the runId
// channel, resolves immediately. Caller must have checked gates + capacity.
export function startPhase(epic, phase, runId) {
  const def = PHASES[phase];
  // Reserve synchronously so a concurrent request fails isEpicBusy before any IO.
  const entry = {
    child: null,
    phase,
    runId,
    cancelled: false,
    timedOut: false,
  };
  live.set(epic.id, entry);

  try {
    const { dir, branch } = ensureWorktree(getEpic(epic.id) ?? epic);
    const fresh = getEpic(epic.id);
    const sessionId = fresh.sessionId ?? randomUUID();
    const prompt = def.prompt(fresh);
    const args = buildArgs({
      phase,
      prompt,
      sessionId,
      resumeSessionId: def.resume ? fresh.sessionId : null,
      model: process.env.WORKBENCH_MODEL,
    });

    patchPhase(epic.id, phase, {
      status: "running",
      startedAt: new Date().toISOString(),
      sessionId,
      runId,
      endedAt: null,
      deliverable: null,
    });
    if (!fresh.sessionId) writeEpic({ ...getEpic(epic.id), sessionId });
    publish(runId, "phase_status", { phase, status: "running", branch });

    const child = spawn("claude", args, { cwd: dir, env: buildChildEnv() });
    entry.child = child;

    let journal = null;
    try {
      journal = createWriteStream(phaseLogPath(epic.id, phase), { flags: "w" });
    } catch {
      journal = null;
    }

    const timer = setTimeout(() => {
      entry.timedOut = true;
      publish(runId, "phase_status", { phase, status: "timeout" });
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5000);
    }, def.timeoutMs);

    let lastResult = null;
    let assistantText = "";
    let stderr = "";
    const rl = createInterface({ input: child.stdout });
    rl.on("line", (line) => {
      if (!line.trim()) return;
      if (journal) {
        try {
          journal.write(`${line}\n`);
        } catch {
          // journal best-effort
        }
      }
      let evt;
      try {
        evt = JSON.parse(line);
      } catch {
        return; // ignore non-JSON lines defensively
      }
      if (evt.type === "result") lastResult = evt;
      for (const sse of mapClaudeEvent(evt)) {
        publish(runId, sse.event, sse.data);
        // Accumulate only up to the cap finalize() keeps so a long transcript
        // can't grow the buffer unbounded.
        if (sse.event === "assistant_text" && assistantText.length < REPORT_CAP)
          assistantText += sse.data.text;
      }
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("error", (err) => {
      stderr +=
        err.code === "ENOENT"
          ? "\n[spawn error] `claude` CLI not found on PATH"
          : `\n[spawn error] ${err.message}`;
    });
    child.on("close", async (code) => {
      clearTimeout(timer);
      try {
        rl.close();
      } catch {
        // already closed
      }
      try {
        journal?.end();
      } catch {
        // already closed
      }
      if (!live.has(epic.id)) return; // idempotent: only finalize once
      const mapped = lastResult ? mapClaudeEvent(lastResult)[0]?.data : null;
      // Keep the epic reserved through the (async) independent verification so a
      // concurrent run can't start mid-verify; release only once finalized.
      const status = await finalize(epic.id, phase, mapped, code, stderr, {
        cancelled: entry.cancelled,
        timedOut: entry.timedOut,
        dir,
        report: assistantText,
      });
      live.delete(epic.id);
      const sseStatus = entry.cancelled
        ? "cancelled"
        : entry.timedOut
          ? "timeout"
          : status === "error"
            ? "error"
            : "complete";
      publish(runId, "phase_status", { phase, status: sseStatus });
      closeChannel(runId);
    });

    return { runId, sessionId };
  } catch (err) {
    // Failure before the child's handlers were attached (worktree/spawn): release
    // the reservation and surface the error to the stream so the UI isn't stuck.
    live.delete(epic.id);
    try {
      patchPhase(epic.id, phase, {
        status: "error",
        endedAt: new Date().toISOString(),
        resultSubtype: "startup_error",
        deliverable: { kind: phase, finalText: "", error: err.message },
      });
    } catch {
      // ignore secondary failure
    }
    publish(runId, "assistant_text", {
      text: `Failed to start phase: ${err.message}`,
    });
    publish(runId, "phase_status", { phase, status: "error" });
    closeChannel(runId);
    return { runId, error: err.message };
  }
}

// Remove an epic's worktree (frees disk). Keeps the branch so an open PR is
// never orphaned. Refuses while a phase is live.
export function cleanupEpic(epic) {
  if (live.has(epic.id)) {
    throw new Error("cannot clean up an epic with a running phase");
  }
  if (!epic.worktreePath) return { removed: false };
  const root = repoRoot();
  try {
    execFileSync(
      "git",
      ["-C", root, "worktree", "remove", "--force", epic.worktreePath],
      { stdio: "ignore" },
    );
  } catch {
    // worktree may already be gone
  }
  writeEpic({ ...epic, worktreePath: null });
  return { removed: true, branch: epic.branch };
}

export function cancelEpic(epicId) {
  const entry = live.get(epicId);
  if (!entry) return false;
  entry.cancelled = true;
  try {
    entry.child?.kill("SIGTERM");
    setTimeout(() => entry.child?.kill("SIGKILL"), 5000);
  } catch {
    // already gone
  }
  return true;
}
