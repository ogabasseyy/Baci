import { act, fireEvent, render, screen } from '@testing-library/react-native';
import {
  Dimensions,
  Keyboard,
  type KeyboardEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Colors from '@/constants/Colors';
import {
  AddressSuggestionsProvider,
  useAddressSuggestionsPortal,
} from './address-suggestions-portal';

const prediction = {
  description: '1 Allen Avenue, Ikeja, Lagos',
  mainText: '1 Allen Avenue',
  placeId: 'place-1',
  secondaryText: 'Ikeja, Lagos',
};

function keyboardEvent(screenY: number): KeyboardEvent {
  return {
    duration: 0,
    easing: 'keyboard',
    endCoordinates: {
      height: 0,
      screenX: 0,
      screenY,
      width: 0,
    },
  };
}

function captureKeyboardShow(): (screenY: number) => void {
  let listener: Parameters<typeof Keyboard.addListener>[1] | undefined;
  jest
    .spyOn(Keyboard, 'addListener')
    .mockImplementation((event, nextListener) => {
      if (event.endsWith('Show')) listener = nextListener;
      return { remove: jest.fn() } as unknown as ReturnType<
        typeof Keyboard.addListener
      >;
    });
  return (screenY) => act(() => listener?.(keyboardEvent(screenY)));
}

function Harness({
  anchorY = 200,
  predictions = [prediction],
}: {
  anchorY?: number;
  predictions?: (typeof prediction)[];
}) {
  const portal = useAddressSuggestionsPortal();
  return (
    <>
      <Pressable
        accessibilityRole="button"
        onPress={() =>
          portal.show({
            anchor: { height: 52, width: 340, x: 16, y: anchorY },
            colors: Colors.light,
            isDark: false,
            onSelect: jest.fn(),
            predictions,
          })
        }
      >
        <Text>Show</Text>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={portal.hide}>
        <Text>Hide</Text>
      </Pressable>
    </>
  );
}

describe('AddressSuggestionsProvider', () => {
  afterEach(() => jest.restoreAllMocks());

  it('shows and hides suggestions through the portal API', () => {
    render(
      <AddressSuggestionsProvider>
        <Harness />
      </AddressSuggestionsProvider>
    );

    fireEvent.press(screen.getByRole('button', { name: 'Show' }));
    expect(screen.getByLabelText('Address suggestions')).toBeTruthy();

    fireEvent.press(screen.getByRole('button', { name: 'Hide' }));
    expect(screen.queryByLabelText('Address suggestions')).toBeNull();
  });

  it('positions suggestions above an input hidden by the keyboard', () => {
    const showKeyboard = captureKeyboardShow();
    render(
      <AddressSuggestionsProvider>
        <Harness anchorY={620} />
      </AddressSuggestionsProvider>
    );
    fireEvent.press(screen.getByRole('button', { name: 'Show' }));

    showKeyboard(600);

    const dropdown = screen.getByLabelText('Address suggestions');
    const style = StyleSheet.flatten(dropdown.props.style);
    expect(Dimensions.get('window').height - style.bottom).toBeLessThan(620);
    expect(Dimensions.get('window').height - style.bottom).toBeLessThanOrEqual(
      592
    );
  });

  it('positions suggestions above when the space below is unusably short', () => {
    const showKeyboard = captureKeyboardShow();
    render(
      <AddressSuggestionsProvider>
        <Harness anchorY={530} />
      </AddressSuggestionsProvider>
    );
    fireEvent.press(screen.getByRole('button', { name: 'Show' }));

    showKeyboard(600);

    const style = StyleSheet.flatten(
      screen.getByLabelText('Address suggestions').props.style
    );
    expect(Dimensions.get('window').height - style.bottom).toBe(526);
    expect(style.maxHeight).toBe(280);
  });

  it('positions suggestions below an input when space is available', () => {
    render(
      <AddressSuggestionsProvider>
        <Harness anchorY={200} />
      </AddressSuggestionsProvider>
    );

    fireEvent.press(screen.getByRole('button', { name: 'Show' }));

    const style = StyleSheet.flatten(
      screen.getByLabelText('Address suggestions').props.style
    );
    expect(style.top).toBe(256);
  });

  it('hides suggestions when no vertical space is available', () => {
    const showKeyboard = captureKeyboardShow();
    render(
      <AddressSuggestionsProvider>
        <Harness anchorY={0} />
      </AddressSuggestionsProvider>
    );
    fireEvent.press(screen.getByRole('button', { name: 'Show' }));

    showKeyboard(8);

    expect(screen.queryByLabelText('Address suggestions')).toBeNull();
  });
});

it('keeps the dropdown attached when its host starts below a navigation header', () => {
  type Measure = (
    callback: (x: number, y: number, width: number, height: number) => void
  ) => void;
  jest
    .spyOn(
      View.prototype as unknown as { measureInWindow: Measure },
      'measureInWindow'
    )
    .mockImplementation((cb) => cb(10, 100, 380, 700));
  render(
    <AddressSuggestionsProvider>
      <Harness anchorY={200} />
    </AddressSuggestionsProvider>
  );
  fireEvent(screen.getByTestId('address-suggestions-layer'), 'layout', {});
  fireEvent.press(screen.getByRole('button', { name: 'Show' }));
  expect(
    StyleSheet.flatten(screen.getByLabelText('Address suggestions').props.style)
  ).toMatchObject({ top: 156, left: 6 });
  jest.restoreAllMocks();
});

it('waits for the current result set to be measured before adjusting scroll', () => {
  const showKeyboard = captureKeyboardShow();
  const onRequestSpace = jest.fn();
  const second = { ...prediction, placeId: 'place-2', mainText: 'Second road' };
  const { rerender, UNSAFE_getByType } = render(
    <AddressSuggestionsProvider onRequestSpace={onRequestSpace}>
      <Harness anchorY={530} />
    </AddressSuggestionsProvider>
  );
  showKeyboard(600);
  fireEvent.press(screen.getByRole('button', { name: 'Show' }));
  fireEvent(UNSAFE_getByType(ScrollView), 'contentSizeChange', 300, 90);
  expect(onRequestSpace).toHaveBeenCalledWith(84);
  onRequestSpace.mockClear();

  rerender(
    <AddressSuggestionsProvider onRequestSpace={onRequestSpace}>
      <Harness anchorY={530} predictions={[prediction, second]} />
    </AddressSuggestionsProvider>
  );
  fireEvent.press(screen.getByRole('button', { name: 'Show' }));
  expect(onRequestSpace).not.toHaveBeenCalled();
  fireEvent(UNSAFE_getByType(ScrollView), 'contentSizeChange', 300, 150);
  expect(onRequestSpace).toHaveBeenCalledTimes(1);
  expect(onRequestSpace).toHaveBeenCalledWith(144);
});
