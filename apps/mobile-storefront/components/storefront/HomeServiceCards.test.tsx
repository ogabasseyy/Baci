import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import * as ReactNative from 'react-native';
import { Animated, StyleSheet } from 'react-native';
import type { ReactTestInstance } from 'react-test-renderer';
import { BRAND, withAlpha } from '@/constants/Colors';

const mockPush = jest.fn();
const mockOrderShortcuts =
  jest.fn<() => { receipts: boolean; tracking: boolean } | undefined>();
jest.mock('@/hooks/use-home-order-shortcuts', () => ({
  useHomeOrderShortcuts: () => mockOrderShortcuts(),
}));
const defaultDimensions = {
  screen: {
    fontScale: 1,
    height: 844,
    scale: 3,
    width: 390,
  },
  window: {
    fontScale: 1,
    height: 844,
    scale: 3,
    width: 390,
  },
};

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => 'dark',
}));

const { HomeServiceCards } =
  jest.requireActual<typeof import('./HomeServiceCards')>('./HomeServiceCards');

function findAncestorWithWidth(instance: ReactTestInstance, width: number) {
  let current: ReactTestInstance | null = instance;

  while (current) {
    const style = StyleSheet.flatten(current.props.style);
    if (style?.width === width) {
      return current;
    }
    current = current.parent;
  }

  return null;
}

describe('HomeServiceCards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockOrderShortcuts.mockReturnValue(undefined);
    jest.spyOn(Animated, 'loop').mockReturnValue({
      reset: jest.fn(),
      start: jest.fn(),
      stop: jest.fn(),
    } as unknown as ReturnType<typeof Animated.loop>);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    act(() => {
      ReactNative.Dimensions.set(defaultDimensions);
    });
  });

  it('renders the home service shortcuts', () => {
    render(<HomeServiceCards />);

    expect(screen.getByText('IMEI Checker')).toBeTruthy();
    expect(screen.getByText('Repair Lab')).toBeTruthy();
    expect(screen.getByText('Swap/Trade')).toBeTruthy();
    expect(screen.getByText('SuperQuiz')).toBeTruthy();
  });

  it('does not schedule continuous border animation while home service cards are mounted', () => {
    const timing = jest.spyOn(Animated, 'timing');

    const { rerender, unmount } = render(<HomeServiceCards />);
    rerender(<HomeServiceCards placement="aboveUtility" />);
    unmount();

    expect(Animated.loop).not.toHaveBeenCalled();
    expect(timing).not.toHaveBeenCalled();
  });

  it('keeps the full-size shortcut dimensions from the mobile visual baseline', () => {
    render(<HomeServiceCards />);

    const imeiButton = screen.getByRole('button', {
      name: 'IMEI Checker. Verify before buying',
    });
    const card = findAncestorWithWidth(imeiButton, 114);

    expect(card).not.toBeNull();
    expect(StyleSheet.flatten(card?.props.style)).toMatchObject({
      height: 42,
      width: 114,
      borderWidth: 1,
      borderColor: withAlpha(BRAND.primary, 0.48),
    });
  });

  it('keeps compact shortcut dimensions from the mobile visual baseline', () => {
    ReactNative.Dimensions.set({
      screen: {
        fontScale: 1,
        height: 812,
        scale: 3,
        width: 320,
      },
      window: {
        fontScale: 1,
        height: 812,
        scale: 3,
        width: 320,
      },
    });

    render(<HomeServiceCards />);

    const imeiButton = screen.getByRole('button', {
      name: 'IMEI Checker. Verify before buying',
    });
    const card = findAncestorWithWidth(imeiButton, 98);

    expect(card).not.toBeNull();
    expect(StyleSheet.flatten(card?.props.style)).toMatchObject({
      height: 38,
      width: 98,
    });
  });

  it('uses separate spacing for above and below utility placements', () => {
    const { rerender } = render(<HomeServiceCards />);

    expect(
      StyleSheet.flatten(screen.getByTestId('home-service-cards').props.style)
    ).toMatchObject({
      marginTop: 28,
      marginBottom: -2,
    });

    rerender(<HomeServiceCards placement="aboveUtility" />);

    expect(
      StyleSheet.flatten(screen.getByTestId('home-service-cards').props.style)
    ).toMatchObject({
      marginTop: 8,
      marginBottom: -8,
      transform: [{ translateY: -14 }],
    });
  });

  it('exposes checkout financing and Wallet savings from distinct Home tiles', () => {
    render(<HomeServiceCards placement="underSearch" />);

    expect(screen.getAllByRole('button')).toHaveLength(8);
    fireEvent.press(screen.getByRole('button', { name: /^Pay Small Small/ }));
    expect(mockPush).toHaveBeenLastCalledWith({
      pathname: '/category/[slug]',
      params: { slug: 'phones', sort: 'price_asc' },
    });

    fireEvent.press(screen.getByRole('button', { name: /^Save & Earn/ }));
    expect(mockPush).toHaveBeenLastCalledWith('/wallet');
  });

  it('uses discovery tiles when there is no order history', () => {
    render(<HomeServiceCards placement="underSearch" />);
    expect(screen.queryByText('Receipts')).toBeNull();
    expect(screen.queryByText('Track Order')).toBeNull();
    expect(screen.getByText('Return Policy')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: /^Return Policy/ }));
    expect(mockPush).toHaveBeenLastCalledWith('/returns');

    fireEvent.press(screen.getByRole('button', { name: /^Device Protection/ }));
    expect(mockPush).toHaveBeenLastCalledWith('/device-protection');
  });

  it('keeps receipts visible after shipment and hides the tracking shortcut', () => {
    mockOrderShortcuts.mockReturnValue({ receipts: true, tracking: false });
    const { rerender } = render(<HomeServiceCards placement="underSearch" />);
    expect(screen.getByText('Receipts')).toBeTruthy();
    expect(screen.queryByText('Track Order')).toBeNull();

    mockOrderShortcuts.mockReturnValue({ receipts: true, tracking: true });
    rerender(<HomeServiceCards placement="underSearch" />);
    fireEvent.press(screen.getByRole('button', { name: /^Track Order/ }));
    expect(mockPush).toHaveBeenCalledWith('/orders');
  });

  it('routes each shortcut to its service screen', () => {
    render(<HomeServiceCards />);

    fireEvent.press(
      screen.getByLabelText('IMEI Checker. Verify before buying')
    );
    expect(mockPush).toHaveBeenLastCalledWith('/imei-check');

    fireEvent.press(screen.getByLabelText('Repair Lab. Fix phones fast'));
    expect(mockPush).toHaveBeenLastCalledWith('/repairs');

    fireEvent.press(screen.getByLabelText('Swap/Trade. Swap for credit'));
    expect(mockPush).toHaveBeenLastCalledWith('/swap');

    fireEvent.press(screen.getByLabelText('SuperQuiz. Play for rewards'));
    expect(mockPush).toHaveBeenLastCalledWith('/quiz');
  });
});
