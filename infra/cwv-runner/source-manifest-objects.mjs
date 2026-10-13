import { createHash } from 'node:crypto';

import { git } from './source-manifest-git.mjs';

const fail = (message) => {
  throw new TypeError(message);
};

export function verifyGitObjects(cwd, objectIds, { includeBytes = true } = {}) {
  const ids = [...new Set(objectIds)];
  if (
    ids.some(
      (objectId) => typeof objectId !== 'string' || /[\r\n]/.test(objectId)
    )
  )
    fail('malformed Git object response');
  const verified = new Map();
  const output = git(
    cwd,
    ['cat-file', includeBytes ? '--batch' : '--batch-check'],
    `${ids.join('\n')}\n`,
    null
  );
  let offset = 0;
  for (const objectId of ids) {
    const headerEnd = output.indexOf(0x0a, offset);
    if (headerEnd < 0) fail('malformed Git object response');
    const [reported, type, sizeText] = output
      .subarray(offset, headerEnd)
      .toString('utf8')
      .split(' ');
    const size = Number(sizeText);
    if (
      reported !== objectId ||
      !/^(blob|commit|tree|tag)$/.test(type) ||
      !Number.isSafeInteger(size) ||
      size < 0
    )
      fail('malformed Git object response');
    if (!includeBytes) {
      verified.set(`${cwd}\0${objectId}`, { type, size });
      offset = headerEnd + 1;
      continue;
    }
    const start = headerEnd + 1;
    if (
      reported !== objectId ||
      !/^(blob|commit|tree|tag)$/.test(type) ||
      !Number.isSafeInteger(size) ||
      size < 0 ||
      output.length < start + size + 1
    )
      fail('malformed Git object response');
    const bytes = output.subarray(start, start + size);
    const algorithm = objectId.length === 64 ? 'sha256' : 'sha1';
    const actual = createHash(algorithm)
      .update(`${type} ${size}\0`)
      .update(bytes)
      .digest('hex');
    if (actual !== objectId) fail('Git object hash mismatch');
    verified.set(`${cwd}\0${objectId}`, { type, bytes: Buffer.from(bytes) });
    offset = start + size + 1;
  }
  return verified;
}
