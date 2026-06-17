import { StatusPill } from "./StatusPill.jsx";

function summariseInput(input) {
  if (!input) return "";
  try {
    const s = JSON.stringify(input);
    return s.length > 80 ? `${s.slice(0, 80)}…` : s;
  } catch {
    return "";
  }
}

// Renders the live agent stream for the active run: accumulated assistant text
// plus an append-only tool-call log. Both are aria-live regions.
export function LiveRunView({ run, onCancel }) {
  const cost = run.result?.costUsd;
  return (
    <section className="live-run" aria-label="Live run">
      <header className="live-run__header">
        <StatusPill status={run.status} />
        {run.result ? (
          <span className="live-run__meta">
            {run.result.subtype} · $
            {typeof cost === "number" ? cost.toFixed(4) : cost}
          </span>
        ) : null}
        {run.status === "running" ? (
          <button type="button" className="navbar__action" onClick={onCancel}>
            Cancel
          </button>
        ) : null}
      </header>
      <div className="live-run__panes">
        <pre className="transcript" role="log" aria-live="polite">
          {run.text || "Waiting for the agent…"}
        </pre>
        <ul className="tool-log" role="log" aria-live="polite">
          {run.tools.length === 0 ? (
            <li className="tool-log__empty">No tool calls yet.</li>
          ) : (
            run.tools.map((t) => (
              <li key={t.id} className="tool-row">
                <span className="tool-row__name">{t.name}</span>
                <code className="tool-row__input">
                  {summariseInput(t.input)}
                </code>
                <StatusPill status={t.status} />
              </li>
            ))
          )}
        </ul>
      </div>
    </section>
  );
}
