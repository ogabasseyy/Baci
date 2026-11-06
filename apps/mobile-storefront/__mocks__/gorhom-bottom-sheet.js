const React = require('react');
const { View, ScrollView, TextInput, Pressable } = require('react-native');
function BottomSheet({ children, backdropComponent: Backdrop, ...props }) {
  return React.createElement(
    View,
    { ...props, testID: 'gorhom-bottom-sheet' },
    Backdrop ? React.createElement(Backdrop, {}) : null,
    children
  );
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
  BottomSheetScrollView: ScrollView,
  BottomSheetTextInput: TextInput,
};
