import { useEffect, useReducer } from "react";

// Live state of one phase run, accumulated from the backend SSE stream. The
// stream is a live-progress nicety only — the authoritative terminal status
// comes from the `result` / `phase_status` events (and the detail view also
// polls the epic), so a transient disconnect is never surfaced as an error.
export const INITIAL = {
  status: "idle", // idle | running | complete | error | cancelled
  text: "",
  tools: [],
  result: null,
};

// Pure reducer (exported for unit tests).
export function runReducer(state, action) {
  switch (action.type) {
    case "reset":
      return INITIAL;
    case "init":
      return { ...state, status: "running" };
    case "assistant_text":
      return {
        ...state,
        status: "running",
        text: state.text + action.data.text,
      };
    case "tool_use":
      return {
        ...state,
        tools: [
          ...state.tools,
          {
            id: action.data.id,
            name: action.data.name,
            input: action.data.input,
            status: "running",
          },
        ],
      };
    case "tool_result":
      return {
        ...state,
        tools: state.tools.map((t) =>
          t.id === action.data.toolUseId
            ? {
                ...t,
                status: action.data.isError ? "error" : "done",
                summary: action.data.summary,
              }
            : t,
        ),
      };
    case "result":
      return { ...state, status: "complete", result: action.data };
    case "phase_status": {
      if (state.status === "complete") return state; // don't override a finished run
      const s = action.data.status;
      if (s === "cancelled") return { ...state, status: "cancelled" };
      if (s === "timeout" || s === "error")
        return { ...state, status: "error" };
      return state; // running / complete arrive via other events
    }
    default:
      return state;
  }
}

const EVENTS = [
  "init",
  "assistant_text",
  "tool_use",
  "tool_result",
  "result",
  "phase_status",
];
const TERMINAL_PHASE_STATUS = new Set(["cancelled", "timeout", "error"]);

// Opens an EventSource for the given runId and reduces its events into state.
// Pass runId = null when no run is active. onComplete must be stable (memoised).
export function useRunStream(runId, onComplete) {
  const [state, dispatch] = useReducer(runReducer, INITIAL);

  useEffect(() => {
    dispatch({ type: "reset" });
    if (!runId) return undefined;

    const es = new EventSource(`/events/${runId}`);
    for (const name of EVENTS) {
      es.addEventListener(name, (e) => {
        let data = {};
        try {
          data = JSON.parse(e.data);
        } catch {
          data = {};
        }
        dispatch({ type: name, data });
        if (
          name === "result" ||
          (name === "phase_status" && TERMINAL_PHASE_STATUS.has(data.status))
        ) {
          es.close();
          if (onComplete) onComplete();
        }
      });
    }
    // A dropped connection auto-reconnects and replays the buffered stream — it
    // is never an error. Terminal status arrives via the events above, backed by
    // the detail view's epic polling.
    es.onerror = () => {};

    return () => es.close();
  }, [runId, onComplete]);

  return state;
}
