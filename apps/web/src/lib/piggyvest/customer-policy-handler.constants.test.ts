import { expect, it } from 'vitest';
import { CUSTOMER_POLICY_REQUEST_LIMITS } from './customer-policy-handler.constants';

it('keeps draft consent requests small and short-lived', () => {
  expect(CUSTOMER_POLICY_REQUEST_LIMITS).toEqual({
    maxBodyBytes: 4096,
    maxBodyChunks: 64,
    readTimeoutMs: 2000,
  });
});
