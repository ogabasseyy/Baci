import { act, fireEvent, render, screen } from '@testing-library/react';
import type React from 'react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Product } from '../types';
import {
  V2ComparisonProvider,
  useV2Comparison,
} from './v2-comparison-context';

const baseProduct: Product = {
  id: 'product-1',
  name: 'PlayStation 5',
  price: '₦1,350,000',
  image: '/ps5.jpg',
  category: 'Gaming',
  slug: 'playstation-5',
  categories: {
    id: 'cat-gaming',
    name: 'Gaming',
    slug: 'gaming',
  },
  rating: 4.8,
  description: 'Gaming console bundle.',
  condition: 'New',
};

function ComparisonConsumer() {
  const { addToCompare, compareItems } = useV2Comparison();

  return (
    <div>
      <span data-testid="compare-count">{compareItems.length}</span>
      <button onClick={() => addToCompare(baseProduct)} type="button">
        Add to compare
      </button>
    </div>
  );
}

describe('V2ComparisonProvider', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    sessionStorage.clear();
    localStorage.clear();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('ignores legacy selections from a previous browser session', () => {
    localStorage.setItem('ogabassey_v2_compare', JSON.stringify([baseProduct]));
    localStorage.setItem('ogabassey_v2_compare:merchant-a', JSON.stringify([baseProduct]));
    render(<V2ComparisonProvider storageNamespace="merchant-a"><ComparisonConsumer /></V2ComparisonProvider>);
    act(() => vi.advanceTimersByTime(1200));
    expect(screen.getByTestId('compare-count')).toHaveTextContent('0');
    fireEvent.click(screen.getByRole('button', {name: 'Add to compare'}));
    expect(screen.getByTestId('compare-count')).toHaveTextContent('1');
    expect(JSON.parse(sessionStorage.getItem('ogabassey_v2_compare:merchant-a') ?? '[]')).toHaveLength(1);
  });

  it('starts empty in a new browser session while retaining same-session selections', () => {
    const first = render(<V2ComparisonProvider><ComparisonConsumer /></V2ComparisonProvider>);
    fireEvent.click(screen.getByRole('button', {name: 'Add to compare'}));
    first.unmount();
    const same = render(<V2ComparisonProvider><ComparisonConsumer /></V2ComparisonProvider>);
    act(() => vi.advanceTimersByTime(1200));
    expect(screen.getByTestId('compare-count')).toHaveTextContent('1');
    same.unmount();
    sessionStorage.clear();
    render(<V2ComparisonProvider><ComparisonConsumer /></V2ComparisonProvider>);
    act(() => vi.advanceTimersByTime(1200));
    expect(screen.getByTestId('compare-count')).toHaveTextContent('0');
  });

  it('defers tab-session comparison hydration until idle timeout', () => {
    const getItemSpy = vi
      .spyOn(Storage.prototype, 'getItem')
      .mockReturnValue(JSON.stringify([baseProduct]));
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');

    render(
      <V2ComparisonProvider>
        <ComparisonConsumer />
      </V2ComparisonProvider>
    );

    expect(getItemSpy).not.toHaveBeenCalled();
    expect(setItemSpy).not.toHaveBeenCalled();
    expect(screen.getByTestId('compare-count')).toHaveTextContent('0');

    act(() => {
      vi.advanceTimersByTime(1200);
    });

    expect(getItemSpy).toHaveBeenCalledOnce();
    expect(screen.getByTestId('compare-count')).toHaveTextContent('1');
  });

  it('hydrates synchronously before the first comparison mutation', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockReturnValue(
      JSON.stringify([baseProduct])
    );

    const nextProduct: Product = {
      ...baseProduct,
      id: 'product-2',
      name: 'Xbox Series X',
    };

    function MutatingConsumer() {
      const { addToCompare, compareItems } = useV2Comparison();

      return (
        <div>
          <span data-testid="compare-count">{compareItems.length}</span>
          <button onClick={() => addToCompare(nextProduct)} type="button">
            Add to compare
          </button>
        </div>
      );
    }

    render(
      <V2ComparisonProvider>
        <MutatingConsumer />
      </V2ComparisonProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Add to compare' }));

    expect(screen.getByTestId('compare-count')).toHaveTextContent('2');
  });

  it('ignores corrupt entries in the pre-hydration membership read', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockReturnValue(
      JSON.stringify([baseProduct, null, 'not-an-object', { name: 'No id' }, { id: 'missing' }])
    );

    function MembershipConsumer() {
      const { isInCompare } = useV2Comparison();
      return (
        <div>
          <span data-testid="member">{String(isInCompare('product-1'))}</span>
          <span data-testid="nonmember">{String(isInCompare('missing'))}</span>
        </div>
      );
    }

    render(
      <V2ComparisonProvider>
        <MembershipConsumer />
      </V2ComparisonProvider>
    );

    expect(screen.getByTestId('member')).toHaveTextContent('true');
    expect(screen.getByTestId('nonmember')).toHaveTextContent('false');
  });

  it('drops corrupt or foreign entries when hydrating stored items', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockReturnValue(
      JSON.stringify([
        baseProduct,
        null,
        'not-an-object',
        { name: 'No id here' },
        { ...baseProduct, id: 42, name: 'Numeric id is usable' },
        { id: 'incomplete' },
      ])
    );

    render(
      <V2ComparisonProvider>
        <ComparisonConsumer />
      </V2ComparisonProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Add to compare' }));

    // baseProduct hydrates (deduped against the added copy) plus the
    // numeric-id entry; the three corrupt rows never enter the tray.
    expect(screen.getByTestId('compare-count')).toHaveTextContent('2');
  });

  it('keeps persisted comparison items isolated by merchant namespace', () => {
    sessionStorage.setItem(
      'ogabassey_v2_compare',
      JSON.stringify([baseProduct])
    );

    render(
      <V2ComparisonProvider storageNamespace="merchant-a">
        <ComparisonConsumer />
      </V2ComparisonProvider>
    );

    act(() => {
      vi.advanceTimersByTime(1200);
    });

    expect(screen.getByTestId('compare-count')).toHaveTextContent('0');

    fireEvent.click(screen.getByRole('button', { name: 'Add to compare' }));

    expect(
      JSON.parse(sessionStorage.getItem('ogabassey_v2_compare') ?? '[]')
    ).toHaveLength(1);
    expect(
      JSON.parse(
        sessionStorage.getItem('ogabassey_v2_compare:merchant-a') ?? '[]'
      )
    ).toEqual([expect.objectContaining({ id: baseProduct.id })]);
  });

  it('keeps namespace-switch writes isolated on rerender', () => {
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');

    const { rerender } = render(
      <V2ComparisonProvider storageNamespace="merchant-a">
        <ComparisonConsumer />
      </V2ComparisonProvider>
    );

    act(() => {
      vi.advanceTimersByTime(1200);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Add to compare' }));

    expect(
      JSON.parse(
        sessionStorage.getItem('ogabassey_v2_compare:merchant-a') ?? '[]'
      )
    ).toEqual([expect.objectContaining({ id: baseProduct.id })]);

    setItemSpy.mockClear();

    rerender(
      <V2ComparisonProvider storageNamespace="merchant-b">
        <ComparisonConsumer />
      </V2ComparisonProvider>
    );

    expect(sessionStorage.getItem('ogabassey_v2_compare:merchant-b')).toBeNull();
    expect(setItemSpy).not.toHaveBeenCalledWith(
      'ogabassey_v2_compare:merchant-b',
      expect.any(String)
    );

    setItemSpy.mockClear();

    fireEvent.click(screen.getByRole('button', { name: 'Add to compare' }));

    expect(screen.getByTestId('compare-count')).toHaveTextContent('1');
    expect(
      JSON.parse(
        sessionStorage.getItem('ogabassey_v2_compare:merchant-b') ?? '[]'
      )
    ).toEqual([expect.objectContaining({ id: baseProduct.id })]);
    expect(setItemSpy).toHaveBeenCalledWith(
      'ogabassey_v2_compare:merchant-b',
      expect.any(String)
    );
  });

  it('reports the evicted stored item when adding to a full tray before hydration', () => {
    const stored = [baseProduct, 2, 3, 4].map((entry, index) =>
      typeof entry === 'number'
        ? { ...baseProduct, id: `product-${entry}`, name: `Product ${entry}` }
        : { ...entry, name: `Product ${index + 1}` }
    );
    sessionStorage.setItem('ogabassey_v2_compare', JSON.stringify(stored));
    const nextProduct: Product = {
      ...baseProduct,
      id: 'product-5',
      name: 'Product 5',
    };
    function ReportingConsumer() {
      const { addToCompare, compareItems } = useV2Comparison();
      const [replacedName, setReplacedName] = useState<string | null>(null);
      return (
        <div>
          <span data-testid="compare-count">{compareItems.length}</span>
          <span data-testid="replaced-name">{replacedName ?? 'none'}</span>
          <button
            onClick={() =>
              setReplacedName(addToCompare(nextProduct)?.name ?? null)
            }
            type="button"
          >
            Add to compare
          </button>
        </div>
      );
    }
    render(
      <V2ComparisonProvider>
        <ReportingConsumer />
      </V2ComparisonProvider>
    );

    // No timer advance and no activation event: state is still empty while
    // storage already holds four selections.
    expect(screen.getByTestId('compare-count')).toHaveTextContent('0');
    fireEvent.click(screen.getByRole('button', { name: 'Add to compare' }));

    expect(screen.getByTestId('compare-count')).toHaveTextContent('4');
    expect(screen.getByTestId('replaced-name')).toHaveTextContent('Product 1');
  });

  it('reports stored selections from isInCompare before hydration fires', () => {
    sessionStorage.setItem(
      'ogabassey_v2_compare',
      JSON.stringify([baseProduct])
    );
    function SelectedProbe() {
      const { isInCompare } = useV2Comparison();
      return (
        <span data-testid="selected-state">
          {isInCompare(baseProduct.id) ? 'selected' : 'unselected'}
        </span>
      );
    }
    render(
      <V2ComparisonProvider>
        <SelectedProbe />
      </V2ComparisonProvider>
    );
    // No timer advance and no interaction: the scheduled hydration has not
    // fired, yet the stored selection must already read as selected.
    expect(screen.getByTestId('selected-state')).toHaveTextContent('selected');
  });
});
