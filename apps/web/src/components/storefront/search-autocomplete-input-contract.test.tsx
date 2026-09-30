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
});
