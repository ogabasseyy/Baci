import { beforeEach, describe, expect, it, vi } from 'vitest';
import { alertCreditAuditDrift } from './credit-audit-drift';

const emit = vi.hoisted(() => vi.fn());
vi.mock('./webhook-alerts', () => ({ emitPiggyvestWebhookAlert: emit }));

beforeEach(() => emit.mockReset());

describe('alertCreditAuditDrift', () => {
  it('pages with field names and the pvb_reference when audit fields drift', () => {
    alertCreditAuditDrift({
      eventType: 'interest-payout.success',
      pvbReference: 'PVB01SYNTHETIC',
      driftedFields: ['batch_id', 'paid_at'],
    });

    expect(emit).toHaveBeenCalledWith('PIGGYVEST_CREDIT_AUDIT_DRIFT', {
      eventType: 'interest-payout.success',
      operationId: 'PVB01SYNTHETIC',
      reason: 'same pvb_reference, audit fields differ: batch_id, paid_at',
    });
  });

  it('stays silent when nothing drifted', () => {
    alertCreditAuditDrift({
      eventType: 'bank-transfer.inflow.success',
      pvbReference: 'PVB01SYNTHETIC',
      driftedFields: [],
    });

    expect(emit).not.toHaveBeenCalled();
  });
});
