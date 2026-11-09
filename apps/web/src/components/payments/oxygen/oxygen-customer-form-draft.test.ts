import { expect, it } from 'vitest';
import { oxygenCustomerDraft } from './oxygen-customer-form-draft';

it('serializes only allowed draft fields and omits consent and documents', () => {
  const form = document.createElement('form');
  form.innerHTML =
    '<input name="first_name" value="Ada"><input name="otp" value="123456"><input name="consent" value="yes">';
  const draft = oxygenCustomerDraft(form, 2);
  expect(draft.step).toBe(2);
  expect(draft.fields.first_name).toBe('Ada');
  expect(draft.fields.bank_code).toBe('');
  expect(draft.fields).not.toHaveProperty('otp');
  expect(draft.fields).not.toHaveProperty('consent');
});
