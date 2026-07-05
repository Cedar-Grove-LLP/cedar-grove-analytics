"use client";

import { useMemo } from "react";
import { MONTH_NAMES_FULL, MONTH_NAMES_ABBR, pickMonthHeadlines } from "@/utils/commitTimeline";
import { formatShortDate } from "@/utils/formatters";
import { GRAY } from "@/utils/colors";

// Accessible "features timeline" infographic for the Tech Team tab: a
// chronological, interlocking chevron/arrow band (one segment per month)
// with up to 6 headline-commit callouts per month fanned above/below,
// connected by elbow lines with dots at the band edge. Generated live from
// props — no fetching, no local state beyond derived useMemo.
//
// GEOMETRY SYNC (svg <-> overlay buttons): every coordinate below is derived
// from ONE set of module-level layout constants (MARGIN/WIDE_MARGIN,
// MONTH_COL_WIDTH, BAND_TOP, BAND_HEIGHT, ...) plus the single per-render
// `sideMargin` value computed in the component body. Both the <svg> chevron
// path builder (`chevronPath`) and the HTML overlay-button loop call the
// *same* `monthColumnX(i, sideMargin)` function with the *same* arguments,
// so a given month's clickable button is always positioned at the exact x/
// width of its chevron column. This works pixel-for-pixel (not just
// proportionally) because the <svg> sets explicit width/height attributes
// equal to the computed pixel totals (not just a viewBox) — so 1 SVG user
// unit === 1 CSS px, and the overlay <div> wrapping both layers is sized to
// that same totalWidth/TOTAL_HEIGHT. There is no separate scaling factor for
// either layer to drift out of sync with the other.

// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------
const MONTH_COL_WIDTH = 230; // px per month, per spec
const CHEVRON_NOTCH = 20; // arrow tip / notch depth
const BAND_HEIGHT = 84;
const CANVAS_PAD = 14; // top/bottom canvas breathing room
const HEADER_HEIGHT = 78; // title + subtitle block
const TEXT_INSET = 24; // fixed left inset for title/subtitle/footer — independent
// of the chevron band's own side margin (below), so the header text always
// reads flush top-left regardless of how the band itself is centered.
const MARGIN = 32; // default side margin around the chevron band (>= 2 months)
// WIDE_MARGIN applies only to a single-month timeline: with just one chevron
// column, the 230px-wide band is much narrower than the header/footer text
// above and below it, so the default 32px margin reads lopsided/off-center.
// 200px is an empirically-chosen value that visually balances a lone column
// against the surrounding text — unlike HEADLINE_CHAR_BUDGET/
// LABEL_RIGHT_RESERVE below, there's no title/footer-width formula it's
// derived from. (Label overflow itself is handled separately by
// LABEL_RIGHT_RESERVE — all callouts flow rightward regardless of month
// count.)
const WIDE_MARGIN = 200;
const CALLOUT_BASE_GAP = 36; // band edge -> nearest callout row
const LEVEL_GAP = 52; // vertical spacing between callout rows (spec: ~52px)
const LEVELS_PER_SIDE = 3; // 3 above + 3 below = up to 6 callouts/month
const CALLOUT_TEXT_HEADROOM = 22;
const FOOTER_HEIGHT = 46;
const LEVEL_X_OFFSETS = [0, 22, -22]; // riser stagger per level (spec: +/-22px)
const CONNECTOR_JOG = 12; // short jog from the dot before the staggered riser
const MAX_HEADLINES_PER_MONTH = LEVELS_PER_SIDE * 2;
// Character budget for callout labels, derived from the column geometry so
// same-level labels in adjacent columns can never collide: available width is
// one column minus the worst-case riser stagger (22px) and the 6px text inset,
// divided by the widest realistic 13px glyph advance (~6.9px bold, plus the
// "★ " milestone prefix ≈ 15px ≈ 2 chars). 230 - 22 - 6 - 15 = 187px / 6.9 ≈ 27.
const HEADLINE_CHAR_BUDGET = Math.floor(
  (MONTH_COL_WIDTH - 22 - 6 - 15) / 6.9
);
// Pixel reserve appended to the right edge of the canvas so the LAST column's
// rightward-flowing labels never clip: worst-case label width plus breathing
// room (mirrors the char-budget math above: 22 + 6 + 15 + 27 * 6.9 ≈ 230).
const LABEL_RIGHT_RESERVE = MONTH_COL_WIDTH;

const CALLOUT_REGION_HEIGHT =
  CALLOUT_BASE_GAP + (LEVELS_PER_SIDE - 1) * LEVEL_GAP + CALLOUT_TEXT_HEADROOM;
const BAND_TOP = CANVAS_PAD + HEADER_HEIGHT + CALLOUT_REGION_HEIGHT;
const BAND_BOTTOM = BAND_TOP + BAND_HEIGHT;
const BAND_MID = (BAND_TOP + BAND_BOTTOM) / 2;
const TOTAL_HEIGHT = BAND_BOTTOM + CALLOUT_REGION_HEIGHT + FOOTER_HEIGHT + CANVAS_PAD; // ~560

const TITLE_Y = CANVAS_PAD + 22;
const SUBTITLE_Y = TITLE_Y + 22;
const FOOTER_Y = TOTAL_HEIGHT - CANVAS_PAD - FOOTER_HEIGHT / 2 + 5;

const FONT_STACK =
  'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

// Brand colors — GRAY[*] (src/utils/colors.js) is the single source of truth
// for the gray ramp, so a future palette retune propagates here automatically
// instead of silently drifting out of sync with every other chart. white/
// black/milestone aren't part of that ramp, so they stay literal (verified
// against the project's documented contrast table — never #7A7B6E/muted).
const COLOR = {
  white: "#FFFFFF",
  black: "#000000",
  ink: GRAY[700], // #484839
  dark: GRAY[600], // #5A5A48 — cg-dark
  bg: GRAY[100], // #ECEDE5 — cg-background
  // Non-milestone elbow-connector line + dot. This is a graphical object
  // "required to understand the content" (WCAG 1.4.11, 3:1 min) — it's the
  // only visual link between a headline callout and its month column — so it
  // can't use the gray-300 "recessive" border tone (GRAY[300]/#C9CAC0
  // measures ~1.65:1 on white, well under 3:1). cg-dark clears both 1.4.11
  // (3:1) and text-grade 1.4.3 (4.5:1) at 7.0:1, and is already used
  // elsewhere in this graphic (band fill, footer), so it doesn't add a new
  // color to the palette.
  connector: GRAY[600], // cg-dark — was gray-300 (failed 3:1)
  milestone: "#15803d", // status-success-text (globals.css; not in the GRAY ramp)
};

// Shared x-position of month column `i`'s left edge — the one function both
// the svg path builder and the overlay-button loop call identically.
const monthColumnX = (i, margin) => margin + i * MONTH_COL_WIDTH;

function chevronPath(i, margin) {
  const x0 = monthColumnX(i, margin);
  const x1 = x0 + MONTH_COL_WIDTH;
  const leftX = i === 0 ? x0 : x0 + CHEVRON_NOTCH; // first segment: flat left edge
  const rightNotchX = x1 - CHEVRON_NOTCH;
  const base =
    `M ${leftX},${BAND_TOP} L ${rightNotchX},${BAND_TOP} L ${x1},${BAND_MID} ` +
    `L ${rightNotchX},${BAND_BOTTOM} L ${leftX},${BAND_BOTTOM}`;
  // Segments after the first get an inward notch (concave vertex at x0,mid)
  // that exactly matches the previous segment's outward arrow tip, so the
  // band reads as one continuous interlocking ribbon.
  return i === 0 ? `${base} Z` : `${base} L ${x0},${BAND_MID} Z`;
}

const calloutRowY = (level, side) => {
  const gap = CALLOUT_BASE_GAP + level * LEVEL_GAP;
  return side === "above" ? BAND_TOP - gap : BAND_BOTTOM + gap;
};

// Elbow connector: dot at the band edge -> short jog -> staggered vertical
// riser (at xc + the level's x-offset) -> terminates just clear of the text.
function elbowPath(xc, dx, level, side) {
  const dotY = side === "above" ? BAND_TOP : BAND_BOTTOM;
  const jogY = side === "above" ? dotY - CONNECTOR_JOG : dotY + CONNECTOR_JOG;
  const rowY = calloutRowY(level, side);
  const endY = side === "above" ? rowY + 4 : rowY - 14;
  const riserX = xc + dx;
  return `M ${xc},${dotY} L ${xc},${jogY} L ${riserX},${jogY} L ${riserX},${endY}`;
}

function monthInfoFromDate(dateInput) {
  const d = new Date(dateInput);
  if (Number.isNaN(d.getTime())) return null;
  return { year: d.getFullYear(), monthIndex: d.getMonth() };
}

// Group already-filtered commits into chronological (ascending) month
// buckets for the band. Commits without a parseable date can't be placed on
// a chronological graphic, so they're excluded here — they remain visible
// (and fully accounted for) in the disclosure tree below this component,
// which is the full-detail equivalent the graphic's aria-label points to.
function buildMonthBuckets(commits) {
  const buckets = new Map();
  for (const c of commits || []) {
    if (!c || !c.date) continue;
    const info = monthInfoFromDate(c.date);
    if (!info) continue;
    const key = `${info.year}-${String(info.monthIndex + 1).padStart(2, "0")}`;
    if (!buckets.has(key)) {
      buckets.set(key, { key, year: info.year, monthIndex: info.monthIndex, commits: [] });
    }
    buckets.get(key).commits.push(c);
  }
  return [...buckets.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

export default function TechTeamChevronTimeline({
  commits = [],
  repoLabel,
  rangeLabel,
  stats = {},
  generatedAt,
  onMonthActivate,
  svgRef,
}) {
  const { commitCount = 0, authorCount = 0, mergeCount = 0 } = stats;

  const monthBand = useMemo(() => {
    return buildMonthBuckets(commits).map((m) => ({
      key: m.key,
      count: m.commits.length,
      yearLabel: m.year,
      fullLabel: `${MONTH_NAMES_FULL[m.monthIndex]} ${m.year}`,
      shortLabel: MONTH_NAMES_ABBR[m.monthIndex].toUpperCase(),
      headlines: pickMonthHeadlines(m.commits, MAX_HEADLINES_PER_MONTH, HEADLINE_CHAR_BUDGET),
    }));
  }, [commits]);

  const sideMargin = monthBand.length === 1 ? WIDE_MARGIN : MARGIN;
  // Every callout label flows RIGHTWARD from its riser (uniform direction —
  // mixed directions collide where two adjacent columns flow toward each
  // other), so the canvas reserves one label's width past the last column.
  const totalWidth =
    sideMargin * 2 + monthBand.length * MONTH_COL_WIDTH + LABEL_RIGHT_RESERVE;

  if (monthBand.length === 0) return null;

  const monthNoun = monthBand.length === 1 ? "month" : "months";
  const commitNoun = commitCount === 1 ? "commit" : "commits";
  const contributorNoun = authorCount === 1 ? "contributor" : "contributors";
  const mergeNoun = mergeCount === 1 ? "merge/PR" : "merges/PRs";

  const subtitle = `${rangeLabel ?? "All Time"} · ${commitCount} ${commitNoun} · ${authorCount} ${contributorNoun} · ${mergeCount} ${mergeNoun}`;
  const ariaLabel =
    `Development timeline graphic: ${commitCount} ${commitNoun} across ${monthBand.length} ${monthNoun}, ` +
    `${rangeLabel ?? "all time"}. The commit list below contains the same information.`;
  const generatedLabel = formatShortDate(generatedAt);
  const textBase = { fontFamily: FONT_STACK };

  return (
    <div className="space-y-2">
      <div
        role="region"
        aria-label="Development timeline graphic (scrollable)"
        tabIndex={0}
        className="overflow-x-auto rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-cg-green focus-visible:ring-offset-2"
      >
        <div style={{ position: "relative", width: totalWidth, height: TOTAL_HEIGHT }}>
          <svg
            ref={svgRef}
            xmlns="http://www.w3.org/2000/svg"
            width={totalWidth}
            height={TOTAL_HEIGHT}
            viewBox={`0 0 ${totalWidth} ${TOTAL_HEIGHT}`}
            role="img"
            aria-label={ariaLabel}
            className="block pointer-events-none"
          >
            <title>{ariaLabel}</title>
            <rect x={0} y={0} width={totalWidth} height={TOTAL_HEIGHT} fill={COLOR.white} />

            <text {...textBase} x={TEXT_INSET} y={TITLE_Y} fontSize={22} fontWeight={700} fill={COLOR.black}>
              Cedar Grove Analytics — Development Timeline
            </text>
            <text {...textBase} x={TEXT_INSET} y={SUBTITLE_Y} fontSize={13} fontWeight={400} fill={COLOR.ink}>
              {subtitle}
            </text>

            {monthBand.map((m, i) => {
              const x0 = monthColumnX(i, sideMargin);
              const xc = x0 + MONTH_COL_WIDTH / 2;
              return (
                <g key={m.key}>
                  <path
                    d={chevronPath(i, sideMargin)}
                    fill={COLOR.dark}
                    stroke={COLOR.white}
                    strokeWidth={2}
                    strokeLinejoin="round"
                  />
                  <text
                    {...textBase}
                    x={xc}
                    y={BAND_MID - 8}
                    fontSize={28}
                    fontWeight={700}
                    fill={COLOR.white}
                    textAnchor="middle"
                  >
                    {m.shortLabel}
                  </text>
                  <text
                    {...textBase}
                    x={xc}
                    y={BAND_MID + 18}
                    fontSize={12}
                    fontWeight={400}
                    fill={COLOR.bg}
                    textAnchor="middle"
                  >
                    {`${m.yearLabel} · ${m.count} commit${m.count === 1 ? "" : "s"}`}
                  </text>

                  {m.headlines.map((h, hi) => {
                    const level = Math.floor(hi / 2);
                    const side = hi % 2 === 0 ? "above" : "below";
                    const dx = LEVEL_X_OFFSETS[level] ?? 0;
                    const riserX = xc + dx;
                    const rowY = calloutRowY(level, side);
                    const color = h.milestone ? COLOR.milestone : COLOR.connector;
                    // Every label flows RIGHTWARD from its riser. A uniform
                    // direction means same-level labels in adjacent columns
                    // are always exactly MONTH_COL_WIDTH apart — with the
                    // char budget capping label width below that, they can
                    // never collide (mixed directions collide at the canvas
                    // midline where two columns flow toward each other). The
                    // last column's overflow lands in LABEL_RIGHT_RESERVE.
                    const anchor = "start";
                    const textX = riserX + 6;
                    return (
                      <g key={h.sha}>
                        <path
                          d={elbowPath(xc, dx, level, side)}
                          fill="none"
                          stroke={color}
                          strokeWidth={1.5}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                        <circle cx={xc} cy={side === "above" ? BAND_TOP : BAND_BOTTOM} r={2} fill={color} />
                        <text
                          {...textBase}
                          x={textX}
                          y={rowY}
                          fontSize={13}
                          fontWeight={h.milestone ? 700 : 400}
                          fill={h.milestone ? COLOR.milestone : COLOR.ink}
                          textAnchor={anchor}
                        >
                          {h.milestone ? `★ ${h.text}` : h.text}
                        </text>
                      </g>
                    );
                  })}
                </g>
              );
            })}

            <text {...textBase} x={TEXT_INSET} y={FOOTER_Y} fontSize={11} fontWeight={400} fill={COLOR.dark}>
              {`★ = milestone / headline feature · Source: github.com/${repoLabel || "repository"} · generated ${generatedLabel || "—"}`}
            </text>
          </svg>

          {monthBand.map((m, i) => (
            <button
              key={m.key}
              type="button"
              onClick={() => onMonthActivate?.(m.key)}
              title={`Jump to ${m.fullLabel} — ${m.count} commit${m.count === 1 ? "" : "s"}`}
              aria-label={`Jump to ${m.fullLabel} — ${m.count} commit${m.count === 1 ? "" : "s"}`}
              style={{
                position: "absolute",
                left: monthColumnX(i, sideMargin),
                top: BAND_TOP,
                width: MONTH_COL_WIDTH,
                height: Math.max(BAND_HEIGHT, 44),
              }}
              className="bg-transparent cursor-pointer rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cg-green motion-reduce:transition-none"
            />
          ))}
        </div>
      </div>

      <p className="text-xs text-cg-dark">
        <span className="font-bold text-status-success-text">★</span> = milestone / headline feature
      </p>
    </div>
  );
}
