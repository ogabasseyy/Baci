import { expect, it } from 'vitest';
import { STOREFRONT_PDP_SEMANTIC_FAILURE_COOLDOWN_MS } from './storefront-pdp-semantic-read-cooldown-constants';

it('uses the bounded 30-second failure cooldown', () => {
  expect(STOREFRONT_PDP_SEMANTIC_FAILURE_COOLDOWN_MS).toBe(30_000);
});
