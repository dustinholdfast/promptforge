"use client";

import { useEffect, useMemo, useState } from "react";

type Pack = { id: string; title: string; description: string; category: string; price: number; model: string; version: number; prompt: string; variables: string[]; creatorId: string };
type Run = { id: number; packId: string; model: string; output: string; favorite: boolean; createdAt: string };
type View = "discover" | "library" | "history" | "creator";

const icon = (name: string) => <span className="nav-icon" aria-hidden="true">{name}</span>;

export default function PromptForgeApp() {
  const [view, setView] = useState<View>("discover");
  const [packs, setPacks] = useState<Pack[]>([]);
  const [owned, setOwned] = useState<string[]>([]);
  const [history, setHistory] = useState<Run[]>([]);
  const [stats, setStats] = useState({ runs: 0, revenue: 0, rating: 4.9 });
  const [selected, setSelected] = useState<Pack | null>(null);
  const [runner, setRunner] = useState<Pack | null>(null);
  const [creating, setCreating] = useState(false);
  const [category, setCategory] = useState("All packs");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState("");

  const refresh = async () => {
    const response = await fetch("/api/forge");
    const data = await response.json();
    if (response.ok) {
      setPacks(data.packs); setOwned(data.owned); setHistory(data.history); setStats(data.stats);
    }
    setLoading(false);
  };
  useEffect(() => { refresh(); }, []);
  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(""), 2800); return () => clearTimeout(id); }, [toast]);

  const filtered = useMemo(() => packs.filter((p) =>
    (category === "All packs" || p.category === category) &&
    `${p.title} ${p.description}`.toLowerCase().includes(search.toLowerCase())
  ), [packs, category, search]);

  const acquire = async (pack: Pack) => {
    if (!owned.includes(pack.id)) {
      await fetch("/api/forge", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "acquire", packId: pack.id }) });
      setOwned((current) => [...current, pack.id]);
      setToast(pack.price ? "Pack added — demo checkout complete" : "Free pack added to your library");
    }
    setSelected(null); setRunner(pack);
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button className="brand" onClick={() => setView("discover")} aria-label="PromptForge home">
          <span className="brand-mark">PF</span><span>PromptForge</span>
        </button>
        <nav aria-label="Primary navigation">
          <p className="nav-label">WORKSPACE</p>
          <Nav active={view === "discover"} onClick={() => setView("discover")} symbol="⌂" label="Discover" />
          <Nav active={view === "library"} onClick={() => setView("library")} symbol="◇" label="My library" count={owned.length} />
          <Nav active={view === "history"} onClick={() => setView("history")} symbol="↺" label="Run history" />
          <p className="nav-label creator-label">CREATOR</p>
          <Nav active={view === "creator"} onClick={() => setView("creator")} symbol="✦" label="Creator studio" />
        </nav>
        <div className="sidebar-card">
          <span className="spark">✦</span>
          <strong>Build something useful</strong>
          <p>Package your expertise into a workflow people can trust.</p>
          <button onClick={() => { setView("creator"); setCreating(true); }}>Create a pack <span>→</span></button>
        </div>
        <div className="profile">
          <div className="avatar">DS</div><div><strong>Devon Shaw</strong><span>Creator account</span></div><button aria-label="Account options">•••</button>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="mobile-brand"><span className="brand-mark">PF</span><strong>PromptForge</strong></div>
          <label className="search"><span>⌕</span><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search prompt packs..." /><kbd>⌘ K</kbd></label>
          <div className="top-actions"><button className="icon-button" aria-label="Notifications">♢<i /></button><button className="primary small" onClick={() => { setView("creator"); setCreating(true); }}>＋ Create pack</button></div>
        </header>

        {view === "discover" && <Discover packs={filtered} loading={loading} category={category} setCategory={setCategory} owned={owned} select={setSelected} run={setRunner} />}
        {view === "library" && <Library packs={packs.filter((p) => owned.includes(p.id) || p.price === 0)} run={setRunner} />}
        {view === "history" && <History history={history} packs={packs} setHistory={setHistory} />}
        {view === "creator" && <Creator packs={packs.filter((p) => p.creatorId === "studio-north")} stats={stats} creating={creating} setCreating={setCreating} onPublish={(pack) => { setPacks((p) => [pack, ...p]); setCreating(false); setToast("Pack published to the marketplace"); }} />}
      </main>

      {selected && <PackModal pack={selected} owned={owned.includes(selected.id)} close={() => setSelected(null)} acquire={() => acquire(selected)} />}
      {runner && <Runner pack={runner} close={() => { setRunner(null); refresh(); }} onRun={(run) => { setHistory((h) => [run, ...h]); setStats((s) => ({ ...s, runs: s.runs + 1 })); }} />}
      {toast && <div className="toast"><span>✓</span>{toast}</div>}
    </div>
  );
}

function Nav({ active, onClick, symbol, label, count }: { active: boolean; onClick: () => void; symbol: string; label: string; count?: number }) {
  return <button className={`nav-item ${active ? "active" : ""}`} onClick={onClick}>{icon(symbol)}<span>{label}</span>{count !== undefined && <b>{count}</b>}</button>;
}

function Discover({ packs, loading, category, setCategory, owned, select, run }: { packs: Pack[]; loading: boolean; category: string; setCategory: (v: string) => void; owned: string[]; select: (p: Pack) => void; run: (p: Pack) => void }) {
  const cats = ["All packs", "Sales", "Marketing", "E-commerce", "Legal", "Operations"];
  return <div className="page discover">
    <section className="hero">
      <div><div className="eyebrow"><span>✦</span> CURATED AI WORKFLOWS</div><h1>Skip the prompting.<br /><em>Start with what works.</em></h1><p>Production-ready prompt packs built by experts, tested on real work, and improved over time.</p><div className="hero-actions"><button className="primary" onClick={() => document.getElementById("packs")?.scrollIntoView({ behavior: "smooth" })}>Explore packs <span>→</span></button><button className="ghost" onClick={() => setCategory("Sales")}>See how it works <span>▶</span></button></div></div>
      <div className="hero-proof"><div className="proof-stack"><div className="proof-card back"><span>02</span><b>Research the signal</b></div><div className="proof-card mid"><span>03</span><b>Draft each touch</b></div><div className="proof-card front"><div className="proof-top"><small>WORKFLOW COMPLETE</small><i>✓</i></div><h3>Signal-Led Outbound</h3><p>4 tailored messages, ready to review.</p><div className="output-lines"><span /><span /><span /></div><button>Open output <span>↗</span></button></div></div></div>
    </section>
    <section className="catalog" id="packs">
      <div className="section-heading"><div><h2>Explore proven workflows</h2><p>Built for the work you do every day.</p></div><button className="link-button">View all packs <span>→</span></button></div>
      <div className="category-tabs">{cats.map((cat) => <button key={cat} className={category === cat ? "selected" : ""} onClick={() => setCategory(cat)}>{cat}</button>)}</div>
      <div className="pack-grid">{loading ? [1,2,3].map((n) => <div className="pack-card skeleton" key={n} />) : packs.map((pack, index) => <PackCard key={pack.id} pack={pack} index={index} owned={owned.includes(pack.id)} select={() => select(pack)} run={() => run(pack)} />)}</div>
      {!loading && packs.length === 0 && <div className="empty"><span>⌕</span><h3>No packs found</h3><p>Try another category or search term.</p></div>}
    </section>
  </div>;
}

function PackCard({ pack, index, owned, select, run }: { pack: Pack; index: number; owned: boolean; select: () => void; run: () => void }) {
  const tones = ["coral", "lilac", "mint", "gold"];
  return <article className="pack-card" onClick={select} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && select()}>
    <div className={`pack-cover ${tones[index % tones.length]}`}><div className="cover-grid" /><span className="category-pill">{pack.category}</span><div className="pack-glyph">{pack.category === "Sales" ? "↗" : pack.category === "E-commerce" ? "◇" : "✦"}</div><span className="version">v{pack.version}</span></div>
    <div className="pack-body"><div className="pack-meta"><span><i className="creator-dot" />{pack.creatorId === "studio-north" ? "Studio North" : "Good Reason"}</span><span>★ 4.9</span></div><h3>{pack.title}</h3><p>{pack.description}</p><div className="pack-footer"><div><strong>{pack.price === 0 ? "Free" : `$${pack.price}`}</strong>{pack.price > 0 && <span> one-time</span>}</div><button onClick={(e) => { e.stopPropagation(); owned || pack.price === 0 ? run() : select(); }}>{owned || pack.price === 0 ? "Run" : "Preview"} <span>→</span></button></div></div>
  </article>;
}

function PackModal({ pack, owned, close, acquire }: { pack: Pack; owned: boolean; close: () => void; acquire: () => void }) {
  return <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && close()}><section className="modal pack-detail"><button className="modal-close" onClick={close}>×</button><div className="detail-badge">{pack.category} · v{pack.version}</div><h2>{pack.title}</h2><p className="detail-lede">{pack.description}</p><div className="detail-stats"><div><strong>4.9</strong><span>Rating</span></div><div><strong>1,240</strong><span>Runs</span></div><div><strong>{pack.version}</strong><span>Versions</span></div></div><div className="sample"><div className="sample-head"><span>Sample output</span><b>MARKDOWN</b></div><h4>A sharper opening, grounded in a real signal</h4><p>Noticed your team is expanding into enterprise. That shift usually creates a gap between the story that got you here and the proof larger buyers need next...</p></div><div className="detail-bottom"><div><span>{pack.price ? "One-time purchase" : "Starter pack"}</span><strong>{pack.price ? `$${pack.price}` : "Free"}</strong></div><button className="primary" onClick={acquire}>{owned ? "Open workflow" : pack.price ? "Buy & open pack" : "Add free pack"} <span>→</span></button></div><p className="secure-note">✓ Instant access · Latest version included · 30-day guarantee</p></section></div>;
}

function Runner({ pack, close, onRun }: { pack: Pack; close: () => void; onRun: (r: Run) => void }) {
  const [values, setValues] = useState<Record<string,string>>({});
  const [model, setModel] = useState(pack.model);
  const [output, setOutput] = useState("");
  const [running, setRunning] = useState(false);
  const [latency, setLatency] = useState("");
  const run = async () => {
    setRunning(true); setOutput("");
    const response = await fetch("/api/generate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ packId: pack.id, model, values }) });
    const data = await response.json();
    if (response.ok) { setOutput(data.output); setLatency(data.latency); onRun(data.run); }
    else setOutput(`Generation failed: ${data.error}`);
    setRunning(false);
  };
  const ready = pack.variables.every((v) => values[v]?.trim());
  return <div className="runner-shell"><header className="runner-head"><button className="back" onClick={close}>←</button><div><div><span className="status-dot" /> LIVE WORKFLOW</div><h2>{pack.title}</h2></div><div className="runner-head-right"><span>v{pack.version}</span><button onClick={close}>Save & close</button></div></header><div className="runner-grid"><section className="inputs-panel"><div className="panel-title"><span>01</span><div><h3>Give it context</h3><p>Specific inputs create better outputs.</p></div></div><div className="field-list">{pack.variables.map((variable, index) => <label key={variable}><span>{variable.replace(/-/g," ")}<b>*</b></span><textarea rows={index === pack.variables.length - 1 ? 3 : 2} value={values[variable] || ""} onChange={(e) => setValues({ ...values, [variable]: e.target.value })} placeholder={placeholder(variable)} /></label>)}</div><div className="model-row"><label><span>Model</span><select value={model} onChange={(e) => setModel(e.target.value)}><option>Claude 3.7 Sonnet</option><option>GPT-4.1</option><option>Gemini 2.5 Pro</option></select></label><div><span>Output</span><b>Markdown</b></div></div><button className="generate" onClick={run} disabled={!ready || running}>{running ? <><i className="spinner" /> Forging your output...</> : <>✦ Generate output <span>⌘ ↵</span></>}</button><p className="run-note">Your inputs are encrypted and never used for training.</p></section><section className={`output-panel ${output ? "has-output" : ""}`}><div className="panel-title"><span>02</span><div><h3>Your output</h3><p>{output ? `Generated in ${latency}s · ${model}` : "A polished result will appear here."}</p></div>{output && <button onClick={() => navigator.clipboard?.writeText(output)}>Copy</button>}</div>{running ? <div className="thinking"><div className="forge-orb">✦</div><h3>Forging a strong first draft</h3><p>Analyzing context, applying workflow logic, and refining the final response…</p><div className="thinking-bar"><span /></div></div> : output ? <div className="rendered-output">{output.split("\n").map((line, i) => line.startsWith("# ") ? <h1 key={i}>{line.slice(2)}</h1> : line.startsWith("## ") ? <h2 key={i}>{line.slice(3)}</h2> : line.startsWith("- ") ? <li key={i}>{line.slice(2)}</li> : line.startsWith("**") ? <p key={i}><strong>{line.replace(/\*\*/g, "")}</strong></p> : <p key={i}>{line.replace(/\*/g, "") || "\u00a0"}</p>)}</div> : <div className="empty-output"><div>✦</div><h3>Ready when you are</h3><p>Complete the fields on the left, then generate your first output.</p><span>Premium prompts · Versioned · Tested</span></div>}</section></div></div>;
}

function placeholder(name: string) { const map: Record<string,string> = { company: "e.g. Northstar Analytics", persona: "e.g. VP of Revenue at a Series B SaaS", trigger: "e.g. They just hired their first CRO", offer: "e.g. Pipeline intelligence that surfaces deal risk", product: "e.g. Hand-thrown ceramic pour-over set", audience: "Who is this for?", proof: "What makes it credible?", voice: "e.g. Warm, confident, quietly premium", source: "Paste the core content or idea", channels: "e.g. LinkedIn, email, X", thesis: "The one belief that must survive" }; return map[name] || `Enter ${name}`; }

function Library({ packs, run }: { packs: Pack[]; run: (p: Pack) => void }) { return <div className="page simple-page"><div className="page-title"><div><span className="eyebrow">YOUR TOOLKIT</span><h1>My library</h1><p>The workflows you trust, ready whenever the work starts.</p></div></div><div className="library-list">{packs.map((p) => <button key={p.id} className="library-row" onClick={() => run(p)}><div className="library-icon">✦</div><div><h3>{p.title}</h3><p>{p.category} · v{p.version} · {p.model}</p></div><span>Run workflow →</span></button>)}</div></div>; }

function History({ history, packs, setHistory }: { history: Run[]; packs: Pack[]; setHistory: (r: Run[]) => void }) {
  const favorite = async (run: Run) => { await fetch("/api/forge", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "favorite", runId: run.id, favorite: !run.favorite }) }); setHistory(history.map((r) => r.id === run.id ? { ...r, favorite: !r.favorite } : r)); };
  return <div className="page simple-page"><div className="page-title"><div><span className="eyebrow">RECENT WORK</span><h1>Run history</h1><p>Every useful output, easy to find and reuse.</p></div></div>{history.length ? <div className="history-list">{history.map((r) => <article key={r.id}><button className={r.favorite ? "starred" : ""} onClick={() => favorite(r)}>★</button><div><span>{packs.find((p) => p.id === r.packId)?.title || "Prompt pack"}</span><h3>{r.output.split("\n")[0].replace("# ", "")}</h3><p>{r.output.split("\n").find((l) => l.length > 80)?.slice(0,150)}…</p><small>{new Date(r.createdAt).toLocaleDateString()} · {r.model}</small></div></article>)}</div> : <div className="empty"><span>↺</span><h3>No runs yet</h3><p>Open a workflow from Discover to create your first output.</p></div>}</div>;
}

function Creator({ packs, stats, creating, setCreating, onPublish }: { packs: Pack[]; stats: { runs: number; revenue: number; rating: number }; creating: boolean; setCreating: (v: boolean) => void; onPublish: (p: Pack) => void }) {
  return <div className="page creator-page"><div className="page-title"><div><span className="eyebrow">CREATOR STUDIO</span><h1>Build expertise into products.</h1><p>Create, improve, and understand the workflows people rely on.</p></div><button className="primary" onClick={() => setCreating(true)}>＋ New prompt pack</button></div><div className="stat-grid"><Stat label="TOTAL REVENUE" value={`$${stats.revenue.toFixed(0)}`} note="↗ 18.4%" /><Stat label="WORKFLOW RUNS" value={stats.runs.toLocaleString()} note="↗ This month" /><Stat label="AVERAGE RATING" value={`${stats.rating}`} note="★ Across all packs" /></div><div className="creator-table"><div className="table-head"><h2>Your prompt packs</h2><span>{packs.length} published</span></div>{packs.map((p) => <div className="table-row" key={p.id}><div className="mini-cover">✦</div><div><strong>{p.title}</strong><span>{p.category} · v{p.version}</span></div><span className="published">● Published</span><div><strong>{stats.runs}</strong><span>runs</span></div><div><strong>${stats.revenue.toFixed(0)}</strong><span>revenue</span></div><button>•••</button></div>)}</div>{creating && <CreatePack close={() => setCreating(false)} publish={onPublish} />}</div>;
}
function Stat({ label, value, note }: { label: string; value: string; note: string }) { return <div className="stat-card"><span>{label}</span><strong>{value}</strong><small>{note}</small><div className="micro-chart"><i/><i/><i/><i/><i/><i/><i/></div></div>; }

function CreatePack({ close, publish }: { close: () => void; publish: (p: Pack) => void }) {
  const [form, setForm] = useState({ title: "", description: "", category: "Sales", price: "19", model: "Claude 3.7 Sonnet", prompt: "" });
  const [saving, setSaving] = useState(false);
  const submit = async () => { setSaving(true); const response = await fetch("/api/forge", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "publish", ...form, price: Number(form.price) }) }); const data = await response.json(); setSaving(false); if (response.ok) publish(data.pack); };
  return <div className="overlay"><section className="modal create-modal"><button className="modal-close" onClick={close}>×</button><div className="detail-badge">NEW PROMPT PACK</div><h2>Package what works.</h2><p className="detail-lede">Use <code>{"{{variable}}"}</code> anywhere in your prompt to create a runner input.</p><div className="form-grid"><label><span>Pack name</span><input value={form.title} onChange={(e) => setForm({...form,title:e.target.value})} placeholder="e.g. Objection Crusher" /></label><label><span>Category</span><select value={form.category} onChange={(e) => setForm({...form,category:e.target.value})}><option>Sales</option><option>Marketing</option><option>E-commerce</option><option>Legal</option><option>Operations</option></select></label><label className="wide"><span>Short description</span><input value={form.description} onChange={(e) => setForm({...form,description:e.target.value})} placeholder="What reliable outcome does this create?" /></label><label><span>Preferred model</span><select value={form.model} onChange={(e) => setForm({...form,model:e.target.value})}><option>Claude 3.7 Sonnet</option><option>GPT-4.1</option><option>Gemini 2.5 Pro</option></select></label><label><span>One-time price</span><div className="money-input"><b>$</b><input type="number" value={form.price} onChange={(e) => setForm({...form,price:e.target.value})} /></div></label><label className="wide"><span>Prompt template</span><textarea rows={7} value={form.prompt} onChange={(e) => setForm({...form,prompt:e.target.value})} placeholder="Act as an expert... Create a sequence for {{company}} aimed at {{persona}}..." /></label></div><div className="modal-actions"><button className="ghost" onClick={close}>Save draft</button><button className="primary" onClick={submit} disabled={!form.title || !form.prompt || saving}>{saving ? "Publishing..." : "Publish pack"} <span>→</span></button></div></section></div>;
}
