import { fireEvent, render, screen } from '@testing-library/react-native';
import { useNativeSharedCartStore } from '@/stores/native-shared-cart-store';
import { CartWriteNotice } from './CartWriteNotice';

jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => 'light',
}));

afterEach(() => useNativeSharedCartStore.setState({ writeNotice: null }));

it('renders nothing without a notice', () => {
  render(<CartWriteNotice />);
  expect(screen.queryByRole('alert')).toBeNull();
});

it('announces the reason an edit was undone and can be dismissed', () => {
  useNativeSharedCartStore.setState({ writeNotice: 'That item is gone.' });
  render(<CartWriteNotice />);
  expect(screen.getByRole('alert')).toBeTruthy();
  expect(screen.getByText('That item is gone.')).toBeTruthy();
  fireEvent.press(screen.getByLabelText('Dismiss cart message'));
  expect(useNativeSharedCartStore.getState().writeNotice).toBeNull();
});
