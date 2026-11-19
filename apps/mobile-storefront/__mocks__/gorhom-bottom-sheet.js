const React = require('react');
const { View, ScrollView, TextInput, Pressable } = require('react-native');
const mockBottomSheetClose = jest.fn();
const mockBottomSheetSnapToIndex = jest.fn();
function BottomSheet({ children, ref, backdropComponent: Backdrop, ...props }) {
  React.useImperativeHandle(
    ref,
    () => ({
      close: mockBottomSheetClose,
      snapToIndex: mockBottomSheetSnapToIndex,
    }),
    []
  );
  return React.createElement(
    View,
    { ...props, testID: 'gorhom-bottom-sheet' },
    Backdrop ? React.createElement(Backdrop, {}) : null,
    children
  );
}
function BottomSheetScrollView(props) {
  return React.createElement(ScrollView, props);
}
function BottomSheetBackdrop(props) {
  return React.createElement(Pressable, {
    ...props,
    accessibilityRole: 'button',
    accessibilityLabel: 'Dismiss savings sheet',
  });
}
module.exports = {
  __esModule: true,
  default: BottomSheet,
  BottomSheetBackdrop,
  BottomSheetScrollView,
  BottomSheetTextInput: TextInput,
  mockBottomSheetClose,
  mockBottomSheetSnapToIndex,
};
