import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ push: vi.fn(), fetch: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));
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

  it('submits from the loaded autocomplete form without counting typing or repeat renders', async () => {
    await loadAutocomplete();
    expect(submissionCalls()).toHaveLength(0);
    const input = screen.getByRole('searchbox');
    fireEvent.submit(input.closest('form') as HTMLFormElement);
    expect(mocks.push).toHaveBeenCalledWith('/ogabassey/search?q=phone');
    expect(submissionCalls()).toHaveLength(1);
    fireEvent.submit(input.closest('form') as HTMLFormElement);
    expect(submissionCalls()).toHaveLength(2); // identical intentional re-submission counts
  });

  it('records see-all activation with the current typed query, not a stale suggestion query', async () => {
    await loadAutocomplete();
    await screen.findByRole('link', { name: /see all results/i });
    fireEvent.change(screen.getByRole('searchbox'), {
      target: { value: 'phone case' },
    });
    const link = screen.getByRole('link', { name: /see all results/i });
    expect(link).toHaveAttribute('href', '/ogabassey/search?q=phone%20case');
    expect(submissionCalls()).toHaveLength(0);
    link.addEventListener('click', (event) => event.preventDefault());
    fireEvent.click(link);
    expect(submissionCalls()).toHaveLength(1);
    expect(JSON.parse(submissionCalls()[0][1].body)).toEqual({
      query: 'phone case',
      pathPrefix: '/ogabassey',
      source: 'see-all',
    });
  });

  it('announces the see-all popup as expanded when no results render', async () => {
    await loadAutocomplete();
    await screen.findByRole('link', { name: /see all results/i });
    expect(screen.getByRole('combobox')).toHaveAttribute(
      'aria-expanded',
      'true'
    );
  });

  it('records popular-search activation from click and keyboard', async () => {
    await loadAutocomplete([], [
      { search_query: 'phone case', search_count: 42 },
    ]);
    const option = await screen.findByRole('option', { name: /phone case/i });
    expect(submissionCalls()).toHaveLength(0);
    fireEvent.click(option);
    expect(submissionCalls()).toHaveLength(1);
    expect(JSON.parse(submissionCalls()[0][1].body)).toEqual({
      query: 'phone case',
      pathPrefix: '/ogabassey',
      source: 'popular-search',
    });
    fireEvent.change(screen.getByRole('searchbox'), {
      target: { value: 'phone cover' },
    });
    await screen.findByRole('option', { name: /phone case/i });
    fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'ArrowDown' });
    fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Enter' });
    expect(submissionCalls()).toHaveLength(2);
    expect(JSON.parse(submissionCalls()[1][1].body).source).toBe(
      'popular-search'
    );
  });

  it('preserves Enter-to-product selection without recording a search submission', async () => {
    await loadAutocomplete([
      { id: 'p1', name: 'Phone', slug: 'phone', price: 100, image_small: '' },
    ]);
    await screen.findByRole('option', { name: /phone/i });
    fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Enter' });
    expect(mocks.push).toHaveBeenCalledWith('/ogabassey/products/phone');
    expect(submissionCalls()).toHaveLength(0);
  });
});
