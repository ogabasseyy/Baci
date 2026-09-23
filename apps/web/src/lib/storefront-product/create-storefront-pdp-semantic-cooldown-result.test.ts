import { expect, it } from 'vitest';
import { createStorefrontPdpSemanticCooldownResult } from './create-storefront-pdp-semantic-cooldown-result';

it('returns a retryable unavailable timeout result', () => {
  expect(createStorefrontPdpSemanticCooldownResult()).toMatchObject({
    status: 'unavailable',
    error: { kind: 'timeout', retryable: true },
  });
});
