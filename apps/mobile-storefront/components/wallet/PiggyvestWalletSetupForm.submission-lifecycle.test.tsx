import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import Colors, { palette } from '@/constants/Colors';
import { PiggyvestWalletSetupForm } from './PiggyvestWalletSetupForm';
import { merchantId } from './PiggyvestWalletSetupForm.test-utils';

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
