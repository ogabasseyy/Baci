import { createHelperPreflight } from '../experience-runner/helper-preflight';
import { runCommand } from '../experience-runner/linux-runner';
import { createQualifiedPublicObserver } from './public-verification-qualified';

/** Operator-only, co-located startup; not enabled by ordinary production startup. */
export function createLocalPinnedPublicObserver(settings: {
  productOrigin: string;
  toolchainDigest: string;
}) {
  return createQualifiedPublicObserver({
    ...settings,
    verifyInstallation: createHelperPreflight(runCommand),
  });
}
