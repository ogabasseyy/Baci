import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readdir, readlink } from 'node:fs/promises';
import { join } from 'node:path';

export async function fileDigest(path: string) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

/** Read-only inventory, including modes, owners, symlink targets and extra files.
 * Expected digests must come from a separately trusted frozen installation.
 * This does not make a writable host filesystem immutable or establish provenance. */
export async function inventoryInstallationTree(root: string) {
  const rootStat = await lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink())
    throw Error('INVALID_INSTALLATION_ROOT');
  const hash = createHash('sha256');
  let entries = 0;
  let bytes = 0;
  async function visit(relative: string, depth: number): Promise<void> {
    if (++entries > 200000 || depth > 128)
      throw Error('INSTALLATION_INVENTORY_BUDGET');
    const path = join(root, relative);
    const stat = await lstat(path);
    const type = stat.isDirectory()
      ? 'directory'
      : stat.isFile()
        ? 'file'
        : stat.isSymbolicLink()
          ? 'symlink'
          : undefined;
    if (!type) throw Error('UNSUPPORTED_INSTALLATION_ENTRY');
    let content = '';
    if (type === 'file') {
      bytes += stat.size;
      if (bytes > 16 * 1024 ** 3) throw Error('INSTALLATION_INVENTORY_BUDGET');
      content = await fileDigest(path);
      const after = await lstat(path);
      if (
        after.ino !== stat.ino ||
        after.size !== stat.size ||
        after.mtimeMs !== stat.mtimeMs ||
        after.ctimeMs !== stat.ctimeMs
      )
        throw Error('INSTALLATION_CHANGED');
    } else if (type === 'symlink') content = await readlink(path);
    hash.update(
      `${JSON.stringify([relative, type, stat.mode & 0o7777, stat.uid, stat.gid, content])}\n`
    );
    if (type === 'directory')
      for (const name of (await readdir(path)).sort())
        await visit(join(relative, name), depth + 1);
  }
  await visit('', 0);
  return { digest: hash.digest('hex'), entries, bytes };
}
