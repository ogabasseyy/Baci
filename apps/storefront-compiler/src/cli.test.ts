import { spawn } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createOgabasseyStorefrontManifest } from './benchmark/ogabassey-catalog-fixture';

function runBuiltCli(
  inputJson: string,
  cliPath: string
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const outChunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => outChunks.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => errChunks.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({
        code: code ?? 0,
        stdout: Buffer.concat(outChunks).toString('utf8'),
        stderr: Buffer.concat(errChunks).toString('utf8'),
      });
    });
    child.stdin.end(inputJson);
  });
}

function linkNodeModulesInto(sourceDir: string, targetModules: string): void {
  if (!existsSync(sourceDir)) return;
  for (const entry of readdirSync(sourceDir)) {
    if (entry.startsWith('.')) continue;
    const srcEntry = path.join(sourceDir, entry);
    if (entry.startsWith('@')) {
      const scopeDest = path.join(targetModules, entry);
      mkdirSync(scopeDest, { recursive: true });
      for (const pkg of readdirSync(srcEntry)) {
        const dest = path.join(scopeDest, pkg);
        if (!existsSync(dest)) {
          symlinkSync(realpathSync(path.join(srcEntry, pkg)), dest, 'dir');
        }
      }
    } else {
      const dest = path.join(targetModules, entry);
      if (!existsSync(dest)) {
        symlinkSync(realpathSync(srcEntry), dest, 'dir');
      }
    }
  }
}

describe('storefront-compiler CLI entrypoint', () => {
  it('runs dist/cli.mjs in an isolated /opt-style deploy directory and enforces Dockerfile digest pinning', async () => {
    const pkgRoot = path.resolve(import.meta.dirname, '..');
    const dockerfile = readFileSync(path.join(pkgRoot, 'Dockerfile'), 'utf8');
    const fromLines = dockerfile
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('FROM '));
    expect(fromLines.length).toBeGreaterThanOrEqual(2);
    for (const line of fromLines) {
      expect(line).toMatch(/@sha256:[a-f0-9]{64}\b/);
    }

    const repoNodeModules = path.resolve(pkgRoot, '../../node_modules');
    const tempDeployDir = mkdtempSync(path.join(os.tmpdir(), 'baci-cli-opt-'));
    try {
      writeFileSync(
        path.join(tempDeployDir, 'package.json'),
        JSON.stringify({ name: '@baci/storefront-compiler', private: true })
      );
      mkdirSync(path.join(tempDeployDir, 'dist'));
      const isolatedModules = path.join(tempDeployDir, 'node_modules');
      mkdirSync(isolatedModules);
      linkNodeModulesInto(path.join(pkgRoot, 'node_modules'), isolatedModules);
      linkNodeModulesInto(repoNodeModules, isolatedModules);
      copyFileSync(
        path.join(pkgRoot, 'dist/cli.mjs'),
        path.join(tempDeployDir, 'dist/cli.mjs')
      );
      const res = await runBuiltCli(
        JSON.stringify(createOgabasseyStorefrontManifest()),
        path.join(tempDeployDir, 'dist/cli.mjs')
      );
      expect(res.code).toBe(0);
      const parsed = JSON.parse(res.stdout) as {
        buildDigest: string;
        bindings: unknown[];
      };
      expect(parsed.buildDigest).toMatch(/^[a-f0-9]{64}$/);
      expect(parsed.bindings).toEqual([]);
    } finally {
      rmSync(tempDeployDir, { recursive: true, force: true });
    }
  });

  it('accepts >2 MiB JSON-escaped <1 MiB UTF-8 manifests and exits 1 with structured error on invalid input', async () => {
    const pkgRoot = path.resolve(import.meta.dirname, '..');
    const cliPath = path.join(pkgRoot, 'dist/cli.mjs');

    const manifest = createOgabasseyStorefrontManifest();
    manifest.files.push(
      {
        path: 'src/extra/a.ts',
        content: `// ${'\x07'.repeat(230_000)}\nexport const a = 1;`,
      },
      {
        path: 'src/extra/b.ts',
        content: `// ${'\x07'.repeat(230_000)}\nexport const b = 2;`,
      }
    );
    const wireJson = JSON.stringify(manifest);
    expect(Buffer.byteLength(wireJson, 'utf8')).toBeGreaterThan(
      2 * 1024 * 1024
    );

    const okRes = await runBuiltCli(wireJson, cliPath);
    expect(okRes.code).toBe(0);

    const badRes = await runBuiltCli('{malformed', cliPath);
    expect(badRes.code).toBe(1);
    expect(JSON.parse(badRes.stderr)).toHaveProperty('error');
  });
});
