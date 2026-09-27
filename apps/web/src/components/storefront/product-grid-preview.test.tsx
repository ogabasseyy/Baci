// biome-ignore-all assist/source/organizeImports: the fixtures import must
// stay first — its vi.mock registrations only apply to modules imported
// after it is evaluated.
import {
  mockMerchantState,
  mockStorefrontUiState,
  previewMerchantState,
  resetProductGridTestState,
} from './product-grid-test-fixtures';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiGet } from '@/lib/api-client';
import { StorefrontProductGrid } from './product-grid';

const fuseImportState = vi.hoisted(() => ({ shouldFail: false }));

// The mocked chunk resolves once per test file and is then cached, so a
// failure flag cannot reject the import itself afterwards. Instead the
// wrapper throws during the index build, which travels the exact same
// rejection path as a rejected chunk (offline or stale deployment).
vi.mock('fuse.js', async () => {
  const actual = (await vi.importActual('fuse.js')) as {
    default: new (...args: never[]) => object;
  };
  return {
    default: class extends actual.default {
      constructor(...args: never[]) {
        if (fuseImportState.shouldFail) {
          throw new Error('ChunkLoadError');
        }
        super(...args);
      }
    },
  };
});

describe('StorefrontProductGrid preview search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fuseImportState.shouldFail = false;
    resetProductGridTestState();
    mockMerchantState.merchant = previewMerchantState();
  });

  it('uses industry-specific sample products in preview mode', async () => {
    render(<StorefrontProductGrid />);

    expect(
      await screen.findByText('Artisanal Sourdough Loaf')
    ).toBeInTheDocument();
    expect(screen.queryByText('Linen Summer Dress')).not.toBeInTheDocument();
    expect(
      vi
        .mocked(apiGet)
        .mock.calls.some(([url]) =>
          String(url).includes('/api/storefront/products')
        )
    ).toBe(false);
  });

  it('filters preview products once the lazily loaded search index resolves', async () => {
    mockStorefrontUiState.searchQuery = 'Sourdough';

    render(<StorefrontProductGrid />);

    // The match survives; non-matches disappear only after the lazy index
    // arrives (before that the list falls back to unfiltered, as before).
    expect(
      await screen.findByText('Artisanal Sourdough Loaf')
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(
        screen.queryByText('Cold-Pressed Olive Oil')
      ).not.toBeInTheDocument();
    });
  });

  it('shows a retry path instead of a silent full catalog when the search chunk fails', async () => {
    fuseImportState.shouldFail = true;
    mockStorefrontUiState.searchQuery = 'Sourdough';

    render(<StorefrontProductGrid />);

    expect(
      await screen.findByRole('button', { name: 'Retry search' })
    ).toBeInTheDocument();
    // Recoverable: the unfiltered catalog stays visible, never a dead grid.
    expect(screen.getByText('Artisanal Sourdough Loaf')).toBeInTheDocument();

    fuseImportState.shouldFail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry search' }));
    await waitFor(() => {
      expect(
        screen.queryByText('Cold-Pressed Olive Oil')
      ).not.toBeInTheDocument();
    });
  });
});
