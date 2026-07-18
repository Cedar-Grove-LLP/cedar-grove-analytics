# Hermes Agent Deployment Framework — Cedar Grove LLP

Standardized process for deploying and configuring Hermes agents
([NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent)) for
this organization. Derived from the live deployment of the first agent (the
principal's ops assistant — see `docs/hermes-agent-setup.md` for that agent's
full runbook and integration plan).

**How to use this document:** paste it (or reference it) as the starting
instructions for a new Claude Code session, together with a filled-in copy of
the *Per-Agent Worksheet* (§ 9) describing the specific agent to build. The
framework covers the chassis — infrastructure, security, process; the
worksheet covers the agent's job.

---

## 0. Where things live (read first in a new session)

- **Canonical docs**: this file and the per-agent runbooks live in
  `Cedar-Grove-LLP/cedar-grove-analytics` under `docs/`. As of this writing
  they are on branch **`claude/hermes-cedar-grove-agent-c3zior`**, not yet
  merged to `main` — a fresh clone of `main` will NOT contain them. Fetch
  that branch first (`git fetch origin claude/hermes-cedar-grove-agent-c3zior`)
  and treat the in-repo copy as canonical over any pasted copy, which may be
  stale. (Once the branch merges, strike this paragraph.)
- **Repo quirk**: `docs/` is in `.gitignore`; tracked docs are force-added
  (`git add -f docs/<file>.md`) — the established convention in this repo.
  You must force-add when updating the fleet inventory or adding a runbook.
- **DigitalOcean account**: team account "My Team", owner
  `valyria@cedargrovellp.com` (Val). Account-level actions route through
  her: she receives droplet root-password emails, holds billing, and can
  edit firewalls from the DO console. The deploy credential is a
  `DIGITALOCEAN_TOKEN` env var per § 2.
- **Shared-account warning**: the org's cloud accounts contain non-agent
  resources (see fleet inventory, § 10). Never assume everything in an
  account belongs to this program.

## 1. Architecture standard

Every Cedar Grove Hermes agent is deployed the same way:

- **One DigitalOcean droplet per agent** (`s-1vcpu-2gb`, Ubuntu 24.04,
  ~$12/mo). One agent per droplet — never co-host: agents differ in
  privileges and memory scope, and isolation is the point.
- **One block-storage volume per agent** (10 GB ext4, ~$1/mo) mounted at
  `/opt/data` — all agent state (config, `.env` keys, memory, skills, cron
  definitions). **Compute is cattle, the volume is the pet**: host-level
  changes are made by destroying and recreating the droplet with updated
  cloud-init, never by hand-editing a live host. The volume carries state
  across rebuilds.
- **One cloud firewall per agent**: inbound **deny-all except TCP 10000
  (dashboard) from explicitly allowlisted IPs**. The Hermes dashboard has no
  authentication of its own — the firewall IS the auth layer. SSH (22)
  closed; DigitalOcean's web console is the out-of-band access path.
- **Image**: built from
  [render-examples/hermes-render](https://github.com/render-examples/hermes-render)
  (pins upstream `nousresearch/hermes-agent` + dashboard/TUI fixes that
  hosted deploys need). The Render-specific skill bundle inside is inert
  without a Render key. Container runs with `--restart unless-stopped`.
- **The agent never receives credentials to its own infrastructure** (no DO
  token, no Render key). Infra control stays with human operators and
  deploy sessions.

Region: `sfo3` by default (keep all agents in one region so volumes/droplets
stay portable between rebuilds).

## 2. What a new deploy session needs from the operator

1. **`DIGITALOCEAN_TOKEN`** env var, set in the Claude Code environment
   settings (not pasted in chat). **Set it before starting the session** —
   variables are injected at container start, and a mid-session change does
   not reach the running container reliably.
2. **Network policy** on the Claude environment must allow
   `api.digitalocean.com` (plus `raw.githubusercontent.com` /
   `github.com` for fetching build files). Health checks on droplets go to a
   raw IP — if the policy is domain-scoped, expect to verify health via the
   operator's browser instead.
3. **The Per-Agent Worksheet** (§ 9), filled in.
4. Awareness that **billing must already exist** on the DO team account —
   droplet creation fails with 402-equivalent errors otherwise. No free tier.

## 3. Deployment procedure

All calls: `curl -H "Authorization: Bearer $DIGITALOCEAN_TOKEN"` against
`https://api.digitalocean.com/v2`. Replace `AGENT` with the agent's short
name (e.g. `hermes-kb`).

1. **Validate**: `GET /v2/account` → expect `"status": "active"` and a
   nonzero `droplet_limit`.
2. **Generate a gateway token** (`openssl rand -hex 32`), keep out of chat;
   it goes into cloud-init only.
3. **Create the volume** (pre-formatted, so cloud-init never needs mkfs):
   `POST /v2/volumes` with
   `{"size_gigabytes":10, "name":"AGENT-data", "region":"sfo3",
   "filesystem_type":"ext4"}`.
4. **Create the droplet** with this cloud-init `user_data` (template — fill
   the token; add agent-specific env vars as needed):

   ```bash
   #!/bin/bash
   exec >> /var/log/hermes-provision.log 2>&1
   set -ux
   export DEBIAN_FRONTEND=noninteractive
   # Wait up to 5 min for the DO volume (attach happens after create — race is normal)
   DEV=/dev/disk/by-id/scsi-0DO_Volume_AGENT-data
   for i in $(seq 1 60); do [ -e "$DEV" ] && break; sleep 5; done
   mkdir -p /opt/data
   if [ -e "$DEV" ]; then
     echo "$DEV /opt/data ext4 defaults,nofail,discard 0 2" >> /etc/fstab
     mount -a
   fi
   curl -fsSL https://get.docker.com | sh   # get.docker.com, NOT apt docker.io (buildx needed)
   apt-get install -y git
   # PIN the build to a commit SHA — an unpinned build tracks the Blueprint
   # repo's main, so two rebuilds can silently produce different Hermes
   # versions. Vet + bump the SHA deliberately; record it in the runbook.
   # Known-good as of 2026-07-15: d3f00670418d7d9eee1c125124dc1dcb7c2bbbd4
   docker build -t hermes-agent https://github.com/render-examples/hermes-render.git#<PINNED_SHA>
   docker run -d --name hermes --restart unless-stopped \
     -p 10000:10000 -v /opt/data:/opt/data \
     -e HERMES_DASHBOARD=1 -e HERMES_DASHBOARD_HOST=0.0.0.0 \
     -e HERMES_DASHBOARD_PORT=10000 -e HERMES_DASHBOARD_TUI=1 \
     -e HERMES_GATEWAY_TOKEN=__GATEWAY_TOKEN__ \
     hermes-agent
   ```

   `POST /v2/droplets` with `{"name":"AGENT", "region":"sfo3",
   "size":"s-1vcpu-2gb", "image":"ubuntu-24-04-x64", "user_data": <script>,
   "monitoring":true, "tags":["hermes"]}`. Without an SSH key, DO emails the
   account owner a root password (console access only — fine).
5. **Attach the volume**: `POST /v2/volumes/{volume_id}/actions` with
   `{"type":"attach","droplet_id":<id>,"region":"sfo3"}`. The user_data
   wait-loop absorbs the attach race.
6. **Create the firewall** — gotcha: the **ICMP rule must have no `ports`
   field** (the API rejects `"ports":"all"` for ICMP):

   ```json
   { "name": "AGENT-fw",
     "inbound_rules": [
       { "protocol": "tcp", "ports": "10000",
         "sources": { "addresses": ["<allowlisted-ip>/32"] } } ],
     "outbound_rules": [
       { "protocol": "tcp",  "ports": "all", "destinations": { "addresses": ["0.0.0.0/0", "::/0"] } },
       { "protocol": "udp",  "ports": "all", "destinations": { "addresses": ["0.0.0.0/0", "::/0"] } },
       { "protocol": "icmp", "destinations": { "addresses": ["0.0.0.0/0", "::/0"] } } ],
     "droplet_ids": [<droplet_id>] }
   ```

   Seed the allowlist with the deploy session's egress IP
   (`curl https://api.ipify.org`) so the session can verify health.
   **Session-IP hygiene:** every Claude session may have a different egress
   IP — a maintenance session's first firewall action is adding its own IP;
   its last is pruning it (stale `/32` entries from dead sessions are
   dormant open doors). Human viewers' IPs stay; label which is which by
   keeping a note in the runbook.
7. **Verify health** — two Claude-remote-session gotchas:
   - Plain `http://IP:10000` fails with **HTTP 405** (the sandbox proxy
     rejects non-CONNECT plain HTTP). Use a forced tunnel:
     `curl --proxytunnel -x "$HTTPS_PROXY" http://<ip>:10000/api/status`.
   - **502 "upstream request failed" means "not up yet"**, not "blocked" —
     the Docker build takes 5–15 min on 1 vCPU. Poll in a background loop
     (~20 s interval) until `200`.
   - Healthy response: JSON with `"gateway_running": true`,
     `"gateway_state": "running"`, `hermes_home: "/opt/data"`.
8. **Confirm the volume actually attached**
   (`GET /v2/volumes/{id}` → `droplet_ids` contains the droplet) so state is
   volume-backed, not droplet-local.
9. **Record the deployment** in the agent's runbook doc in this repo
   (pattern: `docs/hermes-agent-setup.md`): droplet id, region, volume,
   firewall, cost, gaps. **Never write the dashboard URL/IP+port pairing or
   any token into the repo** — with an unauthenticated dashboard, reachability
   info is credential-equivalent. Service IDs are fine.

## 4. Security invariants (every agent, no exceptions)

1. **Dashboard is unauthenticated** → it must never be reachable from
   0.0.0.0/0. Firewall allowlist always; Cloudflare Access / reverse-proxy
   auth when a domain exists.
2. **No TLS until a domain is fronted** → until then, **no real secrets
   transit the dashboard** (plain HTTP). Secrets reach the agent by baking
   them into `/opt/data/.env` via droplet recreate, or after TLS exists.
3. **Secrets flow through environment settings**, never chat transcripts,
   never git. Gateway tokens and keys live in cloud-init/env only.
4. **One credential per integration, least privilege, read-only first.**
   An agent starts as a reporter/drafter; write scopes (sending email,
   creating tasks) are granted deliberately, one narrow capability at a
   time, after a trust period.
5. **Model key belongs to the agent's end user** (their usage, their bill),
   set as `ANTHROPIC_API_KEY`. Prefer the Anthropic API for privileged
   material; pass metadata rather than document contents where the job
   allows.
6. **Instruction authority**: for any agent exposed to external content
   (email, shared inboxes, uploaded docs), only the designated human
   principal's messages are commands; all other content is data to
   process. Encode this in the agent's system prompt/skills, and test it
   before launch (an email/document containing instructions must be
   summarized, not obeyed). This is the prompt-injection line.
7. **The agent never holds keys to its own infrastructure.**
8. **Cloud hygiene**: before deleting/suspending anything, list resources
   and verify you created them this session — shared accounts contain other
   people's services (e.g. `cedar-grove-redline` on the Render account —
   not ours, never touch). Prefer suspend over delete when
   decommissioning; it's reversible.
9. **Law-firm confidentiality baseline**: assume anything an agent touches
   may be client-confidential or privileged. Consequences: Anthropic API
   only for model calls (API traffic is not used for training); narrowest
   possible data scope per integration; a deliberate memory-retention
   decision per agent *before* launch (worksheet line — an agent's `/opt/data`
   accumulates whatever it processes); and volumes/snapshots are treated as
   confidential records, including at decommission time (§ 6).

## 5. Post-deploy configuration order

1. Firewall allowlist for the humans who need dashboard access.
2. (Recommended before regular use) Domain + TLS: DNS record →
   `AGENT.cedargrovellp.com`, Caddy or Cloudflare in front; enables safe
   dashboard use and Cloudflare Access.
3. `ANTHROPIC_API_KEY` (from the agent's end user) → into `/opt/data/.env`
   per invariant § 4.2; select model; smoke-test chat via the dashboard TUI
   tab.
4. Messaging platform(s) per worksheet (email rules for inbox-embedded
   agents live in `docs/hermes-agent-setup.md` § 2 — drafts-only,
   label-scoped, instruction authority).
5. Data integrations per worksheet, read-only, one at a time, each with an
   acceptance check against its source of truth.
6. Cron jobs (digests etc.) last, once their inputs exist.

## 6. Lifecycle: rebuilds, upgrades, monitoring, decommission

- **Rebuild** (the only way to change host config or bake secrets into
  `/opt/data/.env`): snapshot the volume first
  (`POST /v2/volumes/{id}/snapshots`) → destroy the droplet (volume
  survives; it is a separate resource) → recreate with updated `user_data`
  → re-attach the volume → verify health → delete the snapshot once stable.
  ~10 minutes of downtime; agent state persists.
- **Gateway token lifecycle**: regenerated per rebuild — nothing depends on
  it persisting *unless* the OpenAI-compatible API server is enabled
  (`API_SERVER_ENABLED`), in which case store it in `/opt/data/.env` as
  `API_SERVER_KEY` so it survives rebuilds.
- **Upgrades**: bump the pinned build SHA (or the `HERMES_IMAGE` tag it
  pins) and rebuild. Never upgrade by tracking `main`/`latest`.
- **Monitoring**: droplets are created with `"monitoring": true`; add a DO
  alert policy (`POST /v2/monitoring/alerts`) so someone is emailed when a
  droplet dies or pegs CPU — otherwise a dead agent is discovered by its
  principal noticing silence. External uptime pingers will NOT work: the
  firewall blocks them by design. `GET /api/status` from an allowlisted IP
  is the health check.
- **Decommission**: revoke every integration credential at its provider
  first (the agent's copies are on the volume); destroy the droplet; delete
  the firewall; **snapshot then retain the volume ≥ 30 days** before
  deleting (it holds the agent's memory — per invariant § 4.9 treat it as a
  confidential record and confirm with the principal before destruction);
  update the fleet inventory (§ 10).

## 7. Data-alignment rule (for agents touching firm analytics data)

Agents must read the **same sources of truth** as the analytics dashboard —
the Google Sheets workbooks, Mercury API, tracked Drive folders, or a
read-only Firestore service account — never parallel copies. If an agent
states a computed value the dashboard also shows (e.g. client Payment Status
tags), it must compute it with this repo's pure `.mjs` modules
(`src/utils/paymentStatus.mjs`, `rateLookup.mjs`, `cohortFilter.mjs` — all
Node-importable and tested), not a paraphrase. See
`docs/hermes-agent-setup.md` §§ "Guiding principle" and 3 for the full
integration catalog (Sheets, Drive, Asana MCP, DocuSign, Mercury,
Firestore).

## 8. Known constraints of Claude Code remote deploy sessions

- Env vars are injected at container start; mid-session additions may not
  appear until a fresh session. Plan credential handoffs around this.
- No SSH egress and no `ssh`/`ssh-keygen` binaries → all host management is
  cloud-init + HTTPS APIs. Design droplets to never need a shell.
- Plain-HTTP checks need `curl --proxytunnel -x "$HTTPS_PROXY"`.
- Python `cryptography` module is broken in the sandbox (no key
  generation); `openssl` works.
- Sessions are ephemeral: anything worth keeping gets committed and pushed
  same-session; scratchpad contents (generated tokens, keys) die with the
  session — put durable secrets in cloud-init/env before the session ends,
  and note in the runbook where they live.

## 9. Per-Agent Worksheet (fill in per agent; supplied alongside this doc)

```
Agent name (short slug):          e.g. hermes-kb
Human principal / end user:       who it serves; whose Anthropic key
Model + Anthropic workspace:      model choice; use a separate Console
                                  workspace per agent (per-agent spend
                                  visibility and limits)
Purpose (one paragraph):
Messaging surface(s):             email (whose inbox? dedicated?), Slack, dashboard-only, ...
Data sources + access mode:       e.g. Notion KB (read-only), Drive folder X (read-only)
Credentials needed + provider:    per integration; who generates each
Write capabilities (if any):      default NONE; justify each
Scheduled jobs:                   digest cadence, recipients
Memory scope / retention notes:   what it may accumulate; sensitivity
Firewall allowlist:               who needs dashboard access
Acceptance checks:                how we know each integration works
```

### Notes for the planned knowledge-base agent

Same chassis end-to-end. Specifics to expect: read-only MCP connection to
the knowledge base (Notion / Drive / other — confirm in worksheet);
query-and-answer over a messaging surface rather than inbox embedding, so
the email rules of § 4.6 apply mostly to *content it reads*, not an inbox
it lives in; retrieval-heavy memory, so decide retention early (a KB agent
accumulates a shadow copy of what it's asked about); and its answers should
cite the KB source (page/doc link), mirroring the analytics dashboard's
provenance-tooltip convention (`calcDefinitions.mjs` — every displayed
value knows where it came from).

## 10. Current fleet inventory

| Agent | Infra | Status |
|---|---|---|
| Principal's ops assistant (`hermes`) | DO droplet `584697460` + volume `hermes-data` + fw `hermes-fw`, sfo3 | Live, healthy; unconfigured (no model key yet); built unpinned from `main` @ 2026-07-15 (`d3f0067…`) — pin on next rebuild; see `docs/hermes-agent-setup.md` |
| — Render POC (`srv-d9a3ikm7r5hc73c4ok00`) | Render free tier | Suspended (superseded by droplet); reversible |
| `cedar-grove-redline` (`srv-d96sr4naqgkc73cfat70`) | Render | **Not ours. Do not touch.** Pre-existing service, owner unknown (ask Val) |

Keep this table current: every new agent adds a row, every decommission
updates one.
