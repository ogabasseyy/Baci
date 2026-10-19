import { expect, it } from 'vitest';
import { savingsViewFixture } from '@/lib/piggyvest/savings-view.test-support';
import { piggyvestCustomerStatusSchema } from './piggyvest-customer-status';

it('accepts an explicit null variant for an exact product without variants', () => {
  const { goal } = savingsViewFixture();
  expect(
    piggyvestCustomerStatusSchema.safeParse({
      goal: {
        ...goal,
        policy: {
          ...goal.policy,
          device: { ...goal.policy.device, variantId: null },
        },
      },
      device: {
        productName: 'Synthetic nonvariant device',
        variant: null,
        condition: 'New',
      },
    }).success
  ).toBe(true);
});

it('rejects missing variant display for a policy that names an exact variant', () => {
  expect(
    piggyvestCustomerStatusSchema.safeParse({
      goal: savingsViewFixture().goal,
      device: {
        productName: 'Synthetic device',
        variant: null,
        condition: 'New',
      },
    }).success
  ).toBe(false);
});

it('requires exact variant display metadata and rejects extra financial input', () => {
  const input = {
    goal: savingsViewFixture().goal,
    device: {
      productName: 'Synthetic device',
      variant: '128GB / Black',
      condition: 'New',
    },
  };
  expect(piggyvestCustomerStatusSchema.safeParse(input).success).toBe(true);
  expect(
    piggyvestCustomerStatusSchema.safeParse({ ...input, balance: 10000 })
      .success
  ).toBe(false);
  expect(
    piggyvestCustomerStatusSchema.safeParse({
      ...input,
      device: { ...input.device, variant: '' },
    }).success
  ).toBe(false);
});
