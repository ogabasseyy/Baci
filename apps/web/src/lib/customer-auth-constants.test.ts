import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { CUSTOMER_OTP_TTL_SECONDS } from './customer-auth-constants';

it('matches the configured Supabase email OTP expiry', () => {
  const config = readFileSync(
    resolve(
      dirname(fileURLToPath(import.meta.url)),
      '../../../../supabase/config.toml'
    ),
    'utf8'
  );
  const expiry = config.match(/^otp_expiry\s*=\s*(\d+)\s*$/m);
  expect(expiry).not.toBeNull();
  expect(CUSTOMER_OTP_TTL_SECONDS).toBe(Number(expiry?.[1]));
});
