// All-or-nothing quality-sheet publication, split from quality-sheet.mjs
// under the repo line ceiling: temp + sync + atomic rename, plus the
// directory-entry sync that makes the rename durable.
import { open, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fsyncDir, isUnsupportedSyncError } from './disk-guards.mjs';
import { PilotSheetError } from './quality-sheet-mounts.mjs';

// A direct write truncates the final path first, so an interruption or
// filesystem error leaves a valid-looking HTML prefix showing only the
// early assets — and a reviewer approves an incomplete sample. Temp +
// sync + atomic rename (same pattern as the inventory publish) leaves
// the old sheet or the new one, never a prefix.
export async function publishQualitySheet(out, html, options = {}) {
  const tmp = join(
    dirname(out),
    `.quality-sheet-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`
  );
  const handle = await open(tmp, 'w');
  try {
    await handle.writeFile(html);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(tmp, out);
  const syncDir = options.fsyncDir ?? fsyncDir;
  try {
    await syncDir(dirname(out));
  } catch (error) {
    if (!isUnsupportedSyncError(error)) {
      throw new PilotSheetError(
        `sheet directory sync failed (${error?.code ?? 'unknown'})`
      );
    }
  }
}
