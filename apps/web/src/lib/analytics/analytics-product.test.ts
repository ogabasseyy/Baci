import { describe, expectTypeOf, it } from 'vitest';
import type { Product } from '@/lib/products';
import type { AnalyticsProduct } from './analytics-product';

describe('AnalyticsProduct', () => {
  it('accepts a full catalog product', () => {
    expectTypeOf<Product>().toExtend<AnalyticsProduct>();
  });

  it('accepts the minimal fields a template-specific product can supply', () => {
    expectTypeOf<{
      id: string;
      name: string;
      price: number;
      category?: string;
    }>().toExtend<AnalyticsProduct>();
  });

  it('requires id, name, and price', () => {
    expectTypeOf<{
      id: string;
      name: string;
    }>().not.toExtend<AnalyticsProduct>();
  });
});
