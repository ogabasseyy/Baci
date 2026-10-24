# ChatGPT Ads validation and rollout status

Date: 24 October 2026. This records local validation; it is not a production
activation or an OpenAI ingestion receipt.

## Implemented

- Merchant-owner setup at `/dashboard/integrations/chatgpt-ads` with Pixel ID,
  write-only CAPI key entry, blank-key preservation, disconnect, and screenshots.
- Authenticated, merchant-resolved settings RPC using the normal Supabase client
  and RLS. Saved keys cannot be selected by authenticated or anonymous clients.
- Public Pixel ID projection, consent-aware SDK, targeted `measureSingle`, and
  fresh checkout attribution reads.
- Paid conversions through the existing domain-event router and durable
  destination dispatcher only. Original event ID and timestamp are preserved;
  the authoritative merchant-scoped order is reloaded and must be fully paid.
- Separate destination constraint widening and validation migrations so the
  queue-table scan does not retain the earlier exclusive DDL lock.

## Verification evidence

- The combined affected suite passed: 349 tests across 101 files. One earlier
  parallel-check run hit an import timeout in the existing
  `event-pipeline-service-role-test-client.test.ts`; the isolated rerun and the
  complete suite with two workers passed without changing its timeout. After
  extracting the shared consent helper, all 30 affected consent/Pixel tests
  passed again and the main app typecheck passed again.
- Task-owned TypeScript lint passed across 42 files. Full web lint passed;
  existing warnings outside this task remain.
- Scoped migration replay passed against a disposable copy of the existing local
  schema. The clone omitted pg_cron/pg_net extensions and old table grants; it
  contained no source table data. Existing owner table grants were restored only
  in the rollback fixture, and Supabase-style default authenticated table grants
  were explicitly enabled before applying the new migration.
- SQL regression tests cover owner writes, direct saved-key read denial, blank
  key preservation, cross-tenant read/write rejection, disconnect, public Pixel
  projections, audit redaction, duplicate enqueue, database routing, worker
  claim, and completion receipts. All fixture data and queue messages roll back.
- Database type generation used this migrated local schema. Only the new table,
  new RPC, and new feature column were integrated into the generated type file.
- CodeRabbit reviewed the full staged application/SQL diff and raised 15 issues.
  Valid issues were addressed, including default-grant revocation, consent
  lifecycle, migration lock scope, audit assertions, runtime response parsing,
  relationship metadata, and error-path coverage. Two response-parser comments
  described the same change. The dashboard status/browser source mismatch was
  removed by making the new integration feature-settings-only; it has no legacy
  merchants-table column.
- A follow-up CodeRabbit scan raised three nonblocking observations and no
  critical/major issues. Key-only RPC updates now preserve the pixel and have a
  SQL regression; consent parsing now uses a shared server-safe helper. A local
  event-age diagnostic was deferred: original timestamps remain immutable, and
  provider age rejections already become permanent HTTP failures in the worker.
  No timestamp clamping or historical backfill was introduced.
- The previously undeclared `oidc-provider` dependency in
  `tools/builder-auth/provider-storage.ts` is fixed locally with a runtime
  dependency and matching TypeScript declarations, kept separate from the Ads
  feature commit. All 12 monorepo lint/typecheck tasks passed; existing lint
  warnings remain. The runtime import and `InvalidGrant` constructor smoke check
  passed. Existing locked package resolutions are unchanged.
- CodeRabbit initially rejected the separate dependency review with a
  rate-limit/account-capacity error. A retry after its stated cooldown completed
  and raised zero issues across the manifest, lockfile, and validation note. No
  review gate was bypassed. The broad local run was later interrupted when the
  host was heavily swapping; completed mobile/shared results remain separate
  from full final-head web coverage, which must pass in CI.

## PR review fixes

The first Codex code review identified missing attribution on the actual
Ogabassey/generic checkout requests, a hydration fallback that withdrew saved
consent, and missing colocated schema boundaries. Regression tests reproduced
the missing request fields and the false consent command before the fixes.
Both checkout paths now read consent and SDK references at submission. Generic
order creation was extracted into a focused module so its outgoing request,
idempotency header, and unpaid status are tested directly.

The order API regression verifies that consent and references survive the
existing order RPC boundary and reach the durable paid-event dispatcher. Denied
consent suppresses provider delivery. An SSR/hydration test verifies that saved
consent is never forwarded as a denial, while the existing revocation test
continues to require a real denial command. Schema coverage includes Pixel ID
characters/length, trimmed key limits, disconnect refinement, wrong types,
unknown fields, and secret-bearing response rejection. All 39 focused tests
passed after these fixes.

The two append-only migrations are now pinned in the existing Ads replay
manifest, and the SQL fixture is part of CI chronological replay. The earlier
missing-manifest error was reproduced by a regression before registration.
Current-head CI and Codex review remain required after the fix is pushed.

CodeRabbit rejected the follow-up review attempts with an account-capacity
error, including retries after its stated cooldowns. The owner explicitly
authorized skipping CodeRabbit for this follow-up commit and push. This waiver
does not waive repository hooks, final-head CI, or the general Codex review.

Follow-up validation: all 12 monorepo lint/typecheck tasks passed, and a final
app typecheck passed after adding the remaining colocated tests. The broader
affected run completed with 2,087 passing tests across 415 files and one crypto
UI timing failure before order submission; that test passed in isolation without
changing its timeout. The authority/consent/guide suite passed 24 tests across
three files. The live replay manifest verified 1,573 pending sources. The
copy-heavy manifest fixture suite hit host timeouts and cleanup races under
heavy swapping; this is not recorded as a passing suite. Full final-head CI is
still required once all fixes can be committed and pushed.


## Ads Manager and remaining rollout

The Ogabassey website source and Successful payment conversion are created and
were re-read through the connector. The standard event type is `order_created`;
Baci controls its payment-confirmed emission condition. No campaign uses this
conversion yet, no key was generated, and no live conversion was sent.

Production still needs reviewed integration/migration deployment, the existing
pipeline's shadow/canary/provider-identity rollout, secure owner key setup, and
provider-side ingestion verification. Credential creation requires action-time
browser confirmation; it should occur only once the secure production save path
is ready. No campaign spend or production migration was performed by this task.
