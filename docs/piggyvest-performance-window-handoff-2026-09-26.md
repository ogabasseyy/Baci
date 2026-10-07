# PiggyVest: performance-window handoff and resumed validation

The owner ended the performance window on 2026-09-27. Local validation is allowed
again. The sections below preserve the source-only handoff as historical context;
their earlier unverified labels are superseded only by explicit results recorded
in this section. This release does not authorize production deployment or real
provider money movement.

## Resumed validation: 2026-09-27

- First focused checkout run: 57 tests passed in 10 suites.
- Expanded prefunded-card, customer-route and savings-exit run: 685 tests passed,
  two database-dependent tests skipped, across 71 passing suites and one skipped.
- Typecheck found three test-fixture issues: missing `NODE_ENV`, an executor mock
  that did not narrow the two new checkout profiles, and heterogeneous header
  fixture inference. Those were corrected; the next `pnpm turbo typecheck
  --concurrency=2` passed all six tasks (four cache hits).
- Checkout and affected test sources were formatted, ASCII control-character
  rejection retained without a prohibited regex, and the runtime tests split into
  initialization and verification suites with a shared fixture.
- The expanded checkout/route/composition rerun passed 93 tests across 14 suites.
- After the remaining prefunded formatting/async lint corrections, the focused
  source run passed 697 tests across 73 suites; the same two SQL-dependent tests
  were skipped in ordinary Vitest. Biome passed the 127 prefunded/customer-route
  and control-character helper files, with no rule suppressions.
- Mobile checks passed 62 tests across 11 suites after correcting the card review
  amount formatter to retain both kobo digits. Parent reviewed that change.
- Receiver checks passed 234 tests across 20 suites. A missing test-array close
  was corrected, and the filesystem-loader test now runs in Node rather than
  jsdom. Parent reviewed those corrections; the artifact/loader rerun passed
  another 18 tests in two suites. Receiver web `tsc --noEmit` passed.
- Final canonical `pnpm turbo typecheck --concurrency=2` passed all six tasks
  (five cache hits). Full lint still reports 18 mobile errors and three web
  formatting errors in unrelated RedVault checkout files, plus existing warnings.
- Built the real replay artifact without installing dependencies at
  `/private/tmp/baci-replay-validation-20260927.Orianl/bundle`. Both output SHA-256
  digests matched the generated manifest. Both bundles imported successfully;
  invalid configuration was refused with zero network attempts. This proves
  bundling/import/refusal only, not startup against a configured database.
- Initial whole-workspace lint failed with 21 mobile errors and 28 warnings,
  including unrelated checkout hooks, quiz hooks and `tsconfig.json` formatting.
  No unrelated fixes were made. This is not a repository-wide lint pass.
- Disposable SQL checks passed: authorization, projection, reversal, evidence,
  customer (three tests), restricted executor (four), first-card checkout (five),
  receipt-signature storage (one), exit accounting and exit execution. The exit
  accounting harness also ran the two SQL-dependent Vitest checks successfully.
  An initial exit-harness attempt used the receiver tree by mistake; rerunning
  from the canonical savings tree passed both harnesses.
- PostgreSQL validation caught a reserved `authorization` variable name in the
  new checkout SQL and an unconditional revoke of an optional absent role. Both
  are fixed. The optional-role regression proves pre-existing EXECUTE and SELECT
  grants are revoked, not merely absent on a fresh role.
- Two older scratch fixtures needed corrections, not production SQL changes:
  integral JSON numeric kobo can serialize as `100000.00`, and the shared-operator
  journey must create its immutable ledger binding with the correct login from
  the outset. No binding mutability or runtime permission checks were weakened.
- Parent independently reran the final first-card SQL harness: five tests passed.
- The broader sweep also exposed three stale goal-policy executor assertions:
  the expected allowed catalog omitted the three implemented local-only savings
  exit operations. The dedicated SQL principal and existing statement catalog
  already allow those operations. The test fixture now includes them in both
  positive checks and foreign-role/parameter rejection checks; no runtime grants
  or authentication behavior changed. The corrected goal-policy and statement
  catalog suites passed all 231 checks; focused Biome passed as well.
- The full `pnpm turbo test --concurrency=1 --continue=always` sweep was stopped
  with SIGINT after roughly 14 minutes once unrelated repository failures were
  established. Turbo returned exit 0 on interruption, but that is not a test pass:
  no completed full web/mobile-storefront result exists for this run. Four other
  task results were cache hits, not fresh runs. The original runner and its
  recorded web test process IDs were absent afterward.
- Observed failures included `validate-storefront-edge-inventory.test.ts`,
  `materialize-supabase-history-replay-ordering.test.ts`,
  `verify-supabase-history-replay-gigl-pending-sources.test.ts`,
  `cloudflare-evidence-process-isolation.test.ts`,
  `cloudflare-evidence-process-isolation-credentialed.test.ts`,
  `verify-analytics-delivery-authority.repository.test.ts`,
  `verify-supabase-history-replay-manifest.test.ts`, and
  `verify-event-pipeline-boundaries.live.test.ts`. These were not repaired as part
  of the savings validation slice. Full output is preserved at
  `/tmp/baci-workspace-tests-20260927.log`.

No deployment, live provider settlement or phone-readiness claim follows from
these source checks. First-card public entry/return/mobile wiring remains pending
and its enablement remains off.

## Preserved work

Worktree: `/Users/mac/Baci-worktrees/cursor-savings-phase1`.
No commits, branch changes, production deployments or provider money movements
were made by this continuation. Existing dirty work was preserved.

Seven distinct agents participated: five Terra and two Luna. No Astra subagents
were used. The final active agents were instructed to make code edits only.

- Saved-card authorization now has independent verification/provisioning and an
  immutable historical resolver. New reservations require an active verified card.
- Customer request/status handlers, SQL idempotency and scoped dispatch leases are
  connected in the local runtime. Worker claims pin merchant and treasury as well
  as integration/business/database, preventing sibling-treasury claims.
- Independent evidence, mixed bank/card attribution, reversal obligations and
  verify-only recovery are connected through callable source adapters.
- The restricted executor uses one treasury operator where the existing immutable
  treasury/ledger bindings require one login, but separate statement-limited
  customer/worker/reversal constructors. Provisioning and ingestion remain separate.
  These constructors are code-level restrictions, not separate database identities.
- Exit accounting has committed-evidence checks and explicit existing-order/refund
  authority. It does not invent economics or bypass canonical-local isolation.
- Native notification registration/rotation and savings inbox refresh are wired in
  source. Mobile regressions were corrected without restoring the old internal-
  wallet card-funding path.

## Changes made or completed during the window

These have not received final validation after the pause:

- Nullable `session_id` handling in the verified legacy bank-inflow adapter, with
  regression test additions. Genuine no-session events must not be rejected merely
  because the optional field is absent.
- Shared treasury-operator executor profiles/grants and classified-inflow catalog
  connection, including the same-binding customer/worker test fixture.
- Equivalent `style.pointerEvents` replacements in the savings card and keyboard
  surface, preserving the design and keeping the compliance assertion intact.
- `prefunded-card-receipt-replay.ts` and its colocated tests: original signed bytes
  flow through a separate evidence writer before the ledger reader projects a bank
  inflow. Deferred outcomes retry; conflicts require reconciliation; storage errors
  propagate. Previously stored evidence still triggers projection on retry.
  Internal-transfer evidence never enters ordinary bank-credit projection.
- The public legacy inflow wrapper now calls the verified adapter for enrolled
  destinations, including stored receipts whose outer wallet differs from the
  destination. Missing evidence defers; partial installation still refuses. New
  `evidence-public-route.test.sql` covers no-session credit, duplicate protection,
  rejected identity/amount claims, reader-role isolation and the unchanged
  non-enrolled legacy branch. The existing evidence harness includes this file;
  neither it nor the patch has been executed during the window.
- Receiver-tree intake now retains the original authenticated header and requires
  atomic signature-storage acknowledgement. Additive receipt-signature SQL and
  source regressions are in `/Users/mac/.codex/worktrees/0d77/Baci-app/apps/web/tools/piggyvest-staging/`.
  Its narrow reader pins receipt/digest/active claim; new grants do not give the
  worker table access. It also checks lease expiry after a possible row-lock wait.
  Old missing-header receipts are not re-signed or automatically reset for replay.
- The receiver supplies that restricted signature reader when the prefunded replay
  callback has no explicit override. The original raw bytes remain unchanged and
  missing provenance stays retryable. These source changes are not installed.
- A server-only composition factory builds fixed restricted executor profiles,
  worker and receipt adapters in the savings tree without starting I/O or discovering
  credentials. A separate replay-only factory and opt-in receiver entrypoint are now
  written as described below; artifact execution and activation remain pending.
  There are no cross-worktree runtime imports.
- Static integration review found the evidence schema still rejected the actual
  provider bank shape (`inter` / `COMPLETED`, omitted source and session, nullable
  outer fields). Source now accepts that exact shape alongside the earlier one;
  independent transaction status/source/amount and wallet-ownership verification
  remain required. Captured-shape regressions are written, not executed.
- The receiver's event schema also now preserves explicit-null sessions, rather
  than quarantining them before replay reaches the nullable SQL adapter. Source
  schema/decryption regressions cover this change; neither has been executed.
- The composition now supplies the receiver's exact pre-signature enrollment
  callback. It binds original-byte digest and event metadata to a restricted
  worker-only SQL lookup of immutable integration/merchant/treasury/customer/goal
  mappings. No copied inbox, original signature or already-ingested evidence is
  required at this routing stage. It never authorizes credit itself.
- Parent and Terra review corrected two routing regressions: a valid bank wallet
  may be the inner or outer mapped wallet (conflicting candidates defer), and a
  sparse internal-outflow event can route through one uniquely matched immutable
  operation without inventing its missing fields. Unknown enrollment never falls
  back to legacy credit. Regression sources and loader order are saved, unrun.
- Added `createPrefundedCardReplayRuntime` as the restricted receipt-only
  composition: fixed treasury/evidence profiles, immutable system/scope pins,
  and only enrollment and replay callbacks. Static review found that relying on
  lazy connection verification would consume receipt retries on configuration
  failure; activation now awaits read-only identity/session readiness checks on
  both direct connections before returning callbacks. Invalid configuration still
  causes no I/O. It does not construct card charging, authorization provisioning
  or scheduled dispatch. Paystack collection credentials are not part of its
  configuration.
- The receiver daemon now reaches `runReplayEntrypoint`. Optional activation
  requires exact module/configuration SHA-256 pins. Both the main activation
  configuration and the separate credential file use the bounded root-protected
  reader. The loader validates credential and sibling-module digests before import,
  rejects additional runtime capabilities, and never falls back to legacy replay
  when enabled loading fails. Protected-file, configuration and entrypoint
  regression tests are written, not executed.
- Added callable artifact-builder source for bundling the receiver and canonical
  replay factory into two sibling Node 24 ESM files, with a source/output manifest.
  This is not a generated artifact, an installer or a deployment. Source assembly
  and runtime isolation received bounded static review; executable checks remain
  deferred. Both database connections still require the existing approved TLS
  contract; no raw Docker/plaintext connection exception has been added.
- Static review also found the restricted executor was feeding the complete
  `pg` QueryResult into a strict two-field parser. Real driver metadata would
  therefore reject otherwise healthy operations. The executor now projects only
  `rows` and `command` before validation; readiness regressions include realistic
  driver metadata. This correction has not been executed locally or deployed.
- The next source slice adds an explicit one-time saved-card consent contract,
  immutable audit storage committed with the reservation, and a scoped read-only
  capability returning only verified masked saved cards and goal limits. Existing
  request keys retain their payload; unknown outcomes do not authorize a new charge.
- Added a default-off public `savings/card-contributions` entrypoint and a
  customer-only runtime constructor. They pin dedicated staging host/auth origin,
  the isolated physical database, TLS, merchant/business/integration/customer
  scope and the fixed customer SQL catalog. The original local-only context
  configuration remains local-only; both contexts reuse the same RLS identity
  projection. No provider credential or dispatch callback enters this route.
- Mobile saved-card source now connects to this contract with a one-time amount
  review and scoped persisted request recovery. Bank-transfer UI is retained;
  adding a card through the old internal-wallet authorization path is not restored.
  The endpoint and SQL remain inactive until validation and reviewed provisioning.
  See `tools/staging/prefunded-card/public-README.md` for the bounded contract.
- Static review of the customer capability found a treasury lock-upgrade race and
  enabled admission despite exhausted treasury headroom. The source now takes the
  binding update lock before identity locks and requires positive spendable
  headroom without exposing the treasury balance. SQL and concurrent-read
  regression sources were added; Terra confirmed the corrections by reading them,
  not by running them. The public runtime also refuses new queries at the fixed
  staging deadline, including on an already-constructed executor.
- Mobile review found that returning to the same customer/merchant/goal could
  revive an old pending snapshot write. Each hook activation now has a generation
  fence carried through persistence, submission, status reads and terminal reset.
  Cleanup invalidates the generation; an A-to-B-to-A regression is written, unrun.
  Durable snapshots keep the original idempotency key after uncertain outcomes;
  only explicit terminal completion/failure allows a new request key.
  Terra's bounded source rereview reported no remaining actionable finding in
  this correction. It does not establish runtime correctness or passing tests.

The parent interrupted its pre-existing `pnpm turbo test` with Ctrl-C when the
window began. It exited 130 and its recorded test process IDs were absent afterward.
This was not a successful full test run. No test watcher was started.

## Evidence from before the pause

These results cover earlier snapshots, not all subsequent code edits:

- Parent prefunded tests: 312 passed across 33 suites.
- Parent exit tests: 67 passed, two skipped in ordinary Vitest; the private exit
  accounting harness separately passed those two database-adapter tests.
- Parent authorization, reversal, customer/queue and projection SQL rehearsals
  passed using disposable Unix-socket databases and synthetic provider fixtures.
- Whole-workspace typecheck passed before the final executor/evidence/replay edits.
- Last completed full mobile run: 1,237 suites passed and one compliance failure;
  7,289 tests passed and one failed. The equivalent pointer-events source correction
  is present but its final validation is deferred.
- Full lint was not green. The interrupted full Turbo test run also showed web
  cost/inventory/history-replay failures; it did not establish a full repository pass.

No mocked HTTP or private SQL result is evidence of real provider settlement,
deployment, native delivery or phone readiness.

## Deferred validation, in order

Run from the worktree above, only after explicit release:

1. Focused source tests:

   ```sh
   pnpm --dir apps/web exec vitest run src/lib/piggyvest/prefunded-card src/schemas/prefunded-card src/lib/piggyvest/runtime-composition-card.test.ts
   pnpm --dir apps/web exec vitest run src/app/api/storefront/customer/savings/card-contributions/route.test.ts src/lib/piggyvest/customer-policy-context.test.ts src/lib/piggyvest/customer-policy-scope.test.ts
   pnpm --dir apps/web exec vitest run src/lib/piggyvest/savings-exit src/schemas/savings-exit src/lib/piggyvest/runtime-composition-exit-execution.test.ts
   pnpm --filter @baci/mobile-storefront exec jest --runInBand --runTestsByPath components/ui/ModalSheet.test.tsx components/wallet/WalletSavingsPlanCard.test.tsx __tests__/config/expo-compliance.test.ts components/wallet/WalletSavingsProgressModal.test.tsx
   pnpm --filter @baci/mobile-storefront exec jest --runInBand --runTestsByPath schemas/savings-card-contributions.test.ts lib/savings-card-contributions.test.ts lib/savings-card-contribution-snapshot.test.ts components/wallet/savings/savings-card-contribution-utils.test.ts components/wallet/savings/use-savings-card-contribution.test.ts components/wallet/savings/SavingsPlanCardContribution.test.tsx components/wallet/savings/SavingsPlanCardContributionView.test.tsx
   ```

2. Restricted SQL, recovery, identity and race rehearsals:

   ```sh
   bash tools/staging/prefunded-card/authorization-local.test.sh
   python3 tools/test/prefunded-card-customer.test.py
   python3 tools/test/prefunded-card-projection.test.py
   bash tools/test/run-prefunded-reversal-local.sh
   python3 tools/staging/prefunded-card/evidence-local.test.py
   python3 tools/test/prefunded-card-postgres-executor.test.py
   python3 tools/test/prefunded-card-checkout.test.py
   bash tools/test/savings-exit-accounting-local.sh
   bash tools/test/savings-exit-execution-local.sh
   ```

3. Workspace gates, preserving unrelated changes and reporting actual failures:

   ```sh
   pnpm turbo lint
   pnpm turbo typecheck
   pnpm turbo test
   ```

Review the final combined diff after these checks. CodeRabbit's attempted dirty-
tree review exceeded its file limit; do not claim a completed whole-tree AI review.
No installs, builds, live probes, deployment or cleanup are implied by this list.

Additional receiver checks from `/Users/mac/.codex/worktrees/0d77/Baci-app`, also
deferred until release:

```sh
pnpm --dir apps/web exec vitest run tools/piggyvest-staging/intake-handler.test.ts tools/piggyvest-staging/intake-persist.test.ts tools/piggyvest-staging/intake-server.test.ts tools/piggyvest-staging/schemas/intake-signed.test.ts tools/piggyvest-staging/replay-signature-reader.test.ts tools/piggyvest-staging/schemas/replay-signature-reader.test.ts tools/piggyvest-staging/replay-store-signature.test.ts tools/piggyvest-staging/replay-private-fetch-signature.test.ts tools/piggyvest-staging/replay-prefunded.test.ts tools/piggyvest-staging/replay-run-prefunded.test.ts
python3 apps/web/tools/piggyvest-staging/receipt-signature-storage.test.py
pnpm --dir apps/web exec vitest run src/schemas/piggyvest/events.test.ts tools/piggyvest-staging/replay-crypto.test.ts
pnpm --dir apps/web exec vitest run tools/piggyvest-staging/replay-entrypoint.test.ts tools/piggyvest-staging/replay-configuration.test.ts tools/piggyvest-staging/replay-prefunded-loader.test.ts tools/piggyvest-staging/replay-protected-file.test.ts tools/piggyvest-staging/replay-runtime-pass.test.ts tools/piggyvest-staging/schemas/replay-prefunded-settings.test.ts tools/piggyvest-staging/schemas/replay-runtime-config.test.ts tools/piggyvest-staging/replay-artifact tools/piggyvest-staging/schemas/replay-artifact
```

Independent Terra static review found no concrete issue in the initial signature
storage/intake patch. Subsequent post-lock expiry hardening is parent-reviewed only;
neither review establishes SQL execution or passing tests. Activation order and
historical-receipt limits are recorded in the receiver's `receipt-signature-contract.md`.
Terra's separate enrollment review found two routing defects (outer-wallet bank
mapping and sparse outflows). Both were corrected and the same reviewer confirmed
their source fixes and regression coverage. This was a bounded static re-review,
not a complete system review or execution of those regressions.

The runtime/artifact static review found three issues: receiver schema sources
missing from the bundle allowlist, direct connection verification occurring after
receipt claims, and an unprotected main activation-config read. These are corrected
in source. The subsequent real-driver metadata finding is also corrected. Parent
review additionally fixed bare Node built-in import handling and test/type source
defects in the builder. Terra's final bounded rereview reported no remaining
actionable findings; this is not a passing build or executed test result.

The real artifact build, module loading and invalid-config refusal passed during
the resumed validation above. An isolated startup rehearsal using protected
configuration still needs to verify both direct connection probes before claims,
unchanged legacy-disabled behavior and actual signed replay against disposable
staging fixtures before planning the coordinated staging deployment.

## First-card source continuation

The new first-card schemas, provider adapter, runtime and concrete restricted
database composition are written but inactive. The runtime requires a trusted
customer resolver, explicit one-time contribution/card-saving consent, a durable
reservation before initialization, one winning initialization claim, and independent
verification before promotion of that same collection. Unknown outcomes retain
the reservation and never become a second charge. A store-detected conflicting
saved card returns reconciliation rather than a misleading success.

Two narrow executor profiles reuse existing restricted logins; this does not
create new grants or isolate away those logins' existing union of privileges.
SQL install/regression sources and a disposable-database harness accompany this
slice. Their combined review and execution status must be recorded separately;
writing a harness or reviewing source is not proof of an executed race or payout.
See `docs/piggyvest-first-card-source-2026-09-26.md` for the contract and boundaries.

No tests, lint, typechecks, builds, installs, watchers, live provider calls or
deployment ran for this continuation. The first-card public HTTP endpoint,
return page and mobile checkout/recovery integration are not yet connected.
`newCardEnabled` remains false.

One Luna implemented the provider adapter and runtime regression updates; Terra
implemented storage and a separate Terra reviewed the bounded source. Parent
review corrected the scratch fixture's immutable operator binding, refined
NULL-case regression inputs, and added a deterministic treasury/intent lock
ordering rehearsal source. Review findings about catalog breadth, lock inversion
and expiry after insert waits are corrected. Final bounded Terra rereview found
no remaining actionable TypeScript/SQL findings. The Python harness was only
parent-reviewed; nothing in this slice has been executed or deployed.

## Still incomplete beyond validation

- First-card hosted checkout has new backend source, not a working customer-facing
  flow. The public/mobile source wiring still covers already-provisioned saved
  cards only. The first-card HTTP/return/mobile integration, combined validation and
  genuine payment/settlement proof remain outstanding. `newCardEnabled` stays false;
  scheduled dispatch and public activation
  remain incomplete. The receipt daemon has new opt-in
  source wiring, but the combined artifact, pinned configuration and restricted
  database provisioning have not been built or installed. The new local handlers
  are not installed public endpoints.
- Positive `canonical_local` purchase/cancellation integration remains incomplete;
  the existing canonical activity guard still rejects its ledger writes. This is
  implementation work, not merely an owner-sudo gate.
- Approved staging provisioning, genuine provider evidence/settlement and native
  device delivery remain unproven. Separate staging EAS identity/build configuration
  is still missing. Do not reuse production identity as a shortcut.

The owner has not released the performance window. Keep validation paused.
