import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

const MOCK_API_BASE = 'https://kuda-openapi.kuda.com/v2.1';

/** Kuda's data answer: a plan group whose children are unreadable, next to real kobo-priced plans. */
function mockDataAnswer() {
  const validPlans = [100000, 200000, 350000, 500000, 1000000].map(
    (amount, index) => ({
      kudaIdentifier: `KUD-DAT-MTN-${index}`,
      name: `MTN Plan ${index + 1}`,
      amount,
      isFixedPrice: true,
    })
  );
  globalThis.fetch = vi.fn().mockImplementation((url) => {
    if (url.toString().includes('GetToken')) {
      return Promise.resolve({
        ok: true,
        text: () => Promise.resolve('token'),
      } as Response);
    }
    return Promise.resolve({
      ok: true,
      json: () =>
        Promise.resolve({
          status: true,
          message: 'Operation successful',
          data: {
            billers: [
              {
                id: 'mtn',
                name: 'MTN NG DATA',
                description: 'Data',
                billTypeId: 'data',
                billItems: [
                  ...validPlans,
                  {
                    kudaIdentifier: 'GRP-MONTHLY',
                    name: 'Monthly Plans',
                    amount: 0,
                    isFixedPrice: false,
                    billItems: [
                      {
                        kudaIdentifier: 'BAD-1',
                        name: '3GB',
                        amount: 'oops',
                        isFixedPrice: true,
                      },
                      {
                        kudaIdentifier: 'BAD-2',
                        name: '5GB',
                        isFixedPrice: true,
                      },
                    ],
                  },
                ],
              },
            ],
          },
        }),
    } as Response);
  });
}

describe('resolveKudaDataPlanForPurchase with an emptied plan group', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('KUDA_API_BASE_URL', MOCK_API_BASE);
    vi.stubEnv('KUDA_EMAIL', 'test@example.com');
    vi.stubEnv('KUDA_API_KEY', 'test-api-key');
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  describe('bugfix: a group whose children were all rejected was bought at any amount', () => {
    it('does not accept the submitted amount for the group code', async () => {
      const { NetworkProvider } = await import('./kuda');
      const { resolveKudaDataPlanForPurchase } = await import(
        './kuda-data-plans'
      );
      mockDataAnswer();

      await expect(
        resolveKudaDataPlanForPurchase({
          amount: 50,
          dataPlanCode: 'GRP-MONTHLY',
          networkProvider: NetworkProvider.MTN,
        })
      ).rejects.toThrow(/not found|confirm/i);
    });
  });

  it('still resolves a real plan from the same answer at its listed price', async () => {
    const { NetworkProvider } = await import('./kuda');
    const { resolveKudaDataPlanForPurchase } = await import(
      './kuda-data-plans'
    );
    mockDataAnswer();

    await expect(
      resolveKudaDataPlanForPurchase({
        amount: 1000,
        dataPlanCode: 'KUD-DAT-MTN-0',
        networkProvider: NetworkProvider.MTN,
      })
    ).resolves.toMatchObject({ amount: 1000, itemCode: 'KUD-DAT-MTN-0' });
  });
});
