import { createHash } from 'node:crypto';

/** Hash of the parsed JSON, so reformatting a vendored file cannot change it. */
export function canonicalJsonSha256(bytes: Buffer | string): string {
  return createHash('sha256')
    .update(JSON.stringify(JSON.parse(bytes.toString())))
    .digest('hex');
}
