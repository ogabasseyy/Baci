import { expect, it } from 'vitest';
import { primaryCardTransferOutboxSchema as schema } from './primary-wallet-card-transfer-outbox';

it('accepts empty or one-operation bounded selections and rejects unsafe results', () => {
  const valid = { operationIds: [], unknownCount: 0, dispatchingCount: 0 };
  expect(schema.parse(valid)).toEqual(valid);
  for (const value of [
    { ...valid, operationIds: ['bad'] },
    {
      ...valid,
      operationIds: Array(2).fill('10000000-0000-4000-8000-000000000001'),
    },
    { ...valid, unknownCount: -1 },
    { ...valid, dispatchingCount: 0.5 },
    { ...valid, unknownCount: Number.MAX_SAFE_INTEGER + 1 },
    { ...valid, secret: 'unexpected' },
  ])
    expect(schema.safeParse(value).success).toBe(false);
});
