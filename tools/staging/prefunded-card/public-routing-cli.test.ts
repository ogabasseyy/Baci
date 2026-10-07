import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const appRequire = createRequire(
  resolve(__dirname, '../../../apps/web/package.json')
);
const entrypoint = join(__dirname, 'public-routing-cli.ts');
const cli = appRequire.resolve('tsx/cli');

function run(args: string[]) {
  return spawnSync(process.execPath, [cli, entrypoint, ...args], {
    encoding: 'utf8',
    timeout: 10_000,
    env: { PATH: process.env.PATH, HOME: process.env.HOME },
  });
}

describe('public routing CLI', () => {
  it('rejects incomplete arguments without printing their values', () => {
    const result = run(['--unknown', 'private-input']);
    expect(result.status).toBe(1);
    expect(result.stdout + result.stderr).not.toContain('private-input');
    expect(result.stderr).toContain('Public routing candidate refused');
  });

  it('writes deterministic inactive candidates and refuses changed output', () => {
    const directory = mkdtempSync(join(tmpdir(), 'baci-routing-cli-test-'));
    try {
      const vercel = JSON.stringify({
        version: 3,
        routes: [{ handle: 'filesystem' }],
      });
      const nginx =
        'server { listen 443 ssl; server_name staging-auth.ogabassey.com; location = /api/storefront/customer/savings/goals { proxy_pass http://127.0.0.1:4795; } }\n';
      const digest = (value: string) =>
        createHash('sha256').update(value).digest('hex');
      const vercelPath = join(directory, 'config.json');
      const nginxPath = join(directory, 'nginx.conf');
      const output = join(directory, 'candidate');
      writeFileSync(vercelPath, vercel);
      writeFileSync(nginxPath, nginx);
      const args = [
        '--vercel-baseline',
        vercelPath,
        '--vercel-sha256',
        digest(vercel),
        '--nginx-baseline',
        nginxPath,
        '--nginx-sha256',
        digest(nginx),
        '--out-dir',
        output,
      ];
      expect(run(args).status).toBe(0);
      const manifest = JSON.parse(
        readFileSync(join(output, 'readiness.candidate.json'), 'utf8')
      );
      expect(manifest).toMatchObject({
        candidateOnly: true,
        activationAuthorized: false,
        runtimeReadinessGateOpen: false,
      });
      expect(run(args).status).toBe(0);
      writeFileSync(
        join(output, 'vercel-routing.candidate.json'),
        'foreign content'
      );
      expect(run(args).status).toBe(1);
      expect(
        readFileSync(join(output, 'vercel-routing.candidate.json'), 'utf8')
      ).toBe('foreign content');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
