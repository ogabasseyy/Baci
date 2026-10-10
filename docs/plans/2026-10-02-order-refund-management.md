# Order refund management

Approved scope: show refund status on cancelled paid orders; safely retry exhausted failures; record manual full or partial refunds; prevent duplicate payments; reconcile provider processing; keep cancellation emails accurate.

Reuse transactions as the refund ledger and order_cancellation_side_effects as the worker claim. Merchant actions run through an authenticated RPC that locks the same claim row as the worker and checks owner/staff orders edit permission. Manual refunds allocate to completed payment legs, record actor/reference/date/method, and reduce remaining gateway amounts. Retry only requeues definitively failed work, never claimed or uncertain work. The worker checks Paystack before each new submission and fails closed on unverifiable provider state. Pending provider refunds are reconciled by the existing worker cron. No production refund or database migration is executed during development.

Validation: schema, authorization, concurrent claim/manual recording, idempotent manual replay, refund limits, partial allocations, provider uncertainty and pagination, panel states, existing cancellation tests, lint and typecheck. Migration requires isolated PostgreSQL integration verification before production rollout.
