import { StatusPill } from "./StatusPill.jsx";

function rowStatus(req, hasResults) {
  const covered = req.scenarios.length > 0;
  if (!covered) return { status: "error", label: "uncovered" };
  if (!hasResults) return { status: "covered", label: "covered" };
  const passed = req.scenarios.every((s) => s.passed === true);
  return passed
    ? { status: "passed", label: "passed" }
    : { status: "error", label: "not passing" };
}

// The folded-in traceability gate: requirement → scenarios → covered/passed.
export function TraceabilityMatrix({ data, onRefresh }) {
  return (
    <section className="trace-matrix" aria-label="Requirements traceability">
      <header className="trace-matrix__header">
        <h3>Traceability</h3>
        <button type="button" className="navbar__action" onClick={onRefresh}>
          Refresh
        </button>
      </header>
      {renderBody(data)}
      {data?.violations?.length ? (
        <ul className="trace-matrix__violations">
          {data.violations.map((v) => (
            <li key={v} role="alert">
              {v}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function renderBody(data) {
  if (!data)
    return <p className="trace-matrix__empty">Refresh to load the matrix.</p>;
  if (data.status === "absent")
    return (
      <p className="trace-matrix__empty">
        No spec or scenarios yet — run the test-plan phase.
      </p>
    );
  if (data.status === "error")
    return (
      <p role="alert" className="trace-matrix__empty">
        {data.error}
      </p>
    );
  const specs = data.specs ?? [];
  if (specs.length === 0)
    return <p className="trace-matrix__empty">No requirements found yet.</p>;

  return specs.map((spec) => (
    <table className="trace-matrix__table" key={spec.id}>
      <caption>{spec.id}</caption>
      <thead>
        <tr>
          <th scope="col">Req</th>
          <th scope="col">Summary</th>
          <th scope="col">Scenarios</th>
          <th scope="col">Status</th>
        </tr>
      </thead>
      <tbody>
        {spec.requirements.map((req) => {
          const { status, label } = rowStatus(req, data.hasResults);
          return (
            <tr key={req.id}>
              <td>{req.id}</td>
              <td>{req.summary}</td>
              <td>
                {req.scenarios.length > 0
                  ? req.scenarios.map((s) => s.scenario).join("; ")
                  : "—"}
              </td>
              <td>
                <StatusPill status={status} label={label} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  ));
}
