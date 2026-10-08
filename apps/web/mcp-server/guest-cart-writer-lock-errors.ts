import { readFileSync } from 'node:fs';

// Shared failure helpers for the writer lock: permission failures map to an
// actionable remediation (every guest-cart call would otherwise fail with a
// raw errno), and second-writer refusals crash the process at startup with
// both PIDs on the ops trail.
export function isPermissionError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException)?.code;
  return code === 'EACCES' || code === 'EPERM' || code === 'EROFS';
}

// Runtime cart writes fail the same typed way as a misconfigured volume,
// plus disk-full: callers already handle GuestCartStorageUnavailableError.
export function isStorageWriteError(error: unknown): boolean {
  if (isPermissionError(error)) return true;
  return (error as NodeJS.ErrnoException)?.code === 'ENOSPC';
}

export function guestCartWriteError(
  target: string,
  cause: unknown
): GuestCartStorageUnavailableError {
  const detail =
    cause instanceof Error ? cause.message : 'unknown filesystem error';
  return new GuestCartStorageUnavailableError(
    `Guest-cart write failed: ${target} (${detail}). The cart volume may be unwritable or full.`
  );
}

// Typed storage-config failures (unwritable directory, wrong mode): the
// server degrades the guest-cart tool on these while keeping catalog tools
// up. A second-writer refusal is NOT one of these — that deployment bug
// still crashes the process.
export class GuestCartStorageUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GuestCartStorageUnavailableError';
  }
}

// A named volume mounted over the image directory does not inherit the
// image-layer chown when the volume predates it (or was created root-owned),
// so refuse with remediation instead of a raw errno: every guest-cart call
// would otherwise fail at runtime with a generic error.
export function directoryNotWritableError(
  target: string,
  cause: unknown
): GuestCartStorageUnavailableError {
  const uid =
    typeof process.getuid === 'function' ? process.getuid() : 'unknown';
  const detail =
    cause instanceof Error ? cause.message : 'unknown filesystem error';
  return new GuestCartStorageUnavailableError(
    `Guest-cart directory is not writable: ${target} (server uid ${uid}, ${detail}). ` +
      `Make the cart volume writable by the server user, e.g. chown the mounted directory to uid ${uid}.`
  );
}

export function refuseSecondWriter(lockPath: string, directory: string): never {
  // Fail closed with an actionable record: the refusal crashes the process
  // at startup, so log the lock path and both PIDs for the ops alert trail
  // (e.g. an accidental `--scale 2` under plain compose).
  let holder = 'unknown';
  try {
    holder = readFileSync(lockPath, 'utf8');
  } catch {
    /* Fall through with an unknown holder. */
  }
  console.error(
    `[guest-cart] refusing second writer for ${lockPath} (held by ${holder}, claimant pid ${process.pid})`
  );
  throw new Error(
    `Another MCP writer owns ${directory}; refusing to start a second guest-cart writer.`
  );
}
