"use client";

import { useState, useMemo, useId } from "react";
import {
  ChevronRight, RefreshCw, ExternalLink, GitCommit, GitMerge,
  Users, Layers, Calendar,
} from "lucide-react";
import { DateRangeDropdown } from "../shared";
import { useCommitHistory } from "@/hooks/useCommitHistory";
import { calculateDateRange, getDateRangeLabel } from "@/utils/dateHelpers";

const MONTHS_FULL = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const MONTHS_ABBR = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const DEFAULT_REPO = "nmbroome/cedar-grove-analytics";

const FEATURE_RE =
  /^(add|added|implement|introduce|create|build|new|redesign|replace|migrate|launch)\b/i;
const FIX_RE = /^(fix|fixed|harden|secure|resolve|patch)\b/i;

// Ordered project/category classifier — first matching rule wins. Heuristic and
// easy to tune; mirrors the app's functional domains.
// Ordered most-specific → most-generic so domain keywords win over catch-alls.
// Stems intentionally omit a trailing \b so plurals/gerunds match
// ("download" → "downloads", "styl" → "styling", "format" → "formatting").
const CATEGORY_RULES = [
  ["Utilization & Targets", /\b(utiliz|target|ooo|holiday|pro[- ]?rat|capacity|quarterly|variance|business[- ]day|predictive|time[- ]?off|calendar)/i],
  ["Clients", /\bclient|ideal|\bquiet/i],
  ["Billing & Invoices", /\b(billing|invoice|payment|reminder|mercury|reconcil|revenue|mark[- ]paid|kpi)/i],
  ["Document Downloads", /\b(download|drive|document|folder)/i],
  ["Matters", /\bmatter/i],
  ["Transactions", /\btransaction/i],
  ["Ops", /\b(ops|sunburst)\b/i],
  ["Calculations & Tooltips", /\b(tooltip|calc|undercount|audit|sanity)/i],
  ["Team & Attorneys", /\b(attorney|team member|rate|role|hidden|earning)/i],
  ["Data & Sync", /\b(firebase|firestore|schema|data format|query)/i],
  ["Security & Auth", /\b(auth|login|sign[- ]?in|admin|permission|sec-\d|security|token|oauth|domain|redirect|leak)/i],
  ["Setup & Platform", /\b(initial commit|migrate|next\.?js|vite|readme|eslint|lint|refactor)/i],
  ["UI & Styling", /\b(ui|styl|chart|label|layout|navigation|date range|sort|format|overflow|spacing|header|page|view|display|dashboard|frontend|component|small fix|minor)/i],
];

function classify(c) {
  if (c.isMerge) return "Merges & PRs";
  for (const [label, re] of CATEGORY_RULES) if (re.test(c.message)) return label;
  return "Other";
}

// Commit "type" — conveyed with a TEXT badge (not color alone) for WCAG 1.4.1.
function commitType(c) {
  if (c.isMerge) return { label: "Merge", cls: "bg-meta-light text-meta-text" };
  if (FEATURE_RE.test(c.message))
    return { label: "Feature", cls: "bg-status-success-light text-status-success-text" };
  if (FIX_RE.test(c.message))
    return { label: "Fix", cls: "bg-status-warning-light text-status-warning-text" };
  return { label: "Update", cls: "bg-gray-100 text-gray-700" };
}

function formatDay(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${MONTHS_ABBR[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

function slug(s) {
  return String(s).replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase();
}

function sortByDateDesc(a, b) {
  return new Date(b.date) - new Date(a.date);
}

// Build a two-level grouped tree: primary -> secondary -> commits.
function buildTree(commits, groupBy) {
  const annotated = commits.map((c) => {
    const d = new Date(c.date);
    const valid = !Number.isNaN(d.getTime());
    const monthKey = valid
      ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
      : "0000-00";
    return {
      ...c,
      monthKey,
      monthLabel: valid ? `${MONTHS_FULL[d.getMonth()]} ${d.getFullYear()}` : "Undated",
      monthShort: valid ? `${MONTHS_ABBR[d.getMonth()]} '${String(d.getFullYear()).slice(2)}` : "—",
      category: classify(c),
    };
  });

  const byMonth = groupBy === "month";
  const primKey = byMonth ? "monthKey" : "category";
  const primLabel = byMonth ? "monthLabel" : "category";
  const primShort = byMonth ? "monthShort" : "category";
  const secKey = byMonth ? "category" : "monthKey";
  const secLabel = byMonth ? "category" : "monthLabel";

  const prims = new Map();
  for (const c of annotated) {
    const pk = c[primKey];
    if (!prims.has(pk)) {
      prims.set(pk, { key: pk, label: c[primLabel], short: c[primShort], commits: [], secs: new Map() });
    }
    const p = prims.get(pk);
    p.commits.push(c);
    const sk = c[secKey];
    if (!p.secs.has(sk)) p.secs.set(sk, { key: sk, label: c[secLabel], commits: [] });
    p.secs.get(sk).commits.push(c);
  }

  let list = [...prims.values()].map((p) => ({
    key: p.key,
    label: p.label,
    short: p.short,
    count: p.commits.length,
    featureCount: p.commits.filter((c) => FEATURE_RE.test(c.message) && !c.isMerge).length,
    children: [...p.secs.values()].map((s) => ({
      key: s.key,
      label: s.label,
      count: s.commits.length,
      commits: [...s.commits].sort(sortByDateDesc),
    })),
  }));

  const byMonthDesc = (a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0);
  const byCountDesc = (a, b) => b.count - a.count || (a.label < b.label ? -1 : 1);

  if (byMonth) {
    list.sort(byMonthDesc);
    list.forEach((p) => p.children.sort(byCountDesc));
  } else {
    list.sort(byCountDesc);
    list.forEach((p) => p.children.sort(byMonthDesc));
  }
  return list;
}

function StatChip({ icon: Icon, label, value }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-cg-white border border-gray-300 rounded-lg shadow-sm">
      <Icon className="w-4 h-4 text-cg-dark" aria-hidden="true" />
      <span className="text-lg font-bold text-cg-black leading-none">{value}</span>
      <span className="text-xs text-gray-700">{label}</span>
    </div>
  );
}

export default function TechTeamView() {
  const { commits, loading, error, fetchedAt, meta, refresh } = useCommitHistory();
  const baseId = useId();

  const [dateRange, setDateRange] = useState("all-time");
  const [customDateStart, setCustomDateStart] = useState("");
  const [customDateEnd, setCustomDateEnd] = useState("");
  const [showDateDropdown, setShowDateDropdown] = useState(false);
  const [groupBy, setGroupBy] = useState("month"); // 'month' | 'project'
  const [expanded, setExpanded] = useState(() => new Set());

  const repo = meta.repo || DEFAULT_REPO;

  // Filter the CACHED commits by range — useMemo, so changing the range only
  // re-filters in memory and never re-pulls from GitHub.
  const filteredCommits = useMemo(() => {
    if (!commits || commits.length === 0) return [];
    if (dateRange === "all-time") return commits;
    const { startDate, endDate } = calculateDateRange(dateRange, customDateStart, customDateEnd, []);
    const startMs = startDate.getTime();
    const endMs = endDate.getTime();
    return commits.filter((c) => {
      if (!c.date) return false;
      const t = new Date(c.date).getTime();
      return t >= startMs && t <= endMs;
    });
  }, [commits, dateRange, customDateStart, customDateEnd]);

  const tree = useMemo(() => buildTree(filteredCommits, groupBy), [filteredCommits, groupBy]);
  const maxCount = useMemo(
    () => tree.reduce((m, p) => Math.max(m, p.count), 0),
    [tree]
  );

  const summary = useMemo(() => {
    const authors = new Set();
    let merges = 0;
    let minD = null;
    let maxD = null;
    for (const c of filteredCommits) {
      if (c.author) authors.add(c.author);
      if (c.isMerge) merges += 1;
      const t = new Date(c.date).getTime();
      if (!Number.isNaN(t)) {
        if (minD === null || t < minD) minD = t;
        if (maxD === null || t > maxD) maxD = t;
      }
    }
    return { commitCount: filteredCommits.length, authorCount: authors.size, merges, minD, maxD };
  }, [filteredCommits]);

  // When the grouping/filter changes the set of primary groups, reset to the
  // first group expanded (most recent month / largest project). This adjusts
  // state DURING render — the React-recommended alternative to a setState-in-
  // effect (avoids the cascading-render lint rule the codebase enforces).
  const primarySignature = tree.map((p) => p.key).join("|");
  const [prevSignature, setPrevSignature] = useState(null);
  if (primarySignature !== prevSignature) {
    setPrevSignature(primarySignature);
    setExpanded(tree.length ? new Set([`p:${tree[0].key}`]) : new Set());
  }

  const isOpen = (key) => expanded.has(key);
  const toggle = (key) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const expandAll = () => {
    const next = new Set();
    for (const p of tree) {
      next.add(`p:${p.key}`);
      for (const s of p.children) next.add(`s:${p.key}:${s.key}`);
    }
    setExpanded(next);
  };
  const collapseAll = () => setExpanded(new Set());

  const prefersReducedMotion =
    typeof window !== "undefined" &&
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const openAndScrollTo = (pkey) => {
    setExpanded((prev) => new Set(prev).add(`p:${pkey}`));
    if (typeof document !== "undefined") {
      const el = document.getElementById(`${baseId}-prim-${slug(pkey)}`);
      if (el) el.scrollIntoView({ behavior: prefersReducedMotion ? "auto" : "smooth", block: "start" });
    }
  };

  const dateRangeLabel = getDateRangeLabel(dateRange, customDateStart, customDateEnd);
  const headingId = `${baseId}-heading`;

  const groupNoun = groupBy === "month" ? "months" : "projects";
  const childNoun = groupBy === "month" ? "projects" : "months";

  return (
    <section aria-labelledby={headingId} className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id={headingId} className="text-xl font-bold text-cg-black">
            Development Timeline
          </h2>
          <p className="text-sm text-gray-700 mt-0.5">
            Commit history, grouped into expandable {groupBy === "month" ? "months and projects" : "projects and months"}.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Group-by toggle (accessible toggle-button group) */}
          <div role="group" aria-label="Group commits by" className="inline-flex rounded-lg border border-gray-300 overflow-hidden">
            {[
              { key: "month", label: "By month" },
              { key: "project", label: "By project" },
            ].map((opt) => {
              const active = groupBy === opt.key;
              return (
                <button
                  key={opt.key}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setGroupBy(opt.key)}
                  className={`px-3 py-2 text-sm font-medium min-h-[44px] focus:outline-none focus-visible:ring-2 focus-visible:ring-cg-green focus-visible:ring-offset-1 transition-colors ${
                    active ? "bg-cg-dark text-white" : "bg-cg-white text-cg-dark hover:bg-gray-100"
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-700" id={`${baseId}-range-label`}>
              Timeline range
            </span>
            <DateRangeDropdown
              dateRange={dateRange}
              setDateRange={setDateRange}
              customDateStart={customDateStart}
              setCustomDateStart={setCustomDateStart}
              customDateEnd={customDateEnd}
              setCustomDateEnd={setCustomDateEnd}
              showDropdown={showDateDropdown}
              setShowDropdown={setShowDateDropdown}
            />
          </div>

          <button
            type="button"
            onClick={refresh}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 min-h-[44px] bg-cg-white border border-gray-300 rounded-lg hover:bg-gray-100 transition-colors shadow-sm disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-cg-green focus-visible:ring-offset-1"
          >
            <RefreshCw className={`w-4 h-4 text-cg-dark ${loading ? "animate-spin motion-reduce:animate-none" : ""}`} aria-hidden="true" />
            <span className="text-sm font-medium text-cg-dark">Refresh</span>
          </button>
        </div>
      </div>

      {/* Live status — announced to screen readers when the filter changes */}
      <p role="status" aria-live="polite" className="text-sm text-gray-700">
        {loading && commits.length === 0
          ? "Loading commit history…"
          : `Showing ${summary.commitCount} commit${summary.commitCount === 1 ? "" : "s"} across ${tree.length} ${groupNoun} · ${dateRangeLabel}`}
      </p>

      {loading && commits.length === 0 ? (
        <div className="flex items-center justify-center py-24">
          <div className="inline-block animate-spin motion-reduce:animate-none rounded-full h-10 w-10 border-b-2 border-cg-green" aria-hidden="true" />
        </div>
      ) : error && commits.length === 0 ? (
        <div className="cg-card p-8 text-center max-w-xl mx-auto">
          <p className="text-status-danger-text text-lg font-medium mb-2">Couldn’t load commit history</p>
          <p className="text-cg-dark mb-4">{error}</p>
          <button
            type="button"
            onClick={refresh}
            className="px-4 py-2 min-h-[44px] bg-cg-green text-white rounded-lg hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-cg-green focus-visible:ring-offset-2"
          >
            Retry
          </button>
        </div>
      ) : (
        <>
          {error && (
            <div className="px-4 py-2 rounded-lg bg-status-warning-light text-status-warning-text text-sm flex items-center justify-between gap-3">
              <span>Showing cached data — couldn’t refresh: {error}</span>
              <button type="button" onClick={refresh} className="font-medium underline hover:no-underline whitespace-nowrap focus:outline-none focus-visible:ring-2 focus-visible:ring-status-warning-text rounded">
                Try again
              </button>
            </div>
          )}

          {/* Summary chips */}
          <div className="flex flex-wrap items-center gap-3">
            <StatChip icon={GitCommit} label="commits" value={summary.commitCount} />
            <StatChip icon={Users} label="contributors" value={summary.authorCount} />
            <StatChip icon={GitMerge} label="merges / PRs" value={summary.merges} />
            <StatChip icon={Layers} label={groupNoun} value={tree.length} />
            <StatChip
              icon={Calendar}
              label="span"
              value={summary.minD == null ? "—" : `${formatDay(summary.minD)} → ${formatDay(summary.maxD)}`}
            />
          </div>

          {tree.length === 0 ? (
            <div className="cg-card p-10 text-center">
              <p className="text-cg-dark text-lg mb-1">No commits in this range</p>
              <p className="text-gray-700 text-sm">Try a wider timeline range above.</p>
            </div>
          ) : (
            <>
              {/* Volume overview — accessible buttons that expand + scroll to a group */}
              <div className="cg-card p-4">
                <div className="flex items-end gap-2 overflow-x-auto pb-1" role="group" aria-label={`Commits per ${groupBy}`}>
                  {tree.map((p) => {
                    const h = maxCount ? Math.max(6, Math.round((64 * p.count) / maxCount)) : 6;
                    return (
                      <button
                        key={p.key}
                        type="button"
                        onClick={() => openAndScrollTo(p.key)}
                        title={`${p.label}: ${p.count} commits`}
                        aria-label={`${p.label}: ${p.count} commits. Expand.`}
                        className="group flex flex-col items-center justify-end gap-1 min-w-[44px] focus:outline-none focus-visible:ring-2 focus-visible:ring-cg-green focus-visible:ring-offset-1 rounded"
                      >
                        <span className="text-xs font-semibold text-cg-dark">{p.count}</span>
                        <span
                          className="w-7 rounded-t bg-cg-dark/70 group-hover:bg-cg-green transition-colors"
                          style={{ height: `${h}px` }}
                          aria-hidden="true"
                        />
                        <span className="text-[11px] text-gray-700 max-w-[60px] truncate">{p.short}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Expand/collapse all */}
              <div className="flex items-center gap-4 text-sm">
                <button type="button" onClick={expandAll} className="text-cg-dark underline hover:no-underline focus:outline-none focus-visible:ring-2 focus-visible:ring-cg-green rounded px-1">
                  Expand all
                </button>
                <button type="button" onClick={collapseAll} className="text-cg-dark underline hover:no-underline focus:outline-none focus-visible:ring-2 focus-visible:ring-cg-green rounded px-1">
                  Collapse all
                </button>
              </div>

              {/* Disclosure tree: primary → secondary → commits */}
              <ul role="list" className="space-y-3">
                {tree.map((p) => {
                  const pKey = `p:${p.key}`;
                  const pOpen = isOpen(pKey);
                  const pPanelId = `${baseId}-pp-${slug(p.key)}`;
                  const pBtnId = `${baseId}-prim-${slug(p.key)}`;
                  return (
                    <li key={p.key} className="cg-card overflow-hidden">
                      <h3 className="m-0">
                        <button
                          type="button"
                          id={pBtnId}
                          aria-expanded={pOpen}
                          aria-controls={pPanelId}
                          onClick={() => toggle(pKey)}
                          className="w-full flex items-center gap-3 px-4 py-3 min-h-[52px] text-left hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cg-green transition-colors"
                        >
                          <ChevronRight
                            className={`w-5 h-5 text-cg-dark shrink-0 transition-transform motion-reduce:transition-none ${pOpen ? "rotate-90" : ""}`}
                            aria-hidden="true"
                          />
                          <span className="font-semibold text-cg-black">{p.label}</span>
                          <span className="ml-auto text-sm text-gray-700 whitespace-nowrap">
                            {p.count} commit{p.count === 1 ? "" : "s"}
                            <span className="hidden sm:inline"> · {p.children.length} {childNoun}</span>
                            {p.featureCount > 0 && (
                              <span className="hidden md:inline"> · {p.featureCount} feature{p.featureCount === 1 ? "" : "s"}</span>
                            )}
                          </span>
                        </button>
                      </h3>

                      <div id={pPanelId} role="region" aria-labelledby={pBtnId} hidden={!pOpen} className="border-t border-gray-200">
                        {pOpen && (
                          <ul role="list" className="divide-y divide-gray-100">
                            {p.children.map((s) => {
                              const sKey = `s:${p.key}:${s.key}`;
                              const sOpen = isOpen(sKey);
                              const sPanelId = `${baseId}-sp-${slug(p.key)}-${slug(s.key)}`;
                              const sBtnId = `${baseId}-sec-${slug(p.key)}-${slug(s.key)}`;
                              return (
                                <li key={s.key}>
                                  <h4 className="m-0">
                                    <button
                                      type="button"
                                      id={sBtnId}
                                      aria-expanded={sOpen}
                                      aria-controls={sPanelId}
                                      onClick={() => toggle(sKey)}
                                      className="w-full flex items-center gap-3 pl-6 pr-4 py-2.5 min-h-[44px] text-left hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cg-green transition-colors"
                                    >
                                      <ChevronRight
                                        className={`w-4 h-4 text-cg-dark shrink-0 transition-transform motion-reduce:transition-none ${sOpen ? "rotate-90" : ""}`}
                                        aria-hidden="true"
                                      />
                                      <span className="font-medium text-cg-dark">{s.label}</span>
                                      <span className="ml-auto text-xs text-gray-700">{s.count}</span>
                                    </button>
                                  </h4>

                                  <div id={sPanelId} role="region" aria-labelledby={sBtnId} hidden={!sOpen}>
                                    {sOpen && (
                                      <ul role="list" className="pl-12 pr-4 py-1 space-y-1">
                                        {s.commits.map((c) => {
                                          const type = commitType(c);
                                          const url = `https://github.com/${repo}/commit/${c.sha}`;
                                          return (
                                            <li key={c.sha} className="flex items-start gap-2.5 py-1.5">
                                              <span className={`mt-0.5 shrink-0 px-1.5 py-0.5 rounded text-[11px] font-medium ${type.cls}`}>
                                                {type.label}
                                              </span>
                                              <div className="min-w-0">
                                                <p className="text-sm text-cg-dark break-words">{c.message}</p>
                                                <p className="text-xs text-gray-700 mt-0.5">
                                                  {c.author} · {formatDay(c.date)} ·{" "}
                                                  <a
                                                    href={url}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    aria-label={`View commit ${c.sha} by ${c.author} on GitHub (opens in a new tab)`}
                                                    className="inline-flex items-center gap-1 font-mono text-status-success-text hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-cg-green rounded px-0.5"
                                                  >
                                                    {c.sha}
                                                    <ExternalLink className="w-3 h-3" aria-hidden="true" />
                                                  </a>
                                                </p>
                                              </div>
                                            </li>
                                          );
                                        })}
                                      </ul>
                                    )}
                                  </div>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          )}

          {fetchedAt && (
            <p className="text-xs text-gray-700">
              Data as of {new Date(fetchedAt).toLocaleString()} · cached · source:{" "}
              <a
                href={`https://github.com/${repo}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-status-success-text hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-cg-green rounded px-0.5"
              >
                {repo}
              </a>
            </p>
          )}
        </>
      )}
    </section>
  );
}
