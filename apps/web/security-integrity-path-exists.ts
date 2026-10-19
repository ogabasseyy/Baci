import { statSync } from 'node:fs';
import { isBenignFsError } from './security-integrity-benign-fs-error';

// Throwing existence probe for the install scanner: `existsSync`
// swallows EACCES/EPERM/I/O errors as "absent", which would silently
// skip an unreadable dependency tree while the EVERY-copy gate
// reports green. Only ENOENT/ENOTDIR mean absent; anything else
// throws fail-closed.
export function pathExists(path: string): boolean {
  try {
    statSync(path);
    return true;
  } catch (error) {
    if (!isBenignFsError(error)) {
      throw error;
    }
    return false;
  }
}
