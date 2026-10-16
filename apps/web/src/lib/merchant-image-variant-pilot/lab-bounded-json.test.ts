import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readBoundedLabJson } from './lab-bounded-json';

describe('readBoundedLabJson', () => {
  it('reads a regular file within budget', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pilot-bounded-json-'));
    const file = join(dir, 'manifest.json');
    writeFileSync(file, '{"ok":true}');
    await expect(readBoundedLabJson(file, 1024)).resolves.toBe('{"ok":true}');
  });

  it('refuses a FIFO swapped in for the manifest without hanging', async () => {
    // mkfifo exists only on POSIX. A blocking open would hang lab init
    // past every timeout instead of rejecting: O_NONBLOCK keeps the
    // open instant and the descriptor fstat refuses the non-file.
    if (process.platform === 'win32') {
      return;
    }
    const { execFileSync } = await import('node:child_process');
    const dir = mkdtempSync(join(tmpdir(), 'pilot-bounded-json-fifo-'));
    const fifo = join(dir, 'manifest.json');
    execFileSync('mkfifo', [fifo]);
    await expect(readBoundedLabJson(fifo, 1024)).rejects.toThrow(
      /not a regular file/
    );
  });
});
