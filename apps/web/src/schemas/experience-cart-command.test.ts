import { expect, it } from 'vitest';
import {
  experienceCartCommandSchema,
  experienceEngineCommandSchema,
} from './experience-cart-command';

it('allows public variant/condition commands but no caller amounts, tenants or unlimited quantities', () => {
  const command = {
    kind: 'add',
    productId: '11111111-1111-4111-8111-111111111111',
    quantity: 1,
    condition: 'refurbished',
  };
  expect(experienceCartCommandSchema.safeParse(command).success).toBe(true);
  for (const bad of [
    { ...command, price: 1 },
    { ...command, merchantId: 'm' },
    { ...command, quantity: 11 },
    { ...command, quantity: 0 },
    { ...command, quantity: 1.5 },
  ])
    expect(experienceCartCommandSchema.safeParse(bad).success).toBe(false);
  expect(
    experienceEngineCommandSchema.safeParse({ type: 'clear' }).success
  ).toBe(false);
});
