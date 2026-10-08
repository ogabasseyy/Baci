import {
  clearPiggyvestPrimaryCapabilityCache,
  getPiggyvestPrimaryCapability,
  isPrimaryWalletNotReady,
} from './piggyvest-primary-capability';
import { piggyvestPrimaryWalletApi } from './piggyvest-primary-wallet';

jest.mock('./piggyvest-primary-wallet', () => ({
  piggyvestPrimaryWalletApi: { read: jest.fn(), create: jest.fn() },
}));

const PRIMARY_MERCHANT = '6b5cb8a4-5575-456c-b936-8cdfae30db74';
const read = piggyvestPrimaryWalletApi.read as jest.Mock;

function notReady(code: string) {
  return Object.assign(new Error('not ready'), { code });
}

beforeEach(() => {
  jest.clearAllMocks();
  clearPiggyvestPrimaryCapabilityCache();
});

describe('isPrimaryWalletNotReady', () => {
  it.each([
    'PIGGYVEST_NOT_READY',
    'PRIMARY_CARD_NOT_READY',
    'SAVINGS_NOT_READY',
  ])('recognizes the %s capability signal', (code) => {
    expect(isPrimaryWalletNotReady(notReady(code))).toBe(true);
  });

  it('rejects transient and foreign failures', () => {
    expect(isPrimaryWalletNotReady(new Error('boom'))).toBe(false);
    expect(isPrimaryWalletNotReady(notReady('PRIMARY_CARD_UNAVAILABLE'))).toBe(
      false
    );
    expect(isPrimaryWalletNotReady(notReady('SAVINGS_UNAVAILABLE'))).toBe(
      false
    );
    expect(isPrimaryWalletNotReady(null)).toBe(false);
    expect(isPrimaryWalletNotReady({ code: 503 })).toBe(false);
  });
});

describe('getPiggyvestPrimaryCapability', () => {
  it('returns false without a probe for non-primary merchants', async () => {
    await expect(
      getPiggyvestPrimaryCapability('00000000-0000-4000-8000-000000000000')
    ).resolves.toBe(false);
    expect(read).not.toHaveBeenCalled();
  });

  it('returns true when the server snapshot loads', async () => {
    read.mockResolvedValue({ account: null });
    await expect(getPiggyvestPrimaryCapability(PRIMARY_MERCHANT)).resolves.toBe(
      true
    );
  });

  it('returns false only on the explicit not-ready signal', async () => {
    read.mockRejectedValue(notReady('PIGGYVEST_NOT_READY'));
    await expect(getPiggyvestPrimaryCapability(PRIMARY_MERCHANT)).resolves.toBe(
      false
    );
  });

  it('rethrows ambiguous failures instead of misrouting money', async () => {
    read.mockRejectedValue(new Error('timeout'));
    await expect(
      getPiggyvestPrimaryCapability(PRIMARY_MERCHANT)
    ).rejects.toThrow('timeout');
    read.mockRejectedValue(notReady('PRIMARY_CARD_UNAVAILABLE'));
    await expect(
      getPiggyvestPrimaryCapability(PRIMARY_MERCHANT)
    ).rejects.toMatchObject({ code: 'PRIMARY_CARD_UNAVAILABLE' });
  });

  it('dedupes concurrent probes and caches the verdict', async () => {
    read.mockResolvedValue({ account: null });
    const [first, second] = await Promise.all([
      getPiggyvestPrimaryCapability(PRIMARY_MERCHANT),
      getPiggyvestPrimaryCapability(PRIMARY_MERCHANT),
    ]);
    expect(first).toBe(true);
    expect(second).toBe(true);
    expect(read).toHaveBeenCalledTimes(1);
    await getPiggyvestPrimaryCapability(PRIMARY_MERCHANT);
    expect(read).toHaveBeenCalledTimes(1);
  });
});
