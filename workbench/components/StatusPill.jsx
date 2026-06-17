// Single source of the status → accent-token mapping. Color is never the only
// signal — every pill also shows a text label.
const ACCENT = {
  idle: "neutral",
  pending: "neutral",
  running: "sky",
  awaiting_approval: "amber",
  covered: "amber",
  done: "emerald",
  complete: "emerald",
  passed: "emerald",
  error: "rose",
  cancelled: "rose",
  timeout: "rose",
};

const LABEL = {
  awaiting_approval: "awaiting approval",
};

export function StatusPill({ status, label }) {
  const accent = ACCENT[status] ?? "neutral";
  return (
    <span className={`status-pill status-pill--${accent}`}>
      {label ?? LABEL[status] ?? status}
    </span>
  );
}
