import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('first-card recovery CLI entrypoint', () => {
  it('loads the react-server CLI graph and redacts invalid configuration', () => {
    const webDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
    const result = spawnSync(
      'pnpm',
      ['exec', 'tsx', 'src/scripts/run-prefunded-card-checkout-recovery.ts'],
      {
        cwd: webDirectory,
        encoding: 'utf8',
        timeout: 30_000,
        env: {
          ...process.env,
          NODE_OPTIONS: '--conditions=react-server',
          PREFUNDED_CARD_CHECKOUT_RECOVERY_LOCK_HELD: '1',
          PREFUNDED_CARD_CHECKOUT_RECOVERY_RUNNER_CONFIG: 'synthetic-invalid-config',
        },
      }
    );

    expect(result.status).toBe(1);
    expect(result.stdout.trim()).toBe('{"status":"failed"}');
    expect(result.stderr).toBe('');
  });
});
