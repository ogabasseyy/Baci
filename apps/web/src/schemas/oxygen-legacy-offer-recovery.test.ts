import { expect, it } from 'vitest';
import { oxygenLegacyOfferRecoverySchema } from './oxygen-legacy-offer-recovery';

const valid = {
  workflowId: '60000000-0000-4000-8000-000000000001',
  version: 0,
  idempotencyKey: '70000000-0000-4000-8000-000000000001',
};
it('accepts a workflow-bound recovery request', () => {
  expect(oxygenLegacyOfferRecoverySchema.safeParse(valid).success).toBe(true);
});
it.each([
  { version: valid.version, idempotencyKey: valid.idempotencyKey },
  { workflowId: valid.workflowId, idempotencyKey: valid.idempotencyKey },
  { workflowId: valid.workflowId, version: valid.version },
  { ...valid, workflowId: 'invalid' },
  { ...valid, idempotencyKey: 'invalid' },
  { ...valid, version: -1 },
  { ...valid, version: 1.5 },
  { ...valid, extra: true },
])('rejects invalid or unrecognized recovery input', (input) => {
  expect(oxygenLegacyOfferRecoverySchema.safeParse(input).success).toBe(false);
});
