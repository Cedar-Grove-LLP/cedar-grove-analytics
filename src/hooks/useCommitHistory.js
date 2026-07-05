"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { auth, waitForAuth } from "@/firebase/config";

// Client-side cache for the repo commit history.
//
// The full commit list is pulled from /api/commit-history exactly once and then
// reused: it is held in component state AND mirrored to localStorage with a TTL,
// so a page refresh within the window does NOT re-pull from GitHub. Date-range
// filtering happens downstream (in the view, via useMemo) against this cached
// list — changing the range never triggers a network request. `refresh()`
// forces a fresh pull and busts both the localStorage and server caches.

const CACHE_KEY = "cg_commit_history_v2"; // v2: cache payload gained `truncated`
const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1 hour

function readCache(ttlMs) {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.fetchedAt || !Array.isArray(parsed.commits)) return null;
    if (Date.now() - new Date(parsed.fetchedAt).getTime() > ttlMs) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(payload) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
  } catch {
    // Ignore quota / serialization errors — the in-memory copy still works.
  }
}

export function useCommitHistory({ ttlMs = DEFAULT_TTL_MS } = {}) {
  const [commits, setCommits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [fetchedAt, setFetchedAt] = useState(null);
  const [meta, setMeta] = useState({ repo: null, tokenConfigured: null });
  const [fromCache, setFromCache] = useState(false);
  const [partial, setPartial] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const didInit = useRef(false);

  const load = useCallback(
    async ({ force = false } = {}) => {
      setLoading(true);
      setError(null);

      if (!force) {
        const cached = readCache(ttlMs);
        if (cached) {
          setCommits(cached.commits);
          setFetchedAt(cached.fetchedAt);
          setMeta({
            repo: cached.repo ?? null,
            tokenConfigured: cached.tokenConfigured ?? null,
          });
          setFromCache(true);
          setPartial(false); // cached payloads are always complete
          setTruncated(cached.truncated === true);
          setLoading(false);
          return;
        }
      }

      try {
        // Wait for Firebase to restore the session before reading currentUser —
        // on a hard refresh the SDK hydrates auth state asynchronously, so
        // auth.currentUser can briefly be null even inside ProtectedRoute.
        await waitForAuth();
        const currentUser = auth.currentUser;
        if (!currentUser) throw new Error("You are not signed in.");
        const idToken = await currentUser.getIdToken();

        const res = await fetch(
          `/api/commit-history${force ? "?refresh=1" : ""}`,
          { headers: { Authorization: `Bearer ${idToken}` } }
        );
        const data = await res.json();
        if (!res.ok || !data.success || !Array.isArray(data.commits)) {
          throw new Error(data && data.error ? data.error : `Request failed (${res.status})`);
        }

        setCommits(data.commits);
        setFetchedAt(data.fetchedAt);
        setMeta({ repo: data.repo, tokenConfigured: data.tokenConfigured });
        setFromCache(false);
        setPartial(data.partial === true);
        setTruncated(data.truncated === true);
        // Never cache a partial (failed-mid-pagination) history — it would
        // serve an incomplete list as authoritative for the whole TTL.
        // `truncated` (hit the pagination safety cap, but every page fetched
        // succeeded) IS still a complete, valid response, so it's cached.
        if (!data.partial) {
          writeCache({
            fetchedAt: data.fetchedAt,
            commits: data.commits,
            repo: data.repo,
            tokenConfigured: data.tokenConfigured,
            truncated: data.truncated === true,
          });
        }
      } catch (err) {
        setError(err.message || "Failed to load commit history.");
      } finally {
        setLoading(false);
      }
    },
    [ttlMs]
  );

  useEffect(() => {
    // Guard against React 18/19 StrictMode double-invoke in dev.
    if (didInit.current) return;
    didInit.current = true;
    load();
  }, [load]);

  const refresh = useCallback(() => load({ force: true }), [load]);

  return { commits, loading, error, fetchedAt, meta, fromCache, partial, truncated, refresh };
}
