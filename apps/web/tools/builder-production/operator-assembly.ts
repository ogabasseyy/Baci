import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { z } from 'zod';
import {
  bundleOperatorService,
  bundlePublicObservationWorker,
} from './operator-bundle.ts';
import { createOperatorRuntimeLock } from './operator-runtime-lock.ts';

/** Creates a review-only source-tree candidate; this does not install or deploy it. */
export async function assembleBuilderCandidate(parent: string) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
  const lockfile = await readFile(join(root, 'pnpm-lock.yaml'), 'utf8');
  const workspace = await readFile(join(root, 'pnpm-workspace.yaml'), 'utf8');
  const lock = z.record(z.string(), z.unknown()).parse(parse(lockfile));
  const importers = z.record(z.string(), z.unknown()).parse(lock.importers);
  const web = z.record(z.string(), z.unknown()).parse(importers['apps/web']);
  const deps = z.record(z.string(), z.unknown()).parse(web.dependencies);
  const next = z.object({ version: z.string() }).parse(deps.next);
  const version = next.version.split('(')[0];
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw Error('INVALID_NEXT_VERSION');
  const patch = await readFile(join(root, `patches/next@${version}.patch`));
  const packageManager = z
    .object({ packageManager: z.string() })
    .parse(
      JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
    ).packageManager;
  const runtime = createOperatorRuntimeLock({
    lockfile,
    workspace,
    patch,
    packageManager,
  });
  const directory = await mkdtemp(join(parent, 'baci-builder-candidate-'));
  try {
    await mkdir(join(directory, 'patches'));
    await writeFile(join(directory, 'package.json'), runtime.packageJson);
    await writeFile(join(directory, 'pnpm-lock.yaml'), runtime.lockfile);
    await writeFile(join(directory, 'pnpm-workspace.yaml'), runtime.workspace);
    await writeFile(join(directory, runtime.patchPath), patch);
    for (const service of [
      'builder',
      'verifier',
      'runner',
      'preflight',
    ] as const) {
      const result = await bundleOperatorService(
        service,
        join(directory, `${service}.mjs`)
      );
      if (result.warnings.length) throw Error('BUNDLE_WARNINGS');
    }
    const observer = await bundlePublicObservationWorker(
      join(directory, 'public-observation-worker.mjs')
    );
    if (observer.warnings.length) throw Error('BUNDLE_WARNINGS');
    await writeFile(
      join(directory, 'helper.py'),
      await readFile(
        join(root, 'apps/web/tools/experience-runner/privileged-helper.py')
      )
    );
    const names = [
      'builder.mjs',
      'verifier.mjs',
      'runner.mjs',
      'preflight.mjs',
      'helper.py',
      'preview.html',
      'public-observation-worker.mjs',
      'package.json',
      'pnpm-lock.yaml',
      'pnpm-workspace.yaml',
      runtime.patchPath,
    ];
    const files: Record<string, string> = {};
    for (const name of names)
      files[name] = createHash('sha256')
        .update(await readFile(join(directory, name)))
        .digest('hex');
    await writeFile(
      join(directory, 'manifest.json'),
      `${JSON.stringify({ format: 'baci.builder-candidate/v1', status: 'unqualified', files }, null, 2)}\n`
    );
    return directory;
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
