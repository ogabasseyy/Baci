import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectLoadingModuleRenders } from '@/app/(storefront)/[slug]/loading-route-test-utils';
import RepairLoading from './loading';

describe('repair loading', () => {
  it('renders the repair loading boundary', async () => {
    await expectLoadingModuleRenders(import.meta.url, 'Loading repair booking');
  });

  it('paints the repair LCP copy in the visible loading shell', () => {
    render(<RepairLoading />);

    expect(
      screen.getByRole('heading', { name: 'Book a Repair Service' })
    ).toBeInTheDocument();
    expect(
      screen.getByText(/For phones, laptops, tablets, consoles and accessories/)
    ).toBeInTheDocument();
  });
});
