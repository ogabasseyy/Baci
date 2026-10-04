import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const workerRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = join(workerRoot, '..');
const webSrc = join(repoRoot, 'apps', 'web', 'src');
const packagesDir = join(repoRoot, 'packages');

const WORKER_ROOTS = [
  'apps/web/src/scripts/process-gigl-tracking.ts',
  'apps/web/src/scripts/verify-gigl-tracking-worker-capability.ts',
  'apps/web/src/lib/gigl-tracking-worker-client.ts',
  'apps/web/src/lib/verify-gigl-tracking-worker-capability.ts',
];

// Files deliberately excluded from the deploy tracking filter: they must
// never be loadable by the worker, or a change to them would bypass the
// install/SHA/smoke gates while the VPS polls a stale checkout. If this
// test fails, add the newly reachable file to the tracking filter
// instead of deleting the assertion.
const EXCLUDED_RUNTIME_FILES = [
  'apps/web/src/env.ts',
  'apps/web/src/lib/is-non-agentic-worker-profile.ts',
];

const workspaceExportsCache = new Map();

// Resolves a `@baci/*` workspace import through the owning package's
// `exports` map, the same map the tsx poller runtime uses. Only
// workspace packages resolve here: third-party bare imports are
// node_modules code, not checkout-freshness sensitive.
function resolveWorkspaceExport(spec) {
  const match = spec.match(/^(@[^/]+\/[^/]+)(\/(.*))?$/);
  const pkgName = match?.[1] ?? '';
  if (!pkgName.startsWith('@baci/')) {
    return null;
  }
  const pkgDir = join(packagesDir, pkgName.slice('@baci/'.length));
  const pkgJsonPath = join(pkgDir, 'package.json');
  if (!existsSync(pkgJsonPath)) {
    return null;
  }
  if (!workspaceExportsCache.has(pkgJsonPath)) {
    try {
      workspaceExportsCache.set(
        pkgJsonPath,
        JSON.parse(readFileSync(pkgJsonPath, 'utf8')).exports ?? {}
      );
    } catch {
      return null;
    }
  }
  const target =
    workspaceExportsCache.get(pkgJsonPath)[match[3] ? `./${match[3]}` : '.'];
  if (typeof target !== 'string') {
    return null;
  }
  return { pkgDir, pkgJsonPath, target };
}

function resolveImport(from, spec) {
  const resolved = [];
  const pushFile = (candidate) => {
    for (const probe of [candidate, `${candidate}.ts`, `${candidate}.tsx`]) {
      if (existsSync(probe) && statSync(probe).isFile()) {
        resolved.push(probe);
        return;
      }
    }
  };
  if (spec.startsWith('@/')) {
    pushFile(join(webSrc, spec.slice(2)));
  } else if (spec.startsWith('.')) {
    pushFile(join(dirname(from), spec));
  } else {
    const workspace = resolveWorkspaceExport(spec);
    if (workspace !== null) {
      // The exports map itself is load-bearing: redirecting it swaps
      // the executed module without touching the importer.
      resolved.push(workspace.pkgJsonPath);
      pushFile(join(workspace.pkgDir, workspace.target));
    }
  }
  return resolved;
}

// Statements erased before runtime impose no checkout-freshness
// requirement: `import type` / `export type`, or a brace group whose
// every specifier is `type X`. Anything else (values, namespaces,
// side effects, dynamic imports) executes and must be tracked.
function isTypeOnlyStatement(head) {
  if (/^(import|export)\s+type\b/.test(head)) {
    return true;
  }
  const braces = head.match(/\{([\s\S]*)\}/);
  if (!braces) {
    return false;
  }
  // A default import before the braces (`import foo, { type A }`) is a
  // runtime dependency even when every brace specifier is a type.
  const beforeBraces = head
    .slice(0, braces.index)
    .replace(/^(import|export)\s*/, '');
  if (beforeBraces.trim() !== '') {
    return false;
  }
  const specifiers = braces[1]
    .split(',')
    .map((specifier) => specifier.trim())
    .filter((specifier) => specifier !== '');
  return (
    specifiers.length > 0 &&
    specifiers.every((specifier) => /^type\s+[\w$]+/.test(specifier))
  );
}

function collectReachable() {
  const seen = new Set();
  const queue = WORKER_ROOTS.map((root) => join(repoRoot, root));
  while (queue.length > 0) {
    const file = queue.shift();
    if (seen.has(file) || !existsSync(file)) {
      continue;
    }
    seen.add(file);
    const content = readFileSync(file, 'utf8');
    // Statement heads stop at `;` (Biome enforces semicolons), so a
    // specifier-less `export interface` can never swallow a later
    // statement's `from` and misclassify it.
    for (const match of content.matchAll(
      /((?:import|export)[^;'"]*?)\bfrom\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]|(?:require|import)\(\s*['"]([^'"]+)['"]\s*\)/g
    )) {
      const specifier = match[2] ?? match[3] ?? match[4];
      const head = (match[1] ?? '').trim();
      if (head !== '' && isTypeOnlyStatement(head)) {
        continue;
      }
      for (const resolved of resolveImport(file, specifier)) {
        if (!seen.has(resolved)) {
          queue.push(resolved);
        }
      }
    }
  }
  return new Set(
    [...seen].map((file) =>
      file
        .slice(repoRoot.length + 1)
        .split(sep)
        .join('/')
    )
  );
}

describe('deploy tracking import graph', () => {
  it('keeps filter-excluded runtime files out of the worker graph', () => {
    const reachable = collectReachable();

    assert.ok(reachable.size > 0, 'expected worker files to exist');
    for (const root of WORKER_ROOTS) {
      assert.ok(reachable.has(root), `expected ${root} to be reachable`);
    }
    // Workspace subpath imports resolve through the owning
    // package.json `exports` map; the map itself is reachable because
    // redirecting it swaps the executed module.
    for (const shared of [
      'packages/shared/package.json',
      'packages/shared/src/lib/filter-by-location-phrase.ts',
      'packages/shared/src/lib/gigl-tracking-status.ts',
    ]) {
      assert.ok(reachable.has(shared), `expected ${shared} to be reachable`);
    }
    for (const excluded of EXCLUDED_RUNTIME_FILES) {
      assert.equal(
        reachable.has(excluded),
        false,
        `${excluded} became reachable from the worker: add it to the tracking filter`
      );
    }
  });

  it('keeps the runtime tsconfig paths map in the tracking filter', () => {
    // tsx resolves the poller's @/* imports through
    // apps/web/tsconfig.json paths: an alias redirect swaps the
    // executed module without touching any importer, so the map needs
    // the same tracking as the package.json exports map. The import
    // walker cannot see it (it is not an import), so this pins the
    // filter entry directly instead of going through reachability.
    const filter = readFileSync(
      join(workerRoot, '..', '.github', 'filters', 'deploy.yml'),
      'utf8'
    );
    const tracking = filter.slice(
      filter.indexOf('tracking:'),
      filter.indexOf('migrations:')
    );
    assert.ok(
      tracking.includes("  - 'apps/web/tsconfig.json'"),
      'expected apps/web/tsconfig.json in the tracking filter: alias redirects change the executed modules'
    );
  });

  it('keeps every runtime-reachable worker file in the tracking filter', () => {
    // The cron directory has no recursive glob (notification-only fixes
    // must not demand a poller rollout), and shared files have no
    // directory glob either (unrelated shipping edits must not demand
    // one): exact entries or narrow globs must cover every file the
    // worker actually loads at runtime, or the VPS keeps executing the
    // stale copy while CI stays green. A new worker import fails this
    // test until it is added to the filter.
    const filter = readFileSync(
      join(workerRoot, '..', '.github', 'filters', 'deploy.yml'),
      'utf8'
    );
    const tracking = filter.slice(
      filter.indexOf('tracking:'),
      filter.indexOf('migrations:')
    );
    const entries = [...tracking.matchAll(/^ {2}- '([^']+)'$/gm)].map(
      (entry) => entry[1]
    );
    // paths-filter micromatch subset used by this section: `*` matches
    // within one path segment. Runtime code lives under apps/web/src
    // and in workspace packages; workflow/script entries never match.
    const matchers = entries
      .filter(
        (entry) =>
          entry.startsWith('apps/web/src/') || entry.startsWith('packages/')
      )
      .map(
        (entry) =>
          new RegExp(
            `^${entry
              .split('*')
              .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
              .join('[^/]*')}$`
          )
      );
    const reachable = [...collectReachable()];

    assert.ok(reachable.length > 0, 'expected worker files to exist');
    const uncovered = reachable.filter(
      (file) => !matchers.some((matcher) => matcher.test(file))
    );
    assert.deepEqual(
      uncovered,
      [],
      `worker-reachable files missing from the tracking filter: ${uncovered.join(', ')}`
    );
  });
});
