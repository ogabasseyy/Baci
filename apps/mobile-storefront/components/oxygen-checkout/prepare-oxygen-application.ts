import { buildOxygenApplication } from './oxygen-application-command';
import { oxygenEmploymentErrors } from './oxygen-employment-errors';
import type { OxygenBank, OxygenFields } from './oxygen-form-utils';

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
