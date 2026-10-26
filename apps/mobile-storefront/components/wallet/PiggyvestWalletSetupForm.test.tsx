import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import Colors, { BRAND, palette } from '@/constants/Colors';
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
  fireEvent.press(screen.getByRole('checkbox'));
  fireEvent.press(
    screen.getByRole('button', { name: 'Create account number' })
  );
  expect(onSubmit).not.toHaveBeenCalled();
  expect(screen.getByText('Enter a valid 11-digit BVN.')).toBeOnTheScreen();
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

it('keeps the busy spinner white on the enabled primary button', async () => {
  let resolveSubmit!: () => void;
  const onSubmit = jest.fn(
    () => new Promise<void>((resolve) => (resolveSubmit = resolve))
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
    screen.getByRole('button', { name: 'Create account number' })
  ).toBeDisabled();
  expect(
    screen.getByRole('progressbar', { name: 'Creating account number' })
  ).toHaveProp('color', palette.white);
  resolveSubmit();
  await waitFor(() =>
    expect(
      screen.queryByRole('progressbar', { name: 'Creating account number' })
    ).toBeNull()
  );
});

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
  expect(screen.getByLabelText('BVN').props.value).toBe('');
  expect(screen.getByRole('button', { name: 'Show BVN' })).toBeOnTheScreen();
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
  fireEvent.press(screen.getByRole('button', { name: 'Show BVN' }));
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

it('prevents double submission while clearing sensitive input on completion', async () => {
  let resolveSubmit!: () => void;
  const onSubmit = jest.fn(
    () => new Promise<void>((resolve) => (resolveSubmit = resolve))
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
  const submit = screen.getByRole('button', { name: 'Create account number' });
  fireEvent.press(submit);
  fireEvent.press(submit);
  expect(onSubmit).toHaveBeenCalledTimes(1);
  resolveSubmit();
  await waitFor(() =>
    expect(screen.getByLabelText('BVN').props.value).toBe('')
  );
});
