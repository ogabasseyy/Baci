import { act, renderHook, waitFor } from '@testing-library/react-native';
import {
  clearPiggyvestPrimaryCapabilityCache,
  getPiggyvestPrimaryCapability,
  isPrimaryWalletNotReady,
  rollbackObservedCapabilityOnNotReady,
  usePiggyvestPrimaryCapability,
} from './piggyvest-primary-capability';
import {
  NEGATIVE_CAPABILITY_TTL_MS,
  readObservedPiggyvestPrimaryCapability,
} from './piggyvest-primary-capability-cache';
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
  it('asks the server for non-pilot merchants and honors its not-ready verdict', async () => {
    read.mockRejectedValue(notReady('PIGGYVEST_NOT_READY'));
    await expect(
      getPiggyvestPrimaryCapability('00000000-0000-4000-8000-000000000000')
    ).resolves.toBe(false);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('enables server-driven rollout when a non-pilot merchant snapshot loads', async () => {
    read.mockResolvedValue({ account: null });
    await expect(
      getPiggyvestPrimaryCapability('00000000-0000-4000-8000-000000000000')
    ).resolves.toBe(true);
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

  it('resolves feature-scoped not-ready once without caching it', async () => {
    read.mockRejectedValueOnce(notReady('SAVINGS_NOT_READY'));
    await expect(
      getPiggyvestPrimaryCapability('00000000-0000-4000-8000-000000000000')
    ).resolves.toBe(false);
    expect(
      readObservedPiggyvestPrimaryCapability(
        '00000000-0000-4000-8000-000000000000'
      )
    ).toBeNull();
    read.mockResolvedValue({ account: null });
    await expect(
      getPiggyvestPrimaryCapability('00000000-0000-4000-8000-000000000000')
    ).resolves.toBe(true);
    expect(read).toHaveBeenCalledTimes(2);
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

describe('rollbackObservedCapabilityOnNotReady', () => {
  it('rolls back a cached positive verdict when authoritative NOT_READY arrives off-probe', async () => {
    read.mockResolvedValue({ account: null });
    await expect(getPiggyvestPrimaryCapability(PRIMARY_MERCHANT)).resolves.toBe(
      true
    );
    expect(read).toHaveBeenCalledTimes(1);
    expect(
      rollbackObservedCapabilityOnNotReady(
        PRIMARY_MERCHANT,
        notReady('PIGGYVEST_NOT_READY')
      )
    ).toBe(true);
    expect(readObservedPiggyvestPrimaryCapability(PRIMARY_MERCHANT)).toBe(
      false
    );
    // The rolled-back negative fails closed without re-probing the server.
    await expect(getPiggyvestPrimaryCapability(PRIMARY_MERCHANT)).resolves.toBe(
      false
    );
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('falls back once on feature-scoped codes without poisoning the shared cache', async () => {
    read.mockResolvedValue({ account: null });
    await expect(getPiggyvestPrimaryCapability(PRIMARY_MERCHANT)).resolves.toBe(
      true
    );
    expect(
      rollbackObservedCapabilityOnNotReady(
        PRIMARY_MERCHANT,
        notReady('SAVINGS_NOT_READY')
      )
    ).toBe(true);
    expect(
      rollbackObservedCapabilityOnNotReady(
        PRIMARY_MERCHANT,
        notReady('PRIMARY_CARD_NOT_READY')
      )
    ).toBe(true);
    // The shared positive verdict survives: a card-only outage must not
    // reroute savings (or vice versa).
    expect(readObservedPiggyvestPrimaryCapability(PRIMARY_MERCHANT)).toBe(true);
    await expect(getPiggyvestPrimaryCapability(PRIMARY_MERCHANT)).resolves.toBe(
      true
    );
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('leaves the cache untouched for transient and foreign failures', async () => {
    read.mockResolvedValue({ account: null });
    await expect(getPiggyvestPrimaryCapability(PRIMARY_MERCHANT)).resolves.toBe(
      true
    );
    expect(
      rollbackObservedCapabilityOnNotReady(PRIMARY_MERCHANT, new Error('boom'))
    ).toBe(false);
    expect(
      rollbackObservedCapabilityOnNotReady(
        PRIMARY_MERCHANT,
        notReady('PRIMARY_CARD_UNAVAILABLE')
      )
    ).toBe(false);
    expect(readObservedPiggyvestPrimaryCapability(PRIMARY_MERCHANT)).toBe(true);
  });

  it('still reports authoritative NOT_READY when the merchant scope is unknown', () => {
    expect(
      rollbackObservedCapabilityOnNotReady(null, notReady('SAVINGS_NOT_READY'))
    ).toBe(true);
    expect(
      rollbackObservedCapabilityOnNotReady(
        undefined,
        notReady('SAVINGS_NOT_READY')
      )
    ).toBe(true);
  });
});

describe('usePiggyvestPrimaryCapability', () => {
  const OTHER_MERCHANT = '00000000-0000-4000-8000-000000000000';

  it('fails open while the pilot probe is unknown, then follows the server', async () => {
    read.mockResolvedValue({ account: null });
    const { result } = renderHook(() =>
      usePiggyvestPrimaryCapability(PRIMARY_MERCHANT)
    );
    expect(result.current).toBeNull();
    await waitFor(() => expect(result.current).toBe(true));
  });

  it('fails closed for non-pilot merchants until the server confirms primary', async () => {
    read.mockResolvedValue({ account: null });
    const { result } = renderHook(() =>
      usePiggyvestPrimaryCapability(OTHER_MERCHANT)
    );
    expect(result.current).toBe(false);
    await waitFor(() => expect(result.current).toBe(true));
  });

  it('keeps non-pilot merchants on legacy when the server reports not-ready', async () => {
    read.mockRejectedValue(notReady('PIGGYVEST_NOT_READY'));
    const { result } = renderHook(() =>
      usePiggyvestPrimaryCapability(OTHER_MERCHANT)
    );
    expect(result.current).toBe(false);
    await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    expect(result.current).toBe(false);
  });

  it('stays unknown on ambiguous probe failure and reprobes instead of enabling legacy', async () => {
    jest.useFakeTimers();
    try {
      read.mockRejectedValueOnce(new Error('timeout'));
      const { result } = renderHook(() =>
        usePiggyvestPrimaryCapability(OTHER_MERCHANT)
      );
      await act(async () => {});
      expect(read).toHaveBeenCalledTimes(1);
      // Unknown, not false: consumers must wait for a confirmed verdict
      // rather than routing money through legacy on a timeout.
      expect(result.current).toBeNull();
      read.mockResolvedValue({ account: null });
      await act(async () => {
        await jest.advanceTimersByTimeAsync(NEGATIVE_CAPABILITY_TTL_MS);
      });
      expect(read).toHaveBeenCalledTimes(2);
      expect(result.current).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it('reprobes a mounted screen after the negative verdict expires', async () => {
    jest.useFakeTimers();
    try {
      read.mockRejectedValueOnce(notReady('PIGGYVEST_NOT_READY'));
      const { result } = renderHook(() =>
        usePiggyvestPrimaryCapability(OTHER_MERCHANT)
      );
      await act(async () => {});
      expect(result.current).toBe(false);
      expect(read).toHaveBeenCalledTimes(1);
      read.mockResolvedValue({ account: null });
      await act(async () => {
        await jest.advanceTimersByTimeAsync(NEGATIVE_CAPABILITY_TTL_MS);
      });
      expect(read).toHaveBeenCalledTimes(2);
      expect(result.current).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });
});
