import { describe, expect, it } from 'vitest';
import {
  amendmentId,
  id,
  mocks,
  replacementId,
  request,
} from '../../amendment-route.test-support';
import { POST } from './route';

const context = { params: Promise.resolve({ id, amendmentId }) };
const topUp = {
  action: 'record_top_up',
  evidenceId: replacementId,
  idempotencyKey: 'fixture-top-up',
};

describe('POST order amendment action', () => {
  it('requires an authenticated user', async () => {
    mocks.auth.mockResolvedValueOnce({ user: null });
    expect((await POST(request(topUp), context)).status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('rejects a write when CSRF validation fails', async () => {
    mocks.csrf.mockResolvedValueOnce({ valid: false });
    expect((await POST(request(topUp), context)).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('rejects a caller-supplied top-up amount', async () => {
    expect(
      (await POST(request({ ...topUp, amountMinor: 5000 }), context)).status
    ).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('dispatches the action with the order, amendment, and evidence IDs', async () => {
    expect((await POST(request(topUp), context)).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith(
      'run_paid_order_amendment_action',
      {
        p_order_id: id,
        p_amendment_id: amendmentId,
        p_payload: topUp,
      }
    );
  });

  it.each([
    'payment_capture_in_flight',
    'order_not_cancellable',
  ])('maps %s to a recovery cancellation conflict', async (code) => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'P0001', message: code },
    });
    const response = await POST(
      request({
        action: 'cancel_for_recovery',
        idempotencyKey: 'fixture-recovery-cancel',
        reason: 'Synthetic recovery',
      }),
      context
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code });
    expect(mocks.logError).not.toHaveBeenCalled();
  });
});
