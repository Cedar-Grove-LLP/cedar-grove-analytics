import { getAdminAuth } from "@/firebase/admin";
import { DEFAULT_GITHUB_REPO } from "@/utils/constants";

// GET /api/commit-history
// Returns the repo's commit history (newest first) pulled from the GitHub REST
// API. The repository is public, so GITHUB_TOKEN is OPTIONAL — it is only used
// to raise GitHub's rate limit (60/hr unauthenticated → 5000/hr authenticated).
//
// The endpoint is gated the same way as /api/sync-transactions: a verified
// Firebase ID token from a @cedargrovellp.com user. This keeps it from being an
// open proxy that burns the shared GitHub rate limit, and matches the app's
// domain-restricted posture. GitHub responses are cached in Next's data cache
// (revalidate window) so we don't pull on every request; the client adds a
// localStorage layer on top, and `?refresh=1` busts both.

const ALLOWED_EMAIL_DOMAIN = "cedargrovellp.com";
const PER_PAGE = 100;
const MAX_PAGES = 20; // safety cap (≤ 2000 commits)
const REVALIDATE_SECONDS = 3600; // 1h server-side cache for GitHub responses

const json = (body, status = 200) => Response.json(body, { status });
const unauthorized = () => json({ success: false, error: "Unauthorized" }, 401);
const forbidden = () => json({ success: false, error: "Forbidden" }, 403);

export async function GET(request) {
  // ---------------------------------------------------------------------------
  // 1. Authentication: require Authorization: Bearer <Firebase ID token>.
  // ---------------------------------------------------------------------------
  const authHeader = request.headers.get("authorization") || "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) return unauthorized();
  const idToken = authHeader.slice(7).trim();
  if (!idToken) return unauthorized();

  let decoded;
  try {
    decoded = await getAdminAuth().verifyIdToken(idToken, true);
  } catch (err) {
    console.warn(
      "commit-history: token verification failed:",
      err && err.code ? err.code : "unknown"
    );
    return unauthorized();
  }

  const email =
    typeof decoded.email === "string" ? decoded.email.toLowerCase() : null;
  if (!email || decoded.email_verified !== true) return forbidden();
  if (!email.endsWith(`@${ALLOWED_EMAIL_DOMAIN}`)) return forbidden();

  // ---------------------------------------------------------------------------
  // 2. Fetch commits from GitHub. Token optional (public repo).
  // ---------------------------------------------------------------------------
  const repo = process.env.GITHUB_REPO || DEFAULT_GITHUB_REPO;
  const token = process.env.GITHUB_TOKEN || process.env.GITHUB_PAT || "";
  const forceRefresh =
    new URL(request.url).searchParams.get("refresh") === "1";

  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    // GitHub requires a User-Agent or it rejects the request with 403.
    "User-Agent": "cedar-grove-analytics",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  try {
    const commits = [];
    // True when GitHub failed partway through pagination and we return only the
    // pages collected so far. Clients use this to avoid caching an incomplete
    // history as if it were complete.
    let partial = false;
    // True when pagination hit the MAX_PAGES safety cap while GitHub still had
    // a full page left to give (i.e. every page fetched succeeded, but there
    // may be older commits beyond the cap). Unlike `partial`, this is a
    // complete-and-valid response — just capped — so it's still cached.
    let truncated = false;

    for (let page = 1; page <= MAX_PAGES; page++) {
      const url = `https://api.github.com/repos/${repo}/commits?per_page=${PER_PAGE}&page=${page}`;
      const res = await fetch(url, {
        headers,
        ...(forceRefresh
          ? { cache: "no-store" }
          : { next: { revalidate: REVALIDATE_SECONDS } }),
      });

      if (!res.ok) {
        const status = res.status;
        let hint = `GitHub API error: ${status}`;
        if (status === 404) {
          hint =
            "Repository not found, or it is private and GITHUB_TOKEN is missing/insufficient.";
        } else if (status === 403 || status === 429) {
          hint = "GitHub rate limit reached. Set GITHUB_TOKEN to raise the limit.";
        } else if (status === 401) {
          hint = "GITHUB_TOKEN is invalid.";
        }
        console.error(`commit-history: ${hint} (page ${page})`);
        // If earlier pages already succeeded, return what we have rather than
        // failing the whole request — but flag it as partial so the client
        // surfaces a warning and does NOT cache it.
        if (commits.length > 0) {
          partial = true;
          break;
        }
        return json({ success: false, error: hint }, 502);
      }

      const batch = await res.json();
      if (!Array.isArray(batch) || batch.length === 0) break;

      for (const c of batch) {
        const gitCommit = c.commit || {};
        const authorMeta = gitCommit.author || {};
        const committerMeta = gitCommit.committer || {};
        const message = (gitCommit.message || "").split("\n")[0].trim();
        commits.push({
          sha: c.sha || "",
          date: authorMeta.date || committerMeta.date || null,
          author: authorMeta.name || (c.author && c.author.login) || "Unknown",
          message,
          isMerge: Array.isArray(c.parents) && c.parents.length > 1,
        });
      }

      if (batch.length < PER_PAGE) break; // last page

      // A full-size batch on the last page the safety cap allows means GitHub
      // likely has more — we stopped because of MAX_PAGES, not because we
      // ran out of commits.
      if (page === MAX_PAGES) truncated = true;
    }

    return json({
      success: true,
      partial,
      truncated,
      repo,
      total: commits.length,
      tokenConfigured: Boolean(token),
      fetchedAt: new Date().toISOString(),
      commits,
    });
  } catch (err) {
    console.error(
      "commit-history: unexpected error:",
      err && err.message ? err.message : "unknown"
    );
    return json({ success: false, error: "Failed to load commit history." }, 500);
  }
}
