import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  catalog,
  home,
  merchant,
} from '../../../../tools/builder-preview-spike/fixtures';
import { PortableHomeView } from './portable-home';

describe('shared portable homepage', () => {
  it('renders authorized identity and catalog and disables every navigation effect', () => {
    const { container } = render(
      <PortableHomeView
        config={home}
        merchant={merchant}
        catalog={catalog}
        inert
      />
    );
    expect(screen.getAllByText(merchant.business_name).length).toBeGreaterThan(
      0
    );
    expect(screen.getByText('Authorized fixture camera')).toBeInTheDocument();
    expect(container.querySelector('a[href]')).toBeNull();
    expect(container.querySelectorAll('[data-baci-block]')).toHaveLength(6);
  });
  it('shows an explicit empty catalog instead of invented products', () => {
    render(
      <PortableHomeView
        config={home}
        merchant={merchant}
        catalog={{ ...catalog, products: [] }}
        inert
      />
    );
    expect(
      screen.getByText('No published products. This catalog is empty.')
    ).toBeInTheDocument();
    expect(screen.queryByText('Authorized fixture camera')).toBeNull();
  });
  it('uses actual merchant identity and authorized image assets', () => {
    render(
      <PortableHomeView
        config={home}
        merchant={{
          ...merchant,
          business_name: 'Actual authorized store',
          logo_url: 'https://assets.example.test/logo.png',
        }}
        catalog={catalog}
        inert
      />
    );
    expect(
      screen.getByRole('img', { name: 'Actual authorized store logo' })
    ).toHaveAttribute('src', 'https://assets.example.test/logo.png');
    expect(screen.queryByText('Preview Store')).toBeNull();
  });
  it('rejects unsupported theme inputs', () => {
    render(
      <PortableHomeView
        config={{ ...home, theme: { colors: { arbitraryDesign: 'red' } } }}
        merchant={merchant}
        catalog={catalog}
        inert
      />
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Preview unavailable');
  });
  it('refuses unsupported Puck props rather than substituting a design', () => {
    const unsupported = {
      ...home,
      content: [{ type: 'Header', props: { id: 'h', glassEffect: true } }],
    };
    render(
      <PortableHomeView
        config={unsupported}
        merchant={merchant}
        catalog={catalog}
        inert
      />
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Preview unavailable');
  });
  it('refuses a catalog from another merchant', () => {
    render(
      <PortableHomeView
        config={home}
        merchant={merchant}
        catalog={{
          ...catalog,
          merchantId: '10000000-0000-4000-8000-000000000002',
        }}
        inert
      />
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Preview unavailable');
    expect(screen.queryByText('Authorized fixture camera')).toBeNull();
  });
});
