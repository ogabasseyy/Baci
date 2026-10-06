import { lstat, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const inside = (root, filename) => filename === root || filename.startsWith(root + path.sep);

export async function publishPrivateArtifact({ repository, receiver, destination, files }) {
  if (typeof destination !== 'string' || !path.isAbsolute(destination)
      || path.resolve(destination) !== destination || !(files instanceof Map) || files.size === 0)
    throw new Error('Fresh absolute output directory required');
  for (const [name, bytes] of files) {
    if (!/^(?:[a-zA-Z0-9][a-zA-Z0-9_.-]*|captures\/[a-f0-9]{64}\.source)$/.test(name)
        || !Buffer.isBuffer(bytes)) throw new Error('Artifact path or bytes refused');
  }
  const [root, overlayRoot, parent] = await Promise.all([
    realpath(repository), realpath(receiver), realpath(path.dirname(destination)),
  ]);
  const output = path.join(parent, path.basename(destination));
  if (inside(root, output) || inside(overlayRoot, output))
    throw new Error('Output inside canonical or receiver sources refused');
  await mkdir(output, { mode: 0o700 });
  const created = await lstat(output);
  try {
    if ((created.mode & 0o777) !== 0o700) throw new Error('Output permissions refused');
    if ([...files.keys()].some((name) => name.startsWith('captures/')))
      await mkdir(path.join(output, 'captures'), { mode: 0o700 });
    for (const [name, bytes] of files)
      await writeFile(path.join(output, name), bytes, { mode: 0o600, flag: 'wx' });
    return output;
  } catch (error) {
    const current = await lstat(output).catch(() => null);
    if (current && !current.isSymbolicLink() && current.ino === created.ino && current.dev === created.dev)
      await rm(output, { recursive: true, force: true });
    throw error;
  }
}
