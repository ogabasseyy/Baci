import { render } from '@testing-library/react-native';
import { CheckoutDiscount } from './CheckoutDiscount';

const mockInput = jest.fn((_props: unknown) => null);
jest.mock('../DiscountCodeInput', () => ({
  DiscountCodeInput: (props: unknown) => {
    mockInput(props);
    return null;
  },
}));

beforeEach(() => jest.clearAllMocks());

it('does not render discounts during the REDVAULT review', () => {
  render(
    <CheckoutDiscount
      visible={false}
      subtotal={100}
      productIds={[]}
      appliedDiscount={null}
      onChange={jest.fn()}
    />
  );
  expect(mockInput).not.toHaveBeenCalled();
});

it('preserves ordinary discount inputs', () => {
  render(
    <CheckoutDiscount
      visible
      subtotal={100}
      productIds={['phone']}
      appliedDiscount={null}
      onChange={jest.fn()}
    />
  );
  expect(mockInput).toHaveBeenCalledWith(
    expect.objectContaining({ cartTotal: 100, productIds: ['phone'] })
  );
});
