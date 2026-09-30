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

  it('submits the typed query on Enter even when product suggestions exist', async () => {
    vi.useRealTimers();
    const onSubmitSearch = vi.fn();
    const onSelectProduct = vi.fn();
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
        onSelectProduct={onSelectProduct}
        onSubmitSearch={onSubmitSearch}
      />
    );

    await waitFor(() => {
      expect(
        screen.getByRole('option', { name: /iphone 16/i })
      ).toBeInTheDocument();
    });

    fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Enter' });

    expect(onSubmitSearch).toHaveBeenCalledTimes(1);
    expect(onSubmitSearch).toHaveBeenCalledWith('iphone');
    expect(onSelectProduct).not.toHaveBeenCalled();
  });

  it('keeps blank queries on the current page instead of submitting', () => {
    vi.useRealTimers();
    const onSubmitSearch = vi.fn();

    render(
      <SearchAutocomplete
        merchantId="merchant-1"
        value="   "
        onChange={vi.fn()}
        onSubmitSearch={onSubmitSearch}
      />
    );

    fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Enter' });

    expect(onSubmitSearch).not.toHaveBeenCalled();
    expect(
      screen.queryByRole('button', { name: /see all results/i })
    ).not.toBeInTheDocument();
  });

  it('syncs the input to a highlighted popular search before submitting', async () => {
    vi.useRealTimers();
    const onSubmitSearch = vi.fn();
    const onChange = vi.fn();
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
        popularSearches: [{ search_query: 'iphone case', search_count: 42 }],
      }),
    } as Response);

    render(
      <SearchAutocomplete
        merchantId="merchant-1"
        value="iphone"
        onChange={onChange}
        onSubmitSearch={onSubmitSearch}
      />
    );

    const input = screen.getByRole('searchbox');
    await waitFor(() => {
      expect(
        screen.getByRole('option', { name: /iphone case/i })
      ).toBeInTheDocument();
    });

    // Arrow past the product suggestion onto the popular search.
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onSubmitSearch).toHaveBeenCalledTimes(1);
    expect(onSubmitSearch).toHaveBeenCalledWith('iphone case');
    // The controlled input syncs first so the persisted navbar displays the
    // submitted suggestion instead of the previous text after navigation.
    expect(onChange).toHaveBeenCalledWith('iphone case');
  });

  it('fills the input for a highlighted popular search without a submit handler', async () => {
    vi.useRealTimers();
    const onChange = vi.fn();
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        suggestions: [],
        popularSearches: [{ search_query: 'iphone case', search_count: 42 }],
      }),
    } as Response);

    render(
      <SearchAutocomplete
        merchantId="merchant-1"
        value="iphone"
        onChange={onChange}
      />
    );

    const input = screen.getByRole('searchbox');
    await waitFor(() => {
      expect(
        screen.getByRole('option', { name: /iphone case/i })
      ).toBeInTheDocument();
    });

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onChange).toHaveBeenCalledWith('iphone case');
  });

  it('submits the typed value after a highlight is edited away', async () => {
    vi.useRealTimers();
    const onChange = vi.fn();
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

    const { rerender } = render(
      <SearchAutocomplete
        merchantId="merchant-1"
        value="iphone"
        onChange={onChange}
        onSubmitSearch={onSubmitSearch}
      />
    );

    const input = screen.getByRole('searchbox');
    await waitFor(() => {
      expect(
        screen.getByRole('option', { name: /iphone 16/i })
      ).toBeInTheDocument();
    });

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(screen.getByRole('option', { name: /iphone 16/i })).toHaveAttribute(
      'aria-selected',
      'true'
    );

    // Editing down to one character clears the options while the submit
    // popup stays open; Enter must submit the typed value, not crash on
    // the stale highlight.
    fireEvent.change(input, { target: { value: 'x' } });
    rerender(
      <SearchAutocomplete
        merchantId="merchant-1"
        value="x"
        onChange={onChange}
        onSubmitSearch={onSubmitSearch}
      />
    );

    fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Enter' });
    expect(onSubmitSearch).toHaveBeenCalledWith('x');
  });
});
