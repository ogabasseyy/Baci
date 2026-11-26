import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { parse } from 'yaml';
import { createOperatorRuntimeLock } from '../../tools/builder-production/operator-runtime-lock';

const root = resolve('../..');
const lockfile = readFileSync(resolve(root, 'pnpm-lock.yaml'), 'utf8');
const workspace = readFileSync(resolve(root, 'pnpm-workspace.yaml'), 'utf8');
const original = parse(lockfile);
const nextVersion =
  original.importers['apps/web'].dependencies.next.version.split('(')[0];
const patchKey = `next@${nextVersion}`;
const patchPath = `patches/${patchKey}.patch`;
const patch = readFileSync(resolve(root, patchPath));
const packageManager = JSON.parse(
  readFileSync(resolve(root, 'package.json'), 'utf8')
).packageManager as string;

it('preserves exact locked runtime snapshots and the protected Next patch', () => {
  const output = createOperatorRuntimeLock({
    lockfile,
    workspace,
    patch,
    packageManager,
  });
  const subset = parse(output.lockfile);
  const manifest = JSON.parse(output.packageJson);
  expect(manifest.dependencies.react).toBe(
    original.importers['apps/web'].dependencies.react.specifier
  );
  expect(subset.importers['.'].dependencies).toEqual(
    Object.fromEntries(
      ['next', 'jsdom', 'sharp', 'react', 'react-dom'].map((name) => [
        name,
        original.importers['apps/web'].dependencies[name] ??
          original.importers['apps/web'].devDependencies[name],
      ])
    )
  );
  for (const [key, value] of Object.entries(subset.snapshots))
    expect(value).toEqual(original.snapshots[key]);
  for (const [key, value] of Object.entries(subset.packages))
    expect(value).toEqual(original.packages[key]);
  expect(subset.patchedDependencies).toEqual({
    [patchKey]: original.patchedDependencies[patchKey],
  });
  expect(output.patchPath).toBe(patchPath);
  expect(output).toEqual(
    createOperatorRuntimeLock({ lockfile, workspace, patch, packageManager })
  );
});

it('fails closed if the trusted patch or a referenced snapshot is missing', () => {
  expect(() =>
    createOperatorRuntimeLock({
      lockfile,
      workspace,
      patch: Buffer.from('not the patch'),
      packageManager,
    })
  ).toThrow();
  const broken = parse(lockfile);
  delete broken.snapshots[
    `next@${broken.importers['apps/web'].dependencies.next.version}`
  ];
  expect(() =>
    createOperatorRuntimeLock({
      lockfile: JSON.stringify(broken),
      workspace,
      patch,
      packageManager,
    })
  ).toThrow();
});

it('rejects an additional runtime patch until its bytes are included and verified', () => {
  const altered = parse(lockfile);
  const entry =
    altered.importers['apps/web'].dependencies.jsdom ??
    altered.importers['apps/web'].devDependencies.jsdom;
  const oldKey = `jsdom@${entry.version}`;
  const newKey = `jsdom@${entry.version}(patch_hash=${'f'.repeat(64)})`;
  altered.snapshots[newKey] = altered.snapshots[oldKey];
  entry.version += `(patch_hash=${'f'.repeat(64)})`;
  expect(() =>
    createOperatorRuntimeLock({
      lockfile: JSON.stringify(altered),
      workspace,
      patch,
      packageManager,
    })
  ).toThrow('UNSUPPORTED_RUNTIME_PATCH');
});
