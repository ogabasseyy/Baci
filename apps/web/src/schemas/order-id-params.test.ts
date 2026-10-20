import { expect, it } from 'vitest';
import { orderIdParamsSchema } from './order-id-params';

const id = '123e4567-e89b-12d3-a456-426614174000';

it('preserves order-id-params validation', () => {
  expect(orderIdParamsSchema.parse({ id })).toEqual({ id });
  expect(orderIdParamsSchema.safeParse({ id: 'invalid' }).success).toBe(false);
});
