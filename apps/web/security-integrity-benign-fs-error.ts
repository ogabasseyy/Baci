// Only "nothing could be installed here" errors are safe to skip:
// ENOENT (missing path) and ENOTDIR (a file where a directory was
// expected — files cannot contain node_modules). Anything else
// (EACCES, EPERM, I/O errors) is rethrown so an unreadable directory
// cannot silently narrow the EVERY-copy claim.
export function isBenignFsError(error: unknown): boolean {
  const code = (error as { code?: unknown })?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}
