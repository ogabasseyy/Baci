import { describe, it } from 'vitest';
import { expectLoadingModuleRenders } from '@/app/(storefront)/[slug]/loading-route-test-utils';

describe('reviews loading', () => {
  it('renders the reviews loading boundary', async () => {
    await expectLoadingModuleRenders(import.meta.url, 'Loading utility page');
  });
});
