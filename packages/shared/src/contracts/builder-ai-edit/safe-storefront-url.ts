import { z } from 'zod';
import { MAX_AI_URL_LENGTH } from './limits';

function isSafeStorefrontUrl(value: string): boolean {
  if (value.includes('\\')) return false;
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code <= 31 || code === 127) return false;
  }
  if (value.startsWith('/')) return !value.startsWith('//');
  if (value.startsWith('#')) return true;
  if (!value.toLowerCase().startsWith('https://')) return false;
  try {
    const parsed = new URL(value);
    return (
      parsed.protocol === 'https:' &&
      parsed.hostname.length > 0 &&
      parsed.username.length === 0 &&
      parsed.password.length === 0
    );
  } catch {
    return false;
  }
}

export const safeStorefrontUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_AI_URL_LENGTH)
  .refine(
    isSafeStorefrontUrl,
    'Expected an https, root-relative, or anchor URL'
  );
