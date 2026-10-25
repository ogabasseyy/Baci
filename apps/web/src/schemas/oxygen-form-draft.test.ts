import { expect, it } from 'vitest';
import { oxygenFormDraftSchema } from './oxygen-form-draft';

it('allows partial fields and step progress but refuses consent, OTP and trusted verification facts', () => {
  expect(
    oxygenFormDraftSchema.safeParse({
      step: 1,
      fields: { bvn: '123', account_number: '12345' },
    }).success
  ).toBe(true);
  for (const name of [
    'otp',
    'consent',
    'account_name',
    'bank_name',
    'validated',
    'selfieUrl',
  ]) {
    expect(
      oxygenFormDraftSchema.safeParse({ step: 1, fields: { [name]: 'yes' } })
        .success
    ).toBe(false);
  }
});
