# Oxygen integration — agent handover

Prepared 5 October 2026 (Africa/Lagos). User requires TDD and current 2026 best practices and patterns. Read this file together with [the reviewed integration plan](2026-10-05-integration-plan.md); this handover does not replace its financial, tenant, privacy or rollout requirements.

**20 October update:** Read [the staging results and remaining checkout work](STAGING-RESULTS-2026-10-20.md) before interpreting the historical blockers below. Staging access, KYC, cancellation/rebooking, approval and activation have since been exercised. Hosted payment completion and merchant settlement remain unverified; Oxygen manually completed staging prerequisites. Offer letters are delivered by email for the current flow.

## Assignment

Take over the Oxygen X / OxygenNow integration workstream for Baci/Ogabassey. First establish the current repository and contract baseline, then progress through the plan's executable-handoff gate. Implement only the confirmed, authorised scope using test-first development. Keep unresolved provider operations unavailable; do not manufacture API contracts to get tests passing. Continue useful independent work when a provider answer blocks one portion, and report precisely what that answer blocks.

This handover is an execution brief, not evidence that the missing provider contracts or environment access have been resolved. Do not deploy, merge, initiate live financial transactions, use production credentials for tests, change production settings or send partner emails. Test-environment operations must use confirmed test endpoints/accounts and be within the user's authorised scope. Do not repeatedly request permission for work already authorised in the receiving conversation.

## Read first and establish the baseline

1. Read root `AGENTS.md`, applicable app instructions, `apps/web/CLAUDE.md`, and `docs/agent-guidance/validation.md`. Repository instructions override generic skill examples.
2. Read `docs/partners/oxygen/2026-10-05-integration-plan.md` in full, including all review corrections, questions, tests and executable-plan deliverables. The latest review found no additional material gap; that is not runtime or production certification.
3. Inspect current branch, HEAD and task-owned/unrelated changes. The discovery baseline was `9e9a95acd8` with extensive unrelated edits. Preserve them; do not reset, delete or indiscriminately stage them. Reuse an appropriate branch-attached worktree for existing PR work. If selecting an isolated checkout, ensure the uncommitted plan and this handover are available there; a fresh worktree will not copy them automatically.
4. Read current manifests, lockfile and app configs. Use installed Next.js documentation under the app's resolved `node_modules/next/dist/docs/` before framework changes. Inspect existing patterns before designing replacements.
5. Re-read the official [Oxygen documentation](https://oxygenxfinance.gitbook.io/oxygenxfinance-docs), including all indexed subpages. Public Markdown versions are available by appending `.md`; `llms.txt` lists pages. Treat documentation examples as samples, not complete schemas. Avoid printing token-bearing samples or personal data. Use the onboarding guide at `/tmp/oxygen-partner-integration-guide.pdf` if available, but do not depend on that temporary file surviving.

Maintain a small dated contract register beside the plan: confirmed source, endpoint/behaviour, unresolved question, affected phase and evidence required to close it. Use current official framework/provider documentation for uncertain or changing facts; record relevant version and source. Do not claim a modern pattern is appropriate merely because it is called a “2026 best practice.”

## Current blockers and business boundaries

- Production Partner access was found; Development/Staging Partner API access and exact API environment mapping remain unconfirmed. Vendor dashboard document checkmarks are not API readiness. Never test with the Production account's keys.
- Oxygen owns eligibility, credit assessment and repayment. Baci supplies the commerce workflow; Ogabassey supplies devices, fulfilment, warranty and after-sales. Do not build a replacement credit-scoring engine.
- Statement handling is undocumented. Confirm whether statements are unnecessary, collected by Oxygen, or require a documented partner upload/link flow before calling the application path complete.
- Full offer/repayment terms, eligibility state/error/freshness rules, webhook authentication/events, mutation idempotency and status reconciliation, activation/dispatch evidence, settlement and refund contracts remain unresolved as detailed in the plan.
- The supplied commercial requirement is full approved invoice settlement without merchant deductions. Do not invent timing or apply another gateway's fees. Approval, activation, payment and settlement remain distinct.
- Initial regions are South West, South South, South East and Abuja; confirm which customer/delivery address determines eligibility.
- Chat is a supported design option, not an instruction to replace checkout. Authenticated-only flow, single-item pilot, split-funding restrictions and reusable prequalification are choices to resolve, not already accepted requirements.

## Mandatory TDD workflow

Use the available `superpowers:test-driven-development` skill and its good-test guidance, subject to repository constraints. For every new or changed runtime behaviour:

1. Identify a concrete observable requirement and the production defect/change the test would detect.
2. Write a focused failing test first and run it. Verify RED is caused by the missing/wrong behaviour, not broken imports, fixture setup, connectivity or unrelated failures.
3. Implement the smallest coherent production change that makes it pass. Run the same test to verify GREEN.
4. Refactor while preserving behaviour, then run affected coverage. Repeat per behaviour rather than implementing an entire phase before its tests.
5. Record concise evidence in `docs/partners/oxygen/TDD-EVIDENCE.md`: requirement/test, exact command, expected RED failure summary, GREEN result and related file/change. Include test counts and unresolved failures, not secrets or full provider payloads. Never fabricate a RED run or label pre-existing green tests as proof of test-first development.

Test real orchestration and observable results. Mock provider/network boundaries with synthetic deterministic fixtures; use disposable local database tests for actual constraints, RLS, transactions and races. Do not mock the very state transition, permission check or idempotency rule being tested. Use controllable clocks and synchronization barriers instead of timing-dependent sleeps. Test public behaviour rather than internal call counts or snapshots that simply mirror implementation.

Every runtime bug fix needs an exact regression test. Types-only, constant-only configuration, documentation and other repository-defined exceptions do not need artificial tests. Verify generated migrations/types with their applicable tooling. Never delete existing/user-owned production code because a generic TDD example says to start over; preserve unrelated work and apply the test-first discipline to task-owned changes.

## Engineering patterns to follow

- Strict TypeScript, explicit types/`unknown`, type-only imports, focused modules and existing primitives. Use Zod schemas in the app schema directory. Put genuinely shared runtime contracts in `packages/shared`; keep provider transport/secrets server-side. Do not introduce a new agent framework, queue, ORM or dependency without a demonstrated need.
- Use pnpm, Turborepo and Biome. Preserve React Compiler policy: no manual `React.memo`, `useMemo` or `useCallback`. No `dangerouslySetInnerHTML`. Do not upgrade framework versions merely to claim currency.
- Use normal Supabase clients under RLS for user operations; authenticate and resolve customer/order or merchant/staff authority correctly. No service-role exception is inherited from an existing handler. Worker/webhook database roles and grants must be concrete and reviewed before implementation, not a public RPC that trusts a caller's `verified` flag.
- Append migrations; never edit historical ones. Use explicit columns, handle query errors, enforce tenant relationships and index foreign keys. Changes to `apps/web/src/proxy.ts`, `apps/web/src/config/business-types.ts` or `.env*` require explicit user authorisation.
- Separate provider transport, deterministic transition rules, durable action intents, evidence processing and presentation. Reuse existing code only after checking its provider assumptions, access boundary and money units.
- Scope attempts to order/merchant/environment and a stable provider account. Credential revision is not event identity. Use atomic constraints for deduplication and explicit transition rules for reversals. A lost response or expired worker lease does not authorise replaying a financial mutation.
- Money inside the Oxygen contract uses exact minor units with explicit conversions to existing Baci/provider fields. Validate amount, currency, invoice version, offer validity and current liability server-side. Never trust a chat message, client success callback or manual status label as financial evidence.
- Enforce unresolved-financing and fulfilment gates across checkout, payment-method switching, manual credit shipping, order edits, mobile-admin and shipment booking. A superseded attempt's financial success still needs accounting/remediation.
- Store verified incoming evidence durably before acknowledging it under Oxygen's agreed delivery contract. Make local financial/inventory effects idempotent and external side effects recoverable. Keep reconciliation working when new applications are disabled.
- For chat, use secure authenticated form/action handoffs and the same durable backend orchestrator as checkout. Keep BVN/NIN, bank statements/details, OTPs, signatures, documents and signed URLs out of model context, transcripts, analytics and tool logs. The model explains safe provider results; it neither calculates eligibility nor authorises loan transitions.

## First milestone and progression

Produce or update the executable-handoff deliverables listed in the plan: contract register, product/transition decisions, persistence/authorisation design, accounting/recovery design and a bounded file/test/migration list. Identify which requirements are confirmed and testable now. Do not invent final schemas for unanswered provider contracts.

If the receiving conversation authorises implementation, choose the smallest confirmed vertical slice and prove it with RED → GREEN → REFACTOR. Keep incomplete provider actions default-off/unavailable. Advance through the reviewed phases as their prerequisites close; mock-only progress is not provider acceptance. If no meaningful implementation slice is contract-ready, deliver the concrete blocked-work register and do not add speculative production scaffolding.

Treat the plan's full verification matrix as acceptance criteria. Prioritise merchant isolation, customer authority, malformed/pending eligibility, duplicate/concurrent initiation, indeterminate mutations, stale offers, money units, inventory expiry, payment-method switches, manual fulfilment, late events, key rotation, direct-settlement accounting and optional chat interruption/resume. Do not substitute a happy-path mock for these behaviours.

## Validation and reporting

Run targeted tests during each TDD cycle. Select final scope from `docs/agent-guidance/validation.md`: isolated app work uses affected-package checks; shared runtime/cross-app work requires `pnpm turbo lint`, `pnpm turbo typecheck` and `pnpm turbo test`. Web/mobile-admin use Vitest; mobile-storefront uses Jest. Add disposable migration/RLS checks for database changes. Use the exact app-native QA scripts when applicable.

Before committing or shipping code, run `coderabbit review --agent -t uncommitted` in the task worktree and address valid critical/high findings. Report an unavailable reviewer as a blocked review gate. Keep pre-existing unrelated failures distinct; do not fix unrelated work just to make the suite green. Follow current-head CI/review requirements for any authorised PR work. No merge or deployment is authorised by this brief.

The final handover/status must state: files and behaviours changed; contract sources; RED/GREEN evidence; checks run/results; review status; blocked questions; next smallest action. Distinguish local tests, provider sandbox verification, PR/CI, deployment and production results. “Implemented against mocks” is not “Oxygen integration complete.”
