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

describe('SearchAutocomplete', () => {
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

  it('shows a working "See all results" action beside the suggestions', async () => {
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
        value="iphone"
        onChange={vi.fn()}
        onSubmitSearch={onSubmitSearch}
      />
    );

    const seeAll = await screen.findByRole('button', {
      name: /see all results for “iphone”/i,
    });

    // A listbox may only own option/group children: the action must be a
    // sibling beside it, not an option inside it.
    const listbox = screen.getByRole('listbox');
    expect(listbox).not.toContainElement(seeAll);
    // With a rendered listbox, the combobox reports expanded.
    expect(screen.getByRole('combobox')).toHaveAttribute(
      'aria-expanded',
      'true'
    );

    fireEvent.click(seeAll);
    expect(onSubmitSearch).toHaveBeenCalledTimes(1);
    expect(onSubmitSearch).toHaveBeenCalledWith('iphone');
  });

  it('shows "See all results" even when there are no suggestions', async () => {
    vi.useRealTimers();
    const onSubmitSearch = vi.fn();
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        suggestions: [],
        popularSearches: [],
      }),
    } as Response);

    const { container } = render(
      <SearchAutocomplete
        merchantId="merchant-1"
        value="zzzz"
        onChange={vi.fn()}
        onSubmitSearch={onSubmitSearch}
      />
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    // The empty response settled, so the genuine no-suggestions message
    // appears alongside the submit action, with the matching announcement.
    await waitFor(() => {
      expect(screen.getByText(/no suggestions for/i)).toBeInTheDocument();
    });
    expect(container.querySelector('.sr-only')?.textContent ?? '').toContain(
      'No results found'
    );
    const seeAll = screen.getByRole('button', { name: /see all results/i });
    fireEvent.click(seeAll);
    expect(onSubmitSearch).toHaveBeenCalledWith('zzzz');
  });

  it('keeps "See all results" reachable when the suggestion fetch fails', async () => {
    vi.useRealTimers();
    const onSubmitSearch = vi.fn();
    const onChange = vi.fn();
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockRejectedValue(new Error('autocomplete down'));

    const { rerender } = render(
      <SearchAutocomplete
        merchantId="merchant-1"
        value=""
        onChange={onChange}
        onSubmitSearch={onSubmitSearch}
      />
    );

    const input = screen.getByRole('searchbox');
    fireEvent.change(input, { target: { value: 'iphone' } });
    rerender(
      <SearchAutocomplete
        merchantId="merchant-1"
        value="iphone"
        onChange={onChange}
        onSubmitSearch={onSubmitSearch}
      />
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });

    const seeAll = screen.getByRole('button', { name: /see all results/i });
    fireEvent.click(seeAll);
    expect(onSubmitSearch).toHaveBeenCalledWith('iphone');
  });

  it('hides "See all results" when no submit handler is wired', async () => {
    vi.useRealTimers();
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
        value="iphone"
        onChange={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole('listbox')).toBeInTheDocument();
    });

    expect(
      screen.queryByRole('button', { name: /see all results/i })
    ).not.toBeInTheDocument();
  });
});
