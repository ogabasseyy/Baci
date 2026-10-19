import { act, render, screen, waitFor } from '@testing-library/react';
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

  it('renders ranked autocomplete suggestions in API order', async () => {
    vi.useRealTimers();
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        suggestions: [
          {
            id: 'product-2',
            name: 'iPhone 16 Pro',
            slug: 'iphone-16-pro',
            category: 'Smartphones',
            price: 1_200_000,
            image_small: '',
          },
          {
            id: 'product-1',
            name: 'iPhone X',
            slug: 'iphone-x',
            category: 'Smartphones',
            price: 240_000,
            image_small: '',
          },
        ],
        popularSearches: [],
      }),
    } as Response);

    render(
      <SearchAutocomplete
        merchantId="merchant-1"
        value="iphnoe"
        onChange={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/search/autocomplete?q=iphnoe&merchant_id=merchant-1&limit=10',
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
    });

    const options = await screen.findAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual([
      expect.stringContaining('iPhone 16 Pro'),
      expect.stringContaining('iPhone X'),
    ]);
  });

  it('aborts the in-flight request when the debounced query is superseded', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(
      () =>
        new Promise(() => {
          // Keep the request pending so only an abort can settle it.
        })
    ) as unknown as typeof fetch;
    globalThis.fetch = fetchMock;

    const { rerender } = render(
      <SearchAutocomplete
        merchantId="merchant-1"
        value="iphone"
        onChange={vi.fn()}
      />
    );

    // Flush the mount effect that dispatches the first request, then capture its
    // abort signal.
    await act(async () => {
      await Promise.resolve();
    });
    const firstSignal = (
      vi
        .mocked(fetchMock)
        .mock.calls.find(
          ([url]) => typeof url === 'string' && url.includes('q=iphone&')
        )?.[1] as RequestInit | undefined
    )?.signal;
    expect(firstSignal).toBeInstanceOf(AbortSignal);
    expect(firstSignal?.aborted).toBe(false);

    // A genuinely new query, once the debounce commits, supersedes and aborts the
    // prior request and dispatches a replacement. We intentionally do NOT abort
    // on every raw keystroke (that could strand the query with no replacement).
    rerender(
      <SearchAutocomplete
        merchantId="merchant-1"
        value="iphone 12"
        onChange={vi.fn()}
      />
    );
    await act(async () => {
      vi.advanceTimersByTime(200);
      await Promise.resolve();
    });

    expect(firstSignal?.aborted).toBe(true);
    expect(
      vi
        .mocked(fetchMock)
        .mock.calls.some(
          ([url]) => typeof url === 'string' && url.includes('iphone%2012')
        )
    ).toBe(true);
  });

  it('keeps the autocomplete popup closed for empty ranked suggestions', async () => {
    vi.useRealTimers();
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        suggestions: [],
        popularSearches: [],
      }),
    } as Response);

    render(
      <SearchAutocomplete
        merchantId="merchant-1"
        value="zzzz"
        onChange={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/search/autocomplete?q=zzzz&merchant_id=merchant-1&limit=10',
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
    });

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});
