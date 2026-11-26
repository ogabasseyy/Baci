import { lstatSync, unlinkSync } from 'node:fs';
import { createConnection } from 'node:net';
import { dirname, isAbsolute } from 'node:path';
import { assertPrivateDirectory } from './private-directory.ts';

function socketEntry(path: string) {
  return lstatSync(path, { throwIfNoEntry: false });
}

function isStale(path: string) {
  return new Promise<boolean>((resolve, reject) => {
    const socket = createConnection(path);
    socket.setTimeout(1000, () => {
      socket.destroy();
      reject(Error('PRIVATE_SOCKET_PROBE_TIMEOUT'));
    });
    socket.once('connect', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'ECONNREFUSED') resolve(true);
      else if (error.code === 'ENOENT') resolve(false);
      else reject(error);
    });
  });
}

/** Reclaim only a stale socket owned by the service user in its private directory. */
export async function preparePrivateSocketPath(path: string) {
  if (!isAbsolute(path)) throw Error('UNTRUSTED_SOCKET_DIRECTORY');
  await assertPrivateDirectory(dirname(path));
  const entry = socketEntry(path);
  if (!entry) return;
  if (!entry.isSocket() || entry.uid !== process.getuid?.())
    throw Error('UNTRUSTED_SOCKET_ENTRY');
  if (!(await isStale(path))) return;
  const current = socketEntry(path);
  if (!current) return;
  if (
    !current.isSocket() ||
    current.uid !== entry.uid ||
    current.dev !== entry.dev ||
    current.ino !== entry.ino
  )
    throw Error('PRIVATE_SOCKET_ENTRY_CHANGED');
  unlinkSync(path);
}
