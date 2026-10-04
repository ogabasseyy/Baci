# Parent r3 recovery and true-interest mapping review

Reviewed locally on 2026-10-02; final source inventory checked at 16:23:50 UTC.
Canonical workspace: `/Users/mac/Baci-worktrees/cursor-savings-phase1`.
This report is the only repository file added by this review. No source edits,
remote reads, provider calls, deployed database actions, grants, transfers, or
live financial writes were performed. PostgreSQL execution was disposable only.

## Verdict and evidence boundary

- No new authority bypass or permanent-routine weakening found in the two parent
  changes: accepting a complete expired verification claim and sorting JSON keys
  during SQL rendering. Existing fixed scope, source, executor, private approval,
  freshness, row-preservation, and metadata guards remain in place.
- Independently reran all 14 recovery tests, including four real PostgreSQL tests;
  all passed. All 57 colocated identity-policy tests also passed.
- Parent reports one successful real TEST Paystack collection of 10000 kobo,
  successful r3 collection promotion, and no transfer attempt. Those are parent
  observations, not independently checked live by this sidecar. The root-private
  provider response, r3 bundle, executed SQL, rehearsal receipt, commit outcome,
  and live routine definition were not supplied for independent inspection.
- Interest activation remains blocked. Provider `interest=true` for public wallet
  `01M3W0Y93XHJY9RPQ2G75X81WG` does not establish customer eligibility, an exact
  payout route, or an enabled internal-goal policy. No source-only preparation
  result establishes a real provider payout or application Earnings credit.
- Recovery is not a funding operation. Do not replay promotion now that parent
  reports success. Transfer, verified provider funding, and principal projection
  remain separate parent-owned gates.

## Findings and activation blockers

### 1. New-goal policy preparation is unsupported by the old fixed-scope lane

`/Users/mac/Baci-worktrees/cursor-savings-phase1/tools/staging/interest-bridge/identity-policy/policy_contract.py:5`
pins the old wallet `01M3CQX27G9687EFSF1TKYMPR9` and old goal
`430314fd-cd8b-4579-98d4-e9f345713dd6`.
`/Users/mac/Baci-worktrees/cursor-savings-phase1/tools/staging/interest-bridge/identity-policy/verify_policy_candidate.py:97`
rejects another public wallet; its binding check at line 130 requires principal
10000 kobo. The collector's database query also selects the old goal/wallet
(`/Users/mac/Baci-worktrees/cursor-savings-phase1/tools/staging/interest-bridge/identity-policy/collect_identity_evidence.py:35`).

An independently repinned synthetic probe confirmed refusal of the actual new
goal scope (`staging_scope_invalid`), the actual new public wallet
(`new_goal_and_provisioned_binding_required`), and principal zero
(`existing_binding_or_principal_changed`). These are safe refusals, not bypasses.

Action: use a separately reviewed, exact-new-goal policy-only preparation and
installation path. Preserve the old identity receipt as old-origin evidence;
join it to fresh new-wallet ownership and the existing new-goal binding without
relabeling the old receipt, moving its principal, or changing its wallet mapping.
Do not make the new principal appear funded merely to satisfy the old preparer.
The policy table itself has no 10000-kobo principal prerequisite, so a separately
reviewed inactive policy can pin the actual zero principal without seeding money.

### 2. Actual accrued-interest source and payout destination need independent proof

`/Users/mac/.codex/worktrees/0d77/Baci-app/apps/web/tools/piggyvest-staging/replay-interest-runtime.ts:39`
uses `customer_id`, `pvb_accrued_interest_wallet`, and
`eventData.destination_wallet`. It does not infer these from `pvb_wallet`.
A non-null `pvb_destination_wallet` must corroborate the nested destination.
The adapter supplies NGN from configuration/contract, rather than a webhook
currency field; business and currency therefore also require authenticated
provider/contract corroboration.

The identity preparer permits a source only when its documented namespace is
the exact current public or FAAS wallet. If the real accrued-interest source is
a distinct wallet, the current preparer must remain refused until a separately
reviewed authoritative association is supported. Never substitute the public
wallet just because its interest flag is true. Source=destination is allowed
only when explicitly proven, never as a guessed default.

Action: independently prove the exact business, API customer alias, webhook
customer identity, public/FAAS pair, accrued-interest source namespace, and payout
destination for this goal. Document whether the payout is attributable to this
single customer goal, not a pooled business payout. Also seal per-wallet customer
eligibility, exact owner opt-in, and the 900/300 annual-basis-point arrangement
with `full_customer_net_no_resplit`. The supplied foreign payout sample and its
814 gross / 81 tax / 733 net do not prove any of these live associations.

### 3. Initial source inventory drift was resolved during review

At 16:19:17 UTC, `SOURCE-INVENTORY.sha256` failed for exactly five files:
`README.md`, `postgres.test.py`, `renderer.py`, `renderer.test.py`, and
`guards.sql`; the other ten entries passed. The initial manifest digest was
`274f919c8d2173f46cd549abbadd8aa3d1fd79391a631f401c6f97d25330f24a`.

Parent concurrently updated README's recovery handoff and refreshed the manifest.
At 16:23:50 UTC all 15 entries passed, with manifest SHA256
`7945ae0e7d9664eee7fa8ace241725314b0e07f2850e6457fe2f416a3dabcb0c`.
Every tested executable/template/test hash remained unchanged; the inventory below
uses the refreshed README hash. No manifest or source was changed by this review.
Parent should still reconcile/archive its independently sealed r3 package; do not
relabel an old receipt. The initial local mismatch does not establish that the
private r3 pins were wrong, and their closure was not independently inspected here.

### 4. Direct registration identity path has a namespace incompatibility

`/Users/mac/Baci-worktrees/cursor-savings-phase1/tools/staging/interest-bridge/identity-policy/resolve_customer_identity.py:12`
requires a bare app customer UUID as `thirdPartyIdentifier`, whereas
`/Users/mac/Baci-worktrees/cursor-savings-phase1/apps/web/src/lib/piggyvest/provisioning-request.ts:59`
constructs `baci:<integration UUID>:<customer UUID>`.
A synthetic probe with that exact application-generated identifier was refused
as `registration_app_customer_unproven`.

Action: retain the valid corroborated historical-identity route, or explicitly
support the exact authenticated application-generated registration identifier in
the new scoped verifier. Do not strip prefixes, hyphens, or infer that an API
alias, webhook UUID, and app customer UUID are interchangeable.

## Recovery control audit

Paths in this section are under
`/Users/mac/Baci-worktrees/cursor-savings-phase1/tools/staging/prefunded-card/reviewed-reconciliation`.

| Control | Local evidence and conclusion |
| --- | --- |
| Original source | `contract.py:7`, `clone.py:12`, `guards.sql:19`: SHA256 remains `e078268766bdac768b934ff8428be005c6060c89fbeec1bd55c4a6f1c80b7c7f`; exact anchors refuse unexpected source. Only the temp clone header, reconciliation early-return/allowed list, and added approval guard change. Original auth/scope/lock/amount/duplicate controls remain in the source. |
| Physical owner/session | `identity.sql:1`, `guards.sql:6`, `renderer.py:36`: postgres owner/session/database, local Unix socket, physical AppDB `7685292944002592802`, read-committed/origin, fixed Oct 6 deadline; call uses `SET SESSION AUTHORIZATION prefunded_authorizer`, then RESET. No SET ROLE substitution. |
| Private authority | `renderer.py:26`, `acl.sql:1`, `guards.sql:80`: owner-private temp approval; all role/default/public temp privileges removed, then clone EXECUTE granted only to postgres/authorizer. Exact full JSON parameters and SQL-side digests checked before preflight. No permanent or public grants. |
| Expired claim | `guards.sql:44`: both token and expiry NULL, or both present and expiry no later than server clock. Active/partial claims refuse; initialization and dispatch claims remain separately denied. Full operation SHA pins token/expiry/fence; `state.sql:13` masks none of those fields. No claim clearing, fence reset, or phase reset. Expiry alone is not evidence that the worker is quiescent; parent must independently establish that. |
| Principal/protected rows | `guards.sql:62`, `state.sql:1`, `postflight.sql:6`: new principal 0, old principal 10000 kobo, treasury available/reserved/consumed 10000/10000/0; no retirement, prior projection, saved-method/signature collision, or auth binding. Only exact collection fields and one new saved method/binding are allowed to differ. Old retired intent and all other protected rows stay hashed. |
| Permanent authority | `guards.sql:20`, `state.sql:34`, `postflight.sql:10`: original OID, owner OID/name, ACL, definer, search path, language and definition hash plus captured routine/role/ACL/trigger/policy/catalog metadata rechecked. Clone is temporary, dropped before completion; approval ON COMMIT DROP and session closure remove temp authority. No permanent original replacement. |
| Fresh proof/receipt | `contract.py:44`, `guards.sql:12`, `postflight.sql:9`, `renderer.py:59`: real clocks, no public `now=` API; proof age 0..60 seconds, paid time before fresh verification and after reconciliation flag. Receipt must match exact bundle, preflight and rollback SQL hashes, affirm rollback/postflight/review, and have verifiedAt <= reviewedAt <= real now. SQL rechecks fresh proof through postflight. New proof requires a new rehearsal/receipt. |
| Canonical SQL | `renderer.py:12`, `renderer.test.py:60`: sorting JSON keys makes persisted/reloaded bundle render byte-identically without changing JSONB values or SQL guards. Nonfinite JSON rejected, SQL quotes escaped, call delimiter checked. |

Trust boundary: digest equality and `independentlyReviewed=true` do not authenticate
the owner or provider by themselves. The parent private driver must independently
authenticate raw proof, pins, sources, rollback completion and unchanged baseline;
capture SQL/errors privately, suppress secret-bearing query logging, and verify
the final commit rather than accepting the postflight marker alone. This remains
a trusted-owner adjudication, not an unattended reconciliation mechanism.

Coverage limit: the expired-pair PG case proves rehearsal preservation/refusal;
the commit/replay PG case uses the no-claim fixture. A combined expired-pair
commit/replay test would strengthen future coverage. Some tampered lease tests
can fail the full-row hash before the specific lease predicate; static inspection
confirms the predicate, but those tests alone do not isolate its rejection branch.

## Minimum safe path for the existing new goal

1. Parent independently captures fresh read-only AppDB state and exact source/ACL
   pins for goal `9f01153c-1589-4dde-b9aa-8f644a846832`, app customer
   `10000000-0000-4000-8000-000000000002`, merchant
   `10000000-0000-4000-8000-000000000001`, integration
   `d91d9e87-8e0d-44de-9b84-1e1d709633d2`, business
   `01M2381RG34HQJMHQKE7DWDACR`, and exact public wallet
   `01M3W0Y93XHJY9RPQ2G75X81WG`. Recheck actual principal, enabled ledger binding
   with `authorized_login=prefunded_treasury_operator`, current wallet mapping,
   ownership, no conflicting policy/route, old principal/history, and treasury.
2. Obtain the authoritative identity, eligibility, routing and opt-in evidence
   described above. A missing default payout route is a stop condition. If the
   provider requires configuration rather than confirmation, that is a separate
   explicitly approved provider action by parent; do not create another wallet
   or choose a sample destination to evade the missing mapping.
3. Build a new source-only, exact-target policy-only transaction and colocated
   disposable tests. No goal creation, mapping overwrite, binding reassignment,
   treasury changes, prefunding, ledger posting, allocation seeding, or new public
   authority. Insert one immutable policy with `enabled=false`, exact authenticated
   provider identifiers, explicit eligibility/policy references and fixed expiry.
   Preserve the actual principal, even if zero. Pin full current rows/metadata,
   use owner/local/physical/deadline guards and fresh proof, coordinate quiescence,
   rehearse rollback, and require an independently reviewed matching receipt.
   Postflight permits only that policy row. This report is not install approval.
4. Independently approve enabling that exact policy after the mapping/economics
   closure and inactive-row rehearsal are complete. Recheck restricted existing
   bridge authority, runtime source pins, real login/TLS/physical identity and
   expiry. Do not rerun the old activation/schema/goal-creation scripts:
   `activation/grant-bridge.sql:29` assumes one binding, zero policies and treasury
   reserved 0; `test-plan/plan_binding.sql:36` invokes goal creation. Those stale
   assumptions are not permission to reset the current payment state.
5. Keep parent payment funding separate. Collected Paystack TEST value is not
   projected savings principal or interest. Only actual independently verified
   provider transfer/funding evidence can support that principal projection.
   An inactive policy needs no fake balance or payout to exist.
6. Existing bridge matching requires integration/business/webhook customer/source/
   destination, enabled unexpired policy and binding, current ownership, positive
   integer-kobo economics, gross-tax=net and amount=net. Absent policy stays
   deferred. Genuine authenticated, integrity-checked and independently reconciled
   customer payouts alone may create allocations and paid-interest ledger receipts.
   Deduplication is `(integration,payout_id)`; changed economics conflict. Credit
   the already-customer-net amount once, never resplit it or credit business funds.
   Keep pending accrual unspendable and sample 733-kobo payouts disposable only.
   Verify actual committed Earnings/notification separately from provider delivery.

SQL basis: `/Users/mac/Baci-worktrees/cursor-savings-phase1/supabase/migrations/20261001230000_customer_savings_interest_policy.sql:3`
defines the immutable per-goal policy; line 41 prepares exact approved allocations;
line 86 applies receipts. No migration was edited or executed by this review.

## Focused test evidence

Recovery folder: `PYTHONDONTWRITEBYTECODE=1 python3 -B <test>` for
`clone.test.py` (2), `contract.test.py` (4), `renderer.test.py` (4),
`postgres.test.py` (4): **14 passed**. PostgreSQL 18 used a newly initialized
temporary directory and Unix-socket-only port 55461, then stopped/removed it.
No connection to the live physical AppDB was made.

Identity-policy folder: same invocation for all seven `*.test.py` files:
collector (7), contract (3), fixture (2), preparer (7), provider reader (5),
identity resolver (7), candidate verifier (26): **57 passed**. Provider transport
and subprocess calls were mocked; no live collector or installer was run.
Four additional pure synthetic refusal probes passed as described in findings.
No full build/typecheck, dependency installation or remote review was performed.

## Reviewed recovery source inventory (SHA256)

Base: `/Users/mac/Baci-worktrees/cursor-savings-phase1/tools/staging/prefunded-card/reviewed-reconciliation`.
These are measured hashes, not independently approved execution pins.

```text
d3685a59059708feff566d15ace48a24f54d62f8c94d6b1a5d37ffebd4c04078  README.md
d360e12ecd16339a5415f9d0b1876030668d09a7945331bb68a79b54f824a840  clone.py
0be92ca3cf98d4a5d4d1810df15cf8ce58675307db20cb1ff6aad2abe3ec6a6d  clone.test.py
624105f92b7981e6e02482712388bd31ae4039494d8beb0d8164f856d708b24f  contract.py
f07aa19dd7656b6cb4767de41aa01df0b3cba94551e54b096e903d5a1f07cd65  contract.test.py
4f90a1396892ffe01735099a3b04f5bc1c7c09c33634eff5724af0fa61a214f7  postgres.test.py
7dc5e27ecda47299efdf369616bde6a5c70a7d6f9e405d00dde45a4330f83f73  renderer.py
6083f2cf4cf2fe509eddda8c6ef1552097bc5082f06723ebc5ac15aff5530e5e  renderer.test.py
91f9124edbec3349f4b725889c38ee11a685d43cc327f4bf0461be3040cefff7  test_support.py
6d42d6bea3a0cd025c387df51564f8985df7ab7c191ab37ba9862057c0f106fb  acl.sql
a04490916dd3b49609d632e8c6af459f328ba8b9d13f31ac4a8eacffa23e860f  guards.sql
aa55f00beea800cc8be988e0859a28a2d8e978410c15cab237f22da8b6cbe89a  identity.sql
5f922bac6d2a538b32ca3f7c5424346ddf7607b7e230b62ce4347b3b4d8a35fa  postflight.sql
5c9e0633daad63b68959ac9eee2bc25364828004f838f997dec97ba20ed072f9  snapshot.sql
628472138aa0c055ec01a49f5254ab614a968b0ba650fec4410cd7679ea40eea  state.sql
```

## Interest audit source pins (SHA256)

First nine paths are relative to the canonical workspace above. Last three are
read-only receiver sources in `/Users/mac/.codex/worktrees/0d77/Baci-app`; these
are separate release inputs, not proof of deployed runtime bytes.

```text
dd76d62613c787c1ebc572cc937f7cafbb2368428a8103f7bbc38869e7de891f  tools/staging/interest-bridge/identity-policy/policy_contract.py
3fe87c46bb973cf4d553ec491c936ff755e4fd50bc6391960c6f5ba8dc64388b  tools/staging/interest-bridge/identity-policy/verify_policy_candidate.py
69f79c4c96442f96ee6c2f9a6c75ab76682326e1e548b99b871c20f20cbd07a5  tools/staging/interest-bridge/identity-policy/resolve_customer_identity.py
f7e62fadedae16627c6bc793a7136e0b97d17cb52b194cdc73412bbfc7bf90a2  tools/staging/interest-bridge/identity-policy/collect_identity_evidence.py
cb326c8c519cbd740df73a16d91af555355a1f31cebb06d878b569647a2289f3  tools/staging/interest-bridge/test-plan/plan_binding.sql
33bfe16e7f97dc7e047ff5c301d4e57a91bcd1cc211cf88e74566d2fa3f8ff99  tools/staging/interest-bridge/activation/grant-bridge.sql
22bf2761b6d3db6bf367bd867e9f00b75acfcacec22af864a73fa564a65813b8  supabase/migrations/20261001230000_customer_savings_interest_policy.sql
370bb586681ad32db8419cbe0f48ed43817c20f3a95a8ef90899516d55e67f2e  apps/web/src/lib/piggyvest/provisioning-request.ts
a62dd4af65aa45ae7ddd516e6302f3d66d2b6d7d853c23601bc906a1260f6176  apps/web/src/schemas/piggyvest/interest-payout-event.ts
e5464f4e832e5a3779eb6532b0e89b64dc7bc56bd16469953afdb5199a76fa07  /Users/mac/.codex/worktrees/0d77/Baci-app/apps/web/tools/piggyvest-staging/replay-interest-runtime.ts
8fa6dbb93d08a97794d1a2daeec347fda7f65a4b6f15e08672da82a2d13e7f83  /Users/mac/.codex/worktrees/0d77/Baci-app/apps/web/tools/piggyvest-staging/replay-runtime-pass.ts
f29a95683b8f96efe4ff8f11e1afdedc514dc465ae8bb26c0242e2456daa4e0b  /Users/mac/.codex/worktrees/0d77/Baci-app/apps/web/tools/piggyvest-staging/replay-interest-statement.ts
```
