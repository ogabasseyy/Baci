// vps-workers aborts POST /api/cron/process-settlements after 5 minutes
// (see timeoutMs in vps-workers/jobs/run-web-cron.mjs). Shared with
// cancellation-side-effect-drain-limit: keep both budgets identical.
const INVOCATION_BUDGET_MS = 5 * 60_000;
const SAFETY_MARGIN_MS = 30_000;
// A lower row count alone cannot protect the notification drain: a step
// started near the shared deadline would still pass the full remaining
// duration to Paystack and loop across legs into the reserved window.
// End side-effect work before one worst-case notification send so the
// reserve holds in time, not just arithmetically. Shared with
// notification-drain-limit PER_SEND_WORST_MS: keep both identical.
const NOTIFICATION_RESERVE_MS = 150_000;
// The deadline only gates starting work: a refund step started just
// before it (plus the order/merchant lookups behind the check) can still
// overrun the boundary, and the notification drain behind this phase
// computes a zero limit unless its full 150s send budget remains. End
// the phase one step-equivalent early so the final step's estimate-sized
// tail lands before the notification threshold instead of eating the
// reserve on every invocation under a sustained backlog. Shared with
// cancellation-side-effect-drain-limit HANDOFF_SLACK_MS: keep identical.
const HANDOFF_SLACK_MS = 30_000;

/**
 * Absolute epoch-ms deadline for cancellation side-effect work started at
 * `startedAtMs`: the invocation budget minus the safety margin, the
 * notification reserve, and the handoff slack. Steps and provider calls
 * check the remaining time against this instead of trusting the fixed
 * per-step estimate.
 */
export function cancellationDrainDeadlineMs(startedAtMs: number): number {
  return (
    startedAtMs +
    INVOCATION_BUDGET_MS -
    SAFETY_MARGIN_MS -
    NOTIFICATION_RESERVE_MS -
    HANDOFF_SLACK_MS
  );
}

// The serial drain starts after the reconcile phase, but a customer
// email needs its full sender admission budget to be admitted: gating
// emails on the 90s side-effect deadline leaves only ~30s after a
// full reconcile phase, excluding every email on each backlog run.
// Emails get their own cutoff past a full reconcile phase plus the
// admission budget plus the claim-write allowance the post-lookup
// guard requires on top of the send budget plus the order/merchant
// lookup allowance: without it the guard (48s + 8s) can never pass
// after a full 60s reconcile, skipping every email unclaimed on each
// backlog run. The email send aborts 10s before its cutoff, and
// refund row-starts still gate on the 90s deadline, so the phase's
// worst-case end (a 30s refund tail at 120s) is unchanged and the
// notification reserve holds: 120s + 150s + 30s = 300s of 300s.
// Shared with reconcile-worker-deadline WORKER_BUDGET_MS and
// zeptomailSendAdmissionBudgetMs(EMAIL_ATTEMPTS_PER_SENDER): keep
// identical, and keep the invariant test below in lockstep.
const RECONCILE_PHASE_MS = 60_000;
const EMAIL_ADMISSION_MS = 48_000;
// Allowance for the claim RPC itself when the drain rechecks the
// email budget after the order/merchant reads: mirrors zeptomail's
// audit-write margin for a single database write. Imported by the
// drain's post-lookup guard so the cutoff and the guard share it.
export const CANCELLATION_EMAIL_CLAIM_WRITE_ALLOWANCE_MS = 8_000;
// Allowance for the order/merchant reads ahead of the post-lookup
// guard: without it the 116s cutoff leaves exactly the 48s + 8s the
// guard requires after a full reconcile, so any nonzero lookup time
// fails the guard and every email skips unclaimed on each backlog
// run. Sized to the remaining invocation slack (120s + 150s + 30s =
// 300s); the email send still aborts 10s before its cutoff, so the
// phase worst case stays the 120s refund tail and the reserve holds.
const CANCELLATION_EMAIL_LOOKUP_ALLOWANCE_MS = 4_000;

/**
 * Absolute epoch-ms cutoff for customer-email admission and sends for
 * work started at `startedAtMs`: a full reconcile phase plus the
 * one-attempt sender admission budget plus the claim-write
 * allowance. Refund steps keep gating on
 * `cancellationDrainDeadlineMs`; only email admission, rechecks, and
 * the email send cutoff use this later deadline.
 */
export function cancellationEmailDrainDeadlineMs(startedAtMs: number): number {
  return (
    startedAtMs +
    RECONCILE_PHASE_MS +
    EMAIL_ADMISSION_MS +
    CANCELLATION_EMAIL_CLAIM_WRITE_ALLOWANCE_MS +
    CANCELLATION_EMAIL_LOOKUP_ALLOWANCE_MS
  );
}
