import { describe, it, expect } from "vitest";
import { validateEpicInput, isPhase, isId, isGate } from "./validate.js";
import { buildArgs } from "./phases.js";
import { mapClaudeEvent, buildChildEnv } from "./runner.js";

describe("validateEpicInput", () => {
  it("accepts and trims a valid epic", () => {
    const r = validateEpicInput({
      title: "  Add login  ",
      input: "Let users sign in",
    });
    expect(r.ok).toBe(true);
    expect(r.value).toEqual({
      title: "Add login",
      input: "Let users sign in",
      links: [],
    });
  });

  it("rejects an empty title and an oversized input", () => {
    expect(validateEpicInput({ title: "", input: "x" }).ok).toBe(false);
    expect(
      validateEpicInput({ title: "ok", input: "x".repeat(20001) }).ok,
    ).toBe(false);
  });

  it("rejects non-string links", () => {
    expect(validateEpicInput({ title: "ok", input: "x", links: [42] }).ok).toBe(
      false,
    );
  });
});

describe("validators", () => {
  it("guards phase, id, and gate values", () => {
    expect(isPhase("challenge")).toBe(true);
    expect(isPhase("nope")).toBe(false);
    expect(isId("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
    expect(isId("../etc/passwd")).toBe(false);
    expect(isGate("featuresApproved")).toBe(true);
    expect(isGate("admin")).toBe(false);
  });
});

describe("buildArgs", () => {
  it("mints a session for the first (read-only) phase", () => {
    const args = buildArgs({
      phase: "challenge",
      prompt: "hi",
      sessionId: "sid",
    });
    expect(args).toEqual(expect.arrayContaining(["--session-id", "sid"]));
    expect(args).toEqual(expect.arrayContaining(["--permission-mode", "plan"]));
    expect(args).toContain("--allowedTools");
    expect(args).not.toContain("--resume");
  });

  it("resumes the epic session for later phases", () => {
    const args = buildArgs({
      phase: "testplan",
      prompt: "x",
      sessionId: "new",
      resumeSessionId: "old",
    });
    expect(args).toEqual(expect.arrayContaining(["--resume", "old"]));
    expect(args).not.toContain("--session-id");
    expect(args).toEqual(
      expect.arrayContaining(["--permission-mode", "acceptEdits"]),
    );
  });

  it("blocks force-push on the ship phase", () => {
    const args = buildArgs({ phase: "ship", prompt: "/ship", sessionId: "s" });
    const i = args.indexOf("--disallowedTools");
    expect(i).toBeGreaterThan(-1);
    expect(args[i + 1]).toContain("git push --force");
  });
});

describe("mapClaudeEvent", () => {
  it("maps the init event (carrying slash_commands + session)", () => {
    expect(
      mapClaudeEvent({
        type: "system",
        subtype: "init",
        session_id: "s",
        model: "m",
        permissionMode: "plan",
        slash_commands: ["challenge-reqs"],
      }),
    ).toEqual([
      {
        event: "init",
        data: {
          sessionId: "s",
          model: "m",
          permissionMode: "plan",
          slashCommands: ["challenge-reqs"],
        },
      },
    ]);
  });

  it("maps assistant text and tool_use blocks", () => {
    expect(
      mapClaudeEvent({
        type: "assistant",
        message: { content: [{ type: "text", text: "hi" }] },
      }),
    ).toEqual([{ event: "assistant_text", data: { text: "hi" } }]);
    expect(
      mapClaudeEvent({
        type: "assistant",
        message: {
          content: [
            { type: "tool_use", id: "t1", name: "Read", input: { f: "x" } },
          ],
        },
      }),
    ).toEqual([
      {
        event: "tool_use",
        data: { id: "t1", name: "Read", input: { f: "x" } },
      },
    ]);
  });

  it("maps tool_result (on the user event) and the final result", () => {
    expect(
      mapClaudeEvent({
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "t1",
              is_error: false,
              content: "ok",
            },
          ],
        },
      }),
    ).toEqual([
      {
        event: "tool_result",
        data: { toolUseId: "t1", isError: false, summary: "ok" },
      },
    ]);
    expect(
      mapClaudeEvent({
        type: "result",
        subtype: "success",
        is_error: false,
        result: "done",
        total_cost_usd: 0.02,
        session_id: "s",
        num_turns: 3,
      }),
    ).toEqual([
      {
        event: "result",
        data: {
          subtype: "success",
          isError: false,
          finalText: "done",
          costUsd: 0.02,
          sessionId: "s",
          numTurns: 3,
        },
      },
    ]);
  });

  it("ignores partial/unknown event types", () => {
    expect(mapClaudeEvent({ type: "stream_event" })).toEqual([]);
    expect(mapClaudeEvent(null)).toEqual([]);
  });
});

describe("buildChildEnv", () => {
  it("drops unrelated machine secrets but keeps PATH", () => {
    process.env.WB_TEST_SECRET = "leak";
    const env = buildChildEnv();
    delete process.env.WB_TEST_SECRET;
    expect("WB_TEST_SECRET" in env).toBe(false);
    expect("PATH" in env).toBe(true);
  });
});
