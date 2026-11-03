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
});
