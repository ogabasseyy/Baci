import { oxygenRuntimeActionSchema } from '@baci/shared/oxygen';
import type { OxygenBank, OxygenFields } from './oxygen-form-utils';
export function buildOxygenApplication(
  fields: OxygenFields,
  bank: OxygenBank,
  accountName: string,
  checkoutPhone: string
) {
  return oxygenRuntimeActionSchema.safeParse({
    action: 'start_application',
    customer: {
      accept_terms_and_condition: 'yes',
      user_category: 'individual',
      customer_personal_details: {
        external_identifier: '',
        first_name: fields.first_name ?? '',
        last_name: fields.last_name ?? '',
        middle_name: fields.middle_name ?? '',
        phone_number: checkoutPhone.replace(/\D/g, '').replace(/^0/, '234'),
        email: fields.email ?? '',
        bvn: fields.bvn ?? '',
        nin: fields.nin ?? '',
        date_of_birth: fields.date_of_birth ?? '',
      },
      customer_bank_details: {
        bank_code: bank.code,
        bank_name: bank.name,
        account_number: fields.account_number ?? '',
        account_name: accountName,
      },
      customer_employment_details: {
        employment_status: fields.employment_status,
        name_of_employer: fields.name_of_employer ?? '',
        salary_amount: fields.salary_amount ?? '',
        salary_date: Number(fields.salary_date),
      },
    },
  });
}
