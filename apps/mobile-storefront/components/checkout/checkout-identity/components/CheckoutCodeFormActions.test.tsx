import { fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import { getCheckoutIdentityTheme } from '../colors';
import { CheckoutCodeFormActions } from './CheckoutCodeFormActions';

const theme = getCheckoutIdentityTheme('light');
const noOp = jest.fn();

it('renders social actions for email entry and forwards the busy state', () => {
  const renderSocial = jest.fn((busy: boolean) => (
    <Text>{busy ? 'Social busy' : 'Social ready'}</Text>
  ));
  render(
    <CheckoutCodeFormActions
      busy
      onResend={noOp}
      onUseDifferentEmail={noOp}
      renderSocial={renderSocial}
      resendAfter={null}
      sentTo=""
      socialBusy
      theme={theme}
    />
  );

  expect(renderSocial).toHaveBeenCalledWith(true);
  expect(screen.getByText('Social busy')).toBeTruthy();
});

it('counts down resend availability and disables email switching while busy', () => {
  jest.useFakeTimers().setSystemTime(1_000);
  const onResend = jest.fn();
  const onUseDifferentEmail = jest.fn();
  render(
    <CheckoutCodeFormActions
      busy
      onResend={onResend}
      onUseDifferentEmail={onUseDifferentEmail}
      renderSocial={() => null}
      resendAfter={61_000}
      sentTo="shopper@example.com"
      socialBusy
      theme={theme}
    />
  );

  const resend = screen.getByRole('button', {
    name: 'You can resend a code in 60 seconds.',
  });
  const differentEmail = screen.getByRole('button', {
    name: 'Use a different email',
  });
  expect(resend).toBeDisabled();
  expect(differentEmail).toBeDisabled();
  fireEvent.press(resend);
  fireEvent.press(differentEmail);
  expect(onResend).not.toHaveBeenCalled();
  expect(onUseDifferentEmail).not.toHaveBeenCalled();
  jest.useRealTimers();
});
