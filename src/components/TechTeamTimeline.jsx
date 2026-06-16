"use client";

import { useMemo } from "react";

// Dynamic, data-driven version of the "what got built" infographic. Takes a
// (date-range-filtered) list of commits, groups them by calendar month, and
// lays out a horizontal chevron timeline with headline commit labels fanned
// above and below each month — in the dashboard's light / cg-green palette.

const MONTH_ABBR = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// Brand tokens mirrored from globals.css @theme (SVG fills can't read CSS vars
// reliably across renderers, so we pin the hex values here).
const COLORS = {
  chevron: "#5A5A48", // cg-dark
  chevronText: "#FFFFFF", // cg-white
  year: "#ECEDE5", // cg-background
  milestone: "#1CA33B", // cg-green
  label: "#5A5A48", // cg-dark
  line: "#C9CAC0", // gray-300
  dot: "#A5A699", // gray-400
};

const COL_W = 240;
const MARGIN_X = 28;
const HEIGHT = 560;
const BAND_TOP = 250;
const BAND_BOT = 330;
const BAND_MID = (BAND_TOP + BAND_BOT) / 2;
const DEPTH = 24; // chevron point depth
const LEVEL_GAP = 56;
const MAX_LABELS = 6; // headline labels per month (split above/below)
const MAX_LABEL_CHARS = 28;

const FEATURE_RE =
  /^(add|added|implement|introduce|create|build|new|redesign|replace|migrate|launch)\b/i;
const FIX_RE = /^(fix|fixed|harden|secure|resolve|patch)\b/i;

// Higher score = more likely a shipped, headline-worthy feature. Merge commits
// ("Merge pull request #N …") aren't descriptive, so they're excluded from
// labels (-1) but still counted toward the month's commit total.
function scoreCommit(c) {
  if (c.isMerge) return -1;
  if (FEATURE_RE.test(c.message)) return 3;
  if (FIX_RE.test(c.message)) return 1;
  return 0;
}

function truncate(s, n = MAX_LABEL_CHARS) {
  const clean = (s || "").replace(/\s+/g, " ").trim();
  return clean.length > n ? `${clean.slice(0, n - 1).trimEnd()}…` : clean;
}

function pickHeadlines(commits) {
  return commits
    .map((c) => ({ c, score: scoreCommit(c) }))
    .filter((x) => x.score >= 0)
    .sort((a, b) => b.score - a.score || new Date(b.c.date) - new Date(a.c.date))
    .slice(0, MAX_LABELS)
    .map((x) => ({ text: truncate(x.c.message), milestone: x.score >= 3 }));
}

export default function TechTeamTimeline({ commits }) {
  const layout = useMemo(() => {
    // Group commits by calendar month.
    const byMonth = new Map();
    for (const c of commits) {
      if (!c.date) continue;
      const d = new Date(c.date);
      if (Number.isNaN(d.getTime())) continue;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      if (!byMonth.has(key)) {
        byMonth.set(key, { key, year: d.getFullYear(), monthIdx: d.getMonth(), commits: [] });
      }
      byMonth.get(key).commits.push(c);
    }

    const months = [...byMonth.values()].sort(
      (a, b) => a.year - b.year || a.monthIdx - b.monthIdx
    );
    const width = MARGIN_X * 2 + COL_W * Math.max(months.length, 1);

    const cells = months.map((m, i) => {
      const x0 = MARGIN_X + COL_W * i;
      const x1 = x0 + COL_W;
      const cx = (x0 + x1) / 2;

      // Alternate headlines above/below so both sides fill; sorted by priority,
      // so the innermost (level 0) label on each side is the most notable.
      const headlines = pickHeadlines(m.commits);
      const sides = { above: [], below: [] };
      headlines.forEach((h, idx) => sides[idx % 2 === 0 ? "above" : "below"].push(h));

      const features = [];
      const place = (arr, isAbove) => {
        const total = arr.length;
        arr.forEach((h, level) => {
          const riserX = cx + (level - (total - 1) / 2) * 22;
          const lx = cx - COL_W / 2 + 12;
          const yBand = isAbove ? BAND_TOP : BAND_BOT;
          const yLab = isAbove
            ? BAND_TOP - 30 - level * LEVEL_GAP
            : BAND_BOT + 38 + level * LEVEL_GAP;
          const yTick = isAbove ? yLab - 5 : yLab - 14;
          features.push({
            key: `${m.key}-${isAbove ? "a" : "b"}-${level}`,
            riserX, lx, yLab, yBand, yTick,
            text: h.text, milestone: h.milestone,
          });
        });
      };
      place(sides.above, true);
      place(sides.below, false);

      return {
        key: m.key,
        x0, x1, cx,
        month: MONTH_ABBR[m.monthIdx].toUpperCase(),
        year: m.year,
        count: m.commits.length,
        features,
      };
    });

    return { width, height: HEIGHT, cells };
  }, [commits]);

  if (!layout.cells.length) return null;

  const { width, height, cells } = layout;

  return (
    <div className="overflow-x-auto">
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Commit history timeline grouped by month"
        className="mx-auto block"
      >
        {/* Connectors + headline labels */}
        {cells.flatMap((cell) =>
          cell.features.map((f) => (
            <g key={f.key}>
              <path
                d={`M ${f.riserX} ${f.yBand} L ${f.riserX} ${f.yTick} L ${f.lx - 6} ${f.yTick}`}
                fill="none"
                stroke={f.milestone ? COLORS.milestone : COLORS.line}
                strokeWidth={f.milestone ? 1.6 : 1.2}
              />
              <circle cx={f.riserX} cy={f.yBand} r={4} fill={f.milestone ? COLORS.milestone : COLORS.dot} />
              <text
                x={f.lx}
                y={f.yLab}
                fontSize={14}
                fontWeight={f.milestone ? 700 : 500}
                fill={f.milestone ? COLORS.milestone : COLORS.label}
                fontFamily="inherit"
              >
                {f.milestone ? `★ ${f.text}` : f.text}
              </text>
            </g>
          ))
        )}

        {/* Chevron month band */}
        {cells.map((cell) => {
          const pts = [
            [cell.x0, BAND_TOP],
            [cell.x1 - DEPTH, BAND_TOP],
            [cell.x1, BAND_MID],
            [cell.x1 - DEPTH, BAND_BOT],
            [cell.x0, BAND_BOT],
            [cell.x0 + DEPTH, BAND_MID],
          ]
            .map((p) => p.join(","))
            .join(" ");
          const tcx = cell.cx + DEPTH / 2;
          return (
            <g key={cell.key}>
              <polygon points={pts} fill={COLORS.chevron} />
              <text x={tcx} y={BAND_MID - 2} fontSize={30} fontWeight={800} fill={COLORS.chevronText} textAnchor="middle" fontFamily="inherit">
                {cell.month}
              </text>
              <text x={tcx} y={BAND_MID + 20} fontSize={12.5} fontWeight={600} fill={COLORS.year} textAnchor="middle" fontFamily="inherit" letterSpacing="0.5">
                {cell.year} · {cell.count} commit{cell.count === 1 ? "" : "s"}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
