export type PaystackSettlementCollection =
  | {
      mode: 'direct_split';
      amountKobo: number;
      subaccountCode: string;
      subaccountShareKobo: number;
      integrationShareKobo: number;
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
  // "No subaccount" only proves Baci collected the money when Paystack's
  // split field says so: fees_split: null (every production Baci-collected
  // payment) or a split whose merchant share is exactly 0. A missing or
  // malformed fees_split, or a positive share, proves nothing.
  const feesSplit = asRecord(payload.fees_split);
  const subaccountShareKobo = parseKobo(feesSplit?.subaccount);
  const splitShowsNoMerchantShare =
    payload.fees_split === null || subaccountShareKobo === 0;
  const integration: PaystackSettlementCollection = splitShowsNoMerchantShare
    ? { mode: 'integration' }
    : { mode: 'unknown' };
  const subaccountValue = payload.subaccount;
  if (subaccountValue === null) {
    return integration;
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
    return integration;
  }
  // A named subaccount is not enough: the history row records what the
  // merchant's bank received, so Paystack's split must state the merchant
  // share, and the split must add up: merchant + Baci + Paystack = amount
  // (true for every production split, card and bank transfer alike). Zero is
  // a valid share (Baci's charge took the whole payment); a missing,
  // malformed or inconsistent split proves nothing either way.
  const integrationShareKobo = parseKobo(feesSplit?.integration);
  const paystackFeeKobo = parseKobo(feesSplit?.paystack);
  const amountKobo = parseKobo(payload.amount);
  if (
    subaccountShareKobo === null ||
    integrationShareKobo === null ||
    paystackFeeKobo === null ||
    amountKobo === null ||
    subaccountShareKobo + integrationShareKobo + paystackFeeKobo !== amountKobo
  ) {
    return { mode: 'unknown' };
  }
  const params = asRecord(feesSplit?.params);
  return {
    amountKobo,
    integrationShareKobo,
    mode: 'direct_split',
    subaccountCode,
    subaccountShareKobo,
    transactionChargeKobo: parseKobo(params?.transaction_charge),
  };
}
