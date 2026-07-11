"use client";

import { useCallback, useEffect, useId, useRef, useState } from 'react';

// Grace period between the pointer leaving the row and the tooltip hiding —
// long enough to travel the 15px offset gap into the tooltip surface (which
// cancels the hide), short enough that the panel doesn't feel sticky.
const HIDE_DELAY_MS = 120;

/**
 * Shared controller for the large row-detail tooltips (Clients / Matters /
 * Ops / Practice / Transactions tables). Replaces the per-table
 * mouse-only useState wiring with a WCAG-conformant interaction model:
 *
 * - 2.1.1 Keyboard: rows take focus (`tabIndex={0}`) and the tooltip opens on
 *   focus, anchored to the row's bounding box instead of the pointer.
 * - 1.4.13 Dismissable: Escape hides the tooltip without moving focus or the
 *   pointer; the dismissal resets when the row is left/blurred.
 * - 1.4.13 Hoverable: leaving the row starts a short grace timer, and
 *   entering the tooltip surface cancels it, so the pointer can travel into
 *   the panel (spread `tooltipProps` onto the tooltip component).
 * - The row is linked to the visible tooltip via aria-describedby.
 *
 * Usage:
 *   const rowTooltip = useRowTooltip();
 *   <tr {...rowTooltip.rowProps(datum)}>…</tr>
 *   {rowTooltip.active && (
 *     <SomeRowTooltip data={rowTooltip.active} position={rowTooltip.position}
 *                     {...rowTooltip.tooltipProps} />
 *   )}
 */
export function useRowTooltip() {
  const id = useId();
  const [active, setActive] = useState(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  // Escape-dismissal latch: while set, hover/focus on the same row does not
  // re-open the tooltip. Cleared on leave/blur so the next visit works.
  const dismissedRef = useRef(false);
  const overTooltipRef = useRef(false);
  const hideTimerRef = useRef(null);

  const cancelHide = useCallback(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const scheduleHide = useCallback(() => {
    cancelHide();
    hideTimerRef.current = setTimeout(() => {
      if (!overTooltipRef.current) {
        setActive(null);
        dismissedRef.current = false;
      }
    }, HIDE_DELAY_MS);
  }, [cancelHide]);

  useEffect(() => cancelHide, [cancelHide]);

  const rowProps = useCallback((datum) => ({
    tabIndex: 0,
    'aria-describedby': active === datum ? id : undefined,
    onMouseEnter: (e) => {
      dismissedRef.current = false;
      cancelHide();
      setActive(datum);
      setPosition({ x: e.clientX, y: e.clientY });
    },
    onMouseMove: (e) => {
      if (!dismissedRef.current) {
        setPosition({ x: e.clientX, y: e.clientY });
      }
    },
    onMouseLeave: scheduleHide,
    onFocus: (e) => {
      // Keyboard path: anchor to the row itself, not a pointer position.
      dismissedRef.current = false;
      cancelHide();
      const rect = e.currentTarget.getBoundingClientRect();
      setActive(datum);
      setPosition({ x: rect.left + 60, y: rect.top + rect.height / 2 });
    },
    onBlur: scheduleHide,
    onKeyDown: (e) => {
      if (e.key === 'Escape') {
        dismissedRef.current = true;
        setActive(null);
      }
    },
  }), [active, id, cancelHide, scheduleHide]);

  const tooltipProps = {
    id,
    onMouseEnter: () => {
      overTooltipRef.current = true;
      cancelHide();
    },
    onMouseLeave: () => {
      overTooltipRef.current = false;
      scheduleHide();
    },
  };

  return { active, position, rowProps, tooltipProps };
}

export default useRowTooltip;
