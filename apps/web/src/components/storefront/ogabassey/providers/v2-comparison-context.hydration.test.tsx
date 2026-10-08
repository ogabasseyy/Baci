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

  it('keeps initial membership empty until hydration and ignores corrupt entries', () => {
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

    expect(screen.getByTestId('member')).toHaveTextContent('false');
    act(() => vi.advanceTimersByTime(1200));
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
});
