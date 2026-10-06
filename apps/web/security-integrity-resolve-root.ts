import { installedRoot } from './security-integrity-installed-root';

export function resolveRoot(
  packageName: string,
  envVar: string | undefined,
  envName: string
): string {
  // Empty string counts as unset: FOO_ROOT="" in a local shell falls
  // back to the installed copy instead of failing later with a
  // confusing resolution error.
  if (envVar !== undefined && envVar !== '') {
    // Verification hook only: point at an unpacked tarball to confirm
    // behavioral tests fail on pre-fix releases. Refused under CI so a
    // green run always guards the workspace-resolved dependency.
    if (process.env.CI !== undefined) {
      throw new Error(
        `${envName} is set in CI; refusing to test a non-installed copy`
      );
    }
    console.warn(`[integrity-test] testing ${packageName} from: ${envVar}`);
    return envVar;
  }
  return installedRoot(packageName);
}
