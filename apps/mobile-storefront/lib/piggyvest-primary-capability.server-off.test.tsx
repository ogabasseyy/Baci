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
