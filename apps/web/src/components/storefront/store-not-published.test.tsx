import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StoreNotPublished } from './store-not-published';

describe('StoreNotPublished', () => {
  it('presents the merchant as an intentional upcoming storefront', () => {
    const { container } = render(
      <StoreNotPublished businessName="Ada & Co." />
    );

    expect(
      screen.getByRole('heading', { level: 1, name: 'Ada & Co.' })
    ).toBeInTheDocument();
    expect(screen.getByText('Opening soon')).toBeInTheDocument();
    expect(
      screen.getByText(/curating something worth the wait/i)
    ).toBeInTheDocument();
    expect(container.querySelector('style')?.textContent).toContain(
      '.unpublished-store'
    );
  });

  it('provides store owners with a clear dashboard action', () => {
    render(<StoreNotPublished businessName="Ada & Co." />);

    expect(
      screen.getByRole('link', { name: /continue setting up your store/i })
    ).toHaveAttribute('href', '/login');
  });
});
