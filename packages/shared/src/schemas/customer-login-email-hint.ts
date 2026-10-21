import { z } from 'zod';

export const CustomerLoginEmailHintSchema = z
  .string()
  .trim()
  .email()
  .max(255)
  .transform((value) => value.toLowerCase());

export const MaskedCustomerLoginEmailHintSchema = z
  .string()
  .trim()
  .max(320)
  .refine((value) => /^[^\s@]+?\*\*\*@[^\s@]+\.[^\s@]+$/.test(value));

export function sanitizeCustomerLoginEmailHint(
  email: string | string[] | null | undefined
) {
  const candidates = Array.isArray(email) ? email : [email];

  for (const candidate of candidates) {
    const parsedEmail = CustomerLoginEmailHintSchema.safeParse(candidate);
    if (parsedEmail.success) {
      return parsedEmail.data;
    }
  }

  return '';
}

export function maskCustomerLoginEmailHint(
  email: string | string[] | null | undefined
) {
  const full = sanitizeCustomerLoginEmailHint(email);
  if (!full) {
    return '';
  }

  const at = full.indexOf('@');
  return `${full.slice(0, 1)}***${full.slice(at)}`;
}

export function sanitizeMaskedCustomerLoginEmailHint(
  hint: string | null | undefined
) {
  const parsed = MaskedCustomerLoginEmailHintSchema.safeParse(hint);
  return parsed.success ? parsed.data : '';
}
