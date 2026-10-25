import { oxygenProbeCustomerSchema } from '@/schemas/oxygen-probe';

export const oxygenPersonalFields = [
  ['first_name', 'First name'],
  ['last_name', 'Last name'],
  ['middle_name', 'Middle name'],
  ['email', 'Email'],
  ['bvn', 'BVN'],
  ['nin', 'NIN'],
  ['date_of_birth', 'Date of birth'],
] as const;

export function parseOxygenCustomerForm(data: FormData, phone: string) {
  const get = (name: string) => String(data.get(name) ?? '');
  return oxygenProbeCustomerSchema.safeParse({
    accept_terms_and_condition: 'yes',
    user_category: 'individual',
    customer_personal_details: {
      external_identifier: '',
      ...Object.fromEntries(
        oxygenPersonalFields.map(([key]) => [key, get(key)])
      ),
      phone_number: phone.replace(/\D/g, '').replace(/^0/, '234'),
    },
    customer_bank_details: Object.fromEntries(
      ['bank_code', 'bank_name', 'account_number', 'account_name'].map(
        (key) => [key, get(key)]
      )
    ),
    customer_employment_details: {
      employment_status: get('employment_status'),
      name_of_employer: get('name_of_employer'),
      salary_amount: get('salary_amount'),
      salary_date: Number(get('salary_date')),
    },
  });
}
