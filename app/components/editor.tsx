"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "../api-client";
import { syncVariables } from "../../lib/template";
import { LocalTime } from "./local-time";
import type { ModelOption, Pack, PackVariable, PackVersion, ProviderId, Workspace } from "../types";

type Props = {
  pack: Pack | null;
  workspaces: Workspace[];
  models: ModelOption[];
  providers: Record<ProviderId, boolean>;
  onSaved: (pack: Pack) => void;
  onClose: () => void;
};

const blank = (models: ModelOption[]) => ({
  title: "",
  description: "",
  workspace: "shared",
  systemPrompt: "",
  prompt: "",
  model: models[0]?.id ?? "",
  temperature: 0.7,
  maxTokens: 2000,
  note: "",
});

export default function Editor({ pack, workspaces, models, providers, onSaved, onClose }: Props) {
  const [form, setForm] = useState(() =>
    pack
      ? {
          title: pack.title,
          description: pack.description,
          workspace: pack.workspace as string,
          systemPrompt: pack.systemPrompt,
          prompt: pack.prompt,
          model: pack.model,
          temperature: pack.temperature,
          maxTokens: pack.maxTokens,
          note: "",
        }
      : blank(models),
  );
  const [variables, setVariables] = useState<PackVariable[]>(pack?.variables ?? []);
  const [tab, setTab] = useState<"prompt" | "inputs" | "history">("prompt");
  const [history, setHistory] = useState<PackVersion[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  // Placeholders are the source of truth for the input list. Re-derive as the
  // template is edited, keeping whatever the author has already customised.
  const setPrompt = (prompt: string) => {
    set("prompt", prompt);
    setVariables((current) => syncVariables(prompt, current));
  };

  useEffect(() => {
    if (tab !== "history" || !pack) return;
    api<{ versions: PackVersion[] }>("/api/packs", { action: "history", id: pack.id })
      .then((data) => setHistory(data.versions))
      .catch((problem) => setError(problem instanceof Error ? problem.message : "Could not load history."));
  }, [tab, pack]);

  const provider = useMemo(
    () => models.find((option) => option.id === form.model)?.provider,
    [models, form.model],
  );

  const save = async () => {
    setBusy(true);
    setError("");
    try {
      const data = await api<{ pack: Pack }>("/api/packs", {
        action: pack ? "update" : "create",
        id: pack?.id,
        ...form,
        variables,
      });
      onSaved(data.pack);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  };

  const revert = async (version: number) => {
    if (!pack) return;
    setBusy(true);
    try {
      const data = await api<{ pack: Pack }>("/api/packs", { action: "revert", id: pack.id, version });
      onSaved(data.pack);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Could not revert.");
    } finally {
      setBusy(false);
    }
  };

  const updateVariable = (name: string, patch: Partial<PackVariable>) =>
    setVariables((current) =>
      current.map((variable) => (variable.name === name ? { ...variable, ...patch } : variable)),
    );

  return (
    <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="modal editor-modal">
        <button className="modal-close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <div className="detail-badge">{pack ? `EDITING · v${pack.version}` : "NEW PACK"}</div>
        <h2>{pack ? pack.title : "Create a pack"}</h2>

        <div className="editor-tabs">
          <button className={tab === "prompt" ? "selected" : ""} onClick={() => setTab("prompt")}>
            Prompt
          </button>
          <button className={tab === "inputs" ? "selected" : ""} onClick={() => setTab("inputs")}>
            Inputs <b>{variables.length}</b>
          </button>
          {pack && (
            <button className={tab === "history" ? "selected" : ""} onClick={() => setTab("history")}>
              History
            </button>
          )}
        </div>

        {tab === "prompt" && (
          <div className="form-grid">
            <label>
              <span>Name</span>
              <input value={form.title} onChange={(event) => set("title", event.target.value)} />
            </label>
            <label>
              <span>Workspace</span>
              <select value={form.workspace} onChange={(event) => set("workspace", event.target.value)}>
                {workspaces.map((workspace) => (
                  <option key={workspace.id} value={workspace.id}>
                    {workspace.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="wide">
              <span>What it does</span>
              <input
                value={form.description}
                onChange={(event) => set("description", event.target.value)}
                placeholder="One line — what reliable outcome does this produce?"
              />
            </label>
            <label className="wide">
              <span>
                System prompt <small>who the model is, and its rules</small>
              </span>
              <textarea
                rows={6}
                value={form.systemPrompt}
                onChange={(event) => set("systemPrompt", event.target.value)}
              />
            </label>
            <label className="wide">
              <span>
                Prompt template <small>{"use {{variable}} to create an input field"}</small>
              </span>
              <textarea rows={10} value={form.prompt} onChange={(event) => setPrompt(event.target.value)} />
            </label>
            <label>
              <span>Model</span>
              <select value={form.model} onChange={(event) => set("model", event.target.value)}>
                {models.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                    {providers[option.provider] ? "" : " — unavailable"}
                  </option>
                ))}
              </select>
            </label>
            {provider === "google" ? (
              <label>
                <span>
                  Temperature <small>{form.temperature.toFixed(2)}</small>
                </span>
                <input
                  type="range"
                  min={0}
                  max={1.5}
                  step={0.05}
                  value={form.temperature}
                  onChange={(event) => set("temperature", Number(event.target.value))}
                />
              </label>
            ) : (
              <label>
                <span>Generation controls</span>
                <small>Sampling is managed by the signed-in subscription CLI.</small>
              </label>
            )}
            <label>
              <span>
                Max output tokens <small>{provider === "google" ? "hard limit" : "best effort"}</small>
              </span>
              <input
                type="number"
                min={256}
                max={32000}
                step={256}
                value={form.maxTokens}
                onChange={(event) => set("maxTokens", Number(event.target.value))}
              />
            </label>
            {pack && (
              <label>
                <span>
                  Change note <small>optional</small>
                </span>
                <input
                  value={form.note}
                  onChange={(event) => set("note", event.target.value)}
                  placeholder="Why this version is different"
                />
              </label>
            )}
          </div>
        )}

        {tab === "inputs" && (
          <div className="variable-editor">
            {variables.length === 0 && (
              <p className="muted">
                No inputs yet. Add <code>{"{{something}}"}</code> to the prompt template and it will show up here.
              </p>
            )}
            {variables.map((variable) => (
              <div className="variable-row" key={variable.name}>
                <code>{`{{${variable.name}}}`}</code>
                <input
                  value={variable.label}
                  onChange={(event) => updateVariable(variable.name, { label: event.target.value })}
                  placeholder="Label"
                />
                <select
                  value={variable.type}
                  onChange={(event) =>
                    updateVariable(variable.name, { type: event.target.value as PackVariable["type"] })
                  }
                >
                  <option value="text">Short text</option>
                  <option value="textarea">Long text</option>
                  <option value="select">Choice</option>
                </select>
                <input
                  value={variable.type === "select" ? variable.options.join(", ") : variable.placeholder}
                  onChange={(event) =>
                    updateVariable(
                      variable.name,
                      variable.type === "select"
                        ? { options: event.target.value.split(",").map((option) => option.trim()).filter(Boolean) }
                        : { placeholder: event.target.value },
                    )
                  }
                  placeholder={variable.type === "select" ? "Comma-separated options" : "Placeholder / example"}
                />
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={variable.required}
                    onChange={(event) => updateVariable(variable.name, { required: event.target.checked })}
                  />
                  <span>Required</span>
                </label>
              </div>
            ))}
          </div>
        )}

        {tab === "history" && (
          <div className="version-list">
            {history.length === 0 && <p className="muted">No saved versions yet.</p>}
            {history.map((version) => (
              <div className="version-row" key={version.id}>
                <strong>v{version.version}</strong>
                <div>
                  <span>{version.note || "No note"}</span>
                  <small>
                    <LocalTime value={version.createdAt} /> · {version.model}
                  </small>
                </div>
                {pack && version.version !== pack.version && (
                  <button onClick={() => revert(version.version)} disabled={busy}>
                    Restore
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {error && <p className="auth-error">{error}</p>}

        <div className="modal-actions">
          <span className="muted small">
            {provider ? `Runs on ${provider}` : "Unknown provider"} ·{" "}
            {pack ? "Editing the prompt creates a new version" : "Saved to your library"}
          </span>
          <button className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" onClick={save} disabled={busy || !form.title.trim() || !form.prompt.trim()}>
            {busy ? "Saving…" : pack ? "Save changes" : "Create pack"}
          </button>
        </div>
      </section>
    </div>
  );
}
