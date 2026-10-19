// Mounts artifact publication for the merchant image pilot preflight.
//
// The readiness gate treats the --write-mounts file as the complete
// expected-mount authority, so it is published only on complete success:
// every failure path invalidates prior artifacts instead, so a stale
// list (missing a newly added binding) can never certify a green
// downstream report.
import { rm, writeFile } from 'node:fs/promises';

// Remove any prior artifact. Returns the failure note to append, or
// null when no --write-mounts target was configured.
export async function invalidateMounts(writeMounts, reason) {
  if (!writeMounts) {
    return null;
  }
  const removal = await rm(writeMounts, { force: true }).catch(
    (error) =>
      ` (stale artifact removal failed: ${error instanceof Error ? error.message : String(error)})`
  );
  return `mounts not written: ${reason}${removal ?? ''}`;
}

// Publish the accepted list. Returns null on success or the failure
// note to append. A failed write removes the target so no downstream
// gate consumes a truncated expectation list.
export async function publishMounts(writeMounts, accepted) {
  if (!writeMounts) {
    return null;
  }
  try {
    await writeFile(writeMounts, `${JSON.stringify(accepted, null, 2)}\n`);
  } catch (error) {
    await rm(writeMounts, { force: true }).catch(() => undefined);
    return `mounts not written: ${error instanceof Error ? error.message : String(error)}`;
  }
  return null;
}
