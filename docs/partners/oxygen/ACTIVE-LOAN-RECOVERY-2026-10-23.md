# Active-loan recovery persistence — 23 October 2026

The confirmed staging booking rejection `HTTP 400: User has an active loan`
previously existed only in the browser's transient error. Reopening the popup or
refreshing reloaded `plan_required` and offered another booking.

`20261023172500_oxygen_active_loan_block.sql` adds a private, RLS-enabled
`booking_blocks` table, inaccessible directly to customer/worker roles. A trigger
retains only the exact definitely rejected booking outcome after the authenticated
bound worker records its failure. It also backfills existing matching diagnostic
rows. No arbitrary diagnostic text is returned in snapshots.

The normal authorized status RPC exposes the bounded `bookingBlock: active_loan`
code. SQL enqueue and claim guards reject further booking attempts. Server
preflight returns the existing safe `OXYGEN_ACTIVE_LOAN` code before enqueue or
worker login. The popup restores the support message instead of the plan form.
KYC/eligibility reads and diagnostic expiry do not clear the separate blocker.

There is deliberately no customer-facing clear/retry operation. Oxygen must
identify the active loan and confirm the appropriate recovery. Any future clearing
path must require explicit, verified reconciliation; eligibility success, an absent
local booking reference, or closing/reopening is not sufficient.

Validation:
- New UI/server/schema tests failed against the previous code and then passed.
- 819 tests across 63 Oxygen-related files passed.
- Web and worker/tool typechecks passed; eight changed TS/TSX files pass Biome.
- App-wide lint reports two unrelated existing formatting errors in
  `src/app/api/orders/order-security.test.ts` and `src/app/api/orders/route.ts`.
- Database regression failed before migration, passed in a rollback rehearsal,
  and passed after applying to the existing isolated savings staging database.
- Database coverage includes exact rejection classification, authorized status,
  no raw-error disclosure, enqueue/claim denial, persistence through diagnostic
  deletion/state refresh, and denial to a different customer.
- Live browser refresh restored the support warning without a booking button.

Current workflow: `d3bf1b69-ec6e-4f1c-ae9c-044a8fdb7f17`.
The isolated status confirms `plan_required`, `bookingBlock: active_loan`, and no
booking reference. Existing uncertain bookings are untouched. No provider booking,
loan cancellation, activation, settlement, commit, push or production deployment
was performed. Activation and settlement remain disabled.

Current working checkout is the transferred project at
`/Users/mac/Downloads/Oxygen-transfer-2026-10-23/project`; the chat's older attached
worktree does not contain the latest transferred implementation.
