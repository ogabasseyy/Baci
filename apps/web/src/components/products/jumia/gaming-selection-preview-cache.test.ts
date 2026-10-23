import { beforeEach, describe, expect, it } from 'vitest';
import { gamingSelectionPreviewCache } from './gaming-selection-preview-cache';

describe('Gaming selection preview cache helpers', () => {
  beforeEach(() => localStorage.clear());

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

  it.each([
    ['malformed JSON', '{'],
    [
      'missing expiry',
      JSON.stringify({ selectionId: 'd1ef9f3a-4f2b-49af-a84f-97d19c0084bd' }),
    ],
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

  it('does not skip a valid cache after removing an expired entry', () => {
    localStorage.setItem(
      'jumia-gaming-preview:merchant-1:expired-category',
      JSON.stringify({
        selectionId: 'd1ef9f3a-4f2b-49af-a84f-97d19c0084bd',
        expiresAt: '2000-01-01T00:00:00.000Z',
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

    expect(gamingSelectionPreviewCache.find('merchant-1')).toEqual({
      cacheKey: validKey,
      selection: {
        selectionId: 'd1ef9f3a-4f2b-49af-a84f-97d19c0084bd',
        expiresAt: '2099-01-01T00:00:00.000Z',
      },
    });
  });

  it('chooses the newest unexpired merchant snapshot', () => {
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
