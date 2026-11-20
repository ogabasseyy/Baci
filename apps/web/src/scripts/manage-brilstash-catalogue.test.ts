import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const script = fileURLToPath(new URL('./manage-brilstash-catalogue.ts', import.meta.url));
const id = '30000000-0000-4000-8000-000000000001';

it.each([
  ['suspend', { p_installation_id: id, p_reason: 'review evidence' }, 'BrilStash write requires --apply'],
  ['inspect-installation', { p_installation_id: id }, 'Invalid BrilStash CLI database configuration'],
] as const)('checks apply and configuration for %s', (action, args, message) => {
  const dir = mkdtempSync(join(tmpdir(), 'brilstash-manage-'));
  try {
    const input = join(dir, 'action.json');
    writeFileSync(input, JSON.stringify({ action, args }));
    const result = spawnSync(process.execPath, ['--import', 'tsx', script, input], {
      encoding: 'utf8', env: { PATH: process.env.PATH }, timeout: 20000,
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr.trim()).toBe(message);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 25000);
