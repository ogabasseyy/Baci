import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectLoadingModuleRenders } from '@/app/(storefront)/[slug]/loading-route-test-utils';
import RepairsLoading from './loading';

describe('repairs loading', () => {
  it('renders the repairs loading boundary', async () => {
    await expectLoadingModuleRenders(import.meta.url, 'Loading repair lab');
  });

  it('keeps the shared loading shell tenant-neutral', () => {
    render(<RepairsLoading />);

    expect(
      screen.queryByRole('heading', { name: 'Repair Lab' })
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/Don't Ditch It/i)).not.toBeInTheDocument();
    expect(
      screen.getByRole('status', { name: 'Loading repair lab' })
    ).toHaveClass('sr-only');
  });
});
