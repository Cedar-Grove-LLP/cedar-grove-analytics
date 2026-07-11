"use client";

import { ArrowUp, ArrowDown, Ban } from 'lucide-react';
import CalcTooltip from './CalcTooltip';

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
    ? 'text-status-success-text'
    : down
    ? 'text-status-danger'
    : 'text-gray-600';
  return (
    <span className={`flex items-center gap-0.5 text-sm font-semibold ${color}`}>
      {Arrow && <Arrow className="w-4 h-4" />}
      {Math.abs(value)}
    </span>
  );
}

/**
 * A KPI stat card for the Clients view: colored top accent, a big colored
 * value, an optional directional delta, a "% of book" / criteria caption, and a
 * progress bar filled to `percent`. With `compact`, renders as a single slim
 * row (label · value · caption · delta) without the progress bar.
 *
 * @param {object}  props
 * @param {string}  props.label        e.g. "Active clients"
 * @param {number}  props.value        the headline count
 * @param {'green'|'amber'|'red'|'blue'} props.accent
 * @param {number}  props.percent      0-100, drives the bar width and caption
 * @param {string}  props.percentLabel e.g. "of book" | criteria summary
 * @param {?number} props.delta        signed delta vs. prior period; null hides it
 * @param {?object} props.info         calculation tooltip: { calcKey, dynamic? }
 * @param {boolean} props.compact      slim one-row variant, no progress bar
 * @param {?string} props.flag         red operational flag line (e.g. the Hold rule)
 */
const ClientStatCard = ({
  label,
  value,
  accent = 'green',
  percent = 0,
  percentLabel = '',
  delta = null,
  info = null,
  compact = false,
  flag = null,
}) => {
  const a = ACCENT[accent] || ACCENT.green;
  const width = Math.min(Math.max(percent || 0, 0), 100);
  const displayPct = Math.round(width);

  if (compact) {
    return (
      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        <div className={`h-1 rounded-t-lg ${a.bg}`} />
        <div className="px-4 py-2.5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <span className={`w-2 h-2 rounded-full shrink-0 ${a.bg}`} />
            <span className="text-sm font-medium text-cg-dark truncate inline-flex items-center gap-1">
              {label}
              {info && <CalcTooltip {...info} variant="icon" position="bottom" align="left" />}
            </span>
            <span className={`text-2xl font-bold ${a.text}`}>{value}</span>
            <span className="text-xs text-gray-500 whitespace-nowrap">
              · {displayPct}%{percentLabel ? ` ${percentLabel}` : ''}
            </span>
          </div>
          <DeltaBadge value={delta} />
        </div>
      </div>
    );
  }

  return (
    // No overflow-hidden here — it would clip the calc tooltip popover; the
    // accent bar carries its own top rounding instead.
    <div className="bg-white rounded-lg shadow-sm border border-gray-200">
      <div className={`h-1.5 rounded-t-lg ${a.bg}`} />
      <div className="p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className={`w-2.5 h-2.5 rounded-full ${a.bg}`} />
            <span className="text-sm font-medium text-cg-dark inline-flex items-center gap-1">
              {label}
              {info && <CalcTooltip {...info} variant="icon" position="bottom" align="left" />}
            </span>
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

        {flag && (
          <div className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-status-danger">
            <Ban className="w-3.5 h-3.5 shrink-0" />
            {flag}
          </div>
        )}
      </div>
    </div>
  );
};

export default ClientStatCard;
