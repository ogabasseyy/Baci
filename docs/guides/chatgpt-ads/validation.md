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
  review gate was bypassed. The full monorepo test run is still in progress.

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
