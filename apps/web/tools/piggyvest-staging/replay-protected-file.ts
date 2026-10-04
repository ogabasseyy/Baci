import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { dirname, isAbsolute, normalize } from 'node:path';

interface FileFacts {
  uid: number;
  mode: number;
  nlink: number;
  size: number;
  dev: number;
  ino: number;
  mtimeMs: number;
  ctimeMs: number;
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
}

interface FileHandle {
  stat(): Promise<FileFacts>;
  readFile(): Promise<Buffer>;
  close(): Promise<void>;
}

interface Dependencies {
  inspect(path: string): Promise<FileFacts>;
  open(path: string, flags: number): Promise<FileHandle>;
}

export async function readProtectedReplayFile(
  input: {
    path: string;
    maximumBytes: number;
    allowedModes: readonly number[];
  },
  dependencies: Dependencies = { inspect: lstat, open }
): Promise<Buffer> {
  let handle: FileHandle | undefined;
  try {
    if (
      !isAbsolute(input.path) ||
      normalize(input.path) !== input.path ||
      input.path.includes('\0') ||
      !Number.isSafeInteger(input.maximumBytes) ||
      input.maximumBytes < 1
    )
      throw new Error('Invalid protected path');
    let parent = dirname(input.path);
    for (;;) {
      const directory = await dependencies.inspect(parent);
      if (
        !directory.isDirectory() ||
        directory.isSymbolicLink() ||
        directory.uid !== 0 ||
        (directory.mode & 0o022) !== 0
      )
        throw new Error('Invalid protected parent');
      const next = dirname(parent);
      if (next === parent) break;
      parent = next;
    }
    handle = await dependencies.open(
      input.path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
    );
    const before = await handle.stat();
    if (
      !before.isFile() ||
      before.uid !== 0 ||
      before.nlink !== 1 ||
      !input.allowedModes.includes(before.mode & 0o7777) ||
      before.size < 1 ||
      before.size > input.maximumBytes
    )
      throw new Error('Invalid protected file');
    const contents = await handle.readFile();
    const after = await handle.stat();
    if (
      contents.byteLength !== before.size ||
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs ||
      before.uid !== after.uid ||
      before.mode !== after.mode ||
      before.nlink !== after.nlink
    )
      throw new Error('Protected file changed');
    return contents;
  } catch {
    throw new Error('Staging replay protected file unavailable');
  } finally {
    await handle?.close().catch(() => undefined);
  }
}
