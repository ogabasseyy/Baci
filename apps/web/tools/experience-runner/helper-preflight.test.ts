import { expect, it, vi } from 'vitest';
import { createHelperPreflight } from './helper-preflight';

it('runs only the fixed helper preflight and accepts its digest', async () => {
  const command = vi.fn(async () =>
    JSON.stringify({ toolchainDigest: 'a'.repeat(64) })
  );
  const verify = createHelperPreflight(command);
  await expect(verify()).resolves.toEqual({ toolchainDigest: 'a'.repeat(64) });
  expect(command).toHaveBeenCalledWith(
    '/usr/bin/sudo',
    ['-n', '/usr/local/libexec/baci-experience-helper', 'preflight'],
    undefined,
    900000
  );
});

it('rejects invalid or unexpected preflight responses', async () => {
  for (const reply of [
    '{}',
    '{"toolchainDigest":"bad"}',
    JSON.stringify({ toolchainDigest: 'a'.repeat(64), extra: true }),
    'x'.repeat(65537),
  ]) {
    await expect(createHelperPreflight(async () => reply)()).rejects.toThrow(
      'INVALID_PREFLIGHT_RECEIPT'
    );
  }
});
