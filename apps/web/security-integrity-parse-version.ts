import type { ParsedVersion } from './security-integrity-parsed-version';

export function parseVersion(version: string): ParsedVersion {
  // Build metadata (+build) never affects precedence; a pre-release
  // suffix (-beta.1) orders BELOW the same numeric triple and is not
  // covered by the advisory's patched-version guarantee.
  const withoutBuild = version.split('+', 1)[0];
  const dash = withoutBuild.indexOf('-');
  const core = dash === -1 ? withoutBuild : withoutBuild.slice(0, dash);
  const segments = core.split('.');
  // Strict digit check per segment: parseInt would silently accept
  // trailing garbage ('1.9.0foo' → 0), weakening the malformed-input
  // rejection this gate promises.
  if (
    segments.length !== 3 ||
    segments.some((segment) => !/^\d+$/.test(segment))
  ) {
    throw new Error(`Unexpected version: ${version}`);
  }
  const parts = segments.map((segment) => Number.parseInt(segment, 10));
  return {
    triple: parts as [number, number, number],
    prerelease: dash !== -1,
  };
}
