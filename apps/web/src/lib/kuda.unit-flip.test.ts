import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

const MOCK_API_BASE = 'https://kuda-openapi.kuda.com/v2.1';

function mockBillersResponse(
  billers: Array<{ name: string; billItems: unknown[] }>
) {
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
            billers: billers.map(({ name, billItems }) => ({
              id: name.toLowerCase(),
              name,
              description: 'Data',
              billTypeId: 'data',
              billItems,
            })),
          },
        }),
    } as Response);
  });
}

/** Plans with unnamed prices ("1GB Monthly Plan"), as Kuda sends them. */
function unnamedPlans(prefix: string, amounts: number[]) {
  return amounts.map((amount, index) => ({
    kudaIdentifier: `KUD-${prefix}-${index}`,
    name: `${index + 1}GB Monthly Plan`,
    amount,
    isFixedPrice: true,
  }));
}

const CHEAP_NAIRA = [100, 200, 500, 1000, 1500];
const DEAR_NAIRA = [3500, 6000, 8500, 12000, 15000];
const inKobo = (naira: number[]) => naira.map((n) => n * 100);

describe('getBillersByType unit check', () => {
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

  describe('bugfix: a naira-priced answer with unnamed plans was sold 100x too cheap', () => {
    it('refuses the whole answer when Kuda sends unnamed plan prices in naira', async () => {
      const { getBillersByType } = await import('./kuda');
      // "1GB Monthly Plan" arriving as 1000 would be read as kobo (₦10).
      mockBillersResponse([
        {
          name: 'MTN NG DATA',
          billItems: unnamedPlans('MTN', [...CHEAP_NAIRA, ...DEAR_NAIRA]),
        },
      ]);

      await expect(getBillersByType('Internet Data')).rejects.toThrow(
        'Bill prices could not be confirmed as kobo'
      );
    });

    it('refuses billers that have no cheap plan of their own once the answer is in naira', async () => {
      const { getBillersByType } = await import('./kuda');
      // DSTV-like biller: every price is at least raw 3500 (₦35 as kobo), so
      // no per-list guard flags it; the cheap biller next to it gives the
      // unit away for the whole answer.
      mockBillersResponse([
        { name: 'CHEAP NG', billItems: unnamedPlans('CHP', CHEAP_NAIRA) },
        { name: 'DSTV', billItems: unnamedPlans('DST', DEAR_NAIRA) },
      ]);

      await expect(getBillersByType('CableTv')).rejects.toThrow(
        'Bill prices could not be confirmed as kobo'
      );
    });
  });

  describe('bugfix: a small naira-priced answer passed as kobo', () => {
    it('refuses an answer with only a few fixed prices, whose unit cannot be told', async () => {
      const { getBillersByType } = await import('./kuda');
      // One package whose real price is ₦5000, sent as 5000: read as kobo it
      // is ₦50, above the purchase floor, so only its size gives it away.
      mockBillersResponse([
        { name: 'STAKE NG', billItems: unnamedPlans('STK', [5000, 10000]) },
      ]);

      await expect(getBillersByType('CableTv')).rejects.toThrow(
        'Bill prices could not be confirmed as kobo'
      );
    });

    it('still serves open-amount items, however few, including electricity meter items', async () => {
      const { getBillersByType } = await import('./kuda');
      mockBillersResponse([
        {
          name: 'EKEDC NG',
          billItems: [
            {
              kudaIdentifier: 'KUD-ELE-EKED-002',
              name: 'EKEDC PREPAID',
              amount: 0,
              isFixedPrice: false,
            },
            {
              kudaIdentifier: 'KUD-ELE-EKED-001',
              name: 'EKEDC POSTPAID',
              amount: 0,
              isFixedPrice: false,
            },
          ],
        },
      ]);

      const [biller] = await getBillersByType('Electricity');

      expect(biller.billItems?.map((item) => item.itemCode)).toEqual([
        'KUD-ELE-EKED-002',
        'KUD-ELE-EKED-001',
      ]);
    });
  });

  it('returns kobo-priced plans converted to naira', async () => {
    const { getBillersByType } = await import('./kuda');
    mockBillersResponse([
      { name: 'CHEAP NG', billItems: unnamedPlans('CHP', inKobo(CHEAP_NAIRA)) },
      { name: 'DSTV', billItems: unnamedPlans('DST', inKobo(DEAR_NAIRA)) },
    ]);

    const billers = await getBillersByType('CableTv');

    expect(billers.map((b) => b.billItems?.map((i) => i.amount))).toEqual([
      CHEAP_NAIRA,
      DEAR_NAIRA,
    ]);
  });
});
