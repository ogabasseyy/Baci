import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getCartQuotaClientIdentity } from './quota-identity';

afterEach(() => vi.unstubAllEnvs());

const CREDENTIAL_A = '11111111-1111-4111-8111-111111111111';
const CREDENTIAL_B = '22222222-2222-4222-8222-222222222222';

function requestWith(headers: Record<string, string>): NextRequest {
  return new NextRequest('http://localhost:3000/api/storefront/cart', {
    headers,
  });
}

describe('getCartQuotaClientIdentity', () => {
  it('keys quota identity on the client credential, not the network address', () => {
    vi.stubEnv('VERCEL', '1');
    const sharedEgress = { 'x-real-ip': '172.68.1.20' };
    const first = getCartQuotaClientIdentity(
      requestWith({
        ...sharedEgress,
        'x-baci-client-credential': CREDENTIAL_A,
      })
    );
    const second = getCartQuotaClientIdentity(
      requestWith({
        ...sharedEgress,
        'x-baci-client-credential': CREDENTIAL_B,
      })
    );
    // Two shoppers behind one egress get independent budgets.
    expect(first).not.toBe(second);
    expect(first.startsWith('client-credential:')).toBe(true);
    // The identity is a hash: the raw credential never appears in keys.
    expect(first).not.toContain(CREDENTIAL_A);
  });

  it('is stable for one credential across changing network addresses', () => {
    vi.stubEnv('VERCEL', '1');
    const atHome = getCartQuotaClientIdentity(
      requestWith({
        'x-baci-client-credential': CREDENTIAL_A,
        'x-real-ip': '192.0.2.10',
      })
    );
    const onCarrierNat = getCartQuotaClientIdentity(
      requestWith({
        'x-baci-client-credential': CREDENTIAL_A,
        'x-real-ip': '198.51.100.7',
      })
    );
    expect(onCarrierNat).toBe(atHome);
  });

  it('falls back to the legacy trusted network identity without a credential', () => {
    vi.stubEnv('VERCEL', '1');
    expect(
      getCartQuotaClientIdentity(requestWith({ 'x-real-ip': '192.0.2.44' }))
    ).toBe('192.0.2.44');
  });

  it('falls back when the credential is malformed or low entropy', () => {
    vi.stubEnv('VERCEL', '1');
    expect(
      getCartQuotaClientIdentity(
        requestWith({
          'x-baci-client-credential': 'not-a-credential',
          'x-real-ip': '192.0.2.44',
        })
      )
    ).toBe('192.0.2.44');
  });
});
