import { useEffect, useReducer } from "react";

// Live state of one phase run, accumulated from the backend SSE stream.
export const INITIAL = {
  status: "idle", // idle | running | complete | error | cancelled
  text: "",
  tools: [],
  result: null,
  error: null,
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
    case "phase_status":
      if (["cancelled", "timeout", "error"].includes(action.data.status)) {
        return {
          ...state,
          status:
            action.data.status === "timeout" ? "error" : action.data.status,
        };
      }
      return state;
    case "stream_error":
      return state.status === "complete"
        ? state
        : { ...state, status: "error", error: action.error };
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
          (name === "phase_status" && data.status === "cancelled")
        ) {
          es.close();
          if (onComplete) onComplete();
        }
      });
    }
    es.onerror = () =>
      dispatch({ type: "stream_error", error: "stream interrupted" });

    return () => es.close();
  }, [runId, onComplete]);

  return state;
}
