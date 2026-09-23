# Task 4 report — merchant wallet Paystack bank-transfer funding

## Base/head

- Base: `93e935689aacedfe836694ce21dd9e58f4bcf57d`
- Head: `9f43728a31` (`fix: complete merchant wallet DVA funding`), following base implementation `927ab2c3ef`.

## RED/GREEN evidence

- RED: the required focused Vitest command initially failed because all Task 4 test/contract files were absent (`No test files found`).
- GREEN: focused Task 4 suite passes: 7 files, 11 tests.
- `pnpm turbo lint --filter=@baci/web`: PASS.
- `pnpm turbo typecheck --filter=@baci/web`: PASS (web and tools-workers).
- `git diff --check`: PASS.

## Contract and webhook behavior

The migration adds owner-readable funding requests and provider-account tables, an active-request/provider-account uniqueness boundary, NGN/status checks, RLS, and service-role-only assignment/credit RPCs. User-facing routes authenticate first, derive merchant ownership server-side, validate strict `{ consent: true }`, and return only redacted account fields. Assignment remains pending and does not persist provider response data.

The verified Paystack charge path preserves existing order-DVA handling, then invokes merchant-wallet receiver matching, then customer-wallet fallback. Matching requires one active account, NGN, positive amount, and rejects order-alias conflicts or multiple candidates for review. Credits use a deterministic reference-derived ledger UUID, increment only `available_balance`, leave `total_earned` unchanged, and return idempotent balance results.

## Fix Round 1

Fix Round 1 wires `dedicatedaccount.assign.success` in the signature-verified webhook before charge processing, validates source/request/merchant and active NGN account shape, persists only through the service RPC, and returns review for malformed or non-unique matches. Provider customer/DVA failures now transition the owner-checked pending request to failed, allowing a later consented retry. Paystack DVA success logging no longer emits account or bank fields. The funding RPC now asserts service role and exactly one active NGN merchant/account mapping before its reference-idempotent credit.

Behavioral focused tests and contract tests: 7 files, 11 passing (plus the existing webhook suite is scheduled in the final gate).

## Deviations and risks

Provider payload field variants beyond the documented `data.metadata`/`data.dedicated_account` shape should be confirmed against a signed fixture before activation. No live Paystack, Supabase migration, deploy, or remote operations were performed.

## Fix Round 2

Head: `3feb822f6b` (`fix: make merchant DVA funding retry safe`). Assignment persistence now locks the request and treats exact fulfilled replays as handled while conflicting replays are review. Credit validation uses `SELECT ... INTO STRICT ... FOR UPDATE` for the exact active NGN mapping. Failure-transition RPC errors are surfaced as safe review-required failures. New behavioral/contract suite: 91 passing tests (79 legacy webhook tests are included separately in the 8-file run; 12 are Task 4-focused).

## Fix Round 3

Assignment replay decisions now always call the locked service RPC; TypeScript performs payload shape parsing only. Runtime tests execute wallet balance and assignment-review handlers plus exact/excess/zero confirmation paths. Focused + legacy webhook run: 94 passing tests (15 Task 4-focused, 79 legacy). Final head is the Fix Round 3 commit below.

## Coverage specialist pass

Head: `666020270eec8033263bd9d19671e06d0eb921ab` (`test: cover merchant wallet DVA funding`). Replaced placeholder assertions with 59 executed behavioral cases across 6 owned files: wallet route (5), funding-account handlers (11), assignment/provisioning helper (14), verified credit helper (10), webhook assignment (10), and migration contract (6). Focused Task 4 run: 59 passing tests in 6 files. Web lint and typecheck passed; diff check passed. Existing webhook route suite was not run in this specialist pass. No runtime behavior or production state was changed.

## P2 closure follow-up

Added signed `POST` assignment fixtures (handled and 409 review), exact fulfilled/conflicting replay assertions through the same locked persist RPC seam, successful failure-transition plus later provisioning retry, and an in-memory reference-ledger duplicate credit test proving the excess amount is credited once. Focused Task 4 plus legacy webhook run: 7 files, 144 passing tests. Web lint, typecheck, and diff-check passed. No runtime or provider changes.
