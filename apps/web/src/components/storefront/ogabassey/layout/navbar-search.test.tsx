import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
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

    // pushSearchRoute truncates to the shared route limit: the input
    // carries the same cap so the persistent value can never exceed the
    // submitted query after a long paste.
    expect(
      screen.getByRole('searchbox', { name: /search products/i })
    ).toHaveAttribute('maxlength', '200');
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

  it('clamps blog searches to the 100-character listing limit', () => {
    // The listing lookup discards everything past 100 characters, so the
    // blog branch must not use the 200-character product limit.
    render(
      <NavbarSearch
        basePath="/ogabassey"
        isBlogPage={true}
        merchantId="merchant-1"
      />
    );

    const input = screen.getByRole('searchbox', {
      name: /search blog posts/i,
    }) as HTMLInputElement;
    expect(input.maxLength).toBe(100);

    fireEvent.change(input, { target: { value: 'a'.repeat(150) } });
    fireEvent.submit(input.closest('form') as HTMLFormElement);

    expect(mocks.push).toHaveBeenCalledWith(
      `/ogabassey/blog?search=${'a'.repeat(100)}`
    );
  });
});
