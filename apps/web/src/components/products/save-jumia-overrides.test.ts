import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockFetchWithCsrf = vi.fn();

vi.mock('@/lib/api-client', () => ({
  fetchWithCsrf: (...args: unknown[]) => mockFetchWithCsrf(...args),
}));

import {
  getJumiaSaveErrorMessage,
  type JumiaOverridesState,
  JumiaPartialUpdateError,
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

  it('throws a structured partial error carrying the accepted feed ids', async () => {
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

    const failure = await saveJumiaOverrides(
      'prod-1',
      'int-1',
      OVERRIDES
    ).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(JumiaPartialUpdateError);
    expect((failure as JumiaPartialUpdateError).feedIds).toEqual(['feed-1']);
    expect((failure as Error).message).toMatch(/accepted the price feed/);
  });
});

describe('getJumiaSaveErrorMessage', () => {
  it('appends the accepted feed ids for partial failures', () => {
    expect(
      getJumiaSaveErrorMessage(
        new JumiaPartialUpdateError('Local save failed.', ['feed-1', 'feed-2'])
      )
    ).toBe('Local save failed. (Jumia feed: feed-1, feed-2)');
  });

  it('omits the feed suffix when no ids were returned', () => {
    expect(
      getJumiaSaveErrorMessage(new JumiaPartialUpdateError('Failed.', []))
    ).toBe('Failed.');
  });

  it('passes through generic errors and unknown values', () => {
    expect(getJumiaSaveErrorMessage(new Error('Server error'))).toBe(
      'Server error'
    );
    expect(getJumiaSaveErrorMessage(null)).toBe('Unknown error');
  });
});
