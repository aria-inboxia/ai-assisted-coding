// Boundary validation + sanitisation for the Workbench HTTP API. Never trust
// request bodies, and neutralise control-char tricks in free text before it is
// stored or fed (data-fenced) into an agent prompt.

export const PHASE_NAMES = ["challenge", "testplan", "implement", "ship"];
export const GATE_NAMES = ["challengeAnswered", "featuresApproved"];
export const MAX_ANSWERS = 8000;

const UUID_RE = /^[0-9a-f-]{36}$/i;

export function isPhase(p) {
  return PHASE_NAMES.includes(p);
}

export function isGate(g) {
  return GATE_NAMES.includes(g);
}

export function isId(id) {
  return typeof id === "string" && UUID_RE.test(id);
}

// Strip control characters (keep tab + newline), trim, and cap length.
export function sanitizeText(s, max) {
  if (typeof s !== "string") return "";
  let out = "";
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (c === 9 || c === 10 || (c >= 32 && c !== 127)) out += ch;
  }
  out = out.trim();
  return typeof max === "number" ? out.slice(0, max) : out;
}

// Returns { ok, errors, value } with a sanitised value when ok.
export function validateEpicInput(body) {
  const errors = [];
  const title = sanitizeText(body?.title);
  const input = sanitizeText(body?.input);
  const links = Array.isArray(body?.links) ? body.links : [];

  if (title.length < 1 || title.length > 200) {
    errors.push("title must be 1–200 characters");
  }
  if (input.length < 1 || input.length > 20000) {
    errors.push("input must be 1–20000 characters");
  }
  if (!links.every((l) => typeof l === "string" && l.length <= 2000)) {
    errors.push("each link must be a string of at most 2000 characters");
  }

  return { ok: errors.length === 0, errors, value: { title, input, links } };
}
