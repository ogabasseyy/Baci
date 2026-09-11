import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectLoadingModuleRenders } from '@/app/(storefront)/[slug]/loading-route-test-utils';
import { OGABASSEY_TITLE } from '@/config/ogabassey';
import Loading from './loading';

describe('(home) loading', () => {
  it('renders the shared homepage loading boundary', async () => {
    await expectLoadingModuleRenders(
      import.meta.url,
      'Loading storefront homepage'
    );
  });

  it('does not paint OgaBassey brand copy for every merchant', () => {
    render(<Loading />);

    expect(
      screen.getByRole('status', { name: 'Loading storefront homepage' })
    ).toBeInTheDocument();
    expect(screen.queryByText(OGABASSEY_TITLE)).not.toBeInTheDocument();
  });
});
