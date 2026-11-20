import { expect, it, vi } from 'vitest';
import { verifyProtectedInstallation } from './privileged-preflight';

it('reads only the fixed protected release pin and returns the verified digest', async () => {
  const pin = { synthetic: true };
  const read = vi.fn(async () => pin);
  const verify = vi.fn(async () => ({
    toolchainDigest: 'a'.repeat(64),
    privateDetails: 'not returned',
  }));
  const makeVerifier = vi.fn(() => verify);
  await expect(
    verifyProtectedInstallation({ read, makeVerifier })
  ).resolves.toEqual({ toolchainDigest: 'a'.repeat(64) });
  expect(read).toHaveBeenCalledWith(
    '/etc/baci-experience/installation-pin.json'
  );
  expect(makeVerifier).toHaveBeenCalledWith(pin);
});

it('refuses a failed verification or malformed receipt', async () => {
  const read = async () => ({});
  await expect(
    verifyProtectedInstallation({
      read,
      makeVerifier: () => async () => {
        throw Error('mismatch');
      },
    })
  ).rejects.toThrow('mismatch');
  await expect(
    verifyProtectedInstallation({
      read,
      makeVerifier: () => async () => ({ toolchainDigest: 'bad' }),
    })
  ).rejects.toThrow('INVALID_PREFLIGHT_RECEIPT');
});
