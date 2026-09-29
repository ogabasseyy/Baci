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

describe('NavbarSearch', () => {
  beforeEach(() => {
    mocks.push.mockClear();
  });

  it('submits the fallback product search form before autocomplete is loaded', () => {
    render(
      <NavbarSearch
        basePath="/ogabassey"
        isBlogPage={false}
        merchantId="merchant-1"
      />
    );

    const input = screen.getByRole('searchbox', { name: /search products/i });
    fireEvent.change(input, { target: { value: 'iphone' } });
    fireEvent.submit(input.closest('form') as HTMLFormElement);

    expect(mocks.push).toHaveBeenCalledWith('/ogabassey/search?q=iphone');
  });

  it('loads autocomplete on focus and routes selected products through the store base path', async () => {
    render(
      <NavbarSearch
        basePath="/ogabassey"
        isBlogPage={false}
        merchantId="merchant-1"
      />
    );

    fireEvent.focus(screen.getByRole('searchbox', { name: /search products/i }));

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /select product/i })
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /select product/i }));

    expect(mocks.push).toHaveBeenCalledWith('/ogabassey/products/iphone');
  });

  it('caps the loaded autocomplete input at the route truncation limit', async () => {
    render(
      <NavbarSearch
        basePath="/ogabassey"
        isBlogPage={false}
        merchantId="merchant-1"
      />
    );

    fireEvent.focus(screen.getByRole('searchbox', { name: /search products/i }));

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /submit search/i })
      ).toBeInTheDocument();
    });

    // pushSearchRoute truncates to 100 characters: the input carries the
    // same cap so the persistent value can never exceed the submitted
    // query after a long paste.
    expect(
      screen.getByRole('searchbox', { name: /search products/i })
    ).toHaveAttribute('maxlength', '100');
  });

  it('routes loaded-autocomplete submissions to the encoded search page', async () => {
    render(
      <NavbarSearch
        basePath="/ogabassey"
        isBlogPage={false}
        merchantId="merchant-1"
      />
    );

    fireEvent.focus(screen.getByRole('searchbox', { name: /search products/i }));

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /submit search/i })
      ).toBeInTheDocument();
    });

    fireEvent.change(screen.getByRole('searchbox', { name: /search products/i }), {
      target: { value: 'iphone 15 pro' },
    });
    fireEvent.click(screen.getByRole('button', { name: /submit search/i }));

    expect(mocks.push).toHaveBeenCalledWith(
      '/ogabassey/search?q=iphone%2015%20pro'
    );
  });

  it('ignores blank loaded-autocomplete submissions', async () => {
    render(
      <NavbarSearch
        basePath="/ogabassey"
        isBlogPage={false}
        merchantId="merchant-1"
      />
    );

    fireEvent.focus(screen.getByRole('searchbox', { name: /search products/i }));

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /submit search/i })
      ).toBeInTheDocument();
    });

    fireEvent.change(screen.getByRole('searchbox', { name: /search products/i }), {
      target: { value: '   ' },
    });
    fireEvent.click(screen.getByRole('button', { name: /submit search/i }));

    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('ignores submissions that sanitize to an empty route query', async () => {
    render(
      <NavbarSearch
        basePath="/ogabassey"
        isBlogPage={false}
        merchantId="merchant-1"
      />
    );

    fireEvent.focus(screen.getByRole('searchbox', { name: /search products/i }));

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /submit search/i })
      ).toBeInTheDocument();
    });

    // Non-blank, but the route sanitizer strips every character: navigating
    // would land on the blank search-start state and clear the navbar.
    fireEvent.change(screen.getByRole('searchbox', { name: /search products/i }), {
      target: { value: '<>()' },
    });
    fireEvent.click(screen.getByRole('button', { name: /submit search/i }));

    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('submits blog searches to the blog route', () => {
    render(
      <NavbarSearch
        basePath="/ogabassey"
        isBlogPage={true}
        merchantId="merchant-1"
      />
    );

    const input = screen.getByRole('searchbox', {
      name: /search blog posts/i,
    });
    fireEvent.change(input, { target: { value: 'flash sale' } });
    fireEvent.submit(input.closest('form') as HTMLFormElement);

    expect(mocks.push).toHaveBeenCalledWith(
      '/ogabassey/blog?search=flash%20sale'
    );
  });
});

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

  it('truncates an over-limit route query to the navbar maximum', () => {
    // The search page accepts up to 200 characters; the navbar submits at
    // most 100, so the synced input must show what Enter would submit.
    const longQuery = 'a'.repeat(200);
    mocks.queryString = `q=${longQuery}`;
    renderNavbar();

    expect(searchInput().value).toBe('a'.repeat(100));
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
});
