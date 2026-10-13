import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import {
  ContactHarness,
  emptyContact,
  validContact,
} from './contact.test-support';

describe('live checkout contact step', () => {
  it('explains missing input and focuses the first invalid field', async () => {
    const user = userEvent.setup();
    render(<ContactHarness />);
    expect(
      screen.queryByText('First name is required')
    ).not.toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: 'Continue to Delivery' })
    );
    const first = screen.getByRole('textbox', {
      name: 'First Name *',
    });
    expect(first).toHaveFocus();
    expect(first).toHaveAttribute('aria-invalid', 'true');
    expect(first).toHaveAccessibleDescription('First name is required');
    expect(
      screen.getByRole('button', { name: 'Delivery Method' })
    ).toBeDisabled();
  });

  it.each([
    ['firstName', ' ', 'First Name *', 'First name is required'],
    ['lastName', '', 'Last Name *', 'Last name is required'],
    ['customerEmail', '', 'Email Address *', 'Email address is required'],
    [
      'customerEmail',
      'invalid',
      'Email Address *',
      'Please enter a valid email address',
    ],
    ['customerPhone', '', 'Phone Number *', 'Phone number is required'],
    [
      'customerPhone',
      '+234123',
      'Phone Number *',
      'Please enter a valid phone number',
    ],
  ])('blocks invalid %s and associates its error', async (key, value, label, error) => {
    const user = userEvent.setup();
    render(<ContactHarness initial={{ ...validContact, [key]: value }} />);
    await user.click(
      screen.getByRole('button', { name: 'Continue to Delivery' })
    );
    const field = screen.getByRole('textbox', { name: label });
    expect(field).toHaveFocus();
    expect(field).toHaveAccessibleDescription(error);
    expect(
      screen.getByRole('button', { name: 'Delivery Method' })
    ).toBeDisabled();
  });

  it('advances, focuses the delivery header and preserves contact data when reopened', async () => {
    const user = userEvent.setup();
    render(<ContactHarness initial={validContact} />);
    await user.click(
      screen.getByRole('button', { name: 'Continue to Delivery' })
    );
    expect(
      screen.getByRole('button', { name: 'Delivery Method' })
    ).toHaveFocus();
    expect(
      screen.queryByRole('textbox', { name: 'First Name *' })
    ).not.toBeInTheDocument();
    const header = screen.getByRole('button', { name: 'Contact Information' });
    expect(header).toHaveAttribute('aria-expanded', 'false');
    await user.click(header);
    expect(screen.getByRole('textbox', { name: 'First Name *' })).toHaveValue(
      'Ada'
    );
  });

  it('clears a field error as its value is corrected', async () => {
    const user = userEvent.setup();
    render(
      <ContactHarness
        initial={{ ...validContact, firstName: emptyContact.firstName }}
      />
    );
    await user.click(
      screen.getByRole('button', { name: 'Continue to Delivery' })
    );
    const first = screen.getByRole('textbox', {
      name: 'First Name *',
    });
    await user.type(first, 'Ada');
    expect(first).toHaveAttribute('aria-invalid', 'false');
    expect(first).not.toHaveAttribute('aria-describedby');
    await user.click(
      screen.getByRole('button', { name: 'Continue to Delivery' })
    );
    expect(screen.getByText('Delivery fields')).toBeVisible();
  });

  it('exposes browser autofill for contact fields', () => {
    render(<ContactHarness />);
    for (const [name, token] of [
      ['First Name *', 'given-name'],
      ['Last Name *', 'family-name'],
      ['Email Address *', 'email'],
      ['Phone Number *', 'tel'],
    ]) {
      expect(screen.getByRole('textbox', { name })).toHaveAttribute(
        'autocomplete',
        token
      );
    }
  });
});
