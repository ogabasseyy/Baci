import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

it('retires the account-wide Edge sender without trusting caller-supplied recipient data', () => {
  const source = readFileSync(
    resolve(
      process.cwd(),
      '../../supabase/functions/send-welcome-email/index.ts'
    ),
    'utf8'
  );
  expect(source).not.toContain('createClient');
  expect(source).not.toContain('api.zeptomail.com');
  expect(source).toContain('410');
});
it('does not launch an untracked welcome before web store provisioning', () => {
  const source = readFileSync(
    resolve(
      process.cwd(),
      'src/app/(platform)/onboarding/submit-onboarding-workflow.ts'
    ),
    'utf8'
  );
  expect(source).not.toContain('sendWelcomeEmail');
});
