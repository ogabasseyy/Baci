import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, it } from 'vitest';

it('refuses unprivileged startup without revealing configuration details', () => {
  const dir = mkdtempSync(join(tmpdir(), 'baci-preflight-test-'));
  const bundle = join(dir, 'preflight.mjs');
  try {
    execFileSync(
      'pnpm',
      [
        'exec',
        'esbuild',
        'tools/experience-runner/privileged-preflight-main.ts',
        '--bundle',
        '--platform=node',
        '--format=esm',
        '--target=node24',
        '--tsconfig=tsconfig.experience-runner.json',
        "--banner:js=import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
        `--outfile=${bundle}`,
        '--log-level=error',
      ],
      { stdio: 'pipe' }
    );
    const script = `Object.defineProperty(process,'platform',{value:'linux'}); Object.defineProperty(process,'geteuid',{value:()=>1000}); await import(${JSON.stringify(pathToFileURL(bundle).href)});`;
    const result = spawnSync(
      process.execPath,
      ['--input-type=module', '-e', script],
      { encoding: 'utf8' }
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Runner preflight failed.');
    expect(result.stderr).not.toContain('INVALID_PREFLIGHT_IDENTITY');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
