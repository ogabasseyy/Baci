import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { labSharedClosure } from './pilot-shared-closure.mjs';

// The pilot-codec workflow's change detection must catch gate-only
// PRs: a PR touching only the boot/build gate or the pilot-owned
// contract files must still run both suites. The test extracts the
// LIVE grep pattern from the workflow (not a copy) and runs real
// grep -qE against fixture filename lists, so a pattern regression
// fails here instead of silently skipping the suites.
async function pilotPattern() {
  const workflow = await readFile(
    new URL('../workflows/pilot-codec-compatibility.yml', import.meta.url),
    'utf8'
  );
  const match = workflow.match(/grep -qE '([^']+pilot-lab[^']+)'/);
  assert.ok(match, 'pilot grep pattern must remain extractable');
  return match[1];
}

function detected(pattern, names) {
  const result = spawnSync('grep', ['-qE', pattern], {
    encoding: 'utf8',
    input: names.join('\n'),
  });
  return result.status === 0;
}

test('gate-only changes set pilot=true', async () => {
  const pattern = await pilotPattern();
  const gateOnly = [
    'apps/web/src/instrumentation.ts',
    'apps/web/src/instrumentation-pilot.test.ts',
    'apps/web/next.config.ts',
    'apps/web/next.config.pilot-assets.test.ts',
    'apps/web/src/components/storefront/product-card.tsx',
    'apps/web/src/components/storefront/product-card.test.tsx',
    'apps/web/src/lib/storefront-product-href.ts',
    'apps/web/src/lib/storefront-product-href.test.ts',
    'apps/web/package.json',
    'apps/web/public/__pilot/fillers/grid-filler-600x400-a.png',
    '.github/scripts/pilot-change-detection-contract.test.mjs',
    'apps/web/tools/perf/server-only-empty.ts',
    'apps/web/tools/perf/merchant-image-pilot-stage.tsconfig.json',
  ];
  for (const name of gateOnly) {
    assert.equal(detected(pattern, [name]), true, name);
  }
});

test('lab render closure (depth<=2) matches the pattern', async () => {
  // Self-maintaining: the walker recomputes the shared modules the
  // lab renders through, and every one must trip the suites. A new
  // lab import of a shared module fails here until its branch is
  // added to the workflow pattern — add the branch, never shrink
  // the walker.
  const pattern = await pilotPattern();
  const closure = labSharedClosure();
  // The two review-found misses that motivated the walker.
  assert.ok(
    closure.includes('apps/web/src/components/optimized-image.tsx')
  );
  assert.ok(closure.includes('apps/web/src/lib/seo-utils.ts'));
  const missing = closure.filter((name) => !detected(pattern, [name]));
  assert.deepEqual(missing, []);
  // Boundaries: type-only reachability stays out (LaunchCarousel is
  // imported for its slide type only, erased at runtime), and
  // sibling non-lab modules stay out.
  assert.equal(
    closure.includes(
      'apps/web/src/components/storefront/ogabassey/components/LaunchCarousel.tsx'
    ),
    false
  );
  assert.equal(
    detected(pattern, [
      'apps/web/src/components/storefront/ogabassey/components/hero-mobile-carousel-autoplay.test.tsx',
      'apps/web/src/lib/products-server.ts',
    ]),
    false
  );
});

test('core pilot paths still set pilot=true', async () => {
  const pattern = await pilotPattern();
  const core = [
    'apps/web/tools/perf/merchant-image-pilot-runner.mjs',
    'apps/web/src/lib/merchant-image-variant-pilot/lab-index.ts',
    'apps/web/src/app/pilot-lab/page.tsx',
    'apps/web/src/config/pilot-lab-enabled.ts',
    'apps/web/src/schemas/merchant-image-variant-pilot.ts',
    'infra/cdn-transformer/pilot/encoder.mjs',
    '.github/workflows/pilot-codec-compatibility.yml',
  ];
  for (const name of core) {
    assert.equal(detected(pattern, [name]), true, name);
  }
});

test('unrelated changes set pilot=false', async () => {
  const pattern = await pilotPattern();
  assert.equal(
    detected(pattern, [
      'apps/web/src/components/storefront/other-card.tsx',
      'apps/web/src/lib/quiz-compliance-gate.ts',
      'README.md',
    ]),
    false
  );
});

test('truncated file lists fail closed to pilot=true', async () => {
  // The list-files endpoint caps at 3,000 entries: the workflow must
  // compare the received count against the PR's changed_files count
  // and force both suites on when truncated, so a pilot path outside
  // the window cannot silently skip them.
  const workflow = await readFile(
    new URL('../workflows/pilot-codec-compatibility.yml', import.meta.url),
    'utf8'
  );
  assert.match(workflow, /\.changed_files/);
  assert.match(workflow, /received.*-ge.*changed/);
});
