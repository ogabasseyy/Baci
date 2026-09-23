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
