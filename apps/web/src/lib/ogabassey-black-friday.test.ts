import { describe, expect, it } from 'vitest';
import {
  getBlackFridayProductSpecs,
  selectBlackFridayProducts,
} from './ogabassey-black-friday';

describe('Black Friday lineup', () => {
  it('maps catalog specs into filter options for a laptop', () => {
    expect(
      getBlackFridayProductSpecs([
        {
          ram_gb: 16,
          storage_gb: 512,
          gpu: 'Apple M4 GPU',
          screen_size_inches: 13.6,
          available_colors: 'Silver, Midnight',
        },
      ])
    ).toMatchObject({
      ram: '16 GB',
      storage: '512 GB',
      graphics: 'Apple M4 GPU',
      displaySize: '13.6 inches',
      colors: ['Silver', 'Midnight'],
    });
  });

  it('keeps the curated order and skips missing, duplicate, and unavailable entries', () => {
    const products = [
      {
        id: 'first',
        name: 'first',
        slug: 'first',
        stock: 2,
        manage_stock: true,
        price: 500,
      },
      {
        id: 'second',
        name: 'second',
        slug: 'second',
        stock: 0,
        manage_stock: false,
        price: 800,
      },
      {
        id: 'sold-out',
        name: 'sold-out',
        slug: 'sold-out',
        stock: 0,
        manage_stock: true,
        price: 500,
      },
      {
        id: 'unlisted',
        name: 'unlisted',
        slug: 'unlisted',
        stock: 2,
        manage_stock: true,
        price: 500,
      },
      {
        id: 'no-price',
        name: 'no-price',
        slug: 'no-price',
        stock: 2,
        manage_stock: true,
        price: 0,
      },
    ];
    expect(
      selectBlackFridayProducts(products, [
        'second',
        'sold-out',
        'first',
        'missing',
        'second',
        'no-price',
      ]).map(({ slug }) => slug)
    ).toEqual(['second', 'first']);
  });
});
