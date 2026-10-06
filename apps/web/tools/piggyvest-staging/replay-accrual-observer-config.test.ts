import { createHash } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createAccrualObserverTestFixture } from './replay-accrual-observer.test-support';
import { readAccrualObserverConfiguration } from './replay-accrual-observer-config';

beforeEach(() => {
  // Observer schemas pin a fixed execution deadline with a Date.now()
  // expiry refine: freeze before it so happy-path tests stay green
  // regardless of wall-clock.
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-06T15:59:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

function fixture() {
  const sample = createAccrualObserverTestFixture();
  const read = vi.fn(async () => sample.privateBytes);
  const input = {
    observer: sample.observer,
    activation: sample.configuration.prefundedReplay,
    expectedAppSystemId: sample.configuration.appSystemId,
  };
  return { sample, read, input };
}

it('uses protected hash-verified configuration scope and its existing original HMAC key', async () => {
  const { sample, read, input } = fixture();
  const result = await readAccrualObserverConfiguration(input, read);
  expect(result).toEqual({
    observer: sample.observer,
    signingSecret: sample.secret,
    scope: {
      integrationId: sample.scope.integrationId,
      businessId: sample.scope.businessId,
      expectedSystemId: sample.scope.expectedSystemId,
    },
  });
  expect(read).toHaveBeenCalledExactlyOnceWith({
    path: '/run/pvb-replay/prefunded.json',
    maximumBytes: 131072,
    allowedModes: [0o400, 0o440, 0o600],
  });
});

it('refuses stale content hashes, unprotected reads and foreign physical DB without private errors', async () => {
  const { sample, input } = fixture();
  for (const read of [
    vi.fn().mockResolvedValue(Buffer.from('{}')),
    vi.fn().mockRejectedValue(new Error('private-password-marker')),
  ])
    await expect(readAccrualObserverConfiguration(input, read)).rejects.toThrow(
      'Staging accrual observer configuration unavailable'
    );
  await expect(
    readAccrualObserverConfiguration(
      { ...input, expectedAppSystemId: '1' },
      async () => sample.privateBytes
    )
  ).rejects.toThrow('Staging accrual observer configuration unavailable');
});

it.each([
  'integrationId',
  'businessId',
  'expectedSystemId',
])('refuses an actual sealed scope %s mismatch despite a matching independently supplied hash', async (field) => {
  const { sample, input } = fixture();
  const parsed = JSON.parse(sample.privateBytes.toString()) as {
    scope: Record<string, string>;
  };
  parsed.scope[field] =
    field === 'integrationId'
      ? '40000000-0000-4000-8000-000000000009'
      : field === 'businessId'
        ? 'foreign'
        : '1';
  const bytes = Buffer.from(JSON.stringify(parsed));
  input.activation.configurationSha256 = createHash('sha256')
    .update(bytes)
    .digest('hex');
  await expect(
    readAccrualObserverConfiguration(input, async () => bytes)
  ).rejects.toThrow('Staging accrual observer configuration unavailable');
});
