# Builder asynchronous editing — Task 5

Date: 2026-10-22. Base: `f8fe084de1` (Task 4 rereview correction).

## Scope and execution

Source-only implementation in the builder worktree. Both submissions, buyer MCP
and Muse remain unchanged. No production migrations, credentials, deployment,
provider requests or activation were performed. The existing private-storage
release flag remains false, so the new Node execution route returns 503.

The linked-user services queue semantic homepage instructions, poll safe status,
claim a five-minute lease, generate a private candidate and explicitly apply it.
Generation reuses Baci's bounded prompt projection, provider catalog, semantic
edit contract, structural protections and complexity validation. The certified
portable renderer is an additional strict boundary: other components, zones,
unknown fields, unsafe links and silent sanitizer drops cannot become ready.
Protected Header/Footer anchors remain intact. Generation never publishes.

## Authority, state and retries

- Operation snapshots/candidates live in unexposed `builder_authorization`, with
  normal authenticated RLS and explicit grants. Anonymous, service-role and
  auth-storage roles receive no operation-table privilege. The public Data API
  cannot mutate that private table directly.
- Queue, claim, lease reload, completion and apply lock/recheck the canonical
  connection, owner, target, scope, grant version and expiry. Grant changes during
  provider execution reject completion. The website advisory guard precedes the
  operation lock and retains Task 4's contention behavior.
- Each operation records a captured source revision/config, canonical input
  digest, stable retry key, attempt count, next retry time and lease identity.
  Ready candidates receive a server-generated digest. Apply revalidates the
  stored candidate and SQL verifies its digest before Task 4's atomic CAS/evidence
  commit. Apply results and operation state commit together. Another operation
  cannot reuse its apply retry key, even with byte-identical output.
- State is `pending → running → ready → applied`, or terminal `failed/conflict`.
  Transient provider failures retry after 60/120 seconds, at most three attempts;
  expired leases can be claimed by another replica. Old leases cannot complete.
  Invalid output is terminal. Revoked/version-changed operations cannot run or
  replay. Operations expire after one day; polling reports expiry without writes.
- Every claim consumes the durable per-user ten-per-minute generation quota,
  including retries and crashed attempts. Provider execution also uses the
  existing `builder:<userId>` in-process AI limiter. Neither limiter is bypassed
  for retries. Local quota denial invokes no provider.
- Polling performs no job/draft writes. Status includes bounded pending IDs;
  summaries are server-authored and never contain prompts, configs or raw provider
  errors. Stale application returns the existing safe revision conflict.

## Runner and endpoint

The broker can enumerate at most 20 active private connection IDs per page using
its existing auth-storage role. It has no job/content/commerce authority. The
runner resolves each dedicated upstream session, verifies the linked user and
uses that user's RLS client to discover due operation IDs. It sends bodyless POSTs
only to the fixed `https://usebaci.com/api/integrations/chatgpt/builder-operations/{id}/run`
endpoint, rejects redirects and does not blindly retry an uncertain HTTP result.
Importing the runtime/runner starts no scheduler. A future scheduler must persist
and cycle the returned cursor; repeated ticks recover expired leases through SQL.

The Node endpoint verifies the upstream bearer with `auth.getUser()` and derives
connection/store/version from the stored operation. Cookie auth and caller-supplied
job bodies are rejected. It reloads the stored lease before AI work and repeats
canonical validation on completion. It returns an acknowledgement without tokens,
prompts or candidate configs. Existing native `ai_jobs` dispatchers are unused.

## Verification

- Task 4 Codex rereview found a native AI apply precheck comparing only the public
  timestamp. The exact private-save mismatch test failed 409 then passed 200 after
  deferring private freshness to SQL CAS. Legacy behavior is preserved. Fix saved
  separately as `f8fe084de1`.
- Final edge regressions reproduced then fixed two additional cases: invalid
  stored source now terminates inside the guarded runner instead of waiting for
  lease recovery; inherited public-table grants are cleared before granting the
  private table's required SELECT/INSERT/UPDATE rights (no DELETE/TRUNCATE).
- Deterministic provider tests cover a supported edit, malformed/unsafe output,
  protected anchors, provider timeout, quota denial, canonical denial before AI
  and revocation after generation. No paid/live provider was invoked.
- Disposable PostgreSQL tests cover queue replay/collision, polling without writes,
  current leases, two replicas, old-lease completion, 60/120 delays, third-attempt
  exhaustion, stale source, apply exactly once, reauthorization, quotas, operation
  expiry, cross-tenant denial and candidate-digest tampering.
- The signed builder-token test uses real local PostgREST plus the fixture's
  cryptographically verified upstream-user endpoint. The same linked context
  creates, queues, executes through the fixed endpoint handler, polls and applies.
  Published config stays null and public operation/quota endpoints return 404.
  Actual upstream Supabase Auth lifecycle remains separately covered by Task 3.
- This task does not claim a full current-schema replay, deployed Next/proxy/HTTP
  validation, a live ChatGPT interaction, scheduler installation or provider QA.
  Those remain coordinated release gates. Local fixture checks are not staging.

Independent Codex review found no actionable correctness/security issue. The
additional edge regressions above were fixed after that review and revalidated.
Final validation: 119 web/registry test files / 473 tests and 31 isolated
authentication/database tests pass, as do web/fixture typechecks and targeted
Biome. Six migration byte hashes match both independent registries. The next implementation task is the separate MCP transport/gateway.
