import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { SearchAutocomplete } from './search-autocomplete';

// Mock Next.js Image since it's not supported in jsdom
vi.mock('next/image', () => ({
  // biome-ignore lint/performance/noImgElement: mock implementation requires img
  default: (props: ComponentProps<'img'>) => <img {...props} alt={props.alt} />,
}));

const OriginalResizeObserver = globalThis.ResizeObserver;
const OriginalFetch = globalThis.fetch;

// Mirrors the navbar's eligibility check: input made entirely of
// route-stripped characters parses to an empty query.
const stripPunctuation = (query: string) =>
  query.replace(/[^a-z0-9]+/gi, '').length > 0;

beforeAll(() => {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {
      // intentional noop
    }
    unobserve() {
      // intentional noop
    }
    disconnect() {
      // intentional noop
    }
  };
});

afterAll(() => {
  globalThis.ResizeObserver = OriginalResizeObserver;
  globalThis.fetch = OriginalFetch;
});

describe('SearchAutocomplete submit eligibility', () => {
  beforeEach(() => {
    vi.useRealTimers();
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ suggestions: [], popularSearches: [] }),
      })
    ) as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('hides "See all results" when the validator rejects the query', async () => {
    vi.useRealTimers();
    const onSubmitSearch = vi.fn();

    render(
      <SearchAutocomplete
        merchantId="merchant-1"
        value="<>()"
        onChange={vi.fn()}
        onSubmitSearch={onSubmitSearch}
        isSearchSubmittable={stripPunctuation}
      />
    );

    await waitFor(() => {
      expect(vi.mocked(globalThis.fetch)).toHaveBeenCalled();
    });

    // Nothing actionable to show: no suggestions arrived and the action
    // stays hidden, so the popup never advertises the submission the
    // route guard would drop. The input keeps the typed value.
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /see all results/i })
    ).not.toBeInTheDocument();
    expect(screen.getByRole('searchbox')).toHaveValue('<>()');
  });

  it('keeps Enter on a rejected query from submitting or closing', async () => {
    vi.useRealTimers();
    const onSubmitSearch = vi.fn();
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        suggestions: [
          {
            id: 'product-1',
            name: 'iPhone 16',
            slug: 'iphone-16',
            category: 'Smartphones',
            price: 900_000,
            image_small: '',
          },
        ],
        popularSearches: [],
      }),
    } as Response);

    render(
      <SearchAutocomplete
        merchantId="merchant-1"
        value="<>()"
        onChange={vi.fn()}
        onSubmitSearch={onSubmitSearch}
        isSearchSubmittable={stripPunctuation}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole('listbox')).toBeInTheDocument();
    });
    expect(
      screen.queryByRole('button', { name: /see all results/i })
    ).not.toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Enter' });

    // Stays put with the popup open: suggestions retained, nothing dropped.
    expect(onSubmitSearch).not.toHaveBeenCalled();
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    expect(screen.getByRole('searchbox')).toHaveValue('<>()');
  });

  it('shows the action when the validator accepts the query', async () => {
    vi.useRealTimers();
    const onSubmitSearch = vi.fn();

    render(
      <SearchAutocomplete
        merchantId="merchant-1"
        value="iphone"
        onChange={vi.fn()}
        onSubmitSearch={onSubmitSearch}
        isSearchSubmittable={stripPunctuation}
      />
    );

    const seeAll = await screen.findByRole('button', {
      name: /see all results for “iphone”/i,
    });
    fireEvent.click(seeAll);
    expect(onSubmitSearch).toHaveBeenCalledWith('iphone', 'see-all');
  });
});
