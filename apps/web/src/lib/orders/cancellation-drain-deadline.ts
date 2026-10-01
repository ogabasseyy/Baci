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
// admission budget. The email send aborts 10s before its cutoff, and
// refund row-starts still gate on the 90s deadline, so the phase's
// worst-case end (a 30s refund tail at 120s) is unchanged and the
// notification reserve holds: 108s + 150s + 30s = 288s of 300s.
// Shared with reconcile-worker-deadline WORKER_BUDGET_MS and
// zeptomailSendAdmissionBudgetMs(EMAIL_ATTEMPTS_PER_SENDER): keep
// identical, and keep the invariant test below in lockstep.
const RECONCILE_PHASE_MS = 60_000;
const EMAIL_ADMISSION_MS = 48_000;

/**
 * Absolute epoch-ms cutoff for customer-email admission and sends for
 * work started at `startedAtMs`: a full reconcile phase plus the
 * one-attempt sender admission budget. Refund steps keep gating on
 * `cancellationDrainDeadlineMs`; only email admission, rechecks, and
 * the email send cutoff use this later deadline.
 */
export function cancellationEmailDrainDeadlineMs(startedAtMs: number): number {
  return startedAtMs + RECONCILE_PHASE_MS + EMAIL_ADMISSION_MS;
}
