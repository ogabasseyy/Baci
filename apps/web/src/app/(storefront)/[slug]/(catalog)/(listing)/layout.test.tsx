import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { readStorefrontFile } from '@/app/(storefront)/storefront-css-partition-read';
import StorefrontListingLayout, { unstable_instant } from './layout';

describe('StorefrontListingLayout', () => {
  it('opts listing routes out of instant static-shell validation', () => {
    expect(unstable_instant).toBe(false);
  });

  it('does not mount StorefrontFullStyleLoader in the shared listing layout', () => {
    const source = readStorefrontFile('[slug]/(catalog)/(listing)/layout.tsx');
    expect(source).not.toContain('StorefrontFullStyleLoader');
    expect(source).not.toContain('storefront-full.css');
  });

  it('passes children through the listing route group', () => {
    render(
      <StorefrontListingLayout>
        <main>Listing content</main>
      </StorefrontListingLayout>
    );

    expect(screen.getByRole('main')).toHaveTextContent('Listing content');
  });
});
