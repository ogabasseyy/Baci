import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Drift from './credit-audit-drift';

const emit = vi.hoisted(() => vi.fn());
vi.mock('./webhook-alerts', () => ({ emitPiggyvestWebhookAlert: emit }));

let alertCreditAuditDrift: typeof Drift.alertCreditAuditDrift;

beforeEach(async () => {
  // Fresh module per test: the once-per-reference memory starts empty.
  vi.resetModules();
  emit.mockReset();
  ({ alertCreditAuditDrift } = await import('./credit-audit-drift'));
});

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

  it('pages only the first drift per pvb_reference', () => {
    const drift = {
      eventType: 'bank-transfer.inflow.success' as const,
      pvbReference: 'PVB01ROTATING',
      driftedFields: ['provider_transaction_id'],
    };

    alertCreditAuditDrift(drift);
    alertCreditAuditDrift(drift);
    alertCreditAuditDrift({ ...drift, pvbReference: 'PVB01OTHER' });

    expect(emit).toHaveBeenCalledTimes(2);
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
