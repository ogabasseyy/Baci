import { constants } from 'node:fs';
import { chmod, lstat, open } from 'node:fs/promises';
import { dirname } from 'node:path';

export function assertManagedFile(info) {
  if (
    !info.isFile() ||
    info.uid !== 0 ||
    info.mode & 0o222 ||
    info.mode & 0o007 ||
    info.nlink !== 1 ||
    info.size > 262144 ||
    info.size < 2
  )
    throw new Error('Root-owned immutable input required');
}

export async function readManagedFile(path) {
  if (
    ![
      '/etc/baci-savings-gateway/binding.json',
      '/etc/baci-savings-gateway/startup-evidence.json',
    ].includes(path)
  )
    throw new Error('Managed input path rejected');
  for (let directory = dirname(path); ; directory = dirname(directory)) {
    const info = await lstat(directory);
    if (!info.isDirectory() || info.uid !== 0 || info.mode & 0o022)
      throw new Error('Trusted input directory required');
    if (directory === '/') break;
  }
  const file = await open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
  );
  try {
    const before = await file.stat();
    assertManagedFile(before);
    const bytes = await file.readFile('utf8');
    const after = await file.stat();
    assertManagedFile(after);
    if (
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      Buffer.byteLength(bytes) > 262144
    )
      throw new Error('Managed input changed');
    return {
      value: JSON.parse(bytes),
      fingerprint: `${after.dev}:${after.ino}:${after.size}:${after.mtimeMs}:${after.ctimeMs}`,
    };
  } finally {
    await file.close();
  }
}

export function assertManagedRuntime(info, uid, gid) {
  if (
    uid === 0 ||
    !info.isDirectory() ||
    info.uid !== uid ||
    info.gid !== gid ||
    (info.mode & 0o7777) !== 0o750
  )
    throw new Error('Managed runtime permissions rejected');
}

export function assertManagedSocket(info, uid, gid) {
  if (
    !info.isSocket() ||
    info.uid !== uid ||
    info.gid !== gid ||
    (info.mode & 0o7777) !== 0o660
  )
    throw new Error('Managed socket permissions rejected');
}

export async function secureManagedSocket(
  path,
  info,
  uid,
  gid,
  io = { chmod, lstat }
) {
  if (
    !info.isSocket() ||
    info.uid !== uid ||
    info.gid !== gid ||
    (info.mode & 0o7777) !== 0o666
  )
    throw new Error('Managed socket creation rejected');
  await io.chmod(path, 0o660);
  const after = await io.lstat(path);
  assertManagedSocket(after, uid, gid);
  if (info.dev !== after.dev || info.ino !== after.ino)
    throw new Error('Managed socket replaced');
}
