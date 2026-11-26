import { expect, it } from 'vitest';
import { z } from 'zod';
import {
  builderAuthDiscoverySchemas,
  builderAuthOperatorSchema,
} from './experience-builder-auth';

it('validates a bounded active discovery connection', () => {
  const { connection, ids } = builderAuthDiscoverySchemas(z);
  const id = '11111111-1111-4111-8111-111111111111';
  const row = {
    connectionId: id,
    actorUserId: id,
    grantVersion: 1,
    status: 'active',
    expiresAt: '2026-11-23T00:00:00Z',
    revokedAt: null,
    scopes: ['storefront.write'],
    allowedMerchantIds: [id],
  };
  expect(connection.parse(row)).toEqual(row);
  expect(
    connection.safeParse({ ...row, allowedMerchantIds: [id, id] }).success
  ).toBe(false);
  expect(ids.safeParse(Array.from({ length: 21 }, () => id)).success).toBe(
    false
  );
});

it('keeps auth operator lifetime bounds caller-configured', () => {
  const configuration = builderAuthOperatorSchema(z, 300, 3600);
  expect(configuration.shape.connectionTtlSeconds.safeParse(299).success).toBe(
    false
  );
  expect(configuration.shape.connectionTtlSeconds.parse(300)).toBe(300);
  expect(configuration.shape.connectionTtlSeconds.safeParse(3601).success).toBe(
    false
  );
});
