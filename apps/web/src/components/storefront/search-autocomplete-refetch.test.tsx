import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
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

  it('restarts the request after a multi-keystroke query restoration', async () => {
    vi.useRealTimers();
    const onChange = vi.fn();
    let resolveJson: (value: unknown) => void = () => undefined;
    const jsonPromise = new Promise((resolve) => {
      resolveJson = resolve;
    });
    const fetchMock = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => jsonPromise })
    ) as unknown as typeof fetch;
    globalThis.fetch = fetchMock;

    const { rerender } = render(
      <SearchAutocomplete
        merchantId="merchant-1"
        value="abcd"
        onChange={onChange}
        onSubmitSearch={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(vi.mocked(fetchMock)).toHaveBeenCalledTimes(1);
    });

    // Shorten below two characters (aborts the request), then restore the
    // same query over several keystrokes without leaving the debounce
    // window: the debounced value never changes, so only the recorded
    // cleared query can restart the request.
    const restoreThrough = (nextValue: string) => {
      fireEvent.change(screen.getByRole('searchbox'), {
        target: { value: nextValue },
      });
      rerender(
        <SearchAutocomplete
          merchantId="merchant-1"
          value={nextValue}
          onChange={onChange}
          onSubmitSearch={vi.fn()}
        />
      );
    };
    restoreThrough('a');
    restoreThrough('ab');
    restoreThrough('abc');
    restoreThrough('abcd');

    await waitFor(() => {
      expect(vi.mocked(fetchMock)).toHaveBeenCalledTimes(2);
    });

    await act(async () => {
      resolveJson({
        suggestions: [
          {
            id: 'product-1',
            name: 'Abcd gadget',
            slug: 'abcd-gadget',
            category: 'Gadgets',
            price: 100,
            image_small: '',
          },
        ],
        popularSearches: [],
      });
      await jsonPromise;
    });

    await waitFor(() => {
      expect(
        screen.getByRole('option', { name: /abcd gadget/i })
      ).toBeInTheDocument();
    });
  });

  it('refetches settled suggestions when refocusing after a submit cleared them', async () => {
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

    await waitFor(() => {
      expect(
        screen.getByRole('option', { name: /iphone 16/i })
      ).toBeInTheDocument();
    });

    // Submitting clears the settled arrays without changing the debounced
    // query (persistent consumers navigate with the component mounted).
    fireEvent.click(
      screen.getByRole('button', { name: /see all results for “iphone”/i })
    );
    expect(onSubmitSearch).toHaveBeenCalledWith('iphone', 'see-all');
    expect(
      screen.queryByRole('option', { name: /iphone 16/i })
    ).not.toBeInTheDocument();

    // Focusing the unchanged input afterwards (back navigation, persistent
    // results-page navbar) must refetch them instead of leaving the popup
    // limited to the submit action.
    const autocompleteCalls = () =>
      vi
        .mocked(fetchMock)
        .mock.calls.filter(
          ([url]) =>
            typeof url === 'string' &&
            url.startsWith('/api/search/autocomplete')
        );
    fireEvent.focus(screen.getByRole('searchbox'));

    await waitFor(() => {
      expect(autocompleteCalls()).toHaveLength(2);
    });
    await waitFor(() => {
      expect(
        screen.getByRole('option', { name: /iphone 16/i })
      ).toBeInTheDocument();
    });
  });

  it('drops stale options when the controlled value changes externally', async () => {
    vi.useRealTimers();
    const onSelectProduct = vi.fn();
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
        onChange={vi.fn()}
        onSelectProduct={onSelectProduct}
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

    // An external replacement (e.g. the navbar route sync after a
    // did-you-mean navigation) is a wholesale context switch: the previous
    // query's options and highlight must go so neither Enter nor a pointer
    // tap can reach a product unrelated to the new query.
    rerender(
      <SearchAutocomplete
        merchantId="merchant-1"
        value="galaxy"
        onChange={vi.fn()}
        onSelectProduct={onSelectProduct}
        onSubmitSearch={onSubmitSearch}
      />
    );

    expect(
      screen.queryByRole('option', { name: /iphone 16/i })
    ).not.toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Enter' });
    expect(onSubmitSearch).toHaveBeenCalledWith('galaxy');
    expect(onSelectProduct).not.toHaveBeenCalled();

    // The debounce fetch for the new value repopulates immediately after.
    const autocompleteCalls = () =>
      vi
        .mocked(fetchMock)
        .mock.calls.filter(
          ([url]) =>
            typeof url === 'string' &&
            url.startsWith('/api/search/autocomplete')
        );
    await waitFor(() => {
      expect(autocompleteCalls()).toHaveLength(2);
    });
    expect(autocompleteCalls()[1]?.[0]).toContain('q=galaxy');
  });
});
