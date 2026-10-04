import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SearchPageForm } from './search-page-form';

const fetchMock = vi.fn();
describe('search page form submission tracking', () => {
  beforeEach(() => {
    fetchMock.mockReset().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
  });

  it('records an explicit re-search while the native navigation proceeds', () => {
    render(
      <SearchPageForm
        action="/ogabassey/search"
        defaultQuery="old phone"
        pathPrefix="/ogabassey"
        currency="NGN"
      />
    );
    const input = screen.getByRole('searchbox', { name: 'Search products' });
    fireEvent.change(input, { target: { value: ' new phone ' } });
    expect(fetchMock).not.toHaveBeenCalled();
    const form = input.closest('form') as HTMLFormElement;
    const event = new Event('submit', { bubbles: true, cancelable: true });
    fireEvent(form, event);
    expect(event.defaultPrevented).toBe(false);
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      '/api/search/submissions',
      expect.objectContaining({
        body: JSON.stringify({
          query: 'new phone',
          pathPrefix: '/ogabassey',
          source: 'results-form',
        }),
        keepalive: true,
      })
    );
  });

  it('stays put without recording when the value has no searchable term', () => {
    render(
      <SearchPageForm
        action="/ogabassey/search"
        defaultQuery="phone"
        pathPrefix="/ogabassey"
        currency="NGN"
      />
    );
    const input = screen.getByRole('searchbox', { name: 'Search products' });
    fireEvent.change(input, { target: { value: '  <>()  ' } });
    const form = input.closest('form') as HTMLFormElement;
    const event = new Event('submit', { bubbles: true, cancelable: true });
    fireEvent(form, event);
    expect(event.defaultPrevented).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Enter a searchable term'
    );
  });
});

it('shows catalog suggestions beside the focused input and hides them on blur', () => {
  render(
    <SearchPageForm
      action="/search"
      pathPrefix=""
      defaultQuery="iphone"
      currency="NGN"
      refinements={{ brands: [], sort: 'relevance' }}
      suggestionProducts={[{ price: 250000, condition: 'used' }]}
    />
  );
  const input = screen.getByRole('searchbox');
  expect(screen.queryByRole('link', { name: 'Used iphone' })).toBeNull();
  fireEvent.focus(input);
  expect(
    screen.getByRole('link', { name: 'Used iphone' }).getAttribute('href')
  ).toContain('condition=used');
  expect(screen.queryByText('✦ Find for me')).toBeNull();
  fireEvent.blur(input);
  expect(screen.queryByRole('link', { name: 'Used iphone' })).toBeNull();
});

it('keeps the requested red outline specific to Ogabassey', () => {
  const props = {
    action: '/search',
    pathPrefix: '',
    defaultQuery: 'phone',
    currency: 'NGN',
  };
  const { rerender } = render(<SearchPageForm {...props} />);
  expect(screen.getByRole('searchbox')).toHaveClass('border-store-primary');
  rerender(<SearchPageForm {...props} redOutline />);
  expect(screen.getByRole('searchbox')).toHaveClass(
    'border-red-600',
    'focus:border-red-600'
  );
});
