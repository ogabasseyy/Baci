import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ContactFields } from './ContactFields';

it('associates errors with the affected field and reports edits by field name', () => {
  const onChange = vi.fn();
  render(
    <ContactFields
      values={{
        firstName: 'Ada',
        lastName: 'Okon',
        customerEmail: '',
        customerPhone: '+2348123456789',
      }}
      errors={{ customerEmail: 'Enter a valid email address' }}
      onChange={onChange}
    />
  );
  const email = screen.getByRole('textbox', { name: /email address/i });
  expect(email).toHaveAccessibleDescription('Enter a valid email address');
  expect(email).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByRole('textbox', { name: /first name/i })).toHaveAttribute(
    'autocomplete',
    'given-name'
  );
  expect(
    screen.getByRole('textbox', { name: /phone number/i })
  ).toHaveAttribute('autocomplete', 'tel');
  fireEvent.change(email, { target: { value: 'ada@example.com' } });
  expect(onChange).toHaveBeenCalledWith('customerEmail', 'ada@example.com');
});
