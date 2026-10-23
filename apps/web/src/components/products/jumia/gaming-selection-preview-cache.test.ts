import { beforeEach, describe, expect, it } from 'vitest';
import {
  findCachedSelection,
  readCachedSelection,
  removeCachedSelection,
} from './gaming-selection-preview-cache';

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
      readCachedSelection('jumia-gaming-preview:merchant-1:category-1')
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

    expect(readCachedSelection(key)).toBeNull();
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

    expect(findCachedSelection('merchant-1')).toEqual({
      cacheKey: key,
      selection: {
        selectionId: 'frozen-selection',
        expiresAt: '2099-01-01T00:00:00.000Z',
      },
    });
    expect(findCachedSelection('merchant-2')).toBeNull();
  });

  it('removes a rejected selection', () => {
    const key = 'jumia-gaming-preview:merchant-1:category-1';
    localStorage.setItem(key, '{}');

    removeCachedSelection(key);

    expect(localStorage.getItem(key)).toBeNull();
  });
});
