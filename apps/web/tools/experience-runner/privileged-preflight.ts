import { readPrivateAuthConfig } from '../builder-auth/private-config-file';
import { createPinnedLinuxInstallationVerifier } from './installation-verifier';

/** Root-only entry reads the operator-installed pin, never a request path. */
export async function verifyProtectedInstallation(
  deps: {
    read(path: string): Promise<unknown>;
    makeVerifier(pin: unknown): () => Promise<{ toolchainDigest: string }>;
  } = {
    read: readPrivateAuthConfig,
    makeVerifier: createPinnedLinuxInstallationVerifier,
  }
) {
  const pin = await deps.read('/etc/baci-experience/installation-pin.json');
  const result = await deps.makeVerifier(pin)();
  if (!/^[a-f0-9]{64}$/.test(result.toolchainDigest))
    throw Error('INVALID_PREFLIGHT_RECEIPT');
  return { toolchainDigest: result.toolchainDigest };
}
