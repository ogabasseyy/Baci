import 'server-only';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { buildPrefundedCardActivationConfig } from './prefunded-card-activation-config';

export async function readPrefundedCardActivationConfig(
  filePath: string,
  now: Date = new Date()
) {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    if (
      constants.O_NOFOLLOW === undefined ||
      typeof process.getuid !== 'function'
    )
      throw new Error();
    handle = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const metadata = await handle.stat();
    if (
      !metadata.isFile() ||
      metadata.nlink !== 1 ||
      (metadata.mode & 0o077) !== 0 ||
      metadata.uid !== process.getuid() ||
      metadata.size === 0 ||
      metadata.size > 131_072
    )
      throw new Error();
    const bytes = Buffer.alloc(131_073);
    let bytesRead = 0;
    while (bytesRead < bytes.byteLength) {
      const result = await handle.read(
        bytes,
        bytesRead,
        bytes.byteLength - bytesRead,
        bytesRead
      );
      if (result.bytesRead === 0) break;
      bytesRead += result.bytesRead;
    }
    if (bytesRead === 0 || bytesRead > 131_072) throw new Error();
    const text = new TextDecoder('utf-8', { fatal: true }).decode(
      bytes.subarray(0, bytesRead)
    );
    const source: unknown = JSON.parse(text);
    const result = buildPrefundedCardActivationConfig(source, now);
    return result.ok ? { ...result, source } : result;
  } catch {
    return {
      ok: false as const,
      issues: [
        {
          prerequisite: 'owner-only regular UTF-8 JSON config file',
          status: 'missing_or_invalid' as const,
        },
      ],
    };
  } finally {
    await handle?.close().catch(() => undefined);
  }
}
