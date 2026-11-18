import { expect, it } from '@jest/globals';
import { CustomerRowSchema, ProductRowSchema } from './product-schemas';

it('accepts standard customers and products without savings metadata', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const customer = { id, email: 'customer@example.com' };
  const product = { id, name: 'Phone', slug: 'phone', price: 198_000 };

  expect(CustomerRowSchema.parse(customer)).toEqual(customer);
  expect(ProductRowSchema.parse(product)).toEqual(product);
});
