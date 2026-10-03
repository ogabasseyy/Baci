import { formatSearchCardPrice } from './search-price';

describe('search card prices', () => {
  it('does not advertise a fallback price for an unavailable search match', () => {
    expect(
      formatSearchCardPrice({
        price: 200000,
        searchMatch: { productId: 'p', total: 1 },
      })
    ).toBe('Price unavailable');
  });
  it('shows the matched option price including zero', () => {
    expect(
      formatSearchCardPrice({
        price: 200000,
        searchMatch: { productId: 'p', total: 1, price: 0 },
      })
    ).toBe('₦0');
  });
});
