import { jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import { Alert } from 'react-native';
import type { CartItem } from '@/stores/cart-store';
import { useCartScreenItemHandlers } from './use-cart-screen-item-handlers';

const mockAlert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

function item(overrides: Partial<CartItem> = {}): CartItem {
  return {
    id: 'line-1',
    product_id: 'product-1',
    slug: 'phone',
    name: 'Phone',
    price: 100,
    quantity: 2,
    ...overrides,
  } as CartItem;
}

function setup() {
  const updateQuantity = jest.fn();
  const removeItem = jest.fn();
  const triggerHaptic = jest.fn();
  const { result } = renderHook(() =>
    useCartScreenItemHandlers({ updateQuantity, removeItem, triggerHaptic })
  );
  return { result, updateQuantity, removeItem, triggerHaptic };
}

beforeEach(() => {
  mockAlert.mockClear();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('useCartScreenItemHandlers', () => {
  it('bumps the quantity for a positive delta', () => {
    const { result, updateQuantity, triggerHaptic } = setup();
    act(() => {
      result.current.handleQuantityChange(item(), 1);
    });
    expect(updateQuantity).toHaveBeenCalledWith('line-1', 3);
    expect(triggerHaptic).toHaveBeenCalled();
  });

  it('confirms removal when the delta empties the line', () => {
    const { result, removeItem } = setup();
    act(() => {
      result.current.handleQuantityChange(item({ quantity: 1 }), -1);
    });
    expect(mockAlert).toHaveBeenCalledWith(
      'Remove Item',
      expect.stringContaining('Phone'),
      expect.anything()
    );
    const buttons = mockAlert.mock.calls[0][2] as Array<{
      text: string;
      onPress?: () => void;
    }>;
    act(() => {
      buttons.find((button) => button.text === 'Remove')?.onPress?.();
    });
    expect(removeItem).toHaveBeenCalledWith('line-1');
  });

  it('ignores a second tap while the first is in flight', () => {
    const { result, updateQuantity } = setup();
    act(() => {
      result.current.handleQuantityChange(item(), 1);
      result.current.handleQuantityChange(item(), 1);
    });
    expect(updateQuantity).toHaveBeenCalledTimes(1);
    act(() => {
      jest.advanceTimersByTime(200);
    });
    act(() => {
      result.current.handleQuantityChange(item(), 1);
    });
    expect(updateQuantity).toHaveBeenCalledTimes(2);
  });
});
