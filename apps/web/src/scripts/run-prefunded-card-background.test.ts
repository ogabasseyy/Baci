import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('first-card background CLI entrypoint', () => {
  it('fails closed without the private FD9 lock and emits no details', () => {
    const webDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
    const result = spawnSync(
      'pnpm',
      ['exec', 'tsx', 'src/scripts/run-prefunded-card-background.ts'],
      {
        cwd: webDirectory,
        encoding: 'utf8',
        timeout: 30_000,
        env: {
          ...process.env,
          NODE_OPTIONS: '--conditions=react-server',
          PREFUNDED_CARD_BACKGROUND_LOCK_HELD: '1',
        },
      }
    );

    expect(result.status).toBe(1);
    expect(result.stdout.trim()).toBe('{"status":"failed"}');
    expect(result.stderr).toBe('');
  });
});
