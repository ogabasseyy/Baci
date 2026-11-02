import { describe, expect, it, vi } from 'vitest';
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
import { PlanWalletError } from './plan-wallets';

describe('ensurePlanWallet', () => {
  it('provisions customer and wallet then records the mapping', async () => {
    const calls: string[] = [];
    stubProvider((url) => {
      calls.push(url);
      if (url.includes('/api/v1/customers'))
        return jsonResponse({
          status: true,
          message: 'Customer created',
          data: {
            customer_id: 'pvb-customer-synthetic-001',
            wallet_id: 'pvb-default-synthetic-001',
            new_customer: true,
          },
        });
      if (url.includes('/api/v1/wallet/sub-account'))
        return jsonResponse({
          status: true,
          message: 'Wallet creation is being processed',
          data: { id: 'pvb-wallet-synthetic-001' },
        });
      if (url.includes('/api/v1/wallet/api/wallet-type'))
        return jsonResponse({
          status: true,
          message: 'API wallets fetched successfully',
          data: { paginatedPayload: { edges: [] } },
        });
      if (url.endsWith('/accounts')) return jsonResponse(accountsBody);
      return jsonResponse(retrieveBody);
    });
    const { client, upsert } = mockSupabase({
      singles: [
        { data: null, error: null },
        { data: ROW, error: null },
      ],
      lists: [{ data: [{ net_kobo: 300000 }], error: null }],
    });

    const snapshot = await ensurePlanWallet(client, CONFIG, SCOPE, {
      syntheticKycEnabled: true,
    });

    expect(snapshot.status).toBe('ready');
    expect(calls.some((url) => url.includes('/api/v1/customers'))).toBe(true);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        customer_id: SCOPE.customerId,
        wallet_id: 'pvb-wallet-synthetic-001',
        status: 'provisioning',
      }),
      { onConflict: 'customer_id,merchant_id', ignoreDuplicates: true }
    );
    vi.unstubAllGlobals();
  });

  it('reconciles a timed-out create via the wallet list instead of duplicating', async () => {
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
      if (url.includes('/api/v1/wallet/sub-account'))
        throw new Error('This operation was aborted');
      if (url.includes('/api/v1/wallet/api/wallet-type'))
        return jsonResponse({
          status: true,
          message: 'API wallets fetched successfully',
          data: {
            paginatedPayload: {
              edges: [
                {
                  id: 'pvb-wallet-synthetic-001',
                  name: 'BACI PLAN 43E157B6 C0065070',
                  status: 'active',
                },
              ],
            },
          },
        });
      if (url.endsWith('/accounts')) return jsonResponse(accountsBody);
      return jsonResponse(retrieveBody);
    });
    const { client, upsert } = mockSupabase({
      singles: [
        { data: null, error: null },
        { data: ROW, error: null },
      ],
      lists: [{ data: [{ net_kobo: 300000 }], error: null }],
    });

    const snapshot = await ensurePlanWallet(client, CONFIG, SCOPE, {
      syntheticKycEnabled: true,
    });

    expect(snapshot.status).toBe('ready');
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ wallet_id: 'pvb-wallet-synthetic-001' }),
      expect.anything()
    );
    vi.unstubAllGlobals();
  });

  it('refuses provisioning when synthetic KYC is disabled', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { client } = mockSupabase({ singles: [{ data: null, error: null }] });

    const error = await ensurePlanWallet(client, CONFIG, SCOPE, {
      syntheticKycEnabled: false,
    }).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(PlanWalletError);
    expect(error).toMatchObject({ code: 'PLAN_WALLET_KYC_UNAVAILABLE' });
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
