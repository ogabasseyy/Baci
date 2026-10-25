import { describe, expect, it, vi } from 'vitest';
import {
  hashLegacyToken,
  LegacyMigrationParseError,
  mapMcpLinesToInput,
  mapUcpLinesToInput,
  migrateLegacyCart,
} from './legacy-migration';

const PRODUCT_ID = '33333333-3333-4333-8333-333333333333';

function clientReturning(value: unknown, error: unknown = null) {
  return { rpc: vi.fn().mockResolvedValue({ data: value, error }) };
}

function rawState() {
  return {
    cartId: '22222222-2222-4222-8222-222222222222',
    checkoutSessionId: null,
    currency: 'NGN',
    expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
    lines: [],
    merchantId: '11111111-1111-4111-8111-111111111111',
    replayed: false,
    state: 'active',
    version: 1,
  };
}

describe('hashLegacyToken', () => {
  it('hashes handles deterministically without exposing them', () => {
    const first = hashLegacyToken('token-a');
    const second = hashLegacyToken('token-a');

    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(first).not.toContain('token-a');
    expect(hashLegacyToken('token-b')).not.toBe(first);
  });

  it('matches the database sha256 hex for a known token', () => {
    expect(hashLegacyToken('a'.repeat(64))).toBe(
      'ffe054fe7ae0cb6dc65c3af9b61d5209f439851db43d0ba5997337df154668eb'
    );
  });
});

describe('mapMcpLinesToInput', () => {
  it('maps legacy lines one to one without repricing', () => {
    const lines = mapMcpLinesToInput([
      { product_id: PRODUCT_ID, quantity: 2 },
      {
        product_id: '44444444-4444-4444-8444-444444444444',
        quantity: 1,
      },
    ]);

    expect(lines).toEqual([
      { item: { productId: PRODUCT_ID }, quantity: 2 },
      {
        item: { productId: '44444444-4444-4444-8444-444444444444' },
        quantity: 1,
      },
    ]);
  });

  it('keeps an exact offer id and rejects a non-uuid offer', () => {
    const offerId = '55555555-5555-4555-8555-555555555555';
    expect(
      mapMcpLinesToInput([
        { offer_id: offerId, product_id: PRODUCT_ID, quantity: 1 },
      ])
    ).toEqual([{ item: { offerId, productId: PRODUCT_ID }, quantity: 1 }]);
    expect(() =>
      mapMcpLinesToInput([
        { offer_id: 'offer', product_id: PRODUCT_ID, quantity: 1 },
      ])
    ).toThrowError(/offer/i);
  });
});

describe('mapUcpLinesToInput', () => {
  it('maps checkout items one to one', () => {
    expect(mapUcpLinesToInput([{ id: PRODUCT_ID, quantity: 3 }])).toEqual([
      { item: { productId: PRODUCT_ID }, quantity: 3 },
    ]);
  });

  it('rejects unparseable entries instead of dropping them', () => {
    expect(() => mapUcpLinesToInput([{ id: '', quantity: 1 }])).toThrowError(
      LegacyMigrationParseError
    );
    expect(() =>
      mapUcpLinesToInput([{ id: PRODUCT_ID, quantity: 0 }])
    ).toThrowError(LegacyMigrationParseError);
    expect(() =>
      mapUcpLinesToInput([
        { id: PRODUCT_ID, quantity: 1 },
        { id: 'not-a-uuid', quantity: 1 },
      ])
    ).toThrowError(LegacyMigrationParseError);
  });
});

describe('migrateLegacyCart', () => {
  it('migrates through the legacy RPC with the token hash', async () => {
    const client = clientReturning({
      code: null,
      currentVersion: 1,
      ok: true,
      replayed: false,
      state: rawState(),
    });

    const result = await migrateLegacyCart(client as never, {
      currency: 'NGN',
      legacyTokenHash:
        'ffe054fe7ae0cb6dc65c3af9b61d5209f439851db43d0ba5997337df154668eb',
      legacyVersion: '1',
      lines: [{ item: { productId: PRODUCT_ID }, quantity: 2 }],
      operationId: 'mig-1',
      provider: 'mcp',
    });

    expect(result.ok).toBe(true);
    expect(client.rpc).toHaveBeenCalledWith(
      'commerce_cart_migrate_legacy',
      expect.objectContaining({
        p_legacy_token_hash:
          'ffe054fe7ae0cb6dc65c3af9b61d5209f439851db43d0ba5997337df154668eb',
        p_provider: 'mcp',
      })
    );
    const [, params] = client.rpc.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(JSON.stringify(params)).not.toContain('price');
  });

  it('surfaces replayed mappings and refresh conflicts', async () => {
    const replayed = clientReturning({
      code: null,
      currentVersion: 3,
      ok: true,
      replayed: true,
      state: { ...rawState(), version: 1 },
    });
    const replay = await migrateLegacyCart(replayed as never, {
      currency: 'NGN',
      legacyTokenHash: '0'.repeat(64),
      legacyVersion: '1',
      lines: [],
      operationId: 'mig-1',
      provider: 'mcp',
    });
    expect(replay.ok).toBe(true);
    if (replay.ok) {
      expect(replay.replayed).toBe(true);
    }

    const conflicted = clientReturning({
      code: 'refresh_required',
      currentVersion: 2,
      ok: false,
      replayed: false,
      state: { ...rawState(), version: 2 },
    });
    const conflict = await migrateLegacyCart(conflicted as never, {
      currency: 'NGN',
      legacyTokenHash: '1'.repeat(64),
      legacyVersion: '1',
      lines: [],
      operationId: 'mig-2',
      provider: 'ucp',
    });
    expect(conflict).toMatchObject({ code: 'refresh_required', ok: false });
  });

  it('fails closed on transport errors', async () => {
    const client = clientReturning(null, { message: 'fetch failed' });

    await expect(
      migrateLegacyCart(client as never, {
        currency: 'NGN',
        legacyTokenHash: '0'.repeat(64),
        legacyVersion: '1',
        lines: [],
        operationId: 'mig-3',
        provider: 'mcp',
      })
    ).rejects.toMatchObject({ code: 'temporarily_unavailable' });
  });
});
