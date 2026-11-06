import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import { Modal, StyleSheet, Text } from 'react-native';
import Colors, { palette } from '@/constants/Colors';
import { SavingsBottomSheet } from './SavingsBottomSheet';

const colors = { ...Colors.dark, primary: palette.red[600] };

it('keeps its heading inside the draggable sheet with a brand outline', () => {
  const onClose = jest.fn();
  render(
    <SavingsBottomSheet colors={colors} onClose={onClose} visible>
      <Text accessibilityRole="header">Add to savings</Text>
    </SavingsBottomSheet>
  );
  const sheet = screen.getByTestId('gorhom-bottom-sheet');
  expect(
    within(sheet).getByRole('header', { name: 'Add to savings' })
  ).toBeOnTheScreen();
  expect(sheet.props.enablePanDownToClose).toBe(true);
  expect(sheet.props.enableDynamicSizing).toBe(false);
  expect(sheet.props.snapPoints).toEqual(['72%', '92%']);
  expect(sheet.props.index).toBe(0);
  expect(StyleSheet.flatten(sheet.props.backgroundStyle)).toMatchObject({
    borderColor: palette.red[600],
    borderWidth: 1.5,
  });
  expect(sheet.props.keyboardBehavior).toBe('interactive');
  expect(sheet.props.keyboardBlurBehavior).toBe('restore');
  expect(sheet.props.enableBlurKeyboardOnGesture).toBe(true);
  fireEvent(sheet, 'close');
  expect(onClose).toHaveBeenCalledTimes(1);
});

it('handles Android back and mounts no sheet when hidden', () => {
  const onClose = jest.fn();
  const view = render(
    <SavingsBottomSheet colors={colors} onClose={onClose} visible>
      <Text>Goal</Text>
    </SavingsBottomSheet>
  );
  fireEvent(screen.UNSAFE_getByType(Modal), 'requestClose');
  expect(onClose).toHaveBeenCalledTimes(1);
  view.rerender(
    <SavingsBottomSheet colors={colors} onClose={onClose} visible={false}>
      <Text>Goal</Text>
    </SavingsBottomSheet>
  );
  expect(screen.queryByTestId('gorhom-bottom-sheet')).toBeNull();
});
