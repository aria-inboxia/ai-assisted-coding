import { useState, useEffect, useCallback } from "react";
import { api } from "../lib/api.js";
import { useRunStream } from "../lib/useRunStream.js";
import { PhaseStepper } from "../components/PhaseStepper.jsx";
import { LiveRunView } from "../components/LiveRunView.jsx";
import { TraceabilityMatrix } from "../components/TraceabilityMatrix.jsx";

const PHASES = [
  {
    key: "challenge",
    label: "Challenge requirements",
    gate: "challengeAnswered",
    gateLabel: "Mark reviewed",
    withAnswers: true,
  },
  {
    key: "testplan",
    label: "Test plan",
    gate: "featuresApproved",
    gateLabel: "Approve scenarios",
  },
  { key: "implement", label: "Implement (TDD)", gate: null },
  { key: "ship", label: "Ship", gate: null },
];

function runnable(epic, key) {
  if (key === "challenge") return true;
  if (key === "testplan") return epic.gates.challengeAnswered;
  if (key === "implement") return epic.gates.featuresApproved;
  if (key === "ship") return epic.phases.implement.status === "done";
  return false;
}

export function EpicDetailView({ epicId, onBack }) {
  const [epic, setEpic] = useState(null);
  const [activePhase, setActivePhase] = useState("challenge");
  const [run, setRun] = useState(null); // { runId, phase }
  const [matrix, setMatrix] = useState(null);
  const [answers, setAnswers] = useState("");
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    try {
      setEpic(await api.getEpic(epicId));
    } catch (e) {
      setError(e.message);
    }
  }, [epicId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Reattach to an in-flight run after a page reload (runId is persisted on the phase).
  useEffect(() => {
    if (run || !epic) return;
    const running = PHASES.find(
      (p) =>
        epic.phases[p.key].status === "running" && epic.phases[p.key].runId,
    );
    if (running) {
      setActivePhase(running.key);
      setRun({ runId: epic.phases[running.key].runId, phase: running.key });
    }
  }, [epic, run]);

  const stream = useRunStream(run?.runId ?? null, refresh);

  // Backstop for a silently-dropped SSE stream: when the connection is lost the
  // stream never reports a terminal status, so while it's still "running" we poll
  // the epic to resolve the phase. On the happy path the stream's own onComplete
  // refresh is the single fetch — this stops the moment the stream completes.
  useEffect(() => {
    if (!run || stream.status !== "running") return undefined;
    const terminal = ["awaiting_approval", "done", "error", "cancelled"];
    const id = setInterval(async () => {
      try {
        const fresh = await api.getEpic(epicId);
        setEpic(fresh);
        if (terminal.includes(fresh.phases[run.phase]?.status))
          clearInterval(id);
      } catch {
        // transient; keep polling
      }
    }, 4000);
    return () => clearInterval(id);
  }, [run, epicId, stream.status]);

  async function startPhase(key) {
    setError(null);
    try {
      const { runId } = await api.startPhase(epicId, key);
      setActivePhase(key);
      setRun({ runId, phase: key });
      refresh();
    } catch (e) {
      setError(e.message);
    }
  }

  async function cancel() {
    if (!run) return;
    try {
      await api.cancel(epicId, run.phase);
    } catch (e) {
      setError(e.message);
    }
  }

  async function approve(phase) {
    try {
      setEpic(
        await api.approveGate(
          epicId,
          phase.gate,
          phase.withAnswers ? answers : undefined,
        ),
      );
    } catch (e) {
      setError(e.message);
    }
  }

  async function loadMatrix() {
    try {
      setMatrix(await api.traceability(epicId));
    } catch (e) {
      setError(e.message);
    }
  }

  if (!epic) return <main className="app-shell">{error ?? "Loading…"}</main>;

  const def = PHASES.find((p) => p.key === activePhase);
  const phaseState = epic.phases[activePhase];
  const busy = Object.values(epic.phases).some((p) => p.status === "running");

  return (
    <main className="app-shell workbench-detail">
      <button type="button" className="navbar__action" onClick={onBack}>
        ← All epics
      </button>
      <h1>{epic.title}</h1>
      <p className="workbench-detail__input">{epic.input}</p>
      {epic.branch ? (
        <p className="workbench-detail__branch">
          branch <code>{epic.branch}</code>
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="auth-form__error">
          {error}
        </p>
      ) : null}

      <PhaseStepper
        phases={PHASES}
        epic={epic}
        activePhase={activePhase}
        onSelect={setActivePhase}
      />

      <section className="phase-panel">
        <header className="phase-panel__header">
          <h2>{def.label}</h2>
          <button
            type="button"
            className="auth-form__submit"
            disabled={!runnable(epic, activePhase) || busy}
            onClick={() => startPhase(activePhase)}
          >
            {phaseState.status === "running"
              ? "Running…"
              : phaseState.status === "pending"
                ? "Run phase"
                : "Re-run"}
          </button>
        </header>

        {phaseState.resultSubtype ? (
          <p className="workbench-detail__branch">
            last result: <code>{phaseState.resultSubtype}</code>
          </p>
        ) : null}
        {phaseState.deliverable?.verification ? (
          <p
            className="workbench-detail__branch"
            role={
              phaseState.deliverable.verification.verified ? undefined : "alert"
            }
          >
            independent verification:{" "}
            {phaseState.deliverable.verification.verified
              ? "passed ✓"
              : `failed ✗ — ${phaseState.deliverable.verification.detail}`}
          </p>
        ) : null}

        {!runnable(epic, activePhase) ? (
          <p className="phase-panel__locked" aria-disabled="true">
            Locked — finish the previous gate first.
          </p>
        ) : null}

        {def.gate && phaseState.status === "awaiting_approval" ? (
          <div className="phase-gate">
            {def.withAnswers ? (
              <label className="auth-form__field">
                <span>
                  Your answers / feedback — respond to the questions in the
                  report above. This text is fed into the next phase.
                </span>
                <textarea
                  value={answers}
                  onChange={(e) => setAnswers(e.target.value)}
                  rows={6}
                  placeholder="Answer the open questions, set scope, or give the agent direction…"
                />
              </label>
            ) : null}
            <button
              type="button"
              className="auth-form__submit"
              disabled={def.withAnswers && answers.trim() === ""}
              onClick={() => approve(def)}
            >
              {def.gateLabel}
            </button>
          </div>
        ) : null}

        {phaseState.deliverable ? (
          <div className="deliverable">
            {phaseState.deliverable.prUrl ? (
              <p>
                PR:{" "}
                <a
                  href={phaseState.deliverable.prUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  {phaseState.deliverable.prUrl}
                </a>
              </p>
            ) : null}
            <pre className="deliverable__text">
              {phaseState.deliverable.report ||
                phaseState.deliverable.finalText ||
                phaseState.deliverable.error ||
                "(no output captured)"}
            </pre>
          </div>
        ) : null}
      </section>

      {run ? <LiveRunView run={stream} onCancel={cancel} /> : null}

      <TraceabilityMatrix data={matrix} onRefresh={loadMatrix} />
    </main>
  );
}
