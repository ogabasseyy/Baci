import { buildOxygenApplication } from './oxygen-application-command';
import type { OxygenBank, OxygenFields } from './oxygen-form-utils';

export function oxygenEmploymentErrors(
  fields: OxygenFields
): Partial<Record<keyof OxygenFields, string>> {
  const errors: Partial<Record<keyof OxygenFields, string>> = {};
  if (
    !['EMPLOYED', 'SELF_EMPLOYED', 'PENSIONER', 'UNEMPLOYED'].includes(
      fields.employment_status ?? ''
    )
  )
    errors.employment_status = 'Select your employment status.';
  if ((fields.name_of_employer ?? '').length > 150)
    errors.name_of_employer = 'Employer name must be 150 characters or fewer.';
  if (!/^\d+(\.\d{1,2})?$/.test(fields.salary_amount ?? ''))
    errors.salary_amount = 'Enter your monthly income.';
  const payday = Number(fields.salary_date);
  if (!Number.isInteger(payday) || payday < 1 || payday > 31)
    errors.salary_date = 'Select your monthly payday.';
  return errors;
}

export function prepareOxygenApplication({
  fields,
  banks,
  accountName,
  checking,
  consent,
  checkoutPhone,
}: {
  fields: OxygenFields;
  banks: readonly OxygenBank[];
  accountName: string;
  checking: boolean;
  consent: boolean;
  checkoutPhone: string;
}) {
  if (!accountName)
    return {
      error: checking
        ? 'Confirming your saved bank account. Please wait a moment.'
        : 'Confirm your bank account on the Bank step.',
      bankRequired: !checking,
    } as const;
  const fieldErrors = oxygenEmploymentErrors(fields);
  if (Object.keys(fieldErrors).length)
    return {
      error: 'Check the highlighted employment and income details.',
      fieldErrors,
    } as const;
  if (!consent)
    return {
      error: 'Accept Oxygen’s terms before continuing.',
      consentError: 'Accept Oxygen’s terms to continue.',
    } as const;
  const bank = banks.find((item) => item.code === fields.bank_code);
  if (!bank)
    return {
      error:
        'Could not load your selected bank. Go back to the Bank step and try again.',
      bankRequired: true,
    } as const;
  const result = buildOxygenApplication(
    fields,
    bank,
    accountName,
    checkoutPhone
  );
  return result.success
    ? { command: result.data }
    : {
        error: 'Check the identity, bank and income details before continuing.',
      };
}
