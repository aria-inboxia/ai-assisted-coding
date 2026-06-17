import { useState, useEffect, useCallback } from "react";
import { api } from "./lib/api.js";
import { EpicListView } from "./views/EpicListView.jsx";
import { EpicDetailView } from "./views/EpicDetailView.jsx";

function WorkbenchNav() {
  return (
    <header className="navbar">
      <div className="navbar__brand">Foyer Workbench</div>
      <nav className="navbar__nav" aria-label="Primary">
        <span className="navbar__user">control plane</span>
      </nav>
    </header>
  );
}

export function Workbench() {
  const [epics, setEpics] = useState([]);
  const [selected, setSelected] = useState(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState(null);

  const loadEpics = useCallback(async () => {
    try {
      setEpics(await api.listEpics());
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    loadEpics();
  }, [loadEpics]);

  // Poll the list while it's visible so phase statuses stay fresh.
  useEffect(() => {
    if (selected) return undefined;
    const t = setInterval(loadEpics, 5000);
    return () => clearInterval(t);
  }, [selected, loadEpics]);

  async function create(payload) {
    setCreating(true);
    try {
      const epic = await api.createEpic(payload);
      await loadEpics();
      setSelected(epic.id);
    } catch (e) {
      setError(e.message);
    } finally {
      setCreating(false);
    }
  }

  return (
    <>
      <WorkbenchNav />
      {selected ? (
        <EpicDetailView
          epicId={selected}
          onBack={() => {
            setSelected(null);
            loadEpics();
          }}
        />
      ) : (
        <>
          {error ? (
            <p role="alert" className="app-shell auth-form__error">
              {error}
            </p>
          ) : null}
          <EpicListView
            epics={epics}
            onSelect={setSelected}
            onCreate={create}
            busy={creating}
          />
        </>
      )}
    </>
  );
}
