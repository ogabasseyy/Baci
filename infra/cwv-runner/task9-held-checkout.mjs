import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  realpathSync,
} from 'node:fs';
import { join } from 'node:path';

export function withHeldTask9Checkout(path, expectedRoot, callback) {
  const fd = openSync(
    path,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW
  );
  try {
    const initial = fstatSync(fd);
    const gitPath = join(path, '.git');
    const gitInitial = lstatSync(gitPath, { throwIfNoEntry: false });
    if (
      gitInitial &&
      (gitInitial.isSymbolicLink() ||
        (!gitInitial.isDirectory() && !gitInitial.isFile()))
    )
      throw new TypeError('unsafe Task 9 Git metadata');
    const guard = () => {
      const current = fstatSync(fd);
      const visible = lstatSync(path, { throwIfNoEntry: false });
      const gitCurrent = lstatSync(gitPath, { throwIfNoEntry: false });
      if (
        !visible ||
        visible.isSymbolicLink() ||
        !visible.isDirectory() ||
        visible.dev !== initial.dev ||
        visible.ino !== initial.ino ||
        visible.uid !== initial.uid ||
        visible.gid !== initial.gid ||
        visible.mode !== initial.mode ||
        current.dev !== initial.dev ||
        current.ino !== initial.ino ||
        current.uid !== initial.uid ||
        current.gid !== initial.gid ||
        current.mode !== initial.mode ||
        realpathSync(path) !== expectedRoot ||
        Boolean(gitInitial) !== Boolean(gitCurrent) ||
        (gitInitial &&
          (!gitCurrent ||
            gitCurrent.isSymbolicLink() ||
            (!gitCurrent.isDirectory() && !gitCurrent.isFile()) ||
            gitCurrent.dev !== gitInitial.dev ||
            gitCurrent.ino !== gitInitial.ino ||
            gitCurrent.uid !== gitInitial.uid ||
            gitCurrent.gid !== gitInitial.gid ||
            gitCurrent.mode !== gitInitial.mode))
      )
        throw new TypeError('unsafe Task 9 checkout');
    };
    if (!initial.isDirectory() || initial.uid !== process.getuid())
      throw new TypeError('unsafe Task 9 checkout');
    guard();
    return callback({ fd, path, guard });
  } finally {
    closeSync(fd);
  }
}
