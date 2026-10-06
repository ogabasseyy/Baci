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

  it('keeps product suggestion clicks as direct-product shortcuts', async () => {
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

    render(
      <SearchAutocomplete
        merchantId="merchant-1"
        value="iphone"
        onChange={vi.fn()}
        onSelectProduct={onSelectProduct}
        onSubmitSearch={onSubmitSearch}
      />
    );

    const option = await screen.findByRole('option', { name: /iphone 16/i });
    fireEvent.click(option);

    expect(onSelectProduct).toHaveBeenCalledTimes(1);
    expect(onSelectProduct.mock.calls[0]?.[0]).toContain('iphone-16');
    expect(onSubmitSearch).not.toHaveBeenCalled();
  });

  it('opens a keyboard-highlighted product directly', async () => {
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

    render(
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
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onSelectProduct).toHaveBeenCalledTimes(1);
    expect(onSelectProduct.mock.calls[0]?.[0]).toContain('iphone-16');
    expect(onSubmitSearch).not.toHaveBeenCalled();
  });

  it('submits the typed query when Enter follows an Escape dismissal', async () => {
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

    render(
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

    // Highlighting then dismissing hides the popup; the highlight must go
    // with it so a later Enter submits the typed query instead of
    // following the now-hidden option.
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(
      screen.queryByRole('option', { name: /iphone 16/i })
    ).not.toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Enter' });
    expect(onSubmitSearch).toHaveBeenCalledWith('iphone');
    expect(onSelectProduct).not.toHaveBeenCalled();
  });
});
