import { expect, it } from 'vitest';
import { hasRuntimeIntegrationCoverage } from './runtime-contract-integration-coverage';
import { runtimeIntegrationSuites } from './runtime-contract-integration-suites';

const target = 'apps/web/src/lib/website-builder/load-publication.ts';
const suite = runtimeIntegrationSuites[target];
it('requires the explicit suite and a real dependency path, not an arbitrary string', () => {
  const sources = new Map([
    [suite, "import { createLifecycleHarness } from './lifecycle.test-utils';"],
    [
      'apps/web/tests/builder-chatgpt/lifecycle.test-utils.ts',
      "import '@/lib/website-builder/load-publication';",
    ],
    [target, 'export const load = () => true;'],
  ]);
  expect(hasRuntimeIntegrationCoverage(target, sources)).toBe(true);
  sources.delete(suite);
  expect(hasRuntimeIntegrationCoverage(target, sources)).toBe(false);
  sources.set(suite, `const ignored = '${target}';`);
  expect(hasRuntimeIntegrationCoverage(target, sources)).toBe(false);
});
it('rejects mocked source and missing intermediate modules', () => {
  const sources = new Map([
    [
      suite,
      "import '@/lib/website-builder/load-publication'; vi.mock('@/lib/website-builder/load-publication');",
    ],
    [target, 'export const load = () => true;'],
  ]);
  expect(hasRuntimeIntegrationCoverage(target, sources)).toBe(false);
  sources.set(suite, "import './missing';");
  expect(hasRuntimeIntegrationCoverage(target, sources)).toBe(false);
});

it('does not accept a named type-only dependency as runtime execution', () => {
  const sources = new Map([
    [suite, "import { type X } from '@/lib/website-builder/load-publication';"],
    [target, 'export interface X {}'],
  ]);
  expect(hasRuntimeIntegrationCoverage(target, sources)).toBe(false);
});

it('detects deletion of the last mapped integration test when only the test path changes', async () => {
  const { analyzeChangedRuntimeContracts } = await import(
    './verify-analytics-delivery-authority'
  );
  const source = 'export function load() {}';
  const baseline = new Map([
    [target, source],
    [suite, "import '@/lib/website-builder/load-publication';"],
  ]);
  expect(
    analyzeChangedRuntimeContracts(
      [suite],
      new Map([[target, source]]),
      baseline
    )
  ).toContain(
    `${target}: changed runtime is missing colocated test apps/web/src/lib/website-builder/load-publication.test.ts`
  );
});

it('rejects named type-only re-exports but follows mixed runtime re-exports', () => {
  const sources = new Map([
    [suite, "export { type X } from '@/lib/website-builder/load-publication';"],
    [target, 'export interface X {} export const load = () => true;'],
  ]);
  expect(hasRuntimeIntegrationCoverage(target, sources)).toBe(false);
  sources.set(
    suite,
    "export { type X, load } from '@/lib/website-builder/load-publication';"
  );
  expect(hasRuntimeIntegrationCoverage(target, sources)).toBe(true);
});
