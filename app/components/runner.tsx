"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, streamRun } from "../api-client";
import { Markdown } from "./markdown";
import type { ModelOption, Pack, ProviderId } from "../types";

type Props = {
  pack: Pack;
  models: ModelOption[];
  providers: Record<ProviderId, boolean>;
  initialValues?: Record<string, string>;
  onClose: () => void;
  onFinished: () => void;
};

type Phase = "idle" | "streaming" | "done" | "error";

export default function Runner({ pack, models, providers, initialValues, onClose, onFinished }: Props) {
  const [values, setValues] = useState<Record<string, string>>(initialValues ?? {});
  const [model, setModel] = useState(pack.model);
  const [output, setOutput] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState("");
  const [meta, setMeta] = useState<{ inputTokens: number; outputTokens: number; latencyMs: number } | null>(null);
  const [copied, setCopied] = useState(false);
  const [runId, setRunId] = useState("");
  const [saved, setSaved] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const outputRef = useRef<HTMLDivElement>(null);

  const provider = useMemo(
    () => models.find((option) => option.id === model)?.provider ?? pack.provider,
    [models, model, pack.provider],
  );
  const providerReady = providers[provider] ?? false;
  const missing = pack.variables.filter((variable) => variable.required && !(values[variable.name] ?? "").trim());
  const canRun = missing.length === 0 && providerReady && phase !== "streaming";

  const run = useCallback(async () => {
    if (!canRun) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setPhase("streaming");
    setOutput("");
    setMessage("");
    setMeta(null);
    setRunId("");
    setSaved(false);

    try {
      for await (const event of streamRun({ packId: pack.id, model, values }, controller.signal)) {
        if (event.type === "start") setRunId(event.runId);
        else if (event.type === "delta") setOutput((current) => current + event.text);
        else if (event.type === "done") {
          setMeta({
            inputTokens: event.inputTokens,
            outputTokens: event.outputTokens,
            latencyMs: event.latencyMs,
          });
          setPhase("done");
        } else if (event.type === "error") {
          setMessage(event.message);
          setPhase("error");
        }
      }
      setPhase((current) => (current === "streaming" ? "done" : current));
    } catch (error) {
      if (controller.signal.aborted) {
        setPhase("done");
        setMessage("Stopped.");
      } else {
        setMessage(error instanceof Error ? error.message : "Generation failed.");
        setPhase("error");
      }
    } finally {
      abortRef.current = null;
      onFinished();
    }
  }, [canRun, model, onFinished, pack.id, values]);

  // ⌘/Ctrl + Enter runs, Escape stops a run in flight.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        void run();
      }
      if (event.key === "Escape" && abortRef.current) abortRef.current.abort();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [run]);

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    if (phase !== "streaming") return;
    const node = outputRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [output, phase]);

  const copy = async () => {
    await navigator.clipboard?.writeText(output);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  const saveFavorite = async () => {
    if (!runId || saved) return;
    // The run row was written server-side as it streamed; starring is a separate call.
    await api("/api/runs", { action: "favorite", runId, favorite: true });
    setSaved(true);
    onFinished();
  };

  return (
    <div className="runner-shell">
      <header className="runner-head">
        <button className="back" onClick={onClose} aria-label="Back to library">
          ←
        </button>
        <div>
          <div>
            <span className={`status-dot ${phase}`} /> {pack.title}
          </div>
          <h2>{pack.description || "Run this pack"}</h2>
        </div>
        <div className="runner-head-right">
          <span>v{pack.version}</span>
          <button onClick={onClose}>Close</button>
        </div>
      </header>

      {!providerReady && (
        <div className="banner warn">
          No API key configured for <strong>{provider}</strong>. Add it to <code>.dev.vars</code> locally, or run{" "}
          <code>npx wrangler secret put</code> for the deployed Worker. Pick a different model below to use a
          provider that is configured.
        </div>
      )}

      <div className="runner-grid">
        <section className="inputs-panel">
          <div className="panel-title">
            <span>01</span>
            <div>
              <h3>Inputs</h3>
              <p>Specific inputs create better outputs.</p>
            </div>
          </div>

          <div className="field-list">
            {pack.variables.length === 0 && (
              <p className="muted">This pack has no variables — it runs its prompt as written.</p>
            )}
            {pack.variables.map((variable) => (
              <label key={variable.name}>
                <span>
                  {variable.label}
                  {variable.required && <b>*</b>}
                </span>
                {variable.type === "select" ? (
                  <select
                    value={values[variable.name] ?? ""}
                    onChange={(event) => setValues({ ...values, [variable.name]: event.target.value })}
                  >
                    <option value="">Choose…</option>
                    {variable.options.map((option) => (
                      <option key={option}>{option}</option>
                    ))}
                  </select>
                ) : (
                  <textarea
                    rows={variable.type === "textarea" ? 6 : 2}
                    value={values[variable.name] ?? ""}
                    placeholder={variable.placeholder}
                    onChange={(event) => setValues({ ...values, [variable.name]: event.target.value })}
                  />
                )}
              </label>
            ))}
          </div>

          <div className="model-row">
            <label>
              <span>Model</span>
              <select value={model} onChange={(event) => setModel(event.target.value)}>
                {models.map((option) => (
                  <option key={option.id} value={option.id} disabled={!providers[option.provider]}>
                    {option.label}
                    {providers[option.provider] ? "" : " — no key"}
                  </option>
                ))}
              </select>
            </label>
            <div>
              <span>Temperature</span>
              <b>{pack.temperature.toFixed(2)}</b>
            </div>
          </div>

          {phase === "streaming" ? (
            <button className="generate stop" onClick={() => abortRef.current?.abort()}>
              Stop <span>esc</span>
            </button>
          ) : (
            <button className="generate" onClick={run} disabled={!canRun}>
              Generate <span>⌘ ↵</span>
            </button>
          )}
          {missing.length > 0 && (
            <p className="run-note">Still needed: {missing.map((variable) => variable.label).join(", ")}</p>
          )}
        </section>

        <section className={`output-panel ${output || message ? "has-output" : ""}`}>
          <div className="panel-title">
            <span>02</span>
            <div>
              <h3>Output</h3>
              <p>
                {phase === "streaming"
                  ? `Streaming from ${model}…`
                  : meta
                    ? `${(meta.latencyMs / 1000).toFixed(1)}s · ${meta.outputTokens} output tokens · ${model}`
                    : "The result will appear here."}
              </p>
            </div>
            {output && phase !== "streaming" && (
              <div className="output-actions">
                <button onClick={copy}>{copied ? "Copied" : "Copy"}</button>
                <button onClick={saveFavorite} disabled={!runId || saved}>
                  {saved ? "★ Saved" : "★ Save"}
                </button>
              </div>
            )}
          </div>

          {phase === "error" && !output && (
            <div className="run-error">
              <strong>Generation failed</strong>
              <p>{message}</p>
            </div>
          )}

          {output ? (
            <div className="rendered-output" ref={outputRef}>
              <Markdown text={output} />
              {phase === "streaming" && <span className="caret" />}
              {phase === "error" && (
                <div className="run-error inline">
                  <strong>Stopped early</strong>
                  <p>{message}</p>
                </div>
              )}
            </div>
          ) : phase === "streaming" ? (
            <div className="thinking">
              <div className="forge-orb">✦</div>
              <h3>Working…</h3>
              <p>First tokens usually arrive within a couple of seconds.</p>
              <div className="thinking-bar">
                <span />
              </div>
            </div>
          ) : phase === "error" ? null : (
            <div className="empty-output">
              <div>✦</div>
              <h3>Ready when you are</h3>
              <p>Fill in the fields, then generate.</p>
              <span>{pack.model}</span>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
