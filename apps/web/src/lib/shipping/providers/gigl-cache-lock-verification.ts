import { fstatSync, lstatSync, readFileSync, readSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { isMainThread } from 'node:worker_threads';

/** The descriptor must stay open for the entire read, provider run and write. */
export function hasVerifiedGiglCacheLock(
  directory: string,
  fd: number
): boolean {
  if (
    !isMainThread ||
    process.platform !== 'linux' ||
    !isAbsolute(directory) ||
    !Number.isInteger(fd) ||
    fd < 3
  )
    return false;
  try {
    const uid = process.getuid?.();
    if (uid === undefined) return false;
    const parent = lstatSync(directory);
    const path = lstatSync(join(directory, 'cache.lock'));
    const held = fstatSync(fd);
    if (
      !parent.isDirectory() ||
      parent.isSymbolicLink() ||
      parent.uid !== uid ||
      (parent.mode & 0o777) !== 0o700 ||
      !path.isFile() ||
      path.isSymbolicLink() ||
      path.uid !== uid ||
      path.nlink !== 1 ||
      (path.mode & 0o777) !== 0o600 ||
      !held.isFile() ||
      held.dev !== path.dev ||
      held.ino !== path.ino
    )
      return false;
    const owner = Buffer.alloc(32);
    const bytes = readSync(fd, owner, 0, owner.length, 0);
    if (owner.subarray(0, bytes).toString('utf8') !== `${process.pid}\n`)
      return false;
    return /^lock:\s+\d+:\s+FLOCK\s+ADVISORY\s+WRITE\s/m.test(
      readFileSync(`/proc/self/fdinfo/${fd}`, 'utf8')
    );
  } catch {
    return false;
  }
}
