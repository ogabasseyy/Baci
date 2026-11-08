import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { InformationalClusterPanel } from './informational-cluster-panel';

describe('InformationalClusterPanel', () => {
  it('renders category, commerce, and featured product links', () => {
    render(
      <InformationalClusterPanel
        model={{
          heading: 'Continue shopping smartphones',
          primaryCategoryLink: {
            href: '/smartphones',
            label: 'Shop more smartphones',
          },
          commerceLinks: [
            {
              href: '/smartphones/compare/apple-vs-samsung',
              label: 'Apple vs Samsung',
            },
          ],
          featuredProducts: [
            {
              href: '/smartphones/iphone-15',
              title: 'iPhone 15',
              description: 'Apple • ₦430,000',
            },
          ],
        }}
      />
    );

    expect(
      screen.getByRole('heading', { name: /continue shopping smartphones/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /shop more smartphones/i })
    ).toHaveAttribute('href', '/smartphones');
    expect(
      screen.getByRole('link', { name: 'Apple vs Samsung' })
    ).toHaveAttribute('href', '/smartphones/compare/apple-vs-samsung');
    expect(screen.getByRole('link', { name: 'iPhone 15' })).toHaveAttribute(
      'href',
      '/smartphones/iphone-15'
    );
  });

  it('renders nothing when the model is null', () => {
    const { container } = render(<InformationalClusterPanel model={null} />);

    expect(container).toBeEmptyDOMElement();
  });
});
