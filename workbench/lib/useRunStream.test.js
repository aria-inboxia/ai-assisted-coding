import { describe, it, expect } from "vitest";
import { runReducer, INITIAL } from "./useRunStream.js";

describe("runReducer", () => {
  it("accumulates assistant text", () => {
    let s = runReducer(INITIAL, { type: "init", data: {} });
    expect(s.status).toBe("running");
    s = runReducer(s, { type: "assistant_text", data: { text: "Hello " } });
    s = runReducer(s, { type: "assistant_text", data: { text: "world" } });
    expect(s.text).toBe("Hello world");
  });

  it("tracks a tool_use and resolves it on tool_result", () => {
    let s = runReducer(INITIAL, {
      type: "tool_use",
      data: { id: "t1", name: "Read", input: {} },
    });
    expect(s.tools).toHaveLength(1);
    expect(s.tools[0].status).toBe("running");
    s = runReducer(s, {
      type: "tool_result",
      data: { toolUseId: "t1", isError: false, summary: "ok" },
    });
    expect(s.tools[0].status).toBe("done");
    s = runReducer(s, {
      type: "tool_result",
      data: { toolUseId: "t1", isError: true, summary: "boom" },
    });
    // re-resolving the same id flips to error (last write wins)
    expect(s.tools[0].status).toBe("error");
  });

  it("captures the final result and can reset", () => {
    let s = runReducer(INITIAL, {
      type: "result",
      data: { subtype: "success", costUsd: 0.1 },
    });
    expect(s.status).toBe("complete");
    expect(s.result.subtype).toBe("success");
    expect(runReducer(s, { type: "reset" })).toEqual(INITIAL);
  });

  it("maps phase_status timeout/error to error, keeps cancelled, never overrides complete", () => {
    expect(
      runReducer(INITIAL, { type: "phase_status", data: { status: "timeout" } })
        .status,
    ).toBe("error");
    expect(
      runReducer(INITIAL, { type: "phase_status", data: { status: "error" } })
        .status,
    ).toBe("error");
    expect(
      runReducer(INITIAL, {
        type: "phase_status",
        data: { status: "cancelled" },
      }).status,
    ).toBe("cancelled");
    // a "running" phase_status is a no-op (status arrives via other events)
    expect(
      runReducer(INITIAL, { type: "phase_status", data: { status: "running" } })
        .status,
    ).toBe("idle");
    // a finished run is never demoted to error by a late terminal phase_status
    const done = { ...INITIAL, status: "complete" };
    expect(
      runReducer(done, { type: "phase_status", data: { status: "error" } })
        .status,
    ).toBe("complete");
  });

  it("does not mutate prior state", () => {
    const before = runReducer(INITIAL, {
      type: "tool_use",
      data: { id: "a", name: "X", input: {} },
    });
    runReducer(before, {
      type: "tool_use",
      data: { id: "b", name: "Y", input: {} },
    });
    expect(before.tools).toHaveLength(1); // unchanged by the second call
  });
});
