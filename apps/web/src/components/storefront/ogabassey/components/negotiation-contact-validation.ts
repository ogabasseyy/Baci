import {
  normalizeNegotiationCustomerEmail,
  normalizePhoneToE164,
} from '@baci/shared/lib';

export function normalizeOptionalEmail(email?: string | null): string | null {
  return normalizeNegotiationCustomerEmail(email);
}

export function getContactValidationError({
  allowMissingContact = false,
  email,
  phone,
}: {
  allowMissingContact?: boolean;
  email: string;
  phone: string;
}): string | null {
  if (email.trim() && !normalizeOptionalEmail(email)) {
    return 'Enter a valid email address.';
  }

  if (phone.trim() && !normalizePhoneToE164(phone)) {
    return 'Enter a valid Phone / WhatsApp number.';
  }

  if (!allowMissingContact && !email.trim() && !phone.trim()) {
    return 'Provide an email address or Phone / WhatsApp number so we can send the merchant\'s decision.';
  }

  return null;
}
