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
  const queue = WORKER_ROOTS.map((root) => join(webSrc, root));
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
      const resolved = resolveImport(file, specifier);
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
    // within one path segment.
    const matchers = entries
      .filter((entry) => entry.startsWith('apps/web/src/'))
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
      (file) =>
        !matchers.some((matcher) => matcher.test(`apps/web/src/${file}`))
    );
    assert.deepEqual(
      uncovered,
      [],
      `worker-reachable files missing from the tracking filter: ${uncovered.join(', ')}`
    );
  });
});
