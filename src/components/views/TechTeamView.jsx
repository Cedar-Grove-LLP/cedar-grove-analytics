"use client";

import { useState, useMemo, useId, useRef, useEffect } from "react";
import {
  ChevronRight, RefreshCw, ExternalLink, GitCommit, GitMerge,
  Users, Layers, Calendar, Download, X, Search,
} from "lucide-react";
import { DateRangeDropdown } from "../shared";
import { TechTeamChevronTimeline } from "../charts";
import { useCommitHistory } from "@/hooks/useCommitHistory";
import { calculateDateRange, getDateRangeLabel } from "@/utils/dateHelpers";
import { DEFAULT_GITHUB_REPO } from "@/utils/constants";
import { formatShortDate } from "@/utils/formatters";
import { buildTree, annotateCommit } from "@/utils/commitTimeline";
import {
  svgElementToSvgBlob,
  svgElementToPngBlob,
  downloadBlob,
  buildTimelineExportFilename,
} from "@/utils/exportTimelineImage";

// Commit-type toggle-chip options for the filter bar (matches the labels
// utils/commitTimeline's commitType() produces, plus an "All" default).
const TYPE_FILTER_OPTIONS = ["All", "Feature", "Fix", "Update", "Merge"];

function StatChip({ icon: Icon, label, value }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-cg-white border border-gray-300 rounded-lg shadow-sm">
      <Icon className="w-4 h-4 text-cg-dark" aria-hidden="true" />
      <span className="text-lg font-bold text-cg-black leading-none">{value}</span>
      <span className="text-xs text-gray-700">{label}</span>
    </div>
  );
}

// Single source of truth for the Export PNG / SVG toolbar buttons — same
// disabled/aria-busy/spinner treatment for both, so they can't drift out of
// sync with each other again. `primary` gets the more prominent (white,
// shadowed) treatment; the secondary format is visually lighter.
function ExportButton({ format, label, primary, busy, onExport, disabled }) {
  return (
    <button
      type="button"
      onClick={() => onExport(format)}
      disabled={disabled}
      aria-busy={busy}
      className={`flex items-center gap-2 min-h-[44px] rounded-lg transition-colors disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-cg-green focus-visible:ring-offset-1 ${
        primary
          ? "px-4 py-2 bg-cg-white border border-gray-300 shadow-sm hover:bg-gray-100"
          : "px-3 py-2 bg-transparent border border-gray-300 hover:bg-gray-100"
      }`}
    >
      {busy ? (
        <span
          className="w-4 h-4 rounded-full border-2 border-cg-dark border-t-transparent animate-spin motion-reduce:animate-none"
          aria-hidden="true"
        />
      ) : (
        <Download className="w-4 h-4 text-cg-dark" aria-hidden="true" />
      )}
      <span className="text-sm font-medium text-cg-dark">{label}</span>
    </button>
  );
}

export default function TechTeamView() {
  const { commits, loading, error, fetchedAt, meta, partial, truncated, refresh } = useCommitHistory();
  const baseId = useId();

  const [dateRange, setDateRange] = useState("all-time");
  const [customDateStart, setCustomDateStart] = useState("");
  const [customDateEnd, setCustomDateEnd] = useState("");
  const [showDateDropdown, setShowDateDropdown] = useState(false);
  const [groupBy, setGroupBy] = useState("month"); // 'month' | 'project'
  const [expanded, setExpanded] = useState(() => new Set());

  // Filter-bar state (search / type / contributor). All three compose on top
  // of the date-range filter below into the single `filteredCommits` chain
  // that everything else in this view (tree, chevron graphic, stat chips,
  // export) reads — see that memo's comment. Purely in-memory: no filter
  // here ever triggers a network request.
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("All");
  const [contributorFilter, setContributorFilter] = useState("All");

  const repo = meta.repo || DEFAULT_GITHUB_REPO;

  // Classify (category + type) each commit exactly ONCE, keyed only on the
  // raw `commits` from useCommitHistory — which only changes on an actual
  // fetch/refresh, never on a filter/search edit. Every stage below re-slices
  // this same annotated array instead of re-running classify()/commitType()
  // (each up to 14 regex tests) on every keystroke.
  const annotatedCommits = useMemo(() => commits.map(annotateCommit), [commits]);

  // Stage 1 of the filter chain: date range. useMemo, so changing the range
  // only re-filters in memory and never re-pulls from GitHub. Also backs the
  // contributor <select>'s option list below (options are the authors
  // present in the DATE-filtered set, deliberately unaffected by the
  // search/type/contributor filters that come after it in the chain).
  const dateFilteredCommits = useMemo(() => {
    if (!annotatedCommits || annotatedCommits.length === 0) return [];
    // 'all-time' is short-circuited here (return everything, incl. undated
    // commits) BECAUSE calculateDateRange's all-time branch needs an allEntries
    // list to bound the start — without it, it clamps to the current month.
    // Keep this guard. Ranged filters can't place undated commits, so they are
    // excluded from non-all-time views by design.
    if (dateRange === "all-time") return annotatedCommits;
    const { startDate, endDate } = calculateDateRange(dateRange, customDateStart, customDateEnd, []);
    const startMs = startDate.getTime();
    const endMs = endDate.getTime();
    return annotatedCommits.filter((c) => {
      if (!c.date) return false;
      const t = new Date(c.date).getTime();
      return t >= startMs && t <= endMs;
    });
  }, [annotatedCommits, dateRange, customDateStart, customDateEnd]);

  const contributorOptions = useMemo(() => {
    const names = new Set();
    for (const c of dateFilteredCommits) if (c.author) names.add(c.author);
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [dateFilteredCommits]);

  // If the selected contributor falls out of contributorOptions (e.g. the
  // date range narrows to a window where they have no commits), reset the
  // filter to "All" rather than leaving a stale value applied while the
  // <select> — which only renders options from the current list — visually
  // desyncs from it (no option would match `value={contributorFilter}`).
  // Render-time adjustment: converges in exactly one extra render (same
  // pattern as the disclosure-tree reset below), not an effect, so it can't
  // trip the codebase's forbidden setState-in-effect lint rule.
  if (contributorFilter !== "All" && !contributorOptions.includes(contributorFilter)) {
    setContributorFilter("All");
  }

  const normalizedSearch = searchQuery.trim().toLowerCase();

  // Stages 2-4 of the filter chain: search -> type -> contributor, applied on
  // top of dateFilteredCommits. This IS the single filteredCommits used by
  // every other surface in this view (tree, chevron graphic, stat chips,
  // export) — there is no parallel/independent filtering anywhere else, so
  // all of them stay in sync automatically. Every stage just re-slices the
  // already-fetched `commits` array in memory; nothing here fetches.
  const filteredCommits = useMemo(() => {
    let list = dateFilteredCommits;
    if (normalizedSearch) {
      list = list.filter((c) => {
        const haystack = `${c.message || ""} ${c.author || ""} ${c.sha || ""}`.toLowerCase();
        return haystack.includes(normalizedSearch);
      });
    }
    if (typeFilter !== "All") {
      list = list.filter((c) => c.type.label === typeFilter);
    }
    if (contributorFilter !== "All") {
      list = list.filter((c) => c.author === contributorFilter);
    }
    return list;
  }, [dateFilteredCommits, normalizedSearch, typeFilter, contributorFilter]);

  const activeFilterCount =
    (normalizedSearch ? 1 : 0) + (typeFilter !== "All" ? 1 : 0) + (contributorFilter !== "All" ? 1 : 0);
  const filtersActive = activeFilterCount > 0;
  const clearFilters = () => {
    setSearchQuery("");
    setTypeFilter("All");
    setContributorFilter("All");
  };

  const tree = useMemo(() => buildTree(filteredCommits, groupBy), [filteredCommits, groupBy]);

  const summary = useMemo(() => {
    const authors = new Set();
    let merges = 0;
    let minD = null;
    let maxD = null;
    for (const c of filteredCommits) {
      if (c.author) authors.add(c.author);
      if (c.isMerge) merges += 1;
      // new Date(null) is epoch 0 (not NaN), so guard the null case explicitly.
      const t = c.date ? new Date(c.date).getTime() : NaN;
      if (!Number.isNaN(t)) {
        if (minD === null || t < minD) minD = t;
        if (maxD === null || t > maxD) maxD = t;
      }
    }
    return { commitCount: filteredCommits.length, authorCount: authors.size, merges, minD, maxD };
  }, [filteredCommits]);

  // The chevron graphic (and therefore its export) renders nothing when
  // there are no commits at all, OR when every filtered commit lacks a
  // parseable date (buildMonthBuckets excludes them, same criterion as
  // summary.minD above) — disable Export PNG/SVG proactively in both cases
  // instead of only surfacing it as a runtime error after the click.
  const graphicUnavailable = filteredCommits.length === 0 || summary.minD === null;

  // svgRef: forwarded to the chevron-timeline graphic's <svg> so a future
  // export/print feature can reach the live DOM node without changing the
  // chart component's prop contract.
  const timelineSvgRef = useRef(null);

  // Set by handleMonthActivate when the graphic is activated while grouped by
  // project (the target month isn't a top-level group in `tree` yet) —
  // consumed (and cleared, in the SAME render-time pass) by the reset below
  // once `tree` reflects groupBy having flipped to 'month'. Cleared promptly
  // so an unrelated LATER signature change (e.g. a date-range edit) can't
  // re-consume a stale pending key and force an unwanted re-expand.
  const [pendingMonthKey, setPendingMonthKey] = useState(null);
  // Handoff from the render-time reset to the deferred-scroll effect below.
  // Deliberately a *fresh object* each time (not a bare string) so
  // reactivating the same month twice in a row still produces a distinct
  // value the effect treats as a new request — see the ref-based de-dupe
  // there. State, not a ref: refs can't be read or written during render
  // (react-hooks/refs), only inside effects/handlers.
  const [scrollTarget, setScrollTarget] = useState(null); // { key } | null

  // Export-to-image state (Export PNG / SVG toolbar buttons below).
  // `exportFormat` is the in-flight format ('png' | 'svg' | null) — drives
  // aria-busy plus the per-button spinner, and disables both buttons while
  // any export is running. `exportError` is a dismissible failure banner;
  // `exportStatus` is a dedicated aria-live="polite" success announcement,
  // kept deliberately separate from the results-summary status line below
  // (see its own comment) so a single export action never updates more than
  // one live region.
  const [exportFormat, setExportFormat] = useState(null);
  const [exportError, setExportError] = useState(null);
  const [exportStatus, setExportStatus] = useState("");

  // Clear any stale export success/error banner once the exported record set
  // actually changes (filteredCommits is the single array every filter/range
  // stage above feeds into, so this fires regardless of which control caused
  // the change). Without this, a "couldn't export" banner from an old,
  // filtered-to-nothing state — or a stale "exported as PNG" success message
  // — would keep showing after the user adjusts filters and the graphic is
  // showing something different (or exportable again). Render-time
  // adjustment, same pattern as the disclosure-tree reset below.
  const [prevFilteredCommitsForExport, setPrevFilteredCommitsForExport] = useState(filteredCommits);
  if (filteredCommits !== prevFilteredCommitsForExport) {
    setPrevFilteredCommitsForExport(filteredCommits);
    if (exportError) setExportError(null);
    if (exportStatus) setExportStatus("");
  }

  // When the grouping/filter changes the set of primary groups, reset to the
  // first group expanded (most recent month / largest project) — or, when a
  // month activation from the chevron graphic is pending, to that month
  // instead. This adjusts state DURING render — the React-recommended
  // alternative to a setState-in-effect (avoids the cascading-render lint
  // rule the codebase enforces).
  const primarySignature = tree.map((p) => p.key).join("|");
  const [prevSignature, setPrevSignature] = useState(null);
  if (primarySignature !== prevSignature) {
    setPrevSignature(primarySignature);
    const pendingIndex = pendingMonthKey ? tree.findIndex((p) => p.key === pendingMonthKey) : -1;
    if (pendingIndex >= 0) {
      setExpanded(new Set([`p:${tree[pendingIndex].key}`]));
      setScrollTarget({ key: pendingMonthKey });
    } else {
      setExpanded(tree.length ? new Set([`p:${tree[0].key}`]) : new Set());
    }
    if (pendingMonthKey) setPendingMonthKey(null);
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

  const openAndScrollTo = (pkey, index) => {
    setExpanded((prev) => new Set(prev).add(`p:${pkey}`));
    if (typeof document !== "undefined") {
      const el = document.getElementById(`${baseId}-p${index}`);
      if (el) el.scrollIntoView({ behavior: prefersReducedMotion ? "auto" : "smooth", block: "start" });
    }
  };

  // Called by the chevron-timeline graphic's overlay buttons. If already
  // grouped by month, the target month is already a top-level group in
  // `tree` (it's built from the same filteredCommits), so expand + scroll
  // synchronously — same as the graphic replaces (the old volume-bar
  // buttons). Otherwise, flip to month grouping and let the render-time
  // reset above pick up `pendingMonthKey` once `tree` reflects it.
  const handleMonthActivate = (monthKey) => {
    if (groupBy === "month") {
      const pi = tree.findIndex((p) => p.key === monthKey);
      if (pi >= 0) openAndScrollTo(monthKey, pi);
    } else {
      setPendingMonthKey(monthKey);
      setGroupBy("month");
    }
  };

  // Marks which `scrollTarget` object has already been acted on — read/
  // written ONLY inside the effect below (never during render), so it can't
  // trip react-hooks/refs. Comparing by object reference (not by `.key`)
  // means reactivating the same month again still scrolls (a fresh object
  // is created each time), while a stale target left over from a previous
  // activation is never re-acted-on just because some later, unrelated
  // `tree` change happens to still contain that same month key.
  const handledScrollTargetRef = useRef(null);

  // Runs after the DOM commits a render where the reset above stashed a
  // pending scroll target — i.e. after switching groupBy to 'month' from the
  // graphic, once the target month's disclosure header actually exists in
  // the DOM. Only reads/writes a ref and queries the DOM — no setState here,
  // so this isn't the setState-in-effect pattern the codebase's lint rule
  // forbids.
  useEffect(() => {
    if (!scrollTarget || handledScrollTargetRef.current === scrollTarget) return;
    const pi = tree.findIndex((p) => p.key === scrollTarget.key);
    if (pi === -1) return; // not (yet) in this tree shape — a later run will retry
    handledScrollTargetRef.current = scrollTarget;
    const el = typeof document !== "undefined" ? document.getElementById(`${baseId}-p${pi}`) : null;
    if (el) el.scrollIntoView({ behavior: prefersReducedMotion ? "auto" : "smooth", block: "start" });
  }, [scrollTarget, tree, baseId, prefersReducedMotion]);

  const dateRangeLabel = getDateRangeLabel(dateRange, customDateStart, customDateEnd);
  const headingId = `${baseId}-heading`;

  const groupNoun = groupBy === "month" ? "months" : "projects";
  const childNoun = groupBy === "month" ? "projects" : "months";

  // Single results-status string for the live region below — describes the
  // result count plus whichever search/type/contributor filters are active,
  // e.g. 'Showing 12 of 183 commits · matching "export" · type: Feature · All Time'.
  // When no filter is active, this is exactly the original (pre-filter-bar)
  // summary line — unchanged wording.
  let resultsStatusText;
  if (loading && commits.length === 0) {
    resultsStatusText = "Loading commit history…";
  } else if (filtersActive) {
    const total = dateFilteredCommits.length;
    const parts = [`Showing ${summary.commitCount} of ${total} commit${total === 1 ? "" : "s"}`];
    if (normalizedSearch) parts.push(`matching "${searchQuery.trim()}"`);
    if (typeFilter !== "All") parts.push(`type: ${typeFilter}`);
    if (contributorFilter !== "All") parts.push(`contributor: ${contributorFilter}`);
    parts.push(dateRangeLabel);
    resultsStatusText = parts.join(" · ");
  } else {
    resultsStatusText = `Showing ${summary.commitCount} commit${summary.commitCount === 1 ? "" : "s"} across ${tree.length} ${groupNoun} · ${dateRangeLabel}`;
  }

  // Export the chevron-timeline graphic (the same <svg> node the disclosure
  // tree below is the full-detail equivalent of) to a PNG or SVG file. It
  // reflects whatever is currently filtered/grouped by construction — this
  // reads the live DOM node, it never re-derives a separate copy of it.
  const runExport = async (format) => {
    if (exportFormat) return; // one export at a time
    const svgEl = timelineSvgRef.current;
    if (!svgEl) {
      // Defense-in-depth: the `graphicUnavailable` toolbar-button disabled
      // condition already covers this (no commits, or every filtered commit
      // lacking a parseable date — see TechTeamChevronTimeline's
      // buildMonthBuckets), so this branch shouldn't normally be reachable
      // via the buttons. Kept as a guard against any other path that could
      // call runExport before the <svg> ref attaches.
      setExportStatus("");
      setExportError("The timeline graphic isn't available to export right now.");
      return;
    }
    setExportError(null);
    setExportStatus("");
    setExportFormat(format);
    try {
      const filename = buildTimelineExportFilename(dateRangeLabel, format);
      const blob =
        format === "png" ? await svgElementToPngBlob(svgEl, { scale: 2 }) : svgElementToSvgBlob(svgEl);
      downloadBlob(blob, filename);
      setExportStatus(`Timeline exported as ${format.toUpperCase()}.`);
    } catch (err) {
      setExportError(err && err.message ? err.message : "Couldn't export the timeline graphic.");
    } finally {
      setExportFormat(null);
    }
  };

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

          {/* Export the timeline graphic — reflects the current filter/
              grouping by construction (same svg node the chevron graphic
              below renders). */}
          <div role="group" aria-label="Export timeline graphic" className="flex items-center gap-2">
            <ExportButton
              format="png"
              label="Export PNG"
              primary
              busy={exportFormat === "png"}
              onExport={runExport}
              disabled={loading || exportFormat !== null || graphicUnavailable}
            />
            <ExportButton
              format="svg"
              label="SVG"
              busy={exportFormat === "svg"}
              onExport={runExport}
              disabled={loading || exportFormat !== null || graphicUnavailable}
            />
          </div>
        </div>
      </div>

      {/* Filter bar: search / type / contributor. All three compose on top
          of the date-range filter into the single filteredCommits chain
          above, so the tree, chevron graphic, stat chips, and export below
          all reflect them automatically — nothing here ever fetches. */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor={`${baseId}-search`} className="text-sm text-gray-700">
            Search commits
          </label>
          <div className="relative">
            <Search
              className="w-4 h-4 text-cg-dark absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
            <input
              id={`${baseId}-search`}
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Message, author, or SHA…"
              className="w-64 max-w-full pl-9 pr-3 py-2 min-h-[44px] text-sm bg-cg-white border border-gray-300 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-cg-green focus:border-transparent"
            />
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <span id={`${baseId}-type-label`} className="text-sm text-gray-700">
            Commit type
          </span>
          <div
            role="group"
            aria-labelledby={`${baseId}-type-label`}
            className="inline-flex flex-wrap gap-1.5"
          >
            {TYPE_FILTER_OPTIONS.map((opt) => {
              const active = typeFilter === opt;
              return (
                <button
                  key={opt}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setTypeFilter(opt)}
                  className={`px-3 py-2 min-h-[44px] text-sm font-medium rounded-lg border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-cg-green focus-visible:ring-offset-1 ${
                    active
                      ? "bg-cg-dark text-white border-cg-dark"
                      : "bg-cg-white text-cg-dark border-gray-300 hover:bg-gray-100"
                  }`}
                >
                  {opt}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor={`${baseId}-contributor`} className="text-sm text-gray-700">
            Contributor
          </label>
          <select
            id={`${baseId}-contributor`}
            value={contributorFilter}
            onChange={(e) => setContributorFilter(e.target.value)}
            className="min-h-[44px] px-3 py-2 text-sm bg-cg-white border border-gray-300 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-cg-green focus:border-transparent"
          >
            <option value="All">All contributors</option>
            {contributorOptions.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>

        {filtersActive && (
          <button
            type="button"
            onClick={clearFilters}
            className="inline-flex items-center min-h-[44px] px-3 text-sm font-medium text-cg-dark underline hover:no-underline focus:outline-none focus-visible:ring-2 focus-visible:ring-cg-green focus-visible:ring-offset-1 rounded"
          >
            Clear filters ({activeFilterCount})
          </button>
        )}
      </div>

      {/* Export feedback: success is a dedicated aria-live="polite" region,
          kept separate from the results-summary status line below it so a
          single export action never updates two live regions at once.
          Failure is a dismissible role="alert" banner, using the same
          warning-banner styling as the other inline notices in this view. */}
      {exportError && (
        <div role="alert" className="px-4 py-2 rounded-lg bg-status-warning-light text-status-warning-text text-sm flex items-center justify-between gap-3">
          <span>{exportError}</span>
          <button
            type="button"
            onClick={() => setExportError(null)}
            aria-label="Dismiss export error"
            className="shrink-0 inline-flex items-center justify-center min-w-[44px] min-h-[44px] rounded hover:bg-status-warning-text/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-status-warning-text focus-visible:ring-offset-1"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      )}
      {exportStatus && (
        <p role="status" aria-live="polite" className="text-sm text-cg-dark">
          {exportStatus}
        </p>
      )}

      {/* Live status — announced to screen readers when the filter changes.
          One results-status region total (kept distinct from the export
          success/failure regions above, which only ever describe an export
          action, never result counts). */}
      <p role="status" aria-live="polite" className="text-sm text-gray-700">
        {resultsStatusText}
      </p>

      {loading && commits.length === 0 ? (
        // aria-hidden — the "Loading commit history…" announcement above is
        // the accessible signal; this is a purely decorative placeholder.
        <div aria-hidden="true" className="space-y-3">
          {/* Graphic-shaped block — stands in for the chevron timeline */}
          <div className="cg-card p-4">
            <div className="h-[280px] w-full rounded-lg bg-gray-200 animate-pulse motion-reduce:animate-none" />
          </div>
          {/* Card-shaped blocks — stand in for the disclosure-tree rows */}
          {[0, 1, 2].map((i) => (
            <div key={i} className="cg-card h-14 animate-pulse motion-reduce:animate-none" />
          ))}
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

          {partial && (
            <div className="px-4 py-2 rounded-lg bg-status-warning-light text-status-warning-text text-sm flex items-center justify-between gap-3">
              <span>This history may be incomplete — GitHub returned a partial result (likely rate-limited), so it was not cached.</span>
              <button type="button" onClick={refresh} className="font-medium underline hover:no-underline whitespace-nowrap focus:outline-none focus-visible:ring-2 focus-visible:ring-status-warning-text rounded">
                Refresh
              </button>
            </div>
          )}

          {!partial && truncated && (
            <p className="px-4 py-2 rounded-lg bg-status-warning-light text-status-warning-text text-sm">
              This repository has more commits than this view loads at once — the oldest history isn’t shown.
            </p>
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
              value={summary.minD == null ? "—" : `${formatShortDate(summary.minD)} → ${formatShortDate(summary.maxD)}`}
            />
          </div>

          {tree.length === 0 ? (
            <div className="cg-card p-10 text-center">
              {dateFilteredCommits.length === 0 ? (
                <>
                  <p className="text-cg-dark text-lg mb-1">No commits in this range</p>
                  <p className="text-gray-700 text-sm">Try a wider timeline range above.</p>
                </>
              ) : (
                <>
                  <p className="text-cg-dark text-lg mb-1">No commits match your filters</p>
                  <p className="text-gray-700 text-sm mb-4">
                    Try a different search term, commit type, or contributor.
                  </p>
                  <button
                    type="button"
                    onClick={clearFilters}
                    className="px-4 py-2 min-h-[44px] bg-cg-green text-white rounded-lg hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-cg-green focus-visible:ring-offset-2"
                  >
                    Clear filters
                  </button>
                </>
              )}
            </div>
          ) : (
            <>
              {/* Chevron timeline graphic — chronological month band with
                  headline callouts; clicking a month jumps to it below. Always
                  groups by month (it's inherently a chronology), regardless
                  of the "By project" tree toggle above. */}
              <div className="cg-card p-4">
                {groupBy === "project" && (
                  <p className="text-xs text-gray-700 mb-3">
                    This graphic always plots commits chronologically by month — switch to “By month” above to browse it directly, or use the list below for the project breakdown.
                  </p>
                )}
                {summary.minD === null ? (
                  // buildMonthBuckets (TechTeamChevronTimeline) excludes any
                  // commit without a parseable date, same as buildTree's
                  // "Undated" bucket above — so if EVERY filtered commit is
                  // undated, the graphic has nothing chronological to plot and
                  // renders null. Without this fallback that's a blank,
                  // unexplained bordered box (the disclosure tree below still
                  // shows the "Undated" group, so nothing is lost — this just
                  // explains why the graphic itself is empty).
                  <p className="text-sm text-cg-dark text-center py-10">
                    No dated commits to plot in this view — every commit here is missing a date. See the “Undated” group below for details.
                  </p>
                ) : (
                  <TechTeamChevronTimeline
                    commits={filteredCommits}
                    repoLabel={repo}
                    rangeLabel={dateRangeLabel}
                    stats={{
                      commitCount: summary.commitCount,
                      authorCount: summary.authorCount,
                      mergeCount: summary.merges,
                    }}
                    generatedAt={fetchedAt}
                    onMonthActivate={handleMonthActivate}
                    svgRef={timelineSvgRef}
                  />
                )}
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
                {tree.map((p, pi) => {
                  const pKey = `p:${p.key}`;
                  const pOpen = isOpen(pKey);
                  const pPanelId = `${baseId}-pp${pi}`;
                  const pBtnId = `${baseId}-p${pi}`;
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
                            {p.children.map((s, si) => {
                              const sKey = `s:${p.key}:${s.key}`;
                              const sOpen = isOpen(sKey);
                              const sPanelId = `${baseId}-sp${pi}-${si}`;
                              const sBtnId = `${baseId}-s${pi}-${si}`;
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
                                          const type = c.type;
                                          // Full sha (c.sha) drives the key + GitHub URL — a stable,
                                          // collision-proof identifier — while only a 7-char short
                                          // form is ever shown to the user.
                                          const shortSha = c.sha.slice(0, 7);
                                          const url = `https://github.com/${repo}/commit/${c.sha}`;
                                          return (
                                            <li key={c.sha} className="flex items-start gap-2.5 py-1.5">
                                              <span className={`mt-0.5 shrink-0 px-1.5 py-0.5 rounded text-[11px] font-medium ${type.cls}`}>
                                                {type.label}
                                              </span>
                                              <div className="min-w-0">
                                                <p className="text-sm text-cg-dark break-words">{c.message}</p>
                                                <p className="text-xs text-gray-700 mt-0.5">
                                                  {c.author} · {formatShortDate(c.date)} ·{" "}
                                                  <a
                                                    href={url}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    aria-label={`View commit ${shortSha} by ${c.author} on GitHub (opens in a new tab)`}
                                                    className="inline-flex items-center gap-1 font-mono text-status-success-text hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-cg-green rounded px-0.5"
                                                  >
                                                    {shortSha}
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
