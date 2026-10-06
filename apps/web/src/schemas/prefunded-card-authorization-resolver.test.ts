import { describe, expect, it } from 'vitest';
import { prefundedCardAuthorizationResolverSchemas as schemas } from './prefunded-card-authorization-resolver';

const identity = {
  savedMethodId: 'abcdef01-0000-4000-8000-000000000001',
  merchantId: '10000000-0000-4000-8000-000000000001',
  customerId: '20000000-0000-4000-8000-000000000001',
};

describe('authorization resolver schemas', () => {
  it('normalizes UUID casing without accepting extra owner or credential fields', () => {
    expect(
      schemas.identity.parse({
        ...identity,
        savedMethodId: identity.savedMethodId.toUpperCase(),
      })
    ).toEqual(identity);
    expect(
      schemas.identity.safeParse({
        ...identity,
        authorizationCode: 'AUTH_unknown',
      }).success
    ).toBe(false);
  });

  it.each([
    'savedMethodId',
    'merchantId',
    'customerId',
  ])('requires a UUID for %s', (key) => {
    expect(
      schemas.identity.safeParse({ ...identity, [key]: 'bad' }).success
    ).toBe(false);
  });

  it('requires every scope pin and rejects malformed physical database identity', () => {
    const scope = {
      merchantId: identity.merchantId,
      integrationId: '40000000-0000-4000-8000-000000000001',
      treasuryBindingId: '50000000-0000-4000-8000-000000000001',
      systemIdentifier: '123456789',
    };
    expect(schemas.scope.safeParse(scope).success).toBe(true);
    for (const key of Object.keys(scope)) {
      expect(
        schemas.scope.safeParse({ ...scope, [key]: undefined }).success
      ).toBe(false);
    }
    expect(
      schemas.scope.safeParse({ ...scope, systemIdentifier: '1;select' })
        .success
    ).toBe(false);
  });

  it('requires the original stored transaction id for provisioning', () => {
    expect(schemas.provision.safeParse(identity).success).toBe(false);
    expect(
      schemas.provision.safeParse({
        ...identity,
        transactionId: '70000000-0000-4000-8000-000000000001',
      }).success
    ).toBe(true);
  });
});
