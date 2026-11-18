import { blackFridayResponseSchema } from './black-friday';

const product = {
  id: 'offer-id',
  slug: 'Galaxy-S26',
  name: 'Galaxy S26',
  image: 'https://example.test/phone.webp',
  price: '₦500,000.00',
  compareAtPrice: '₦550,000.00',
};

it('parses a complete offer and an empty lineup', () => {
  expect(blackFridayResponseSchema.parse({ products: [product] })).toEqual({
    products: [product],
  });
  expect(blackFridayResponseSchema.parse({ products: [] })).toEqual({
    products: [],
  });
});

it.each([
  null,
  undefined,
])('accepts an unavailable image (%s) and omitted compare-at price', (image) => {
  expect(
    blackFridayResponseSchema.safeParse({
      products: [{ ...product, image, compareAtPrice: undefined }],
    }).success
  ).toBe(true);
});

it.each([
  { slug: '' },
  { slug: 'phone model' },
  { slug: 'phones/model' },
  { id: undefined },
  { id: 123 },
  { name: undefined },
  { name: false },
  { price: undefined },
  { price: 500000 },
  { image: 123 },
  { compareAtPrice: null },
  { compareAtPrice: 550000 },
])('rejects an invalid offer field (%j)', (invalidFields) => {
  expect(
    blackFridayResponseSchema.safeParse({
      products: [product, { ...product, ...invalidFields }],
    }).success
  ).toBe(false);
});

it('requires the offers array', () => {
  expect(blackFridayResponseSchema.safeParse({}).success).toBe(false);
  expect(
    blackFridayResponseSchema.safeParse({ products: product }).success
  ).toBe(false);
});
