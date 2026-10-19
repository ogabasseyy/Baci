# Connected local schedule HTTP — ready for parent review

## Runnable evidence

From `/Users/mac/Baci-worktrees/cursor-savings-phase1`:

```sh
bash tools/test/customer-schedule-http-local.test.sh
```

This opt-in wrapper extends the existing owned schedule harness, not the runtime
SQL. It creates a disposable Unix-socket PostgreSQL database and actual IPv4
loopback listener, then uses Fermat's actual router and `/csrf` bootstrap. The
Supabase session and ownership rows are explicitly synthetic. The bootstrap token
and Set-Cookie are read from the real handler, not hardcoded. No external HTTP,
provider account, credentials, real customer data or funds are used.

Final command exited 0: pre-expiry **5 passed / 5 skipped**, post-expiry **2 passed /
4 skipped**, after database/listener restart **3 passed / 7 skipped**. The three
new HTTP cases pass alongside the existing store cases, eight observed concurrent
lock waits and SQL isolation/forgery/rollback assertions.

The HTTP flow proves pre-expiry resume persisted despite a lost committed response
(503), same-operation readback and exact replay (200, no second write), post-expiry
observe durably paused version 2/null consent (200), fresh resume rejection with
no receipt, and separate current paused state versus historical resume receipt
after PostgreSQL/listener restart. Every response keeps debit permission false.

Unit command from `apps/web`:

```sh
pnpm exec vitest run src/lib/piggyvest/customer-schedule-handler.test.ts src/lib/piggyvest/customer-schedule-handler.boundary.test.ts src/schemas/piggyvest-customer-schedule-handler.test.ts src/lib/piggyvest/schedule-lifecycle*.test.ts src/lib/piggyvest/schedule-store.test.ts src/lib/piggyvest/schedule-store-authenticated.test.ts src/lib/piggyvest/schedule-store-statements.test.ts src/schemas/piggyvest-schedule*.test.ts --maxWorkers=1
```

**56 passed across 11 suites**, including 23 new handler/schema cases. Feature
TDD: eight assertions first failed against an unavailable handler, then passed
against the connection. Exact additional regression: abort arriving during the
final authorization await initially dispatched one SQL read; RED reproduced it,
GREEN dispatches none after checking abort again after the await. The first HTTP
run returned 404 before router wiring; that was unfinished integration, not a
claimed router defect. The complete wired rerun is green.

Scoped Biome passed. All new runtime/support/test/schema files are below 300 lines.
Root `pnpm turbo lint` and `pnpm turbo typecheck` were attempted but failed on
concurrent unowned files; no owned schedule diagnostics remained. Type errors
were in `customer-operation-handler.test.ts` and `runtime-journey-local*`; parent
was notified. Full-root final gates and independent new-handler review remain
parent-owned; no full-suite/live acceptance is claimed. Hooke independently
reread the final HTTP boundary, response schemas and unchanged SQL hashes and
reported no confirmed P1/P2; test execution above remains this agent's evidence.

## Exact connection and public contract

`customer-schedule-handler.ts` exports
`createPiggyvestCustomerScheduleHandler({supabase,goalId,configuration,execute,checkCsrfProtection})`
returning `GET` and `POST`. Fermat alone wired the router with
`services: {schedule: {enabled: true}}`; absent service stays unavailable.

- `GET /schedule?goalId=<fixed>` reads current state.
- `GET /schedule?goalId=<fixed>&operationId=<uuid>` additionally reads history.
- `POST /schedule` accepts only existing strict `{operationId,command}`; no query.
  Existing command actions are `observe`, `pause`, `request_resume`. Goal and
  expectedVersion are required; resume additionally requires accepted true,
  matching operationId, revisionId and termsHash.
- GET returns status available, goalId, accepted revisionId/termsHash, public
  current state and nullable historical command/receipt. State contains version,
  status and nullable consentProposal (operationId/revisionId/termsHash only).
- Successful POST returns status persisted_proposal, goalId and public receipt.
- Unconfirmed POST returns 503 with goalId, original operationId,
  readbackRequired true. Caller must retain the operation for GET recovery;
  there is no automatic retry or new operation generation.
- Both current response and receipts explicitly carry dispatch disabled and
  debitPermission false. Historical success is not current authority.

Only **response projection** strips scope/actor/private fields. POST and nested
command schemas strictly reject unexpected actor/source/token/proposal fields
before SQL; they are not silently accepted or stripped from requests.

## Security and existing authority

Authentication is the first handler operation, before CSRF/body/protected reads.
The first actor and fixed configuration are pinned. Existing context resolution
checks merchant/customer/goal ownership; actual authenticated schedule-store
does its own revalidation. The HTTP wrapper additionally checks the same actor,
scope, abort state and exactly seven SQL parameters before/after dispatch; only
the two existing schedule statements and original command/readback ID are allowed.

The existing bounded UTF-8 JSON body reader enforces content type, encoding,
declared/streamed size, chunk count, timeout and abort. Duplicate/unknown GET
parameters and POST queries fail closed. Existing injected real CSRF checking
is used; router enforces origin/session-bound cookie and local listener bounds.
Errors are generic no-store/nosniff with no raw dependency text.

The handler wraps `createAuthenticatedScheduleStore`; it does not create another
planner. SQL source token, balances, actor, policy and state proposal are built by
the existing store and independently validated by frozen SQL. Source token and
trusted snapshot never enter the public response. A dispatch may have committed
before response loss/abort; uncertainty cannot be represented as rollback.

No SQL was changed. Frozen hashes remain:

- 165000: `e47b30078e23e9f0e5ce42397df16b3aef186c4c0cab2cc21b9cbe084caa56ce`
- 165100: `3149aa40018c69a888e627f80ff5d73680ff83c5c1304e8839076075eddf882f`

## Remaining boundaries

This closes callable local schedule read/write/recovery HTTP, not browser/native
scheduling controls, real Supabase session validation, rollout grants or provider
scheduling. Collection-owner handover, cadence, mandate/amount consent and
provider cancellation/in-flight recovery contracts remain separately required
before debit/transport can be authorized. Existing Paystack remains unchanged.
Those external contracts do not block running this local synthetic E2E command.
