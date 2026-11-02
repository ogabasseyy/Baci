import { expect, it } from 'vitest';
import {
  oxygenActivationBinding,
  oxygenActivationBindings,
  oxygenActivationReferenceSchema,
} from './activation-binding';

it('resolves only individually bound staging references', () => {
  expect(oxygenActivationBindings).toHaveLength(2);
  for (const binding of oxygenActivationBindings) {
    expect(oxygenActivationBinding(binding.reference)).toEqual(binding);
    expect(
      oxygenActivationReferenceSchema.safeParse(binding.reference).success
    ).toBe(true);
  }
  expect(
    oxygenActivationBinding('70000000-0000-4000-8000-000000000001')
  ).toBeUndefined();
  expect(
    oxygenActivationReferenceSchema.safeParse(
      '70000000-0000-4000-8000-000000000001'
    ).success
  ).toBe(false);
});
