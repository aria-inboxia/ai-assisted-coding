// Thin HTTP client for the Workbench backend. Components never call fetch
// directly. Same-origin paths are proxied to the backend by Vite in dev.

const JSON_HEADERS = { "content-type": "application/json" };

async function req(path, options) {
  let res;
  try {
    res = await fetch(path, options);
  } catch {
    throw new Error(
      "Cannot reach the Workbench backend — is `pnpm workbench` running?",
    );
  }
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok || (body && body.success === false)) {
    throw new Error(body?.error || `Request failed (${res.status})`);
  }
  return body?.data;
}

export const api = {
  listEpics: () => req("/api/epics"),
  getEpic: (id) => req(`/api/epics/${id}`),
  createEpic: (payload) =>
    req("/api/epics", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify(payload),
    }),
  startPhase: (id, phase) =>
    req(`/api/epics/${id}/phases/${phase}/run`, {
      method: "POST",
      headers: JSON_HEADERS,
    }),
  cancel: (id, phase) =>
    req(`/api/epics/${id}/phases/${phase}/cancel`, {
      method: "POST",
      headers: JSON_HEADERS,
    }),
  approveGate: (id, gate, answers) =>
    req(`/api/epics/${id}/gate/${gate}/approve`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify(answers ? { answers } : {}),
    }),
  traceability: (id) => req(`/api/epics/${id}/traceability`),
};
