import { expect, it } from 'vitest';
import { createBrilStashPageCorrelation } from './page-correlation';

it('matches the canonical SQL saved-connection correlation vector', () => {
  expect(
    createBrilStashPageCorrelation('d0000000-0000-4000-8000-000000000001', {
      generationId: 'b0000000-0000-4000-8000-000000000001',
      credentialId: 'c0000000-0000-4000-8000-000000000001',
      payloadDigest:
        '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    })
  ).toBe('d85814118e5308560e3ff9929dde5b3143ee678ee37eb804fdf549078e624256');
});
