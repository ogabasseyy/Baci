import type { OxygenFields } from './oxygen-form-utils';

const homeKeys = [
  'home_street',
  'home_state',
  'home_city',
  'home_lga',
  'home_house_number',
  'home_landmark',
] as const;

/** Never combine different residences or overwrite deliberately cleared values. */
export function restoreCheckoutHomeAddress(
  saved: OxygenFields,
  checkout: OxygenFields
): OxygenFields {
  if (homeKeys.some((key) => Object.hasOwn(saved, key))) return saved;
  if (!checkout.home_street?.trim() || !checkout.home_state?.trim())
    return saved;
  const home: OxygenFields = {};
  for (const key of homeKeys)
    if (checkout[key] !== undefined) home[key] = checkout[key];
  return { ...home, ...saved };
}
