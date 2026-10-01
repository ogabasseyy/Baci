import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const TAR = '/usr/bin/tar';
const LIST_MAX_BYTES = 4 * 1024 * 1024;
const TOOL_TIMEOUT_MS = 120_000;
const TOOL_ENV = { PATH: '/usr/bin:/bin', LC_ALL: 'C', LANG: 'C' };
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const fail = (cause) => {
  throw new TypeError('invalid Node archive', cause ? { cause } : undefined);
};

function listedNames(archiveBytes) {
  try {
    return execFileSync(TAR, ['-tJf', '-', '--'], {
      env: TOOL_ENV,
      input: archiveBytes,
      encoding: 'utf8',
      maxBuffer: LIST_MAX_BYTES,
      timeout: TOOL_TIMEOUT_MS,
    })
      .split('\n')
      .filter(Boolean);
  } catch (error) {
    fail(error);
  }
}

export function verifyTask9NodeArchive({
  archiveBytes,
  nodeBytes,
  archiveSha256,
  version,
}) {
  if (
    !Buffer.isBuffer(archiveBytes) ||
    !Buffer.isBuffer(nodeBytes) ||
    !/^[a-f0-9]{64}$/.test(archiveSha256) ||
    !/^\d+\.\d+\.\d+$/.test(version) ||
    hash(archiveBytes) !== archiveSha256
  )
    fail();
  const root = `node-v${version}-darwin-arm64/`;
  const member = `${root}bin/node`;
  const names = listedNames(archiveBytes);
  if (
    names.length === 0 ||
    names.filter((name) => name === member).length !== 1 ||
    names.some(
      (name) =>
        name.startsWith('/') ||
        name.includes('\0') ||
        name.includes('/../') ||
        name.startsWith('../') ||
        !name.startsWith(root)
    )
  )
    fail();
  let extracted;
  try {
    extracted = execFileSync(TAR, ['-xJOf', '-', member], {
      env: TOOL_ENV,
      input: archiveBytes,
      maxBuffer: Math.max(nodeBytes.length + 1, 1024 * 1024),
      timeout: TOOL_TIMEOUT_MS,
    });
  } catch (error) {
    fail(error);
  }
  if (!extracted.equals(nodeBytes)) fail();
}
