// Stale-coverage verdict for the merchant image pilot readiness gate:
// a --mounts artifact that omits a rendered mount must fail instead of
// narrowing coverage by omission. Split from
// merchant-image-pilot-readiness-checks.mjs under the repo line ceiling.
export function unexpectedMountProblems(slots, expectedMounts) {
  const problems = [];
  // Any rendered mount (a bound section with no status marker) outside
  // the expected set fails instead of escaping the gate silently.
  // Reporting rows (status set) are preflight's verdict, not
  // unexpected mounts.
  const expectedBindings = new Set(
    expectedMounts.map((mount) => mount.binding)
  );
  for (const slot of slots ?? []) {
    if (
      slot.binding != null &&
      slot.status == null &&
      !expectedBindings.has(slot.binding)
    ) {
      problems.push(
        `slot "${slot.slotId}" renders mount for unexpected binding "${slot.binding}" (stale --mounts?)`
      );
    }
  }
  return problems;
}
