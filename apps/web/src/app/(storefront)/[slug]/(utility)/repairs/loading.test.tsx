import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectLoadingModuleRenders } from '@/app/(storefront)/[slug]/loading-route-test-utils';
import RepairsLoading from './loading';

describe('repairs loading', () => {
  it('renders the repairs loading boundary', async () => {
    await expectLoadingModuleRenders(import.meta.url, 'Loading repair lab');
  });

  it('paints the repairs LCP copy in the visible loading shell', () => {
    render(<RepairsLoading />);

    expect(
      screen.getByRole('heading', { name: 'Repair Lab' })
    ).toBeInTheDocument();
    expect(
      screen.getByText(/every device repaired is one less in a landfill/i)
    ).toBeInTheDocument();
  });
});
