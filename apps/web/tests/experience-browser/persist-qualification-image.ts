import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
/** Durable local evidence lives outside Playwright's automatically cleared output folder. */
export function persistQualificationImage(
  directory: string,
  name: string,
  bytes: Buffer
) {
  if (!/^[a-z0-9-]+\.png$/.test(name)) throw Error('Unsafe screenshot name');
  if (bytes.length > 2 * 1024 * 1024) throw Error('Screenshot byte budget');
  if (
    !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    throw Error('Invalid PNG evidence');
  mkdirSync(directory, { recursive: true });
  const filename = path.join(directory, name);
  writeFileSync(filename, bytes);
  return { filename, sha256: createHash('sha256').update(bytes).digest('hex') };
}
