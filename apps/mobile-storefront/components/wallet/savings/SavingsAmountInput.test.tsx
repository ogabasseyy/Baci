import { fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { SavingsAmountInput } from './SavingsAmountInput';

it('keeps the currency prefix visible when the amount is entered', () => {
  const onChangeText = jest.fn();
  const { rerender } = render(
    <SavingsAmountInput
      colors={Colors.light}
      label="Contribution"
      value=""
      onChangeText={onChangeText}
    />
  );
  fireEvent.changeText(screen.getByLabelText('Contribution'), '5000');
  expect(onChangeText).toHaveBeenCalledWith('5000');
  rerender(
    <SavingsAmountInput
      colors={Colors.light}
      label="Contribution"
      value="5000"
      onChangeText={onChangeText}
    />
  );
  expect(screen.getByText('₦')).toBeOnTheScreen();
  expect(screen.getByDisplayValue('5,000')).toBeOnTheScreen();
});

it('strips pasted separators and accepts clearing the amount', () => {
  const onChangeText = jest.fn();
  render(
    <SavingsAmountInput
      colors={Colors.light}
      label="Contribution"
      value="1250000"
      onChangeText={onChangeText}
    />
  );
  expect(screen.getByDisplayValue('1,250,000')).toBeOnTheScreen();
  fireEvent.changeText(screen.getByLabelText('Contribution'), '₦ 25,000');
  expect(onChangeText).toHaveBeenLastCalledWith('25000');
  fireEvent.changeText(screen.getByLabelText('Contribution'), '');
  expect(onChangeText).toHaveBeenLastCalledWith('');
});
