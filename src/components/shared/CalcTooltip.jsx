"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Info } from 'lucide-react';
import { getCalcTooltipLines } from '../../utils/calcDefinitions.mjs';

// Gap between trigger and visible panel — mirrors Tailwind pt-2 / pb-2 (8px).
const GAP = 8;
const VIEWPORT_MARGIN = 8;

function computePanelCoords(trigger, panel, position, align) {
  const rect = trigger.getBoundingClientRect();
  const panelWidth = panel.offsetWidth;
  const panelHeight = panel.offsetHeight;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let top;
  if (position === 'bottom') {
    top = rect.bottom;
  } else {
    top = rect.top - panelHeight;
  }

  let left;
  if (align === 'right') {
    left = rect.right - panelWidth;
  } else if (align === 'center') {
    left = rect.left + rect.width / 2 - panelWidth / 2;
  } else {
    left = rect.left;
  }

  left = Math.max(VIEWPORT_MARGIN, Math.min(left, vw - VIEWPORT_MARGIN - panelWidth));

  if (position === 'bottom') {
    const bottom = top + panelHeight;
    if (bottom > vh - VIEWPORT_MARGIN) {
      const flippedTop = rect.top - panelHeight;
      if (flippedTop >= VIEWPORT_MARGIN) {
        top = flippedTop;
      } else {
        top = Math.max(VIEWPORT_MARGIN, vh - VIEWPORT_MARGIN - panelHeight);
      }
    }
  } else if (top < VIEWPORT_MARGIN) {
    const flippedTop = rect.bottom;
    if (flippedTop + panelHeight <= vh - VIEWPORT_MARGIN) {
      top = flippedTop;
    } else {
      top = VIEWPORT_MARGIN;
    }
  }

  return { top, left };
}

function applyPanelCoords(panel, coords) {
  panel.style.top = `${coords.top}px`;
  panel.style.left = `${coords.left}px`;
  panel.style.visibility = 'visible';
}

/**
 * "What's this number?" hover/focus tooltip. Body text comes from the
 * calcDefinitions.mjs registry — the single source of truth for formulas
 * and Google Sheets provenance — so the same metric reads identically
 * everywhere it appears.
 *
 * The panel is portaled to document.body and positioned with fixed
 * coordinates so it never expands an ancestor scroll container's overflow
 * rect (which would shift tables inside overflow-x-auto cards).
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
  const triggerRef = useRef(null);
  const panelRef = useRef(null);
  const leaveTimerRef = useRef(null);
  const [dismissed, setDismissed] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);

  const body = lines ?? getCalcTooltipLines(calcKey, dynamic);
  const visible = (hovered || focused) && !dismissed;
  const canPortal = typeof document !== 'undefined';

  const repositionPanel = useCallback(() => {
    const trigger = triggerRef.current;
    const panel = panelRef.current;
    if (!trigger || !panel) return;
    applyPanelCoords(panel, computePanelCoords(trigger, panel, position, align));
  }, [position, align]);

  useEffect(() => {
    if (!visible) return undefined;
    const onDocKeyDown = (e) => {
      if (e.key === 'Escape') setDismissed(true);
    };
    document.addEventListener('keydown', onDocKeyDown);
    return () => document.removeEventListener('keydown', onDocKeyDown);
  }, [visible]);

  useLayoutEffect(() => {
    if (!visible) return;
    repositionPanel();
  }, [visible, repositionPanel, body]);

  useEffect(() => {
    if (!visible) return undefined;
    const onScrollOrResize = () => repositionPanel();
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [visible, repositionPanel]);

  const clearInteraction = () => {
    setHovered(false);
    setDismissed(false);
  };

  const cancelLeaveTimer = () => {
    if (leaveTimerRef.current != null) {
      clearTimeout(leaveTimerRef.current);
      leaveTimerRef.current = null;
    }
  };

  const scheduleLeave = () => {
    cancelLeaveTimer();
    // Portaled panels are outside the trigger DOM tree, so pointer
    // leave fires before the panel receives enter — brief delay bridges
    // the gap (same role as the old padding hit-area on the inline panel).
    leaveTimerRef.current = setTimeout(clearInteraction, 100);
  };

  const openInteraction = () => {
    cancelLeaveTimer();
    setHovered(true);
  };

  useEffect(() => () => cancelLeaveTimer(), []);

  if (!body || body.length === 0) return children || null;

  const panel = (
    <div
      ref={panelRef}
      role="tooltip"
      id={id}
      className="fixed z-50 w-max max-w-xs text-white text-xs font-normal normal-case tracking-normal text-left whitespace-normal"
      style={{
        top: -9999,
        left: 0,
        paddingTop: position === 'bottom' ? GAP : 0,
        paddingBottom: position === 'top' ? GAP : 0,
        visibility: 'hidden',
      }}
      onMouseEnter={openInteraction}
      onMouseLeave={clearInteraction}
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
    </div>
  );

  return (
    <>
      <span
        ref={triggerRef}
        className={`inline-flex items-center align-middle ${className}`}
        tabIndex={0}
        aria-describedby={visible ? id : undefined}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setDismissed(true);
        }}
        onMouseEnter={openInteraction}
        onMouseLeave={scheduleLeave}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          setDismissed(false);
        }}
      >
        {variant === 'underline' ? (
          <span className="underline decoration-dotted decoration-gray-300 cursor-help">
            {children}
          </span>
        ) : (
          <span className="p-1 -m-0.5 inline-flex">
            <Info className="w-3.5 h-3.5 text-gray-500 cursor-help" aria-label={`About ${body[0]}`} />
          </span>
        )}
      </span>
      {canPortal && visible ? createPortal(panel, document.body) : null}
    </>
  );
};

export default CalcTooltip;
