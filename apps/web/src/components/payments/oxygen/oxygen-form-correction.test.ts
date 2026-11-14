import { expect, it } from 'vitest';
import { getOxygenFormCorrection } from './oxygen-form-correction';

it.each([
  ['customer_personal_details', 0, 'identity'],
  ['customer_bank_details', 1, 'bank account'],
  ['customer_employment_details', 2, 'income'],
  ['unknown', 0, 'identity'],
])('routes %s errors to the visible correction step', (section, step, text) => {
  const correction = getOxygenFormCorrection([
    { path: [section, 'private_value'] },
  ]);
  expect(correction.step).toBe(step);
  expect(correction.message).toContain(text);
  expect(correction.message).not.toContain('private_value');
});
