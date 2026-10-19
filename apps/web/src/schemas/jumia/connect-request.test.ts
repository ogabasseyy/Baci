import { describe, expect, it } from 'vitest';
import { jumiaConnectRequestSchema } from './connect-request';

describe('jumiaConnectRequestSchema', () => {
  it('accepts OAuth and self-authorization discovery requests', () => {
    expect(
      jumiaConnectRequestSchema.safeParse({ connectionType: 'oauth' }).success
    ).toBe(true);
    expect(
      jumiaConnectRequestSchema.safeParse({
        connectionType: 'self_authorization',
        operation: 'discover',
        clientId: 'client-id',
        refreshToken: 'refresh-token',
      }).success
    ).toBe(true);
  });

  it('rejects unknown connection types', () => {
    expect(
      jumiaConnectRequestSchema.safeParse({ connectionType: 'password' })
        .success
    ).toBe(false);
  });
});
