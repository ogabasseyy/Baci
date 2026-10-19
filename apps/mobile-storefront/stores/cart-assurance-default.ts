import {
  resolveAddedLineAssurance,
  shouldDeferAssuranceDefault,
} from '@baci/shared/lib';
import { nativeAssurancePolicy } from './cart-assurance-config';

type AssuranceRelevantLine = {
  hasAssurance?: boolean;
  voucher_token?: string;
  voucher_award_id?: string;
};

export function resolveNativeAddedLineAssurance(
  item: AssuranceRelevantLine
): boolean {
  const resolved = resolveAddedLineAssurance(item.hasAssurance, undefined, {
    ...nativeAssurancePolicy(),
    hasQuizVoucher: Boolean(item.voucher_award_id || item.voucher_token),
  });
  return resolved ?? false;
}

/**
 * True when the line defaulted off only because the live
 * shipping-insurance setting had not loaded yet. The add stamps the line
 * so the settings warm-up can reconcile it once known, instead of the
 * unknown-at-add state permanently opting the line out.
 */
export function resolveNativeAddedLinePendingSetting(
  item: AssuranceRelevantLine
): boolean {
  return shouldDeferAssuranceDefault(item.hasAssurance, {
    ...nativeAssurancePolicy(),
    hasQuizVoucher: Boolean(item.voucher_award_id || item.voucher_token),
  });
}
