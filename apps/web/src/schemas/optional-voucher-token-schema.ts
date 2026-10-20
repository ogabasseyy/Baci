import { z } from 'zod';
import { sanitizeText } from '@/lib/sanitize-core';

const VOUCHER_TOKEN_MAX_LENGTH = 512;

export const optionalVoucherTokenSchema = z.preprocess((value) => {
  if (value === null) {
    return undefined;
  }

  if (typeof value !== 'string') {
    return value;
  }

  const sanitized = sanitizeText(value.trim());

  return sanitized.length > 0 ? sanitized : undefined;
}, z.string().max(VOUCHER_TOKEN_MAX_LENGTH).optional());
