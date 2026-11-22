import { act, render } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import { CheckoutPaymentReplay } from './CheckoutPaymentReplay';

const mockStop = jest.fn();
const mockStart = jest.fn(() => mockStop);
let mockFocused = true;

jest.mock('expo-router', () => ({
  useIsFocused: () => mockFocused,
}));
jest.mock('@/services/checkout-replay', () => ({
  startCheckoutReplay: () => mockStart(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockFocused = true;
});

it('stops when the app backgrounds, when checkout loses focus, and on unmount', () => {
  const previousState = AppState.currentState;
  AppState.currentState = 'active';
  let notify: (state: AppStateStatus) => void = () => undefined;
  const remove = jest.fn();
  const subscribe = jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((_event, listener) => {
      notify = listener;
      return { remove };
    });

  try {
    const { rerender, unmount } = render(<CheckoutPaymentReplay />);
    expect(mockStart).toHaveBeenCalledTimes(1);

    rerender(<CheckoutPaymentReplay />);
    expect(mockStart).toHaveBeenCalledTimes(1);

    act(() => notify('background'));
    expect(mockStop).toHaveBeenCalledTimes(1);

    act(() => notify('active'));
    expect(mockStart).toHaveBeenCalledTimes(2);

    mockFocused = false;
    rerender(<CheckoutPaymentReplay />);
    expect(mockStop).toHaveBeenCalledTimes(2);
    expect(remove).toHaveBeenCalledTimes(1);

    mockFocused = true;
    rerender(<CheckoutPaymentReplay />);
    expect(mockStart).toHaveBeenCalledTimes(3);

    unmount();
    expect(mockStop).toHaveBeenCalledTimes(3);
    expect(remove).toHaveBeenCalledTimes(2);
  } finally {
    subscribe.mockRestore();
    AppState.currentState = previousState;
  }
});
