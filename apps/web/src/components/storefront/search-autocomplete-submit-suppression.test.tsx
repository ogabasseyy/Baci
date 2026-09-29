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

  it('keeps a submitted popular term from reopening autocomplete (pointer)', async () => {
    vi.useRealTimers();
    const onChange = vi.fn();
    const onSubmitSearch = vi.fn();
    let resolveSecond: (value: unknown) => void = () => undefined;
    const secondJson = new Promise((resolve) => {
      resolveSecond = resolve;
    });
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              suggestions: [],
              popularSearches: [
                { search_query: 'galaxy s25', search_count: 42 },
              ],
            }),
        })
      )
      .mockImplementation(() =>
        Promise.resolve({ ok: true, json: () => secondJson })
      ) as unknown as typeof fetch;
    globalThis.fetch = fetchMock;

    const { rerender } = render(
      <SearchAutocomplete
        merchantId="merchant-1"
        value="iph"
        onChange={onChange}
        onSubmitSearch={onSubmitSearch}
      />
    );

    await waitFor(() => {
      expect(
        screen.getByRole('option', { name: /galaxy s25/i })
      ).toBeInTheDocument();
    });

    // Activating the popular option syncs the input, submits (navigating
    // away on persistent consumers), and closes the popup.
    fireEvent.click(screen.getByRole('option', { name: /galaxy s25/i }));
    expect(onChange).toHaveBeenCalledWith('galaxy s25');
    expect(onSubmitSearch).toHaveBeenCalledWith('galaxy s25');
    rerender(
      <SearchAutocomplete
        merchantId="merchant-1"
        value="galaxy s25"
        onChange={onChange}
        onSubmitSearch={onSubmitSearch}
      />
    );
    expect(
      screen.queryByRole('option', { name: /galaxy s25/i })
    ).not.toBeInTheDocument();

    // The submitted value reaches the debounce after navigation and starts
    // a request that did not exist when the pending one was cancelled: its
    // results must not reopen the popup over the destination page.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
    // Successful suggestion fetches also emit an analytics POST, so count
    // only the autocomplete requests.
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
    await act(async () => {
      resolveSecond({
        suggestions: [
          {
            id: 'product-2',
            name: 'Galaxy S25',
            slug: 'galaxy-s25',
            category: 'Smartphones',
            price: 800_000,
            image_small: '',
          },
        ],
        popularSearches: [],
      });
      await secondJson;
    });

    expect(
      screen.queryByRole('option', { name: /galaxy s25/i })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /see all results/i })
    ).not.toBeInTheDocument();

    // Refocusing re-arms opening and shows the stored results.
    fireEvent.focus(screen.getByRole('searchbox'));
    expect(
      screen.getByRole('option', { name: /galaxy s25/i })
    ).toBeInTheDocument();
  });

  it('keeps a submitted popular term from reopening autocomplete (keyboard)', async () => {
    vi.useRealTimers();
    const onChange = vi.fn();
    const onSubmitSearch = vi.fn();
    let resolveSecond: (value: unknown) => void = () => undefined;
    const secondJson = new Promise((resolve) => {
      resolveSecond = resolve;
    });
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              suggestions: [],
              popularSearches: [
                { search_query: 'galaxy s25', search_count: 42 },
              ],
            }),
        })
      )
      .mockImplementation(() =>
        Promise.resolve({ ok: true, json: () => secondJson })
      ) as unknown as typeof fetch;
    globalThis.fetch = fetchMock;

    const { rerender } = render(
      <SearchAutocomplete
        merchantId="merchant-1"
        value="iph"
        onChange={onChange}
        onSubmitSearch={onSubmitSearch}
      />
    );

    const input = screen.getByRole('searchbox');
    await waitFor(() => {
      expect(
        screen.getByRole('option', { name: /galaxy s25/i })
      ).toBeInTheDocument();
    });

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('galaxy s25');
    expect(onSubmitSearch).toHaveBeenCalledWith('galaxy s25');
    rerender(
      <SearchAutocomplete
        merchantId="merchant-1"
        value="galaxy s25"
        onChange={onChange}
        onSubmitSearch={onSubmitSearch}
      />
    );
    expect(
      screen.queryByRole('option', { name: /galaxy s25/i })
    ).not.toBeInTheDocument();

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
    // Successful suggestion fetches also emit an analytics POST, so count
    // only the autocomplete requests.
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
    await act(async () => {
      resolveSecond({
        suggestions: [
          {
            id: 'product-2',
            name: 'Galaxy S25',
            slug: 'galaxy-s25',
            category: 'Smartphones',
            price: 800_000,
            image_small: '',
          },
        ],
        popularSearches: [],
      });
      await secondJson;
    });

    expect(
      screen.queryByRole('option', { name: /galaxy s25/i })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /see all results/i })
    ).not.toBeInTheDocument();
  });
});
