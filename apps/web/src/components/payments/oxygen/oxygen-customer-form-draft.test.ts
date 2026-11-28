import { expect, it } from 'vitest';
import { OXYGEN_DRAFT_FIELDS } from '@/schemas/oxygen-form-draft';
import { oxygenCustomerDraft } from './oxygen-customer-form-draft';

it('serializes only allowed draft fields and omits consent and documents', () => {
  const form = document.createElement('form');
  form.innerHTML =
    '<input name="first_name" value="Ada"><input name="otp" value="123456"><input name="consent" value="yes"><input name="proof_of_address" type="file"><input name="unexpected" value="secret">';
  const draft = oxygenCustomerDraft(form, 2);
  expect(draft.step).toBe(2);
  expect(draft.fields.first_name).toBe('Ada');
  expect(draft.fields.bank_code).toBe('');
  expect(draft.fields).not.toHaveProperty('otp');
  expect(draft.fields).not.toHaveProperty('consent');
  expect(Object.keys(draft.fields)).toEqual([...OXYGEN_DRAFT_FIELDS]);
});

it('preserves restored defaults for fields omitted from the active form', () => {
  const form = document.createElement('form');
  form.innerHTML = '<input name="first_name" value="Ada">';
  const draft = oxygenCustomerDraft(form, 2, {
    home_street: '14 Allen Avenue',
    home_city: 'Ikeja',
    home_state: 'Lagos',
    home_lga: 'Ikeja',
    home_house_number: '14',
    first_name: 'Old',
  });
  expect(draft.fields.first_name).toBe('Ada');
  expect(draft.fields.home_street).toBe('14 Allen Avenue');
  expect(draft.fields.home_city).toBe('Ikeja');
  expect(draft.fields.home_state).toBe('Lagos');
  expect(draft.fields.home_lga).toBe('Ikeja');
  expect(draft.fields.home_house_number).toBe('14');
});
