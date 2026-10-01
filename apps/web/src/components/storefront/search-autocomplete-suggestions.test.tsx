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

  it('selects the first autocomplete suggestion when Enter is pressed without a highlighted option', async () => {
    vi.useRealTimers();
    const onSelectProduct = vi.fn();
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        suggestions: [
          {
            id: 'product-1',
            name: 'Samsung Galaxy S23',
            slug: 'samsung-galaxy-s23',
            category: 'Smartphones',
            price: 450000,
            image_small: '',
          },
        ],
        popularSearches: [],
      }),
    } as Response);

    render(
      <SearchAutocomplete
        merchantId="merchant-1"
        value="samsung"
        onChange={vi.fn()}
        onSelectProduct={onSelectProduct}
      />
    );

    const input = screen.getByRole('searchbox', { name: /search products/i });
    fireEvent.focus(input);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
      expect(
        screen.getByRole('option', { name: /samsung galaxy s23/i })
      ).toBeInTheDocument();
    });

    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onSelectProduct).toHaveBeenCalledTimes(1);
    expect(onSelectProduct.mock.calls[0]?.[0]).toContain('samsung-galaxy-s23');
  });

  it('clears loading when the debounced query becomes too short', async () => {
    vi.useFakeTimers();
    globalThis.fetch = vi.fn(
      () =>
        new Promise(() => {
          // Keep the request pending to simulate a slow network.
        })
    ) as typeof fetch;

    const { rerender } = render(
      <SearchAutocomplete
        merchantId="merchant-1"
        value="iphone"
        onChange={vi.fn()}
      />
    );

    const combobox = screen.getByRole('combobox');
    await act(async () => {
      await Promise.resolve();
    });
    expect(combobox).toHaveAttribute('aria-busy', 'true');

    rerender(
      <SearchAutocomplete
        merchantId="merchant-1"
        value="i"
        onChange={vi.fn()}
      />
    );

    await act(async () => {
      vi.advanceTimersByTime(300);
      await Promise.resolve();
    });

    expect(combobox).toHaveAttribute('aria-busy', 'false');
  });

  it('formats suggestion prices with the storefront country currency', async () => {
    vi.useRealTimers();
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        suggestions: [
          {
            id: 'product-1',
            name: 'Kurta Set',
            slug: 'kurta-set',
            category: 'Fashion',
            price: 2500,
            image_small: '',
          },
        ],
        popularSearches: [],
      }),
    } as Response);

    render(
      <SearchAutocomplete
        merchantId="merchant-1"
        value="kurta"
        onChange={vi.fn()}
        countryCode="IN"
      />
    );

    await waitFor(() => {
      expect(
        screen.getByRole('option', { name: /kurta set/i })
      ).toHaveTextContent(/₹|INR/);
    });
    expect(
      screen.getByRole('option', { name: /kurta set/i })
    ).not.toHaveTextContent('₦');
  });

  it('falls back to Nigerian currency when storefront country is omitted', async () => {
    vi.useRealTimers();
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        suggestions: [
          {
            id: 'product-1',
            name: 'Kurta Set',
            slug: 'kurta-set',
            category: 'Fashion',
            price: 2500,
            image_small: '',
          },
        ],
        popularSearches: [],
      }),
    } as Response);

    render(
      <SearchAutocomplete
        merchantId="merchant-1"
        value="kurta"
        onChange={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(
        screen.getByRole('option', { name: /kurta set/i })
      ).toHaveTextContent(/₦|NGN/);
    });
    expect(
      screen.getByRole('option', { name: /kurta set/i })
    ).not.toHaveTextContent(/₹|INR/);
  });
});
