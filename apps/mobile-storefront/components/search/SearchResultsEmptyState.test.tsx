import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ComponentProps } from 'react';
import Colors from '@/constants/Colors';
import type { Category } from '@/types/product';
import SearchResultsEmptyState from './SearchResultsEmptyState';

const categories: Category[] = [
  { id: 'cat-1', name: 'Phones', slug: 'phones' },
];

function renderEmptyState(
  overrides: Partial<ComponentProps<typeof SearchResultsEmptyState>> = {}
) {
  const props: ComponentProps<typeof SearchResultsEmptyState> = {
    categories,
    colors: Colors.light,
    committedQuery: '',
    onCategoryPress: jest.fn(),
    ...overrides,
  };

  return render(<SearchResultsEmptyState {...props} />);
}

describe('SearchResultsEmptyState', () => {
  it('names the submitted query and category paths on zero matches', () => {
    const onCategoryPress = jest.fn();

    renderEmptyState({ committedQuery: 'zzzz', onCategoryPress });

    expect(screen.getByText('No results found')).toBeTruthy();
    expect(
      screen.getByText(
        'No products match “zzzz”. Try a different spelling or browse a category.'
      )
    ).toBeTruthy();

    fireEvent.press(screen.getByRole('button', { name: 'Browse Phones' }));
    expect(onCategoryPress).toHaveBeenCalledWith('phones');
  });

  it('offers the all-products catalog from zero matches', () => {
    const onCategoryPress = jest.fn();

    renderEmptyState({ committedQuery: 'zzzz', onCategoryPress });

    fireEvent.press(
      screen.getByRole('button', { name: 'Browse all products' })
    );
    expect(onCategoryPress).toHaveBeenCalledWith('all');
  });

  it('hides the request action for queries the intake schema rejects', () => {
    const { unmount } = renderEmptyState({ committedQuery: 'a'.repeat(150) });

    expect(
      screen.queryByRole('button', { name: 'Request this product' })
    ).toBeNull();
    unmount();

    renderEmptyState({ committedQuery: '!!' });
    expect(
      screen.queryByRole('button', { name: 'Request this product' })
    ).toBeNull();
  });

  it('shows the request action for schema-valid queries', () => {
    renderEmptyState({ committedQuery: 'iphone 99' });

    expect(
      screen.getByRole('button', { name: 'Request this product' })
    ).toBeTruthy();
  });
});
