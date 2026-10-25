import { describe, expect, it, vi } from 'vitest';
import { submitNextPetrockEligibilityCheck } from './petrock-eligibility-engine';

describe('submitNextPetrockEligibilityCheck', () => {
  const order = {
    eligibilityChecksCompleted: [] as string[],
    eligibilityEvidence: {
      blacklistStatus: 'Clean',
      carrier: 'Unknown',
      device: 'iPhone 17 Pro Max',
      simLock: 'Locked',
    },
    id: 'order-1',
  };

  it('does not buy missing house checks for a known blacklisted device', async () => {
    const submitOrder = vi.fn();
    const readProduct = vi.fn();
    const suppress = vi.fn().mockResolvedValue(true);
    const result = await submitNextPetrockEligibilityCheck({
      client: { getAccount: vi.fn(), submitOrder },
      identifier: '490154203237518',
      order: {
        ...order,
        eligibilityEvidence: {
          ...order.eligibilityEvidence,
          blacklistStatus: 'Blacklisted',
        },
      },
      origin: 'https://ogabassey.com',
      readProduct,
      state: {
        begin: vi.fn(),
        markSubmissionUnknown: vi.fn(),
        recordSubmission: vi.fn(),
        suppress,
      },
    });
    expect(result).toMatchObject({
      kind: 'suppressed',
      reason: 'blacklist_risk',
    });
    expect(submitOrder).not.toHaveBeenCalled();
    expect(readProduct).not.toHaveBeenCalled();
  });

  it('write-aheads and submits the first missing house check', async () => {
    const begin = vi.fn().mockResolvedValue(true);
    const record = vi.fn().mockResolvedValue(true);
    const submitOrder = vi.fn().mockResolvedValue({
      data: { orderUuid: 'provider-order-1' },
      ok: true,
      rawText: '{}',
    });

    await expect(
      submitNextPetrockEligibilityCheck({
        client: {
          getAccount: vi.fn().mockResolvedValue({
            data: { balance: 20, currency: 'USD' },
            ok: true,
            rawText: '{}',
          }),
          submitOrder,
        },
        identifier: '490154203237518',
        order,
        origin: 'https://ogabassey.com',
        readProduct: vi.fn().mockResolvedValue({
          active: true,
          currency: 'USD',
          orderFieldName: 'IMEI/SN:',
          priceUsd: 0.07,
          productId: '689',
          syncedAt: new Date().toISOString(),
        }),
        state: {
          begin,
          markSubmissionUnknown: vi.fn(),
          recordSubmission: record,
          suppress: vi.fn(),
        },
      })
    ).resolves.toMatchObject({
      check: 'carrier_detection',
      kind: 'pending',
    });
    expect(begin).toHaveBeenCalledWith(
      expect.objectContaining({
        check: 'carrier_detection',
        orderId: 'order-1',
      })
    );
    expect(submitOrder).toHaveBeenCalledWith(
      expect.objectContaining({ productId: '689', orderFieldName: 'IMEI/SN:' })
    );
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ providerOrderId: 'provider-order-1' })
    );
  });

  it('never retries or suppresses an ambiguous provider submission', async () => {
    const markSubmissionUnknown = vi.fn().mockResolvedValue(true);
    const recordSubmission = vi.fn();

    const result = await submitNextPetrockEligibilityCheck({
      client: {
        getAccount: vi.fn().mockResolvedValue({
          data: { balance: 20, currency: 'USD' },
          ok: true,
          rawText: '{}',
        }),
        submitOrder: vi.fn().mockResolvedValue({
          kind: 'timeout',
          message: 'timeout',
          ok: false,
        }),
      },
      identifier: '490154203237518',
      order,
      origin: 'https://ogabassey.com',
      readProduct: vi.fn().mockResolvedValue({
        active: true,
        currency: 'USD',
        orderFieldName: 'IMEI/SN:',
        priceUsd: 0.07,
        productId: '689',
        syncedAt: new Date().toISOString(),
      }),
      state: {
        begin: vi.fn().mockResolvedValue(true),
        markSubmissionUnknown,
        recordSubmission,
        suppress: vi.fn(),
      },
    });

    expect(result.kind).toBe('submission_unknown');
    expect(markSubmissionUnknown).toHaveBeenCalled();
    expect(recordSubmission).not.toHaveBeenCalled();
  });

  it('suppresses a house check when the catalog product is not priced in USD', async () => {
    const getAccount = vi.fn();
    const submitOrder = vi.fn();
    const suppress = vi.fn().mockResolvedValue(true);

    const result = await submitNextPetrockEligibilityCheck({
      client: { getAccount, submitOrder },
      identifier: '490154203237518',
      order,
      origin: 'https://ogabassey.com',
      readProduct: vi.fn().mockResolvedValue({
        active: true,
        currency: 'EUR',
        orderFieldName: 'IMEI/SN:',
        priceUsd: 0.07,
        productId: '689',
        syncedAt: new Date().toISOString(),
      }),
      state: {
        begin: vi.fn(),
        markSubmissionUnknown: vi.fn(),
        recordSubmission: vi.fn(),
        suppress,
      },
    });

    expect(result).toEqual({
      kind: 'suppressed',
      reason: 'house_check_unavailable',
    });
    expect(suppress).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'house_check_unavailable' })
    );
    expect(getAccount).not.toHaveBeenCalled();
    expect(submitOrder).not.toHaveBeenCalled();
  });

  it('retries persistence of an accepted house-check order', async () => {
    const recordSubmission = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('temporary database error'))
      .mockResolvedValueOnce(true);

    const result = await submitNextPetrockEligibilityCheck({
      client: {
        getAccount: vi.fn().mockResolvedValue({
          data: { balance: 20, currency: 'USD' },
          ok: true,
          rawText: '{}',
        }),
        submitOrder: vi.fn().mockResolvedValue({
          data: { orderUuid: 'provider-order-1' },
          ok: true,
          rawText: '{}',
        }),
      },
      identifier: '490154203237518',
      order,
      origin: 'https://ogabassey.com',
      readProduct: vi.fn().mockResolvedValue({
        active: true,
        currency: 'USD',
        orderFieldName: 'IMEI/SN:',
        priceUsd: 0.07,
        productId: '689',
        syncedAt: new Date().toISOString(),
      }),
      state: {
        begin: vi.fn().mockResolvedValue(true),
        markSubmissionUnknown: vi.fn(),
        recordSubmission,
        suppress: vi.fn(),
      },
    });

    expect(result.kind).toBe('pending');
    expect(recordSubmission).toHaveBeenCalledTimes(2);
  });

  it('marks an accepted house check unknown when persistence is exhausted', async () => {
    const markSubmissionUnknown = vi.fn().mockResolvedValue(true);
    const recordSubmission = vi
      .fn()
      .mockRejectedValue(new TypeError('database unavailable'));

    const result = await submitNextPetrockEligibilityCheck({
      client: {
        getAccount: vi.fn().mockResolvedValue({
          data: { balance: 20, currency: 'USD' },
          ok: true,
          rawText: '{}',
        }),
        submitOrder: vi.fn().mockResolvedValue({
          data: { orderUuid: 'provider-order-1' },
          ok: true,
          rawText: '{}',
        }),
      },
      identifier: '490154203237518',
      order,
      origin: 'https://ogabassey.com',
      readProduct: vi.fn().mockResolvedValue({
        active: true,
        currency: 'USD',
        orderFieldName: 'IMEI/SN:',
        priceUsd: 0.07,
        productId: '689',
        syncedAt: new Date().toISOString(),
      }),
      state: {
        begin: vi.fn().mockResolvedValue(true),
        markSubmissionUnknown,
        recordSubmission,
        suppress: vi.fn(),
      },
    });

    expect(result.kind).toBe('submission_unknown');
    expect(recordSubmission).toHaveBeenCalledTimes(2);
    expect(markSubmissionUnknown).toHaveBeenCalledWith({
      orderId: 'order-1',
      providerOrderId: 'provider-order-1',
      reason: 'accepted_submission_persistence_failed',
    });
  });

  it('fails closed for a future-dated house-check catalog snapshot', async () => {
    const getAccount = vi.fn();
    const suppress = vi.fn().mockResolvedValue(true);

    const result = await submitNextPetrockEligibilityCheck({
      client: { getAccount, submitOrder: vi.fn() },
      identifier: '490154203237518',
      order,
      origin: 'https://ogabassey.com',
      readProduct: vi.fn().mockResolvedValue({
        active: true,
        currency: 'USD',
        orderFieldName: 'IMEI/SN:',
        priceUsd: 0.07,
        productId: '689',
        syncedAt: new Date(Date.now() + 60_000).toISOString(),
      }),
      state: {
        begin: vi.fn(),
        markSubmissionUnknown: vi.fn(),
        recordSubmission: vi.fn(),
        suppress,
      },
    });

    expect(result).toEqual({
      kind: 'suppressed',
      reason: 'house_check_unavailable',
    });
    expect(getAccount).not.toHaveBeenCalled();
  });

  it('treats an HTTP 5xx submission response as ambiguous', async () => {
    const markSubmissionUnknown = vi.fn().mockResolvedValue(true);
    const suppress = vi.fn();

    const result = await submitNextPetrockEligibilityCheck({
      client: {
        getAccount: vi.fn().mockResolvedValue({
          data: { balance: 20, currency: 'USD' },
          ok: true,
          rawText: '{}',
        }),
        submitOrder: vi.fn().mockResolvedValue({
          kind: 'http',
          message: 'server error',
          ok: false,
          status: 500,
        }),
      },
      identifier: '490154203237518',
      order,
      origin: 'https://ogabassey.com',
      readProduct: vi.fn().mockResolvedValue({
        active: true,
        currency: 'USD',
        orderFieldName: 'IMEI/SN:',
        priceUsd: 0.07,
        productId: '689',
        syncedAt: new Date().toISOString(),
      }),
      state: {
        begin: vi.fn().mockResolvedValue(true),
        markSubmissionUnknown,
        recordSubmission: vi.fn(),
        suppress,
      },
    });

    expect(result.kind).toBe('submission_unknown');
    expect(markSubmissionUnknown).toHaveBeenCalled();
    expect(suppress).not.toHaveBeenCalled();
  });
});

it.each([
  { blacklistStatus: 'Unknown', simLock: 'Locked' },
  { blacklistStatus: 'Clean', simLock: 'Unknown' },
  { blacklistStatus: 'Clean', simLock: 'Unlocked' },
])('does not buy any eligibility check without explicit clean and locked evidence: %j', async (evidence) => {
  const client = { getAccount: vi.fn(), submitOrder: vi.fn() };
  const readProduct = vi.fn();
  const state = {
    begin: vi.fn(),
    markSubmissionUnknown: vi.fn(),
    recordSubmission: vi.fn(),
    suppress: vi.fn().mockResolvedValue(true),
  };
  const result = await submitNextPetrockEligibilityCheck({
    client,
    identifier: '490154203237518',
    origin: 'https://ogabassey.com',
    readProduct,
    state,
    order: {
      id: 'order-1',
      eligibilityChecksCompleted: [],
      eligibilityEvidence: { ...evidence, carrier: 'AT&T' },
    },
  });
  expect(result.kind).toBe('suppressed');
  expect(readProduct).not.toHaveBeenCalled();
  expect(client.getAccount).not.toHaveBeenCalled();
  expect(client.submitOrder).not.toHaveBeenCalled();
  expect(state.begin).not.toHaveBeenCalled();
});
