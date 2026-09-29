import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  // Route-reader mocks for the search-route query sync. The default is a
  // non-search route so the pre-existing tests exercise the navbar with no
  // route query syncing underneath them. The query is a raw string so
  // repeated parameters can be expressed.
  pathname: '/ogabassey',
  queryString: '',
}));

vi.mock('next/navigation', () => ({
  usePathname: () => mocks.pathname,
  useRouter: vi.fn(() => ({
    push: mocks.push,
  })),
  useSearchParams: () => new URLSearchParams(mocks.queryString),
}));

vi.mock('@/components/storefront/search-autocomplete', () => ({
  SearchAutocomplete: ({
    value,
    maxLength,
    onChange,
    onSelectProduct,
    onSubmitSearch,
  }: {
    value: string;
    maxLength?: number;
    onChange: (value: string) => void;
    onSelectProduct: (url: string) => void;
    onSubmitSearch?: (query: string) => void;
  }) => (
    <div>
      <input
        type="search"
        aria-label="Search products"
        value={value}
        maxLength={maxLength}
        onChange={(event) => onChange(event.target.value)}
      />
      <button type="button" onClick={() => onSelectProduct('/products/iphone')}>
        Select product
      </button>
      <button type="button" onClick={() => onSubmitSearch?.(value)}>
        Submit search
      </button>
    </div>
  ),
}));

import { NavbarSearch } from './navbar-search';

describe('NavbarSearch search-route query sync', () => {
  beforeEach(() => {
    mocks.pathname = '/ogabassey/search';
    mocks.queryString = 'q=misspelled';
    mocks.push.mockClear();
  });

  function renderNavbar() {
    return render(
      <NavbarSearch
        basePath="/ogabassey"
        isBlogPage={false}
        merchantId="merchant-1"
      />
    );
  }

  function rerenderNavbar(rerender: (ui: ReactNode) => void) {
    rerender(
      <NavbarSearch
        basePath="/ogabassey"
        isBlogPage={false}
        merchantId="merchant-1"
      />
    );
  }

  function searchInput() {
    return screen.getByRole('searchbox', {
      name: /search products/i,
    }) as HTMLInputElement;
  }

  it('adopts the active search route query on mount', () => {
    renderNavbar();

    expect(searchInput().value).toBe('misspelled');
  });

  it('follows the route query when navigation changes it (did-you-mean)', () => {
    const { rerender } = renderNavbar();
    expect(searchInput().value).toBe('misspelled');

    mocks.queryString = 'q=corrected';
    rerenderNavbar(rerender);

    expect(searchInput().value).toBe('corrected');
  });

  it('preserves in-progress edits while the route query is unchanged', () => {
    const { rerender } = renderNavbar();

    fireEvent.change(searchInput(), { target: { value: 'misspelled edit' } });
    rerenderNavbar(rerender);

    expect(searchInput().value).toBe('misspelled edit');
  });

  it('leaves the input alone on non-search routes', () => {
    mocks.pathname = '/ogabassey';
    renderNavbar();

    fireEvent.change(searchInput(), { target: { value: 'typed' } });

    expect(searchInput().value).toBe('typed');
  });

  it('truncates an over-limit route query to the shared maximum', () => {
    // Both entry points share the 200-character route limit, so the
    // synced input must show what Enter would submit.
    const longQuery = 'a'.repeat(250);
    mocks.queryString = `q=${longQuery}`;
    renderNavbar();

    expect(searchInput().value).toBe('a'.repeat(200));
  });

  it('displays a long route query in full instead of truncating it', () => {
    // A 101-200 character query submitted through the results form (or
    // opened directly) is searched in full: the persistent navbar must
    // show it completely so Enter resubmits the identical query.
    const longQuery = 'a'.repeat(150);
    mocks.queryString = `q=${longQuery}`;
    renderNavbar();

    expect(searchInput().value).toBe(longQuery);
  });

  it('syncs an empty query when q is repeated, matching the route parser', () => {
    // The server rejects repeated params with an empty search state; the
    // navbar must agree instead of adopting the first raw value.
    mocks.queryString = 'q=iphone&q=galaxy';
    renderNavbar();

    expect(searchInput().value).toBe('');
  });

  it('syncs an empty query when the search route has no q param', () => {
    mocks.queryString = 'page=2';
    renderNavbar();

    expect(searchInput().value).toBe('');
  });

  it('preserves edits when autocomplete loads after the edit', async () => {
    // On /search the fallback input syncs the route query, then the user
    // edits it — starting the lazy autocomplete load. When the chunk
    // resolves and React swaps branches, the shared sync instance must
    // not remount and overwrite the edit with the unchanged route query.
    renderNavbar();
    expect(searchInput().value).toBe('misspelled');

    fireEvent.change(searchInput(), { target: { value: 'misspelled edit' } });

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /select product/i })
      ).toBeInTheDocument();
    });

    // Flush mount effects from the swapped branch: a per-branch sync
    // instance would remount here and overwrite the edit with the
    // unchanged route query.
    await act(async () => {});

    expect(searchInput().value).toBe('misspelled edit');
  });

  it('ignores non-results URLs that also end in /search', () => {
    // A PDP-style path like /products/search has no `q` param: the sync
    // must not misclassify it as the results route and erase the
    // persistent input. Navigating back must not restore anything either.
    const { rerender } = renderNavbar();
    expect(searchInput().value).toBe('misspelled');

    mocks.pathname = '/ogabassey/products/search';
    mocks.queryString = '';
    rerenderNavbar(rerender);
    expect(searchInput().value).toBe('misspelled');

    mocks.pathname = '/ogabassey/search';
    rerenderNavbar(rerender);
    expect(searchInput().value).toBe('');
  });
});
