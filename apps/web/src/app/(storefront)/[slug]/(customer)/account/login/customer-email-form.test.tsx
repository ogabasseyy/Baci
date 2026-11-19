import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { CustomerEmailForm } from './customer-email-form';

it('renders an accessible email form and submits its value', () => {
  const onSendCode = vi.fn(async (event) => event.preventDefault());
  const onEmailChange = vi.fn();
  render(
    <CustomerEmailForm
      email="buyer@example.com"
      error=""
      isSending={false}
      isGoogleLoading={false}
      onEmailChange={onEmailChange}
      onSendCode={onSendCode}
      onGoogleSignIn={vi.fn()}
    />
  );
  const input = screen.getByRole('textbox', { name: 'Email address' });
  fireEvent.change(input, { target: { value: 'other@example.com' } });
  expect(onEmailChange).toHaveBeenCalledWith('other@example.com');
  fireEvent.click(screen.getByRole('button', { name: 'Send sign-in code' }));
  expect(onSendCode).toHaveBeenCalledOnce();
  const icon = input.parentElement?.querySelector('svg');
  expect(icon).toHaveAttribute('aria-hidden', 'true');
  expect(icon).toHaveClass('pointer-events-none');
});
