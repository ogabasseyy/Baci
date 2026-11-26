import { describe, expect, it } from 'vitest';
import {
  amendmentConfirmationSchema,
  verifiedSettlementActionSchema,
} from './paid-order-amendment';

describe('paid order amendment schemas', () => {
  it('accepts a staff top-up confirmation and rejects mixed bank evidence', () => {
    const base = {
      previewId: '42778a83-0ed7-4fa5-9e1d-4ea7a085b217',
      idempotencyKey: 'f58ed34e-0761-4ffe-83f4-a4cb4bdcce14',
      reason: 'Customer upgrade',
      customerAgreed: true,
    };
    expect(
      amendmentConfirmationSchema.safeParse({
        ...base,
        staffTopUp: { method: 'pos', receiptReference: 'POS-123456' },
      }).success
    ).toBe(true);
    expect(
      amendmentConfirmationSchema.safeParse({
        ...base,
        bankEvidenceId: '42778a83-0ed7-4fa5-9e1d-4ea7a085b217',
        staffTopUp: { method: 'pos', receiptReference: 'POS-123456' },
      }).success
    ).toBe(false);
  });

  it('accepts only the declared finance action shapes', () => {
    expect(
      verifiedSettlementActionSchema.safeParse({
        action: 'claim_offline_disbursement',
        idempotencyKey: 'f58ed34e-0761-4ffe-83f4-a4cb4bdcce14',
        sourceKind: 'unapplied',
        sourceId: '42778a83-0ed7-4fa5-9e1d-4ea7a085b217',
      }).success
    ).toBe(true);
    expect(
      verifiedSettlementActionSchema.safeParse({
        action: 'claim_offline_disbursement',
        idempotencyKey: 'invalid',
        sourceKind: 'top_up',
        sourceId: 'invalid',
      }).success
    ).toBe(false);
  });
});
