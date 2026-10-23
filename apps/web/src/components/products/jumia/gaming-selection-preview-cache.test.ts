import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { gamingSelectionPreviewCache } from './gaming-selection-preview-cache';

describe('Gaming selection preview cache helpers', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('reads an unexpired selection', () => {
    localStorage.setItem(
      'jumia-gaming-preview:merchant-1:category-1',
      JSON.stringify({
        selectionId: 'd1ef9f3a-4f2b-49af-a84f-97d19c0084bd',
        expiresAt: '2099-01-01T00:00:00.000Z',
      })
    );

    expect(
      gamingSelectionPreviewCache.read(
        'jumia-gaming-preview:merchant-1:category-1'
      )
    ).toEqual({
      selectionId: 'd1ef9f3a-4f2b-49af-a84f-97d19c0084bd',
      expiresAt: '2099-01-01T00:00:00.000Z',
    });
  });

  it('prefers a newly cached selection when storage writes fail but reads work', () => {
    const key = 'jumia-gaming-preview:merchant-refresh:category-1';
    const oldSelection = {
      selectionId: 'd1ef9f3a-4f2b-49af-a84f-97d19c0084bd',
      expiresAt: '2099-01-01T00:00:00.000Z',
    };
    const refreshedSelection = {
      selectionId: 'c5a0eb5e-ecc7-4142-ae9b-d7186c3d5c0b',
      expiresAt: '2099-02-01T00:00:00.000Z',
    };
    localStorage.setItem(key, JSON.stringify(oldSelection));
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage quota exceeded');
    });

    gamingSelectionPreviewCache.write(key, refreshedSelection);

    expect(gamingSelectionPreviewCache.read(key)).toEqual(refreshedSelection);
    expect(localStorage.getItem(key)).toBe(JSON.stringify(oldSelection));
  });

  it('builds a category cache key through the cache facade', () => {
    expect(gamingSelectionPreviewCache.key('merchant-1', 'category-1')).toBe(
      'jumia-gaming-preview:merchant-1:category-1'
    );
  });

  it('persists and clears the uncertain-creation guard for a merchant', () => {
    expect(gamingSelectionPreviewCache.hasUncertainCreation('merchant-1')).toBe(
      false
    );

    gamingSelectionPreviewCache.markUncertainCreation('merchant-1');

    expect(gamingSelectionPreviewCache.hasUncertainCreation('merchant-1')).toBe(
      true
    );
    gamingSelectionPreviewCache.clearUncertainCreation('merchant-1');
    expect(gamingSelectionPreviewCache.hasUncertainCreation('merchant-1')).toBe(
      false
    );
  });

  it('retains the uncertain-creation guard in memory when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });

    gamingSelectionPreviewCache.markUncertainCreation('merchant-memory');

    expect(
      gamingSelectionPreviewCache.hasUncertainCreation('merchant-memory')
    ).toBe(true);
    gamingSelectionPreviewCache.clearUncertainCreation('merchant-memory');
    expect(
      gamingSelectionPreviewCache.hasUncertainCreation('merchant-memory')
    ).toBe(false);
  });

  it('shares and releases an in-flight creation guard by merchant', async () => {
    const finish = gamingSelectionPreviewCache.beginCreation('merchant-flight');
    expect(finish).not.toBeNull();
    expect(
      gamingSelectionPreviewCache.beginCreation('merchant-flight')
    ).toBeNull();
    expect(
      gamingSelectionPreviewCache.hasCreationInFlight('merchant-flight')
    ).toBe(true);

    finish?.();

    expect(
      gamingSelectionPreviewCache.hasCreationInFlight('merchant-flight')
    ).toBe(false);
    const nextFinish =
      gamingSelectionPreviewCache.beginCreation('merchant-flight');
    expect(nextFinish).not.toBeNull();
    nextFinish?.();
  });

  it('preserves a live cross-tab creation lease without exposing a retry', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-23T12:00:00.000Z'));
    const key = 'jumia-gaming-preview-uncertain:merchant-cross-tab';
    localStorage.setItem(key, `in-flight:${Date.now() + 60_000}`);

    expect(
      gamingSelectionPreviewCache.hasUncertainCreation('merchant-cross-tab')
    ).toBe(false);
    expect(
      gamingSelectionPreviewCache.hasCreationInFlight('merchant-cross-tab')
    ).toBe(true);
    expect(localStorage.getItem(key)).toBe(`in-flight:${Date.now() + 60_000}`);
    expect(
      gamingSelectionPreviewCache.beginCreation('merchant-cross-tab')
    ).toBeNull();
  });

  it('renews the active tab lease until its request completes', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-23T12:00:00.000Z'));
    const key = 'jumia-gaming-preview-uncertain:merchant-renewed';
    const finish =
      gamingSelectionPreviewCache.beginCreation('merchant-renewed');
    const initialLease = Number(localStorage.getItem(key)?.slice(10));

    vi.advanceTimersByTime(30_000);

    const renewedLease = Number(localStorage.getItem(key)?.slice(10));
    expect(renewedLease).toBeGreaterThan(initialLease);
    expect(
      gamingSelectionPreviewCache.hasCreationInFlight('merchant-renewed')
    ).toBe(true);
    finish?.();
    expect(localStorage.getItem(key)).toBeNull();
  });

  it('recovers an expired cross-tab creation lease as uncertain', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-23T12:00:00.000Z'));
    const key = 'jumia-gaming-preview-uncertain:merchant-expired-lease';
    localStorage.setItem(key, `in-flight:${Date.now() - 1}`);

    expect(
      gamingSelectionPreviewCache.hasCreationInFlight('merchant-expired-lease')
    ).toBe(false);
    expect(
      gamingSelectionPreviewCache.hasUncertainCreation('merchant-expired-lease')
    ).toBe(true);
    expect(localStorage.getItem(key)).toBe('pending');
  });

  it.each([
    ['malformed JSON', '{'],
    [
      'missing expiry',
      JSON.stringify({ selectionId: 'd1ef9f3a-4f2b-49af-a84f-97d19c0084bd' }),
    ],
    [
      'invalid expiry',
      JSON.stringify({
        selectionId: 'd1ef9f3a-4f2b-49af-a84f-97d19c0084bd',
        expiresAt: 'not-a-date',
      }),
    ],
  ])('removes %s entries', (_label, value) => {
    const key = 'jumia-gaming-preview:merchant-1:category-1';
    localStorage.setItem(key, value);

    expect(gamingSelectionPreviewCache.read(key)).toBeNull();
    expect(localStorage.getItem(key)).toBeNull();
  });

  it('keeps a server-valid selection when the client clock is ahead of expiry', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2040-01-01T00:00:00.000Z'));
    const key = 'jumia-gaming-preview:merchant-1:category-1';
    const selection = {
      selectionId: 'd1ef9f3a-4f2b-49af-a84f-97d19c0084bd',
      expiresAt: '2039-12-31T23:59:59.000Z',
    };
    localStorage.setItem(key, JSON.stringify(selection));

    expect(gamingSelectionPreviewCache.read(key)).toEqual(selection);
    expect(localStorage.getItem(key)).toBe(JSON.stringify(selection));
  });

  it.each([
    '',
    'not-a-uuid',
  ])('removes a cached entry with invalid ID %j', (id) => {
    const key = 'jumia-gaming-preview:merchant-1:category-1';
    localStorage.setItem(
      key,
      JSON.stringify({
        selectionId: id,
        expiresAt: '2099-01-01T00:00:00.000Z',
      })
    );

    expect(gamingSelectionPreviewCache.read(key)).toBeNull();
    expect(localStorage.getItem(key)).toBeNull();
  });

  it('finds a cached selection for the merchant independent of category ID', () => {
    const key = 'jumia-gaming-preview:merchant-1:inactive-category';
    localStorage.setItem(
      key,
      JSON.stringify({
        selectionId: 'd1ef9f3a-4f2b-49af-a84f-97d19c0084bd',
        expiresAt: '2099-01-01T00:00:00.000Z',
      })
    );

    expect(gamingSelectionPreviewCache.find('merchant-1')).toEqual({
      cacheKey: key,
      selection: {
        selectionId: 'd1ef9f3a-4f2b-49af-a84f-97d19c0084bd',
        expiresAt: '2099-01-01T00:00:00.000Z',
      },
    });
    expect(gamingSelectionPreviewCache.find('merchant-2')).toBeNull();
  });

  it('continues to the next snapshot after the server rejects an expired one', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2100-01-01T00:00:00.000Z'));
    const expiredKey = 'jumia-gaming-preview:merchant-1:expired-category';
    localStorage.setItem(
      expiredKey,
      JSON.stringify({
        selectionId: '2b2c50d8-40b7-44b1-9054-f7fa6d96ce20',
        expiresAt: '2099-02-01T00:00:00.000Z',
      })
    );
    const validKey = 'jumia-gaming-preview:merchant-1:valid-category';
    localStorage.setItem(
      validKey,
      JSON.stringify({
        selectionId: 'd1ef9f3a-4f2b-49af-a84f-97d19c0084bd',
        expiresAt: '2099-01-01T00:00:00.000Z',
      })
    );

    const load = vi.fn(async (selectionId: string) => {
      if (selectionId === '2b2c50d8-40b7-44b1-9054-f7fa6d96ce20') {
        throw gamingSelectionPreviewCache.makeRequestError(410, 'expired');
      }
    });

    await expect(
      gamingSelectionPreviewCache.loadFirstValid('merchant-1', load)
    ).resolves.toBe(true);
    expect(load).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem(expiredKey)).toBeNull();
    expect(gamingSelectionPreviewCache.find('merchant-1')).toEqual({
      cacheKey: validKey,
      selection: {
        selectionId: 'd1ef9f3a-4f2b-49af-a84f-97d19c0084bd',
        expiresAt: '2099-01-01T00:00:00.000Z',
      },
    });
  });

  it('keeps a cached snapshot after an ambiguous access-related 404', async () => {
    const key = 'jumia-gaming-preview:merchant-1:category-404';
    const selection = {
      selectionId: 'd1ef9f3a-4f2b-49af-a84f-97d19c0084bd',
      expiresAt: '2099-01-01T00:00:00.000Z',
    };
    localStorage.setItem(key, JSON.stringify(selection));
    const load = vi.fn(async () => {
      throw gamingSelectionPreviewCache.makeRequestError(
        404,
        'Unable to load this Gaming preview. Please retry.'
      );
    });

    await expect(
      gamingSelectionPreviewCache.loadFirstValid('merchant-1', load)
    ).rejects.toMatchObject({ status: 404 });

    expect(localStorage.getItem(key)).toBe(JSON.stringify(selection));
  });

  it('chooses the newest merchant snapshot for server validation', () => {
    localStorage.setItem(
      'jumia-gaming-preview:merchant-1:older-category',
      JSON.stringify({
        selectionId: 'd1ef9f3a-4f2b-49af-a84f-97d19c0084bd',
        expiresAt: '2099-01-01T00:00:00.000Z',
      })
    );
    const newestKey = 'jumia-gaming-preview:merchant-1:newer-category';
    localStorage.setItem(
      newestKey,
      JSON.stringify({
        selectionId: 'c5a0eb5e-ecc7-4142-ae9b-d7186c3d5c0b',
        expiresAt: '2099-02-01T00:00:00.000Z',
      })
    );

    expect(gamingSelectionPreviewCache.find('merchant-1')).toMatchObject({
      cacheKey: newestKey,
      selection: { selectionId: 'c5a0eb5e-ecc7-4142-ae9b-d7186c3d5c0b' },
    });
  });

  it('removes a rejected selection', () => {
    const key = 'jumia-gaming-preview:merchant-1:category-1';
    localStorage.setItem(key, '{}');

    gamingSelectionPreviewCache.remove(key);

    expect(localStorage.getItem(key)).toBeNull();
  });
});
