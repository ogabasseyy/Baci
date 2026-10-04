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

function mockSupabase(updateResult: { data: unknown; error: unknown }): {
  client: SupabaseClient;
  update: ReturnType<typeof vi.fn>;
} {
  const update = vi.fn(() => ({
    eq: vi.fn(() => ({
      select: vi.fn(() => thenable(updateResult)),
    })),
  }));
  return {
    client: { from: vi.fn(() => ({ update })) } as unknown as SupabaseClient,
    update,
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
});
