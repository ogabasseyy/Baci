import { expect, it } from 'vitest';
import { prefundedCardWorkerSchemas as schemas } from './prefunded-card-worker';

const scope = {
  environment: 'staging',
  integrationId: '10000000-0000-4000-8000-000000000001',
  merchantId: '10000000-0000-4000-8000-000000000001',
  treasuryBindingId: '10000000-0000-4000-8000-000000000001',
  businessId: 'business',
  expectedSystemId: '123',
};
it('bounds batches and rejects production or missing physical identity', () => {
  expect(schemas.scope.parse(scope).batchSize).toBe(5);
  for (const change of [
    { environment: 'production' },
    { batchSize: 21 },
    { batchSize: 0 },
    { expectedSystemId: '' },
  ])
    expect(schemas.scope.safeParse({ ...scope, ...change }).success).toBe(
      false
    );
});
