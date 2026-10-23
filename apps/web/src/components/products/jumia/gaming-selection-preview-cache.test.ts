import { beforeEach, describe, expect, it } from 'vitest';
import { gamingSelectionPreviewCache } from './gaming-selection-preview-cache';

describe('Gaming selection preview cache helpers', () => {
  beforeEach(() => localStorage.clear());

  it('reads an unexpired selection', () => {
    localStorage.setItem(
      'jumia-gaming-preview:merchant-1:category-1',
      JSON.stringify({
        selectionId: 'selection-1',
        expiresAt: '2099-01-01T00:00:00.000Z',
      })
    );

    expect(
      gamingSelectionPreviewCache.read(
        'jumia-gaming-preview:merchant-1:category-1'
      )
    ).toEqual({
      selectionId: 'selection-1',
      expiresAt: '2099-01-01T00:00:00.000Z',
    });
  });

  it.each([
    ['malformed JSON', '{'],
    ['missing expiry', JSON.stringify({ selectionId: 'selection-1' })],
    [
      'expired entry',
      JSON.stringify({
        selectionId: 'selection-1',
        expiresAt: '2000-01-01T00:00:00.000Z',
      }),
    ],
  ])('removes %s entries', (_label, value) => {
    const key = 'jumia-gaming-preview:merchant-1:category-1';
    localStorage.setItem(key, value);

    expect(gamingSelectionPreviewCache.read(key)).toBeNull();
    expect(localStorage.getItem(key)).toBeNull();
  });

  it('finds a cached selection for the merchant independent of category ID', () => {
    const key = 'jumia-gaming-preview:merchant-1:inactive-category';
    localStorage.setItem(
      key,
      JSON.stringify({
        selectionId: 'frozen-selection',
        expiresAt: '2099-01-01T00:00:00.000Z',
      })
    );

    expect(gamingSelectionPreviewCache.find('merchant-1')).toEqual({
      cacheKey: key,
      selection: {
        selectionId: 'frozen-selection',
        expiresAt: '2099-01-01T00:00:00.000Z',
      },
    });
    expect(gamingSelectionPreviewCache.find('merchant-2')).toBeNull();
  });

  it('does not skip a valid cache after removing an expired entry', () => {
    localStorage.setItem(
      'jumia-gaming-preview:merchant-1:expired-category',
      JSON.stringify({
        selectionId: 'expired-selection',
        expiresAt: '2000-01-01T00:00:00.000Z',
      })
    );
    const validKey = 'jumia-gaming-preview:merchant-1:valid-category';
    localStorage.setItem(
      validKey,
      JSON.stringify({
        selectionId: 'valid-selection',
        expiresAt: '2099-01-01T00:00:00.000Z',
      })
    );

    expect(gamingSelectionPreviewCache.find('merchant-1')).toEqual({
      cacheKey: validKey,
      selection: {
        selectionId: 'valid-selection',
        expiresAt: '2099-01-01T00:00:00.000Z',
      },
    });
  });

  it('removes a rejected selection', () => {
    const key = 'jumia-gaming-preview:merchant-1:category-1';
    localStorage.setItem(key, '{}');

    gamingSelectionPreviewCache.remove(key);

    expect(localStorage.getItem(key)).toBeNull();
  });
});
