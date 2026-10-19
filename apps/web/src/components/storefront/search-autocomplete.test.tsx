import { render, screen } from '@testing-library/react';
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
});
