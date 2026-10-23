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

  it('clears an uncertain retry guard when another tab completes creation', () => {
    const merchantId = 'merchant-cross-tab-retry';
    const key = `jumia-gaming-preview-uncertain:${merchantId}`;
    gamingSelectionPreviewCache.markUncertainCreation(merchantId);
    expect(gamingSelectionPreviewCache.hasUncertainCreation(merchantId)).toBe(
      true
    );

    localStorage.removeItem(key);
    window.dispatchEvent(new StorageEvent('storage', { key, newValue: null }));

    expect(gamingSelectionPreviewCache.hasUncertainCreation(merchantId)).toBe(
      false
    );
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
    const initialLease = Number(
      localStorage.getItem(key)?.slice(10).split(':', 1)[0]
    );

    vi.advanceTimersByTime(30_000);

    const renewedLease = Number(
      localStorage.getItem(key)?.slice(10).split(':', 1)[0]
    );
    expect(renewedLease).toBeGreaterThan(initialLease);
    expect(
      gamingSelectionPreviewCache.hasCreationInFlight('merchant-renewed')
    ).toBe(true);
    finish?.();
    expect(localStorage.getItem(key)).toBeNull();
  });

  it('does not overwrite a newer cross-tab lease when a stale request resumes', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-23T12:00:00.000Z'));
    const merchantId = 'merchant-lease-recovery';
    const key = `jumia-gaming-preview-uncertain:${merchantId}`;
    const finishOriginal =
      gamingSelectionPreviewCache.beginCreation(merchantId);
    expect(finishOriginal).not.toBeNull();

    localStorage.setItem(key, 'in-flight:0:expired-owner');
    vi.resetModules();
    const { gamingSelectionPreviewCache: recoveredTabCache } = await import(
      './gaming-selection-preview-cache'
    );
    const finishRecovered = recoveredTabCache.beginCreation(merchantId);
    const recoveredLease = localStorage.getItem(key);
    const recoveredToken = recoveredLease?.split(':')[2];
    expect(finishRecovered).not.toBeNull();

    vi.advanceTimersByTime(30_000);
    finishOriginal?.();

    expect(localStorage.getItem(key)?.split(':')[2]).toBe(recoveredToken);
    finishRecovered?.();
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
});
