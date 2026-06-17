import { useState } from "react";

// Captures the initial epic (title + description) that the whole workflow runs from.
export function EpicIntakeForm({ onCreate, busy }) {
  const [title, setTitle] = useState("");
  const [input, setInput] = useState("");

  function submit(event) {
    event.preventDefault();
    if (!title.trim() || !input.trim()) return;
    onCreate({ title: title.trim(), input: input.trim() });
    setTitle("");
    setInput("");
  }

  return (
    <form className="intake-form" onSubmit={submit}>
      <label className="auth-form__field">
        <span>Epic title</span>
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={200}
          required
        />
      </label>
      <label className="auth-form__field">
        <span>What should it do?</span>
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          rows={4}
          maxLength={20000}
          required
        />
      </label>
      <button type="submit" className="auth-form__submit" disabled={busy}>
        {busy ? "Creating…" : "Create epic"}
      </button>
    </form>
  );
}
