import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function readWebFilter() {
  const [workflow, filters] = await Promise.all([
    readFile('.github/workflows/ci.yml', 'utf8'),
    readFile('.github/filters/ci.yml', 'utf8'),
  ]);
  const filterLines = filters.split('\n');
  const webFilterIndex = filterLines.findIndex((line) => line.trim() === 'web:');
  const webFilterIndent = webFilterIndex === -1 ? -1 : filterLines[webFilterIndex].search(/\S/);
  const webFilterLines =
    webFilterIndex === -1
      ? []
      : filterLines.slice(webFilterIndex + 1).map((line) => ({
          indent: line.search(/\S/),
          value: line.trim(),
        }));
  const webFilterEnd = webFilterLines.findIndex(
    ({ indent, value }) => value.length > 0 && indent <= webFilterIndent
  );
  const webFilter = webFilterLines
    .slice(0, webFilterEnd === -1 ? undefined : webFilterEnd)
    .map(({ value }) => value);

  return { webFilter, webFilterIndex, workflow };
}

test('the Quality Gate generates route types and reaches the tools and worker TypeScript project', async () => {
  const pkg = JSON.parse(await readFile('apps/web/package.json', 'utf8'));
  const toolsTsconfig = JSON.parse(await readFile('apps/web/tsconfig.tools-workers.json', 'utf8'));
  const configTest = await readFile('.github/scripts/resolve-ci-test-plan-config.test.mjs', 'utf8');
  const { webFilter, webFilterIndex, workflow } = await readWebFilter();

  assert.notEqual(webFilterIndex, -1);
  assert.equal(pkg.scripts.typecheck, 'next typegen && tsc --noEmit && pnpm typecheck:tools-workers');
  assert.equal(pkg.scripts['typecheck:tools-workers'], 'tsc --noEmit -p tsconfig.tools-workers.json');
  assert.deepEqual(toolsTsconfig.compilerOptions.types, [
    'node', 'vitest/globals', '@testing-library/jest-dom', 'google.maps',
  ]);
  assert.deepEqual(toolsTsconfig.include, [
    'tools/events/**/*.ts',
    'tools/db/**/*.ts',
    'tools/cost/**/*.ts',
    'src/scripts/process-domain-events.ts',
    'src/scripts/process-domain-events.test.ts',
    'src/scripts/domain-event-worker-message.ts',
    'src/scripts/domain-event-worker-batch.ts',
    'src/scripts/domain-event-worker-batch.test.ts',
    'src/scripts/domain-event-worker.ts',
    'src/scripts/domain-event-worker.test.ts',
    'src/scripts/process-event-deliveries.ts',
    'src/scripts/process-event-deliveries.test.ts',
    'src/scripts/event-delivery-claim-batch-size.ts',
    'src/scripts/event-delivery-claim-batch-size.test.ts',
    'src/scripts/process-claimed-event-delivery.ts',
    'src/scripts/process-claimed-event-delivery.test.ts',
    'src/scripts/event-delivery-worker.ts',
    'src/scripts/event-delivery-worker.test.ts',
    'src/lib/imei-providers/petrock/run-petrock-reconciliation.ts',
    'src/lib/imei-providers/petrock/run-petrock-reconciliation.test.ts',
    'src/lib/quiz/finalize-due-quiz-events.ts',
    'src/lib/quiz/finalize-due-quiz-events.test.ts',
    'src/scripts/process-petrock-reconciliation.ts',
    'src/scripts/process-petrock-reconciliation.test.ts',
    'src/scripts/process-quiz-finalization.ts',
    'src/scripts/process-quiz-finalization.test.ts',
  ]);
  assert.ok(!toolsTsconfig.include.includes('tools/**/*.ts'));
  assert.ok(
    webFilter.includes("- '.github/scripts/tools-worker-typecheck-contract.test.mjs'")
  );
  assert.match(workflow, /filters: \.github\/filters\/ci\.yml/);
  assert.match(configTest, /import '\.\/tools-worker-typecheck-contract\.test\.mjs';/);
  assert.match(workflow, /node --test [^\n]*resolve-ci-test-plan-config\.test\.mjs/);
  assert.match(workflow, /pnpm turbo typecheck/);
});

test('bugfix: CI runner script changes trigger the web quality gate', async () => {
  const { webFilter } = await readWebFilter();

  for (const file of [
    '.github/scripts/resolve-ci-non-web-test-filters.mjs',
    '.github/scripts/resolve-ci-non-web-test-filters.test.mjs',
    '.github/scripts/run-ci-non-web-tests.mjs',
    '.github/scripts/run-ci-non-web-tests.test.mjs',
  ]) {
    assert.ok(
      webFilter.includes(`- '${file}'`),
      `${file} must trigger the web quality gate`
    );
  }
});
