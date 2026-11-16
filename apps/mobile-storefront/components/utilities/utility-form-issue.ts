import {
  LOCAL_PHONE_DIGITS,
  phoneLengthError,
} from './airtime-form-controller.helpers';

const MIN_AIRTIME_AMOUNT = 50;
const MAX_AIRTIME_AMOUNT = 50_000;

/**
 * What a utility form still needs before Pay. `inline` issues are shown
 * beside their field (the customer finished typing something that is wrong);
 * the rest are shown as one calm line above the Pay button.
 */
export interface UtilityFormIssue {
  field: 'amount' | 'bundle' | 'network' | 'phone';
  inline: boolean;
  message: string;
}

function phoneIssue(phoneNumber: string, purpose: string) {
  const digits = phoneNumber.replace(/\D/g, '');
  if (!digits) {
    return {
      field: 'phone',
      inline: false,
      message: `Enter the phone number ${purpose}.`,
    } as const;
  }
  const error = phoneLengthError(digits);
  if (!error) return null;
  return {
    field: 'phone',
    // A full-length number that is still wrong (not 0 and ten digits) is
    // flagged at the field; a number still being typed only gets the hint.
    inline: digits.length >= LOCAL_PHONE_DIGITS,
    message: error.message,
  } as const;
}

export function getAirtimeFormIssue({
  numericAmount,
  phoneNumber,
  selectedProvider,
}: {
  numericAmount: number;
  phoneNumber: string;
  selectedProvider: string | null;
}): UtilityFormIssue | null {
  const phone = phoneIssue(phoneNumber, 'to top up');
  if (phone) return phone;
  if (!selectedProvider) {
    return {
      field: 'network',
      inline: false,
      message: 'Choose the network for this number.',
    };
  }
  if (!(numericAmount > 0)) {
    return {
      field: 'amount',
      inline: false,
      message: 'Choose or enter an amount.',
    };
  }
  if (
    numericAmount < MIN_AIRTIME_AMOUNT ||
    numericAmount > MAX_AIRTIME_AMOUNT
  ) {
    return {
      field: 'amount',
      inline: true,
      message: 'Amount must be between ₦50 and ₦50,000.',
    };
  }
  return null;
}

export function getDataFormIssue({
  phoneNumber,
  planAmount,
  selectedPlan,
  selectedProvider,
}: {
  phoneNumber: string;
  planAmount: number;
  selectedPlan: string | null | undefined;
  selectedProvider: string | null | undefined;
}): UtilityFormIssue | null {
  const phone = phoneIssue(phoneNumber, 'to send data to');
  if (phone) return phone;
  if (!selectedProvider || !selectedPlan) {
    return {
      field: 'bundle',
      inline: false,
      message: 'Choose a data bundle.',
    };
  }
  if (!(planAmount > 0)) {
    return {
      field: 'amount',
      inline: false,
      message: 'Enter an amount for this bundle.',
    };
  }
  return null;
}

/**
 * The footer line for an issue shown beside its field: the field may be
 * scrolled out of view, so the disabled Pay still says where to look.
 */
export function getFieldIssuePointer(field: UtilityFormIssue['field']): string {
  return field === 'phone'
    ? 'Check the phone number above.'
    : field === 'amount'
      ? 'Check the amount above.'
      : 'Check the details above.';
}
