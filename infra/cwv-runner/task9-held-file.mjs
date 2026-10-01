import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
} from 'node:fs';
import { resolve } from 'node:path';

const same = (left, right) =>
  left.dev === right.dev &&
  left.ino === right.ino &&
  left.uid === right.uid &&
  left.gid === right.gid &&
  left.mode === right.mode &&
  left.size === right.size;
const fail = (cause) => {
  throw new TypeError('unsafe Task 9 input', cause ? { cause } : undefined);
};

function readExact(fd, size) {
  const bytes = Buffer.alloc(size);
  for (let offset = 0; offset < bytes.length; ) {
    const count = readSync(fd, bytes, offset, bytes.length - offset, offset);
    if (count < 1) fail();
    offset += count;
  }
  return bytes;
}

export function readHeldTask9File(
  path,
  expectedMode,
  { afterRead = () => undefined, hold = false, maxBytes } = {}
) {
  const absolute = resolve(path);
  let fd;
  let closed = false;
  const close = () => {
    if (fd !== undefined && !closed) {
      closeSync(fd);
      closed = true;
    }
  };
  try {
    fd = openSync(
      absolute,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
    );
    const before = fstatSync(fd);
    if (
      !before.isFile() ||
      before.uid !== process.getuid() ||
      (before.mode & 0o777) !== expectedMode ||
      !Number.isSafeInteger(before.size) ||
      before.size < 0 ||
      (maxBytes !== undefined &&
        (!Number.isSafeInteger(maxBytes) ||
          maxBytes < 0 ||
          before.size > maxBytes))
    )
      fail();
    const bytes = readExact(fd, before.size);
    afterRead();
    const verify = () => {
      if (closed) fail();
      const currentBytes = readExact(fd, before.size);
      const after = fstatSync(fd);
      const current = lstatSync(absolute, { throwIfNoEntry: false });
      if (
        !current ||
        current.isSymbolicLink() ||
        !current.isFile() ||
        !same(before, after) ||
        !same(after, current) ||
        !currentBytes.equals(bytes)
      )
        fail();
      return Buffer.from(currentBytes);
    };
    verify();
    const result = { bytes: Buffer.from(bytes), path: absolute };
    if (hold) return { ...result, close, verify };
    return result;
  } catch (error) {
    close();
    fail(error);
  } finally {
    if (!hold) close();
  }
}
