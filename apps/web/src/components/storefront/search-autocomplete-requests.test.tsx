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

  it('cancels the pending request when submitting the full search', async () => {
    vi.useRealTimers();
    const onSubmitSearch = vi.fn();
    let resolveJson: (value: unknown) => void = () => undefined;
    const jsonPromise = new Promise((resolve) => {
      resolveJson = resolve;
    });
    const fetchMock = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => jsonPromise })
    ) as unknown as typeof fetch;
    globalThis.fetch = fetchMock;

    render(
      <SearchAutocomplete
        merchantId="merchant-1"
        value="ip"
        onChange={vi.fn()}
        onSubmitSearch={onSubmitSearch}
      />
    );

    // Focus opens the submit popup; the debounced fetch stays pending.
    fireEvent.focus(screen.getByRole('searchbox'));
    const seeAll = screen.getByRole('button', {
      name: /see all results for “ip”/i,
    });
    await waitFor(() => {
      expect(vi.mocked(fetchMock)).toHaveBeenCalledTimes(1);
    });
    const signal = vi.mocked(fetchMock).mock.calls[0]?.[1]?.signal as
      | AbortSignal
      | undefined;
    expect(signal?.aborted).toBe(false);

    // Submitting navigates away (persistent consumers stay mounted), so
    // the pending request is cancelled with the close.
    fireEvent.click(seeAll);
    expect(onSubmitSearch).toHaveBeenCalledWith('ip', 'see-all');
    expect(signal?.aborted).toBe(true);
    expect(
      screen.queryByRole('button', { name: /see all results/i })
    ).not.toBeInTheDocument();

    // The late response must not reopen the popup over the new page.
    await act(async () => {
      resolveJson({
        suggestions: [
          {
            id: 'late-1',
            name: 'Late arrival',
            slug: 'late-arrival',
            category: 'Phones',
            price: 100,
            image_small: '',
          },
        ],
        popularSearches: [],
      });
      await jsonPromise;
    });

    expect(
      screen.queryByRole('button', { name: /see all results/i })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('option', { name: /late arrival/i })
    ).not.toBeInTheDocument();
  });

  it('restarts the request when the same query returns after transient short input', async () => {
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
        value="iphone"
        onChange={onChange}
        onSubmitSearch={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(vi.mocked(fetchMock)).toHaveBeenCalledTimes(1);
    });
    const firstSignal = vi.mocked(fetchMock).mock.calls[0]?.[1]?.signal as
      | AbortSignal
      | undefined;

    // Briefly shortening below two characters aborts and clears the
    // pending request...
    fireEvent.change(screen.getByRole('searchbox'), {
      target: { value: 'i' },
    });
    rerender(
      <SearchAutocomplete
        merchantId="merchant-1"
        value="i"
        onChange={onChange}
        onSubmitSearch={vi.fn()}
      />
    );
    expect(firstSignal?.aborted).toBe(true);

    // ...and restoring the same query within the debounce window never
    // changes the debounced value, so the request must restart anyway.
    fireEvent.change(screen.getByRole('searchbox'), {
      target: { value: 'iphone' },
    });
    rerender(
      <SearchAutocomplete
        merchantId="merchant-1"
        value="iphone"
        onChange={onChange}
        onSubmitSearch={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(vi.mocked(fetchMock)).toHaveBeenCalledTimes(2);
    });

    await act(async () => {
      resolveJson({
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
      });
      await jsonPromise;
    });

    await waitFor(() => {
      expect(
        screen.getByRole('option', { name: /iphone 16/i })
      ).toBeInTheDocument();
    });
  });

  it('drops stale options when editing after dismissing the popup', async () => {
    vi.useRealTimers();
    const onChange = vi.fn();
    const onSubmitSearch = vi.fn();
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock
      .mockResolvedValueOnce({
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
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ suggestions: [], popularSearches: [] }),
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

    // Dismiss the populated popup, then edit to a different query: the
    // reopened popup must not offer the previous query's options beneath
    // the new text.
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();

    fireEvent.change(input, { target: { value: 'galaxy' } });
    rerender(
      <SearchAutocomplete
        merchantId="merchant-1"
        value="galaxy"
        onChange={onChange}
        onSubmitSearch={onSubmitSearch}
      />
    );

    expect(
      screen.queryByRole('option', { name: /iphone 16/i })
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /see all results for “galaxy”/i })
    ).toBeInTheDocument();

    // The fresh fetch for the new query still goes out normally (call
    // counts include analytics posts, so match the request URL instead).
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('q=galaxy'),
        expect.anything()
      );
    });
  });
});
