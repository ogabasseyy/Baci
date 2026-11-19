import { describe, expect, it, vi } from 'vitest';
import { refundUnsubmittedPetrockLookup } from './refund-unsubmitted-petrock-lookup';

describe('refund of a known unsubmitted Petrock lookup', () => {
  it('reports a refund only after the atomic operation confirms it', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    const response = await refundUnsubmittedPetrockLookup({
      lookupId: 'lookup',
      supabaseAdmin: { rpc },
    });
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({
      code: 'PETROCK_NOT_SUBMITTED',
      lookupId: 'lookup',
    });
    expect(rpc).toHaveBeenCalledWith('cancel_unsubmitted_petrock_imei_lookup', {
      p_lookup_id: 'lookup',
    });
  });
  it('confirms an idempotent cancellation after its first response is lost', async () => {
    const rpc = vi
      .fn()
      .mockRejectedValueOnce(new Error('lost response'))
      .mockResolvedValueOnce({ data: true, error: null });
    const response = await refundUnsubmittedPetrockLookup({
      lookupId: 'lookup',
      supabaseAdmin: { rpc },
    });
    expect(response.status).toBe(502);
    expect(rpc).toHaveBeenCalledTimes(2);
  });
  it.each([
    'conflict',
    'transport',
    'denied',
  ])('does not claim a refund when cancellation is %s', async (outcome) => {
    const rpc = vi.fn();
    if (outcome === 'transport')
      rpc.mockRejectedValue(new Error('unavailable'));
    else
      rpc.mockResolvedValue({
        data: false,
        error: outcome === 'denied' ? { message: 'denied' } : null,
      });
    const response = await refundUnsubmittedPetrockLookup({
      lookupId: 'lookup',
      supabaseAdmin: { rpc },
    });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      code: 'IMEI_PAYMENT_RECONCILIATION_REQUIRED',
      lookupId: 'lookup',
    });
    expect(rpc).toHaveBeenCalledTimes(outcome === 'conflict' ? 1 : 2);
  });
});
