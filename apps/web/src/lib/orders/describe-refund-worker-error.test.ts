import { describe, expect, it } from 'vitest';
import { describeRefundWorkerError } from './describe-refund-worker-error';

describe('refund worker error labels', () => {
  it('labels awaiting codes as in progress', () => {
    expect(
      describeRefundWorkerError(
        'cancellation_refund_awaiting_manual_completion'
      )
    ).toContain('in progress');
  });
  it('labels reconciliation failures as needs review', () => {
    expect(
      describeRefundWorkerError(
        'An existing Paystack refund requires reconciliation before retry'
      )
    ).toContain('needs review');
  });
  it('falls back to a generic label for unknown messages', () => {
    const label = describeRefundWorkerError(
      'Paystack/insufficient-balance (acquirer 51)'
    );
    expect(label).toContain('ran into a problem');
    expect(label).not.toContain('acquirer');
  });
});
