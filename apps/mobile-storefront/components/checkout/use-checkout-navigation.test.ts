import { renderHook } from '@testing-library/react-native';
import { Alert, BackHandler, Platform } from 'react-native';
import { useCheckoutNavigation } from './use-checkout-navigation';

const mockIsFocused = jest.fn();
jest.mock('expo-router', () => ({
  router: { back: jest.fn() },
  useNavigation: () => ({ isFocused: mockIsFocused }),
}));

it('lets Cart handle Android back while checkout is prefetched and handles it once checkout is focused', () => {
  jest.replaceProperty(Platform, 'OS', 'android');
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const back = jest
    .spyOn(BackHandler, 'addEventListener')
    .mockReturnValue({ remove: jest.fn() });
  try {
    renderHook(() =>
      useCheckoutNavigation({
        isOrderInFlight: { current: false },
        setStep: jest.fn(),
        step: 'address',
      })
    );
    const handler = back.mock.calls[0]?.[1];
    expect(handler).toBeDefined();
    const event = { type: 'hardwareBackPress', timeStamp: 0 };

    mockIsFocused.mockReturnValue(false);
    expect(handler?.(event)).toBe(false);
    expect(alert).not.toHaveBeenCalled();

    mockIsFocused.mockReturnValue(true);
    expect(handler?.(event)).toBe(true);
    expect(alert).toHaveBeenCalledWith(
      'Leave Checkout?',
      expect.any(String),
      expect.any(Array)
    );
  } finally {
    jest.restoreAllMocks();
  }
});
