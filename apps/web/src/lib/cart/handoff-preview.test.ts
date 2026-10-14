import { describe, expect, it, vi } from 'vitest';

import { rpcPreviewHandoff } from './handoff';

const MERCHANT_ID = '11111111-1111-4111-8111-111111111111';

const CART_ID = '22222222-2222-4222-8222-222222222222';

function rawLine(overrides: Record<string, unknown> = {}) {
  return {
    assuranceRate: null,
    available: true,
    condition: null,
    hasAssurance: false,
    id: 'line-1',
    manageStock: false,
    negotiatedUnitPriceMinor: null,
    negotiationInvalidated: false,
    negotiationStatus: null,
    options: {},
    productId: '44444444-4444-4444-8444-444444444444',
    quantity: 1,
    stockQty: null,
    unitPriceMinor: 1500,
    variantId: null,
    voucherAwardId: null,
    voucherToken: null,
    ...overrides,
  };
}

function rawState(overrides: Record<string, unknown> = {}) {
  return {
    cartId: CART_ID,
    checkoutSessionId: null,
    currency: 'NGN',
    expiresAt: '2026-10-19T04:00:00Z',
    lines: [rawLine()],
    merchantId: MERCHANT_ID,
    replayed: false,
    state: 'active',
    version: 3,
    ...overrides,
  };
}

describe('rpcPreviewHandoff', () => {
  function clientReturning(payload: unknown, error: unknown = null) {
    return { rpc: vi.fn(async () => ({ data: payload, error })) };
  }

  it('never returns quiz voucher tokens in a preview', async () => {
    const result = await rpcPreviewHandoff(
      clientReturning({
        code: null,
        expiresAt: '2026-10-12T06:05:00.000Z',
        merchant: { id: MERCHANT_ID, slug: 'ogabassey' },
        ok: true,
        snapshot: rawState({
          lines: [
            rawLine({
              voucherAwardId: 'award-1',
              voucherToken: ['quiz', 'credential', '123'].join('-'),
            }),
          ],
        }),
        status: 'pending',
      }) as never,
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'ch1.fixture.token'
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.snapshot?.lines[0].voucherToken).toBeUndefined();
      expect(JSON.stringify(result.snapshot)).not.toContain(
        ['quiz', 'credential', '123'].join('-')
      );
    }
  });

  it('parses pending previews with priced snapshots', async () => {
    const result = await rpcPreviewHandoff(
      clientReturning({
        code: null,
        expiresAt: '2026-10-12T06:05:00.000Z',
        merchant: { id: MERCHANT_ID, slug: 'ogabassey' },
        ok: true,
        snapshot: rawState(),
        status: 'pending',
      }) as never,
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'ch1.fixture.token'
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.status).toBe('pending');
      expect(result.snapshot?.lines).toHaveLength(1);
      expect(result.merchant).toEqual({ id: MERCHANT_ID, slug: 'ogabassey' });
    }
  });

  it('reports consumed, expired and unknown links', async () => {
    for (const status of ['consumed', 'expired'] as const) {
      const result = await rpcPreviewHandoff(
        clientReturning({
          code: null,
          expiresAt: '2026-10-12T06:05:00.000Z',
          ok: true,
          status,
        }) as never,
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'ch1.fixture.token'
      );
      expect(result).toMatchObject({ ok: true, status });
    }
    const missing = await rpcPreviewHandoff(
      clientReturning({ code: 'not_found', ok: false }) as never,
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'ch1.fixture.token'
    );
    expect(missing).toEqual({ code: 'not_found', ok: false });
  });
});

it('bounds unrecognized preview RPC codes instead of returning arbitrary payloads', async () => {
  for (const code of [
    'unexpected_database_detail',
    42,
    { secret: 'fixture' },
  ]) {
    const client = {
      rpc: vi
        .fn()
        .mockResolvedValue({ data: { ok: false, code }, error: null }),
    };
    await expect(
      rpcPreviewHandoff(client as never, 'fixture-handoff', 'ch1.fixture.token')
    ).resolves.toEqual({ ok: false, code: 'temporarily_unavailable' });
  }
});
