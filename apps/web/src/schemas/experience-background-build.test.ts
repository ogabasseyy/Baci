import { expect, it } from 'vitest';
import {
  experienceBackgroundBuildConnection,
  experienceBackgroundBuildInput,
} from './experience-background-build';

const id = '11111111-1111-4111-8111-111111111111';
const input = {
  connectionId: id,
  actorUserId: id,
  merchantId: id,
  jobId: id,
  grantVersion: 1,
};
const connection = {
  connectionId: id,
  actorUserId: id,
  grantVersion: 1,
  status: 'active',
  revokedAt: null,
  expiresAt: '2027-01-01T00:00:00Z',
  scopes: ['storefront.write'],
  allowedMerchantIds: [id],
  allowCreateStore: false,
};

it('accepts a bound build input with a positive grant version', () => {
  expect(experienceBackgroundBuildInput.parse(input)).toEqual(input);
  for (const patch of [
    { grantVersion: 0 },
    { jobId: 'bad' },
    { extra: true },
  ]) {
    expect(
      experienceBackgroundBuildInput.safeParse({ ...input, ...patch }).success
    ).toBe(false);
  }
});

it('accepts an active connection and rejects revoked or wider grants', () => {
  expect(experienceBackgroundBuildConnection.parse(connection)).toEqual(
    connection
  );
  for (const patch of [
    { status: 'revoked' },
    { revokedAt: '2026-11-22T00:00:00Z' },
    { scopes: ['other'] },
    { allowedMerchantIds: [id, id] },
  ]) {
    expect(
      experienceBackgroundBuildConnection.safeParse({ ...connection, ...patch })
        .success
    ).toBe(false);
  }
});
