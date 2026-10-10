import { beforeEach, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import {
  Pressable as MockPressable,
  ScrollView as MockScrollView,
  Text as MockText,
  TextInput as MockTextInput,
  RefreshControl,
  ScrollView,
} from 'react-native';
import Colors from '@/constants/Colors';
import { LegacyStartSavingsScreen } from './LegacyStartSavingsScreen';
import type { StartSavingsController } from './start-savings-controller.types';

const mockDismiss = jest.fn<() => Promise<void>>();
jest.mock('react-native-keyboard-controller', () => ({
  KeyboardController: { dismiss: () => mockDismiss(), isVisible: () => true },
  KeyboardAwareScrollView: (props: object) => (
    <MockScrollView testID="keyboard-aware-scroll-view" {...props} />
  ),
}));

const mockController = {
  isRefetching: false,
  refetch: jest.fn(),
  selectProduct: jest.fn(),
};
const mockColorScheme = jest.fn<() => 'light' | 'dark' | null>();
jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => mockColorScheme(),
}));
jest.mock('./use-start-savings-controller', () => ({
  useStartSavingsController: () => mockController,
}));
jest.mock('./StartSavingsForm', () => ({
  StartSavingsForm: (props: {
    colors: { background: string };
    controller: StartSavingsController;
    onSearchFocusChange?: (focused: boolean) => void;
  }) => (
    <>
      <MockTextInput
        accessibilityLabel="Device search"
        onFocus={() => props.onSearchFocusChange?.(true)}
        onBlur={() => props.onSearchFocusChange?.(false)}
      />
      <MockText>{`Savings form ${props.colors.background}`}</MockText>
      <MockPressable
        accessibilityRole="button"
        accessibilityLabel="Pick device"
        onPress={() =>
          props.controller.selectProduct(
            {
              id: 'phone',
              name: 'Phone',
              slug: 'phone',
              image: '',
              price: 1000,
            },
            'variant-1'
          )
        }
      >
        <MockText>Pick device</MockText>
      </MockPressable>
    </>
  ),
}));
jest.mock('./StartSavingsModals', () => ({
  StartSavingsModals: () => <MockText>Savings modals</MockText>,
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockColorScheme.mockReturnValue('light');
  mockDismiss.mockResolvedValue(undefined);
  mockController.isRefetching = false;
});

it.each([
  'light',
  'dark',
  null,
] as const)('renders the form and modals with the %p theme', (scheme) => {
  mockColorScheme.mockReturnValue(scheme);
  render(<LegacyStartSavingsScreen />);
  expect(
    screen.getByText(`Savings form ${Colors[scheme ?? 'light'].background}`)
  ).toBeOnTheScreen();
  expect(screen.getByText('Savings modals')).toBeOnTheScreen();
});

it('preserves pull-to-refresh and the controller refreshing state', () => {
  const view = render(<LegacyStartSavingsScreen />);
  const refreshControl = screen.UNSAFE_getByType(RefreshControl);
  expect(refreshControl.props.refreshing).toBe(false);
  fireEvent(refreshControl, 'refresh');
  expect(mockController.refetch).toHaveBeenCalledTimes(1);
  mockController.isRefetching = true;
  view.rerender(<LegacyStartSavingsScreen />);
  expect(screen.UNSAFE_getByType(RefreshControl).props.refreshing).toBe(true);
});

it('allows result presses through while the search keyboard is open', () => {
  render(<LegacyStartSavingsScreen />);
  expect(
    screen.UNSAFE_getByType(ScrollView).props.keyboardShouldPersistTaps
  ).toBe('handled');
});

it('starts device loading before keyboard dismissal finishes without forcing a scroll jump', async () => {
  let finishDismiss: () => void = () => {};
  mockDismiss.mockReturnValue(
    new Promise<void>((resolve) => {
      finishDismiss = resolve;
    })
  );
  let finishFrame: FrameRequestCallback = () => {};
  const frame = jest
    .spyOn(global, 'requestAnimationFrame')
    .mockImplementation((callback) => {
      finishFrame = callback;
      return 1;
    });
  const scroll = jest
    .spyOn(ScrollView.prototype, 'scrollTo')
    .mockImplementation(() => {});
  try {
    render(<LegacyStartSavingsScreen />);
    fireEvent(screen.getByLabelText('Device search'), 'focus');
    fireEvent.press(screen.getByRole('button', { name: 'Pick device' }));
    fireEvent.press(screen.getByRole('button', { name: 'Pick device' }));
    expect(mockDismiss).toHaveBeenCalledTimes(1);
    expect(mockController.selectProduct).toHaveBeenCalledTimes(1);
    expect(scroll).not.toHaveBeenCalled();
    expect(screen.getByTestId('keyboard-aware-scroll-view')).toHaveProp(
      'enabled',
      false
    );
    await act(async () => {
      finishDismiss();
    });
    expect(mockController.selectProduct).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'phone' }),
      'variant-1'
    );
    expect(scroll).not.toHaveBeenCalled();
    act(() => finishFrame(0));
    expect(scroll).not.toHaveBeenCalled();
    expect(screen.getByTestId('keyboard-aware-scroll-view')).toHaveProp(
      'enabled',
      true
    );
  } finally {
    frame.mockRestore();
    scroll.mockRestore();
  }
});

it('does not repeat selection or schedule scrolling after leaving during keyboard dismissal', async () => {
  let finishDismiss: () => void = () => {};
  mockDismiss.mockReturnValue(
    new Promise<void>((resolve) => {
      finishDismiss = resolve;
    })
  );
  const frame = jest.spyOn(global, 'requestAnimationFrame');
  const view = render(<LegacyStartSavingsScreen />);
  fireEvent.press(screen.getByRole('button', { name: 'Pick device' }));
  view.unmount();
  frame.mockClear();
  await act(async () => {
    finishDismiss();
  });
  expect(mockController.selectProduct).toHaveBeenCalledTimes(1);
  expect(frame).not.toHaveBeenCalled();
  frame.mockRestore();
});

it('reserves result space above the keyboard only while device search is focused', () => {
  render(<LegacyStartSavingsScreen />);
  fireEvent(screen.getByLabelText('Device search'), 'focus');
  expect(screen.getByTestId('keyboard-aware-scroll-view')).toHaveProp(
    'bottomOffset',
    200
  );
  expect(screen.getByTestId('keyboard-aware-scroll-view')).toHaveProp(
    'disableScrollOnKeyboardHide',
    true
  );
  fireEvent(screen.getByLabelText('Device search'), 'blur');
  expect(screen.getByTestId('keyboard-aware-scroll-view')).toHaveProp(
    'bottomOffset',
    24
  );
});
