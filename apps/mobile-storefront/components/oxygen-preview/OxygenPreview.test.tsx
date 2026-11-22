import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { OxygenPreview } from './OxygenPreview';

jest.mock('expo-router/react-navigation', () => ({
  usePreventRemove: jest.fn(),
}));

jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => 'light',
}));

it('books the selected offer, submits synthetic proof, and displays the confirmed schedule', async () => {
  render(<OxygenPreview initial="plan" />);
  fireEvent.press(screen.getByRole('button', { name: '2 months' }));
  fireEvent.press(screen.getByRole('button', { name: '50%' }));
  fireEvent.press(
    screen.getByRole('button', { name: 'See payment breakdown' })
  );

  expect(await screen.findByText('12 Example Street')).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'Choose file' }));
  fireEvent.press(
    await screen.findByRole('button', {
      name: 'Submit saved home address and proof',
    })
  );
  expect(await screen.findByText('Address under review')).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'Check for an update' }));

  expect(await screen.findByText('₦101,932.88')).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'Show payment dates' }));
  expect(screen.getByText('26 Jan 2027')).toBeTruthy();
  expect(screen.getByText('26 Feb 2027')).toBeTruthy();
  expect(screen.queryByText('26 Mar 2027')).toBeNull();
  fireEvent.press(screen.getByRole('button', { name: 'Accept payment plan' }));
  expect(await screen.findByText('Your signature')).toBeTruthy();
});

it('uses the demo code and walks from approval through payment and setup', async () => {
  render(<OxygenPreview initial="code" />);
  fireEvent.changeText(
    screen.getByLabelText('Six-digit verification code'),
    '123456'
  );

  expect(await screen.findByText('₦52,432.88')).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'Continue payment' }));
  expect(await screen.findByText('Set up your repayments')).toBeTruthy();
  fireEvent.press(
    screen.getByRole('button', { name: 'Complete repayment setup' })
  );

  await waitFor(() =>
    expect(screen.getByText('Your upfront steps are complete')).toBeTruthy()
  );
});

it('walks through the prefilled application and checks the mock eligibility', async () => {
  render(<OxygenPreview initial="identity" />);
  fireEvent.press(await screen.findByRole('button', { name: 'Continue' }));
  const bank = await screen.findByRole('button', {
    name: 'Continue to income details',
  });
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Continue to income details' }).props
        .accessibilityState.disabled
    ).toBe(false)
  );
  fireEvent.press(bank);

  fireEvent.press(await screen.findByRole('button', { name: 'Choose file' }));
  fireEvent.press(
    screen.getByRole('checkbox', { name: /I agree to share these details/ })
  );
  const submit = await screen.findByRole('button', {
    name: 'Continue verification',
  });
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Continue verification' }).props
        .accessibilityState.disabled
    ).toBe(false)
  );
  fireEvent.press(submit);

  fireEvent.changeText(
    await screen.findByLabelText('Six-digit verification code'),
    '123456'
  );
  fireEvent.press(
    await screen.findByRole('button', { name: 'Complete mock selfie' })
  );
  fireEvent.press(
    await screen.findByRole('button', { name: 'Check for an update' })
  );
  expect(
    await screen.findByRole('button', { name: 'See payment breakdown' })
  ).toBeTruthy();
});
