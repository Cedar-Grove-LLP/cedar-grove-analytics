"use client";

import { ANNUAL_STATUS, ANNUAL_STATUS_LABEL } from '@/utils/annualUtilizationProgress';
import { formatHours } from '@/utils/formatters';

const clampPct = (v) => Math.max(0, Math.min(100, v));

// Fill color: green when ahead / on track / complete, red when behind, gray
// for N/A or a not-yet-started year. Mirrors the app's semantic status palette.
const FILL_CLASS = {
  [ANNUAL_STATUS.BEHIND]: 'bg-status-danger',
  [ANNUAL_STATUS.AHEAD]: 'bg-status-success',
  [ANNUAL_STATUS.ON_TRACK]: 'bg-status-success',
  [ANNUAL_STATUS.COMPLETE]: 'bg-status-success',
  [ANNUAL_STATUS.NA]: 'bg-gray-300',
  [ANNUAL_STATUS.NOT_STARTED]: 'bg-gray-300',
};

const PILL_CLASS = {
  [ANNUAL_STATUS.BEHIND]: 'bg-status-danger-light text-status-danger-text',
  [ANNUAL_STATUS.AHEAD]: 'bg-status-success-light text-status-success-text',
  [ANNUAL_STATUS.ON_TRACK]: 'bg-status-success-light text-status-success-text',
  [ANNUAL_STATUS.COMPLETE]: 'bg-status-success-light text-status-success-text',
  [ANNUAL_STATUS.NA]: 'bg-gray-100 text-gray-600',
  [ANNUAL_STATUS.NOT_STARTED]: 'bg-gray-100 text-gray-600',
};

// Signed hour delta like "+1" / "−38". Magnitude formatting (1 dp, trailing .0
// trimmed) is delegated to the shared formatHours so the rule lives in one place;
// this only adds the sign and the real minus glyph.
export const formatSignedHours = (h) => {
  const rounded = Math.round((Number(h) || 0) * 10) / 10;
  if (rounded === 0) return '0';
  return `${rounded > 0 ? '+' : '−'}${formatHours(Math.abs(rounded))}`;
};

/**
 * Status pill (Ahead / Behind / On track / Complete / Not started / N/A) plus
 * the signed pace-delta in hours. Single source of truth for annual-progress
 * status styling; used both inside AnnualProgressBar and in the Targets-page
 * table's Pace column.
 */
export const AnnualStatusPill = ({ status, paceDeltaHours, showDelta = true }) => {
  const hasTarget = status !== ANNUAL_STATUS.NA;
  const showHourDelta = showDelta && hasTarget && status !== ANNUAL_STATUS.NOT_STARTED;
  return (
    <span className="inline-flex items-center gap-2">
      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${PILL_CLASS[status] || 'bg-gray-100 text-gray-600'}`}>
        {ANNUAL_STATUS_LABEL[status] || '—'}
      </span>
      {showHourDelta && (
        <span
          className={`text-xs font-medium tabular-nums ${
            status === ANNUAL_STATUS.BEHIND ? 'text-status-danger' : 'text-status-success-text'
          }`}
        >
          {formatSignedHours(paceDeltaHours)}
        </span>
      )}
    </span>
  );
};

/**
 * Annual-progress bar: a fill for % complete plus a vertical "pace marker" at
 * where the person should be by today, optionally followed by a status pill and
 * the signed hour delta. Visual positions clamp to 0–100%; the real values stay
 * in the surrounding cells/tooltips. Reused by the Targets-page summary and the
 * compact member-detail card.
 *
 * @param {object} props
 * @param {number|null} props.percentComplete  0..1+ (or null for N/A)
 * @param {number|null} props.pacePercent      0..1+ (or null)
 * @param {string} props.status                an ANNUAL_STATUS value
 * @param {number} props.paceDeltaHours        actual − pace-expected, in hours
 * @param {boolean} [props.showPill=true]
 * @param {boolean} [props.showDelta=true]
 * @param {string} [props.barClassName='h-2.5']  height utility for the track
 */
const AnnualProgressBar = ({
  percentComplete,
  pacePercent,
  status,
  paceDeltaHours,
  showPill = true,
  showDelta = true,
  barClassName = 'h-2.5',
}) => {
  const hasTarget = status !== ANNUAL_STATUS.NA;
  const fillPct = clampPct((percentComplete || 0) * 100);
  const markerPct = clampPct((pacePercent || 0) * 100);
  const showMarker = hasTarget && status !== ANNUAL_STATUS.NOT_STARTED && pacePercent != null;

  return (
    <div className="flex items-center gap-3">
      <div className="relative flex-1 min-w-[80px]">
        <div
          role="progressbar"
          aria-label="Annual progress"
          aria-valuenow={Math.round(fillPct)}
          aria-valuemin={0}
          aria-valuemax={100}
          className={`bg-gray-200 rounded-full overflow-hidden ${barClassName}`}
        >
          <div
            className={`h-full rounded-full transition-all ${FILL_CLASS[status] || 'bg-gray-300'}`}
            style={{ width: `${fillPct}%` }}
          />
        </div>
        {showMarker && (
          <div
            className="absolute inset-y-0 w-0.5 rounded bg-gray-700"
            style={{ left: `${markerPct}%` }}
            aria-hidden="true"
          />
        )}
      </div>
      {showPill && <AnnualStatusPill status={status} paceDeltaHours={paceDeltaHours} showDelta={showDelta} />}
    </div>
  );
};

export default AnnualProgressBar;
