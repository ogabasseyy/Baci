import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockPurgeStorefrontHostnameConfirmed = vi.fn();
const mockScheduleStorefrontHostnamePurge = vi.fn();

vi.mock('@/lib/storefront-product-purge-hostnames', () => ({
  purgeStorefrontHostnameConfirmed: (...args: unknown[]) =>
    mockPurgeStorefrontHostnameConfirmed(...args),
  scheduleStorefrontHostnamePurge: (...args: unknown[]) =>
    mockScheduleStorefrontHostnamePurge(...args),
}));

import { dispatchStorefrontHostnamePurge } from './dispatch-storefront-hostname-purge';

describe('dispatchStorefrontHostnamePurge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('awaits confirmed hostname purge when confirmEdgeEviction is true', async () => {
    mockPurgeStorefrontHostnameConfirmed
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    await expect(
      dispatchStorefrontHostnamePurge('ogabassey', true)
    ).resolves.toBe(true);
    await expect(
      dispatchStorefrontHostnamePurge('ogabassey', true)
    ).resolves.toBe(false);

    expect(mockPurgeStorefrontHostnameConfirmed).toHaveBeenCalledTimes(2);
    expect(mockScheduleStorefrontHostnamePurge).not.toHaveBeenCalled();
  });

  it('schedules fire-and-forget hostname purge when confirmEdgeEviction is false', async () => {
    await expect(
      dispatchStorefrontHostnamePurge('ogabassey', false)
    ).resolves.toBe(false);

    expect(mockScheduleStorefrontHostnamePurge).toHaveBeenCalledWith(
      'ogabassey'
    );
    expect(mockPurgeStorefrontHostnameConfirmed).not.toHaveBeenCalled();
  });
});
