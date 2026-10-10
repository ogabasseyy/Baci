import { resolveAddedLineAssurance } from '@baci/shared/lib';
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
