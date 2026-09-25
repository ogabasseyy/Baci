import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockFetchWithCsrf = vi.fn();

vi.mock('@/lib/api-client', () => ({
  fetchWithCsrf: (...args: unknown[]) => mockFetchWithCsrf(...args),
}));

import {
  type JumiaOverridesState,
  saveJumiaOverrides,
} from './save-jumia-overrides';

const OVERRIDES: JumiaOverridesState = {
  price: '5000',
  salePrice: '',
  saleStart: '',
  saleEnd: '',
  isActive: true,
  syncInventory: true,
  syncPrice: false,
};

describe('saveJumiaOverrides', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves when the update succeeds', async () => {
    mockFetchWithCsrf.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true, feedIds: ['feed-1'] }),
    });

    await expect(
      saveJumiaOverrides('prod-1', 'int-1', OVERRIDES)
    ).resolves.toBeUndefined();
  });

  it('throws the server error when the update request fails', async () => {
    mockFetchWithCsrf.mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: 'Server error' }),
    });

    await expect(
      saveJumiaOverrides('prod-1', 'int-1', OVERRIDES)
    ).rejects.toThrow('Server error');
  });

  it('throws the partial-failure errors when the feed was accepted but local persistence failed', async () => {
    mockFetchWithCsrf.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          success: false,
          feedIds: ['feed-1'],
          errors: [
            'Jumia accepted the price feed but the local sale details could not be saved.',
          ],
        }),
    });

    await expect(
      saveJumiaOverrides('prod-1', 'int-1', OVERRIDES)
    ).rejects.toThrow(/accepted the price feed/);
  });
});
