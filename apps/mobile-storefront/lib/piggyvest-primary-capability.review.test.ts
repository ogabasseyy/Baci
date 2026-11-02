import { beforeEach, expect, it, jest } from '@jest/globals';
import {
  clearPiggyvestPrimaryCapabilityCache,
  getPiggyvestPrimaryCapabilitySnapshot,
} from './piggyvest-primary-capability';
import { readObservedPiggyvestPrimaryCapability } from './piggyvest-primary-capability-cache';
import { piggyvestPrimaryWalletApi } from './piggyvest-primary-wallet';

jest.mock('./piggyvest-primary-wallet', () => ({
  piggyvestPrimaryWalletApi: { read: jest.fn(), create: jest.fn() },
}));

const read = jest.mocked(piggyvestPrimaryWalletApi.read);
const merchantId = '6b5cb8a4-5575-456c-b936-8cdfae30db74';

beforeEach(() => {
  jest.clearAllMocks();
  clearPiggyvestPrimaryCapabilityCache();
});

it.each([
  'OWNERSHIP_REVIEW_REQUIRED',
  'INTEREST_ROUTING_REVIEW_REQUIRED',
])('treats %s as primary enabled without caching an account', async (code) => {
  read.mockRejectedValue(
    Object.assign(new Error('untrusted server text'), { code })
  );

  await expect(
    getPiggyvestPrimaryCapabilitySnapshot(merchantId, 'user-a')
  ).resolves.toEqual({ available: true });

  expect(read).toHaveBeenCalledWith(merchantId, 'user-a');
  expect(readObservedPiggyvestPrimaryCapability(merchantId)).toBe(true);
});
