import { describe, expect, it, vi } from 'vitest';
import {
  fundPiggyvestWalletTestMode,
  reservePiggyvestDisposableAccount,
  reservePiggyvestRegularAccount,
  retrievePiggyvestFundingAccounts,
} from './wallet-funding';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    status: 200,
  });
}

describe('retrievePiggyvestFundingAccounts', () => {
  it('returns the wallet funding accounts', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        status: true,
        message: 'Fetched virtual accounts for wallet',
        data: [
          {
            account_number: '9971338168',
            account_name: 'SYNTHETIC LTD/PLAN 1',
            bank_name: 'FAAS (SANDBOX)',
            paypoint_name: null,
            paypoint_id: null,
          },
        ],
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const accounts = await retrievePiggyvestFundingAccounts(
      { token: 'synthetic-token' },
      'wallet-1'
    );

    expect(accounts).toHaveLength(1);
    expect(accounts[0]?.account_number).toBe('9971338168');
    vi.unstubAllGlobals();
  });
});

describe('reservePiggyvestRegularAccount', () => {
  it('reserves with the documented regular payload', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        status: true,
        message: 'Initiated account reservation',
        data: {
          reference: 'PVB01K8JQC52NQ9R5RJDKG6EZX5ME',
          account_details: {
            account_number: '2341329231',
            account_name: 'Test Business/Synthetic wallet',
            bank_name: 'FAAS (SANDBOX)',
          },
        },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await reservePiggyvestRegularAccount(
      { token: 'synthetic-token' },
      { walletId: 'wallet-1', name: 'Synthetic wallet' }
    );

    expect(result.reference).toBe('PVB01K8JQC52NQ9R5RJDKG6EZX5ME');
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({
      type: 'regular',
      wallet_id: 'wallet-1',
    });
    vi.unstubAllGlobals();
  });
});

describe('reservePiggyvestDisposableAccount', () => {
  it('requires an expiry for one-shot top-ups', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    expect(() =>
      reservePiggyvestDisposableAccount({ token: 'synthetic-token' }, {
        walletId: 'wallet-1',
        name: 'Synthetic wallet',
      } as never)
    ).toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe('fundPiggyvestWalletTestMode', () => {
  it('enforces the NGN 100,000 per-call cap before any network call', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ status: true, message: 'Confirmation.' })
      );
    vi.stubGlobal('fetch', fetchMock);

    await fundPiggyvestWalletTestMode(
      { token: 'synthetic-token' },
      { walletId: 'wallet-1', amountKobo: 10_000_000 }
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await expect(
      fundPiggyvestWalletTestMode(
        { token: 'synthetic-token' },
        { walletId: 'wallet-1', amountKobo: 10_000_001 }
      )
    ).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });
});
