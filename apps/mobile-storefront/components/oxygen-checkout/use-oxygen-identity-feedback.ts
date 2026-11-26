import { useState } from 'react';
import type { OxygenFields } from './oxygen-form-utils';
import { oxygenIdentityErrors } from './oxygen-identity-validation';
import { oxygenEmploymentErrors } from './prepare-oxygen-application';

/** Recheck only errors already shown; editing never triggers a save or lookup. */
export function useOxygenIdentityFeedback(fields: OxygenFields, phone: string) {
  const [reported, setErrors] = useState<
    Partial<Record<keyof OxygenFields, string>>
  >({});
  const current = {
    ...oxygenIdentityErrors(fields, phone),
    ...oxygenEmploymentErrors(fields),
  };
  const errors: Partial<Record<keyof OxygenFields, string>> = {};
  for (const key of Object.keys(reported) as (keyof OxygenFields)[]) {
    if (current[key]) errors[key] = current[key];
  }
  return {
    errors,
    setErrors,
    message: (error: string | null) =>
      (error === 'Check the highlighted identity details.' ||
        error === 'Check the highlighted employment and income details.') &&
      !Object.keys(errors).length
        ? null
        : error,
  };
}
