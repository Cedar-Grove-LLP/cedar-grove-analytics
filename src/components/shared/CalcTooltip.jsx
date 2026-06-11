"use client";

import { useId } from 'react';
import { Info } from 'lucide-react';
import { getCalcTooltipLines } from '../../utils/calcDefinitions.mjs';

// Full static class strings only — Tailwind's JIT cannot see interpolated
// class names (same convention as ClientStatCard's ACCENT map).
const POS = {
  top: 'bottom-full mb-2',
  bottom: 'top-full mt-2',
};
const ALIGN = {
  left: 'left-0',
  right: 'right-0',
  center: 'left-1/2 -translate-x-1/2',
};

/**
 * "What's this number?" hover/focus tooltip. Body text comes from the
 * calcDefinitions.mjs registry — the single source of truth for formulas
 * and Google Sheets provenance — so the same metric reads identically
 * everywhere it appears.
 *
 * @param {string}   calcKey   key in CALC_DEFINITIONS (required unless `lines` given)
 * @param {object}   [dynamic] { context?: string } appended as the last line,
 *                             e.g. the OOO pace-adjustment sentence
 * @param {string[]} [lines]   escape hatch: explicit lines, bypasses the registry
 * @param {'icon'|'underline'} [variant='icon'] icon = small Info glyph (column
 *                             headers); underline = dotted-underline cue wrapping
 *                             children (inline values/labels)
 * @param {'top'|'bottom'}     [position='top'] popover drops up or down; use
 *                             'bottom' inside overflow-hidden cards so it opens
 *                             into the card body instead of clipping
 * @param {'left'|'center'|'right'} [align='left'] use 'right' near the right
 *                             edge of scrollable tables
 */
const CalcTooltip = ({
  calcKey,
  dynamic,
  lines,
  variant = 'icon',
  position = 'top',
  align = 'left',
  className = '',
  children,
}) => {
  const id = useId();
  const body = lines ?? getCalcTooltipLines(calcKey, dynamic);
  if (!body || body.length === 0) return children || null;

  return (
    <span
      className={`relative inline-flex items-center group align-middle ${className}`}
      tabIndex={0}
      aria-describedby={id}
      // Triggers often sit inside sortable <th onClick> headers — inspecting
      // a tooltip must not bubble into a sort toggle.
      onClick={(e) => e.stopPropagation()}
    >
      {variant === 'underline' ? (
        <span className="underline decoration-dotted decoration-gray-300 cursor-help">
          {children}
        </span>
      ) : (
        <Info className="w-3.5 h-3.5 text-gray-400 cursor-help" aria-label={`About ${body[0]}`} />
      )}
      <span
        role="tooltip"
        id={id}
        className={`absolute ${POS[position] || POS.top} ${ALIGN[align] || ALIGN.left} hidden group-hover:block group-focus-within:block z-50 w-max max-w-xs p-2 bg-gray-900 text-white text-xs font-normal normal-case tracking-normal text-left rounded shadow-lg whitespace-normal`}
      >
        {body.map((line, i) => (
          <span
            key={i}
            className={`block ${i === 0 ? 'font-semibold mb-0.5' : ''}${i > 0 && i === body.length - 1 ? ' text-gray-300 mt-0.5' : ''}`}
          >
            {line}
          </span>
        ))}
      </span>
    </span>
  );
};

export default CalcTooltip;
