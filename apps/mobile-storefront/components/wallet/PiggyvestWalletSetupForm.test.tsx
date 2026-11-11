import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { PiggyvestWalletSetupForm } from './PiggyvestWalletSetupForm';

const merchantId = '6b5cb8a4-5575-456c-b936-8cdfae30db74';

it('requires BVN and explicit consent before submitting', () => {
  const onSubmit = jest.fn();
  render(
    <PiggyvestWalletSetupForm
      colors={Colors.dark}
      merchantId={merchantId}
      onSubmit={onSubmit}
    />
  );
  fireEvent.press(
    screen.getByRole('button', { name: 'Create account number' })
  );
  expect(onSubmit).not.toHaveBeenCalled();
  expect(screen.getByText('Enter a valid 11-digit BVN.')).toBeOnTheScreen();
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

it('keeps the BVN for retry and shows a safe inline error on failure', async () => {
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
  fireEvent.press(
    screen.getByRole('button', { name: 'Create account number' })
  );
  await waitFor(() => expect(screen.getByRole('alert')).toBeOnTheScreen());
  expect(screen.getByLabelText('BVN').props.value).toBe('12345678901');
  expect(screen.queryByText('private provider error')).toBeNull();
  expect(onSubmit).toHaveBeenCalledWith({
    merchantId,
    bvn: '12345678901',
    consent: true,
  });
});

it('maps a definitive BVN rejection to correctable guidance', async () => {
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
  fireEvent.press(
    screen.getByRole('button', { name: 'Create account number' })
  );
  await waitFor(() => expect(screen.getByRole('alert')).toBeOnTheScreen());
  expect(
    screen.getByText('That BVN was rejected. Check the number and try again.')
  ).toBeOnTheScreen();
  // A definitively rejected number is dropped: keeping a known-wrong BVN
  // serves no retry and only widens the sensitive value's lifetime.
  expect(screen.getByLabelText('BVN').props.value).toBe('');
});

it.each([
  'PROVIDER_UNAVAILABLE',
  'NOT_CONFIGURED',
  'PIGGYVEST_NOT_READY',
  'PIGGYVEST_ONBOARDING_NOT_READY',
  'PIGGYVEST_UNAVAILABLE',
])('says setup is unavailable (not refresh) for %s', async (code) => {
  const onSubmit = jest
    .fn()
    .mockRejectedValue(Object.assign(new Error('unavailable'), { code }));
  render(
    <PiggyvestWalletSetupForm
      colors={Colors.light}
      merchantId={merchantId}
      onSubmit={onSubmit}
    />
  );
  fireEvent.changeText(screen.getByLabelText('BVN'), '12345678901');
  fireEvent.press(screen.getByRole('checkbox'));
  fireEvent.press(
    screen.getByRole('button', { name: 'Create account number' })
  );
  expect(
    await screen.findByText(
      'Wallet setup is unavailable right now. Please try again later.'
    )
  ).toBeOnTheScreen();
  expect(screen.queryByText(/Refresh your account/)).toBeNull();
});

it('says setup is unavailable when PiggyVest refused before creating anything', async () => {
  const onSubmit = jest
    .fn()
    .mockRejectedValue(
      Object.assign(new Error('unavailable'), { code: 'PROVIDER_UNAVAILABLE' })
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
  fireEvent.press(
    screen.getByRole('button', { name: 'Create account number' })
  );
  await waitFor(() => expect(screen.getByRole('alert')).toBeOnTheScreen());
  expect(
    screen.getByText(
      'Wallet setup is unavailable right now. Please try again later.'
    )
  ).toBeOnTheScreen();
  // The form stays (no endless "setting up" screen) and keeps the BVN.
  expect(screen.getByLabelText('BVN').props.value).toBe('12345678901');
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
  fireEvent.press(
    screen.getByRole('button', { name: 'Create account number' })
  );
  await waitFor(() =>
    expect(screen.getByLabelText('BVN').props.value).toBe('')
  );
  expect(onSubmit).toHaveBeenCalledWith({
    merchantId,
    bvn: '12345678901',
    consent: true,
  });
});

it('asks for profile verification instead of a refresh when the profile is incomplete', async () => {
  const onSubmit = jest.fn().mockRejectedValue(
    Object.assign(new Error('verify'), {
      code: 'PROFILE_VERIFICATION_REQUIRED',
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
  fireEvent.press(
    screen.getByRole('button', { name: 'Create account number' })
  );
  expect(
    await screen.findByText(
      'Please verify your email and complete your profile, then try again.'
    )
  ).toBeOnTheScreen();
});
