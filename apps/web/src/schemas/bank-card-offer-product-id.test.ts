import { expect, it } from 'vitest';
import { bankCardOfferProductIdSchema } from './bank-card-offer-product-id';

it.each([
  '821516a6-f4b4-427e-83fb-757ed7658082',
  '821516A6-F4B4-427E-83FB-757ED7658082',
])('accepts catalog UUID %s', (id) => {
  expect(bankCardOfferProductIdSchema.parse(id)).toBe(id);
});

it.each(['', 'unlisted', null])('rejects invalid catalog identity %j', (id) => {
  expect(bankCardOfferProductIdSchema.safeParse(id).success).toBe(false);
});
