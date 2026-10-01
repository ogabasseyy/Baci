# Task 5 — Snapchat Ads route-coverage re-review, round 4

**Reviewed delta:** `77d0388736..5a41990d14` (`1dc052ab47`,
`5a41990d14`).  This review also inspected the current Snapchat connector,
its prior review reports, the nonce/disconnect and refresh-token migrations,
and the complete focused Snapchat test suite.

## Verdicts

- **Spec: PASS.** The connector continues to satisfy the Task 5 route,
  provider, storage, and OAuth contracts.  The new test delta drives the
  intended route branches rather than merely configuring mocks that are never
  observed.
- **Quality: PASS.** The retained route-test finding from round 3 is resolved.
  The six reviewed routes now have concrete success, authentication,
  permission, CSRF (where mutating), Zod/input, connection/database/RPC,
  provider/refresh, and safe-output coverage appropriate to their methods.
  No production implementation was changed in this delta.

## Coverage findings

| Route | Deterministic proof reviewed |
| --- | --- |
| `status` | Auth denial; analytics/integrations-view denial; merchant-not-found; safe active metadata; database failure with a ciphertext sentinel excluded from the public response. |
| `accounts` | Auth, GET permission, PATCH CSRF, and Zod denial; authenticated discovery and account revalidation/selection; connection read, refresh, and provider errors; inaccessible-account rejection; sentinels are absent from public output. |
| `callback` | Auth and cookie/state denial; consumed nonce blocks code exchange; valid signed state/cookie/nonce reaches exchange and encrypted upsert; generic token error, required-scope failure, and configuration failure all redirect safely without sentinels. |
| `sync` | Auth, CSRF, permission, malformed JSON, and schema rejection all precede work; success and config, selected-account, provider, and opaque database failures map to their intended safe statuses/codes. |
| `spend` | Auth and analytics permission precede reads; invalid query, connection-read, and spend-query paths return safe responses; the success mapper retains the Snap-specific Swipe Ups label while excluding an injected secret sentinel. |
| `disconnect` | Auth and CSRF precede access/RPC work; permission denial prevents the atomic RPC; success calls the exact erase RPC; its error result is mapped to a safe failure response with the provider/DB sentinel omitted. |

The state test invokes the real signed-state creator and the real callback
verification path.  The successful callback assertion inspects the actual RPC
arguments to prove that neither plaintext access nor refresh token is handed to
the persistence RPC.  The replay test uses a `false` nonce-consume result and
asserts no token exchange; this is a meaningful route-level fail-closed proof.
The migration contract plus access-token tests separately cover the nonce SQL
shape and refresh-token CAS argument shape.

## Findings

No deterministic Critical, Important, or Minor findings in the reviewed
delta.

## Required activation gates (not unit-test defects)

1. **Executable isolated Supabase/Postgres replay remains required.** The
   current static migration assertions do not prove live RLS/grant behavior,
   concurrent nonce consumption, refresh-token CAS contention, or transaction
   rollback/delete behavior.  Replay the append-only migrations in isolation
   and assert those behaviors before enabling Snapchat Ads.
2. **The provider limiter is process-local.** Its focused test proves
   same-process request spacing only.  Use a shared limiter or queue-owned
   global concurrency control before enabling the connector on more than one
   application instance.
3. **Provider activation remains owner-controlled.** Validate the exact
   configured redirect URI and Snap Marketing API app access with a
   non-sensitive live consent/report smoke test; no live credentials, token,
   or provider account were used in this review.

## Verification performed

- `git diff --check 77d0388736..5a41990d14` — passed.
- `pnpm --filter @baci/web exec vitest run src/lib/ads/snapchat src/app/api/integrations/ads/snapchat src/schemas/snapchat-ads.test.ts src/lib/ads/replay-inventory.test.ts` — passed: **17 files, 51 tests**.
- `pnpm --filter @baci/web exec biome check src/app/api/integrations/ads/snapchat/{accounts,callback,status,sync,spend,disconnect}/route.test.ts` — passed.

Full workspace typecheck and an executable Supabase replay were not claimed by
this review; existing unrelated dirty-worktree type failures remain outside
this scoped delta.
