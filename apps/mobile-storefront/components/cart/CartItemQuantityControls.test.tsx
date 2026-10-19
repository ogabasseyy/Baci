import { act, fireEvent, render } from '@testing-library/react-native';
import { useNativeSharedCartStore } from '@/stores/native-shared-cart-store';
import { installSharedCartWriter } from '@/stores/shared-cart-writer';
import CartItemQuantityControls from './CartItemQuantityControls';

jest.mock('@react-native-vector-icons/ionicons', () => 'Icon');
jest.mock('./CartQuantityInput', () => {
  const { TextInput } =
    jest.requireActual<typeof import('react-native')>('react-native');
  return {
    __esModule: true,
    default: ({
      value,
      onChange,
    }: {
      value: number;
      onChange: (value: number) => void;
    }) => (
      <TextInput
        accessibilityLabel="Quantity"
        value={String(value)}
        onChangeText={(text: string) => onChange(Number(text))}
      />
    ),
  };
});
const item = {
  id: 'line-1',
  product_id: 'product-1',
  name: 'Phone',
  price: 100,
  quantity: 2,
  slug: 'phone',
};
const props = {
  item,
  isVoucherLine: false,
  handleQuantityChange: jest.fn(),
  updateQuantity: jest.fn(),
  textColor: '#000',
  textSecondaryColor: '#111',
  borderColor: '#222',
  surfaceInset: '#333',
  disabledIconColor: '#444',
};
beforeEach(() => {
  jest.clearAllMocks();
  useNativeSharedCartStore.setState({ enabled: true });
});
it('keeps voucher quantity fixed and disables both quantity actions', () => {
  const view = render(<CartItemQuantityControls {...props} isVoucherLine />);
  fireEvent.press(view.getByLabelText('Decrease quantity for Phone'));
  fireEvent.press(view.getByLabelText('Increase quantity for Phone'));
  expect(props.handleQuantityChange).not.toHaveBeenCalled();
  expect(view.queryByLabelText('Quantity')).toBeNull();
});
it('routes ordinary quantity controls to the exact line without editing sibling identities', () => {
  const view = render(<CartItemQuantityControls {...props} />);
  fireEvent.press(view.getByLabelText('Decrease quantity for Phone'));
  fireEvent.press(view.getByLabelText('Increase quantity for Phone'));
  fireEvent.changeText(view.getByLabelText('Quantity'), '4');
  expect(props.handleQuantityChange.mock.calls).toEqual([
    [item, -1],
    [item, 1],
  ]);
  expect(props.updateQuantity).toHaveBeenCalledWith('line-1', 4);
});
it('does not increment an ordinary line past the shared-cart maximum when shared cart is enabled', () => {
  const view = render(
    <CartItemQuantityControls {...props} item={{ ...item, quantity: 10 }} />
  );
  fireEvent.press(view.getByLabelText('Increase quantity for Phone'));
  expect(props.handleQuantityChange).not.toHaveBeenCalled();
});
it('allows incrementing past 10 when shared cart is disabled and no product max_quantity applies', () => {
  useNativeSharedCartStore.setState({ enabled: false });
  const legacyItem = { ...item, quantity: 10 };
  const view = render(
    <CartItemQuantityControls {...props} item={legacyItem} />
  );
  fireEvent.press(view.getByLabelText('Increase quantity for Phone'));
  expect(props.handleQuantityChange).toHaveBeenCalledWith(legacyItem, 1);
});
it('reacts to writer install and retire while mounted without the enabled flag changing', () => {
  useNativeSharedCartStore.setState({ enabled: false });
  const cappedItem = { ...item, quantity: 10 };
  const view = render(
    <CartItemQuantityControls {...props} item={cappedItem} />
  );
  fireEvent.press(view.getByLabelText('Increase quantity for Phone'));
  expect(props.handleQuantityChange).toHaveBeenCalledWith(cappedItem, 1);
  jest.clearAllMocks();
  let uninstall: (() => void) | undefined;
  act(() => {
    uninstall = installSharedCartWriter({
      write: jest.fn(async () => {}),
      onError: jest.fn(),
    });
  });
  fireEvent.press(view.getByLabelText('Increase quantity for Phone'));
  expect(props.handleQuantityChange).not.toHaveBeenCalled();
  act(() => {
    uninstall?.();
  });
  fireEvent.press(view.getByLabelText('Increase quantity for Phone'));
  expect(props.handleQuantityChange).toHaveBeenCalledWith(cappedItem, 1);
});
it('does not decrement an ordinary line below one', () => {
  const view = render(
    <CartItemQuantityControls {...props} item={{ ...item, quantity: 1 }} />
  );
  fireEvent.press(view.getByLabelText('Decrease quantity for Phone'));
  expect(props.handleQuantityChange).not.toHaveBeenCalled();
});
