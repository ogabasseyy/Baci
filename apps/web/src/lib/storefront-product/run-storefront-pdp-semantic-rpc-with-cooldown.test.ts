import { afterEach, expect, it, vi } from 'vitest';
import { runStorefrontPdpSemanticRpcWithCooldown } from './run-storefront-pdp-semantic-rpc-with-cooldown';
import { storefrontPdpSemanticReadCooldown } from './storefront-pdp-semantic-read-cooldown-singleton';

afterEach(() => {
  storefrontPdpSemanticReadCooldown.reset();
  vi.restoreAllMocks();
});

it('returns a successful bounded RPC response without entering cooldown', async () => {
  const response = { data: { ok: true }, error: null };
  await expect(
    runStorefrontPdpSemanticRpcWithCooldown(
      Promise.resolve(response),
      { deadlineMs: 1000, traceThresholdMs: 100 },
      'success-scope'
    )
  ).resolves.toMatchObject({ response });
  expect(storefrontPdpSemanticReadCooldown.isCoolingDown('success-scope')).toBe(
    false
  );
});

it('returns fallback without constructing a query while cooling down', async () => {
  storefrontPdpSemanticReadCooldown.markFailure('factory-scope');
  const createQuery = vi.fn(() => Promise.resolve({ value: 'live' }));

  await expect(
    runStorefrontPdpSemanticRpcWithCooldown(
      createQuery,
      { deadlineMs: 1000, traceThresholdMs: 100 },
      'factory-scope',
      () => ({ value: 'fallback' })
    )
  ).resolves.toMatchObject({ response: { value: 'fallback' } });
  expect(createQuery).not.toHaveBeenCalled();
});

it('rethrows non-timeout failures without entering cooldown', async () => {
  await expect(
    runStorefrontPdpSemanticRpcWithCooldown(
      Promise.reject(new Error('database unavailable')),
      { deadlineMs: 1000, traceThresholdMs: 100 },
      'error-scope'
    )
  ).rejects.toThrow('database unavailable');
  expect(storefrontPdpSemanticReadCooldown.isCoolingDown('error-scope')).toBe(
    false
  );
});

it('marks the shared scope when the bounded RPC times out', async () => {
  const query = Promise.reject(new Error('request timed out'));
  await expect(
    runStorefrontPdpSemanticRpcWithCooldown(
      query,
      {
        deadlineMs: 1000,
        traceThresholdMs: 100,
      },
      'wrapper-test'
    )
  ).rejects.toThrow('timed out');
  expect(storefrontPdpSemanticReadCooldown.isCoolingDown('wrapper-test')).toBe(
    true
  );
  expect(
    storefrontPdpSemanticReadCooldown.isCoolingDown('unrelated-scope')
  ).toBe(false);
});
