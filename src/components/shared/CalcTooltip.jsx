"use client";

import { useId, useState } from 'react';
import { Info } from 'lucide-react';
import { getCalcTooltipLines } from '../../utils/calcDefinitions.mjs';

// Full static class strings only — Tailwind's JIT cannot see interpolated
// class names (same convention as ClientStatCard's ACCENT map).
const POS = {
  // Padding belongs to the positioned hover surface, so there is no dead
  // zone between the trigger and the visible panel. A margin here causes the
  // tooltip to disappear while the pointer crosses the gap, which presents as
  // rapid flashing when someone tries to move from the icon into the panel.
  top: 'bottom-full pb-2',
  bottom: 'top-full pt-2',
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
 * Accessibility: opens on hover AND keyboard focus, is hoverable (no gap
 * between trigger and panel), and is dismissable with Escape without moving
 * focus (WCAG 1.4.13); the dismissal resets when the pointer leaves / focus
 * blurs so the next visit shows it again.
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
  // Escape-dismissal override (WCAG 1.4.13): while true, the panel stays
  // hidden even though hover/focus-within would normally reveal it. Cleared
  // on mouseleave/blur so the tooltip works again on the next visit.
  const [dismissed, setDismissed] = useState(false);
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
      onKeyDown={(e) => {
        if (e.key === 'Escape') setDismissed(true);
      }}
      onMouseLeave={() => setDismissed(false)}
      onBlur={() => setDismissed(false)}
    >
      {variant === 'underline' ? (
        <span className="underline decoration-dotted decoration-gray-300 cursor-help">
          {children}
        </span>
      ) : (
        // p-1 widens the hit target of the 14px glyph toward the 24px WCAG
        // 2.5.8 minimum; the negative margin keeps the visual footprint.
        <span className="p-1 -m-0.5 inline-flex">
          <Info className="w-3.5 h-3.5 text-gray-500 cursor-help" aria-label={`About ${body[0]}`} />
        </span>
      )}
      <span
        role="tooltip"
        id={id}
        className={`absolute ${POS[position] || POS.top} ${ALIGN[align] || ALIGN.left} ${dismissed ? 'hidden' : 'hidden group-hover:block group-focus-within:block'} z-50 w-max max-w-xs text-white text-xs font-normal normal-case tracking-normal text-left whitespace-normal`}
      >
        <span className="block p-2 bg-gray-900 rounded shadow-lg">
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
    </span>
  );
};

export default CalcTooltip;
