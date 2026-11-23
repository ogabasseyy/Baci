import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { PaidOrderChangeMessage } from './PaidOrderChangeMessage';

it('renders the message with a polite live region', () => {
  render(
    <PaidOrderChangeMessage
      message="Payment could not be confirmed."
      color="navy"
    />
  );
  const message = screen.getByText('Payment could not be confirmed.');
  expect(message.getAttribute('aria-live')).toBe('polite');
});
