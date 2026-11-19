import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Node gives a symlinked entrypoint's import.meta.url its real path while
// process.argv[1] keeps the invoked (symlink) path. Isolated releases invoke
// jobs through such links, so compare resolved paths.
export function isEntrypoint(moduleUrl, invokedPath = process.argv[1]) {
  if (!invokedPath) return false;
  try {
    return realpathSync(invokedPath) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}
