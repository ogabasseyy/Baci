import { describe, expect, it } from 'vitest';
import { piggyvestLiveRelaySchemas as schemas } from './piggyvest-live-relay';

const config = {
  endpoint: 'https://intake.example.com/piggyvest/intake',
  integrationId: '11111111-1111-4111-8111-111111111111',
  environment: 'production',
  relayToken: 'fixture-relay-token-at-least-32-characters',
};

describe('piggyvestLiveRelaySchemas', () => {
  it('accepts explicit production transport configuration', () => {
    expect(schemas.config.parse(config)).toEqual(config);
  });

  it.each([
    { ...config, endpoint: 'not-a-url' },
    { ...config, environment: 'staging' },
    { ...config, endpoint: 'https://intake.example.com/other' },
    {
      ...config,
      endpoint: 'https://intake.example.com/piggyvest/intake#fragment',
    },
    { ...config, relayToken: 'token\nwith-header-injection' },
    { ...config, integrationId: 'not-an-id' },
    { ...config, providerSecret: 'fixture-only' },
  ])('rejects an ambiguous or unscoped transport configuration', (input) => {
    expect(schemas.config.safeParse(input).success).toBe(false);
  });

  it('requires bound outcome fields rather than a generic received boolean', () => {
    expect(schemas.acknowledgement.safeParse({ received: true }).success).toBe(
      false
    );
    expect(
      schemas.acknowledgement.safeParse({
        integrationId: config.integrationId,
        environment: 'production',
        bodyDigest: 'a'.repeat(64),
        outcome: 'duplicate',
      }).success
    ).toBe(true);
  });
});
