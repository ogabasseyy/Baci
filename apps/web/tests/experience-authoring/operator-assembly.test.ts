import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, it } from 'vitest';
import { buildPublicObservationWorker } from '../../experience-runtime/public-observer-bundle.mjs';
import { assembleBuilderCandidate } from '../../tools/builder-production/operator-assembly';

it('assembles an isolated review candidate with exact artifact hashes and a locked patch', async () => {
  const parent = mkdtempSync(join(tmpdir(), 'baci-assembly-test-'));
  try {
    const candidate = await assembleBuilderCandidate(parent);
    const manifest = JSON.parse(
      readFileSync(join(candidate, 'manifest.json'), 'utf8')
    );
    expect(manifest.status).toBe('unqualified');
    for (const [name, digest] of Object.entries(manifest.files)) {
      expect(
        createHash('sha256')
          .update(readFileSync(join(candidate, name)))
          .digest('hex')
      ).toBe(digest);
    }
    expect(Object.keys(manifest.files).sort()).toEqual([
      'builder.mjs',
      'helper.py',
      'package.json',
      'patches/next@16.4.1.patch',
      'pnpm-lock.yaml',
      'pnpm-workspace.yaml',
      'preflight.mjs',
      'preview.html',
      'public-observation-worker.mjs',
      'runner.mjs',
      'verifier.mjs',
    ]);
    expect(readFileSync(join(candidate, 'preview.html'), 'utf8')).toContain(
      'id="root"'
    );
    const builderBundle = readFileSync(join(candidate, 'builder.mjs'), 'utf8');
    expect(builderBundle).toContain('AUTH_RETENTION_BATCH_FAILED');
    expect(builderBundle).toContain('builder_authorization.provider_records');
    expect(builderBundle).toContain('builder_authorization.transactions');
    expect(
      spawnSync(process.execPath, [
        '--check',
        join(candidate, 'public-observation-worker.mjs'),
      ]).status
    ).toBe(0);
    const localWorker = join(parent, 'local-public-observer.mjs');
    await buildPublicObservationWorker(process.cwd(), localWorker);
    expect(
      createHash('sha256').update(readFileSync(localWorker)).digest('hex')
    ).toBe(manifest.files['public-observation-worker.mjs']);
    const require = createRequire(import.meta.url);
    const modules = join(candidate, 'node_modules');
    mkdirSync(modules);
    for (const [name, path] of [
      ['next', dirname(require.resolve('next/package.json'))],
      ['jsdom', dirname(require.resolve('jsdom/package.json'))],
      ['sharp', dirname(dirname(require.resolve('sharp')))],
    ])
      symlinkSync(path, join(modules, name), 'dir');
    for (const [service, message] of [
      ['builder', 'Baci builder could not start.'],
      ['verifier', 'Baci verifier could not start.'],
      ['runner', 'Baci runner could not start.'],
      ['preflight', 'Runner preflight failed.'],
    ]) {
      const file = join(candidate, `${service}.mjs`);
      expect(spawnSync(process.execPath, ['--check', file]).status).toBe(0);
      const script = `Object.defineProperty(process,'getuid',{value:()=>0});Object.defineProperty(process,'geteuid',{value:()=>1000});await import(${JSON.stringify(pathToFileURL(file).href)});`;
      const run = spawnSync(
        process.execPath,
        ['--input-type=module', '-e', script],
        { encoding: 'utf8', timeout: 15000 }
      );
      expect(run.status).toBe(1);
      expect(run.stderr.trim()).toBe(message);
    }
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
}, 30000);
