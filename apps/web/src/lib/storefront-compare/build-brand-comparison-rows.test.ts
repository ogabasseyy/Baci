import { describe, expect, it } from 'vitest';
import { buildBrandComparisonRows } from './build-brand-comparison-rows';

const formatter = new Intl.NumberFormat('en-NG');

function product(name: string, brand: string, price: number) {
  return {
    slug: name.toLowerCase().replaceAll(' ', '-'),
    name,
    brand,
    price,
    category_slug: 'smartphones',
  };
}

describe('buildBrandComparisonRows', () => {
  it('counts alias-branded products under the canonical brand', () => {
    const products = [
      product('Redmi Note 13', 'Redmi', 200_000),
      product('Redmi 12', 'Redmi', 150_000),
      product('Xiaomi 14', 'Xiaomi', 900_000),
      product('Galaxy S24', 'Samsung', 750_000),
      product('Galaxy A55', 'Samsung', 400_000),
      product('Galaxy A35', 'Samsung', 300_000),
    ];
    const { comparisonRows, leftBrandProducts, rightBrandProducts } =
      buildBrandComparisonRows({
        categorySlug: 'smartphones',
        leftBrand: 'Xiaomi',
        rightBrand: 'Samsung',
        products,
        priceFormatter: formatter,
      });
    expect(leftBrandProducts).toHaveLength(3);
    expect(rightBrandProducts).toHaveLength(3);
    expect(comparisonRows[0]).toEqual({
      label: 'Active models',
      leftValue: '3',
      rightValue: '3',
    });
    expect(comparisonRows[2]?.leftValue).toBe('Redmi 12');
  });

  it('counts gaming alias brands under their canonical comparison labels', () => {
    const products = [
      { ...product('PS5 Console', 'Sony', 850_000), category_slug: 'gaming' },
      { ...product('PS5 Slim', 'Sony', 800_000), category_slug: 'gaming' },
      {
        ...product('Xbox Series X', 'Microsoft', 780_000),
        category_slug: 'gaming',
      },
      {
        ...product('Xbox Series S', 'Microsoft', 450_000),
        category_slug: 'gaming',
      },
    ];
    const { leftBrandProducts, rightBrandProducts } = buildBrandComparisonRows({
      categorySlug: 'gaming',
      leftBrand: 'Sony',
      rightBrand: 'Microsoft',
      products,
      priceFormatter: formatter,
    });
    expect(leftBrandProducts).toHaveLength(2);
    expect(rightBrandProducts).toHaveLength(2);
  });
});
