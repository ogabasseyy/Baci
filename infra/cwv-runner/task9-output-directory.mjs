import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
} from 'node:fs';

const OUTPUT_ENTRIES = Object.freeze([
  'bootstrap-review-envelope.json',
  'bootstrap-review-envelope.sha256',
  'payload',
]);

const exactDirectory = (left, right) =>
  right &&
  !right.isSymbolicLink() &&
  right.isDirectory() &&
  right.dev === left.dev &&
  right.ino === left.ino &&
  right.uid === left.uid &&
  right.gid === left.gid &&
  right.mode === left.mode &&
  (right.mode & 0o777) === 0o700;

function createDirectory(path, options) {
  mkdirSync(path, options);
  const fd = openSync(
    path,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW
  );
  try {
    fchmodSync(fd, 0o700);
    fsyncSync(fd);
    return { fd, identity: fstatSync(fd) };
  } catch (error) {
    closeSync(fd);
    throw error;
  }
}

export function withTask9OutputDirectory(
  outputRoot,
  publish,
  {
    afterPublishValidation = () => undefined,
    makeDirectory = createDirectory,
  } = {}
) {
  let directoryFd;
  try {
    const assertEntries = () => {
      const entries = readdirSync(outputRoot).sort();
      if (
        entries.length !== OUTPUT_ENTRIES.length ||
        entries.some((entry, index) => entry !== OUTPUT_ENTRIES[index])
      )
        throw new TypeError('Task 9 output entry set changed');
    };
    const createdHandle = makeDirectory(outputRoot, { mode: 0o700 });
    if (
      !createdHandle ||
      !Number.isSafeInteger(createdHandle.fd) ||
      !createdHandle.identity
    )
      throw new TypeError('unsafe Task 9 output directory');
    directoryFd = createdHandle.fd;
    const created = createdHandle.identity;
    if (
      !created.isDirectory() ||
      created.uid !== process.getuid() ||
      (created.mode & 0o777) !== 0o700
    )
      throw new TypeError('unsafe Task 9 output directory');
    const result = publish();
    if (
      !exactDirectory(created, fstatSync(directoryFd)) ||
      !exactDirectory(created, lstatSync(outputRoot, { throwIfNoEntry: false }))
    )
      throw new TypeError('Task 9 output directory changed');
    assertEntries();
    afterPublishValidation();
    if (
      !exactDirectory(created, fstatSync(directoryFd)) ||
      !exactDirectory(created, lstatSync(outputRoot, { throwIfNoEntry: false }))
    )
      throw new TypeError('Task 9 output directory changed');
    assertEntries();
    return result;
  } finally {
    if (directoryFd !== undefined) closeSync(directoryFd);
  }
}
