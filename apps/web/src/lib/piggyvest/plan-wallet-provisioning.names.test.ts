import { afterEach, describe, expect, it, vi } from 'vitest';
import { ensurePlanWallet } from './plan-wallet-provisioning';
import {
  accountsBody,
  CONFIG,
  jsonResponse,
  mockSupabase,
  ROW,
  retrieveBody,
  SCOPE,
  stubProvider,
} from './plan-wallet-provisioning.test-support';

/**
 * PiggyVest rewrites sub-wallet names (sandbox, 2026-10-31: the `-` in
 * `pvbproof-goal-...` was gone when the wallet was listed back), so the
 * deterministic `BACI PLAN <merchant> <customer>` name can come back as
 * e.g. `BACIPLAN43E157B6C0065070`. Reconciliation must still find it, or a
 * timed-out create followed by a retry mints a second, orphaned wallet.
 */

const SANITISED_NAME = 'BACIPLAN43E157B6C0065070';
const MINTED = {
  id: 'pvb-wallet-synthetic-001',
  name: SANITISED_NAME,
  status: 'active',
};

function provider(options: {
  /** Wallet-list answers in call order; the last one repeats. */
  lists: unknown[][];
  create: 'accepted' | 'timeout';
}) {
  const creates: string[] = [];
  let listCalls = 0;
  stubProvider((url) => {
    if (url.includes('/api/v1/customers'))
      return jsonResponse({
        status: true,
        message: 'Customer created',
        data: {
          customer_id: 'pvb-customer-synthetic-001',
          wallet_id: 'pvb-default-synthetic-001',
          new_customer: false,
        },
      });
    if (url.includes('/api/v1/wallet/sub-account')) {
      creates.push(url);
      if (options.create === 'timeout')
        throw new Error('This operation was aborted');
      return jsonResponse(
        {
          status: true,
          message: 'Wallet creation is being processed',
          data: { id: 'pvb-wallet-synthetic-002' },
        },
        202
      );
    }
    if (url.includes('/api/v1/wallet/api/wallet-type')) {
      const edges =
        options.lists[Math.min(listCalls, options.lists.length - 1)];
      listCalls += 1;
      return jsonResponse({
        status: true,
        message: 'API wallets fetched successfully',
        data: { paginatedPayload: { edges } },
      });
    }
    if (url.endsWith('/accounts')) return jsonResponse(accountsBody);
    return jsonResponse(retrieveBody);
  });
  return creates;
}

function storage() {
  return mockSupabase({
    singles: [
      { data: null, error: null },
      { data: ROW, error: null },
    ],
    lists: [{ data: [{ net_kobo: 300000 }], error: null }],
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('bugfix: ensurePlanWallet reconciles provider-sanitised wallet names', () => {
  it('adopts the wallet listed under a sanitised name after a create timeout instead of failing', async () => {
    const creates = provider({ lists: [[], [MINTED]], create: 'timeout' });
    const { client, upsert } = storage();

    const snapshot = await ensurePlanWallet(client, CONFIG, SCOPE, {
      syntheticKycEnabled: true,
    });

    expect(snapshot.status).toBe('ready');
    expect(creates).toHaveLength(1);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ wallet_id: MINTED.id }),
      expect.anything()
    );
  });

  it('adopts a sanitised listed wallet on a retry instead of minting a duplicate', async () => {
    const creates = provider({ lists: [[MINTED]], create: 'accepted' });
    const { client, upsert } = storage();

    await ensurePlanWallet(client, CONFIG, SCOPE, {
      syntheticKycEnabled: true,
    });

    expect(creates).toEqual([]);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        wallet_id: MINTED.id,
        subaccount_name: 'BACI PLAN 43E157B6 C0065070',
      }),
      expect.anything()
    );
  });

  it('refuses to pick between two listed wallets that match the name', async () => {
    const twin = { ...MINTED, id: 'pvb-wallet-synthetic-003' };
    const creates = provider({ lists: [[MINTED, twin]], create: 'accepted' });
    const { client, upsert } = storage();

    const error = await ensurePlanWallet(client, CONFIG, SCOPE, {
      syntheticKycEnabled: true,
    }).catch((cause: unknown) => cause);

    expect(error).toMatchObject({ code: 'PLAN_WALLET_PROVIDER_ERROR' });
    expect(creates).toEqual([]);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('refuses to pick between matching wallets found after a create timeout', async () => {
    const twin = { ...MINTED, id: 'pvb-wallet-synthetic-003' };
    const creates = provider({
      lists: [[], [MINTED, twin]],
      create: 'timeout',
    });
    const { client, upsert } = storage();

    const error = await ensurePlanWallet(client, CONFIG, SCOPE, {
      syntheticKycEnabled: true,
    }).catch((cause: unknown) => cause);

    expect(error).toMatchObject({ code: 'PLAN_WALLET_PROVIDER_ERROR' });
    expect(creates).toHaveLength(1);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('does not adopt a listed wallet whose name differs beyond punctuation and case', async () => {
    const other = { ...MINTED, name: 'BACIPLAN43E157B6C0065071' };
    const creates = provider({ lists: [[other]], create: 'accepted' });
    const { client, upsert } = storage();

    await ensurePlanWallet(client, CONFIG, SCOPE, {
      syntheticKycEnabled: true,
    });

    expect(creates).toHaveLength(1);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ wallet_id: 'pvb-wallet-synthetic-002' }),
      expect.anything()
    );
  });
});
