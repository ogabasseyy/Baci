import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readdirSync,
  readSync,
} from 'node:fs';
import { join } from 'node:path';
import { TASK9_SOURCE_MANIFEST_MAX_BYTES } from './source-manifest.mjs';
import { TASK9_PAYLOAD_FILES } from './task9-bootstrap.mjs';

const ENTRIES = TASK9_PAYLOAD_FILES;
const MAX_ENTRY_BYTES = 16_777_216;
const MAX_NODE_BYTES = 268_435_456;
const same = (left, right) =>
  left.dev === right.dev &&
  left.ino === right.ino &&
  left.uid === right.uid &&
  left.gid === right.gid &&
  left.mode === right.mode &&
  left.size === right.size;
const fail = () => {
  throw new TypeError('published Task 9 payload changed');
};

export function readPublishedTask9Files(
  directory,
  owner,
  { afterRead = () => undefined } = {}
) {
  const listed = readdirSync(directory).sort();
  const names = Object.keys(ENTRIES).sort();
  if (
    listed.length !== names.length ||
    listed.some((name, index) => name !== names[index])
  )
    fail();
  const handles = [];
  try {
    const directoryFd = openSync(
      directory,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW
    );
    handles.push({ fd: directoryFd });
    const directoryIdentity = fstatSync(directoryFd);
    const directoryPathIdentity = lstatSync(directory);
    if (
      !directoryIdentity.isDirectory() ||
      directoryIdentity.uid !== owner ||
      (directoryIdentity.mode & 0o777) !== 0o700 ||
      !same(directoryIdentity, directoryPathIdentity)
    )
      fail();
    const files = Object.fromEntries(
      Object.entries(ENTRIES).map(([name, mode]) => {
        const path = join(directory, name);
        const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
        handles.push({ fd, path });
        const identity = fstatSync(fd);
        if (
          !identity.isFile() ||
          identity.uid !== owner ||
          identity.mode.toString(8) !== mode ||
          !Number.isSafeInteger(identity.size) ||
          identity.size < 0 ||
          identity.size >
            (name === 'node'
              ? MAX_NODE_BYTES
              : name === 'manifest.json'
                ? TASK9_SOURCE_MANIFEST_MAX_BYTES
                : MAX_ENTRY_BYTES)
        )
          fail();
        const bytes = Buffer.alloc(identity.size);
        for (let offset = 0; offset < bytes.length; ) {
          const count = readSync(
            fd,
            bytes,
            offset,
            bytes.length - offset,
            offset
          );
          if (count < 1) fail();
          offset += count;
        }
        handles.at(-1).bytes = bytes;
        handles.at(-1).identity = identity;
        return [
          name,
          { bytes: Buffer.from(bytes), mode, owner, symlink: false },
        ];
      })
    );
    afterRead();
    const verify = () => {
      const currentDirectory = fstatSync(directoryFd);
      const pathDirectory = lstatSync(directory, { throwIfNoEntry: false });
      const currentEntries = readdirSync(directory).sort();
      const names = Object.keys(ENTRIES).sort();
      if (
        !pathDirectory ||
        pathDirectory.isSymbolicLink() ||
        currentEntries.length !== names.length ||
        currentEntries.some((name, index) => name !== names[index]) ||
        !same(directoryIdentity, currentDirectory) ||
        !same(directoryIdentity, pathDirectory)
      )
        fail();
      for (const handle of handles) {
        if (!handle.path) continue;
        const current = fstatSync(handle.fd);
        const path = lstatSync(handle.path, { throwIfNoEntry: false });
        if (
          !path ||
          path.isSymbolicLink() ||
          !same(handle.identity, current) ||
          !same(handle.identity, path)
        )
          fail();
        if (
          handle.identity.size >
          (handle.path?.endsWith('/node')
            ? MAX_NODE_BYTES
            : handle.path?.endsWith('/manifest.json')
              ? TASK9_SOURCE_MANIFEST_MAX_BYTES
              : MAX_ENTRY_BYTES)
        )
          fail();
        const bytes = Buffer.alloc(handle.identity.size);
        for (let offset = 0; offset < bytes.length; ) {
          const count = readSync(
            handle.fd,
            bytes,
            offset,
            bytes.length - offset,
            offset
          );
          if (count < 1) fail();
          offset += count;
        }
        if (!bytes.equals(handle.bytes)) fail();
      }
    };
    return {
      files,
      verify,
      close: () => {
        for (const handle of handles) closeSync(handle.fd);
      },
    };
  } catch (error) {
    for (const handle of handles) closeSync(handle.fd);
    throw error;
  }
}
