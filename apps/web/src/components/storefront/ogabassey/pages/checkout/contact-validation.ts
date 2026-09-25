import { isValidPhoneNumber } from 'react-phone-number-input';

export interface ContactValues {
  firstName: string;
  lastName: string;
  customerEmail: string;
  customerPhone: string;
}
export interface CheckoutAccountValues {
  createAccount: boolean;
  password: string;
}
export type ContactErrors = Partial<
  Record<keyof ContactValues | 'accountPassword', string>
>;
export const CONTACT_FIELD_IDS = {
  firstName: 'checkout-first-name',
  lastName: 'checkout-last-name',
  customerEmail: 'checkout-email',
  customerPhone: 'checkout-phone',
  accountPassword: 'checkout-account-password',
} as const;

export function getContactErrors(
  values: ContactValues,
  account?: CheckoutAccountValues
): ContactErrors {
  const errors: ContactErrors = {};
  if (!values.firstName.trim()) errors.firstName = 'First name is required';
  if (!values.lastName.trim()) errors.lastName = 'Last name is required';
  if (!values.customerEmail.trim())
    errors.customerEmail = 'Email address is required';
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.customerEmail.trim()))
    errors.customerEmail = 'Please enter a valid email address';
  if (!values.customerPhone) errors.customerPhone = 'Phone number is required';
  else if (!isValidPhoneNumber(values.customerPhone))
    errors.customerPhone = 'Please enter a valid phone number';
  if (account?.createAccount && account.password.length < 6)
    errors.accountPassword = 'Password must be at least 6 characters';
  return errors;
}
