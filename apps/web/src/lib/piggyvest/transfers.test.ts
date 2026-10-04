import { describe, expect, it, vi } from 'vitest';
import { PiggyvestApiError } from './client';
import {
  listBanks,
  queryTransactionStatus,
  resolveAccountName,
  transferToBank,
  transferToWallet,
} from './transfers';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    status,
  });
}

describe('transferToWallet', () => {
  it('submits the wallet leg and reports accepted, never settled', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(
          { status: true, message: 'Peer to Peer Wallet transfer processing' },
          202
        )
      );
    vi.stubGlobal('fetch', fetchMock);

    const result = await transferToWallet(
      { token: 'synthetic-token' },
      {
        amountKobo: 500000,
        sourceWalletId: 'f3ad0937-1d03-4843-b3d3-a09210967e49',
        destinationWalletId: '023f843a-be7e-494a-bc5d-9f49f4cc640f',
        reference: '7bc2dfe9-fad4-48d7-af45-87b55baca2e9',
        narration: 'Synthetic refund leg',
      }
    );

    expect(result).toEqual({ accepted: true });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/v1/transfer/wallet');
    expect(JSON.parse(init.body as string)).toMatchObject({
      amount: 500000,
      currency: 'NGN',
      reference: '7bc2dfe9-fad4-48d7-af45-87b55baca2e9',
    });
    vi.unstubAllGlobals();
  });

  it('rejects non-positive kobo amounts before any network call', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      transferToWallet(
        { token: 'synthetic-token' },
        {
          amountKobo: 0,
          sourceWalletId: 'source-wallet',
          destinationWalletId: 'destination-wallet',
          reference: 'synthetic-ref',
        }
      )
    ).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('surfaces insufficient funds as a typed provider error', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ status: false, message: 'Insufficient funds' }, 400)
        )
    );

    const error = await transferToWallet(
      { token: 'synthetic-token' },
      {
        amountKobo: 500000,
        sourceWalletId: 'source-wallet',
        destinationWalletId: 'destination-wallet',
        reference: 'synthetic-ref',
      }
    ).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(PiggyvestApiError);
    expect(error).toMatchObject({
      code: 'PIGGYVEST_REQUEST_ERROR',
      message: 'Insufficient funds',
    });
    vi.unstubAllGlobals();
  });
});

describe('transferToBank', () => {
  it('submits the bank leg with account number and bank code', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(
          { status: true, message: 'Bank transfer is processing' },
          202
        )
      );
    vi.stubGlobal('fetch', fetchMock);

    const result = await transferToBank(
      { token: 'synthetic-token' },
      {
        amountKobo: 500000,
        sourceWalletId: 'f3ad0937-1d03-4843-b3d3-a09210967e49',
        accountNumber: '0123456789',
        bankCode: '058',
        reference: '7bc2dfe9-fad4-48d7-af45-87b55baca2e9',
      }
    );

    expect(result).toEqual({ accepted: true });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({
      accountNumber: '0123456789',
      bankCode: '058',
      currency: 'NGN',
    });
    vi.unstubAllGlobals();
  });

  it('rejects non-NUBAN account numbers before any network call', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      transferToBank(
        { token: 'synthetic-token' },
        {
          amountKobo: 500000,
          sourceWalletId: 'source-wallet',
          accountNumber: '12345',
          bankCode: '058',
          reference: 'synthetic-ref',
        }
      )
    ).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe('resolveAccountName', () => {
  it('returns the provider-resolved account name for confirmation', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        status: true,
        message: 'Account name resolved',
        data: { account_name: 'SYNTHETIC NAME' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await resolveAccountName(
      { token: 'synthetic-token' },
      { bankCode: '058', accountNumber: '0123456789' }
    );

    expect(result).toEqual({ account_name: 'SYNTHETIC NAME' });
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('bank_code=058');
    expect(url).toContain('account_number=0123456789');
    vi.unstubAllGlobals();
  });
});

describe('listBanks', () => {
  it('returns bank names and codes for transfer input', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          status: true,
          message: 'Banks retrieved successfully',
          data: [
            { name: 'Access Bank', code: '044' },
            { name: 'GTBank', code: '058' },
          ],
        })
      )
    );

    const banks = await listBanks({ token: 'synthetic-token' });

    expect(banks).toEqual([
      { name: 'Access Bank', code: '044' },
      { name: 'GTBank', code: '058' },
    ]);
    vi.unstubAllGlobals();
  });
});

describe('queryTransactionStatus', () => {
  it('parses success, pending, and failed TSQ states', async () => {
    for (const status of ['success', 'pending', 'failed'] as const) {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          jsonResponse({
            status: true,
            message: 'Transaction status retrieved',
            data: {
              reference: 'PVB1234567890',
              status,
              amount: 10000,
              recipient: '0123456789',
              bank: 'GTBank',
              created_at: '2024-03-25T12:00:00Z',
            },
          })
        )
      );

      const result = await queryTransactionStatus(
        { token: 'synthetic-token' },
        { reference: 'PVB1234567890' }
      );

      expect(result.status).toBe(status);
      expect(result.amount).toBe(10000);
      vi.unstubAllGlobals();
    }
  });

  it('rejects unknown TSQ states without financial acceptance', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          status: true,
          message: 'Transaction status retrieved',
          data: {
            reference: 'PVB1234567890',
            status: 'reversed',
            amount: 10000,
            recipient: '0123456789',
            bank: 'GTBank',
            created_at: '2024-03-25T12:00:00Z',
          },
        })
      )
    );

    await expect(
      queryTransactionStatus(
        { token: 'synthetic-token' },
        { reference: 'PVB1234567890' }
      )
    ).rejects.toThrow('unexpected response shape');
    vi.unstubAllGlobals();
  });
});
