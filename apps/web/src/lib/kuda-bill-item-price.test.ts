import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetBillersByCategory = vi.fn();
const mockLoggerWarn = vi.fn();
vi.mock('./kuda-bills', () => ({
  getBillersByCategory: (...args: unknown[]) =>
    mockGetBillersByCategory(...args),
}));
vi.mock('./logger', () => ({
  logger: { warn: (...args: unknown[]) => mockLoggerWarn(...args) },
}));

import {
  assertKudaBillItemPriceCurrent,
  clearKudaBillItemPriceCacheForTests,
} from './kuda-bill-item-price';
import {
  startimes,
  startimesSuper,
  superPackage,
} from './kuda-bill-item-price.test-fixtures';
import {
  KUDA_BILL_PRICE_CHANGED_MESSAGE,
  KUDA_BILL_PRICE_UNCONFIRMED_MESSAGE,
} from './kuda-bill-item-price-messages';

describe('assertKudaBillItemPriceCurrent', () => {
  beforeEach(() => {
    clearKudaBillItemPriceCacheForTests();
    mockGetBillersByCategory.mockReset();
    mockLoggerWarn.mockReset();
    mockGetBillersByCategory.mockResolvedValue([startimes()]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('bugfix: a saved 100x cable price could still be charged', () => {
    it('rejects a cable package sent at the old 100x price', async () => {
      await expect(
        assertKudaBillItemPriceCurrent({ ...superPackage, amount: 950000 })
      ).rejects.toThrow(KUDA_BILL_PRICE_CHANGED_MESSAGE);
      expect(mockGetBillersByCategory).toHaveBeenCalledWith('cable_tv', {
        addElectricityMeterItems: false,
      });
    });
  });

  it('matches item codes regardless of case and spacing', async () => {
    await expect(
      assertKudaBillItemPriceCurrent({
        ...superPackage,
        amount: 950000,
        billItemIdentifier: ' kud-cab-stt-super ',
      })
    ).rejects.toThrow(KUDA_BILL_PRICE_CHANGED_MESSAGE);
  });

  it('accepts a cable package at its current price', async () => {
    await expect(
      assertKudaBillItemPriceCurrent(superPackage)
    ).resolves.toBeUndefined();
  });

  it('rejects a package the current list no longer offers', async () => {
    await expect(
      assertKudaBillItemPriceCurrent({
        ...superPackage,
        amount: 1234,
        billItemIdentifier: 'KUD-CAB-UNKNOWN',
      })
    ).rejects.toThrow(KUDA_BILL_PRICE_CHANGED_MESSAGE);
  });

  it('lets a listed electricity meter product through a partial list', async () => {
    // Kuda answered with another biller only (e.g. cable): the meter
    // product is customer-priced, so it cannot be stale.
    await expect(
      assertKudaBillItemPriceCurrent({
        amount: 5000,
        billItemIdentifier: 'KUD-ELE-EKED-002',
        billerName: 'EKEDC NG',
        type: 'electricity',
      })
    ).resolves.toBeUndefined();
  });

  it('rejects a named biller that does not list the package', async () => {
    await expect(
      assertKudaBillItemPriceCurrent({
        ...superPackage,
        billerName: 'SOME OTHER BILLER',
      })
    ).rejects.toThrow(KUDA_BILL_PRICE_CHANGED_MESSAGE);
  });

  it('cannot confirm a fixed price that could not be read', async () => {
    mockGetBillersByCategory.mockResolvedValue([
      startimes({ billItems: [{ ...startimesSuper, amount: 0 }] }),
    ]);

    await expect(
      assertKudaBillItemPriceCurrent({ ...superPackage, amount: 950000 })
    ).rejects.toThrow(KUDA_BILL_PRICE_UNCONFIRMED_MESSAGE);
  });

  it('skips a broken duplicate listing when another confirms the price', async () => {
    mockGetBillersByCategory.mockResolvedValue([
      startimes({
        billItems: [startimesSuper, { ...startimesSuper, amount: 0 }],
      }),
    ]);

    await expect(
      assertKudaBillItemPriceCurrent({
        ...superPackage,
        billerName: 'STARTIMES NG',
      })
    ).resolves.toBeUndefined();
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({ billItemIdentifier: 'KUD-CAB-STT-SUPER' })
    );
  });

  it('prefers the exact biller name over a provider-stripped match', async () => {
    mockGetBillersByCategory.mockResolvedValue([
      startimes({ billerName: 'STARTIMES NG (Kuda)' }),
      startimes({
        billerId: 'startimes-monnify',
        billerName: 'STARTIMES NG (Monnify)',
        billItems: [{ ...startimesSuper, amount: 9000 }],
      }),
    ]);

    await expect(
      assertKudaBillItemPriceCurrent({
        ...superPackage,
        billerName: 'STARTIMES NG (Monnify)',
      })
    ).rejects.toThrow(KUDA_BILL_PRICE_CHANGED_MESSAGE);
  });

  it('cannot confirm an implausibly low fixed price', async () => {
    mockGetBillersByCategory.mockResolvedValue([
      startimes({ billItems: [{ ...startimesSuper, amount: 5 }] }),
    ]);

    await expect(
      assertKudaBillItemPriceCurrent({ ...superPackage, amount: 5 })
    ).rejects.toThrow(KUDA_BILL_PRICE_UNCONFIRMED_MESSAGE);
  });

  it('lets open-amount items through at any amount', async () => {
    mockGetBillersByCategory.mockResolvedValue([
      startimes({
        billItems: [
          {
            ...startimesSuper,
            amount: 0,
            isAmountFixed: false,
            itemCode: 'KUD-ELE-EKED-002',
          },
        ],
      }),
    ]);

    await expect(
      assertKudaBillItemPriceCurrent({
        amount: 5000,
        billItemIdentifier: 'KUD-ELE-EKED-002',
        type: 'electricity',
      })
    ).resolves.toBeUndefined();
  });

  it('checks fixed-price items of any bill type', async () => {
    mockGetBillersByCategory.mockResolvedValue([
      startimes({ billItems: [{ ...startimesSuper, itemCode: 'KUD-BET-1' }] }),
    ]);

    await expect(
      assertKudaBillItemPriceCurrent({
        amount: 950000,
        billItemIdentifier: 'KUD-BET-1',
        type: 'betting',
      })
    ).rejects.toThrow(KUDA_BILL_PRICE_CHANGED_MESSAGE);
  });

  describe('when several billers list the item', () => {
    beforeEach(() => {
      mockGetBillersByCategory.mockResolvedValue([
        startimes({ billerName: 'STARTIMES NG (Kuda)' }),
        startimes({
          billerId: 'startimes-2',
          billerName: 'STARTIMES PLUS',
          billItems: [{ ...startimesSuper, amount: 9000 }],
        }),
      ]);
    });

    it('checks the chosen biller, matched as the billers list showed it', async () => {
      await expect(
        assertKudaBillItemPriceCurrent({
          ...superPackage,
          billerName: '  startimes ng - Group / DTT super monthly 9500NGN ',
        })
      ).resolves.toBeUndefined();
      await expect(
        assertKudaBillItemPriceCurrent({
          ...superPackage,
          amount: 9000,
          billerName: 'STARTIMES NG',
        })
      ).rejects.toThrow(KUDA_BILL_PRICE_CHANGED_MESSAGE);
    });

    it('accepts the chosen biller when any of its listings matches', async () => {
      mockGetBillersByCategory.mockResolvedValue([
        startimes({
          billItems: [startimesSuper, { ...startimesSuper, amount: 9900 }],
        }),
      ]);

      await expect(
        assertKudaBillItemPriceCurrent({
          ...superPackage,
          billerName: 'STARTIMES NG',
        })
      ).resolves.toBeUndefined();
    });

    it('requires every listing to agree when no biller is named', async () => {
      await expect(
        assertKudaBillItemPriceCurrent({ ...superPackage, amount: 9000 })
      ).rejects.toThrow(KUDA_BILL_PRICE_CHANGED_MESSAGE);
      await expect(
        assertKudaBillItemPriceCurrent({ ...superPackage, amount: 950000 })
      ).rejects.toThrow(KUDA_BILL_PRICE_CHANGED_MESSAGE);
    });
  });

  it('reuses the price list for a minute', async () => {
    await assertKudaBillItemPriceCurrent(superPackage);
    await assertKudaBillItemPriceCurrent(superPackage);

    expect(mockGetBillersByCategory).toHaveBeenCalledTimes(1);
  });
});
