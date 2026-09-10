import { describe, it } from 'vitest';
import { expectLoadingModuleRenders } from '@/app/(storefront)/[slug]/loading-route-test-utils';

describe('(utility) loading', () => {
  it('renders the shared utility loading boundary for sibling routes', async () => {
    await expectLoadingModuleRenders(import.meta.url, 'Loading utility page');
  });
});
