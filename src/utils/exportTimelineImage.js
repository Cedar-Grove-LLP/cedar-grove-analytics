// Browser-only helpers for exporting the Tech Team chevron timeline graphic
// (components/charts/TechTeamChevronTimeline.jsx) to a PNG or SVG file.
//
// Deliberately `.js`, not `.mjs`: every function here touches browser-only
// globals (XMLSerializer, Blob, URL, Image, document, canvas), so this module
// is not plain-Node-importable and gets no `node --test` coverage — per the
// project convention that `.mjs` is reserved for pure, Node-importable
// modules (see CLAUDE.md "Conventions" / "Testing").
//
// Why this serializes/rasterizes losslessly, and why the canvas is never
// tainted:
//   - Every fill/stroke/font on the graphic is a literal presentational
//     attribute (fill="#...", fontFamily="ui-sans-serif, system-ui, ...",
//     etc.) set directly on each SVG element, never a CSS class or custom
//     property — so the exported file renders identically whether opened
//     standalone (no Tailwind stylesheet attached) or drawn into <canvas>.
//   - The SVG carries its own opaque white background <rect> covering the
//     full canvas, so there is no transparency to lose when rasterized.
//   - There are no external references anywhere in the graphic — no
//     <image>/xlink:href, no CSS url(), no @font-face — only inline,
//     system-font-stack text and vector shapes. A canvas is only "tainted"
//     (toBlob/toDataURL throwing a SecurityError) by drawing image data
//     sourced from a cross-origin resource; since nothing here is fetched
//     from anywhere, the blob: URL used below is same-origin and the canvas
//     stays fully readable.
//   - The <svg> sets explicit pixel `width`/`height` attributes (not just a
//     viewBox), which is what lets an <img> displaying that SVG report a
//     correct natural size in every browser (notably avoiding a Safari
//     quirk where sizeless SVG-in-<img> falls back to a 300x150 default).
//   - Serializing to a Blob + object URL (rather than a base64 data: URI)
//     sidesteps the classic "btoa throws on non-Latin1 characters" pitfall
//     for commit messages/author names containing non-ASCII text.

import { toDateKey } from './dateHelpers';

function assertSvgElement(svgEl) {
  if (!svgEl || typeof svgEl.cloneNode !== 'function' || svgEl.tagName?.toLowerCase() !== 'svg') {
    throw new Error("The timeline graphic isn't available to export right now.");
  }
}

/**
 * Serialize a live <svg> DOM node into a standalone, self-contained SVG Blob
 * — safe to save and reopen outside the page. Adds an XML declaration and
 * ensures the xmlns/xmlns:xlink attributes are present, since a standalone
 * SVG file needs them explicitly (the live node already has xmlns set, but
 * this defends against that ever changing upstream).
 *
 * @param {SVGSVGElement} svgEl
 * @returns {Blob}
 */
export function svgElementToSvgBlob(svgEl) {
  assertSvgElement(svgEl);
  const clone = svgEl.cloneNode(true);
  if (!clone.getAttribute('xmlns')) clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  if (!clone.getAttribute('xmlns:xlink')) clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');

  let markup;
  try {
    markup = new XMLSerializer().serializeToString(clone);
  } catch {
    throw new Error("Couldn't prepare the timeline graphic for export.");
  }
  return new Blob([`<?xml version="1.0" standalone="no"?>\n${markup}`], {
    type: 'image/svg+xml;charset=utf-8',
  });
}

// The chevron graphic always sets explicit width/height attributes (see file
// header), so the getBoundingClientRect() branch below is defensive only —
// not exercised in practice.
function readSvgPixelSize(svgEl) {
  const width = Number(svgEl.getAttribute('width'));
  const height = Number(svgEl.getAttribute('height'));
  if (Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) {
    return { width, height };
  }
  const rect = typeof svgEl.getBoundingClientRect === 'function' ? svgEl.getBoundingClientRect() : null;
  if (rect && rect.width > 0 && rect.height > 0) return { width: rect.width, height: rect.height };
  throw new Error("Couldn't determine the timeline graphic's size for export.");
}

/**
 * Rasterize a live <svg> DOM node to a PNG Blob at `scale`x pixel density
 * (default 2x, for a crisp, print-friendly export). Always resolves/rejects
 * — never throws synchronously — so callers can rely on a single `.catch`/
 * `try+await`.
 *
 * @param {SVGSVGElement} svgEl
 * @param {{ scale?: number }} [options]
 * @returns {Promise<Blob>}
 */
export function svgElementToPngBlob(svgEl, { scale = 2 } = {}) {
  return new Promise((resolve, reject) => {
    let width, height, svgUrl;
    try {
      assertSvgElement(svgEl);
      ({ width, height } = readSvgPixelSize(svgEl));
      svgUrl = URL.createObjectURL(svgElementToSvgBlob(svgEl));
    } catch (err) {
      reject(err instanceof Error ? err : new Error("Couldn't prepare the timeline graphic for export."));
      return;
    }

    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(svgUrl);
      try {
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(width * scale));
        canvas.height = Math.max(1, Math.round(height * scale));
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error("Couldn't create a canvas to render the PNG export."));
          return;
        }
        ctx.scale(scale, scale);
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob((blob) => {
          if (!blob) {
            reject(new Error("Couldn't generate a PNG image from the timeline graphic."));
            return;
          }
          resolve(blob);
        }, 'image/png');
      } catch {
        reject(new Error("Couldn't render the timeline graphic to PNG."));
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(svgUrl);
      reject(new Error("Couldn't load the timeline graphic image for PNG export."));
    };

    img.src = svgUrl;
  });
}

/**
 * Trigger a browser file download of `blob` named `filename` via a
 * temporary, invisible anchor click, then clean up the anchor and object URL.
 *
 * @param {Blob} blob
 * @param {string} filename
 */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  // Deferred revoke: revoking synchronously can race the browser actually
  // starting the download in some engines.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function sanitizeFilenameSegment(text) {
  const cleaned = String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || 'export';
}

/**
 * Build the export filename `cedar-grove-tech-team-<range>-<yyyy-mm-dd>.<ext>`,
 * sanitizing the (human-readable) date-range label into a filesystem-safe
 * slug — e.g. "Current Month (Jun 1 - Jun 30, 2026)" -> "current-month-jun-1
 * -jun-30-2026". The trailing date is today's local calendar date (the
 * export date), not the range's own start/end.
 *
 * @param {string} rangeLabel
 * @param {string} extension - 'png' | 'svg'
 * @returns {string}
 */
export function buildTimelineExportFilename(rangeLabel, extension) {
  const rangePart = sanitizeFilenameSegment(rangeLabel);
  const datePart = toDateKey(new Date());
  return `cedar-grove-tech-team-${rangePart}-${datePart}.${extension}`;
}
