import { createHash } from 'node:crypto';
import { parse, stringify } from 'yaml';
import { z } from 'zod';

const record = z.record(z.string(), z.unknown());
const dependency = z.object({ specifier: z.string(), version: z.string() });
const runtimeNames = ['next', 'jsdom', 'sharp', 'react', 'react-dom'] as const;

/** Preserve exact workspace snapshots and the Next patch; never resolve new versions. */
export function createOperatorRuntimeLock(input: {
  lockfile: string;
  workspace: string;
  patch: Uint8Array;
  packageManager: string;
}) {
  const lock = record.parse(parse(input.lockfile));
  const workspace = record.parse(parse(input.workspace));
  const importers = record.parse(lock.importers);
  const web = record.parse(importers['apps/web']);
  const dependencies = record.parse(web.dependencies);
  const devDependencies = record.parse(web.devDependencies ?? {});
  const packages = record.parse(lock.packages);
  const snapshots = record.parse(lock.snapshots);
  const patches = record.parse(lock.patchedDependencies);
  const workspacePatches = record.parse(workspace.patchedDependencies);
  const selected = Object.fromEntries(
    runtimeNames.map((name) => [
      name,
      dependency.parse(dependencies[name] ?? devDependencies[name]),
    ])
  );
  const nextVersion = selected.next.version.split('(')[0];
  if (!/^\d+\.\d+\.\d+$/.test(nextVersion)) throw Error('INVALID_NEXT_VERSION');
  const patchKey = `next@${nextVersion}`;
  const patchPath = `patches/${patchKey}.patch`;
  const hash = createHash('sha256').update(input.patch).digest('hex');
  if (
    patches[patchKey] !== hash ||
    workspacePatches[patchKey] !== patchPath ||
    !selected.next.version.includes(`(patch_hash=${hash})`)
  )
    throw Error('NEXT_PATCH_MISMATCH');
  const queue = runtimeNames.map((name) => `${name}@${selected[name].version}`);
  const visited = new Set<string>();
  while (queue.length) {
    const key = queue.pop();
    if (!key || visited.has(key)) continue;
    visited.add(key);
    if (
      key.includes('(patch_hash=') &&
      !key.startsWith(`${patchKey}(patch_hash=${hash})`)
    )
      throw Error('UNSUPPORTED_RUNTIME_PATCH');
    const snapshot = record.parse(snapshots[key]);
    for (const group of ['dependencies', 'optionalDependencies']) {
      const deps = z
        .record(z.string(), z.string())
        .parse(snapshot[group] ?? {});
      for (const [name, version] of Object.entries(deps)) {
        if (version.startsWith('link:') || version.startsWith('workspace:'))
          throw Error('UNSUPPORTED_RUNTIME_LINK');
        queue.push(`${name}@${version}`);
      }
    }
  }
  const packageKeys = new Set([...visited].map((key) => key.split('(')[0]));
  for (const key of packageKeys)
    if (!(key in packages)) throw Error('MISSING_RUNTIME_PACKAGE');
  const selectedSnapshots = Object.fromEntries(
    Object.entries(snapshots).filter(([key]) => visited.has(key))
  );
  const selectedPackages = Object.fromEntries(
    Object.entries(packages).filter(([key]) => packageKeys.has(key))
  );
  const version = z
    .string()
    .regex(/^pnpm@\d+\.\d+\.\d+$/)
    .parse(input.packageManager);
  return {
    packageJson: `${JSON.stringify({ private: true, type: 'module', packageManager: version, dependencies: Object.fromEntries(runtimeNames.map((name) => [name, selected[name].specifier])) }, null, 2)}\n`,
    lockfile: stringify({
      ...lock,
      importers: { '.': { dependencies: selected } },
      patchedDependencies: { [patchKey]: hash },
      packages: selectedPackages,
      snapshots: selectedSnapshots,
    }),
    workspace: stringify({
      ...workspace,
      packages: [],
      patchedDependencies: { [patchKey]: patchPath },
    }),
    patchPath,
  };
}
