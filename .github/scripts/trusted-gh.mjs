import { lstatSync } from 'node:fs';

export const TRUSTED_GH_PATH = '/home/bassey/.local/bin/gh';

export function validateTrustedGhBinary(path = TRUSTED_GH_PATH, { lstat = lstatSync, expectedUid = 1001 } = {}) {
  let stat;
  try {
    stat = lstat(path);
  } catch (error) {
    throw new Error(`trusted GitHub CLI unavailable (${error?.code ?? 'stat failed'})`);
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== expectedUid || (stat.mode & 0o111) === 0 || (stat.mode & 0o022) !== 0) {
    throw new Error('trusted GitHub CLI identity or permissions are invalid');
  }
  return path;
}

if (process.argv[1]?.endsWith('/trusted-gh.mjs')) {
  try {
    process.stdout.write(`${validateTrustedGhBinary()}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
