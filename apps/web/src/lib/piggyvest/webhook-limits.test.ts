import { expect, it } from 'vitest';
import { PIGGYVEST_WEBHOOK_LIMITS } from './webhook-limits';

it('caps raw webhook request size and read duration', () => {
  expect(PIGGYVEST_WEBHOOK_LIMITS.maxPayloadBytes).toBe(65536);
  expect(PIGGYVEST_WEBHOOK_LIMITS.readTimeoutMs).toBe(5000);
});
