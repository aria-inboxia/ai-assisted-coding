// Epic + phase state persisted as flat JSON under .workbench/epics/<id>.json.
// No database. Writes are atomic (tmp file + rename). The real artifacts each
// phase produces (.feature files, specs, code, the PR) live in the epic's git
// worktree — this store only references them. Also holds the per-phase audit
// journal and the global daily cost ledger.

import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  existsSync,
  renameSync,
} from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { PHASE_NAMES } from "./validate.js";

const DATA_DIR = path.resolve(process.env.WORKBENCH_DATA ?? ".workbench");
const EPICS_DIR = path.join(DATA_DIR, "epics");
const BUDGET_FILE = path.join(DATA_DIR, "budget.json");

function ensureDir() {
  mkdirSync(EPICS_DIR, { recursive: true });
}

function epicFile(id) {
  return path.join(EPICS_DIR, `${id}.json`);
}

function now() {
  return new Date().toISOString();
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

// Crash-safe write: write to a temp file then atomically rename into place.
function atomicWrite(file, contents) {
  ensureDir();
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, contents);
  renameSync(tmp, file);
}

function blankPhase() {
  return {
    status: "pending", // pending | running | awaiting_approval | done | error | cancelled
    sessionId: null,
    runId: null,
    startedAt: null,
    endedAt: null,
    costUsd: 0,
    resultSubtype: null,
    deliverable: null,
  };
}

export function createEpic({ title, input, links }) {
  ensureDir();
  const id = randomUUID();
  const stamp = now();
  const epic = {
    id,
    title,
    input,
    links: links ?? [],
    answers: null,
    sessionId: null,
    branch: null,
    worktreePath: null,
    createdAt: stamp,
    updatedAt: stamp,
    phases: Object.fromEntries(PHASE_NAMES.map((p) => [p, blankPhase()])),
    gates: { challengeAnswered: false, featuresApproved: false },
  };
  return writeEpic(epic);
}

export function writeEpic(epic) {
  const updated = { ...epic, updatedAt: now() };
  atomicWrite(epicFile(epic.id), JSON.stringify(updated, null, 2));
  return updated;
}

export function getEpic(id) {
  if (!existsSync(epicFile(id))) return null;
  return JSON.parse(readFileSync(epicFile(id), "utf8"));
}

export function listEpics() {
  ensureDir();
  return readdirSync(EPICS_DIR)
    .filter((f) => f.endsWith(".json") && !f.endsWith(".tmp"))
    .map((f) => JSON.parse(readFileSync(path.join(EPICS_DIR, f), "utf8")))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

// Immutably patch one phase and persist.
export function patchPhase(id, phase, patch) {
  const epic = getEpic(id);
  if (!epic) return null;
  const next = {
    ...epic,
    phases: {
      ...epic.phases,
      [phase]: { ...epic.phases[phase], ...patch },
    },
  };
  return writeEpic(next);
}

// --- per-phase audit journal (raw stream-json transcript) ------------------

export function phaseLogPath(epicId, phase) {
  const dir = path.join(EPICS_DIR, epicId);
  mkdirSync(dir, { recursive: true });
  return path.join(dir, `${phase}.ndjson`);
}

export function readPhaseLog(epicId, phase) {
  const file = path.join(EPICS_DIR, epicId, `${phase}.ndjson`);
  return existsSync(file) ? readFileSync(file, "utf8") : null;
}

// --- global daily cost ledger ----------------------------------------------

export function readSpentToday() {
  try {
    const b = JSON.parse(readFileSync(BUDGET_FILE, "utf8"));
    return b.date === today() ? b.spentUsd : 0;
  } catch {
    return 0;
  }
}

export function addSpend(usd) {
  const next = { date: today(), spentUsd: readSpentToday() + (usd || 0) };
  atomicWrite(BUDGET_FILE, JSON.stringify(next, null, 2));
  return next.spentUsd;
}
