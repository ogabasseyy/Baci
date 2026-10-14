import type { ParsedVersion } from './security-integrity-parsed-version';

export function isAtLeast(
  actual: ParsedVersion,
  minimum: readonly [number, number, number]
): boolean {
  for (let index = 0; index < 3; index += 1) {
    if (actual.triple[index] !== minimum[index]) {
      return actual.triple[index] > minimum[index];
    }
  }
  // Equal triple: a prerelease (1.9.0-beta) is below the floor (1.9.0).
  return !actual.prerelease;
}
