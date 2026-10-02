import { describe, expect, it } from 'vitest';
import { zeptomailSendAdmissionBudgetMs } from '@/lib/zeptomail-send-budget';
import {
  CANCELLATION_EMAIL_CLAIM_WRITE_ALLOWANCE_MS,
  cancellationDrainDeadlineMs,
  cancellationEmailDrainDeadlineMs,
} from './cancellation-drain-deadline';
import { EMAIL_ATTEMPTS_PER_SENDER } from './execute-customer-email-cancellation-side-effect';

describe('cancellationDrainDeadlineMs', () => {
  it('ends side-effect work before the safety margin and notification reserve', () => {
    // 300s budget minus the 30s margin, the 150s notification reserve,
    // and the 30s handoff slack: the final step's tail must land before
    // the notification threshold, not on it.
    expect(cancellationDrainDeadlineMs(1_000_000)).toBe(1_090_000);
  });
});

describe('cancellationEmailDrainDeadlineMs', () => {
  it('extends past a full reconcile phase plus the email budget and claim allowance', () => {
    expect(cancellationEmailDrainDeadlineMs(1_000_000)).toBe(1_116_000);
  });

  it('keeps the live sender budget fittable with the reserve intact', () => {
    // The serial drain starts after the 60s reconcile phase: the
    // email cutoff must leave the live admission budget plus the
    // claim-write allowance the post-lookup guard requires, and the
    // 150s notification reserve plus 30s safety must still fit the
    // 300s invocation. Fails if any shared budget drifts.
    const emailWindow = cancellationEmailDrainDeadlineMs(0) - 60_000;
    expect(emailWindow).toBeGreaterThanOrEqual(
      zeptomailSendAdmissionBudgetMs(EMAIL_ATTEMPTS_PER_SENDER) +
        CANCELLATION_EMAIL_CLAIM_WRITE_ALLOWANCE_MS
    );
    expect(
      cancellationEmailDrainDeadlineMs(0) + 150_000 + 30_000
    ).toBeLessThanOrEqual(300_000);
  });
});
