import { describe, expect, it } from 'vitest';
import { piggyvestInboxWorkerSchemas } from './piggyvest-inbox-worker';

const configuration = {
  environment: 'staging',
  integrationId: '00000000-0000-4000-8000-000000000001',
  batchSize: 1,
  leaseSeconds: 1,
};

describe('piggyvestInboxWorkerSchemas', () => {
  it('accepts explicit bounded staging worker configuration', () => {
    expect(
      piggyvestInboxWorkerSchemas.configuration.safeParse(configuration).success
    ).toBe(true);
  });
  it.each([
    { batchSize: 0 },
    { batchSize: 101 },
    { leaseSeconds: 0 },
    { leaseSeconds: 301 },
    { environment: 'production' },
    { integrationId: 'invalid' },
    { customerId: 'untrusted' },
  ])('rejects unsafe worker bounds or identity', (override) => {
    expect(
      piggyvestInboxWorkerSchemas.configuration.safeParse({
        ...configuration,
        ...override,
      }).success
    ).toBe(false);
  });
  it('rejects completion claiming financial processing', () => {
    expect(
      piggyvestInboxWorkerSchemas.finish.safeParse([{ outcome: 'processed' }])
        .success
    ).toBe(false);
  });
});
