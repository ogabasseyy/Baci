import type { Product } from '@/types/product';
import { savingsProductImage } from './savings-product-image';
import type { SavingsVariantOptionGroup } from './start-savings-variant-options';

const groups: SavingsVariantOptionGroup[] = [
  {
    key: 'color',
    label: 'Color',
    values: [
      { value: 'Purple', label: 'Purple', selected: true, available: true },
    ],
  },
];
const product = {
  id: 'phone',
  color_images: { purple: ['purple.jpg'] },
  variants: [],
} as unknown as Product;
it('shows the selected colour before an exact variant is resolved', () => {
  expect(savingsProductImage(product, groups, 'black.jpg')).toBe('purple.jpg');
});
it('uses a matching variant image when colour media is absent', () => {
  const variantProduct = {
    ...product,
    color_images: {},
    variants: [
      {
        id: 'purple-128',
        name: 'Purple 128GB',
        price: 100000,
        attributes: { colour: 'Purple' },
        image: 'variant-purple.jpg',
      },
    ],
  } as Product;
  expect(savingsProductImage(variantProduct, groups, 'black.jpg')).toBe(
    'variant-purple.jpg'
  );
});
it('falls back safely for missing media and resets when colour is deselected', () => {
  expect(
    savingsProductImage({ ...product, color_images: {} }, groups, 'black.jpg')
  ).toBe('black.jpg');
  expect(savingsProductImage(product, [], 'black.jpg')).toBe('black.jpg');
  expect(savingsProductImage(null, groups, 'black.jpg')).toBe('black.jpg');
});
