import { mkdtemp, symlink, writeFile } from 'node:fs/promises';
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
});
