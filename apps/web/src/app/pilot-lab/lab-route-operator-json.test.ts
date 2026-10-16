import { linkSync } from 'node:fs';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MAX_OPERATOR_JSON_BYTES,
  readBoundedOperatorJson,
} from './lab-route-operator-json';

describe('readBoundedOperatorJson', () => {
  it('reads a small operator file round-trip', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pilot-opjson-'));
    const path = join(dir, 'inventory.json');
    await writeFile(path, '{"slots":{}}');
    await expect(readBoundedOperatorJson(path)).resolves.toBe('{"slots":{}}');
  });

  it('rejects files past the byte budget without decoding them', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pilot-opjson-'));
    const path = join(dir, 'huge.json');
    await writeFile(path, Buffer.alloc(MAX_OPERATOR_JSON_BYTES + 1, 0x7b));
    await expect(readBoundedOperatorJson(path)).rejects.toThrow(
      /exceeds the .* operator JSON budget/
    );
  });

  it('refuses a symlink at the operator path', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pilot-opjson-'));
    const outside = join(dir, 'outside.json');
    await writeFile(outside, '{"evil":true}');
    const path = join(dir, 'inventory.json');
    await symlink(outside, path);
    await expect(readBoundedOperatorJson(path)).rejects.toThrow(
      /not a regular file/
    );
  });

  it('refuses a FIFO at the operator path instead of blocking', async () => {
    if (process.platform === 'win32') {
      return;
    }
    const { execFileSync } = await import('node:child_process');
    const dir = await mkdtemp(join(tmpdir(), 'pilot-opjson-'));
    const path = join(dir, 'inventory.json');
    execFileSync('mkfifo', [path]);
    await expect(readBoundedOperatorJson(path)).rejects.toThrow(
      /not a regular file/
    );
  });

  it('never blocks while the operator path flaps between file and FIFO', async () => {
    if (process.platform === 'win32') {
      return;
    }
    const { execFileSync } = await import('node:child_process');
    const dir = await mkdtemp(join(tmpdir(), 'pilot-opjson-'));
    const path = join(dir, 'inventory.json');
    const payload = '{"slots":{}}';
    // Persistent inodes behind stable names; the swapper re-links
    // the live path between them with rm+link (no subprocess per
    // flap, so the lstat-to-open window is genuinely exercised).
    const slotFile = join(dir, 'slot-file.json');
    const slotFifo = join(dir, 'slot-fifo.json');
    await writeFile(slotFile, payload);
    execFileSync('mkfifo', [slotFifo]);
    linkSync(slotFile, path);
    let stop = false;
    const swapper = (async () => {
      while (!stop) {
        await rm(path, { force: true });
        linkSync(slotFifo, path);
        await rm(path, { force: true });
        linkSync(slotFile, path);
      }
    })();
    try {
      for (let i = 0; i < 200; i++) {
        // Every interleaving must settle: the file payload, the
        // FIFO refusal, or a mid-swap ENOENT — never a hang in the
        // open or the read loop.
        const outcome = await readBoundedOperatorJson(path).then(
          (text) => ({ error: null, text }),
          (error: unknown) => ({ error, text: null })
        );
        if (outcome.text !== null) {
          expect(outcome.text).toBe(payload);
        } else {
          expect(String((outcome.error as Error)?.message)).toMatch(
            /not a regular file|ENOENT/
          );
        }
      }
    } finally {
      stop = true;
      await swapper;
    }
  }, 30_000);
});
