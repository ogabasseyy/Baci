import { expect, it } from 'vitest';
import {
  oxygenActivationTrialBodySchema,
  oxygenActivationTrialStateSchema,
} from './oxygen-activation-trial';

it('allows only the expressly authorized reference and known trial states', () => {
  expect(
    oxygenActivationTrialBodySchema.safeParse({
      reference: '438f96ee-37c4-49bb-a56c-51451f9cb624',
    }).success
  ).toBe(true);
  expect(
    oxygenActivationTrialBodySchema.safeParse({ reference: 'other' }).success
  ).toBe(false);
  expect(
    oxygenActivationTrialBodySchema.safeParse({
      reference: '438f96ee-37c4-49bb-a56c-51451f9cb624',
      settle: true,
    }).success
  ).toBe(false);
  expect(
    oxygenActivationTrialStateSchema.safeParse({
      status: 'activated',
      result: { status: 'ACTIVATED' },
    }).success
  ).toBe(true);
  expect(
    oxygenActivationTrialStateSchema.safeParse({ status: 'settled' }).success
  ).toBe(false);
});
