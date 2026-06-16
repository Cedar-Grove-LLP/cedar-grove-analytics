"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { ArrowLeft, GitCommit, GitMerge, Users, RefreshCw, Calendar } from "lucide-react";
import { DateRangeDropdown } from "./shared";
import TechTeamTimeline from "./TechTeamTimeline";
import { useCommitHistory } from "@/hooks/useCommitHistory";
import { calculateDateRange, getDateRangeLabel } from "@/utils/dateHelpers";

const MONTH_ABBR = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function formatDay(ms) {
  if (ms == null) return "—";
  const d = new Date(ms);
  return `${MONTH_ABBR[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

function StatChip({ icon: Icon, label, value }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-cg-white border border-gray-200 rounded-lg shadow-sm">
      <Icon className="w-4 h-4 text-cg-green" />
      <span className="text-lg font-bold text-cg-black leading-none">{value}</span>
      <span className="text-xs text-gray-500">{label}</span>
    </div>
  );
}

export default function TechTeamDashboard() {
  const { commits, loading, error, fetchedAt, refresh } = useCommitHistory();

  const [dateRange, setDateRange] = useState("all-time");
  const [customDateStart, setCustomDateStart] = useState("");
  const [customDateEnd, setCustomDateEnd] = useState("");
  const [showDateDropdown, setShowDateDropdown] = useState(false);

  // Filter the CACHED commits by the selected range. Because this is a useMemo
  // over the already-fetched `commits`, changing the date range only re-filters
  // in memory — it never re-pulls from GitHub.
  const filteredCommits = useMemo(() => {
    if (!commits || commits.length === 0) return [];
    if (dateRange === "all-time") return commits;
    const { startDate, endDate } = calculateDateRange(
      dateRange,
      customDateStart,
      customDateEnd,
      []
    );
    const startMs = startDate.getTime();
    const endMs = endDate.getTime();
    return commits.filter((c) => {
      if (!c.date) return false;
      const t = new Date(c.date).getTime();
      return t >= startMs && t <= endMs;
    });
  }, [commits, dateRange, customDateStart, customDateEnd]);

  const summary = useMemo(() => {
    const authors = new Set();
    let merges = 0;
    let minD = null;
    let maxD = null;
    for (const c of filteredCommits) {
      if (c.author) authors.add(c.author);
      if (c.isMerge) merges += 1;
      if (c.date) {
        const t = new Date(c.date).getTime();
        if (!Number.isNaN(t)) {
          if (minD === null || t < minD) minD = t;
          if (maxD === null || t > maxD) maxD = t;
        }
      }
    }
    return {
      commitCount: filteredCommits.length,
      authorCount: authors.size,
      merges,
      minD,
      maxD,
    };
  }, [filteredCommits]);

  const dateRangeLabel = getDateRangeLabel(dateRange, customDateStart, customDateEnd);

  const header = (
    <div className="mb-6 flex flex-wrap justify-between items-start gap-4">
      <div>
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-cg-dark hover:text-cg-black mb-2 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Dashboard
        </Link>
        <h1 className="text-3xl font-bold text-cg-black">Tech Team</h1>
        <p className="text-sm text-gray-500 mt-1">
          Development timeline · commit history grouped by month
        </p>
      </div>

      <div className="flex items-center gap-3">
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
        <button
          onClick={refresh}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-cg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors shadow-sm disabled:opacity-50"
          title="Pull the latest commits from GitHub"
        >
          <RefreshCw className={`w-4 h-4 text-cg-dark ${loading ? "animate-spin" : ""}`} />
          <span className="text-sm font-medium text-cg-dark">Refresh</span>
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-cg-background px-4 py-6">
      <div className="max-w-[88rem] mx-auto">
        {header}

        {loading && commits.length === 0 ? (
          <div className="flex items-center justify-center py-32">
            <div className="text-center">
              <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-cg-green" />
              <div className="mt-4 text-lg text-cg-dark">Loading commit history…</div>
            </div>
          </div>
        ) : error && commits.length === 0 ? (
          <div className="cg-card p-8 text-center max-w-xl mx-auto">
            <div className="text-red-600 text-lg font-medium mb-2">
              Couldn’t load commit history
            </div>
            <div className="text-cg-dark mb-4">{error}</div>
            <button
              onClick={refresh}
              className="px-4 py-2 bg-cg-green text-white rounded-lg hover:opacity-90"
            >
              Retry
            </button>
          </div>
        ) : (
          <>
            {/* Non-blocking warning when a manual refresh failed but cached data is still shown */}
            {error && (
              <div className="mb-3 px-4 py-2 rounded-lg bg-status-warning-light text-status-warning-text text-sm flex items-center justify-between gap-3">
                <span>Showing cached data — couldn’t refresh: {error}</span>
                <button onClick={refresh} className="font-medium underline hover:no-underline whitespace-nowrap">
                  Try again
                </button>
              </div>
            )}

            {/* Summary chips */}
            <div className="flex flex-wrap items-center gap-3 mb-2">
              <StatChip icon={GitCommit} label="commits" value={summary.commitCount} />
              <StatChip icon={Users} label="contributors" value={summary.authorCount} />
              <StatChip icon={GitMerge} label="merges / PRs" value={summary.merges} />
              <StatChip
                icon={Calendar}
                label="span"
                value={
                  summary.minD == null
                    ? "—"
                    : `${formatDay(summary.minD)} → ${formatDay(summary.maxD)}`
                }
              />
            </div>

            <div className="flex items-center justify-between mb-4 text-xs text-gray-500">
              <span>
                Showing <span className="font-medium text-cg-dark">{dateRangeLabel}</span>
              </span>
              {fetchedAt && (
                <span>
                  Data as of {new Date(fetchedAt).toLocaleString()} ·{" "}
                  <span className="text-cg-green font-medium">cached</span>
                </span>
              )}
            </div>

            {/* Timeline */}
            <div className="cg-card p-4">
              {filteredCommits.length === 0 ? (
                <div className="py-20 text-center">
                  <div className="text-cg-dark text-lg mb-1">No commits in this range</div>
                  <div className="text-gray-500 text-sm">
                    Try a wider date range above.
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-2 mb-3 px-2 text-xs text-gray-500">
                    <span className="inline-flex items-center gap-1">
                      <span className="text-cg-green font-bold">★</span> milestone / headline feature
                    </span>
                  </div>
                  <TechTeamTimeline commits={filteredCommits} />
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
