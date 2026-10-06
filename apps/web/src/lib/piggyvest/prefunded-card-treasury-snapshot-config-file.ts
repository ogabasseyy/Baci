import 'server-only';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { prefundedCardTreasurySnapshotConfigSchema } from '@/schemas/prefunded-card-treasury-snapshot-config';

const MAX_CONFIG_BYTES = 131_072;

export async function readPrefundedCardTreasurySnapshotConfig(
  filePath: string
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
      (metadata.mode & 0o7777) !== 0o600 ||
      metadata.uid !== process.getuid() ||
      metadata.size === 0 ||
      metadata.size > MAX_CONFIG_BYTES
    )
      throw new Error();

    const bytes = Buffer.alloc(MAX_CONFIG_BYTES + 1);
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
    if (bytesRead === 0 || bytesRead > MAX_CONFIG_BYTES) throw new Error();
    const text = new TextDecoder('utf-8', { fatal: true }).decode(
      bytes.subarray(0, bytesRead)
    );
    const parsed = prefundedCardTreasurySnapshotConfigSchema.safeParse(
      JSON.parse(text)
    );
    if (!parsed.success) throw new Error();
    return { ok: true as const, configuration: parsed.data };
  } catch {
    return { ok: false as const };
  } finally {
    await handle?.close().catch(() => undefined);
  }
}
