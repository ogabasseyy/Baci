import { NextRequest } from 'next/server';
import { afterEach, expect, it, vi } from 'vitest';
import { __resetQuotaDenialTelemetryForTesting } from './quota-denial-telemetry';
import { checkAnonymousCartQuota } from './quota-identity';

const getRedis = vi.hoisted(() => vi.fn());
vi.mock('@/lib/redis', () => ({ getRedis }));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  __resetQuotaDenialTelemetryForTesting();
});

function request(credential?: string): NextRequest {
  const headers: Record<string, string> = { 'x-real-ip': '192.0.2.42' };
  if (credential !== undefined)
    headers['x-baci-client-credential'] = credential;
  return new NextRequest('http://localhost/api/storefront/cart', { headers });
}

function healthyRedis(): void {
  const counts = new Map<string, number>();
  getRedis.mockReturnValue({
    createScript: () => ({
      eval: async ([key]: string[]) => {
        const next = (counts.get(key) ?? 0) + 1;
        counts.set(key, next);
        return [next, 3_600_000];
      },
    }),
  });
}

it.each([
  [undefined, 'missing_credential'],
  ['not-a-valid-credential', 'invalid_credential'],
  ['11111111-1111-4111-8111-111111111111', 'credential'],
])('records a safe create denial for %s', async (credential, identity) => {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('VERCEL', '1');
  healthyRedis();
  const log = vi.spyOn(console, 'info').mockImplementation(() => {});
  for (let i = 0; i < 11; i++) {
    await checkAnonymousCartQuota(request(credential), {
      merchantId: 'merchant-private-id',
      operation: 'create',
    });
  }
  expect(log).toHaveBeenCalledOnce();
  expect(log).toHaveBeenCalledWith('Cart quota denied', {
    operation: 'create',
    identity,
    scope: 'merchant',
    degraded: false,
    occurrences: 1,
  });
  expect(JSON.stringify(log.mock.calls)).not.toMatch(
    /merchant-private-id|192\.0\.2\.42|11111111|not-a-valid-credential/
  );
});

it('records a network-backstop denial separately from the credential', async () => {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('VERCEL', '1');
  healthyRedis();
  const log = vi.spyOn(console, 'info').mockImplementation(() => {});
  for (let i = 0; i < 251; i++) {
    const credential = `00000000-0000-4000-8000-${i.toString(16).padStart(12, '0')}`;
    await checkAnonymousCartQuota(request(credential), {
      merchantId: 'merchant-private-id',
      operation: 'create',
    });
  }
  expect(log).toHaveBeenCalledOnce();
  expect(log).toHaveBeenCalledWith('Cart quota denied', {
    operation: 'create',
    identity: 'network_backstop',
    scope: 'merchant',
    degraded: false,
    occurrences: 1,
  });
});
