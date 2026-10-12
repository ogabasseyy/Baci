import { getProviderVtuCommissionRate } from '@/lib/vtu-commission-rates';

/** Minimal row shape the correction needs (structural; no import cycle). */
export interface FallbackCreditCorrectionRow {
  amount: number;
  customer_cashback?: number | null;
  customer_id?: string | null;
  merchant_commission?: number | null;
  network_provider: string;
  type: string;
}

export interface VtuFallbackCreditCorrection {
  customerCashback: number;
  merchantCommission: number;
  originalMerchantCommission: number;
  platformCommission: number;
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function getFiniteMetadataNumber(
  metadata: Record<string, unknown>,
  key: string
) {
  const value = metadata[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function calculateProviderMerchantEarning({
  amount,
  merchantSplit,
  provider,
  providerSource,
}: {
  amount: number;
  merchantSplit: number;
  provider: string;
  providerSource: 'kuda' | 'monnify';
}) {
  const { cap, rate } = getProviderVtuCommissionRate(
    provider,
    'AIRTIME',
    providerSource
  );
  const totalCommission = cap ? Math.min(amount * rate, cap) : amount * rate;

  return roundMoney(totalCommission * (merchantSplit / 100));
}

function calculateProviderTotalCommission({
  amount,
  provider,
  providerSource,
}: {
  amount: number;
  provider: string;
  providerSource: 'kuda' | 'monnify';
}) {
  const { cap, rate } = getProviderVtuCommissionRate(
    provider,
    'AIRTIME',
    providerSource
  );
  const totalCommission = cap ? Math.min(amount * rate, cap) : amount * rate;

  return roundMoney(totalCommission);
}

export function resolveKudaFallbackCreditCorrection({
  metadata,
  row,
}: {
  metadata: Record<string, unknown>;
  row: FallbackCreditCorrectionRow;
}): VtuFallbackCreditCorrection | null {
  if (
    row.type !== 'airtime' ||
    metadata.providerFallback !== 'monnify_airtime_to_kuda'
  ) {
    return null;
  }

  const amount = Number(row.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }

  const originalMerchantCommission =
    getFiniteMetadataNumber(metadata, 'originalMerchantCommission') ??
    roundMoney(
      Number(row.merchant_commission ?? 0) + Number(row.customer_cashback ?? 0)
    );
  const monnifyMerchantEarning = calculateProviderMerchantEarning({
    amount,
    merchantSplit: 100,
    provider: row.network_provider,
    providerSource: 'monnify',
  });
  const inferredMerchantSplit =
    monnifyMerchantEarning > 0
      ? Math.min(
          100,
          Math.max(
            0,
            (originalMerchantCommission / monnifyMerchantEarning) * 100
          )
        )
      : 50;
  const kudaMerchantEarning = calculateProviderMerchantEarning({
    amount,
    merchantSplit: inferredMerchantSplit,
    provider: row.network_provider,
    providerSource: 'kuda',
  });
  const fallbackCashbackRate =
    getFiniteMetadataNumber(metadata, 'customerCashbackRate') ??
    (originalMerchantCommission > 0
      ? (Number(row.customer_cashback ?? 0) / originalMerchantCommission) * 100
      : 0);
  const cashbackEnabled =
    metadata.customerCashbackEnabled === true ||
    (metadata.customerCashbackEnabled !== false &&
      Number(row.customer_cashback ?? 0) > 0);
  const customerCashback =
    cashbackEnabled && row.customer_id
      ? roundMoney(kudaMerchantEarning * (fallbackCashbackRate / 100))
      : 0;

  // Platform share follows the same provider switch: it is the
  // Kuda total minus the Kuda merchant earning (prepare persists the
  // Monnify-derived value, which the merchant API would otherwise
  // report alongside Kuda-corrected merchant figures).
  const kudaTotalCommission = calculateProviderTotalCommission({
    amount,
    provider: row.network_provider,
    providerSource: 'kuda',
  });

  return {
    customerCashback,
    merchantCommission: roundMoney(kudaMerchantEarning - customerCashback),
    originalMerchantCommission: kudaMerchantEarning,
    platformCommission: roundMoney(kudaTotalCommission - kudaMerchantEarning),
  };
}
