import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectLoadingModuleRenders } from '@/app/(storefront)/[slug]/loading-route-test-utils';
import ImeiCheckLoading from './loading';

describe('IMEI check loading', () => {
  it('renders the IMEI check loading boundary', async () => {
    await expectLoadingModuleRenders(import.meta.url, 'Loading IMEI checker');
  });

  it('keeps the loading shell tenant-neutral without branded IMEI copy', () => {
    render(<ImeiCheckLoading />);

    expect(
      screen.getByRole('status', { name: 'Loading IMEI checker' })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: /Don't Get Scammed/i })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText('Trusted by 10,000+ Buyers')
    ).not.toBeInTheDocument();
  });
});
