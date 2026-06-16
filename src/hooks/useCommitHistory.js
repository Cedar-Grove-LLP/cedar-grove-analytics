"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { auth } from "@/firebase/config";

// Client-side cache for the repo commit history.
//
// The full commit list is pulled from /api/commit-history exactly once and then
// reused: it is held in component state AND mirrored to localStorage with a TTL,
// so a page refresh within the window does NOT re-pull from GitHub. Date-range
// filtering happens downstream (in the view, via useMemo) against this cached
// list — changing the range never triggers a network request. `refresh()`
// forces a fresh pull and busts both the localStorage and server caches.

const CACHE_KEY = "cg_commit_history_v1";
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
          setLoading(false);
          return;
        }
      }

      try {
        const currentUser = auth.currentUser;
        if (!currentUser) throw new Error("You are not signed in.");
        const idToken = await currentUser.getIdToken();

        const res = await fetch(
          `/api/commit-history${force ? "?refresh=1" : ""}`,
          { headers: { Authorization: `Bearer ${idToken}` } }
        );
        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data && data.error ? data.error : `Request failed (${res.status})`);
        }

        setCommits(data.commits);
        setFetchedAt(data.fetchedAt);
        setMeta({ repo: data.repo, tokenConfigured: data.tokenConfigured });
        setFromCache(false);
        writeCache({
          fetchedAt: data.fetchedAt,
          commits: data.commits,
          repo: data.repo,
          tokenConfigured: data.tokenConfigured,
        });
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

  return { commits, loading, error, fetchedAt, meta, fromCache, refresh };
}
