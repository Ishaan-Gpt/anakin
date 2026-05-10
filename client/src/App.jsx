import React, { useEffect, useMemo, useState } from "react";

const API = import.meta.env.VITE_API_BASE || "http://localhost:8787";
const STORAGE_PREFIX = "autoflow.automation.";
const DRAFT_KEY = "autoflow.draft";
const INITIAL_AUTOMATION = {
  id: "",
  name: "",
  steps: "",
  preparedAutomation: null,
  preparedSignature: "",
  params: {},
  sessionId: "",
  credentialId: "",
};

async function af(path, init = {}) {
  const response = await fetch(`${API}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
    ...init,
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};

  if (!response.ok) {
    const error = new Error(body.error?.message || "Request failed");
    error.details = body.error?.details || body.error || body;
    throw error;
  }

  return body;
}

function automationSignature(name, steps) {
  return JSON.stringify([name.trim(), steps.trim()]);
}

function createId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `auto-${Date.now().toString(36)}`;
}

function serializeSharePayload(automation) {
  return encodeURIComponent(
    JSON.stringify({
      v: 1,
      id: automation.id || createId(),
      name: automation.name,
      steps: automation.steps,
      preparedAutomation: automation.preparedAutomation,
      preparedSignature: automation.preparedSignature,
      params: automation.params,
    }),
  );
}

function deserializeSharePayload(value) {
  try {
    const parsed = JSON.parse(decodeURIComponent(value));
    return {
      id: parsed.id || createId(),
      name: parsed.name || "",
      steps: parsed.steps || "",
      preparedAutomation: parsed.preparedAutomation || null,
      preparedSignature:
        parsed.preparedSignature ||
        automationSignature(parsed.name || "", parsed.steps || ""),
      params: parsed.params || {},
      sessionId: "",
      credentialId: "",
    };
  } catch {
    return null;
  }
}

function listSavedAutomations() {
  return Object.keys(localStorage)
    .filter((key) => key.startsWith(STORAGE_PREFIX))
    .map((key) => {
      try {
        return JSON.parse(localStorage.getItem(key));
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((left, right) => new Date(right.updatedAt) - new Date(left.updatedAt));
}

function saveAutomationRecord(automation, runCount) {
  const record = {
    id: automation.id || createId(),
    name: automation.name.trim() || "Untitled automation",
    steps: automation.steps,
    preparedAutomation: automation.preparedAutomation,
    preparedSignature:
      automation.preparedSignature || automationSignature(automation.name, automation.steps),
    params: automation.params || {},
    mode: automation.preparedAutomation?.mode || "draft",
    runCount: runCount ?? 0,
    createdAt: automation.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  localStorage.setItem(`${STORAGE_PREFIX}${record.id}`, JSON.stringify(record));
  return record;
}

function saveDraft(automation) {
  const draft = {
    ...automation,
    preparedSignature:
      automation.preparedSignature || automationSignature(automation.name, automation.steps),
  };
  localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
}

function loadDraft() {
  try {
    return JSON.parse(localStorage.getItem(DRAFT_KEY));
  } catch {
    return null;
  }
}

function toLabel(value) {
  return String(value)
    .replace(/_/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\w/, (char) => char.toUpperCase());
}

function summarizeSessions(sessions) {
  return {
    browser: sessions.filter((session) => session.kind === "browser_session"),
    credentials: sessions.filter((session) => session.kind === "identity_credential"),
  };
}

function ResultDisplay({ run }) {
  if (run.status === "idle") {
    return <div className="empty-state">Generate a plan or run an automation to see the result.</div>;
  }
  if (run.status === "preparing") {
    return <div className="status-card">Gemini is planning the automation.</div>;
  }
  if (run.status === "running") {
    return <div className="status-card">Anakin is executing the automation.</div>;
  }
  if (run.status === "needs-input") {
    return <div className="status-card warning">{run.error}</div>;
  }
  if (run.status === "error") {
    return (
      <div className="status-card error">
        <p>{run.error}</p>
        {run.connectUrl ? (
          <a href={run.connectUrl} target="_blank" rel="noreferrer">
            Open Anakin connect flow
          </a>
        ) : null}
      </div>
    );
  }
  if (!run.display) {
    return (
      <div className="raw-panel">
        <pre>{JSON.stringify(run.result, null, 2)}</pre>
      </div>
    );
  }

  return (
    <div className="result-stack">
      <div className="result-hero">
        <div>
          <p className="eyebrow">Readable output</p>
          <h3>{run.display.title}</h3>
          <p>{run.display.summary}</p>
        </div>
        <div className="metric-row">
          <div className="metric">
            <span>Mode</span>
            <strong>{run.display.meta.mode}</strong>
          </div>
          <div className="metric">
            <span>Execution</span>
            <strong>{run.display.meta.executionMs} ms</strong>
          </div>
        </div>
      </div>

      {run.display.sections.map((section, index) => (
        <section className="result-section" key={`${section.title}-${index}`}>
          <div className="section-header">
            <h4>{section.title}</h4>
          </div>

          {section.kind === "text" ? <p className="section-text">{section.body}</p> : null}

          {section.kind === "keyValue" ? (
            <div className="key-grid">
              {section.entries.map((entry) => (
                <div className="key-card" key={`${section.title}-${entry.label}`}>
                  <span>{entry.label}</span>
                  <strong>{entry.value}</strong>
                </div>
              ))}
            </div>
          ) : null}

          {section.kind === "list" ? (
            <div className="list-stack">
              {section.items.map((item, itemIndex) => (
                <article className="list-card" key={`${section.title}-${itemIndex}`}>
                  <div className="list-title-row">
                    <strong>{item.title}</strong>
                  </div>
                  {item.description ? <p>{item.description}</p> : null}
                  {item.meta?.length ? (
                    <div className="tag-row">
                      {item.meta.map((meta) => (
                        <span className="tag" key={`${item.title}-${meta.label}`}>
                          {meta.label}: {meta.value}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          ) : null}
        </section>
      ))}

      <details className="raw-disclosure">
        <summary>View raw JSON</summary>
        <pre>{JSON.stringify(run.display.raw, null, 2)}</pre>
      </details>
    </div>
  );
}

function PreparedPlan({ automation }) {
  const plan = automation.preparedAutomation;

  if (!plan) {
    return <div className="empty-state">No plan yet. Describe a task and generate one.</div>;
  }

  return (
    <div className="plan-stack">
      <div className="plan-hero">
        <div>
          <p className="eyebrow">Gemini route</p>
          <h3>{plan.mode === "wire" ? "Wire action" : "Browser automation"}</h3>
          <p>{plan.routeReason}</p>
        </div>
        <span className={`mode-pill ${plan.mode}`}>{plan.mode}</span>
      </div>

      <div className="plan-grid">
        <div className="plan-card">
          <span>Authentication</span>
          <strong>{plan.requiresSession ? toLabel(plan.sessionKind) : "No saved auth required"}</strong>
        </div>
        <div className="plan-card">
          <span>Inputs</span>
          <strong>{plan.paramFields?.length || 0} fields</strong>
        </div>
        <div className="plan-card">
          <span>Start</span>
          <strong>{plan.browser?.startUrl || plan.wire?.catalogSlug || "Ready"}</strong>
        </div>
      </div>

      {plan.paramFields?.length ? (
        <div className="plan-list">
          <h4>Expected inputs</h4>
          {plan.paramFields.map((field) => (
            <div className="plan-list-item" key={field.name}>
              <strong>{field.label}</strong>
              <span>{field.required ? "Required" : "Optional"}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function BuildWorkspace({
  automation,
  setAutomation,
  run,
  setRun,
  sessions,
  persistAutomation,
  refreshSavedAutomations,
  setBanner,
}) {
  const sessionSummary = useMemo(() => summarizeSessions(sessions), [sessions]);

  function updateAutomation(patch) {
    setAutomation((current) => ({ ...current, ...patch }));
  }

  async function generatePlan() {
    if (!automation.steps.trim()) {
      setRun({ status: "needs-input", error: "Describe the task before generating a plan." });
      return null;
    }

    setRun({ status: "preparing", result: null, display: null, error: "", connectUrl: "" });
    const preparedAutomation = await af("/api/automations/prepare", {
      method: "POST",
      body: JSON.stringify({
        name: automation.name.trim() || "Untitled automation",
        steps: automation.steps,
      }),
    });

    const signature = automationSignature(automation.name, automation.steps);
    const mergedParams = { ...automation.params };
    for (const field of preparedAutomation.paramFields || []) {
      if (!(field.name in mergedParams)) {
        mergedParams[field.name] = "";
      }
    }

    const nextAutomation = {
      ...automation,
      id: automation.id || createId(),
      preparedAutomation,
      preparedSignature: signature,
      params: mergedParams,
    };

    setAutomation(nextAutomation);
    persistAutomation(nextAutomation, false);
    refreshSavedAutomations();
    setRun({ status: "idle", result: null, display: null, error: "", connectUrl: "" });
    setBanner("Plan generated and autosaved.");
    return nextAutomation;
  }

  function validateBeforeRun(currentAutomation) {
    const preparedAutomation = currentAutomation.preparedAutomation;
    if (!preparedAutomation) {
      return "Generate a plan before running.";
    }

    const missingFields = (preparedAutomation.paramFields || []).filter(
      (field) => field.required && !String(currentAutomation.params[field.name] || "").trim(),
    );
    if (missingFields.length) {
      return `Missing required inputs: ${missingFields.map((field) => field.label).join(", ")}.`;
    }

    if (
      preparedAutomation.requiresSession &&
      preparedAutomation.sessionKind === "browser_session" &&
      !currentAutomation.sessionId
    ) {
      return "Select a saved browser session before running.";
    }

    if (
      preparedAutomation.requiresSession &&
      preparedAutomation.sessionKind === "identity_credential" &&
      !currentAutomation.credentialId
    ) {
      return "Select a saved credential before running.";
    }

    return "";
  }

  async function runAutomation() {
    try {
      let currentAutomation = automation;
      const currentSignature = automationSignature(automation.name, automation.steps);

      if (!automation.preparedAutomation || automation.preparedSignature !== currentSignature) {
        const regenerated = await generatePlan();
        if (!regenerated) {
          return;
        }
        currentAutomation = regenerated;
      }

      const validationError = validateBeforeRun(currentAutomation);
      if (validationError) {
        setRun({ status: "needs-input", result: null, display: null, error: validationError, connectUrl: "" });
        return;
      }

      setRun({ status: "running", result: null, display: null, error: "", connectUrl: "" });
      const response = await af("/api/automations/run", {
        method: "POST",
        body: JSON.stringify({
          preparedAutomation: currentAutomation.preparedAutomation,
          params: currentAutomation.params,
          sessionId: currentAutomation.sessionId || null,
          credentialId: currentAutomation.credentialId || null,
        }),
      });

      setRun({
        status: "done",
        result: response.result,
        display: response.display,
        error: "",
        connectUrl: "",
      });

      persistAutomation(currentAutomation, true);
      refreshSavedAutomations();
      setBanner("Automation executed and autosaved.");
    } catch (error) {
      const connectUrl = error.details?.error?.connect_url || error.details?.connect_url || "";
      setRun({
        status: "error",
        result: null,
        display: null,
        error: error.message,
        connectUrl: connectUrl ? `https://anakin.io${connectUrl}` : "",
      });
    }
  }

  function copyShareLink() {
    if (!automation.steps.trim()) {
      setBanner("Add a task before sharing.");
      return;
    }

    const shareUrl = `${window.location.origin}${window.location.pathname}?share=${serializeSharePayload({
      ...automation,
      id: automation.id || createId(),
    })}`;
    navigator.clipboard.writeText(shareUrl).catch(() => {});
    setBanner("Share link copied. Anyone can open it, fill inputs, and run it.");
  }

  return (
    <div className="workspace-grid">
      <section className="panel composer-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Builder</p>
            <h2>Create an automation</h2>
          </div>
          <div className="status-chip">Autosave on</div>
        </div>

        <label className="field">
          <span>Name</span>
          <input
            value={automation.name}
            placeholder="YC competitor radar"
            onChange={(event) => updateAutomation({ name: event.target.value })}
          />
        </label>

        <label className="field">
          <span>What should it do?</span>
          <textarea
            value={automation.steps}
            placeholder="Search Y Combinator companies for AI bookkeeping, shortlist the strongest matches, and summarize why each one matters."
            onChange={(event) => updateAutomation({ steps: event.target.value })}
          />
        </label>

        {automation.preparedAutomation?.paramFields?.length ? (
          <div className="input-grid">
            {automation.preparedAutomation.paramFields.map((field) => (
              <label className="field" key={field.name}>
                <span>{field.label}</span>
                <input
                  value={automation.params[field.name] || ""}
                  placeholder={field.placeholder || ""}
                  onChange={(event) =>
                    setAutomation((current) => ({
                      ...current,
                      params: {
                        ...current.params,
                        [field.name]: event.target.value,
                      },
                    }))
                  }
                />
              </label>
            ))}
          </div>
        ) : null}

        {automation.preparedAutomation?.requiresSession &&
        automation.preparedAutomation.sessionKind === "browser_session" ? (
          <label className="field">
            <span>Browser session</span>
            <select
              value={automation.sessionId}
              onChange={(event) => updateAutomation({ sessionId: event.target.value })}
            >
              <option value="">Select a saved session</option>
              {sessionSummary.browser.map((session) => (
                <option key={session.id} value={session.id}>
                  {session.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {automation.preparedAutomation?.requiresSession &&
        automation.preparedAutomation.sessionKind === "identity_credential" ? (
          <label className="field">
            <span>Credential</span>
            <select
              value={automation.credentialId}
              onChange={(event) => updateAutomation({ credentialId: event.target.value })}
            >
              <option value="">Select a credential</option>
              {sessionSummary.credentials.map((session) => (
                <option key={session.id} value={session.id}>
                  {session.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <div className="action-row">
          <button className="primary-button" type="button" onClick={generatePlan}>
            Generate plan
          </button>
          <button className="secondary-button" type="button" onClick={runAutomation}>
            Run automation
          </button>
          <button className="ghost-button" type="button" onClick={copyShareLink}>
            Copy share link
          </button>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Plan</p>
            <h2>Execution route</h2>
          </div>
        </div>
        <PreparedPlan automation={automation} />
      </section>

      <section className="panel result-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Result</p>
            <h2>Readable output</h2>
          </div>
        </div>
        <ResultDisplay run={run} />
      </section>
    </div>
  );
}

function AutomationsView({ automations, onLoad, onDelete, onShare }) {
  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Library</p>
          <h2>Saved automations</h2>
        </div>
        <div className="status-chip">{automations.length} saved</div>
      </div>

      {!automations.length ? (
        <div className="empty-state">
          Start building. Drafts and generated plans now save automatically.
        </div>
      ) : (
        <div className="saved-stack">
          {automations.map((automation) => (
            <article className="saved-card" key={automation.id}>
              <button className="saved-main" type="button" onClick={() => onLoad(automation)}>
                <strong>{automation.name}</strong>
                <p>{automation.steps}</p>
                <div className="tag-row">
                  <span className="tag">Mode: {automation.mode}</span>
                  <span className="tag">Runs: {automation.runCount || 0}</span>
                  <span className="tag">
                    Updated: {new Date(automation.updatedAt).toLocaleString()}
                  </span>
                </div>
              </button>
              <div className="saved-actions">
                <button className="ghost-button" type="button" onClick={() => onShare(automation)}>
                  Share
                </button>
                <button className="danger-button" type="button" onClick={() => onDelete(automation.id)}>
                  Delete
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function CatalogsView({ catalogData, sessions }) {
  const sessionSummary = useMemo(() => summarizeSessions(sessions), [sessions]);

  return (
    <div className="workspace-grid single-column">
      <section className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Anakin</p>
            <h2>Workspace status</h2>
          </div>
        </div>

        <div className="hero-card">
          <div className="hero-copy">
            <h3>Connected capabilities</h3>
            <p>
              This studio can route tasks through Wire for known actions and through the
              Browser API for free-form execution.
            </p>
          </div>
          <div className="metric-grid">
            <div className="metric-card">
              <span>Catalogs</span>
              <strong>{catalogData?.summary?.catalogCount ?? 0}</strong>
            </div>
            <div className="metric-card">
              <span>Auth-required</span>
              <strong>{catalogData?.summary?.authRequiredCount ?? 0}</strong>
            </div>
            <div className="metric-card">
              <span>Sessions</span>
              <strong>{sessionSummary.browser.length}</strong>
            </div>
            <div className="metric-card">
              <span>Credentials</span>
              <strong>{sessionSummary.credentials.length}</strong>
            </div>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Catalogs</p>
            <h2>Top Wire catalogs</h2>
          </div>
        </div>

        <div className="catalog-grid">
          {(catalogData?.summary?.topCatalogs || []).map((catalog) => (
            <article className="catalog-card" key={catalog.slug}>
              <strong>{catalog.name || catalog.slug}</strong>
              <p>{catalog.slug}</p>
              <div className="tag-row">
                <span className="tag">{catalog.actionCount} actions</span>
                <span className="tag">{catalog.authRequired ? "Auth required" : "Open access"}</span>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function App() {
  const [view, setView] = useState("build");
  const [automation, setAutomation] = useState(INITIAL_AUTOMATION);
  const [run, setRun] = useState({
    status: "idle",
    result: null,
    display: null,
    error: "",
    connectUrl: "",
  });
  const [catalogData, setCatalogData] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [savedAutomations, setSavedAutomations] = useState([]);
  const [banner, setBanner] = useState("");

  useEffect(() => {
    Promise.all([af("/api/catalogs"), af("/api/sessions")])
      .then(([catalogs, sessionResponse]) => {
        setCatalogData(catalogs);
        setSessions(sessionResponse.sessions || []);
      })
      .catch(() => {});

    setSavedAutomations(listSavedAutomations());

    const params = new URLSearchParams(window.location.search);
    const share = params.get("share");
    const savedId = params.get("id");

    if (share) {
      const sharedAutomation = deserializeSharePayload(share);
      if (sharedAutomation) {
        setAutomation(sharedAutomation);
        setView("build");
        setBanner("Shared automation loaded. Fill inputs and run it.");
        return;
      }
    }

    if (savedId) {
      const match = listSavedAutomations().find((item) => item.id === savedId);
      if (match) {
        setAutomation({
          ...INITIAL_AUTOMATION,
          ...match,
          sessionId: "",
          credentialId: "",
        });
        setBanner(`Loaded ${match.name}.`);
        return;
      }
    }

    const draft = loadDraft();
    if (draft?.steps) {
      setAutomation({
        ...INITIAL_AUTOMATION,
        ...draft,
        sessionId: "",
        credentialId: "",
      });
    }
  }, []);

  useEffect(() => {
    if (!automation.name.trim() && !automation.steps.trim()) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      const existing = listSavedAutomations().find((item) => item.id === automation.id);
      const nextAutomation = { ...automation, id: automation.id || createId() };

      saveDraft(nextAutomation);
      saveAutomationRecord(
        {
          ...nextAutomation,
          createdAt: existing?.createdAt || new Date().toISOString(),
        },
        existing?.runCount || 0,
      );
      setAutomation((current) => (current.id ? current : nextAutomation));
      setSavedAutomations(listSavedAutomations());
    }, 400);

    return () => window.clearTimeout(timeoutId);
  }, [automation]);

  function persistAutomation(nextAutomation, incrementRunCount) {
    const existing = listSavedAutomations().find((item) => item.id === nextAutomation.id);
    saveDraft(nextAutomation);
    saveAutomationRecord(
      {
        ...nextAutomation,
        createdAt: existing?.createdAt || new Date().toISOString(),
      },
      incrementRunCount ? (existing?.runCount || 0) + 1 : existing?.runCount || 0,
    );
  }

  function refreshSavedAutomations() {
    setSavedAutomations(listSavedAutomations());
  }

  function loadAutomation(record) {
    setAutomation({
      ...INITIAL_AUTOMATION,
      ...record,
      sessionId: "",
      credentialId: "",
    });
    setRun({ status: "idle", result: null, display: null, error: "", connectUrl: "" });
    setView("build");
    setBanner(`Loaded ${record.name}.`);
  }

  function deleteAutomation(id) {
    localStorage.removeItem(`${STORAGE_PREFIX}${id}`);
    setSavedAutomations(listSavedAutomations());
    if (automation.id === id) {
      setAutomation(INITIAL_AUTOMATION);
    }
    setBanner("Automation deleted.");
  }

  function shareAutomation(record) {
    const shareUrl = `${window.location.origin}${window.location.pathname}?share=${serializeSharePayload(record)}`;
    navigator.clipboard.writeText(shareUrl).catch(() => {});
    setBanner("Share link copied.");
  }

  const navigation = [
    { id: "build", label: "Build" },
    { id: "automations", label: "Automations" },
    { id: "status", label: "Workspace" },
  ];

  return (
    <main className="app-shell">
      <div className="ambient ambient-left" />
      <div className="ambient ambient-right" />

      <section className="topbar">
        <div>
          <p className="eyebrow">Anakin + Gemini</p>
          <h1>AutoFlow Studio</h1>
        </div>
        <div className="topbar-copy">
          <p>
            Build browser or Wire automations from plain English, autosave them as you
            work, and share a runnable link.
          </p>
        </div>
      </section>

      <nav className="nav-row">
        {navigation.map((item) => (
          <button
            key={item.id}
            className={`nav-button${view === item.id ? " active" : ""}`}
            type="button"
            onClick={() => {
              setView(item.id);
              setBanner("");
            }}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {banner ? <div className="banner">{banner}</div> : null}

      {view === "build" ? (
        <BuildWorkspace
          automation={automation}
          setAutomation={setAutomation}
          run={run}
          setRun={setRun}
          sessions={sessions}
          persistAutomation={persistAutomation}
          refreshSavedAutomations={refreshSavedAutomations}
          setBanner={setBanner}
        />
      ) : null}

      {view === "automations" ? (
        <AutomationsView
          automations={savedAutomations}
          onLoad={loadAutomation}
          onDelete={deleteAutomation}
          onShare={shareAutomation}
        />
      ) : null}

      {view === "status" ? <CatalogsView catalogData={catalogData} sessions={sessions} /> : null}
    </main>
  );
}

export default App;
