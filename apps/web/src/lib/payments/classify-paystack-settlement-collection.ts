export type PaystackSettlementCollection =
  | {
      mode: 'direct_split';
      subaccountCode: string;
      subaccountShareKobo: number;
      integrationShareKobo: number | null;
      transactionChargeKobo: number | null;
    }
  | { mode: 'integration' }
  | { mode: 'unknown' };

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseKobo(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  }
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const parsed = Number(value.trim());
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  return null;
}

/**
 * Decides, from the verified Paystack transaction payload, whether the sale
 * was split to a merchant subaccount (merchant's bank receives the money
 * directly) or collected into Baci's own Paystack balance. Anything that
 * cannot prove either is `unknown` so callers fail closed.
 */
export function classifyPaystackSettlementCollection(
  gatewayResponse: unknown
): PaystackSettlementCollection {
  const payload = asRecord(gatewayResponse);
  if (!payload || !('subaccount' in payload)) {
    return { mode: 'unknown' };
  }
  const subaccountValue = payload.subaccount;
  if (subaccountValue === null) {
    return { mode: 'integration' };
  }
  const subaccount = asRecord(subaccountValue);
  if (!subaccount) {
    return { mode: 'unknown' };
  }
  const rawCode = subaccount.subaccount_code;
  // Only an absent, null or blank code means "no split". Any other
  // non-string could still name a real subaccount, so fail closed.
  if (
    rawCode !== undefined &&
    rawCode !== null &&
    typeof rawCode !== 'string'
  ) {
    return { mode: 'unknown' };
  }
  const subaccountCode = typeof rawCode === 'string' ? rawCode.trim() : '';
  if (!subaccountCode) {
    return { mode: 'integration' };
  }
  // A named subaccount is not enough: the history row claims the merchant's
  // bank received money, so Paystack's split must show a positive merchant
  // share. Without it the payload proves nothing either way.
  const feesSplit = asRecord(payload.fees_split);
  const subaccountShareKobo = parseKobo(feesSplit?.subaccount);
  if (subaccountShareKobo === null || subaccountShareKobo <= 0) {
    return { mode: 'unknown' };
  }
  const params = asRecord(feesSplit?.params);
  return {
    integrationShareKobo: parseKobo(feesSplit?.integration),
    mode: 'direct_split',
    subaccountCode,
    subaccountShareKobo,
    transactionChargeKobo: parseKobo(params?.transaction_charge),
  };
}
