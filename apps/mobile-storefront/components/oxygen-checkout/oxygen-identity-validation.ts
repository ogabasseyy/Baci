import { oxygenProbeCustomerSchema } from '@baci/shared/oxygen';
import type { OxygenFields } from './oxygen-form-utils';

export function oxygenIdentityErrors(
  fields: OxygenFields,
  phone: string
): Partial<Record<keyof OxygenFields, string>> {
  const result =
    oxygenProbeCustomerSchema.shape.customer_personal_details.safeParse({
      external_identifier: '',
      first_name: fields.first_name ?? '',
      last_name: fields.last_name ?? '',
      middle_name: fields.middle_name ?? '',
      email: fields.email ?? '',
      bvn: fields.bvn ?? '',
      nin: fields.nin ?? '',
      date_of_birth: fields.date_of_birth ?? '',
      phone_number: phone.replace(/\D/g, '').replace(/^0/, '234'),
    });
  if (result.success) return {};
  const errors: Partial<Record<keyof OxygenFields, string>> = {};
  for (const issue of result.error.issues) {
    const key = issue.path[0];
    if (key === 'bvn' || key === 'nin')
      errors[key] = `Enter your complete 11-digit ${key.toUpperCase()}.`;
    if (key === 'first_name') errors.first_name = 'Enter your first name.';
    if (key === 'last_name') errors.last_name = 'Enter your last name.';
    if (key === 'middle_name')
      errors.middle_name = 'Middle name must be 100 characters or fewer.';
    if (key === 'email') errors.email = 'Enter a valid email address.';
    if (key === 'date_of_birth')
      errors.date_of_birth = 'Enter a valid date of birth.';
  }
  return errors;
}
