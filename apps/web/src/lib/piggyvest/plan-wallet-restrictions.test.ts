import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import {
  applyRestrictionCreated,
  applyRestrictionLifted,
  attributedWalletId,
} from './plan-wallet-restrictions';

function thenable(result: unknown) {
  const then = (resolve: (value: unknown) => void) =>
    Promise.resolve(result).then(resolve);
  return { then };
}

function mockSupabase(
  updateResult: { data: unknown; error: unknown },
  options: {
    probe?: { data: unknown; error: unknown };
    rpc?: { data: unknown; error: unknown };
  } = {}
): {
  client: SupabaseClient;
  update: ReturnType<typeof vi.fn>;
  rpc: ReturnType<typeof vi.fn>;
} {
  const update = vi.fn(() => ({
    eq: vi.fn(() => ({
      select: vi.fn(() => thenable(updateResult)),
    })),
  }));
  const probe = options.probe ?? {
    data: { wallet_id: 'wallet-a' },
    error: null,
  };
  const select = vi.fn(() => ({
    eq: vi.fn(() => ({
      maybeSingle: vi.fn(async () => probe),
    })),
  }));
  const rpcResult = options.rpc ?? { data: false, error: null };
  const rpc = vi.fn(async () => rpcResult);
  return {
    client: {
      from: vi.fn(() => ({ update, select })),
      rpc,
    } as unknown as SupabaseClient,
    update,
    rpc,
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    status: 200,
  });
}

describe('attributedWalletId', () => {
  it('prefers pvb_wallet, then eventData.wallet_id', () => {
    expect(attributedWalletId({ pvb_wallet: 'wallet-a', eventData: {} })).toBe(
      'wallet-a'
    );
    expect(attributedWalletId({ eventData: { wallet_id: 'wallet-b' } })).toBe(
      'wallet-b'
    );
  });

  it('returns null without attribution instead of guessing', () => {
    expect(attributedWalletId({ eventData: {} })).toBeNull();
    expect(attributedWalletId({ eventData: { wallet_id: 42 } })).toBeNull();
  });
});

describe('applyRestrictionCreated', () => {
  it('restricts the attributed wallet immediately', async () => {
    const { client, update } = mockSupabase({
      data: [{ wallet_id: 'wallet-a' }],
      error: null,
    });

    await expect(applyRestrictionCreated(client, 'wallet-a')).resolves.toBe(
      'restricted'
    );
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'restricted' })
    );
  });

  it('reports unknown wallets without failing', async () => {
    const { client } = mockSupabase({ data: [], error: null });

    await expect(applyRestrictionCreated(client, 'wallet-zzz')).resolves.toBe(
      'unknown-wallet'
    );
  });

  it('flips staging goal wallets through the bridge when legacy misses', async () => {
    const { client, rpc } = mockSupabase(
      { data: [], error: null },
      { rpc: { data: true, error: null } }
    );

    await expect(applyRestrictionCreated(client, 'wallet-s')).resolves.toBe(
      'restricted'
    );
    expect(rpc).toHaveBeenCalledWith('apply_staging_wallet_restriction', {
      p_provider_wallet_id: 'wallet-s',
      p_restriction_status: 'restricted',
    });
  });

  it('throws storage errors from the staging bridge', async () => {
    const { client } = mockSupabase(
      { data: [], error: null },
      { rpc: { data: null, error: new Error('boom') } }
    );

    await expect(
      applyRestrictionCreated(client, 'wallet-s')
    ).rejects.toMatchObject({ code: 'RESTRICTION_STORAGE_ERROR' });
  });
});

describe('applyRestrictionLifted', () => {
  const retrieveBody = (status: string) => ({
    status: true,
    message: 'Wallet details fetched',
    data: {
      id: 'wallet-a',
      business_id: 'business-synthetic-001',
      virtual_account_id: null,
      currency: 'NGN',
      name: 'BACI PLAN',
      status,
      type: 'api',
      balance: 100,
      withdrawal_count: 0,
      creation_interest_rate: 0,
      current_interest_rate: 0,
    },
  });

  it('marks ready only after a live active retrieve', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(retrieveBody('active')))
    );
    const { client } = mockSupabase({
      data: [{ wallet_id: 'wallet-a' }],
      error: null,
    });

    await expect(
      applyRestrictionLifted(client, { token: 'synthetic' }, 'wallet-a')
    ).resolves.toBe('ready');
    vi.unstubAllGlobals();
  });

  it('falls back to provisioning when the wallet is not active', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(retrieveBody('frozen')))
    );
    const { client } = mockSupabase({
      data: [{ wallet_id: 'wallet-a' }],
      error: null,
    });

    await expect(
      applyRestrictionLifted(client, { token: 'synthetic' }, 'wallet-a')
    ).resolves.toBe('provisioning');
    vi.unstubAllGlobals();
  });

  it('falls back to provisioning without provider config', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { client } = mockSupabase({
      data: [{ wallet_id: 'wallet-a' }],
      error: null,
    });

    await expect(
      applyRestrictionLifted(client, null, 'wallet-a')
    ).resolves.toBe('provisioning');
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('lifts staging wallets without a production live check', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { client, rpc } = mockSupabase(
      { data: [], error: null },
      {
        probe: { data: null, error: null },
        rpc: { data: true, error: null },
      }
    );

    await expect(
      applyRestrictionLifted(client, { token: 'synthetic' }, 'wallet-s')
    ).resolves.toBe('ready');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith('apply_staging_wallet_restriction', {
      p_provider_wallet_id: 'wallet-s',
      p_restriction_status: 'ready',
    });
    vi.unstubAllGlobals();
  });

  it('reports unknown staging wallets without failing', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const { client } = mockSupabase(
      { data: [], error: null },
      { probe: { data: null, error: null } }
    );

    await expect(
      applyRestrictionLifted(client, { token: 'synthetic' }, 'wallet-zzz')
    ).resolves.toBe('unknown-wallet');
    vi.unstubAllGlobals();
  });
});
