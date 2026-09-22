import type { SetStateAction } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { Product } from '../types';
import { createCategoryAddToCartHandler } from './category-add-to-cart';

describe('createCategoryAddToCartHandler', () => {
  it('adds the product and clears the Added state after a beat', () => {
    vi.useFakeTimers();
    try {
      const addToCart = vi.fn();
      const added: string[] = [];
      const setAddedItems = vi.fn((action: SetStateAction<string[]>) => {
        const updater = typeof action === 'function' ? action : () => action;
        added.splice(0, added.length, ...updater(added));
      });
      const handler = createCategoryAddToCartHandler(addToCart, setAddedItems);
      const product = { id: 'p1', name: 'Laptop' } as Product;

      handler({} as Parameters<typeof handler>[0], product);

      expect(addToCart).toHaveBeenCalledTimes(1);
      expect(added).toEqual(['p1']);
      vi.advanceTimersByTime(2000);
      expect(added).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});
