// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { expect, it } from 'vitest';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

it('source-captures rollback diagnostic-only CJS with inert require and one offline argument refusal', async () => {
  const directory = await mkdtemp(
    join(tmpdir(), 'baci-project-rollback-test-')
  );
  const entrypoint = join(
    repository,
    'tools/staging/prefunded-card/runtime-project-rollback-cli.ts'
  );
  const bundlePath = join(directory, 'diagnostic.cjs');
  const guardPath = join(directory, 'offline-guard.cjs');
  const captured = new Map<string, string>();
  try {
    const result = await build({
      absWorkingDir: repository,
      entryPoints: [entrypoint],
      outfile: bundlePath,
      bundle: true,
      format: 'cjs',
      platform: 'node',
      target: 'node22',
      external: ['pg-native'],
      tsconfig: join(repository, 'apps/web/tsconfig.json'),
      write: false,
      metafile: true,
      plugins: [
        {
          name: 'diagnostic-source-capture',
          setup(plugin) {
            plugin.onResolve({ filter: /^server-only$/ }, () => ({
              path: 'server-only',
              namespace: 'empty-server-only',
            }));
            plugin.onLoad(
              { filter: /.*/, namespace: 'empty-server-only' },
              () => ({ contents: '' })
            );
            plugin.onLoad(
              { filter: /.*/, namespace: 'file' },
              async ({ path }) => {
                const contents = await readFile(path);
                captured.set(
                  path,
                  createHash('sha256').update(contents).digest('hex')
                );
                const extension = extname(path);
                const loader =
                  extension === '.ts'
                    ? 'ts'
                    : extension === '.json'
                      ? 'json'
                      : 'js';
                return { contents, loader, resolveDir: dirname(path) };
              }
            );
          },
        },
      ],
    });
    expect(captured.has(entrypoint)).toBe(true);
    expect(Object.keys(result.metafile?.inputs ?? {})).not.toHaveLength(0);
    for (const [path, checksum] of captured) {
      expect(
        createHash('sha256')
          .update(await readFile(path))
          .digest('hex')
      ).toBe(checksum);
      expect(path).not.toMatch(
        /\/(?:scripts\/run-prefunded-card-background|lib\/piggyvest\/prefunded-card-(?:worker|runtime|composition|execution|postgres-executor))\.ts$/
      );
    }
    expect(result.outputFiles).toHaveLength(1);
    await writeFile(bundlePath, result.outputFiles[0].contents, {
      mode: 0o600,
    });
    await writeFile(
      guardPath,
      `
      const refused = () => { process.exitCode = 86; throw new Error('Offline diagnostic test forbids I/O'); };
      require('node:fs').promises.open = refused;
      require('node:net').Socket.prototype.connect = refused;
      require('node:tls').connect = refused;
      globalThis.fetch = refused;
    `,
      { mode: 0o600 }
    );
    const options = {
      encoding: 'utf8' as const,
      timeout: 5000,
      env: { PATH: process.env.PATH },
    };
    const imported = spawnSync(
      process.execPath,
      ['--require', guardPath, '-e', `require(${JSON.stringify(bundlePath)})`],
      options
    );
    expect(imported.error).toBeUndefined();
    expect(imported.status).toBe(0);
    expect(imported.stdout).toBe('');
    expect(imported.stderr).toBe('');
    const executed = spawnSync(
      process.execPath,
      ['--require', guardPath, bundlePath, '/invalid-offline-config'],
      options
    );
    expect(executed.error).toBeUndefined();
    expect(executed.status).toBe(1);
    expect(executed.stderr).toBe('');
    const lines = executed.stdout.trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toEqual({
      status: 'project-rollback-refused',
      rollbackConfirmed: false,
      constraintsValidated: false,
      connectionClosed: false,
      diagnostic: {
        profile: 'worker',
        phase: 'arguments',
        code: 'unclassified',
      },
      redacted: true,
      financialCommitted: false,
      newPaymentStarted: false,
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
