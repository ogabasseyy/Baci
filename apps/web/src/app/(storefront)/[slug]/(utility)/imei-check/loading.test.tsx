import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectLoadingModuleRenders } from '@/app/(storefront)/[slug]/loading-route-test-utils';
import ImeiCheckLoading from './loading';

describe('IMEI check loading', () => {
  it('renders the IMEI check loading boundary', async () => {
    await expectLoadingModuleRenders(import.meta.url, 'Loading IMEI checker');
  });

  it('paints the IMEI hero LCP copy in the visible loading shell', () => {
    render(<ImeiCheckLoading />);

    expect(
      screen.getByRole('heading', { name: /Don't Get Scammed/i })
    ).toBeInTheDocument();
    expect(
      screen.getByText(/One quick check can save you from losing/)
    ).toBeInTheDocument();
  });
});
