import { describe, expect, it } from 'vitest';
import { isTestSourcePath } from './event-pipeline-source-path';

describe('isTestSourcePath', () => {
  it.each([
    'worker.test.js',
    'worker.spec.jsx',
    'worker.test.cjs',
    'worker.test.ts',
    'worker.spec.tsx',
    'worker.test.mjs',
    'worker.spec.mjs',
    'worker.test.mts',
    'worker.spec.cts',
    'apps/web/src/app/api/merchant/blog/posts/route.post.success-a.tests.ts',
    'apps/web/src/app/api/merchant/blog/posts/route.test-support.ts',
    'apps/web/src/app/api/cron/agentic-commerce-health/route.test-setup.ts',
    'apps/web/src/app/dashboard/blog/edit.test-support.tsx',
    'apps/web/src/app/api/products/archive-route-validation.test-suite.ts',
    'apps/web/src/app/api/cron/agentic-commerce-health/route.test-setup.ts',
    'apps/web/src/lib/events/fixture.test-helper.ts',
    'apps/web/src/lib/events/fixture.test-fixture.ts',
    'apps/web/src/app/(storefront)/[slug]/layout.test-utils.tsx',
    'apps/web/src/app/(storefront)/[slug]/(blog)/blog/blog-page-content.test-utils.fixtures.ts',
    'apps/web/src/app/(storefront)/[slug]/(blog)/blog/blog-page-content.test-utils.types.ts',
  ])('recognizes %s', (path) => {
    expect(isTestSourcePath(path)).toBe(true);
  });

  it('keeps production modules classified as production', () => {
    expect(isTestSourcePath('worker.ts')).toBe(false);
    expect(isTestSourcePath('testimonials.ts')).toBe(false);
  });
});
