import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

  it('exports a valid component', () => {
    expect(SearchAutocomplete).toBeDefined();
    expect(typeof SearchAutocomplete).toBe('function');
  });

  it('styles the search icon via the shared core CSS class (route-independent)', () => {
    const { container } = render(
      <SearchAutocomplete
        merchantId="test-merchant"
        value=""
        onChange={vi.fn()}
      />
    );
    // Query by aria-hidden (the icon's intentional API) rather than Lucide's
    // internal class name. In the empty-value render the search glass is the
    // only decorative svg, so this uniquely targets it.
    const icon = container.querySelector('svg[aria-hidden="true"]');
    // Guard: a missing icon would make the assertions below vacuous.
    expect(icon).not.toBeNull();

    // The component root carries __field so the core-CSS :focus-within tint
    // applies on every surface (navbar and generic header alike), not only
    // where the .ogabassey-navbar-search wrapper is present.
    expect(screen.getByRole('combobox')).toHaveClass(
      'ogabassey-navbar-search__field'
    );

    // Geometry is dual-sourced. (1) The bespoke core-CSS class is the
    // route-independent source for storefront `source(none)` routes (e.g. PDP)
    // that do not @source this lazy-loaded component.
    const iconClass = icon?.getAttribute('class') ?? '';
    expect(iconClass).toContain('ogabassey-navbar-search__icon');
    // (2) Matching Tailwind utilities cover contexts that DO source the
    // component but never load core CSS (the platform template-preview, whose
    // globals.css full-scans). Centering uses the `translate`-property utility
    // (-translate-y-1/2) — the same property core CSS uses — so the two collapse
    // to one declaration where both apply instead of stacking (the original
    // double-offset bug).
    expect(iconClass).toContain('absolute');
    expect(iconClass).toContain('-translate-y-1/2');
    // text-muted-foreground is the no-core idle colour fallback (the core-CSS
    // colour/tint are unlayered so they still win on storefront routes).
    expect(iconClass).toContain('text-muted-foreground');

    // Left padding is likewise dual-sourced: the core-CSS `__field input` rule
    // and the `pl-11` fallback utility.
    const input = screen.getByRole('searchbox', { name: /search products/i });
    expect(input).toHaveClass('pl-11');
  });

  it('forwards an optional maximum input length', () => {
    render(
      <SearchAutocomplete
        merchantId="test-merchant"
        value=""
        onChange={vi.fn()}
        maxLength={100}
      />
    );

    expect(
      screen.getByRole('searchbox', { name: /search products/i })
    ).toHaveAttribute('maxlength', '100');
  });

  it('shows clear button when value is present', () => {
    const handleChange = vi.fn();
    render(
      <SearchAutocomplete
        merchantId="test-merchant"
        value="iphone"
        onChange={handleChange}
      />
    );

    const clearButton = screen.getByRole('button', { name: /clear search/i });
    expect(clearButton).toBeInTheDocument();

    // Right clearance is dual-sourced: the bespoke __input--has-value class
    // (core CSS for source(none) routes) AND the pr-10 fallback utility for
    // contexts that source the component without loading core CSS.
    const input = screen.getByRole('searchbox', { name: /search products/i });
    expect(input).toHaveClass('ogabassey-navbar-search__input--has-value');
    expect(input).toHaveClass('pr-10');

    // The clear button likewise carries both its bespoke class and matching
    // fallback positioning utilities, with translate-based centering that
    // shares the `translate` property with core CSS (so it never double-offsets).
    expect(clearButton).toHaveClass('ogabassey-navbar-search__clear');
    expect(clearButton).toHaveClass('absolute', 'size-8', '-translate-y-1/2');
  });

  it('does not show clear button when value is empty', () => {
    const handleChange = vi.fn();
    render(
      <SearchAutocomplete
        merchantId="test-merchant"
        value=""
        onChange={handleChange}
      />
    );

    const clearButton = screen.queryByRole('button', { name: /clear search/i });
    expect(clearButton).not.toBeInTheDocument();
  });

  it('focuses the input on initial mount when autoFocus is true', () => {
    render(
      <SearchAutocomplete
        merchantId="test-merchant"
        value=""
        onChange={vi.fn()}
        autoFocus={true}
      />
    );

    const input = screen.getByRole('searchbox', { name: /search products/i });
    expect(input).toHaveFocus();
  });

  it('focuses the input when lazy navbar activation requests autofocus after mount', () => {
    // Arrange
    const handleChange = vi.fn();
    const { rerender } = render(
      <SearchAutocomplete
        merchantId="test-merchant"
        value=""
        onChange={handleChange}
        autoFocus={false}
      />
    );

    const input = screen.getByRole('searchbox', { name: /search products/i });
    expect(input).not.toHaveFocus();

    // Act
    rerender(
      <SearchAutocomplete
        merchantId="test-merchant"
        value=""
        onChange={handleChange}
        autoFocus={true}
      />
    );

    // Assert
    expect(input).toHaveFocus();
  });

  it('calls onChange with empty string when clear button is clicked', async () => {
    const user = userEvent.setup();
    const handleChange = vi.fn();
    render(
      <SearchAutocomplete
        merchantId="test-merchant"
        value="samsung"
        onChange={handleChange}
      />
    );

    const clearButton = screen.getByRole('button', { name: /clear search/i });
    await user.click(clearButton);

    expect(handleChange).toHaveBeenCalledWith('');
  });

  it('focuses input after clearing', async () => {
    const user = userEvent.setup();
    const handleChange = vi.fn();
    render(
      <SearchAutocomplete
        merchantId="test-merchant"
        value="laptop"
        onChange={handleChange}
      />
    );

    const input = screen.getByRole('searchbox', { name: /search products/i });
    const clearButton = screen.getByRole('button', { name: /clear search/i });

    // Click clear button
    await user.click(clearButton);

    // Verify input has focus
    expect(input).toHaveFocus();
  });

  it('clears search via keyboard interaction (Tab + Enter)', async () => {
    const user = userEvent.setup();
    const handleChange = vi.fn();
    render(
      <SearchAutocomplete
        merchantId="test-merchant"
        value="keyboard"
        onChange={handleChange}
      />
    );

    const input = screen.getByRole('searchbox', { name: /search products/i });
    const clearButton = screen.getByRole('button', { name: /clear search/i });

    // Focus input first
    await user.click(input);
    expect(input).toHaveFocus();

    // Tab to clear button
    await user.tab();
    expect(clearButton).toHaveFocus();

    // Press Enter to clear
    await user.keyboard('{Enter}');
    expect(handleChange).toHaveBeenCalledWith('');
    expect(input).toHaveFocus();
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
    expect(onSubmitSearch).toHaveBeenCalledWith('ip');
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
});
