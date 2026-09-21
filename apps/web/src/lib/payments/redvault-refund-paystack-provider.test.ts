import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  createRedvaultPaystackRefundProvider,
  createTestRedvaultPaystackRefundProvider,
} from './redvault-refund-paystack-provider';

const input = {
  amountKobo: 9500,
  originalCaptureReference: 'RV-capture',
  correlationKey: 'refund-1',
};
const data = {
  id: 123,
  status: 'pending',
  amount: 9500,
  currency: 'NGN',
  transaction: { reference: 'RV-capture' },
};
function setup(body: unknown, status = 200) {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response(JSON.stringify(body), { status }));
  return {
    fetcher,
    provider: createRedvaultPaystackRefundProvider({
      fetcher,
      getSecret: () => 'test-secret',
    }),
  };
}

describe('isolated REDVAULT Paystack refund transport', () => {
  it('accepts only a test key for the recovery runner transport', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ status: true, data }), { status: 200 })
      );
    const provider = createTestRedvaultPaystackRefundProvider({
      fetcher,
      providerKey: 'sk_test_refund_runner',
    });

    await expect(provider.submit(input)).resolves.toMatchObject({
      kind: 'accepted_pending',
    });
    expect(() =>
      createTestRedvaultPaystackRefundProvider({
        providerKey: 'sk_live_not_allowed',
      })
    ).toThrow('requires a Paystack test key');
  });

  it.each([
    false,
    null,
    {},
    { status: false, message: 'private body' },
    { status: true },
    { status: true, data: {} },
  ])('holds ambiguous envelope %j', async (body) => {
    const { provider, fetcher } = setup(body);
    expect(await provider.submit(input)).toEqual({ kind: 'indeterminate' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([
    400, 401, 422, 429, 500,
  ])('holds HTTP %s without retry', async (status) => {
    const { provider, fetcher } = setup({ status: false }, status);
    expect(await provider.submit(input)).toEqual({ kind: 'indeterminate' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('holds response loss and suppresses transport error detail', async () => {
    const { provider, fetcher } = setup(null);
    fetcher.mockRejectedValue(new Error('secret provider detail'));
    expect(await provider.submit(input)).toEqual({ kind: 'indeterminate' });
    await expect(
      provider.lookup({
        providerReference: '123',
        expectedAmountKobo: 9500,
        expectedCaptureReference: 'RV-capture',
        expectedCurrency: 'NGN',
      })
    ).rejects.toThrow('REDVAULT refund lookup unverified');
  });
  it('holds malformed JSON', async () => {
    const { provider, fetcher } = setup(null);
    fetcher.mockResolvedValue(new Response('not-json'));
    expect(await provider.submit(input)).toEqual({ kind: 'indeterminate' });
  });
  it.each([
    'pending',
    'processing',
    'needs-attention',
    'failed',
    'future-status',
  ])('retains known id for %s', async (status) => {
    const { provider } = setup({ status: true, data: { ...data, status } });
    expect(await provider.submit(input)).toEqual({
      kind: 'accepted_pending',
      providerReference: '123',
      providerStatus: status === 'future-status' ? 'unknown' : status,
    });
  });
  it('accepts a bound processed submission', async () => {
    const { provider } = setup({
      status: true,
      data: { ...data, status: 'processed' },
    });
    expect(await provider.submit(input)).toEqual({
      kind: 'processed',
      providerReference: '123',
      providerStatus: 'processed',
    });
  });
  it.each([
    { id: '123' },
    { amount: 1 },
    { currency: 'USD' },
    { transaction: { reference: 'other' } },
  ])('rejects unbound submission %j', async (changes) => {
    const { provider } = setup({ status: true, data: { ...data, ...changes } });
    expect(await provider.submit(input)).toEqual({ kind: 'indeterminate' });
  });
  it.each([
    'processed',
    'failed',
    'pending',
    'processing',
    'needs-attention',
  ])('reads bound status %s with GET only', async (status) => {
    const { provider, fetcher } = setup({
      status: true,
      data: { ...data, status },
    });
    const expected = ['processed', 'failed'].includes(status)
      ? status
      : 'pending';
    expect(
      await provider.lookup({
        providerReference: '123',
        expectedAmountKobo: 9500,
        expectedCaptureReference: 'RV-capture',
        expectedCurrency: 'NGN',
      })
    ).toEqual({
      kind: expected,
      providerStatus: expected,
    });
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.paystack.co/refund/123',
      expect.objectContaining({
        method: 'GET',
        body: undefined,
        redirect: 'error',
        cache: 'no-store',
      })
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([
    { id: 124, status: 'processed' },
    { id: '123', status: 'failed' },
    { id: 123 },
    { id: 123, status: 'unknown' },
  ])('rejects untrusted lookup %j', async (response) => {
    const { provider } = setup({ status: true, data: response });
    await expect(
      provider.lookup({
        providerReference: '123',
        expectedAmountKobo: 9500,
        expectedCaptureReference: 'RV-capture',
        expectedCurrency: 'NGN',
      })
    ).rejects.toThrow(/REDVAULT refund lookup/);
  });
  it('rejects path injection before requesting', async () => {
    const { provider, fetcher } = setup(null);
    await expect(
      provider.lookup({
        providerReference: '../123',
        expectedAmountKobo: 9500,
        expectedCaptureReference: 'RV-capture',
        expectedCurrency: 'NGN',
      })
    ).rejects.toThrow('invalid identifier');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('does not send without credentials', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const provider = createRedvaultPaystackRefundProvider({
      fetcher,
      getSecret: () => undefined,
    });
    expect(await provider.submit(input)).toEqual({ kind: 'indeterminate' });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([
    ['processed'],
    ['failed'],
  ])('resolves a single capture-reference match to %s', async (status) => {
    const { fetcher, provider } = setup({
      status: true,
      data: [
        {
          amount: 9500,
          currency: 'NGN',
          id: 124,
          merchant_note: 'refund-1',
          status,
          transaction: { reference: 'RV-capture' },
        },
      ],
    });
    await expect(
      provider.lookupByCaptureReference({
        captureReference: 'RV-capture',
        expectedAmountKobo: 9500,
        expectedCurrency: 'NGN',
        expectedCorrelationKey: 'refund-1',
        knownProviderReferences: [],
        submittedAt: null,
      })
    ).resolves.toEqual({
      kind: status,
      providerReference: '124',
      providerStatus: status,
    });
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.paystack.co/refund?transaction=RV-capture&perPage=100',
      expect.objectContaining({ method: 'GET', body: undefined })
    );
  });
  it.each([
    [[]],
    [[{ amount: 9500, currency: 'NGN' }]],
  ])('stays pending when the capture reference has no usable match %j', async (rows) => {
    const { provider } = setup({ status: true, data: rows });
    await expect(
      provider.lookupByCaptureReference({
        captureReference: 'RV-capture',
        expectedAmountKobo: 9500,
        expectedCurrency: 'NGN',
        expectedCorrelationKey: 'refund-1',
        knownProviderReferences: [],
        submittedAt: null,
      })
    ).resolves.toEqual({ kind: 'pending', providerStatus: 'pending' });
  });
  it('throws when the refund list lookup fails instead of resolving pending', async () => {
    const { provider } = setup(null);
    await expect(
      provider.lookupByCaptureReference({
        captureReference: 'RV-capture',
        expectedAmountKobo: 9500,
        expectedCurrency: 'NGN',
        expectedCorrelationKey: 'refund-1',
        knownProviderReferences: [],
        submittedAt: null,
      })
    ).rejects.toThrow('REDVAULT refund list lookup failed');
  });
  it('stays pending on ambiguous sibling refunds instead of resolving the wrong one', async () => {
    const row = (id: number, status: string) => ({
      amount: 9500,
      currency: 'NGN',
      id,
      status,
      transaction: { reference: 'RV-capture' },
    });
    const { provider } = setup({
      status: true,
      data: [row(124, 'processed'), row(125, 'pending')],
    });
    await expect(
      provider.lookupByCaptureReference({
        captureReference: 'RV-capture',
        expectedAmountKobo: 9500,
        expectedCurrency: 'NGN',
        expectedCorrelationKey: 'refund-1',
        knownProviderReferences: [],
        submittedAt: null,
      })
    ).resolves.toEqual({ kind: 'pending', providerStatus: 'pending' });
  });
  it('rejects capture-reference injection before requesting', async () => {
    const { fetcher, provider } = setup(null);
    await expect(
      provider.lookupByCaptureReference({
        captureReference: '../capture',
        expectedAmountKobo: 9500,
        expectedCurrency: 'NGN',
        expectedCorrelationKey: 'refund-1',
        knownProviderReferences: [],
        submittedAt: null,
      })
    ).rejects.toThrow('invalid identifier');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('stays pending when the only match is already persisted on a sibling', async () => {
    const { provider } = setup({
      status: true,
      data: [
        {
          amount: 9500,
          created_at: '2026-09-19T20:00:01.000Z',
          currency: 'NGN',
          id: 124,
          status: 'processed',
          transaction: { reference: 'RV-capture' },
        },
      ],
    });
    await expect(
      provider.lookupByCaptureReference({
        captureReference: 'RV-capture',
        expectedAmountKobo: 9500,
        expectedCurrency: 'NGN',
        expectedCorrelationKey: 'refund-1',
        knownProviderReferences: ['124'],
        submittedAt: '2026-09-19T20:00:00.000Z',
      })
    ).resolves.toEqual({ kind: 'pending', providerStatus: 'pending' });
  });
  it('resolves the unique new record when a sibling match is already persisted', async () => {
    const { provider } = setup({
      status: true,
      data: [
        {
          amount: 9500,
          created_at: '2026-09-19T19:00:00.000Z',
          currency: 'NGN',
          id: 124,
          status: 'processed',
          transaction: { reference: 'RV-capture' },
        },
        {
          amount: 9500,
          created_at: '2026-09-19T20:00:01.000Z',
          currency: 'NGN',
          id: 125,
          merchant_note: 'refund-1',
          status: 'processed',
          transaction: { reference: 'RV-capture' },
        },
      ],
    });
    await expect(
      provider.lookupByCaptureReference({
        captureReference: 'RV-capture',
        expectedAmountKobo: 9500,
        expectedCurrency: 'NGN',
        expectedCorrelationKey: 'refund-1',
        knownProviderReferences: ['124'],
        submittedAt: '2026-09-19T20:00:00.000Z',
      })
    ).resolves.toEqual({
      kind: 'processed',
      providerReference: '125',
      providerStatus: 'processed',
    });
  });
  it('stays pending when the match predates the local submission', async () => {
    const { provider } = setup({
      status: true,
      data: [
        {
          amount: 9500,
          created_at: '2026-09-19T19:00:00.000Z',
          currency: 'NGN',
          id: 124,
          status: 'processed',
          transaction: { reference: 'RV-capture' },
        },
      ],
    });
    await expect(
      provider.lookupByCaptureReference({
        captureReference: 'RV-capture',
        expectedAmountKobo: 9500,
        expectedCurrency: 'NGN',
        expectedCorrelationKey: 'refund-1',
        knownProviderReferences: [],
        submittedAt: '2026-09-19T20:00:00.000Z',
      })
    ).resolves.toEqual({ kind: 'pending', providerStatus: 'pending' });
  });
  it('stays pending when the match has no usable timestamp', async () => {
    const { provider } = setup({
      status: true,
      data: [
        {
          amount: 9500,
          currency: 'NGN',
          id: 124,
          status: 'processed',
          transaction: { reference: 'RV-capture' },
        },
      ],
    });
    await expect(
      provider.lookupByCaptureReference({
        captureReference: 'RV-capture',
        expectedAmountKobo: 9500,
        expectedCurrency: 'NGN',
        expectedCorrelationKey: 'refund-1',
        knownProviderReferences: [],
        submittedAt: '2026-09-19T20:00:00.000Z',
      })
    ).resolves.toEqual({ kind: 'pending', providerStatus: 'pending' });
  });
  it('binds a numeric provider transaction ID through fetch-transaction', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) => {
      if (String(url) === 'https://api.paystack.co/transaction/1641') {
        return new Response(
          JSON.stringify({ status: true, data: { reference: 'RV-capture' } }),
          { status: 200 }
        );
      }
      return new Response(
        JSON.stringify({
          status: true,
          data: { ...data, status: 'processed', transaction: 1641 },
        }),
        { status: 200 }
      );
    });
    const provider = createRedvaultPaystackRefundProvider({
      fetcher,
      getSecret: () => 'test-secret',
    });

    expect(await provider.submit(input)).toEqual({
      kind: 'processed',
      providerReference: '123',
      providerStatus: 'processed',
    });
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.paystack.co/transaction/1641',
      expect.objectContaining({ method: 'GET', body: undefined })
    );
    expect(
      await provider.lookup({
        providerReference: '123',
        expectedAmountKobo: 9500,
        expectedCaptureReference: 'RV-capture',
        expectedCurrency: 'NGN',
      })
    ).toEqual({ kind: 'processed', providerStatus: 'processed' });
  });
  it('holds a numeric transaction that resolves to another capture', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) => {
      if (String(url).startsWith('https://api.paystack.co/transaction/')) {
        return new Response(
          JSON.stringify({ status: true, data: { reference: 'RV-other' } }),
          { status: 200 }
        );
      }
      return new Response(
        JSON.stringify({
          status: true,
          data: { ...data, status: 'processed', transaction: 1641 },
        }),
        { status: 200 }
      );
    });
    const provider = createRedvaultPaystackRefundProvider({
      fetcher,
      getSecret: () => 'test-secret',
    });

    expect(await provider.submit(input)).toEqual({ kind: 'indeterminate' });
    await expect(
      provider.lookup({
        providerReference: '123',
        expectedAmountKobo: 9500,
        expectedCaptureReference: 'RV-capture',
        expectedCurrency: 'NGN',
      })
    ).rejects.toThrow('REDVAULT refund lookup unverified');
  });
  it('holds a numeric transaction the provider cannot resolve', async () => {
    const { provider } = setup({
      status: true,
      data: { ...data, status: 'processed', transaction: 1641 },
    });

    // The single-response mock answers the transaction lookup with the
    // refund payload, which carries no reference: unresolvable stays held.
    expect(await provider.submit(input)).toEqual({ kind: 'indeterminate' });
  });
  it('resolves a numeric-transaction row in capture-reference recovery', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) => {
      if (String(url) === 'https://api.paystack.co/transaction/1641') {
        return new Response(
          JSON.stringify({ status: true, data: { reference: 'RV-capture' } }),
          { status: 200 }
        );
      }
      return new Response(
        JSON.stringify({
          status: true,
          data: [
            {
              amount: 9500,
              currency: 'NGN',
              id: 124,
              merchant_note: 'refund-1',
              status: 'processed',
              transaction: 1641,
            },
          ],
        }),
        { status: 200 }
      );
    });
    const provider = createRedvaultPaystackRefundProvider({
      fetcher,
      getSecret: () => 'test-secret',
    });

    await expect(
      provider.lookupByCaptureReference({
        captureReference: 'RV-capture',
        expectedAmountKobo: 9500,
        expectedCurrency: 'NGN',
        expectedCorrelationKey: 'refund-1',
        knownProviderReferences: [],
        submittedAt: null,
      })
    ).resolves.toEqual({
      kind: 'processed',
      providerReference: '124',
      providerStatus: 'processed',
    });
  });
  it('echoes the correlation key on submit for reference-less recovery', async () => {
    const { fetcher, provider } = setup({ status: true, data });
    expect(await provider.submit(input)).toEqual({
      kind: 'accepted_pending',
      providerReference: '123',
      providerStatus: 'pending',
    });
    const [, init] = fetcher.mock.calls[0] as unknown as [
      string,
      { body?: string },
    ];
    expect(JSON.parse(String(init?.body))).toEqual(
      expect.objectContaining({ merchant_note: 'refund-1' })
    );
  });
  it('holds a submit without a correlation key', async () => {
    const { fetcher, provider } = setup({ status: true, data });
    expect(await provider.submit({ ...input, correlationKey: '' })).toEqual({
      kind: 'indeterminate',
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('stays pending when the sole same-amount match carries another identity', async () => {
    // A manual dashboard refund created after the local submission matches
    // on amount, currency, capture, and timing — but not on identity.
    const { provider } = setup({
      status: true,
      data: [
        {
          amount: 9500,
          created_at: '2026-09-19T20:00:01.000Z',
          currency: 'NGN',
          id: 124,
          merchant_note: 'manual dashboard refund',
          status: 'processed',
          transaction: { reference: 'RV-capture' },
        },
      ],
    });
    await expect(
      provider.lookupByCaptureReference({
        captureReference: 'RV-capture',
        expectedAmountKobo: 9500,
        expectedCurrency: 'NGN',
        expectedCorrelationKey: 'refund-1',
        knownProviderReferences: [],
        submittedAt: '2026-09-19T20:00:00.000Z',
      })
    ).resolves.toEqual({ kind: 'pending', providerStatus: 'pending' });
  });
  it('resolves the echoed note through the fetch-refund fallback', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) => {
      if (String(url) === 'https://api.paystack.co/refund/124') {
        return new Response(
          JSON.stringify({
            status: true,
            data: { id: 124, merchant_note: 'refund-1' },
          }),
          { status: 200 }
        );
      }
      return new Response(
        JSON.stringify({
          status: true,
          data: [
            {
              amount: 9500,
              currency: 'NGN',
              id: 124,
              status: 'processed',
              transaction: { reference: 'RV-capture' },
            },
          ],
        }),
        { status: 200 }
      );
    });
    const provider = createRedvaultPaystackRefundProvider({
      fetcher,
      getSecret: () => 'test-secret',
    });

    await expect(
      provider.lookupByCaptureReference({
        captureReference: 'RV-capture',
        expectedAmountKobo: 9500,
        expectedCurrency: 'NGN',
        expectedCorrelationKey: 'refund-1',
        knownProviderReferences: [],
        submittedAt: null,
      })
    ).resolves.toEqual({
      kind: 'processed',
      providerReference: '124',
      providerStatus: 'processed',
    });
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.paystack.co/refund/124',
      expect.objectContaining({ method: 'GET', body: undefined })
    );
  });
  it('stays pending without an expected correlation key', async () => {
    const { fetcher, provider } = setup({
      status: true,
      data: [
        {
          amount: 9500,
          currency: 'NGN',
          id: 124,
          merchant_note: 'refund-1',
          status: 'processed',
          transaction: { reference: 'RV-capture' },
        },
      ],
    });
    await expect(
      provider.lookupByCaptureReference({
        captureReference: 'RV-capture',
        expectedAmountKobo: 9500,
        expectedCurrency: 'NGN',
        expectedCorrelationKey: '',
        knownProviderReferences: [],
        submittedAt: null,
      })
    ).resolves.toEqual({ kind: 'pending', providerStatus: 'pending' });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
