import { fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { RedvaultPendingView } from './RedvaultPendingView';

it('does not claim capture while pending and checks status without another payment', () => {
  const onCheck = jest.fn();
  const onBack = jest.fn();
  render(
    <RedvaultPendingView
      colors={Colors.light}
      held={false}
      onCheck={onCheck}
      onBack={onBack}
    />
  );
  expect(screen.getByText(/A charge has not been confirmed/)).toBeTruthy();
  expect(screen.queryByText(/has been received/)).toBeNull();
  fireEvent.press(screen.getByRole('button', { name: 'Check payment status' }));
  expect(onCheck).toHaveBeenCalledTimes(1);
  fireEvent.press(screen.getByRole('button', { name: 'Back to checkout' }));
  expect(onBack).toHaveBeenCalledTimes(1);
});

it('uses received copy only for explicit captured-held evidence', () => {
  render(
    <RedvaultPendingView
      colors={Colors.light}
      held
      onCheck={jest.fn()}
      onBack={jest.fn()}
    />
  );
  expect(
    screen.getByText(/has been received and is awaiting verification/)
  ).toBeTruthy();
  expect(screen.queryByText(/A charge has not been confirmed/)).toBeNull();
});
