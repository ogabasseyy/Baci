import { describe, expect, it } from 'vitest';
import { getContactErrors } from './contact-validation';

const valid = {
  firstName: 'Ada',
  lastName: 'Okon',
  customerEmail: 'ada@example.test',
  customerPhone: '+2348031234567',
};

describe('contact validation', () => {
  it('accepts valid contact details with surrounding whitespace', () => {
    expect(
      getContactErrors({
        ...valid,
        firstName: ' Ada ',
        customerEmail: ' ada@example.test ',
      })
    ).toEqual({});
  });
  it.each([
    ['firstName', '  ', 'First name is required'],
    ['lastName', '', 'Last name is required'],
    ['customerEmail', '', 'Email address is required'],
    ['customerEmail', 'bad-email', 'Please enter a valid email address'],
    ['customerPhone', '', 'Phone number is required'],
    ['customerPhone', '+234123', 'Please enter a valid phone number'],
  ])('rejects invalid %s', (key, value, message) => {
    expect(getContactErrors({ ...valid, [key]: value })).toEqual({
      [key]: message,
    });
  });
  it('requires a password only when creating an account', () => {
    expect(
      getContactErrors(valid, { createAccount: false, password: '' })
    ).toEqual({});
    expect(
      getContactErrors(valid, { createAccount: true, password: '12345' })
    ).toEqual({ accountPassword: 'Password must be at least 6 characters' });
    expect(
      getContactErrors(valid, { createAccount: true, password: '123456' })
    ).toEqual({});
  });
});
