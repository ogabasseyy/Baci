# Full implementation goal

The active task covers the complete approved savings improvement and PiggyVest
staging integration, not merely webhook registration or a passing unit-test batch.
This checklist is a continuation tracker, not a replacement for the parent plan
and product rules in the original task worktree:

- `/Users/mac/.codex/worktrees/0d77/Baci-app/docs/superpowers/plans/2026-09-11-piggyvest-staging-integration.md`
- `/Users/mac/.codex/worktrees/0d77/Baci-app/docs/superpowers/plans/2026-09-11-piggyvest-savings-product-rules.md`

## Completion requirements

| Requirement | Evidence required | Current state |
| --- | --- | --- |
| Exact device variant and legacy recovery | Mobile/API regression cases, SQL invariants, rendered customer flow | Local targeted checks pass; physical UI acceptance outstanding |
| Isolated staging authentication | Fixed origin/project/business identity, restricted roles, verified credential response | Request-scoped SSR/project binding, session-bound CSRF and current funding guards pass local synthetic-HTTP checks; real login/installed-session and external activation remain unverified |
| Customer and per-plan wallet provisioning | Durable intent before POST, one dispatch, uncertain-result recovery, verified ownership | Provenance-backed customer/first-plan confirmation and atomic mapping pass combined real local driver tests with simulated provider HTTP; sandbox evidence outstanding |
| Funding channel and contributions | Mapped funding accounts, approved test deposit, signed event and reconciliation | Trusted mapping/provenance and consent now connect through actual /funding and /screen HTTP to restricted PG and synthetic account display; provider deposit/event-to-ledger bridge remains gated; progress is not inferred from balance |
| Webhook processing | Confirmed signing contract, durable inbox/replay, retries, deployed GET/POST | Offline intake/inbox/quarantine implemented; financial processing disabled |
| Ledger and reconciliation | Transactional principal/paid-interest/pending/reservation accounting; duplicate/reversal/concurrency cases | Internal ledger/reservations and registered 172000 exact-executor canonical-evidence, no-duplicate-credit, late-principal/race/restart acceptance pass locally; provider financial bridge remains disabled and complete period-interest/disposition requirements remain |
| Savings policy and UX | Versioned consent, 5% activation, exact-variant price protection, reviewed maturity/grace and readiness | Duration/consent, zero-principal funding and persisted activation traverse actual local HTTP/PG; broader lifecycle/readiness/protected-offer presentation and installed-session acceptance remain |
| Purchase and settlement | Confirmed customer choice, reservation, verified destination, split-payment finality and surplus liability | Catalogue-backed local pickup pricing, customer preparation/status and registered 171000 current recovery pass actual executor/HTTP checks; full checkout/UI, payment legs, compensation, surplus disposition, orders and external settlement remain |
| Cancellation and refunds | 0% fee, reviewed all-plan-interest forfeiture, principal-only refund, failure recovery | Actual 4183 browser preparation immediately hides funding; retained-principal recovery and recovery-only reload pass, with original 4181 evidence preserved; interest disposition, approved refund route/timing and execution remain outstanding |
| Schedules | One collection owner, consent, pause/cancel, failure/retry and late-deposit cases | Durable proposals, authenticated HTTP pause/resume and expiry/restart pass; ownership handover, cadence, complete customer flow and collection transport remain; proposal is not debit permission |
| Artifact and database | Reproducible isolated staging artifact, restricted real executor, full migration/RLS verification | Actual bundled HTTP/JS-node-pg journey and restart, registered synthetic replay, and four cleanup regressions pass; TEST shims are not production packaging; full-public-schema compatibility remains |
| Acceptance and handoff | Full tests, review, staging/provider/E2E evidence recorded separately, unsent factual update | Partial local evidence only |

## Execution boundaries

Continue safe local work when one provider contract is unresolved. Keep only the
affected operation disabled and list its missing evidence. Do not replace the full
scope with a smaller release without the owner's explicit approval.

No commit, push, merge, deployment, DNS/infrastructure change, secret provisioning,
remote database operation, provider mutation, real data/funds or external message
is authorized by this goal. Obtain a concrete scoped approval before activation.
Existing dirty work and production Paystack behavior must be preserved.

## Current work batch

### Resumed full implementation

The owner explicitly requested continuing beyond the previous checkpoint.
The following assignments are active; they are not completion claims:

| Owner | Connected implementation remaining |
| --- | --- |
| Descartes | Shared purchase transport/controller and actual web quote, confirmation and recovery flow |
| Sartre | Native purchase flow, parent-screen wiring and native transport capability verification |
| Leibniz | Shared schedule client/controller, web/native consent, pause/resume and recovery flow |
| Fermat | Append-only wallet-preserving exact-device replacement, canonical revision and downstream compatibility |
| Russell | Explicit never-funded/unexposed draft closure; exposed wallets remain reconciliation-required |
| Hooke | Independent design and source review of these changes |
| Parent | Shared registrations, broad tests, full-schema replay preflight and combined acceptance |

Purchase and schedule components must connect through the real local HTTP
handlers, not only isolated mocks. Device changes preserve the plan wallet,
customer liabilities and original deadline; new terms and pricing remain
server-authoritative. A zero internal balance does not prove an exposed provider
wallet is empty. No synthetic confirmation mechanism may enter shipping code.

External financial processing, refund execution and automatic company/FX
cancellation remain separately gated by missing contracts or product decisions.
Those gates do not suspend the independent local implementation above. Do not
ask the owner to reconfirm continuation at each completed slice.

### Completed-wave acceptance checkpoint

Evidence is detailed in [connected implementation](piggyvest-connected-implementation.md)
and its linked owner/reviewer reports. This docs-only refresh does not rerun tests.

- The actual packaged HTTP/restricted-PG journey passed **four tests total,
  including its restart case**, plus SQL assertions before/after restart.
  Four cleanup regressions and a separate clean post-fix full rerun also pass;
  the earlier concurrent-edit/nounset anomaly is retained, not counted as clean.
- Sartre's current-bundle **4183** browser fixture prepared its one-shot 702,
  immediately removed funding/progress, then recovered retained principal and
  reloaded recovery-only. Same-session **4181** and its already-consumed 702
  were preserved, not reset. Identical IDs in separate clusters are not the
  same reservation or evidence. Browser timing and component timing evidence
  remain distinct.
- Actual SSR project isolation, signed session/actor/goal/origin/path-bound CSRF,
  and pre/post-await funding guards are locally reviewed/tested. Synthetic SSR
  transport and account responses are not genuine authentication/provider proof.
- Parent reports **root lint and typecheck passed at 171000**. Registered 171000
  current purchase recovery has **four actual executor/HTTP tests passed**;
  the owner's prior purchase/lifecycle command also passed **three before and
  one after restart**, plus existing pricing tests. These counts are separate
  harness evidence, not a full-monorepo or product acceptance total.
- **172000 registered local acceptance passed, exit 0:** parent evidence in
  `/private/tmp/piggy-parent-collection-acceptance.log` covers the new standard-
  executor case **once before and once after restart** (the other phase is
  intentionally skipped), SQL canonical-evidence/no-duplicate-credit/late-
  principal invariants, and **12 observed lock waits: eight existing, four new**.
  Leibniz independently reports the same green result and unchanged frozen hash.
  Parent root lint passed **four tasks** with warnings retained; typecheck passed
  **six tasks** after 172000. This bounded local acceptance does not enable the
  provider financial bridge, which remains disabled.

### Remaining acceptance checklist

1. Keep provider financial attribution disabled until its independent contract
   and acceptance gates pass. Accepted 171000/172000 internal observations and
   synthetic credits do not prove provider cash, entitlement or financial finality.
2. Finish requirement-level product connections: full pricing/protected-offer,
   lifecycle/purchase and shared-client/native journeys; wallet-preserving device
   change and unfunded closure; late principal/surplus/period-interest recovery;
   split-payment/all-leg and compensation transitions.
3. Finish collection-owner handover/cadence and customer restart-consent flows.
   Persisted schedule proposals do not authorize automatic debits.
4. Establish full-public-schema compatibility, production-suitable packaging,
   reviewed real sessions, installed native networking/UI acceptance, and
   parent-owned combined/full-candidate tests and independent review.
5. Obtain scoped sandbox/infra approval and verify the signed provider-event
   bridge, account/destination ownership, financial finality/idempotency/fees,
   interest entitlement/reversals, refund route/timing and unresolved maturity/FX
   policy. No provider-funded E2E or live acceptance is established here.

### Earlier parallel assignments (historical dispatch)

These assignments record the earlier dispatch, not the current completion status
of every slice. Use the checkpoint and requirement table above for acceptance;
no owner handoff alone approves release.

| Owner | Scope | Write boundary |
| --- | --- | --- |
| Fermat | Durable cancellation status/recovery backend | New recovery modules and tests; new migrations 20260912161000+ |
| Sartre | Web/native cancellation wiring and recovery UX | UI/controller files and new public recovery DTO, coordinated with Fermat |
| Descartes | Customer-confirmed purchase preparation and reservation | New isolated purchase modules/tests; new migrations 20260912162000+ |
| Leibniz | Collection consent, pause/resume and schedule lifecycle | New isolated scheduling modules/tests; new migrations 20260912163000+ |
| Hooke | Independent security, integration and schema-compatibility review | Audit report and isolated test harnesses only |
| Russell | Official provider gaps and staging packaging readiness | Separate readiness report and isolated local smoke tooling |

Parent owns global executor/migration registrations, cross-workstream integration,
verification and final readiness claims. Migration prefixes reserve nonoverlapping
ranges within their stated ten-minute windows; they are not authorization for
remote application. Existing migrations and others' work remain unchanged.
Provider money transport, infrastructure, secrets and deployed activation remain
outside these assignments. An unresolved provider operation must fail closed;
it must not prevent completing independent local work.

1. Integrate the actual web wallet section and mobile start-savings screen through
   explicit optional staging inputs. Omission preserves the existing flow;
   invalid present staging inputs must never fall back to legacy funding.
2. Share exact draft-consent validation across web and native. Display consent
   separately from server-owned funding eligibility; neither creates purchase
   authority or activates a plan.
3. Exercise the composed web screen through the loopback synthetic preview and
   native component regressions. Neither constitutes authenticated storefront,
   installed native application or provider end-to-end evidence.
4. Authenticated customer context and exact draft connect through the shared
   client and actual HTTP handler to restricted local PostgreSQL. Trusted funding
   eligibility is connected for the proved local path; progress/spendability must
   remain unavailable when their independent evidence is missing. No deployed
   page or native route is established as supplying the optional staging input.
   A real staging binder must independently establish actor/tenant/goal scope;
   do not turn fixture controls, client storage or query parameters into authority.

See `docs/piggyvest-connected-implementation.md` for the connected paths and the
remaining product work. These are not replaced by a smaller launch scope.

The goal remains active until requirement-by-requirement acceptance is proven.
Local test counts, approval flags in a schema and provider documentation alone
are not evidence that a live integration or money operation works.
