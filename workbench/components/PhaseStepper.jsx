import { StatusPill } from "./StatusPill.jsx";

// The four workflow phases as a stepper. Each step shows its status and is
// selectable; the gate state is reflected by the phase status pill.
export function PhaseStepper({ phases, epic, activePhase, onSelect }) {
  return (
    <ol className="phase-stepper" aria-label="Workflow phases">
      {phases.map((p, i) => {
        const status = epic.phases[p.key].status;
        const isActive = p.key === activePhase;
        return (
          <li key={p.key} className="phase-stepper__step">
            <button
              type="button"
              className={`phase-stepper__button${isActive ? " phase-stepper__button--active" : ""}`}
              aria-current={isActive ? "step" : undefined}
              onClick={() => onSelect(p.key)}
            >
              <span className="phase-stepper__index">{i}</span>
              <span className="phase-stepper__label">{p.label}</span>
              <StatusPill status={status} />
            </button>
          </li>
        );
      })}
    </ol>
  );
}
