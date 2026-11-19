import { expect, it } from 'vitest';
import { oxygenPhoneRecoverySchema } from './oxygen-phone-recovery';

const valid = {
  workflowId: '60000000-0000-4000-8000-000000000001',
  version: 0,
  idempotencyKey: '70000000-0000-4000-8000-000000000001',
};
it('accepts a workflow-bound recovery request', () => {
  expect(oxygenPhoneRecoverySchema.safeParse(valid).success).toBe(true);
});
it.each([
  { ...valid, workflowId: 'invalid' },
  { ...valid, idempotencyKey: 'invalid' },
  { ...valid, version: -1 },
  { ...valid, version: 1.5 },
  { ...valid, extra: true },
])('rejects invalid or unrecognized recovery input', (input) => {
  expect(oxygenPhoneRecoverySchema.safeParse(input).success).toBe(false);
});
