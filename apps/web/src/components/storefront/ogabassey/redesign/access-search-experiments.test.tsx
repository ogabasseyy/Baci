import { render, screen, within } from '@testing-library/react';
import type { AnchorHTMLAttributes } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { AccessHeroSearch } from './access-hero-search';
import { Hero } from './access-home-hero';
import { AccessServiceNav } from './access-service-nav';

vi.mock('next/link', () => ({
  default: ({
    prefetch: _prefetch,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { prefetch?: boolean }) => (
    <a {...props} />
  ),
}));

describe('hero search experiments', () => {
  it('keeps the navbar search hidden while the inert homepage reserve is visible', () => {
    render(
      <>
        <div
          className="ogabassey-navbar__search-wrap"
          data-testid="navbar-search"
        >
          Search
        </div>
        <Hero slides={[]} reserve />
      </>
    );
    expect(getComputedStyle(screen.getByTestId('navbar-search')).display).toBe(
      'none'
    );
  });

  it.each([
    'above-description',
    'below-description',
  ] as const)('puts the single search form %s in reading order', (searchPlacement) => {
    render(
      <Hero
        slides={[]}
        basePath="/ogabassey"
        searchPlacement={searchPlacement}
      />
    );
    const form = screen.getByRole('form', { name: 'Device search' });
    const description = screen.getByText(
      /Smartphones, laptops & gadgets for everything/
    );
    const expectedOrder =
      searchPlacement === 'above-description'
        ? Node.DOCUMENT_POSITION_FOLLOWING
        : Node.DOCUMENT_POSITION_PRECEDING;
    expect(
      form.compareDocumentPosition(description) & expectedOrder
    ).toBeTruthy();
    expect(screen.getAllByRole('searchbox')).toHaveLength(1);
    expect(form).toHaveAttribute('action', '/ogabassey/search');
    expect(form).toHaveAttribute('method', 'get');
    expect(
      within(form).getByRole('button', { name: 'Search' })
    ).toHaveAttribute('type', 'submit');
  });

  it('uses a native, labelled query field with the existing search limit', () => {
    render(<AccessHeroSearch />);
    const form = screen.getByRole('form', { name: 'Device search' });
    const input = screen.getByRole('searchbox', {
      name: 'Search smartphones, laptops and gadgets',
    });
    expect(input).toHaveAttribute('name', 'q');
    expect(input).toHaveAttribute('maxlength', '200');
    expect(input).toBeRequired();
    expect(form).toHaveAttribute('action', '/search');
  });

  it('reserves the search geometry without exposing an interactive field before publication', () => {
    const { container } = render(
      <Hero
        slides={[]}
        reserve
        omitDocumentHeading
        searchPlacement="below-description"
      />
    );
    expect(container.querySelector('.oa-hero-search-reserve')).not.toBeNull();
    expect(container.querySelector('form, input, button, a')).toBeNull();
    expect(screen.queryByRole('search')).not.toBeInTheDocument();
  });

  it('uses B below the introduction as the main version by default', () => {
    render(<Hero slides={[]} />);
    const form = screen.getByRole('form', { name: 'Device search' });
    const description = screen.getByText(
      /Smartphones, laptops & gadgets for everything/
    );
    expect(
      description.compareDocumentPosition(form) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(screen.getAllByRole('searchbox')).toHaveLength(1);
  });

  it('uses the live service routes with the merchant prefix', () => {
    render(<AccessServiceNav basePath="/ogabassey" />);
    const nav = within(
      screen.getByRole('navigation', { name: 'Device services and support' })
    );
    for (const [name, path] of [
      ['IMEI Checker', '/imei-check'],
      ['Repairs', '/repairs'],
      ['Swap / Trade-in', '/swap'],
      ['Wallet', '/wallet'],
      ['Blog', '/blog'],
    ]) {
      expect(nav.getByRole('link', { name })).toHaveAttribute(
        'href',
        `/ogabassey${path}`
      );
    }
  });
});
