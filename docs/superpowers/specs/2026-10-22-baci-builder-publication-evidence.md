# Task 8: publication approval implementation

## Implemented boundary

The MCP publication tool requests a ten-minute, owner-bound approval. Only the normal signed-in Baci owner confirmation page commits it. SQL checks canonical connection/grant, store, policy, exact opaque draft, readiness and independent render evidence in the transaction. Only homepage layout/copy/theme and necessary publication visibility/metadata change. Pending and published SEO/settings and secondary pages are preserved.

A committed request reconciles its receipt before expiry, consumed nonce or stale draft checks, while current authority remains required. History, audit, receipt and owner-scoped delivery outbox commit together. Delivery recovery does not republish, and a fresh owner session can recover delivery after ChatGPT revocation. Browser/native public writes maintain separate public revisions; an overtaken receipt becomes superseded.

The public Puck path reads config and publication version together. The renderer binds that version to its actual content digest. The independent public browser proof checks version, visible approved copy and loaded images; HTTP 200 alone is insufficient. Egress rejects private/mixed DNS, pins a public address to TLS, forbids redirects and bounds DNS/request/body sizes. No owner credentials are forwarded.

## Local verification and review

- Main publication run: 11 files, 24 tests passed, covering normal-role SQL/services, rollback, authority guards, concurrency, duplicate effects, committed replay, owner recovery, CSRF and approval UI failures.
- Compatibility run: 7 files, 15 tests passed, including actual Chrome content/lazy-image checks, preview/resource/tool inventory and atomic public binding. SQL/TypeScript readiness parity also passed across six country/payment/KYC fixture states after correcting its initial assertion and recovering from local disk exhaustion.
- Dedicated publication and standalone MCP typechecks passed. The isolated auth fixture typecheck passed after fixing a NodeNext import extension.
- Independent Codex source review: no remaining verified actionable findings after committed-replay, timestamp and lazy-image fixes. No CodeRabbit review was substituted for that verdict.
- All seven monorepo typecheck tasks and five lint tasks passed after local resource recovery; existing lint warnings remain. Migration-registry tests passed (19 tests). Full monorepo test execution remains incomplete after earlier disk exhaustion. Docker remains unavailable from its existing storage I/O failure. Local SQL proof uses isolated PostgreSQL 18 Unix sockets; pinned PostgreSQL 17/full-history/staging replay is still required before release.

## Activation remains separate

All account-linking/private-storage flags remain disabled. The owner route requires an explicitly installed private runtime; no runtime was installed. The verifier role is NOLOGIN and was not provisioned with credentials. No production migration, environment, proxy, worker, deployment, provider registration, submission, review or publication state changed. Task 9 must qualify the full schema, scoped verifier provisioning, runtime composition/cache invalidation, actual host journey and production delivery before activation. This source change grants no release authority.
