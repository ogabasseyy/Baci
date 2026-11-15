import {
  clearPiggyvestPrimaryCapabilityCache,
  getPiggyvestPrimaryCapability,
  isPrimaryWalletReviewRequired,
} from './piggyvest-primary-capability';
import { piggyvestPrimaryWalletApi } from './piggyvest-primary-wallet';

jest.mock('./piggyvest-primary-wallet', () => ({
  piggyvestPrimaryWalletApi: { read: jest.fn(), create: jest.fn() },
}));

const MERCHANT = '6b5cb8a4-5575-456c-b936-8cdfae30db74';

beforeEach(() => {
  jest.clearAllMocks();
  clearPiggyvestPrimaryCapabilityCache();
});

// The server keeping PiggyVest off answers PIGGYVEST_NOT_READY: the app
// takes the legacy flows and never treats the answer as a review state.
describe('server keeps PiggyVest off', () => {
  const notReady = Object.assign(new Error('not ready'), {
    code: 'PIGGYVEST_NOT_READY',
  });

  it('resolves the capability as unavailable', async () => {
    jest.mocked(piggyvestPrimaryWalletApi.read).mockRejectedValue(notReady);
    await expect(getPiggyvestPrimaryCapability(MERCHANT)).resolves.toBe(false);
  });

  it('does not report the not-ready answer as a review requirement', () => {
    expect(isPrimaryWalletReviewRequired(notReady)).toBe(false);
  });
});

describe('bugfix: re-probe a full TTL late when mounted near expiry', () => {
  it('asks the server again at the cached ruling-out real expiry', async () => {
    // Arrange: ruled out 59 s before the screen mounts.
    const { act, renderHook } = jest.requireActual<
      typeof import('@testing-library/react-native')
    >('@testing-library/react-native');
    const { usePiggyvestPrimaryCapability } = jest.requireActual<
      typeof import('./piggyvest-primary-capability')
    >('./piggyvest-primary-capability');
    const { observePiggyvestPrimaryCapability } = jest.requireActual<
      typeof import('./piggyvest-primary-capability-cache')
    >('./piggyvest-primary-capability-cache');
    jest.useFakeTimers({ now: 1_000_000 });
    const notReady = Object.assign(new Error('not ready'), {
      code: 'PIGGYVEST_NOT_READY',
    });
    jest.mocked(piggyvestPrimaryWalletApi.read).mockRejectedValue(notReady);
    observePiggyvestPrimaryCapability(MERCHANT, false);
    jest.setSystemTime(1_000_000 + 59_000);
    renderHook(() => usePiggyvestPrimaryCapability(MERCHANT));
    await act(async () => {});
    expect(piggyvestPrimaryWalletApi.read).not.toHaveBeenCalled();

    // Act: advance through the remaining second.
    await act(async () => {
      jest.advanceTimersByTime(1_100);
    });

    // Assert: a fresh verdict was requested at the real expiry.
    expect(piggyvestPrimaryWalletApi.read).toHaveBeenCalled();
    jest.useRealTimers();
  });
});
