import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImeiAccessClient } from '@/lib/imei-access';
import { recoverImeiLookupFailure } from './recover-imei-lookup-failure';

const mocks = vi.hoisted(() => ({
  cache: vi.fn(),
  refund: vi.fn(),
  unknown: vi.fn(),
}));
vi.mock('./route-cache-helpers', () => ({
  cacheLookupResponse: mocks.cache,
  refundAndCacheFailure: mocks.refund,
}));
vi.mock('@/lib/imei-providers/petrock/petrock-lookup-state', () => ({
  markPetrockSubmissionUnknown: mocks.unknown,
}));
const lookup = {
  amount: 500,
  customerId: 'customer',
  id: 'lookup',
  merchantId: 'merchant',
  provider: 'petrock' as const,
};
function access() {
  return {
    readPaymentState: vi.fn().mockResolvedValue({
      data: { debited: false, refunded: false },
      error: null,
    }),
    deletePending: vi
      .fn()
      .mockResolvedValue({ data: { id: 'lookup' }, error: null }),
  } as unknown as ImeiAccessClient;
}

describe('IMEI failure recovery', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });
  it('keeps an uncertain paid Petrock submission pending even if classification persistence fails', async () => {
    const client = access();
    mocks.unknown.mockRejectedValue(new Error('state unavailable'));
    const response = await recoverImeiLookupFailure({
      activeLookup: lookup,
      debitSucceeded: true,
      supabaseAdmin: client,
    });
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({
      lookupId: 'lookup',
      status: 'pending',
    });
    expect(mocks.refund).not.toHaveBeenCalled();
    expect(client.deletePending).not.toHaveBeenCalled();
    expect(mocks.cache).not.toHaveBeenCalled();
  });
  it('deletes only through the guarded pending operation when uncharged failure caching fails', async () => {
    const client = access();
    mocks.cache.mockRejectedValue(new Error('cache denied'));
    const response = await recoverImeiLookupFailure({
      activeLookup: lookup,
      debitSucceeded: false,
      supabaseAdmin: client,
    });
    expect(response.status).toBe(500);
    expect(client.deletePending).toHaveBeenCalledWith('lookup');
    expect(mocks.refund).not.toHaveBeenCalled();
  });
  it('requires support when the guarded cleanup refuses an apparently uncharged row', async () => {
    const client = access();
    mocks.cache.mockRejectedValue(new Error('cache denied'));
    vi.mocked(client.deletePending).mockResolvedValue({
      data: null,
      error: { message: 'charged lookup' },
    });
    const response = await recoverImeiLookupFailure({
      activeLookup: lookup,
      debitSucceeded: false,
      supabaseAdmin: client,
    });
    expect(await response.json()).toMatchObject({
      code: 'DEBIT_FAILURE_STATE_SAVE_FAILED',
    });
    expect(mocks.refund).not.toHaveBeenCalled();
  });
  it('refunds a durably confirmed Sickw debit after the debit response was lost', async () => {
    const client = access();
    vi.mocked(client.readPaymentState).mockResolvedValue({
      data: { debited: true, refunded: false },
      error: null,
    });
    mocks.refund.mockResolvedValue(
      Response.json({ code: 'SICKW_UNAVAILABLE' }, { status: 502 })
    );
    const response = await recoverImeiLookupFailure({
      activeLookup: { ...lookup, provider: 'sickw' },
      debitSucceeded: false,
      supabaseAdmin: client,
    });
    expect(response.status).toBe(502);
    expect(client.readPaymentState).toHaveBeenCalledWith('lookup');
    expect(mocks.refund).toHaveBeenCalledTimes(1);
    expect(mocks.cache).not.toHaveBeenCalled();
    expect(client.deletePending).not.toHaveBeenCalled();
  });

  it.each([
    'denied',
    'transport',
    'missing',
  ])('preserves an ambiguous Sickw debit when ledger reconciliation is %s', async (failure) => {
    const client = access();
    if (failure === 'transport')
      vi.mocked(client.readPaymentState).mockRejectedValue(
        new Error('connection lost')
      );
    else
      vi.mocked(client.readPaymentState).mockResolvedValue({
        data: null,
        error: failure === 'denied' ? { message: 'scope denied' } : null,
      });
    const response = await recoverImeiLookupFailure({
      activeLookup: { ...lookup, provider: 'sickw' },
      debitSucceeded: false,
      supabaseAdmin: client,
    });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      code: 'IMEI_PAYMENT_RECONCILIATION_REQUIRED',
    });
    expect(mocks.refund).not.toHaveBeenCalled();
    expect(mocks.cache).not.toHaveBeenCalled();
    expect(client.deletePending).not.toHaveBeenCalled();
  });

  it('routes a charged synchronous failure through the refund boundary', async () => {
    mocks.refund.mockResolvedValue(
      Response.json({ success: false }, { status: 502 })
    );
    const response = await recoverImeiLookupFailure({
      activeLookup: { ...lookup, provider: 'sickw' },
      debitSucceeded: true,
      supabaseAdmin: access(),
    });
    expect(response.status).toBe(502);
    expect(mocks.refund).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 500,
        lookupId: 'lookup',
        customerId: 'customer',
        merchantId: 'merchant',
        refundSuccessStatus: 'refunded_error',
      })
    );
    expect(mocks.unknown).not.toHaveBeenCalled();
  });
});
