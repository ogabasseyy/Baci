import { describe, expect, it } from 'vitest';
import { zeptomailSendAdmissionBudgetMs } from '@/lib/zeptomail-send-budget';
import {
  CANCELLATION_EMAIL_CLAIM_WRITE_ALLOWANCE_MS,
  CANCELLATION_REFUND_SETUP_ALLOWANCE_MS,
  CAPPED_RECONCILE_PHASE_MS,
  cancellationDrainDeadlineMs,
  cancellationEmailDrainDeadlineMs,
  cancellationRefundDrainDeadlineMs,
} from './cancellation-drain-deadline';
import { EMAIL_ATTEMPTS_PER_SENDER } from './execute-customer-email-cancellation-side-effect';
import { REFUND_PREFLIGHT_ADMISSION_BUDGET_MS } from './schedule-preflight-provider-verification';

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
    expect(cancellationEmailDrainDeadlineMs(1_000_000)).toBe(1_120_000);
  });

  it('keeps the live sender budget fittable with the reserve intact', () => {
    // The serial drain starts after the 60s reconcile phase: the
    // email cutoff must leave the live admission budget plus the
    // claim-write allowance the post-lookup guard requires plus margin
    // for the order/merchant reads ahead of it, and the 150s
    // notification reserve plus 30s safety must still fit the 300s
    // invocation. Fails if any shared budget drifts.
    const emailWindow = cancellationEmailDrainDeadlineMs(0) - 60_000;
    expect(emailWindow).toBeGreaterThan(
      zeptomailSendAdmissionBudgetMs(EMAIL_ATTEMPTS_PER_SENDER) +
        CANCELLATION_EMAIL_CLAIM_WRITE_ALLOWANCE_MS
    );
    expect(
      cancellationEmailDrainDeadlineMs(0) + 150_000 + 30_000
    ).toBeLessThanOrEqual(300_000);
  });
});

describe('cancellationRefundDrainDeadlineMs', () => {
  it('ends at the full phase end so verification fits after a capped reconcile', () => {
    expect(cancellationRefundDrainDeadlineMs(1_000_000)).toBe(1_120_000);
  });

  it('keeps the preflight budget fittable with the reserve intact', () => {
    // The capped reconcile phase ends at CAPPED_RECONCILE_PHASE_MS:
    // the refund cutoff must leave the setup allowance plus the
    // live preflight budget after it, and the 150s notification
    // reserve plus 30s safety must still fit the 300s invocation.
    // Fails if any shared budget drifts.
    const refundWindow =
      cancellationRefundDrainDeadlineMs(0) - CAPPED_RECONCILE_PHASE_MS;
    expect(refundWindow).toBeGreaterThanOrEqual(
      REFUND_PREFLIGHT_ADMISSION_BUDGET_MS +
        CANCELLATION_REFUND_SETUP_ALLOWANCE_MS
    );
    expect(
      cancellationRefundDrainDeadlineMs(0) + 150_000 + 30_000
    ).toBeLessThanOrEqual(300_000);
  });
});
