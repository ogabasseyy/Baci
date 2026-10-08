import { resolveAddedLineAssurance } from '@baci/shared/lib';
import { CONFIG } from '@/lib/config';

type NativeAssurancePolicy = {
  smartCartProEnabled: boolean;
  merchantSlug: string | null | undefined;
};

type AssuranceRelevantLine = {
  hasAssurance?: boolean;
  voucher_token?: string;
  voucher_award_id?: string;
};

export function nativeAssurancePolicy(): NativeAssurancePolicy {
  return {
    smartCartProEnabled: CONFIG.ENABLE_SMART_CART_PRO,
    merchantSlug: CONFIG.MERCHANT_SLUG,
  };
}

export function resolveNativeAddedLineAssurance(
  item: AssuranceRelevantLine
): boolean {
  const resolved = resolveAddedLineAssurance(item.hasAssurance, undefined, {
    ...nativeAssurancePolicy(),
    hasQuizVoucher: Boolean(item.voucher_award_id || item.voucher_token),
  });
  return resolved ?? false;
}
