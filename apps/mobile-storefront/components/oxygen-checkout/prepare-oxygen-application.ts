import { buildOxygenApplication } from './oxygen-application-command';
import type { OxygenBank, OxygenFields } from './oxygen-form-utils';

export function prepareOxygenApplication({
  fields,
  banks,
  accountName,
  checking,
  consent,
  hasProof,
  checkoutPhone,
}: {
  fields: OxygenFields;
  banks: readonly OxygenBank[];
  accountName: string;
  checking: boolean;
  consent: boolean;
  hasProof: boolean;
  checkoutPhone: string;
}) {
  if (!accountName)
    return {
      error: checking
        ? 'Confirming your saved bank account. Please wait a moment.'
        : 'Confirm your bank account on the Bank step.',
      bankRequired: !checking,
    } as const;
  if (!hasProof)
    return {
      error: 'Choose your proof of address before continuing.',
    } as const;
  if (!consent)
    return { error: 'Accept Oxygen’s terms before continuing.' } as const;
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
