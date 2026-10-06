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
