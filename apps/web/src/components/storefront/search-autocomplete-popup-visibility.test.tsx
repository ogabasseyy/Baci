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

  it('reopens the submit popup on focus for a one-character query', () => {
    vi.useRealTimers();
    const onSubmitSearch = vi.fn();

    const { container } = render(
      <SearchAutocomplete
        merchantId="merchant-1"
        value="x"
        onChange={vi.fn()}
        onSubmitSearch={onSubmitSearch}
      />
    );

    // Short queries never fetch, so nothing opens the popup initially.
    expect(
      screen.queryByRole('button', { name: /see all results/i })
    ).not.toBeInTheDocument();

    // Refocusing reopens the submit-wired popup: the results route accepts
    // single characters, so touch users can recover the action without
    // editing the query.
    fireEvent.focus(screen.getByRole('searchbox'));
    expect(
      screen.getByRole('button', { name: /see all results for “x”/i })
    ).toBeInTheDocument();
    // The action-only popup is not a listbox, so the combobox reports
    // collapsed even though the popup is visible.
    expect(screen.getByRole('combobox')).toHaveAttribute(
      'aria-expanded',
      'false'
    );
    // Queries that never fetch stay silent for screen readers too: no
    // settled response, no "No results found" announcement.
    expect(
      container.querySelector('.sr-only')?.textContent ?? ''
    ).not.toContain('No results found');
  });

  it('keeps the popup open while a one-character submit query is typed', () => {
    vi.useRealTimers();
    const onChange = vi.fn();
    const onSubmitSearch = vi.fn();

    const { rerender } = render(
      <SearchAutocomplete
        merchantId="merchant-1"
        value=""
        onChange={onChange}
        onSubmitSearch={onSubmitSearch}
      />
    );

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'x' } });
    rerender(
      <SearchAutocomplete
        merchantId="merchant-1"
        value="x"
        onChange={onChange}
        onSubmitSearch={onSubmitSearch}
      />
    );

    expect(
      screen.getByRole('button', { name: /see all results for “x”/i })
    ).toBeInTheDocument();
  });

  it('resets the highlight when the query is edited while the popup is open', async () => {
    vi.useRealTimers();
    const onChange = vi.fn();
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
        onChange={onChange}
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

    // Editing to another fetchable query keeps the old options visible
    // until the new fetch resolves, but the highlight belongs to the
    // previous text: Enter must submit the new query, not follow the
    // stale option.
    fireEvent.change(input, { target: { value: 'iphonex' } });
    rerender(
      <SearchAutocomplete
        merchantId="merchant-1"
        value="iphonex"
        onChange={onChange}
        onSelectProduct={onSelectProduct}
        onSubmitSearch={onSubmitSearch}
      />
    );

    expect(screen.getByRole('option', { name: /iphone 16/i })).toHaveAttribute(
      'aria-selected',
      'false'
    );

    fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Enter' });
    expect(onSubmitSearch).toHaveBeenCalledWith('iphonex');
    expect(onSelectProduct).not.toHaveBeenCalled();
  });

  it('withholds the empty message while typing a new query after an empty settle', async () => {
    vi.useRealTimers();
    const onChange = vi.fn();
    const onSubmitSearch = vi.fn();

    const { container, rerender } = render(
      <SearchAutocomplete
        merchantId="merchant-1"
        value="aa"
        onChange={onChange}
        onSubmitSearch={onSubmitSearch}
      />
    );

    // The default mock resolves empty: the genuine message appears.
    await waitFor(() => {
      expect(screen.getByText(/no suggestions for/i)).toBeInTheDocument();
    });

    // Typing a new query leaves the debounced value on A for 200ms. The
    // popup must not report "No suggestions" for B before B is requested,
    // visually or via the live region — but the action stays available.
    fireEvent.change(screen.getByRole('searchbox'), {
      target: { value: 'bb' },
    });
    rerender(
      <SearchAutocomplete
        merchantId="merchant-1"
        value="bb"
        onChange={onChange}
        onSubmitSearch={onSubmitSearch}
      />
    );

    expect(screen.queryByText(/no suggestions for/i)).not.toBeInTheDocument();
    expect(
      container.querySelector('.sr-only')?.textContent ?? ''
    ).not.toContain('No results found');
    expect(
      screen.getByRole('button', { name: /see all results for “bb”/i })
    ).toBeInTheDocument();
  });
});
