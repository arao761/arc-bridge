import React, { useEffect, useMemo, useState, useRef } from "react";
import {
  ArrowUpRight,
  ArrowRight,
  ArrowLeft,
  Check,
  ShieldCheck,
  Folder,
  FolderOpen,
  FileJson,
  Upload,
  Globe,
  Pin,
  ChevronDown,
  ChevronRight,
  Layers,
  Link2,
  Download,
  RefreshCw,
  X,
  Monitor,
  Clock,
  CheckCircle2,
  TriangleAlert,
  Unplug,
  MoveRight,
  Search,
  Archive,
  Settings2,
  Pause,
  RotateCcw,
} from "lucide-react";
import { importSource, mergeSections, bookmarkHTML } from "../core/import.mjs";
import { buildPlan } from "../core/archive.mjs";
import demo from "../fixtures/demo.json";
import "./style.css";
const native = window.arcBridge;
const tabsOf = (a) =>
  a?.profiles.flatMap((p) => p.spaces.flatMap((s) => s.tabs)) || [];
const totalSpaces = (a) =>
  a?.profiles.reduce((n, p) => n + p.spaces.length, 0) || 0;
function download(name, content) {
  if (native) return native.save(name, content);
  const url = URL.createObjectURL(
    new Blob([content], {
      type: name.endsWith(".html") ? "text/html" : "application/json",
    }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return Promise.resolve(true);
}
function Brand({ small = false }) {
  return (
    <div className={"brand " + (small ? "small" : "")}>
      <span className="brand-mark">
        <MoveRight size={22} />
      </span>
      <span>
        arc<span className="brand-light">bridge</span>
        <sup>β</sup>
      </span>
    </div>
  );
}
function BrowserIcon({ type }) {
  return (
    <span className={"browser-icon " + type}>
      {type === "arc" ? (
        <svg viewBox="0 0 40 40">
          <path
            d="M8 32 19 8q1-2 2 0l11 24M13 23q8 7 16-2"
            fill="none"
            stroke="currentColor"
            strokeWidth="4"
            strokeLinecap="round"
          />
        </svg>
      ) : (
        <Globe size={30} />
      )}
    </span>
  );
}
export default function App() {
  const [view, setView] = useState("migration"),
    [step, setStep] = useState(0),
    [source, setSource] = useState(null),
    [fileName, setFileName] = useState(""),
    [isDemo, setIsDemo] = useState(false),
    [selected, setSelected] = useState(new Set()),
    [grouping, setGrouping] = useState({}),
    [mappings, setMappings] = useState({}),
    [query, setQuery] = useState(""),
    [expanded, setExpanded] = useState(new Set()),
    [state, setState] = useState({
      receivers: [],
      jobs: [],
      bridgeInstalled: false,
    }),
    [jobs, setJobs] = useState([]),
    [skipped, setSkipped] = useState([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [activeJobs, setActiveJobs] = useState([]);
  const fileRef = useRef(null);
  async function refresh() {
    if (native)
      try {
        setState(await native.state());
      } catch (e) {
        setError(e.message);
      }
  }
  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 2500);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    setError("");
    setConfirmed(false);
    window.scrollTo(0, 0);
  }, [step, view]);
  useEffect(() => {
    if (notice) {
      const t = setTimeout(() => setNotice(""), 6000);
      return () => clearTimeout(t);
    }
  }, [notice]);
  const archive = source?.archive;
  let chosen,
    selectionError = "";
  try {
    if (archive) {
      const subset = {
        ...archive,
        profiles: archive.profiles
          .map((p) => ({
            ...p,
            spaces: p.spaces
              .map((s) => ({
                ...s,
                tabs: s.tabs.filter((t) => selected.has(t.id)),
              }))
              .filter((s) => s.tabs.length),
          }))
          .filter((p) => p.spaces.length),
      };
      chosen = mergeSections(subset, grouping);
    }
  } catch (e) {
    selectionError = e.message;
  }
  const chosenCount = tabsOf(chosen).length;
  const online = state.receivers.filter((r) => r.online && r.enabled);
  const currentReports = state.jobs.filter((j) => activeJobs.includes(j.id));
  async function act(fn) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  function load(content, name, example = false) {
    const parsed = importSource(content);
    setSource(parsed);
    setFileName(name);
    setIsDemo(example);
    setSelected(new Set(tabsOf(parsed.archive).map((t) => t.id)));
    setGrouping(
      Object.fromEntries(parsed.archive.profiles.map((p) => [p.id, p.name])),
    );
    setMappings({});
    setQuery("");
    setExpanded(new Set());
    setJobs([]);
    setStep(1);
    setView("migration");
  }
  async function open() {
    await act(async () => {
      if (native) {
        const file = await native.open();
        if (file) load(file.content, file.name);
      } else fileRef.current.click();
    });
  }
  async function fileInput(file) {
    if (!file) return;
    await act(async () => {
      if (file.size > 20 * 1024 * 1024)
        throw Error("Choose a file smaller than 20 MB.");
      load(await file.text(), file.name);
    });
  }
  async function review() {
    await act(async () => {
      if (selectionError) throw Error(selectionError);
      if (!chosenCount) throw Error("Select at least one tab.");
      const plan = buildPlan(chosen, mappings);
      const result = [];
      for (const profile of chosen.profiles) {
        const operations = plan.operations.filter(
          (o) => o.sourceProfileId === profile.id,
        );
        if (!operations.length) continue;
        const encoded = new TextEncoder().encode(JSON.stringify(operations));
        const hash = [
          ...new Uint8Array(await crypto.subtle.digest("SHA-256", encoded)),
        ]
          .map((v) => v.toString(16).padStart(2, "0"))
          .join("");
        result.push({
          format: "arc-bridge-migration",
          version: 1,
          id: `migration-${hash.slice(0, 32)}`,
          targetProfileId: mappings[profile.id].profileId,
          sourceName: profile.name,
          skipped: plan.skipped.filter((s) => s.profileId === profile.id),
          operations,
        });
      }
      if (!result.length)
        throw Error("No supported HTTP/HTTPS tabs are selected.");
      setJobs(result);
      setSkipped(plan.skipped);
      setStep(3);
    });
  }
  const updateMapping = (id, value) =>
    setMappings((prev) => ({
      ...prev,
      [id]: { spaces: "groups", ...prev[id], ...value },
    }));
  const toggle = (ids) => {
    setSelected((prev) => {
      const next = new Set(prev);
      const all = ids.every((id) => next.has(id));
      for (const id of ids) all ? next.delete(id) : next.add(id);
      return next;
    });
  };
  const saveArchive = () =>
    act(async () => {
      if (
        await download(
          "arc-bridge-backup.json",
          JSON.stringify(chosen || archive, null, 2),
        )
      )
        setNotice("Portable backup saved on your device.");
    });
  const saveHTML = () =>
    act(async () => {
      if (
        await download(
          "arc-bridge-bookmarks.html",
          bookmarkHTML(chosen || archive),
        )
      )
        setNotice(
          "Bookmark HTML saved. Import it from Firefox’s bookmark library.",
        );
    });
  return (
    <div className="app">
      <aside className="sidebar">
        <Brand />
        <div className="nav-label">YOUR NEXT CHAPTER</div>
        <nav>
          {[
            ["migration", ArrowUpRight, "New migration"],
            ["receivers", Link2, "Firefox receivers"],
            ["history", Clock, "Migration history"],
          ].map(([id, Icon, label]) => (
            <button
              key={id}
              className={view === id ? "nav-item active" : "nav-item"}
              onClick={() => setView(id)}
            >
              <Icon size={17} />
              {label}
              {id === "receivers" && online.length > 0 && (
                <span className="nav-dot" />
              )}
            </button>
          ))}
        </nav>
        <div className="side-story">
          <div className="little-bridge">⌒</div>
          <h3>
            Take your world
            <br />
            with you.
          </h3>
          <p>
            A different browser.
            <br />A familiar workspace.
          </p>
        </div>
        <div className="sidebar-bottom">
          <span>
            <ShieldCheck size={14} /> Local by design
          </span>
          <small>Arc Bridge · {state.version || "0.2.0"} beta</small>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div>
            Workspace <ChevronRight size={12} />
            <strong>
              {view === "migration"
                ? "Arc → Firefox"
                : view === "receivers"
                  ? "Firefox receivers"
                  : "History"}
            </strong>
          </div>
          <span className="private-label">
            <span />
            Your data stays here
          </span>
        </header>
        <main>
          {error && (
            <div className="alert error" role="alert">
              <TriangleAlert size={17} />
              <span>{error}</span>
              <button onClick={() => setError("")} aria-label="Dismiss error">
                <X size={16} />
              </button>
            </div>
          )}
          {notice && (
            <div className="alert success" role="status">
              <CheckCircle2 size={17} />
              {notice}
              <button
                onClick={() => setNotice("")}
                aria-label="Dismiss notification"
              >
                <X size={16} />
              </button>
            </div>
          )}
          {view === "migration" && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">A LITTLE LESS STARTING OVER</div>
                  <h1>
                    {step === 0
                      ? "New browser. Same world."
                      : step === 1
                        ? "Everything, in its place."
                        : step === 2
                          ? "Choose a new home."
                          : step === 3
                            ? "A good move starts here."
                            : "Your workspace is on its way."}
                  </h1>
                  <p>
                    {step === 0
                      ? "Bring your Arc workspace into Firefox. Keep the things that make it yours."
                      : step === 1
                        ? "Review what’s coming along. You’re in control of every tab."
                        : step === 2
                          ? "Keep work and personal separate, just the way you intended."
                          : step === 3
                            ? "One last look before opening anything in Firefox."
                            : "Follow the transfer in each paired Firefox profile."}
                  </p>
                </div>
                <span className="beta-pill">
                  MAC BETA <span>↗</span>
                </span>
              </div>
              <div className="stepper">
                {[
                  "Choose source",
                  "Organize",
                  "Map profiles",
                  "Review & move",
                ].map((label, i) => (
                  <button
                    key={label}
                    className={
                      "step " +
                      (step === i ? "current" : step > i ? "complete" : "")
                    }
                    disabled={i > step || step === 4}
                    onClick={() => {
                      if (i < 3) setStep(i);
                      else void review();
                    }}
                  >
                    <span>{step > i ? <Check size={13} /> : i + 1}</span>
                    {label}
                    {i < 3 && <div />}
                  </button>
                ))}
              </div>
              {step === 0 && (
                <>
                  <section className="welcome-grid">
                    <div className="welcome-copy">
                      <span className="mini-tag">
                        <span /> MADE FOR YOUR NEXT BROWSER
                      </span>
                      <h2>
                        All those tabs.
                        <br />
                        <em>All that possibility.</em>
                      </h2>
                      <p>
                        Spaces, folders, pins, and the rabbit holes worth
                        keeping. Give them a fresh start in Firefox.
                      </p>
                      <div className="hero-buttons">
                        <button
                          className="button primary"
                          onClick={open}
                          disabled={busy}
                        >
                          <Upload size={16} />
                          Choose an Arc export
                          <ArrowUpRight size={15} />
                        </button>
                        <button
                          className="text-button"
                          onClick={() =>
                            act(() =>
                              load(
                                JSON.stringify(demo),
                                "Example workspace",
                                true,
                              ),
                            )
                          }
                        >
                          Explore an example <ArrowRight size={14} />
                        </button>
                      </div>
                      <small>No accounts. No uploads. No changes to Arc.</small>
                    </div>
                    <div className="journey-art" aria-hidden="true">
                      <div className="art-label">
                        A FAMILIAR WORKSPACE. A FRESH START.
                      </div>
                      <div className="mini-window arc-window">
                        <div className="window-dots">
                          <i />
                          <i />
                          <i />
                          <span>your workspace</span>
                        </div>
                        <div className="mini-sidebar">
                          <b>✳ Work</b>
                          <span>▸ Product</span>
                          <span>▸ Reading list</span>
                          <span>⌁ The good stuff</span>
                        </div>
                        <div className="window-symbol">
                          <BrowserIcon type="arc" />
                        </div>
                      </div>
                      <div className="journey-line">
                        <div />
                        <span>
                          <ArrowRight size={22} />
                        </span>
                        <div />
                      </div>
                      <div className="mini-window firefox-window">
                        <div className="window-dots">
                          <i />
                          <i />
                          <i />
                          <span>right where you left it</span>
                        </div>
                        <div className="mini-tabs">
                          <b>Product</b>
                          <b>Reading list</b>
                          <b>+</b>
                        </div>
                        <div className="window-symbol">
                          <BrowserIcon type="firefox" />
                          <span>Room for what’s next.</span>
                        </div>
                      </div>
                      <div className="art-badge">
                        <CheckCircle2 size={15} /> Your organization comes
                        along.
                      </div>
                    </div>
                  </section>
                  <div className="section-title">
                    <h3>A thoughtful move, from start to finish.</h3>
                    <span>THE WAY IT SHOULD WORK</span>
                  </div>
                  <div className="feature-grid">
                    {[
                      [
                        Layers,
                        "Your spaces, preserved",
                        "Map Spaces to tab groups or windows. Keep nested folders in bookmarks.",
                      ],
                      [
                        Unplug,
                        "Your profiles, separate",
                        "Pair the Firefox profiles you choose. You may need to sign in to websites again.",
                      ],
                      [
                        ShieldCheck,
                        "Your source, untouched",
                        "Preview first. Keep a portable backup. Arc stays exactly as it was.",
                      ],
                    ].map(([Icon, title, description], i) => (
                      <section className="feature" key={title}>
                        <div>
                          <Icon size={20} />
                          <span>0{i + 1}</span>
                        </div>
                        <h3>{title}</h3>
                        <p>{description}</p>
                      </section>
                    ))}
                  </div>
                  <div className="import-note">
                    <FileJson size={20} />
                    <p>
                      <strong>Start with an export.</strong> In Arc, open
                      Settings → Advanced → Export Data. Choose HTML, an Arc
                      Bridge backup, or a manually selected StorableSidebar.json
                      snapshot.
                    </p>
                    <span>20 MB max</span>
                  </div>
                </>
              )}
              {step === 1 && source && (
                <>
                  <div className="source-strip">
                    <div className="file-icon">
                      <FileJson size={22} />
                    </div>
                    <div>
                      <strong>{fileName}</strong>
                      <p>
                        {source.adapter}{" "}
                        {isDemo && (
                          <span className="example-pill">
                            SYNTHETIC EXAMPLE
                          </span>
                        )}
                      </p>
                    </div>
                    <button className="text-button" onClick={open}>
                      Choose another file
                    </button>
                  </div>
                  <div className="summary-grid">
                    {[
                      [archive.profiles.length, "Source sections"],
                      [totalSpaces(archive), "Spaces"],
                      [tabsOf(archive).length, "Tabs found"],
                      [chosenCount, "Selected to move"],
                    ].map(([value, label]) => (
                      <div key={label}>
                        <strong>{value}</strong>
                        <span>{label}</span>
                      </div>
                    ))}
                  </div>
                  {source.warnings.map((w) => (
                    <div className="subtle-warning" key={w}>
                      <TriangleAlert size={15} />
                      {w}
                    </div>
                  ))}
                  <div className="card">
                    <div className="card-title">
                      <div>
                        <h3>Your workspace inventory</h3>
                        <p>
                          Rename source profile labels to group sections that
                          truly share one profile.
                        </p>
                      </div>
                      <label className="search">
                        <Search size={15} />
                        <input
                          aria-label="Search tabs"
                          placeholder="Find a tab…"
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                        />
                      </label>
                    </div>
                    {archive.profiles.map((p) => (
                      <div className="source-profile" key={p.id}>
                        <div className="profile-heading">
                          <label className="select-all">
                            <input
                              type="checkbox"
                              aria-label={`Select ${p.name}`}
                              checked={p.spaces
                                .flatMap((s) => s.tabs)
                                .every((t) => selected.has(t.id))}
                              onChange={() =>
                                toggle(
                                  p.spaces.flatMap((s) =>
                                    s.tabs.map((t) => t.id),
                                  ),
                                )
                              }
                            />
                            <span className="profile-avatar">{p.name[0]}</span>
                          </label>
                          <div>
                            <strong>{p.name}</strong>
                            <small>
                              {p.spaces.length} Space
                              {p.spaces.length === 1 ? "" : "s"} ·{" "}
                              {p.spaces.reduce((n, s) => n + s.tabs.length, 0)}{" "}
                              tabs
                            </small>
                          </div>
                          <label className="group-label">
                            Source profile label
                            <input
                              aria-label={`Source profile label for ${p.name}`}
                              value={grouping[p.id] || ""}
                              maxLength={100}
                              onChange={(e) =>
                                setGrouping({
                                  ...grouping,
                                  [p.id]: e.target.value,
                                })
                              }
                            />
                          </label>
                        </div>
                        {p.spaces.map((s) => (
                          <div className="space-section" key={s.id}>
                            <button
                              className="space-toggle"
                              onClick={() =>
                                setExpanded((prev) => {
                                  const next = new Set(prev);
                                  next.has(s.id)
                                    ? next.delete(s.id)
                                    : next.add(s.id);
                                  return next;
                                })
                              }
                            >
                              {expanded.has(s.id) || query ? (
                                <ChevronDown size={14} />
                              ) : (
                                <ChevronRight size={14} />
                              )}
                              <Folder size={15} />
                              <strong>{s.name}</strong>
                              <span>
                                {
                                  s.tabs.filter((t) => selected.has(t.id))
                                    .length
                                }
                                /{s.tabs.length}
                              </span>
                            </button>
                            {(expanded.has(s.id) || query) && (
                              <div className="tab-list">
                                {s.tabs
                                  .filter(
                                    (t) =>
                                      !query ||
                                      `${t.title} ${t.url} ${t.folder.join("/")}`
                                        .toLowerCase()
                                        .includes(query.toLowerCase()),
                                  )
                                  .map((t) => (
                                    <label className="tab-row" key={t.id}>
                                      <input
                                        type="checkbox"
                                        checked={selected.has(t.id)}
                                        onChange={() => toggle([t.id])}
                                      />
                                      <span className="tab-favicon">
                                        {t.title[0]}
                                      </span>
                                      <div>
                                        <strong>{t.title}</strong>
                                        <small>
                                          {t.folder.length
                                            ? `${t.folder.join(" / ")} · `
                                            : ""}
                                          {t.url}
                                        </small>
                                      </div>
                                      {t.pinned && <Pin size={13} />}
                                    </label>
                                  ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                  <div className="wizard-footer">
                    <button className="text-button" onClick={saveArchive}>
                      <Download size={14} />
                      Save portable backup
                    </button>
                    <div>
                      <span>{chosenCount} tabs selected</span>
                      <button
                        className="button primary"
                        disabled={!chosenCount || !!selectionError}
                        onClick={() => setStep(2)}
                      >
                        Map Firefox profiles
                        <ArrowRight size={15} />
                      </button>
                    </div>
                  </div>
                  {selectionError && (
                    <p className="inline-error">{selectionError}</p>
                  )}
                </>
              )}
              {step === 2 && chosen && (
                <>
                  <div className="connection-banner">
                    <span
                      className={
                        "status-orb " + (online.length ? "online" : "")
                      }
                    />
                    <div>
                      <strong>
                        {online.length
                          ? `${online.length} Firefox receiver${online.length === 1 ? "" : "s"} ready`
                          : "Let’s connect Firefox."}
                      </strong>
                      <p>
                        {native
                          ? "Install the bridge, then enable the companion in each destination Firefox profile."
                          : "You’re in the browser preview. The desktop app connects directly; migration files also work with the companion."}
                      </p>
                    </div>
                    <button
                      className="button secondary"
                      onClick={() => setView("receivers")}
                    >
                      Set up receivers
                      <ArrowUpRight size={14} />
                    </button>
                  </div>
                  <div className="mapping-list">
                    {chosen.profiles.map((p, i) => (
                      <section className="mapping-card" key={p.id}>
                        <div className="mapping-source">
                          <span className={"profile-avatar tone-" + (i % 3)}>
                            {p.name[0]}
                          </span>
                          <div>
                            <h3>{p.name}</h3>
                            <p>
                              {p.spaces.length} Spaces ·{" "}
                              {p.spaces.reduce((n, s) => n + s.tabs.length, 0)}{" "}
                              selected tabs
                            </p>
                          </div>
                        </div>
                        <ArrowRight className="mapping-arrow" size={21} />
                        <div className="mapping-target">
                          <label>
                            Destination Firefox profile
                            <select
                              aria-label={`Firefox receiver for ${p.name}`}
                              value={
                                online.some(
                                  (r) => r.id === mappings[p.id]?.profileId,
                                )
                                  ? mappings[p.id].profileId
                                  : ""
                              }
                              onChange={(e) =>
                                updateMapping(p.id, {
                                  profileId: e.target.value,
                                })
                              }
                            >
                              <option value="">
                                Choose a paired receiver…
                              </option>
                              {online.map((r) => (
                                <option key={r.id} value={r.id}>
                                  {r.label}
                                </option>
                              ))}
                            </select>
                          </label>
                          <details>
                            <summary>Or use a migration file</summary>
                            <label>
                              Paste the ID from the companion
                              <input
                                aria-label={`Receiver ID for ${p.name}`}
                                placeholder="Receiver UUID"
                                value={mappings[p.id]?.profileId || ""}
                                onChange={(e) =>
                                  updateMapping(p.id, {
                                    profileId: e.target.value,
                                  })
                                }
                              />
                            </label>
                            <small>
                              The companion in that profile checks this ID
                              before importing.
                            </small>
                          </details>
                          <label>
                            Organize Spaces as
                            <select
                              aria-label={`Space layout for ${p.name}`}
                              value={mappings[p.id]?.spaces || "groups"}
                              onChange={(e) =>
                                updateMapping(p.id, { spaces: e.target.value })
                              }
                            >
                              <option value="groups">
                                Tab groups (windows if unavailable)
                              </option>
                              <option value="windows">Separate windows</option>
                            </select>
                          </label>
                        </div>
                      </section>
                    ))}
                  </div>
                  <div className="subtle-warning">
                    <ShieldCheck size={17} />
                    Two source profiles cannot share one receiver. If sections
                    belong together, explicitly group them in Organize first.
                  </div>
                  <div className="wizard-footer">
                    <button className="text-button" onClick={() => setStep(1)}>
                      <ArrowLeft size={14} />
                      Back to inventory
                    </button>
                    <button
                      className="button primary"
                      onClick={review}
                      disabled={busy}
                    >
                      Review migration
                      <ArrowRight size={15} />
                    </button>
                  </div>
                </>
              )}
              {step === 3 && (
                <>
                  {skipped.length > 0 && (
                    <div className="subtle-warning">
                      <TriangleAlert size={16} />
                      <details>
                        <summary>
                          {skipped.length} unsupported links will be skipped
                        </summary>
                        {skipped.map((s) => (
                          <p key={s.sourceId}>
                            {tabsOf(chosen).find((t) => t.id === s.sourceId)
                              ?.title || s.sourceId}
                            : {s.reason}
                          </p>
                        ))}
                      </details>
                    </div>
                  )}
                  <div className="review-card">
                    <div className="review-route">
                      <BrowserIcon type="arc" />
                      <div className="route-line">
                        <span>
                          {jobs.reduce((n, j) => n + j.operations.length, 0)}{" "}
                          TABS · {jobs.length} PROFILES
                        </span>
                        <div>
                          <i />
                          <ArrowRight size={18} />
                        </div>
                      </div>
                      <BrowserIcon type="firefox" />
                    </div>
                    <h2>A new home for your workspace.</h2>
                    <p>
                      Tab order and pins are preserved within Firefox’s layout
                      rules. Nested folders become bookmark folders. Pinned tabs
                      sit outside tab groups.
                    </p>
                    <div className="review-rows">
                      {jobs.map((j) => (
                        <div key={j.id}>
                          <span>
                            <strong>{j.sourceName}</strong>
                            <small>
                              {j.operations.length} tabs ·{" "}
                              {new Set(j.operations.map((o) => o.spaceId)).size}{" "}
                              Spaces
                            </small>
                          </span>
                          <ArrowRight size={16} />
                          <span>
                            <strong>
                              {state.receivers.find(
                                (r) => r.id === j.targetProfileId,
                              )?.label || "File transfer receiver"}
                            </strong>
                            <small>{j.targetProfileId}</small>
                          </span>
                          <button
                            className="text-button"
                            onClick={() =>
                              act(async () => {
                                await download(
                                  `arc-bridge-${j.sourceName.replace(/[^a-zA-Z0-9-]/g, "-")}.json`,
                                  JSON.stringify(j, null, 2),
                                );
                                setNotice(
                                  "Migration file exported. Import it using the companion in the matching Firefox profile.",
                                );
                              })
                            }
                          >
                            <Download size={14} />
                            Migration file
                          </button>
                        </div>
                      ))}
                    </div>
                    <div className="review-notes">
                      <p>
                        <Check size={14} />
                        Existing Firefox tabs and bookmarks stay intact.
                      </p>
                      <p>
                        <Check size={14} />
                        Arc is never modified.
                      </p>
                      <p>
                        <TriangleAlert size={14} />
                        Passwords, logins, cookies, extensions, and browser
                        settings do not move.
                      </p>
                      <p>
                        <Clock size={14} />
                        You can pause, resume, or undo unchanged imported items.
                      </p>
                    </div>
                    <label className="consent">
                      <input
                        type="checkbox"
                        checked={confirmed}
                        onChange={(e) => setConfirmed(e.target.checked)}
                      />
                      I reviewed these profile mappings and want to create these
                      tabs and bookmarks in Firefox.
                    </label>
                    <button
                      className="button primary large"
                      disabled={!confirmed || busy || !native}
                      onClick={() =>
                        act(async () => {
                          setState(await native.stage(jobs));
                          setActiveJobs(jobs.map((j) => j.id));
                          setStep(4);
                        })
                      }
                    >
                      {busy ? "Preparing migration…" : "Migrate to Firefox"}
                      <ArrowRight size={17} />
                    </button>
                    {!native && (
                      <p className="browser-hint">
                        Direct migration runs in the desktop app. Export the
                        files above for the companion instead.
                      </p>
                    )}
                  </div>
                  <div className="wizard-footer">
                    <button className="text-button" onClick={() => setStep(2)}>
                      <ArrowLeft size={14} />
                      Change mappings
                    </button>
                    <div>
                      <button className="text-button" onClick={saveArchive}>
                        <Archive size={14} />
                        Portable backup
                      </button>
                      <button className="text-button" onClick={saveHTML}>
                        <Download size={14} />
                        Bookmark HTML
                      </button>
                    </div>
                  </div>
                </>
              )}
              {step === 4 && (
                <>
                  <div className="card progress-card">
                    <span className="progress-icon">
                      <ArrowUpRight size={28} />
                    </span>
                    <h2>Moving at your pace.</h2>
                    <p>
                      Keep the destination Firefox profiles open with the
                      companion enabled. Unpinned tabs are created without
                      loading them immediately.
                    </p>
                    {currentReports.map((j) => (
                      <JobRow
                        key={j.id}
                        job={j}
                        onControl={(action) =>
                          act(async () =>
                            setState(await native.control(j.id, action)),
                          )
                        }
                      />
                    ))}
                    <button
                      className="button secondary"
                      onClick={() => setView("history")}
                    >
                      View migration history
                      <ArrowRight size={14} />
                    </button>
                  </div>
                </>
              )}
            </>
          )}
          {view === "receivers" && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">A HOME FOR EVERY PROFILE</div>
                  <h1>Meet your receivers.</h1>
                  <p>
                    Each companion installation belongs to one Firefox profile.
                    Name them so you know where everything goes.
                  </p>
                </div>
              </div>
              <div className="setup-grid">
                <section className="card setup-card">
                  <span className="setup-number">01</span>
                  <h2>Install the local bridge</h2>
                  <p>
                    The bridge lets the Firefox companion receive only
                    migrations you confirm in this app. It does not read browser
                    databases.
                  </p>
                  <button
                    className="button primary"
                    disabled={!native || busy}
                    onClick={() =>
                      act(async () => {
                        setState(await native.install());
                        setNotice(
                          "Local bridge installed. Open or reconnect the Firefox companion.",
                        );
                      })
                    }
                  >
                    <Link2 size={15} />
                    {state.bridgeInstalled
                      ? "Reinstall bridge"
                      : "Install local bridge"}
                  </button>
                  <small>
                    {native
                      ? state.bridgeInstalled
                        ? "Bridge manifest found on this Mac."
                        : "One-time setup on this Mac."
                      : "Available in the desktop app. File transfer works without the bridge."}
                  </small>
                </section>
                <section className="card setup-card">
                  <span className="setup-number">02</span>
                  <h2>Add the Firefox companion</h2>
                  <p>
                    In each destination profile, open{" "}
                    <code>about:debugging#/runtime/this-firefox</code>, choose
                    Load Temporary Add-on, and select the companion’s{" "}
                    <code>manifest.json</code>.
                  </p>
                  <button
                    className="button secondary"
                    disabled={!native}
                    onClick={() => act(() => native.extension())}
                  >
                    <FolderOpen size={15} />
                    Open companion folder
                  </button>
                  <small>
                    This beta add-on is unsigned. Temporary add-ons must be
                    loaded again after Firefox restarts.
                  </small>
                </section>
                <section className="card setup-card">
                  <span className="setup-number">03</span>
                  <h2>Give each profile a name</h2>
                  <p>
                    Click the companion in Firefox, enter a name such as Work or
                    Personal, enable desktop migrations, then Save & connect.
                  </p>
                  <button
                    className="text-button"
                    onClick={() =>
                      native
                        ? act(() => native.help())
                        : window.open(
                            "https://support.mozilla.org/en-US/kb/profile-management",
                            "_blank",
                            "noopener",
                          )
                    }
                  >
                    How Firefox profiles work
                    <ArrowUpRight size={14} />
                  </button>
                  <small>
                    Profiles isolate logins. Containers are not full browser
                    profiles.
                  </small>
                </section>
              </div>
              <div className="section-title">
                <h3>Paired Firefox profiles</h3>
                <button className="text-button" onClick={refresh}>
                  <RefreshCw size={13} />
                  Refresh
                </button>
              </div>
              {state.receivers.length ? (
                <div className="receiver-grid">
                  {state.receivers.map((r) => (
                    <section className="card receiver-card" key={r.id}>
                      <BrowserIcon type="firefox" />
                      <div>
                        <h3>{r.label}</h3>
                        <p>
                          {r.online
                            ? r.enabled
                              ? "Ready for migration"
                              : "Connected · receiving disabled"
                            : "Offline · open this Firefox profile"}
                        </p>
                        <code>{r.id}</code>
                        <small>
                          {r.groups
                            ? "Tab groups available"
                            : "Spaces will use separate windows if groups are unavailable"}
                        </small>
                      </div>
                      <span
                        className={
                          "status-orb " +
                          (r.online && r.enabled ? "online" : "")
                        }
                      />
                    </section>
                  ))}
                </div>
              ) : (
                <div className="card empty">
                  <Link2 size={30} />
                  <h3>No profiles paired yet.</h3>
                  <p>
                    Follow the setup above, or use migration files and the
                    receiver ID shown in the companion.
                  </p>
                </div>
              )}
              {source && (
                <div className="wizard-footer">
                  <span />
                  <button
                    className="button primary"
                    onClick={() => {
                      setView("migration");
                      setStep(2);
                    }}
                  >
                    Back to profile mapping
                    <ArrowRight size={15} />
                  </button>
                </div>
              )}
            </>
          )}
          {view === "history" && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">EVERY MOVE, ACCOUNTED FOR</div>
                  <h1>Your migration history.</h1>
                  <p>
                    Pick up where you left off. Changed or moved browser items
                    are kept when you undo.
                  </p>
                </div>
                <button
                  className="button secondary"
                  disabled={!native || !state.jobs.length}
                  onClick={() => act(() => native.report())}
                >
                  <Download size={15} />
                  Export report
                </button>
              </div>
              {state.jobs.length ? (
                <div className="card history-list">
                  {state.jobs.map((j) => (
                    <JobRow
                      key={j.id}
                      job={j}
                      onControl={(action) =>
                        act(async () => {
                          if (
                            action === "undo" &&
                            !confirm(
                              "Undo unchanged tabs and bookmarks created by this migration? Changed items will be kept.",
                            )
                          )
                            return;
                          setState(await native.control(j.id, action));
                        })
                      }
                    />
                  ))}
                </div>
              ) : (
                <div className="card empty">
                  <Clock size={32} />
                  <h3>A clean slate.</h3>
                  <p>
                    Your desktop transfers will appear here. File-import history
                    is shown inside the Firefox companion.
                  </p>
                  <button
                    className="text-button"
                    onClick={() => setView("migration")}
                  >
                    Start a migration
                    <ArrowRight size={14} />
                  </button>
                </div>
              )}
            </>
          )}
          <footer>
            <Brand small />
            <span>
              Built for moving forward. Designed to leave nothing behind.
            </span>
            <span>
              <ShieldCheck size={12} /> On-device processing
            </span>
          </footer>
        </main>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept=".html,.htm,.json"
        hidden
        onChange={(e) => {
          void fileInput(e.target.files[0]);
          e.target.value = "";
        }}
      />
    </div>
  );
}
function JobRow({ job: j, onControl }) {
  return (
    <div className="job-row">
      <div className={"job-state " + j.status}>
        {j.status === "completed" ? (
          <Check size={20} />
        ) : j.status === "failed" || j.status === "needs-review" ? (
          <TriangleAlert size={20} />
        ) : (
          <ArrowUpRight size={20} />
        )}
      </div>
      <div className="job-info">
        <h3>
          {j.receiverLabel || "Firefox profile"}
          <span>{j.status}</span>
        </h3>
        <p>
          {j.done}/{j.total} tabs · {new Date(j.createdAt).toLocaleString()}
          {j.preserved ? ` · ${j.preserved} changed items kept` : ""}
        </p>
        <div className="progress-track">
          <i
            style={{
              width: `${j.total ? Math.min(100, (j.done / j.total) * 100) : 0}%`,
            }}
          />
        </div>
        {j.error && <p className="inline-error">{j.error}</p>}
        {j.notes?.map((n) => (
          <small key={n}>{n}</small>
        ))}
        {j.cancelRequested && j.status !== "cancelled" && (
          <small>Pause requested. Waiting for the companion.</small>
        )}
      </div>
      <div className="job-actions">
        {["queued", "running"].includes(j.status) ? (
          <button
            className="button secondary"
            onClick={() => onControl("cancel")}
          >
            <Pause size={13} />
            Pause
          </button>
        ) : (
          <>
            <button
              className="text-button"
              disabled={j.status === "undone" || j.status === "needs-review"}
              onClick={() => onControl("resume")}
            >
              <RefreshCw size={13} />
              Resume
            </button>
            <button className="text-button" onClick={() => onControl("undo")}>
              <RotateCcw size={13} />
              Undo
            </button>
          </>
        )}
      </div>
    </div>
  );
}
