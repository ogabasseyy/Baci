import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EmailForm } from './EmailForm';

describe('EmailForm', () => {
  it('uses storefront theme colours for the email label, icon and field', () => {
    render(
      <EmailForm
        email=""
        onEmailChange={vi.fn()}
        onSubmit={vi.fn()}
        error=""
        isSending={false}
        isGoogleLoading={false}
        isAppleLoading={false}
        onGoogleSignIn={vi.fn()}
        onAppleSignIn={vi.fn()}
      />
    );
    const input = screen.getByRole('textbox', { name: /email address/i });
    const submitBtn = screen.getByRole('button', { name: /send sign-in code/i });

    expect(submitBtn).toHaveAttribute('aria-busy', 'false');
    expect(screen.getByText('Email address')).toHaveClass(
      'text-store-background-text'
    );
    expect(input).toHaveClass(
      'bg-store-background',
      'text-store-background-text',
      'border-store-border',
      'placeholder:text-store-background-text'
    );
    expect(input.parentElement?.querySelector('svg')).toHaveClass(
      'text-store-background-text/60'
    );
  });

  it('sets aria-busy="true" and disables submission while sending or social sign-in is loading', () => {
    const { rerender } = render(
      <EmailForm
        email="shopper@example.com"
        onEmailChange={vi.fn()}
        onSubmit={vi.fn()}
        error=""
        isSending={true}
        isGoogleLoading={false}
        isAppleLoading={false}
        onGoogleSignIn={vi.fn()}
        onAppleSignIn={vi.fn()}
      />
    );

    const sendingButton = screen.getByRole('button', { name: /sending code/i });
    expect(sendingButton).toHaveAttribute('aria-busy', 'true');
    expect(sendingButton).toBeDisabled();

    rerender(
      <EmailForm
        email="shopper@example.com"
        onEmailChange={vi.fn()}
        onSubmit={vi.fn()}
        error=""
        isSending={false}
        isGoogleLoading={true}
        isAppleLoading={false}
        onGoogleSignIn={vi.fn()}
        onAppleSignIn={vi.fn()}
      />
    );

    const googleLoadingSubmit = screen.getByRole('button', {
      name: /send sign-in code/i,
    });
    expect(googleLoadingSubmit).toHaveAttribute('aria-busy', 'true');
    expect(googleLoadingSubmit).toBeDisabled();
  });
});
