import { fireEvent, render, screen } from '@testing-library/react-native';
import Colors, { palette } from '@/constants/Colors';
import { SavingsFundingLoadingPanel } from './SavingsFundingLoadingPanel';

it('uses brand-tinted feedback and announces the pending wallet check', () => {
  render(<SavingsFundingLoadingPanel colors={Colors.light} />);

  expect(screen.getByText('Almost ready')).toBeOnTheScreen();
  expect(
    screen.getByLabelText('Checking savings availability')
  ).toBeOnTheScreen();
  expect(
    screen.getByRole('progressbar', { name: 'Checking savings availability' })
      .props.accessible
  ).toBe(true);
  expect(screen.getByText('Almost ready')).toHaveStyle({
    color: Colors.light.primary,
  });
  expect(palette.red[600]).toBe(Colors.light.primary);
});

it('announces a readiness error and provides a usable retry action', () => {
  const onRetry = jest.fn();
  render(
    <SavingsFundingLoadingPanel
      colors={Colors.light}
      onRetry={onRetry}
      state="error"
    />
  );

  expect(
    screen.getByText('We couldn’t confirm your wallet is ready.')
  ).toBeOnTheScreen();
  expect(screen.getByRole('alert')).toHaveTextContent(
    'We couldn’t confirm your wallet is ready.'
  );
  fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
  expect(onRetry).toHaveBeenCalledTimes(1);
});

it('explains that sign-in is required without showing a savings action', () => {
  render(<SavingsFundingLoadingPanel colors={Colors.light} state="identity" />);

  expect(screen.getByText('Sign in to add to savings')).toBeOnTheScreen();
  expect(screen.queryByRole('button')).toBeNull();
});
