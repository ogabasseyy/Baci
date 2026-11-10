import { createHash } from 'node:crypto';
export const digestBytes = (bytes: Uint8Array | string) =>
  createHash('sha256').update(bytes).digest('hex');
export function canonicalManifest<T extends { files: Array<{ path: string }> }>(
  m: T
): string {
  return JSON.stringify({
    ...m,
    files: [...m.files].sort((a, b) =>
      a.path < b.path ? -1 : a.path > b.path ? 1 : 0
    ),
  });
}
