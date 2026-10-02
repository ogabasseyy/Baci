import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const workerRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const webSrc = join(workerRoot, '..', 'apps', 'web', 'src');

const WORKER_ROOTS = [
  'scripts/process-gigl-tracking.ts',
  'scripts/verify-gigl-tracking-worker-capability.ts',
  'lib/gigl-tracking-worker-client.ts',
  'lib/verify-gigl-tracking-worker-capability.ts',
];

// Files deliberately excluded from the deploy tracking filter: they must
// never be loadable by the worker, or a change to them would bypass the
// install/SHA/smoke gates while the VPS polls a stale checkout. If this
// test fails, add the newly reachable file to the tracking filter
// instead of deleting the assertion.
const EXCLUDED_RUNTIME_FILES = [
  'env.ts',
  'lib/is-non-agentic-worker-profile.ts',
];

function resolveImport(from, spec) {
  let candidate;
  if (spec.startsWith('@/')) {
    candidate = join(webSrc, spec.slice(2));
  } else if (spec.startsWith('.')) {
    candidate = join(dirname(from), spec);
  } else {
    return null;
  }
  for (const probe of [candidate, `${candidate}.ts`, `${candidate}.tsx`]) {
    if (existsSync(probe) && statSync(probe).isFile()) {
      return probe;
    }
  }
  return null;
}

function collectReachable() {
  const seen = new Set();
  const queue = WORKER_ROOTS.map((root) => join(webSrc, root));
  while (queue.length > 0) {
    const file = queue.shift();
    if (seen.has(file) || !existsSync(file)) {
      continue;
    }
    seen.add(file);
    const content = readFileSync(file, 'utf8');
    for (const match of content.matchAll(
      /(?:import|export|require\()[^'"]*['"]([^'"]+)['"]/g
    )) {
      const resolved = resolveImport(file, match[1]);
      if (resolved !== null && !seen.has(resolved)) {
        queue.push(resolved);
      }
    }
  }
  return new Set(
    [...seen].map((file) =>
      file
        .slice(webSrc.length + 1)
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
    for (const excluded of EXCLUDED_RUNTIME_FILES) {
      assert.equal(
        reachable.has(excluded),
        false,
        `${excluded} became reachable from the worker: add it to the tracking filter`
      );
    }
  });
});
