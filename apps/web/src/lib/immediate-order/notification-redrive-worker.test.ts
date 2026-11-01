import { describe, expect, it, vi } from 'vitest';
import { recoverImmediateNotifications } from './notification-redrive-worker';

const orderId = 'd0000000-0000-4000-8000-000000000001';
const lease = 'd0000000-0000-4000-8000-000000000002';

describe('immediate notification completion redrive', () => {
  it('reports an uncertain backlog even when accepted deliveries fill the batch', async () => {
    const rpc = vi.fn().mockImplementation(async (name: string) => {
      if (name === 'list_immediate_notification_recovery_candidates') {
        return {
          data: [{ order_id: orderId, claim_token: lease, status: 'accepted' }],
          error: null,
        };
      }
      if (name === 'has_immediate_notification_reconciliation_backlog')
        return { data: true, error: null };
      return { data: true, error: null };
    });
    await expect(recoverImmediateNotifications({ rpc }, 1)).resolves.toEqual({
      recovered: 1,
      unresolved: 0,
      hasReconciliationBacklog: true,
    });
    expect(rpc).toHaveBeenCalledWith(
      'has_immediate_notification_reconciliation_backlog',
      {}
    );
  });
  it('records completion for confirmed acceptance without calling a sender', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        data: [{ order_id: orderId, claim_token: lease, status: 'accepted' }],
        error: null,
      })
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: false, error: null });
    await expect(recoverImmediateNotifications({ rpc }, 10)).resolves.toEqual({
      recovered: 1,
      unresolved: 0,
      hasReconciliationBacklog: false,
    });
    expect(rpc.mock.calls).toEqual([
      ['list_immediate_notification_recovery_candidates', { p_limit: 10 }],
      [
        'recover_immediate_notification_completion',
        { p_order_id: orderId, p_claim_token: lease },
      ],
      ['has_immediate_notification_reconciliation_backlog', {}],
    ]);
  });

  it('leaves an unknown dispatch for reconciliation and does not recover it', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        data: [{ order_id: orderId, claim_token: lease, status: 'unknown' }],
        error: null,
      })
      .mockResolvedValueOnce({ data: true, error: null });
    await expect(recoverImmediateNotifications({ rpc }, 10)).resolves.toEqual({
      recovered: 0,
      unresolved: 1,
      hasReconciliationBacklog: true,
    });
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it('fails closed on malformed candidates', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        { order_id: 'not-a-uuid', claim_token: lease, status: 'accepted' },
      ],
      error: null,
    });
    await expect(recoverImmediateNotifications({ rpc }, 10)).rejects.toThrow();
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('rejects an invalid batch size before any database operation', async () => {
    const rpc = vi.fn();
    await expect(recoverImmediateNotifications({ rpc }, 101)).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('does not trust a list that exceeds the requested bound', async () => {
    const row = { order_id: orderId, claim_token: lease, status: 'accepted' };
    const rpc = vi.fn().mockResolvedValue({ data: [row, row], error: null });
    await expect(recoverImmediateNotifications({ rpc }, 1)).rejects.toThrow();
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
