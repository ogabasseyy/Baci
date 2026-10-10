import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import SearchAssistance from './SearchAssistance';

const colors = Colors.light;
const products = [
  { price: 250000, condition: 'used' },
  { price: 900000, condition: 'new' },
];

describe('SearchAssistance', () => {
  it('renders observed-condition suggestions and applies the proposal', () => {
    const onApply = jest.fn();
    render(
      <SearchAssistance
        query="iphone"
        resultQuery="iphone"
        products={products}
        onApply={onApply}
        colors={colors}
      />
    );
    expect(screen.getByTestId('search-suggestion-row')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Search suggestion: Used iphone'));
    expect(onApply).toHaveBeenCalledWith(
      expect.objectContaining({
        query: 'iphone',
        filters: { condition: 'used' },
      })
    );
  });
  it('renders nothing while a different query is loading', () => {
    const view = render(
      <SearchAssistance
        query="samsung"
        resultQuery="iphone"
        products={products}
        onApply={() => {}}
        colors={colors}
      />
    );
    expect(view.queryByTestId('search-suggestion-row')).toBeNull();
  });
  it('scales the budget suggestion to the passed storefront currency', () => {
    const onApply = jest.fn();
    render(
      <SearchAssistance
        query="iphone"
        resultQuery="iphone"
        products={[
          { price: 380, condition: 'used' },
          { price: 1200, condition: 'new' },
        ]}
        onApply={onApply}
        colors={colors}
        currency="USD"
      />
    );
    fireEvent.press(
      screen.getByLabelText('Search suggestion: iphone up to US$400')
    );
    expect(onApply).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: { maxPrice: 400 },
      })
    );
  });
});
