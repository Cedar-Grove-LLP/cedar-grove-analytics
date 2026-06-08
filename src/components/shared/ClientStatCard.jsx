"use client";

import { ArrowUp, ArrowDown } from 'lucide-react';

// Accent palette keyed to the app's semantic color tokens (globals.css). Use
// full, static class strings only — Tailwind's JIT cannot see class names that
// are built by string interpolation, so a `bg-${color}` style would get purged.
const ACCENT = {
  green: { bg: 'bg-status-success', text: 'text-status-success' },
  amber: { bg: 'bg-status-warning', text: 'text-status-warning' },
  red: { bg: 'bg-status-danger', text: 'text-status-danger' },
  blue: { bg: 'bg-primary', text: 'text-primary' },
};

// Directional period-over-period delta: up = green, down = red, flat = muted.
// (Direction-colored, not semantic — a rising "Quiet" count still shows green.)
function DeltaBadge({ value }) {
  if (value === null || value === undefined) return null;
  const up = value > 0;
  const down = value < 0;
  const Arrow = up ? ArrowUp : down ? ArrowDown : null;
  const color = up
    ? 'text-status-success'
    : down
    ? 'text-status-danger'
    : 'text-gray-400';
  return (
    <span className={`flex items-center gap-0.5 text-sm font-semibold ${color}`}>
      {Arrow && <Arrow className="w-4 h-4" />}
      {Math.abs(value)}
    </span>
  );
}

/**
 * A KPI stat card for the Clients view: colored top accent, a big colored
 * value, an optional directional delta, a "% of book / · sample" caption, and a
 * progress bar filled to `percent`.
 *
 * @param {object}  props
 * @param {string}  props.label        e.g. "Active clients"
 * @param {number}  props.value        the headline count
 * @param {'green'|'amber'|'red'|'blue'} props.accent
 * @param {number}  props.percent      0-100, drives the bar width and caption
 * @param {string}  props.percentLabel e.g. "of book" | "· sample"
 * @param {?number} props.delta        signed delta vs. prior period; null hides it
 */
const ClientStatCard = ({
  label,
  value,
  accent = 'green',
  percent = 0,
  percentLabel = '',
  delta = null,
}) => {
  const a = ACCENT[accent] || ACCENT.green;
  const width = Math.min(Math.max(percent || 0, 0), 100);
  const displayPct = Math.round(width);

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
      <div className={`h-1.5 ${a.bg}`} />
      <div className="p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className={`w-2.5 h-2.5 rounded-full ${a.bg}`} />
            <span className="text-sm font-medium text-cg-dark">{label}</span>
          </div>
          <DeltaBadge value={delta} />
        </div>

        <div className={`mt-2 text-4xl font-bold ${a.text}`}>{value}</div>

        <div className="mt-1 text-xs text-gray-500">
          {displayPct}%{percentLabel ? ` ${percentLabel}` : ''}
        </div>

        <div className="mt-3 w-full bg-gray-200 rounded-full h-2 overflow-hidden">
          <div
            className={`h-2 rounded-full ${a.bg}`}
            style={{ width: `${width}%` }}
          />
        </div>
      </div>
    </div>
  );
};

export default ClientStatCard;
