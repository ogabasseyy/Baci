import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { LIGHT_COLORS } from '@/constants/theme';
import { TransactionListState } from './TransactionListState';

vi.mock('@react-native-vector-icons/ionicons', () => ({
  Ionicons: ({ name }: { name: string }) => <span>{name}</span>,

  default: ({ name }: { name: string }) => <span>{name}</span>,
  __esModule: true,
}));

vi.mock('react-native', async () => {
  const React = await import('react');

  return {
    StatusBar: () => null,
    ActivityIndicator: () =>
      React.createElement('div', { role: 'progressbar' }),
    Pressable: ({
      accessibilityLabel,
      accessibilityRole,
      children,
      disabled,
      onPress,
    }: {
      accessibilityLabel?: string;
      accessibilityRole?: string;
      children?: React.ReactNode;
      disabled?: boolean;
      onPress?: () => void;
    }) =>
      React.createElement(
        'button',
        {
          'aria-label': accessibilityLabel,
          disabled,
          onClick: () => onPress?.(),
          role: accessibilityRole,
        },
        children
      ),
    Text: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('span', null, children),
    View: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('div', null, children),
  };
});

vi.mock('@/components/transactions/transactions.styles', () => ({
  styles: new Proxy(
    {},
    {
      get: (_target, property) => property,
    }
  ),
}));

vi.mock('@/lib/search-transaction-review-orders', () => ({
  TRANSACTION_REVIEW_SEARCH_LIMIT: 100,
}));

describe('TransactionListState', () => {
  it('renders a retryable error state', () => {
    const onRetry = vi.fn();

    render(
      <TransactionListState
        colors={LIGHT_COLORS}
        error={new Error('network')}
        hasOrders={false}
        isLoading={false}
        isRetrying={false}
        onRetry={onRetry}
        visibleOrderCount={0}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /retry loading/i }));

    expect(
      screen.getByText('Unable to load transactions.')
    ).toBeInTheDocument();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('distinguishes empty and filtered-empty states', () => {
    const props = {
      colors: LIGHT_COLORS,
      error: null,
      isLoading: false,
      isRetrying: false,
      onRetry: vi.fn(),
    };

    const { rerender } = render(
      <TransactionListState
        {...props}
        hasOrders={false}
        visibleOrderCount={0}
      />
    );

    expect(screen.getByText('No transactions yet.')).toBeInTheDocument();

    rerender(
      <TransactionListState {...props} hasOrders={true} visibleOrderCount={0} />
    );

    expect(screen.getByText('No matching transactions.')).toBeInTheDocument();
  });

  it('shows no-matching instead of no-transactions for empty searches', () => {
    render(
      <TransactionListState
        colors={LIGHT_COLORS}
        error={null}
        hasOrders={false}
        isLoading={false}
        isRetrying={false}
        onRetry={vi.fn()}
        searching={true}
        visibleOrderCount={0}
      />
    );

    expect(screen.getByText('No matching transactions.')).toBeInTheDocument();
    expect(screen.queryByText('No transactions yet.')).not.toBeInTheDocument();
  });

  it('discloses truncated search results', () => {
    render(
      <TransactionListState
        colors={LIGHT_COLORS}
        error={null}
        hasOrders={true}
        isLoading={false}
        isRetrying={false}
        onRetry={vi.fn()}
        searchTruncated={true}
        visibleOrderCount={100}
      />
    );

    expect(
      screen.getByText(
        'Showing 100 matches (partial results). Refine your search to narrow results.'
      )
    ).toBeInTheDocument();
  });

  it('names the displayed count when refinement shrinks truncated results', () => {
    render(
      <TransactionListState
        colors={LIGHT_COLORS}
        error={null}
        hasOrders={true}
        isLoading={false}
        isRetrying={false}
        onRetry={vi.fn()}
        searchTruncated={true}
        visibleOrderCount={60}
      />
    );

    expect(
      screen.getByText(
        'Showing 60 matches (partial results). Refine your search to narrow results.'
      )
    ).toBeInTheDocument();
  });

  it('uses the singular when one truncated match is displayed', () => {
    render(
      <TransactionListState
        colors={LIGHT_COLORS}
        error={null}
        hasOrders={true}
        isLoading={false}
        isRetrying={false}
        onRetry={vi.fn()}
        searchTruncated={true}
        visibleOrderCount={1}
      />
    );

    expect(
      screen.getByText(
        'Showing 1 match (partial results). Refine your search to narrow results.'
      )
    ).toBeInTheDocument();
  });

  it('reports partial results instead of no matches when truncation empties the list', () => {
    render(
      <TransactionListState
        colors={LIGHT_COLORS}
        error={null}
        hasOrders={false}
        isLoading={false}
        isRetrying={false}
        onRetry={vi.fn()}
        searching={true}
        searchTruncated={true}
        visibleOrderCount={0}
      />
    );

    expect(
      screen.getByText(
        'Showing 0 matches (partial results). Refine your search to narrow results.'
      )
    ).toBeInTheDocument();
  });
});
