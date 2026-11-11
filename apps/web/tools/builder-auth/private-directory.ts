import { lstat, realpath } from 'node:fs/promises';
import { dirname, isAbsolute } from 'node:path';

/** Only the service user may change entries; ancestors cannot be replaced by other users. */
export async function assertPrivateDirectory(directory: string) {
  if (!isAbsolute(directory) || (await realpath(directory)) !== directory)
    throw Error('UNTRUSTED_SOCKET_DIRECTORY');
  const stat = await lstat(directory);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    stat.uid !== process.getuid?.() ||
    (stat.mode & 0o077) !== 0
  )
    throw Error('UNTRUSTED_SOCKET_DIRECTORY');
  for (let ancestor = dirname(directory); ; ancestor = dirname(ancestor)) {
    const parent = await lstat(ancestor);
    const stickyRoot = parent.uid === 0 && (parent.mode & 0o1000) !== 0;
    if (
      !parent.isDirectory() ||
      parent.isSymbolicLink() ||
      (parent.uid !== 0 && parent.uid !== process.getuid?.()) ||
      ((parent.mode & 0o022) !== 0 && !stickyRoot)
    )
      throw Error('UNTRUSTED_SOCKET_DIRECTORY');
    if (ancestor === '/') break;
  }
}
