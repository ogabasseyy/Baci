# Muse Pilot Runbook — R0 Exit Proofs

Status: full-schema branch proof, live order reads, manual credential
replacement and pre-expiry revocation denial passed on 3 October 2026.
Two agent-driven timed reads passed; native desktop scheduling, automatic
refresh, cross-device reuse and operation-specific approval receipts remain
unverified. Temporary transport is stopped and gateway login disabled.
The isolated database proof and read-only staging
pilot are authorized until 9 October 2026; see
[`muse-r0-authorization.md`](./muse-r0-authorization.md). No production traffic.

## 1. Local harness proof (agent-executable)

Start the isolated R0 harness (test-only; full instructions in
`apps/web/tools/connector-harness/README.md`):

```sh
cd apps/web
HARNESS_ENABLED=1 \
HARNESS_DATABASE_URL='postgres://connector_gateway:<secret>@<host>:5432/<db>' \
HARNESS_OWNER_SECRET='<32+ char random>' \
HARNESS_TEST_OWNER_USER_ID='<test owner uuid>' \
HARNESS_TEST_MERCHANT_ID='<test merchant uuid>' \
../../node_modules/.bin/tsx tools/connector-harness/server.ts
```

Callable endpoints (default base `http://127.0.0.1:3101`):

| Step | Call |
|---|---|
| Discovery | `GET /openapi.json` — real OpenAPI 3.1 built from manifest `r0.4` |
| Issue | `POST /v0/issue-token` (owner secret) → `{ grant_id, token, refresh_token }` |
| Read | `POST /v0/tools/orders.list`, `POST /v0/tools/orders.get` (connector token) |
| Replace credential | `POST /v0/refresh` with `{ refresh_token }` → new pair; old pair denied |
| Revoke | `POST /v0/revoke` (owner secret) → next call denied |
| Denials | bad token → 401, cross-branch → 403, unknown order → 404, bad body → 400 |

Verified 2 Oct 2026 against scratch: issue, merchant-contained reads
(2 orders), foreign-order 404, 401/400/403 shapes, rotation with old-token
denial, revoke with next-call denial, branch-scoped containment, and the
`/openapi.json` four-tool contract. `inventory.levels` and
`analytics.summary` return 501 in the harness (runtimes arrive with R1).

Also verified 2 Oct 2026 against the full-schema branch
(`baci-connector-r0-proof`, then re-paused): 16/16 HTTP checks over the
pooler as least-privilege `connector_gateway` — issue, merchant-wide and
branch-scoped real-order reads, cross-merchant/branch containment,
single-use refresh rotation, revoke with next-call denial, and all
denial shapes. Full record in `muse-r0-branch-proof.md`.

### 1b. Filtered staging transport preflight (agent-verified 2 Oct 2026)

Transport: harness `127.0.0.1:3101` (branch pooler,
least-privilege `connector_gateway`) → Caddy path allowlist on
`127.0.0.1:3120` (`tools/connector-harness/Caddyfile`: paths
`/openapi.json` and `/v0/tools/*` only; everything else 404). The harness
enforces GET discovery and POST tools on those allowed paths →
`cloudflared` quick tunnel (temporary `https://*.trycloudflare.com`
URL; TLS terminates at the edge). `HARNESS_PUBLIC_BASE_URL` was set to
the tunnel URL before discovery checks.

Public-URL checks (all pass): `/openapi.json` 200 with `servers[0]`
equal to the tunnel URL and the four `/v0/tools/*` paths; tools without
auth 401; `/v0/issue-token`, `/v0/refresh`, `/v0/revoke`, `/health` and
unknown paths 404. Throwaway merchant-wide `orders:read` grant (10-min
expiry, issued + revoked locally): public `orders.list` 200 with the 3
merchant-A orders only, `orders.get` 200, foreign-merchant get 404,
revoke → next call 401. Teardown after preflight: throwaway revoked,
`connector_gateway` back to `NOLOGIN`, 0 active grants (17 revoked
total). Branch left `ACTIVE_HEALTHY` for the interactive pilot; the
tunnel URL expired with the agent session — the operator re-runs the
steps below for the real pilot (fresh URL + fresh token each run).

Operator replication (branch-only; secrets stay in 0600 /tmp files):
1. `supabase branches get --project-ref <parent> --output json
   baci-connector-r0-proof` to a 0600 file; use the pooler URL (direct
   `db.*` DNS is unreachable from here).
2. Fresh 0600 `gateway_password` + `owner_secret`; pooler psql as
   `postgres.<branch-ref>`: `ALTER ROLE connector_gateway WITH LOGIN
   PASSWORD '<fresh>';` — the gateway pooler user is
   `connector_gateway.<branch-ref>`.
3. Start the harness with `HARNESS_DATABASE_URL` (pooler,
   `sslmode=require`), test owner
   `11111111-1111-4111-8111-111111111111` / merchant
   `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`; start Caddy; start
   `cloudflared tunnel --no-autoupdate --url http://127.0.0.1:3120`;
   restart the harness with `HARNESS_PUBLIC_BASE_URL=<tunnel URL>`.
4. Re-run the public checks above with a throwaway grant; revoke it.
5. Issue the pilot grant locally; paste ONLY the access token into
   Muse's secure prompt (see the brief). At pilot end: revoke grant(s),
   `ALTER ROLE connector_gateway WITH NOLOGIN PASSWORD NULL`, stop all
   three processes, delete /tmp secrets.

## 2. Pilot proofs (require a user-held Muse environment)

Use the [Baci staging brief](./muse-r0-connector-brief.md) and its setup
template once the real HTTPS base URL and scoped access token are ready.
REST/OpenAPI is the selected R0 path. Public/vendor capability reports do
not pass the checks below. Start with operator-driven token replacement;
native Muse refresh remains a separate observation. Verify that the client
is the personal Muse assistant before using this setup prompt. Muse Code
uses separately configured MCP servers, and this harness has no MCP
endpoint. See the [testing guide](muse-r0-testing-guide.md).

| # | Proof | Procedure | Pass condition |
|---|---|---|---|
| 1 | Initial auth | Create the custom connector in Muse against the harness `/openapi.json` (via tunnel or staging host); supply the issued token; ask Muse to list orders. | Correct Baci user + grant resolve; rows scoped to the merchant. |
| 2 | Tool discovery | Inspect which tools Muse exposes from the provided API description. | Stable names + schemas matching manifest `r0.4`. |
| 3 | Refresh semantics | Rotate via `/v0/refresh`, update the Muse credential, retry; then observe whether Muse ever refreshes on its own. | Manual replacement works (proven locally); record whether any platform-driven refresh exists. The harness proves credential replacement only — not platform refresh semantics. |
| 4 | Revocation | Revoke via `/v0/revoke`, then ask Muse to list orders. | Next call denied with a safe error. |
| 5 | Approval handoff | Attempt any action Muse gates behind approval; inspect what Baci receives. | Record whether any verifiable operation-specific receipt reaches Baci. Default: none — keep Baci-owned proof and writes disabled. |
| 6 | Scheduled checks | Configure a synthetic order check if supported; observe two consecutive runs and duplicate handling. | Record observed behavior or the Baci-only fallback. R0 has no event-resume cursor; inventory returns 501. Neither event-cursor resumption nor a stock-check runtime is proved here. |
| 7 | Error handling | Trigger a denied merchant selector and revoked-token calls. For a branch-restricted grant, test a selector outside its allowlist. For a merchant-wide owner grant, an unknown branch selector may return an empty list within the merchant-filtered query. | Stable safe codes drive Muse's next action; branch selections never expand merchant access. Distinguish scoped-grant denial from a merchant-wide empty result. |
| 8 | Cross-device reuse | After desktop setup, inspect the same account on another supported Muse client and repeat a synthetic read, then a revoked-token call. | Record whether the same connector/credential is available and access denial is consistent; no assumed sync. |

Notes:

- Cross-device observations supplement the seven planned R0 exit checks.
- Browser-assisted connector setup may need interactive auth in the
  user's session; it cannot be fully scripted by an agent.
- Muse needs an HTTPS endpoint reachable from its environment. For local
  runs, place a path-filtering reverse proxy in front of the harness and
  tunnel the proxy's listener; set `HARNESS_PUBLIC_BASE_URL` to that HTTPS
  URL. A staging host must apply the same route restrictions.
- Allow `GET /openapi.json` and `POST /v0/tools/*` through the public
  transport. Allow `POST /v0/refresh` only if the pilot needs it; manual
  rotation may stay local. Reject all other public paths, including
  `/v0/issue-token` and `/v0/revoke`, and verify those denials before
  entering credentials. Owner-management calls remain locally accessible.

## 3. Fallbacks (permitted by the plan)

- Scheduled checks unsupported → Baci-only alerts; Muse stays
  conversational/investigative.
- No verifiable approval receipt → Baci-owned proof for all sensitive
  writes; money-moving commands stay disabled.
- Tool discovery unstable → revise the manifest contract before R1.

## 4. Remaining execution gates

1. The owner reports an open, signed-in Muse desktop session. On 3 October
   the returned setup response reported no connector setup or secure prompt
   in its session. The operator subsequently requested the personal
   desktop-app prompt, reported an API-key prompt, issued the test token
   through the native helper and reported entering it. List/get 200 are
   observed in harness logs, and the reported results match synthetic rows;
   vault and skill observations remain operator-reported.
   Permission for the private read-only staging pilot is already granted.
2. Full-schema confirmation is complete on the authorized temporary branch
   `baci-connector-r0-proof` (`tzguvkfjycnrzeigigvs`): snapshot restore,
   schema comparison, migration, SQL regressions, RLS equivalence and
   16/16 hosted harness checks are recorded in the
   [branch proof](muse-r0-branch-proof.md). After the 3 October pilot,
   branch preview is `INACTIVE` (paused); its historical replay
   status remains `MIGRATIONS_FAILED`, while the current
   schema was restored and tested independently of that failed replay.
   Branch-only runtime access and filtered public transport were provisioned
   and preflighted, then removed after the pilot. Another run requires
   fresh runtime credentials and a new tunnel URL. Keep owner-management paths local.
3. ADR-003 is accepted for this isolated R0/staging scope through
   9 October 2026. Production-scope acceptance remains a later decision.
4. R1 runtime pieces (link-flow UI, gateway provisioning, pooler access,
   rate limiting, audit sink) are designed but not built.

## 5. Evidence template

Append completed runs below (one row per proof step):

| Date | Step | Result (pass/fail/blocked) | Evidence location |
|---|---|---|---|
| 2026-10-02 | Harness local (§1) | pass | agent session: issue/reads/rotation/revocation/denials/openapi verified over HTTP |
| 2026-10-02 | Full-schema branch proof | pass | `muse-r0-branch-proof.md`: snapshot restore, equivalence, migration, regressions, RLS proof, 16/16 harness checks; resolve session-guard blocker found + fixed with red-green controls |
| 2026-10-02 | Filtered staging transport preflight (§1b) | pass | agent session: Caddy allowlist + quick-tunnel HTTPS; public openapi/tools allow with owner paths 404; throwaway scoped reads + containment + revoke denial; teardown to NOLOGIN with 0 active grants |
| 2026-10-03 | Fresh filtered transport preflight | pass | live public discovery 200; four tool paths; owner-management/health/unknown paths 404; unauthenticated tools 401; throwaway list/get 200 with 3 synthetic merchant-A orders; local revoke then public read 401; throwaway revoked |
| 2026-10-03 | Interactive connector setup | blocked / client identification pending | operator returned a response reporting no connector setup or secure prompt in that session; no pilot credential issued and no authenticated Muse order call demonstrated; see `muse-r0-testing-guide.md` |
| 2026-10-03 | Credential entry after desktop-app prompt | in progress | operator reports adding the API key to Muse; helper metadata and local harness issuance 201 correlate to grant `77d06dbc-5dc7-422c-921d-964698f45208`, expires 07:22 WAT; authenticated list/get results still pending |
| 2026-10-03 | Initial Muse order reads | pass | harness logs: orders.list 200 at 06:34:40 WAT and orders.get 200 at 06:34:44 WAT; operator-reported IDs/statuses/first-order merchant, branch and creation date match an explicit-column query of the isolated synthetic fixture |
| 2026-10-03 | Credential storage and saved integration | operator-reported; reuse pending | Muse reports vault key `custom.baci-r0-staging` and saved skill `baci-r0-staging`; raw pilot credentials were not received or inspected by the reviewing agent |
| 2026-10-03 | Rotation and old-key denial | pass; replacement read pending | helper metadata: rotated at 06:48:07 WAT; harness refresh 200 followed by orders.list 401 at 06:48:30 and 06:48:43 WAT; branch grant remains active, version 2, revoked_at NULL; operator reports both fresh calls denied |
| 2026-10-03 | Manual secure replacement | pass | harness orders.list 200 at 07:05:31 WAT after replacement through the operator's secure prompt; operator reports the same 3 synthetic orders; same harness session and endpoint, no gateway code changes |
| 2026-10-03 | Saved-skill reuse and discovery | pass, with interface operator-reported | fresh orders.list 200 at 07:10:17 and 07:10:28 WAT; operator reports use in a new conversation; reported four operation names and input schemas match the live OpenAPI document |
| 2026-10-03 | Two timed live reads | pass for agent-driven reads; native scheduling unverified | harness orders.list 200 at 07:12:07 and 07:14:08 WAT; operator reports both jobs succeeded, unchanged order IDs identified as repeats, runonce jobs removed and no future pilot jobs queued; desktop-native scheduling/proactive connector behavior remains explicitly unverified |
| 2026-10-03 | Merchant and branch selections | pass for the merchant-wide pilot contract | harness 403 at 07:16:43 WAT for foreign merchant, operator reports FORBIDDEN_SCOPE; branch selector returned 200 at 07:16:45 WAT with an empty list, consistent with merchant-wide query narrowing; no runtime change required |
| 2026-10-03 | First explicit revocation attempt | Baci-side revoke pass; distinct Muse denial pending | local revoke 200 at 07:19:49 WAT; metadata shows revoked/version 3 before original 07:22 expiry; no subsequent Muse request was observed before expiry, so a post-expiry 401 cannot isolate revocation; fresh-grant test requested |
| 2026-10-03 | Fresh-grant revocation control | pass for gateway denial before expiry | new grant `0e34ec6b-4b47-43f7-bf06-3ed492f116fc`: baseline orders.list 200 at 07:38:20 WAT, local revoke 200 at 07:42:32, subsequent orders.list 401 at 07:59:12, before 08:38 expiry; current harness maps the denial to GRANT_REVOKED; response body and Muse interface were not independently captured |
| — | — | — | — |

## 6. Pilot observation log

Record only observed behavior during the real Muse pilot. Local harness
results prove the Baci side; they say nothing about the Muse platform.

### 6.0 Initial access and transport observations — 3 October

- Initial order access: **pass**. Harness logs independently show
  `orders.list` HTTP 200 at `2026-10-03T05:34:40.609Z` and `orders.get`
  HTTP 200 at `2026-10-03T05:34:44.410Z`.
- The operator reported the following three orders. Their full IDs and
  independent payment/shipping statuses match the isolated branch fixture:

  | Order ID | Payment | Shipping |
  |---|---|---|
  | `c0000001-0001-4001-8001-000000000001` | paid | shipped |
  | `c0000002-0002-4002-8002-000000000002` | unpaid | pending |
  | `c0000003-0003-4003-8003-000000000003` | paid | pending |

- First-order detail also matches merchant
  `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`, branch
  `a1111111-1111-4111-8111-111111111111` and creation date 4 January 2026.
- Secure storage under `custom.baci-r0-staging` and saving the
  `baci-r0-staging` skill are **operator-reported**. A fresh-conversation
  reuse test is pending; the interface and vault were not inspected by the
  reviewing agent.
- The operator reports roughly two minutes of POST timeouts while discovery
  remained responsive, followed by recovery. Tunnel logs contain recurring
  DNS-resolver timeouts, but do not establish the cause of that reported
  interruption. Current discovery returns 200. Treat this quick tunnel as
  temporary pilot transport.
- The operator reports leaving inventory and analytics untouched. Full
  schema discovery, rotation, revocation, scheduling, error behavior and
  optional cross-device observations remain to be recorded.

### 6.1 Credential refresh

- Status: **manual replacement passed**. Live manual rotation, old-key denial
  and a replacement-key read in Muse are observed. Native automatic platform
  refresh remains unproven.
- On 3 October, local `/v0/refresh` returned 200 at
  `2026-10-03T05:48:07.742Z`. Subsequent Muse-requested live order reads
  returned 401 at `05:48:30.526Z` and `05:48:43.131Z`. The operator reports
  both denials. A metadata-only branch query shows the same grant active
  at version 2, with `revoked_at` NULL and expiry unchanged at 07:22 WAT.
- After secure credential replacement, `orders.list` returned 200 at
  `2026-10-03T06:05:31.383Z`. The operator reports the same three synthetic
  orders. The same harness process and endpoint served the read; no gateway
  code changed. Muse's explanation that a surrogate re-resolves on each
  request is platform-reported, not independently inspected by Baci.
- The operator's returned message classified this as revoked access; the
  observed transition proves rotation instead. Explicit revocation still
  requires its separate test.
- The native credential helper now offers option **4** to copy the current
  access token without rotating it. Use it after opening Muse's secure
  prompt so copying messages does not lose the replacement from the
  clipboard. Syntax and mocked current/expired-copy checks passed; live
  pilot credential values were not read by the reviewing agent.
- Observe: rotate via `/v0/refresh`, update the Muse credential through its
  secure prompt, retry; old token must fail, replacement must work. Then
  watch whether Muse ever refreshes on its own across the pilot window.
- Record: date, rotation outcome, whether any platform-driven refresh was
  observed (yes with evidence / no).

### 6.2 Revocation

- Status: **live gateway denial after revocation and before expiry passed**.
- The reviewing agent called the normal local owner revocation endpoint at
  07:19:49 WAT on 3 October, receiving HTTP 200. A metadata-only branch query
  confirmed `status=revoked`, version 3 and a revocation timestamp before
  the original 07:22 WAT expiry. No subsequent Muse call reached the harness
  before expiry. A later 401 would mix expiry and revocation, so the reviewing
  agent requested a fresh grant for a clean test rather than marking this
  observation complete.
- The later old-key read returned 401 at `2026-10-03T06:36:43.930Z`, after
  the original expiry. Record this as denied access, not an isolated
  revocation proof, even though the safe code is `GRANT_REVOKED`.
- A fresh grant `0e34ec6b-4b47-43f7-bf06-3ed492f116fc` was issued at
  07:38 WAT through the native operator helper. Its live baseline read
  returned 200 at `2026-10-03T06:38:20.878Z`. The reviewing agent revoked
  it through the normal local owner endpoint at 07:42:32 WAT (HTTP 200).
  Metadata confirms revoked/version 2 and expiry still in the future at
  08:38 WAT. A subsequent live `orders.list` request returned HTTP 401 at
  `2026-10-03T06:59:12.877Z` (07:59:12 WAT), before expiry. The harness
  logs this status from its mapped database error response; the current
  mapping returns `GRANT_REVOKED` for invalid, revoked or expired access.
  The response body and Muse interface were not independently captured.
  No reviewing-agent call used the operator's saved bearer credential.
- The native helper's option 1 initially stopped on the previous grant's
  already-revoked 404. It now tolerates that 404 when reissuing, while retaining
  other authorization failures. Mocked regression controls reproduced the
  old failure, proved fresh issuance after the fix, and kept a 401 fail-closed.
  No live pilot credential values were read in those checks.
- Observe: revoke via `/v0/revoke` mid-conversation, then ask Muse to list
  orders. Already retrieved content may remain in history; the proof is
  future-access denial with a safe error.
- Record: date, revocation call outcome, Muse's next-call behavior and
  reported error.

### 6.3 Scheduling

- Status: **two agent-driven timed reads passed; native desktop-connector
  scheduling/proactive behavior remains unverified**.
- The operator reports a new-conversation baseline read at 07:10:13 WAT;
  harness completion logs show successful reads at 07:10:17 and 07:10:28.
  Four declared operation names and input schemas reported by the operator
  match the live OpenAPI document. This does not include runtime calls to
  inventory or analytics.
- Timed reads completed in the harness at `2026-10-03T06:12:07.020Z` and
  `2026-10-03T06:14:08.574Z`, both HTTP 200. The operator reports execution
  at 07:12:08 and 07:14:09 WAT, the same three IDs, and all rows classified
  as unchanged repeats.
- The operator reports both runonce jobs succeeded once, disappeared from
  the schedule list after completion and left no future pilot jobs queued.
  These scheduler observations are operator-reported. The operator expressly
  distinguishes its timed live reads from native desktop-connector scheduling
  or proactive behavior, which remains unverified. Retain the Baci-owned
  alert fallback; do not claim native connector push or event-cursor support.
- Observe: configure a repeated synthetic order read if Muse supports
  scheduling; watch two consecutive runs and duplicate handling. R0 has no
  event-resume cursor and inventory returns 501, so neither cursor
  resumption nor a stock-check runtime can be proved here.
- Record: date, scheduling supported (yes/no), runs observed, duplicate
  handling, or the retained Baci-only fallback.

### 6.4 Cross-device reuse

- Status: **pending**.
- Observe: after desktop setup, open the same account on another supported
  Muse client, repeat a synthetic read, then a revoked-token call. Do not
  assume credential sync.
- Record: date, second client, whether the same connector/credential was
  available, read outcome, denial consistency.

### 6.5 Safe errors and selection semantics — 3 October

- Wrong merchant selector: harness HTTP 403 at
  `2026-10-03T06:16:43.787Z`; operator reports `FORBIDDEN_SCOPE` and a safe
  permission message.
- Unknown branch selector `dddddddd-dddd-4ddd-8ddd-dddddddddddd`: harness
  HTTP 200 at `06:16:45.780Z`; operator reports an empty list.
- The reviewing agent initially expected 403 for both. Current code
  inspection corrects that expectation: merchant-wide owner grants have no
  enumerated branch allowlist; their branch selectors narrow a query that
  still includes the resolved merchant filter. An unavailable branch may
  produce an empty list. Branch-restricted grants reject selections outside
  their explicit allowlist. No runtime fix is needed for this observed result.
- Branch-restricted denial remains covered by the separate local/full-schema
  proofs, rather than a branch-restricted token in this merchant-wide Muse
  pilot. Reads do not establish sensitive-operation approval proof; retain
  Baci-owned approval for future writes.

### 6.6 Pilot teardown — 3 October

- Metadata-only branch query confirms 0 active connector grants.
- Tunnel, Caddy proxy and harness sessions stopped with exit code 0.
- Branch-only gateway role is `NOLOGIN` and its password is cleared.
  Temporary database-login credentials were used in memory and not stored.
- Branch pause completed: preview `INACTIVE`, with the production parent
  still `ACTIVE_HEALTHY`. Historical migration replay remains `MIGRATIONS_FAILED`.
- Task-owned temporary secrets and locator were removed after preserving
  credential-free evidence in the operator's Downloads directory. Another pilot requires
  fresh runtime access, a new HTTPS URL and a new operator-issued credential.
- No commits or deployments. CodeRabbit's unavailable-seat/quota gate
  remains open before commit/ship, and production-scope ADR-003 acceptance
  remains open before R1. Retain Baci-owned approval and alert fallbacks.
