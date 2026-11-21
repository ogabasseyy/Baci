import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const script = fileURLToPath(new URL('./verify-brilstash-feed.ts', import.meta.url));

it('reports a generic probe failure without emitting a receipt', () => {
  const dir = mkdtempSync(join(tmpdir(), 'brilstash-verify-'));
  try {
    const input = join(dir, 'probe.json');
    writeFileSync(input, JSON.stringify({
      installationId: '30000000-0000-4000-8000-000000000001',
      expectedGenerationId: '70000000-0000-4000-8000-000000000001',
      expectedPayloadDigest: 'a'.repeat(64),
    }));
    const result = spawnSync(process.execPath, ['--import', 'tsx', script, input, '--apply'], {
      encoding: 'utf8', timeout: 20000,
      env: {
        PATH: process.env.PATH,
        BRILSTASH_FEED_HOST: 'invalid..example',
        BRILSTASH_FEED_BEARER: 'synthetic'.repeat(5),
      },
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr.trim()).toBe('BrilStash feed verification failed');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 25000);
