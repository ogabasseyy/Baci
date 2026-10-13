import {
  normalizeNegotiationCustomerEmail,
  normalizePhoneToE164,
  normalizeStoredE164Phone,
} from '@baci/shared/lib';

export type NegotiationAccountContact = {
  email?: string | null;
  id: string;
  phone?: string | null;
};

export type NegotiationCustomerContact = {
  errorMessage: string | null;
  normalizedEmail: string | null;
  normalizedPhone: string | null;
  userId: string | null;
};

function getMissingNegotiationContactError(
  normalizedEmail: string | null,
  normalizedPhone: string | null
): string | null {
  return !normalizedEmail && !normalizedPhone
    ? 'Enter a Phone / WhatsApp number so the merchant can reach you about this offer.'
    : null;
}

export function buildNegotiationCustomerContact(
  account: NegotiationAccountContact | null | undefined,
  phone: string
): NegotiationCustomerContact {
  const normalizedEmail = normalizeNegotiationCustomerEmail(account?.email);
  const normalizedPhone = phone.trim()
    ? normalizePhoneToE164(phone)
    : normalizeStoredE164Phone(account?.phone);
  const errorMessage = phone.trim()
    ? normalizedPhone
      ? null
      : 'Enter a valid Phone / WhatsApp number.'
    : getMissingNegotiationContactError(normalizedEmail, normalizedPhone);

  return {
    errorMessage,
    normalizedEmail,
    normalizedPhone,
    userId: account?.id ?? null,
  };
}
