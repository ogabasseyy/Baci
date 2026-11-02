import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { PiggyvestWalletSetupForm } from './PiggyvestWalletSetupForm';
import { merchantId } from './PiggyvestWalletSetupForm.test-utils';

it.each([
  [
    'PROFILE_VERIFICATION_REQUIRED',
    'Verify your email and complete your name and phone number before creating your wallet.',
  ],
  [
    'OWNERSHIP_REVIEW_REQUIRED',
    'Your wallet identity needs review. Contact support; do not create another wallet.',
  ],
])('shows safe actionable guidance for %s instead of a generic refresh error', async (code, message) => {
  render(
    <PiggyvestWalletSetupForm
      colors={Colors.dark}
      merchantId={merchantId}
      onSubmit={jest
        .fn()
        .mockRejectedValue(
          Object.assign(new Error('private provider details'), { code })
        )}
    />
  );
  fireEvent.changeText(screen.getByLabelText('BVN'), '12345678901');
  fireEvent.press(screen.getByRole('checkbox'));
  fireEvent.press(screen.getByRole('button', { name: 'Show BVN' }));
  fireEvent.press(
    screen.getByRole('button', { name: 'Create account number' })
  );
  await waitFor(() => expect(screen.getByText(message)).toBeOnTheScreen());
  expect(screen.getByLabelText('BVN').props.value).toBe('');
  expect(screen.getByRole('button', { name: 'Show BVN' })).toBeOnTheScreen();
  expect(screen.queryByText('private provider details')).toBeNull();
});

it('clears the BVN after a generic submit failure and shows a safe inline error', async () => {
  const onSubmit = jest
    .fn()
    .mockRejectedValue(new Error('private provider error'));
  render(
    <PiggyvestWalletSetupForm
      colors={Colors.light}
      merchantId={merchantId}
      onSubmit={onSubmit}
    />
  );
  fireEvent.changeText(screen.getByLabelText('BVN'), '12345678901');
  fireEvent.press(screen.getByRole('checkbox'));
  fireEvent.press(screen.getByRole('button', { name: 'Show BVN' }));
  fireEvent.press(
    screen.getByRole('button', { name: 'Create account number' })
  );
  await waitFor(() => expect(screen.getByRole('alert')).toBeOnTheScreen());
  expect(
    screen.getByText(/Your BVN was cleared for security/)
  ).toBeOnTheScreen();
  expect(screen.getByLabelText('BVN').props.value).toBe('');
  expect(screen.getByRole('button', { name: 'Show BVN' })).toBeOnTheScreen();
  expect(screen.queryByText('private provider error')).toBeNull();
  expect(onSubmit).toHaveBeenCalledWith({
    merchantId,
    bvn: '12345678901',
    consent: true,
  });
});

it('maps a definitive BVN rejection to correctable guidance and clears the rejected value', async () => {
  const onSubmit = jest.fn().mockRejectedValue(
    Object.assign(new Error('That BVN was rejected.'), {
      code: 'INVALID_BVN',
    })
  );
  render(
    <PiggyvestWalletSetupForm
      colors={Colors.light}
      merchantId={merchantId}
      onSubmit={onSubmit}
    />
  );
  fireEvent.changeText(screen.getByLabelText('BVN'), '12345678901');
  fireEvent.press(screen.getByRole('checkbox'));
  fireEvent.press(screen.getByRole('button', { name: 'Show BVN' }));
  fireEvent.press(
    screen.getByRole('button', { name: 'Create account number' })
  );
  await waitFor(() => expect(screen.getByRole('alert')).toBeOnTheScreen());
  expect(
    screen.getByText('That BVN was rejected. Check the number and try again.')
  ).toBeOnTheScreen();
  expect(screen.getByLabelText('BVN').props.value).toBe('');
  expect(screen.getByRole('button', { name: 'Show BVN' })).toBeOnTheScreen();
});

it('clears the BVN only after the setup is confirmed', async () => {
  const onSubmit = jest.fn().mockResolvedValue(undefined);
  render(
    <PiggyvestWalletSetupForm
      colors={Colors.light}
      merchantId={merchantId}
      onSubmit={onSubmit}
    />
  );
  fireEvent.changeText(screen.getByLabelText('BVN'), '12345678901');
  fireEvent.press(screen.getByRole('checkbox'));
  fireEvent.press(screen.getByRole('button', { name: 'Show BVN' }));
  fireEvent.press(
    screen.getByRole('button', { name: 'Create account number' })
  );
  await waitFor(() =>
    expect(screen.getByLabelText('BVN').props.value).toBe('')
  );
  expect(screen.getByRole('button', { name: 'Show BVN' })).toBeOnTheScreen();
  expect(onSubmit).toHaveBeenCalledWith({
    merchantId,
    bvn: '12345678901',
    consent: true,
  });
});

it('preserves an invalid local BVN for correction without submitting', () => {
  const onSubmit = jest.fn();
  render(
    <PiggyvestWalletSetupForm
      colors={Colors.light}
      merchantId={merchantId}
      onSubmit={onSubmit}
    />
  );
  fireEvent.changeText(screen.getByLabelText('BVN'), '123');
  fireEvent.press(screen.getByRole('checkbox'));
  fireEvent.press(
    screen.getByRole('button', { name: 'Create account number' })
  );
  expect(onSubmit).not.toHaveBeenCalled();
  expect(screen.getByLabelText('BVN').props.value).toBe('123');
});
