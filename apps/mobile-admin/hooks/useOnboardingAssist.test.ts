import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  apiClient: vi.fn(),
}));

vi.mock('@/lib/api-client', () => ({
  apiClient: mocks.apiClient,
}));

import {
  ONBOARDING_ASSIST_TIMEOUT_MS,
  requestOnboardingAssist,
} from './useOnboardingAssist';

describe('requestOnboardingAssist', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.apiClient.mockResolvedValue({ businessNames: ['Kicks Hub'] });
  });

  it('passes an explicit timeout matching the server AI budget', async () => {
    await requestOnboardingAssist({
      task: 'generate_names',
      businessName: '',
      businessType: 'fashion',
      brandPreferences: 'modern',
      description: 'Sneakers in Lagos',
    });

    expect(mocks.apiClient).toHaveBeenCalledWith(
      '/api/mobile/onboarding-assist',
      expect.objectContaining({
        method: 'POST',
        timeout: ONBOARDING_ASSIST_TIMEOUT_MS,
      })
    );
    expect(ONBOARDING_ASSIST_TIMEOUT_MS).toBeGreaterThanOrEqual(45_000);
  });
});
