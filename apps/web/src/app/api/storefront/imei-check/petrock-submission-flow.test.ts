import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImeiAccessClient } from '@/lib/imei-access';
import { recoverImeiLookupFailure } from './recover-imei-lookup-failure';

const mocks = vi.hoisted(() => ({
  finalize: vi.fn(),
  markUnknown: vi.fn(),
  recordSubmission: vi.fn(),
  redeem: vi.fn(),
}));

vi.mock('@/lib/imei-lookup-fulfillment', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/imei-lookup-fulfillment')
  >('@/lib/imei-lookup-fulfillment');
  return {
    ...actual,
    redeemImeiWalletAndBeginProviderSubmission: mocks.redeem,
  };
});

vi.mock('@/lib/imei-providers/petrock/petrock-lookup-state', () => ({
  finalizePetrockLookup: mocks.finalize,
  markPetrockSubmissionUnknown: mocks.markUnknown,
  recordPetrockSubmission: mocks.recordSubmission,
}));

import { submitPetrockLookup } from './petrock-submission-flow';

const binding = {
  costUsd: 0.019,
  deviceCategories: ['smartphone'] as const,
  orderFieldName: 'IMEI',
  productId: '1955',
  provider: 'petrock' as const,
};
const baseInput = {
  amount: 700,
  binding,
  checksIncluded: ['blacklistStatus'] as const,
  customerId: 'customer-1',
  deviceCategory: 'smartphone' as const,
  encryptionKey: Buffer.alloc(32, 7).toString('base64'),
  identifier: '490154203237518',
  lookupId: 'lookup-1',
  merchantId: 'merchant-1',
  origin: 'https://ogabassey.com',
  supabaseAdmin: {} as never,
  tierName: 'Blacklist Check',
};

describe('submitPetrockLookup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.redeem.mockResolvedValue(undefined);
    mocks.recordSubmission.mockResolvedValue(true);
    mocks.markUnknown.mockResolvedValue(true);
    mocks.finalize.mockResolvedValue(true);
  });

  it('refunds a durably committed debit whose response is lost without invoking the supplier', async () => {
    mocks.redeem.mockRejectedValueOnce(new Error('response lost after commit'));
    const provider = { submit: vi.fn() };
    const client = {
      readPaymentState: vi.fn().mockResolvedValue({
        data: { debited: true, refunded: false },
        error: null,
      }),
      rpc: vi.fn().mockResolvedValue({ data: true, error: null }),
    } as unknown as ImeiAccessClient;
    let debitSucceeded = false;
    await expect(
      submitPetrockLookup({
        ...baseInput,
        provider,
        supabaseAdmin: client,
        onDebitSucceeded: () => {
          debitSucceeded = true;
        },
      })
    ).rejects.toThrow('response lost after commit');
    expect(debitSucceeded).toBe(false);
    expect(provider.submit).not.toHaveBeenCalled();
    const response = await recoverImeiLookupFailure({
      activeLookup: {
        amount: 700,
        customerId: 'customer-1',
        merchantId: 'merchant-1',
        id: 'lookup-1',
        provider: 'petrock',
      },
      debitSucceeded,
      supabaseAdmin: client,
    });
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({
      code: 'PETROCK_NOT_SUBMITTED',
    });
    expect(client.rpc).toHaveBeenCalledWith(
      'cancel_unsubmitted_petrock_imei_lookup',
      { p_lookup_id: 'lookup-1' }
    );
    expect(mocks.markUnknown).not.toHaveBeenCalled();
    expect(provider.submit).not.toHaveBeenCalled();
  });

  it('debits durably before placing and records an accepted order', async () => {
    const calls: string[] = [];
    mocks.redeem.mockImplementation(() => {
      calls.push('debit');
      return Promise.resolve();
    });
    const provider = {
      submit: vi.fn(() => {
        calls.push('submit');
        return Promise.resolve({
          kind: 'pending' as const,
          providerOrderId: 'order-1',
          providerStatus: 'new',
        });
      }),
    };

    const response = await submitPetrockLookup({ ...baseInput, provider });

    expect(calls).toEqual(['debit', 'submit']);
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      lookupId: 'lookup-1',
      status: 'pending',
      success: true,
    });
    expect(mocks.recordSubmission).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 'order-1' })
    );
    expect(provider.submit).toHaveBeenCalledWith(
      expect.objectContaining({
        feedbackUrl: expect.stringMatching(
          /^https:\/\/ogabassey\.com\/api\/webhooks\/petrock\/imei\/[A-Za-z0-9_-]{43}$/
        ),
      })
    );
  });

  it('classifies an ambiguous submission without refunding', async () => {
    const provider = {
      submit: vi.fn().mockResolvedValue({
        kind: 'submission_unknown',
        providerStatus: 'submit_timeout',
        reason: 'timeout',
      }),
    };

    const response = await submitPetrockLookup({ ...baseInput, provider });

    expect(response.status).toBe(202);
    expect(mocks.markUnknown).toHaveBeenCalled();
    expect(mocks.finalize).not.toHaveBeenCalled();
  });

  it('retries persistence of a known accepted order before escalating it', async () => {
    mocks.recordSubmission
      .mockRejectedValueOnce(new TypeError('temporary database error'))
      .mockResolvedValueOnce(true);
    const provider = {
      submit: vi.fn().mockResolvedValue({
        kind: 'pending',
        providerOrderId: 'order-1',
        providerStatus: 'new',
      }),
    };

    const response = await submitPetrockLookup({ ...baseInput, provider });

    expect(response.status).toBe(202);
    expect(mocks.recordSubmission).toHaveBeenCalledTimes(2);
    expect(mocks.markUnknown).not.toHaveBeenCalled();
  });

  it('preserves the provider order id when accepted-order persistence is exhausted', async () => {
    mocks.recordSubmission.mockRejectedValue(
      new TypeError('database unavailable')
    );
    const provider = {
      submit: vi.fn().mockResolvedValue({
        kind: 'pending',
        providerOrderId: 'order-1',
        providerStatus: 'new',
      }),
    };

    const response = await submitPetrockLookup({ ...baseInput, provider });

    expect(response.status).toBe(202);
    expect(mocks.markUnknown).toHaveBeenCalledWith(
      expect.objectContaining({ providerOrderId: 'order-1' })
    );
  });

  it('atomically refunds a definitive provider failure', async () => {
    const provider = {
      submit: vi.fn().mockResolvedValue({
        body: {
          code: 'PETROCK_REJECTED',
          error: 'Order rejected',
          success: false,
        },
        kind: 'failure',
        providerStatus: 'submit_http_400',
        refundReason: 'error',
        status: 502,
      }),
    };

    const response = await submitPetrockLookup({ ...baseInput, provider });

    expect(response.status).toBe(502);
    expect(mocks.finalize).toHaveBeenCalledWith(
      expect.objectContaining({ terminalStatus: 'refunded_error' })
    );
  });

  it('retries a terminal persistence failure before leaving manual recovery', async () => {
    mocks.finalize
      .mockRejectedValueOnce(new TypeError('temporary database error'))
      .mockResolvedValueOnce(true);
    const provider = {
      submit: vi.fn().mockResolvedValue({
        body: {
          code: 'PETROCK_REJECTED',
          error: 'Order rejected',
          success: false,
        },
        kind: 'failure',
        providerStatus: 'submit_http_400',
        refundReason: 'error',
        status: 502,
      }),
    };

    const response = await submitPetrockLookup({ ...baseInput, provider });

    expect(response.status).toBe(502);
    expect(mocks.finalize).toHaveBeenCalledTimes(2);
  });

  it('keeps polling when a terminal write loses its conditional transition', async () => {
    mocks.finalize.mockResolvedValue(false);
    const provider = {
      submit: vi.fn().mockResolvedValue({
        body: {
          code: 'PETROCK_REJECTED',
          error: 'Order rejected',
          success: false,
        },
        kind: 'failure',
        providerStatus: 'submit_http_400',
        refundReason: 'error',
        status: 502,
      }),
    };

    const response = await submitPetrockLookup({ ...baseInput, provider });

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      status: 'pending',
    });
  });
});
