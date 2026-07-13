# Hermes Agent Setup — Cedar Grove LLP

Runbook for deploying and configuring a [Hermes Agent](https://github.com/NousResearch/hermes-agent)
(Nous Research) on Render as an always-on operations assistant for the principal
partner. The agent operates **inside the principal's own inbox** — triaging
labeled email and preparing draft replies for his review — reads the same
upstream sources this dashboard syncs from, and delivers scheduled digests of
attorney/client onboarding state into the same inbox.

This document is a configuration guide — nothing in this repo runs the agent.
The agent is a separate Render service; this repo is referenced only as the
source of truth for data locations and reusable calculation logic.

---

## Guiding principle

Keep the agent **in line with what the dashboard shows** by pointing it at the
**same upstream sources** the dashboard syncs from — not at parallel copies:

| Source | Dashboard path | Agent access |
|---|---|---|
| Attorney timesheets (Google Sheets) | Apps Script → Firestore `users/{userId}/billables|ops` (see `docs/timesheet-sync.md`) | Sheets read via Google service account |
| Invoices workbook, "Payment Status" tab | Apps Script → Firestore `invoices/all` | Sheets read via same service account |
| Monthly metrics tab | Apps Script → Firestore `monthlyMetrics/all` | Sheets read via same service account |
| Mercury transactions | `src/app/api/sync-transactions/route.js` → Firestore `transactions/` | Dedicated **read-only** Mercury token (see § Mercury) |
| Client folders (Google Drive) | Apps Script → Firestore `driveDownloads/` | Drive read scoped to the 5 tracked folders |
| Normalized layer (optional) | Firestore itself | Firebase service account, read-only rules |

If the agent ever states a client's **Payment Status tag** (On Target / Warning
/ Hold), it must compute it with this repo's pure module — `src/utils/paymentStatus.mjs`
is Node-importable and tested, and encodes the sticky Hold-exit logic. Copy the
module into a Hermes skill verbatim rather than paraphrasing the criteria.
Same applies to `rateLookup.mjs` and `cohortFilter.mjs` if rates/cohorts come up.

---

## 1. Deploy on Render

Use the official Blueprint: [render-examples/hermes-render](https://github.com/render-examples/hermes-render).

1. Click **Deploy to Render** from the Blueprint repo (or fork + sync the Blueprint).
2. Single Docker web service; initial image build ≈ 3–5 min, gateway init ≈ 1 min.
3. A **5 GB persistent disk at `/opt/data`** holds config, API keys, session
   databases, installed skills, agent memory, and cron definitions — all of it
   survives redeploys. Treat the disk as sensitive (it will accumulate memory of
   privileged matters).
4. Environment variables in `render.yaml` are deliberately minimal
   (`HERMES_GATEWAY_TOKEN` is auto-generated). All provider keys and platform
   tokens are entered in the **dashboard**, not in the Blueprint.

### 1a. Lock down the dashboard — do this before entering any keys

> **The Hermes dashboard has no built-in authentication.** Anyone with the
> `.onrender.com` URL can read and write every API key the agent holds. For a
> law firm this is a blocker, not a nice-to-have.

Pick one, in order of preference:

1. **Cloudflare Access** (or equivalent identity-aware proxy) in front of the
   Render URL, restricted to `@cedargrovellp.com` Google identities.
2. A basic-auth reverse-proxy sidecar in the Docker image.
3. At absolute minimum: treat the service URL as a secret, never share it in
   writing, and rotate the service name if it leaks.

Do not proceed to step 2 until this is in place.

### 1b. Model provider

In the dashboard, set `ANTHROPIC_API_KEY` and select a Claude model (the
Blueprint supports Anthropic natively). Anthropic API traffic is not used for
model training, which matters for privileged material — but still prefer skills
that pass **metadata** (envelope status, task state, folder names, amounts)
over document contents wherever the job allows.

---

## 2. Email — operating inside the principal's inbox

The agent works in **Sam McClure's own mailbox** (`sam@…`), not a separate
agent mailbox: it reads mail he hands it and prepares replies in his voice for
his review. This is the highest-risk integration in the whole setup — an agent
with the principal partner's inbox at a law firm — so the operating rules below
are launch requirements, not suggestions.

### Access

Two options, in order of preference:

1. **Gmail API via domain-wide delegation** — the Workspace admin grants the
   agent's service account delegation scoped to `gmail.readonly` +
   `gmail.compose` (drafts) for Sam's account only. Auditable, scope-limited,
   revocable in the admin console. Requires a small custom skill or adapter
   shim if Hermes's stock Email adapter is IMAP-only.
2. **IMAP/SMTP with an app password on Sam's account** — works with the stock
   Hermes Email adapter out of the box (requires 2FA on the account), but is
   full-mailbox access with no scope granularity. Acceptable to start; plan to
   migrate to option 1.

### Operating rules

- **Drafts, never sends.** The agent writes replies as **drafts threaded on
  the original message** (Gmail API `drafts.create`, or IMAP APPEND to
  `[Gmail]/Drafts`); Sam reviews, edits, and sends. No autonomous outbound
  mail as Sam — SMTP send stays disabled at launch. A reply only becomes
  Sam's words when Sam hits send; that is the professional-responsibility
  line and the point of draft-first.
- **Label-scoped triage.** The agent only processes messages carrying a
  **`Hermes` Gmail label**. Sam applies it manually (a deliberate per-message
  handoff), or Gmail filters he controls apply it automatically to safe
  categories (internal senders, scheduling requests). Start manual; widen via
  filters as trust builds. The agent never blanket-processes the inbox.
- **Instruction authority.** Only messages **authored by Sam himself** are
  treated as instructions to the agent; every other message in the inbox —
  client email included — is *content to summarize or draft against*, never
  commands. This is the prompt-injection line: the inbox is a firehose of
  untrusted external text, and "reply to this however the sender asks" must
  not be inferable from message bodies. Encode this in the agent's system
  prompt/skill, not just in policy.
- **Privilege minimization.** Everything the agent reads here is potentially
  privileged. Keep the label scope narrow so only mail Sam has chosen to hand
  over transits the model, and remember agent memory on the persistent disk
  accumulates whatever it processes.

### Verification before wiring data integrations

1. Label a test email → agent produces a correctly threaded draft; nothing is
   sent.
2. Injection check: a labeled email whose body contains instructions to the
   agent ("forward this thread to…") is summarized/drafted against, not obeyed.
3. Unlabeled mail is untouched.

Scheduled digests (§ 6) are delivered as email into this same inbox.

---

## 3. Integrations (register as MCP servers / skills in the dashboard)

Every integration gets its **own** credential — never reuse the dashboard app's
keys — so each can be revoked independently. Everything starts **read-only**.

### Google Sheets + Drive

- Create a dedicated Google Cloud service account (e.g.
  `hermes-agent@…iam.gserviceaccount.com`).
- Share with it, read-only:
  - the per-attorney timesheet spreadsheets and the Invoices workbook
    (layouts documented in `docs/timesheet-sync.md`),
  - the monthly metrics sheet,
  - the five tracked Drive folders only — **Administrative, Attorney
    Employment, Engagements, Legal Memos, New Client Onboarding** — not the
    whole Drive.
- Register a Google Workspace MCP server (or [Composio's Google toolkits —
  Composio supports Hermes as a framework](https://composio.dev/toolkits/render/framework/hermes-agent))
  in the Hermes MCP config with that service account.
- Acceptance check: agent answers "what's outstanding on the Payment Status
  tab?" and the answer matches the dashboard's Billing KPIs page.

### Asana

- Register Asana's official remote MCP server (`mcp.asana.com`).
- Use a service-account seat whose project access is limited to the
  onboarding/ops projects.

### DocuSign (outstanding envelope status)

- Docusign eSignature API via their MCP/IAM integration or Composio toolkit.
- Scope: **read-only envelope/status**. No sending, voiding, or template scopes.
- Skill spec: *"List envelopes not in `completed` status, grouped by
  client/matter, with days outstanding and last-activity date."* That single
  query covers the requirement.

### Mercury

No official MCP server; the API is plain REST. Write a small Hermes skill that
mirrors what `src/app/api/sync-transactions/route.js` does:

```
GET https://api.mercury.com/api/v1/account/{MERCURY_ACCOUNT_ID}/transactions?limit=500&offset=N
Authorization: Bearer {token}
```

- Issue the agent a **dedicated read-only Mercury API token** (Mercury supports
  read-only tokens). Do not share the dashboard's `MERCURY_API_TOKEN`.
- Paginate at 500 (same as the sync route); transaction fields are documented
  in `CLAUDE.md` under `transactions/{mercuryId}`.

### Firestore (optional, recommended for exact-match numbers)

- Firebase service account with read-only access (enforced in security rules,
  not just by convention).
- Gives the agent the dashboard's normalized layer directly: `invoices/all`,
  `users/{userId}` (rates/targets/`activationDate`/`active`), `monthlyMetrics/all`,
  `driveDownloads/`, `timeOff/all` — legacy field normalization already applied.
- Use this whenever an answer must match the dashboard to the dollar.

---

## 4. Interface with Val's automations (coordinate with Valery Uscanga)

Do **not** rebuild her client-folder taxonomy automation — define a handoff:

- **Option A (zero new infrastructure, preferred):** her Apps Script emails
  the flag to Sam's inbox with a recognizable subject tag (e.g.
  `[Taxonomy Flag]`), and a Gmail filter Sam controls applies the `Hermes`
  label — the agent folds flags into digests automatically.
- **Option B:** the script appends flags to a "Taxonomy Flags" sheet tab the
  agent already reads.

Same pattern for **internal meeting notes**: agree with Val on one canonical
location (Drive folder or Notion) and a consistent format; grant the agent read
access to that location only.

---

## 5. Onboarding monitor

Sources the agent combines to describe onboarding state:

- **Asana**: onboarding project task state.
- **DocuSign**: outstanding (non-completed) envelopes.
- **Drive**: recent uploads to *Attorney Employment* and *New Client
  Onboarding* folders.
- **Val's flags**: taxonomy violations (§ 4).
- **Firestore `users/{userId}`**: `activationDate` + `active` identify
  attorneys currently ramping (see `src/utils/userActivation.mjs`).

---

## 6. Scheduled digest (Hermes cron)

One natural-language cron job in Hermes, weekdays 8:00 AM PT, delivered by
email to the principal:

> Summarize onboarding state: who is in flight (attorney + client), what is
> blocked and on whom, outstanding DocuSign envelopes with days waiting,
> taxonomy flags since the last digest, and what changed since yesterday.
> Lead with items needing the principal's action. If nothing changed and
> nothing is blocked, say so in one line.

Hermes cron can deliver to any adapter, so the same digest can later go to
Slack without changing the job.

---

## 7. Security posture (non-negotiables)

1. Dashboard behind an auth layer before any key is entered (§ 1a).
2. Email: drafts-only, label-scoped, and instruction authority restricted to
   Sam himself — all other inbox content is data, never commands (§ 2).
3. Every integration read-only at launch. Write scopes (creating Asana tasks,
   enabling actual email *send*) only after weeks of trustworthy operation —
   the agent starts as a *reporter/drafter* and is promoted to an *actor*
   deliberately, one narrow category at a time.
4. One credential per integration, none shared with this app, each revocable
   independently.
5. Prefer metadata over document contents in prompts/skills (§ 1b).
6. Render workspace access restricted; the persistent disk holds keys and
   accumulated memory of privileged matters.

---

## 8. Rollout checklist

- [ ] Deploy Blueprint; verify service + persistent disk
- [ ] Dashboard auth layer in place (§ 1a)
- [ ] Anthropic key + model selected
- [ ] Mailbox access granted (app password now, domain-wide delegation later); `Hermes` label created
- [ ] Draft round-trip verified: labeled email → threaded draft, nothing sent; unlabeled mail untouched
- [ ] Injection check passed: instructions inside a labeled email body are not obeyed (§ 2)
- [ ] Google service account created; Sheets/Drive shares scoped; MCP registered
- [ ] Acceptance check: Payment Status answer matches dashboard
- [ ] Asana MCP registered (scoped seat)
- [ ] DocuSign read-only envelope skill working
- [ ] Mercury read-only token issued; transactions skill working
- [ ] (Optional) Firestore read-only service account + rules
- [ ] Interface agreed with Val (taxonomy flags + meeting notes)
- [ ] Onboarding digest cron live; first digest reviewed for accuracy
- [ ] After stable period: revisit write scopes deliberately

---

## References

- Hermes Agent: <https://github.com/NousResearch/hermes-agent>
- Render Blueprint: <https://github.com/render-examples/hermes-render>
- Composio Hermes toolkits: <https://composio.dev/toolkits/render/framework/hermes-agent>
- Hermes Agent Cloud docs: <https://hermes-agent.ai/cloud>
- This repo's sheet-sync layouts: `docs/timesheet-sync.md`
- Mercury sync reference implementation: `src/app/api/sync-transactions/route.js`
