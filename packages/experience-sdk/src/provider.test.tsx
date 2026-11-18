import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { createMockCommerce } from './mock-commerce';
import { CommerceProvider, useAssetUrl } from './provider';

it('resolves only host-bound design asset URLs and leaves missing references absent', () => {
  const commerce = createMockCommerce({
    catalog: { products: [], revision: '1' },
    capabilities: [],
    route: {
      epoch: 1,
      routeId: 'home',
      canonicalPath: '/',
      params: {},
      publicDataRevision: '1',
    },
  });
  function Image() {
    const src = useAssetUrl('design');
    const missing = useAssetUrl('private-reference');
    return (
      <>
        <img src={src ?? undefined} alt="Synthetic design" />
        <p>{missing === null ? 'Reference unavailable' : 'leaked'}</p>
      </>
    );
  }
  render(
    <CommerceProvider
      commerce={commerce}
      assets={{ design: 'http://127.0.0.1/resource/design' }}
    >
      <Image />
    </CommerceProvider>
  );
  expect(screen.getByRole('img').getAttribute('src')).toBe(
    'http://127.0.0.1/resource/design'
  );
  expect(screen.getByText('Reference unavailable')).toBeTruthy();
});
