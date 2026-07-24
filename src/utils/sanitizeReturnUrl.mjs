// SEC-009: validate returnUrl as same-origin before passing to router.push.
// Cross-origin, protocol-relative (//evil), backslash-trick (/\evil), and
// non-http(s) schemes (javascript:) all collapse to '/'. `new URL(..., origin)`
// is the canonicalization; the post-parse origin compare is the authoritative
// gate, with the prefix re-check as defense-in-depth against edge cases that
// survive URL parsing.
export function sanitizeReturnUrl(rawReturnUrl, origin) {
  const candidate = rawReturnUrl.trim() || '/';

  try {
    const url = new URL(candidate, origin);

    if (url.origin !== origin) return '/';

    const safe = url.pathname + url.search + url.hash;

    if (
      !safe.startsWith('/') ||
      safe.startsWith('//') ||
      safe.includes('\\')
    ) {
      return '/';
    }

    return safe || '/';
  } catch {
    return '/';
  }
}
