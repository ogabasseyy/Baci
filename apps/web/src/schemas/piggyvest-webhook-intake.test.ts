import { describe, expect, it } from 'vitest';
import { piggyvestWebhookIntakeConfigurationSchema } from './piggyvest-webhook-intake';

const configuration = {
  environment: 'staging',
  integrationId: '00000000-0000-4000-8000-000000000001',
  secret: 'synthetic-secret',
  expectedProjectId: 'synthetic-project',
  actualProjectId: 'synthetic-project',
  rawByteSignatureVerified: true,
  durableAcknowledgementApproved: true,
};

describe('piggyvestWebhookIntakeConfigurationSchema', () => {
  it('accepts explicit server-owned staging activation configuration', () => {
    expect(
      piggyvestWebhookIntakeConfigurationSchema.parse(configuration)
    ).toEqual(configuration);
  });

  it.each(
    Object.keys(configuration)
  )('requires explicit %s without an activation default', (field) => {
    expect(
      piggyvestWebhookIntakeConfigurationSchema.safeParse({
        ...configuration,
        [field]: undefined,
      }).success
    ).toBe(false);
  });

  it.each([
    { environment: 'production' },
    { integrationId: 'not-a-uuid' },
    { actualProjectId: 'other-project' },
    { rawByteSignatureVerified: false },
    { durableAcknowledgementApproved: false },
    { secret: ' ' },
    { clientTenantId: 'untrusted' },
  ])('rejects unsafe activation configuration', (override) => {
    expect(
      piggyvestWebhookIntakeConfigurationSchema.safeParse({
        ...configuration,
        ...override,
      }).success
    ).toBe(false);
  });
});
