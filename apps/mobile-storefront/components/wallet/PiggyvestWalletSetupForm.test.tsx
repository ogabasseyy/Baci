import BottomSheet from '@gorhom/bottom-sheet';
import { fireEvent, render, screen } from '@testing-library/react-native';
import Colors, { BRAND, palette } from '@/constants/Colors';
import { PiggyvestWalletSetupForm } from './PiggyvestWalletSetupForm';
import { merchantId } from './PiggyvestWalletSetupForm.test-utils';

jest.mock('@gorhom/bottom-sheet', () =>
  require('./wallet-bottom-sheet.test-utils')
);

it('requires BVN and explicit consent before submitting', () => {
  const onSubmit = jest.fn();
  render(
    <PiggyvestWalletSetupForm
      colors={Colors.dark}
      merchantId={merchantId}
      onSubmit={onSubmit}
    />
  );
  fireEvent.press(screen.getByRole('checkbox'));
  fireEvent.press(
    screen.getByRole('button', { name: 'Create account number' })
  );
  expect(onSubmit).not.toHaveBeenCalled();
  expect(screen.getByText('Enter a valid 11-digit BVN.')).toBeOnTheScreen();
});

it('uses a regular input for standalone rendering and the sheet input only when hosted by a sheet', () => {
  const props = {
    colors: Colors.dark,
    merchantId,
    onSubmit: jest.fn(async () => undefined),
  };
  render(<PiggyvestWalletSetupForm {...props} />);
  expect(screen.getByLabelText('BVN')).toBeOnTheScreen();
  expect(screen.queryByTestId('bottom-sheet-text-input')).toBeNull();

  expect(() =>
    render(<PiggyvestWalletSetupForm {...props} insideBottomSheet />)
  ).toThrow('BottomSheetTextInput must be rendered inside BottomSheet');
  render(
    <BottomSheet>
      <PiggyvestWalletSetupForm {...props} insideBottomSheet />
    </BottomSheet>
  );
  expect(screen.getByTestId('bottom-sheet-text-input')).toBeOnTheScreen();
});

it('keeps create disabled and muted until identity-verification consent is checked', () => {
  render(
    <PiggyvestWalletSetupForm
      colors={Colors.dark}
      merchantId={merchantId}
      onSubmit={jest.fn()}
    />
  );
  const button = screen.getByRole('button', { name: 'Create account number' });
  expect(button).toBeDisabled();
  expect(button).toHaveStyle({ backgroundColor: Colors.dark.muted });
  expect(screen.getByText('Create account number')).toHaveStyle({
    color: Colors.dark.text,
  });
  fireEvent.press(screen.getByRole('checkbox'));
  expect(button).toBeEnabled();
  expect(button).toHaveStyle({ backgroundColor: BRAND.primary });
  expect(screen.getByText('Create account number')).toHaveStyle({
    color: palette.white,
  });
  fireEvent.press(screen.getByRole('checkbox'));
  expect(button).toBeDisabled();
});

it.each([
  'light',
  'dark',
] as const)('uses readable disabled foreground colors in the %s theme', (theme) => {
  render(
    <PiggyvestWalletSetupForm
      colors={Colors[theme]}
      merchantId={merchantId}
      onSubmit={jest.fn()}
    />
  );
  const button = screen.getByRole('button', {
    name: 'Create account number',
  });
  expect(button).toBeDisabled();
  expect(button).toHaveStyle({ backgroundColor: Colors[theme].muted });
  expect(screen.getByText('Create account number')).toHaveStyle({
    color: Colors[theme].text,
  });
});

it('exposes the visible button label as its accessible name', () => {
  render(
    <PiggyvestWalletSetupForm
      colors={Colors.light}
      merchantId={merchantId}
      onSubmit={jest.fn()}
    />
  );
  expect(
    screen.getByRole('button', { name: 'Create account number' })
  ).toBeOnTheScreen();
  expect(screen.getByText('Create account number')).toBeOnTheScreen();
});
