import { EpicIntakeForm } from "../components/EpicIntakeForm.jsx";
import { StatusPill } from "../components/StatusPill.jsx";

const PHASE_ORDER = ["challenge", "testplan", "implement", "ship"];

function progress(epic) {
  let key = PHASE_ORDER[0];
  for (const k of PHASE_ORDER) {
    if (epic.phases[k].status !== "pending") key = k;
  }
  return { key, status: epic.phases[key].status };
}

export function EpicListView({ epics, onSelect, onCreate, busy }) {
  return (
    <main className="app-shell">
      <h1>Workbench</h1>
      <p className="workbench-intro">
        Drive the Foyer workflow — challenge → test plan → implement → ship —
        from an epic. Each phase runs Claude Code headless and uses your own
        Claude usage up to the configured budget caps.
      </p>
      <EpicIntakeForm onCreate={onCreate} busy={busy} />
      <ul className="epic-list">
        {epics.length === 0 ? (
          <li className="epic-list__empty">No epics yet — create one above.</li>
        ) : (
          epics.map((epic) => {
            const p = progress(epic);
            return (
              <li key={epic.id}>
                <button
                  type="button"
                  className="epic-card"
                  onClick={() => onSelect(epic.id)}
                >
                  <span className="epic-card__title">{epic.title}</span>
                  <span className="epic-card__phase">
                    {p.key} <StatusPill status={p.status} />
                  </span>
                </button>
              </li>
            );
          })
        )}
      </ul>
    </main>
  );
}
