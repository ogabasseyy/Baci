import { fireEvent, render, screen } from '@testing-library/react-native';
import { SavingsSheetContext } from './SavingsSheetContext';
import { SavingsSheetTextInput } from './SavingsSheetTextInput';

jest.mock('@gorhom/bottom-sheet', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const { TextInput: NativeTextInput } =
    jest.requireActual<typeof import('react-native')>('react-native');
  return {
    BottomSheetTextInput: (props: import('react-native').TextInputProps) =>
      React.createElement(NativeTextInput, {
        ...props,
        testID: 'gorhom-bottom-sheet-text-input',
      }),
  };
});

it('uses and forwards to the regular native input outside the savings sheet', () => {
  const onChangeText = jest.fn();
  render(
    <SavingsSheetTextInput
      accessibilityLabel="Contribution amount"
      onChangeText={onChangeText}
      placeholder="0.00"
      value="12"
    />
  );

  const input = screen.getByLabelText('Contribution amount');
  expect(input).toBeOnTheScreen();
  expect(input.props.testID).toBeUndefined();
  expect(input.props.placeholder).toBe('0.00');
  fireEvent.changeText(input, '34');
  expect(onChangeText).toHaveBeenCalledWith('34');
});

it('uses the distinct Gorhom input and forwards props inside the savings sheet', () => {
  const onChangeText = jest.fn();
  render(
    <SavingsSheetContext.Provider value>
      <SavingsSheetTextInput
        accessibilityLabel="Contribution amount"
        onChangeText={onChangeText}
        placeholder="0.00"
        value="12"
      />
    </SavingsSheetContext.Provider>
  );

  const sheetInput = screen.getByTestId('gorhom-bottom-sheet-text-input');
  expect(sheetInput).toBeOnTheScreen();
  expect(sheetInput.props.accessibilityLabel).toBe('Contribution amount');
  expect(sheetInput.props.placeholder).toBe('0.00');
  fireEvent.changeText(sheetInput, '56');
  expect(onChangeText).toHaveBeenCalledWith('56');
});
