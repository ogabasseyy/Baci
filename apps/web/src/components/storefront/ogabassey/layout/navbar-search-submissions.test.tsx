import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  fetch: vi.fn(),
  pathname: '/ogabassey',
  queryString: '',
}));
vi.mock('next/navigation', () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ push: mocks.push }),
  useSearchParams: () => new URLSearchParams(mocks.queryString),
}));
vi.mock('@/lib/event-tracking', () => ({ trackEvent: { search: vi.fn() } }));
vi.mock('@/hooks/use-currency', () => ({
  useCurrencyWithCountry: () => ({
    formatCurrencyCompact: (price: number) => `NGN ${price}`,
  }),
}));

import { NavbarSearch } from './navbar-search';

function submissionCalls() {
  return mocks.fetch.mock.calls.filter(
    ([url]) => url === '/api/search/submissions'
  );
}
function submissionBodies() {
  return submissionCalls().map(([_, init]) => JSON.parse(init.body));
}
async function loadAutocomplete(
  suggestions: unknown[] = [],
  popularSearches: unknown[] = []
) {
  mocks.fetch.mockImplementation(async () => ({
    ok: true,
    json: async () => ({ suggestions, popularSearches }),
  }));
  render(
    <NavbarSearch
      basePath="/ogabassey"
      isBlogPage={false}
      merchantId="merchant-1"
    />
  );
  fireEvent.focus(screen.getByRole('searchbox'));
  await screen.findByRole('combobox');
  fireEvent.change(screen.getByRole('searchbox'), {
    target: { value: 'phone' },
  });
  await waitFor(() =>
    expect(mocks.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/search/autocomplete?'),
      expect.anything()
    )
  );
}

describe('mounted navbar submission paths', () => {
  beforeEach(() => {
    mocks.push.mockReset();
    mocks.fetch.mockReset();
    vi.stubGlobal('fetch', mocks.fetch);
  });

  it('submits the typed query on Enter without counting typing or repeat renders', async () => {
    await loadAutocomplete();
    expect(submissionCalls()).toHaveLength(0);
    const input = screen.getByRole('searchbox');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mocks.push).toHaveBeenCalledWith('/ogabassey/search?q=phone');
    expect(submissionBodies()).toEqual([
      { query: 'phone', pathPrefix: '/ogabassey', source: 'navbar' },
    ]);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(submissionCalls()).toHaveLength(2); // identical intentional re-submission counts
  });

  it('records see-all activation once with the current typed query', async () => {
    await loadAutocomplete();
    fireEvent.change(screen.getByRole('searchbox'), {
      target: { value: 'phone case' },
    });
    const seeAll = await screen.findByRole('button', {
      name: /see all results/i,
    });
    expect(submissionCalls()).toHaveLength(0);
    fireEvent.click(seeAll);
    expect(mocks.push).toHaveBeenCalledWith(
      '/ogabassey/search?q=phone%20case'
    );
    expect(submissionBodies()).toEqual([
      { query: 'phone case', pathPrefix: '/ogabassey', source: 'navbar' },
    ]);
  });

  it('records a submit-wired popular pick exactly once as a navbar submission', async () => {
    await loadAutocomplete([], [
      { search_query: 'phone case', search_count: 42 },
    ]);
    const option = await screen.findByRole('option', { name: /phone case/i });
    expect(submissionCalls()).toHaveLength(0);
    fireEvent.click(option);
    expect(mocks.push).toHaveBeenCalledWith(
      '/ogabassey/search?q=phone%20case'
    );
    // One user action, one row: the submit path records it, so no separate
    // popular-search row may follow.
    expect(submissionBodies()).toEqual([
      { query: 'phone case', pathPrefix: '/ogabassey', source: 'navbar' },
    ]);
  });

  it('records a keyboard popular pick exactly once as a navbar submission', async () => {
    await loadAutocomplete([], [
      { search_query: 'phone case', search_count: 42 },
    ]);
    await screen.findByRole('option', { name: /phone case/i });
    fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'ArrowDown' });
    fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Enter' });
    expect(mocks.push).toHaveBeenCalledWith(
      '/ogabassey/search?q=phone%20case'
    );
    expect(submissionBodies()).toEqual([
      { query: 'phone case', pathPrefix: '/ogabassey', source: 'navbar' },
    ]);
  });

  it('preserves highlighted-product selection without recording a search submission', async () => {
    await loadAutocomplete([
      { id: 'p1', name: 'Phone', slug: 'phone', price: 100, image_small: '' },
    ]);
    await screen.findByRole('option', { name: /phone/i });
    fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'ArrowDown' });
    fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Enter' });
    expect(mocks.push).toHaveBeenCalledWith('/ogabassey/products/phone');
    expect(submissionCalls()).toHaveLength(0);
  });
});
