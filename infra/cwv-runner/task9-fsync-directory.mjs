import { closeSync, constants, fsyncSync, openSync } from 'node:fs';

export function fsyncTask9Directory(
  path,
  { close = closeSync, fsync = fsyncSync, open = openSync } = {}
) {
  const fd = open(
    path,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW
  );
  try {
    fsync(fd);
  } finally {
    close(fd);
  }
}
