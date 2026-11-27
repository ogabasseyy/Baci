import type { OxygenFields } from './oxygen-form-utils';

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
  if ((fields.name_of_employer ?? '').length > 100)
    errors.name_of_employer = 'Employer name must be 100 characters or fewer.';
  if (!/^\d+(\.\d{1,2})?$/.test(fields.salary_amount ?? ''))
    errors.salary_amount = 'Enter your monthly income.';
  const payday = Number(fields.salary_date);
  if (!Number.isInteger(payday) || payday < 1 || payday > 31)
    errors.salary_date = 'Select your monthly payday.';
  return errors;
}
