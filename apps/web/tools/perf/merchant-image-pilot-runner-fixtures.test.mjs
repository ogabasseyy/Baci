import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  browserLog,
  browserLogSessions,
  finishBase,
  pngBuffer,
  ROUTE,
} from './merchant-image-pilot-runner-fixtures.mjs';

describe('merchant-image-pilot-runner-fixtures', () => {
  it('builds runner logs, PNG buffers, and a prepared finishBase fixture', async () => {
    expect(ROUTE).toContain('/pilot-lab/store/ogabassey');
    const png = await pngBuffer(40, 40);
    expect(png.byteLength).toBeGreaterThan(0);

    const dir = await mkdtemp(join(tmpdir(), 'pilot-runner-fixtures-'));
    const logPath = await browserLog(dir, 'single.log', '/tmp/p1');
    const logText = await readFile(logPath, 'utf8');
    expect(logText).toContain('--user-data-dir=/tmp/p1');
    expect(logText).toContain('"browserVersion": "154.0.0.0"');

    const multiPath = await browserLogSessions(dir, 'multi.log', [
      { profileDir: '/tmp/p1', version: null },
      { profileDir: '/tmp/p2', stamp: '1700000000.123', version: '154.0.0.0' },
    ]);
    const multiText = await readFile(multiPath, 'utf8');
    expect(multiText).toContain('--user-data-dir=/tmp/p1');
    expect(multiText).toContain('[1700000000.123]');

    const ready = await finishBase(dir);
    expect(ready.profileDir).toBe(join(dir, 'profile'));
    expect(ready.prepared.runId).toMatch(/^[0-9a-f-]{36}$/);
    expect(ready.base.har).toBe(join(dir, 'raw.har'));
    expect(ready.base.screenshot).toBe(join(dir, 'shot.png'));
  });
});
