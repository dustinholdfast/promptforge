"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./api-client";
import Editor from "./components/editor";
import Runner from "./components/runner";
import { Markdown } from "./components/markdown";
import { LocalTime } from "./components/local-time";
import type { Catalogue, Pack, RunSummary, Workspace } from "./types";

type View = "library" | "history";

type Props = { catalogue: Catalogue; initialRuns: RunSummary[] };

export default function PromptForgeApp({ catalogue, initialRuns }: Props) {
  const [data, setData] = useState<Catalogue>(catalogue);
  const [runs, setRuns] = useState<RunSummary[]>(initialRuns);
  const [view, setView] = useState<View>("library");
  const [workspace, setWorkspace] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [runner, setRunner] = useState<Pack | null>(null);
  const [editing, setEditing] = useState<{ pack: Pack | null } | null>(null);
  const [openRun, setOpenRun] = useState<{ id: string; output: string; title: string } | null>(null);
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");

  /** Re-read everything after a mutation. The first render is already populated. */
  const load = useCallback(async () => {
    try {
      const [next, history] = await Promise.all([
        api<Catalogue>("/api/packs"),
        api<{ runs: RunSummary[] }>("/api/runs"),
      ]);
      setData(next);
      setRuns(history.runs);
      setError("");
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Could not refresh your library.");
    }
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 2800);
    return () => clearTimeout(timer);
  }, [toast]);

  const packs = data.packs;
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return packs.filter(
      (pack) =>
        (workspace === "all" || pack.workspace === workspace) &&
        (!needle || `${pack.title} ${pack.description}`.toLowerCase().includes(needle)),
    );
  }, [packs, workspace, search]);

  const unavailableProviders = (Object.entries(data.providers) as Array<[string, boolean]>).filter(([, ready]) => !ready);

  const signOut = async () => {
    await api("/api/auth", { action: "logout" });
    window.location.reload();
  };

  const showRun = async (run: RunSummary) => {
    try {
      const detail = await api<{ run: { output: string } }>("/api/runs", { action: "open", runId: run.id });
      setOpenRun({ id: run.id, output: detail.run.output, title: run.packTitle });
    } catch (problem) {
      setToast(problem instanceof Error ? problem.message : "Could not open that run.");
    }
  };

  const toggleFavorite = async (run: RunSummary) => {
    setRuns((current) => current.map((row) => (row.id === run.id ? { ...row, favorite: !row.favorite } : row)));
    await api("/api/runs", { action: "favorite", runId: run.id, favorite: !run.favorite }).catch(() => load());
  };

  const removeRun = async (run: RunSummary) => {
    setRuns((current) => current.filter((row) => row.id !== run.id));
    await api("/api/runs", { action: "delete", runId: run.id }).catch(() => load());
  };

  if (runner) {
    return (
      <Runner
        pack={runner}
        models={data.models}
        providers={data.providers}
        onClose={() => setRunner(null)}
        onFinished={load}
      />
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button className="brand" onClick={() => setView("library")} aria-label="PromptForge home">
          <span className="brand-mark">PF</span>
          <span>PromptForge</span>
        </button>

        <nav aria-label="Primary navigation">
          <p className="nav-label">LIBRARY</p>
          <NavItem active={view === "library"} onClick={() => setView("library")} symbol="◇" label="Packs" count={packs.length} />
          <NavItem active={view === "history"} onClick={() => setView("history")} symbol="↺" label="Run history" count={runs.length} />

          <p className="nav-label creator-label">WORKSPACES</p>
          <NavItem active={workspace === "all"} onClick={() => { setWorkspace("all"); setView("library"); }} symbol="∗" label="All" />
          {data.workspaces.map((entry: Workspace) => (
            <NavItem
              key={entry.id}
              active={workspace === entry.id}
              onClick={() => {
                setWorkspace(entry.id);
                setView("library");
              }}
              symbol={entry.short}
              label={entry.label}
              count={packs.filter((pack) => pack.workspace === entry.id).length}
            />
          ))}
        </nav>

        <div className="sidebar-card">
          <span className="spark">✦</span>
          <strong>Package what works</strong>
          <p>A prompt you have tuned twice belongs in here, not in your notes app.</p>
          <button onClick={() => setEditing({ pack: null })}>
            New pack <span>→</span>
          </button>
        </div>

        <div className="profile">
          <div className="avatar">{initials(data.user.name)}</div>
          <div>
            <strong>{data.user.name}</strong>
            <span>{data.user.role === "owner" ? "Owner" : "Member"}</span>
          </div>
          <button onClick={signOut} aria-label="Sign out" title="Sign out">
            ⏻
          </button>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="mobile-brand">
            <span className="brand-mark">PF</span>
            <strong>PromptForge</strong>
          </div>
          <label className="search">
            <span>⌕</span>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search packs…" />
          </label>
          <div className="top-actions">
            <button className="primary small" onClick={() => setEditing({ pack: null })}>
              ＋ New pack
            </button>
          </div>
        </header>

        {error && <div className="banner error">{error}</div>}
        {unavailableProviders.length > 0 && (
          <div className="banner">
            OpenAI and Anthropic use your signed-in local subscriptions. {unavailableProviders.map(([name]) => name).join(", ")} models
            are disabled until their optional local credentials are configured.
          </div>
        )}

        {view === "library" && (
          <div className="page simple-page">
            <div className="page-title">
              <div>
                <span className="eyebrow">{workspace === "all" ? "EVERY PACK" : "WORKSPACE"}</span>
                <h1>{workspace === "all" ? "Your prompt library" : workspaceLabel(data.workspaces, workspace)}</h1>
                <p>{workspaceBlurb(data.workspaces, workspace)}</p>
              </div>
            </div>

            <div className="pack-grid">
              {filtered.map((pack, index) => (
                <PackCard
                  key={pack.id}
                  pack={pack}
                  index={index}
                  onRun={() => setRunner(pack)}
                  onEdit={() => setEditing({ pack })}
                  onDuplicate={async () => {
                    await api("/api/packs", { action: "duplicate", id: pack.id });
                    setToast("Duplicated");
                    void load();
                  }}
                  onArchive={async () => {
                    await api("/api/packs", { action: "archive", id: pack.id });
                    setToast(`Archived “${pack.title}”`);
                    void load();
                  }}
                />
              ))}
            </div>

            {filtered.length === 0 && (
              <div className="empty">
                <span>⌕</span>
                <h3>Nothing here yet</h3>
                <p>{search ? "No pack matches that search." : "Create your first pack for this workspace."}</p>
              </div>
            )}
          </div>
        )}

        {view === "history" && (
          <div className="page simple-page">
            <div className="page-title">
              <div>
                <span className="eyebrow">RECENT WORK</span>
                <h1>Run history</h1>
                <p>Every run, including the ones that failed.</p>
              </div>
            </div>

            {runs.length === 0 ? (
              <div className="empty">
                <span>↺</span>
                <h3>No runs yet</h3>
                <p>Open a pack and generate something.</p>
              </div>
            ) : (
              <div className="history-list">
                {runs.map((run) => (
                  <article key={run.id} className={run.status === "error" ? "failed" : ""}>
                    <button
                      className={run.favorite ? "starred" : ""}
                      onClick={() => toggleFavorite(run)}
                      aria-label={run.favorite ? "Unstar" : "Star"}
                    >
                      ★
                    </button>
                    <div onClick={() => showRun(run)} role="button" tabIndex={0}
                      onKeyDown={(event) => event.key === "Enter" && showRun(run)}>
                      <span>
                        {run.packTitle} · v{run.packVersion}
                      </span>
                      <h3>{run.status === "error" ? "Failed" : firstLine(run.preview) || "Empty output"}</h3>
                      <p>{run.status === "error" ? run.error : run.preview.slice(0, 180)}</p>
                      <small>
                        <LocalTime value={run.createdAt} /> · {run.model}
                        {run.status === "ok" && ` · ${(run.latencyMs / 1000).toFixed(1)}s · ${run.outputTokens} tok`}
                      </small>
                    </div>
                    <button className="row-delete" onClick={() => removeRun(run)} aria-label="Delete run">
                      ×
                    </button>
                  </article>
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      {editing && (
        <Editor
          pack={editing.pack}
          workspaces={data.workspaces}
          models={data.models}
          providers={data.providers}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            setToast("Saved");
            void load();
          }}
        />
      )}

      {openRun && (
        <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && setOpenRun(null)}>
          <section className="modal run-modal">
            <button className="modal-close" onClick={() => setOpenRun(null)} aria-label="Close">
              ×
            </button>
            <div className="detail-badge">{openRun.title}</div>
            <div className="rendered-output">
              <Markdown text={openRun.output || "(no output)"} />
            </div>
            <div className="modal-actions">
              <button className="ghost" onClick={() => navigator.clipboard?.writeText(openRun.output)}>
                Copy
              </button>
              <button className="primary" onClick={() => setOpenRun(null)}>
                Done
              </button>
            </div>
          </section>
        </div>
      )}

      {toast && (
        <div className="toast">
          <span>✓</span>
          {toast}
        </div>
      )}
    </div>
  );
}

function NavItem({
  active,
  onClick,
  symbol,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  symbol: string;
  label: string;
  count?: number;
}) {
  return (
    <button className={`nav-item ${active ? "active" : ""}`} onClick={onClick}>
      <span className="nav-icon" aria-hidden="true">
        {symbol}
      </span>
      <span>{label}</span>
      {count !== undefined && <b>{count}</b>}
    </button>
  );
}

function PackCard({
  pack,
  index,
  onRun,
  onEdit,
  onDuplicate,
  onArchive,
}: {
  pack: Pack;
  index: number;
  onRun: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onArchive: () => void;
}) {
  const tones = ["coral", "lilac", "mint", "gold"];
  return (
    <article className="pack-card">
      <div className={`pack-cover ${tones[index % tones.length]}`} onClick={onRun}>
        <div className="cover-grid" />
        <span className="category-pill">{pack.workspace}</span>
        <div className="pack-glyph">✦</div>
        <span className="version">v{pack.version}</span>
      </div>
      <div className="pack-body">
        <div className="pack-meta">
          <span>{pack.model}</span>
        </div>
        <h3>{pack.title}</h3>
        <p>{pack.description}</p>
        <div className="pack-footer">
          <div className="card-tools">
            <button onClick={onEdit}>Edit</button>
            <button onClick={onDuplicate}>Duplicate</button>
            <button onClick={onArchive}>Archive</button>
          </div>
          <button className="run-button" onClick={onRun}>
            Run <span>→</span>
          </button>
        </div>
      </div>
    </article>
  );
}

const firstLine = (text: string) =>
  text
    .split("\n")
    .map((line) => line.replace(/^#+\s*/, "").replace(/\*\*/g, "").trim())
    .find((line) => line.length > 0) ?? "";

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "··";

const workspaceLabel = (workspaces: Workspace[], id: string) =>
  workspaces.find((workspace) => workspace.id === id)?.label ?? "Packs";

const workspaceBlurb = (workspaces: Workspace[], id: string) =>
  id === "all"
    ? "Prompts worth keeping, versioned and ready to run."
    : (workspaces.find((workspace) => workspace.id === id)?.blurb ?? "");
