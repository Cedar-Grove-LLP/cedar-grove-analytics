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

  // Clear any pending hide timer on unmount.
  useEffect(() => () => clearTimeout(hideTimerRef.current), []);

  // Not memoized on purpose: the props object is rebuilt per row per render
  // either way, and depending on `active` would churn the identity anyway —
  // a useCallback here would only imply a stability it can't deliver.
  const rowProps = (datum) => ({
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
      // Focus events bubble from the row's inner links/buttons — do NOT
      // clear the Escape latch here, or tabbing to a child of a dismissed
      // row would instantly re-open the tooltip (1.4.13 regression). The
      // latch is cleared on mouseenter, on leaving the row, and on hide.
      if (dismissedRef.current) return;
      cancelHide();
      const rect = e.currentTarget.getBoundingClientRect();
      setActive(datum);
      setPosition({ x: rect.left + 60, y: rect.top + rect.height / 2 });
    },
    onBlur: (e) => {
      // Blur also bubbles on focus moves BETWEEN the row and its children —
      // only treat it as leaving when focus lands outside the row.
      if (e.currentTarget.contains(e.relatedTarget)) return;
      dismissedRef.current = false;
      scheduleHide();
    },
    onKeyDown: (e) => {
      if (e.key === 'Escape' && active !== null) {
        dismissedRef.current = true;
        // The panel unmounts without firing its own mouseleave, so the
        // over-tooltip flag must be reset here or every later scheduleHide
        // would no-op and tooltips would never close again.
        overTooltipRef.current = false;
        setActive(null);
        // The Escape consumed a dismissal — don't also close an enclosing
        // Escape-dismissable container in the same keypress.
        e.stopPropagation();
      }
    },
  });

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
