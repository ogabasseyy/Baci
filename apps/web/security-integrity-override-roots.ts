import { delimiter } from 'node:path';

// Multi-root override for suites that scan every installed copy: a
// delimiter-separated list of unpacked tarballs, or null when unset so
// the caller falls back to the workspace scan. Empty string counts as
// unset. Refused under CI like the single-root hook.
export function overrideRoots(
  envVar: string | undefined,
  envName: string
): string[] | null {
  if (envVar === undefined || envVar === '') {
    return null;
  }
  if (process.env.CI !== undefined) {
    throw new Error(
      `${envName} is set in CI; refusing to test non-installed copies`
    );
  }
  console.warn(`[integrity-test] testing from ${envName}: ${envVar}`);
  // path.delimiter, not a hardcoded colon: ':' is a Windows drive-letter
  // component, so splitting on it would corrupt absolute override lists
  // on Windows.
  return envVar.split(delimiter).filter((root) => root.length > 0);
}
