import { describe, expect, it } from 'vitest';
import {
  jumiaSelfAuthorizationCredentialsSchema,
  jumiaSelfAuthorizationDiscoverySchema,
  jumiaSelfAuthorizationSelectionSchema,
} from '@/schemas/jumia/self-authorization';

const DISCOVERY_ID = '00000000-0000-4000-8000-000000000099';

describe('Jumia Self Authorization credentials schema', () => {
  it('trims valid credentials', () => {
    expect(
      jumiaSelfAuthorizationCredentialsSchema.parse({
        clientId: ' client-id ',
        refreshToken: ' refresh-token ',
      })
    ).toEqual({ clientId: 'client-id', refreshToken: 'refresh-token' });
  });

  it.each([
    {},
    { clientId: '', refreshToken: 'token' },
    { clientId: 'client', refreshToken: '' },
    { clientId: 12, refreshToken: 'token' },
    { clientId: 'x'.repeat(513), refreshToken: 'token' },
    { clientId: 'client', refreshToken: 'x'.repeat(8193) },
  ])('rejects malformed or oversized credentials', (input) => {
    expect(
      jumiaSelfAuthorizationCredentialsSchema.safeParse(input).success
    ).toBe(false);
  });
});

describe('Jumia Self Authorization discovery schema', () => {
  it('accepts a valid discovery request', () => {
    expect(
      jumiaSelfAuthorizationDiscoverySchema.parse({
        connectionType: 'self_authorization',
        operation: 'discover',
        clientId: 'client-id',
        refreshToken: 'refresh-token',
      })
    ).toEqual({
      connectionType: 'self_authorization',
      operation: 'discover',
      clientId: 'client-id',
      refreshToken: 'refresh-token',
    });
  });

  it('rejects discovery requests without credentials', () => {
    expect(
      jumiaSelfAuthorizationDiscoverySchema.safeParse({
        connectionType: 'self_authorization',
        operation: 'discover',
        clientId: '',
        refreshToken: 'refresh-token',
      }).success
    ).toBe(false);
  });
});

describe('Jumia Self Authorization selection schema', () => {
  it('accepts a valid selection request', () => {
    expect(
      jumiaSelfAuthorizationSelectionSchema.parse({
        clientId: 'client-id',
        discoveryId: DISCOVERY_ID,
        selectedShopIds: ['shop-1:GH', 'shop-1:NG'],
      })
    ).toEqual({
      clientId: 'client-id',
      discoveryId: DISCOVERY_ID,
      selectedShopIds: ['shop-1:GH', 'shop-1:NG'],
    });
  });

  it('rejects duplicate selected shop ids', () => {
    expect(
      jumiaSelfAuthorizationSelectionSchema.safeParse({
        clientId: 'client-id',
        discoveryId: DISCOVERY_ID,
        selectedShopIds: ['shop-1', 'shop-1'],
      }).success
    ).toBe(false);
  });

  it('rejects invalid discovery ids', () => {
    expect(
      jumiaSelfAuthorizationSelectionSchema.safeParse({
        clientId: 'client-id',
        discoveryId: 'not-a-uuid',
        selectedShopIds: ['shop-1'],
      }).success
    ).toBe(false);
  });
});
