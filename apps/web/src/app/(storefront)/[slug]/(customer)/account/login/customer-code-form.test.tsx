import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { CustomerCodeForm } from './customer-code-form';

it('passes code changes and actions to the caller and blocks changes during verification', () => {
  const onDifferentEmail = vi.fn();
  const handleCodeChange = vi.fn();
  const props = {
    code: ['', '', '', '', '', ''],
    error: '',
    isVerifying: false,
    isSending: false,
    codeInputRefs: { current: [] as (HTMLInputElement | null)[] },
    handlePaste: vi.fn(),
    handleCodeChange,
    handleKeyDown: vi.fn(),
    handleResendCode: vi.fn(async () => {}),
    onDifferentEmail,
  };
  const { rerender } = render(<CustomerCodeForm {...props} />);
  fireEvent.change(screen.getByLabelText('Digit 1 of 6'), {
    target: { value: '123456' },
  });
  expect(handleCodeChange).toHaveBeenCalledWith(0, '123456');
  fireEvent.click(
    screen.getByRole('button', { name: 'Use a different email' })
  );
  expect(onDifferentEmail).toHaveBeenCalledOnce();
  rerender(<CustomerCodeForm {...props} isVerifying />);
  expect(
    screen.getByRole('button', { name: 'Use a different email' })
  ).toBeDisabled();
});
