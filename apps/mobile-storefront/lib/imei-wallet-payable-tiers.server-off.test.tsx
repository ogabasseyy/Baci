import {
  fetchImeiWalletPayableTiers,
  parseImeiWalletPayableTiers,
} from './imei-wallet-payable-tiers';

const reply = (status: number, body: unknown) =>
  jest.fn(async (_url: string) => ({
    ok: status < 400,
    json: async () => body,
  }));

describe('parseImeiWalletPayableTiers', () => {
  it('keeps only known tier keys, once each', () => {
    expect(
      parseImeiWalletPayableTiers({
        walletPayableTierKeys: ['basic', 'basic', 'not-a-tier'],
      })
    ).toEqual(['basic']);
  });

  it('answers null (unknown) for an older server without the list', () => {
    expect(parseImeiWalletPayableTiers({ availableTierKeys: [] })).toBeNull();
    expect(
      parseImeiWalletPayableTiers({ walletPayableTierKeys: [1] })
    ).toBeNull();
    expect(parseImeiWalletPayableTiers(null)).toBeNull();
  });
});

describe('fetchImeiWalletPayableTiers', () => {
  it('asks the capability route for the device and reads the list', async () => {
    const fetchImpl = reply(200, { walletPayableTierKeys: ['basic'] });
    await expect(
      fetchImeiWalletPayableTiers({
        device: 'smartphone',
        apiBaseUrl: 'https://api.test/',
        fetchImpl: fetchImpl as unknown as typeof fetch,
      })
    ).resolves.toEqual(['basic']);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(
      'https://api.test/api/storefront/imei-check?device=smartphone&clientCapabilities=imei-async-v1'
    );
  });

  it('throws on a failed request so the caller falls back to the app rule', async () => {
    await expect(
      fetchImeiWalletPayableTiers({
        device: 'smartphone',
        apiBaseUrl: 'https://api.test',
        fetchImpl: reply(503, {}) as unknown as typeof fetch,
      })
    ).rejects.toThrow('IMEI capability request failed');
  });
});
