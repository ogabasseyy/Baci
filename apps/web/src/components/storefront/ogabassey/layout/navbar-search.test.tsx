import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: vi.fn(() => ({
    push: mocks.push,
  })),
}));

vi.mock('@/components/storefront/search-autocomplete', () => ({
  SearchAutocomplete: ({
    value,
    onChange,
    onSelectProduct,
    onSubmitSearch,
  }: {
    value: string;
    onChange: (value: string) => void;
    onSelectProduct: (url: string) => void;
    onSubmitSearch?: (query: string) => void;
  }) => (
    <div>
      <input
        type="search"
        aria-label="Search products"
        value={value}
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
