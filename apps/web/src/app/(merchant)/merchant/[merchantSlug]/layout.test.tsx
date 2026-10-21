import { render, screen } from '@testing-library/react';
import { Suspense } from 'react';
import { describe, expect, it, vi } from 'vitest';
import MerchantLayout from './layout';

vi.mock('@/hooks/merchant/merchant-provider', () => ({
  MerchantProvider: ({
    children,
    slug,
  }: {
    children: React.ReactNode;
    slug?: string;
  }) => (
    <div data-slug={slug} data-testid="merchant-provider">
      {children}
    </div>
  ),
}));

describe('MerchantLayout', () => {
  it('wraps children in MerchantProvider with the resolved merchantSlug', async () => {
    const resolvedThenable = Object.assign(
      Promise.resolve({ merchantSlug: 'ogabassey' }),
      {
        status: 'fulfilled' as const,
        value: { merchantSlug: 'ogabassey' },
      }
    );

    render(
      <Suspense fallback={<div>Loading</div>}>
        <MerchantLayout params={resolvedThenable}>
          <span>Merchant child content</span>
        </MerchantLayout>
      </Suspense>
    );

    const provider = await screen.findByTestId('merchant-provider');
    expect(provider.getAttribute('data-slug')).toBe('ogabassey');
    expect(screen.getByText('Merchant child content')).toBeDefined();
  });
});
