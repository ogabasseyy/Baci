import { pickString } from './loose-schemas';

/**
 * Pure helpers that decide what a status / transaction record shows.
 * Candidate field names are broad on purpose: the live run has to tell us
 * which name PiggyVest really uses, and the answer is recorded.
 */

const SOURCE_KEYS = [
  'source_wallet',
  'source_wallet_id',
  'source',
  'sender_wallet',
  'from_wallet',
  'debit_wallet',
] as const;
const DESTINATION_KEYS = [
  'destination_wallet',
  'destination_wallet_id',
  'destination',
  'recipient_wallet',
  'to_wallet',
  'credit_wallet',
] as const;

export interface RecordFacts {
  fieldNames: string[];
  hasAmount: boolean;
  hasCurrency: boolean;
  hasFee: boolean;
  hasStatus: boolean;
  sourceKey: string | null;
  destinationKey: string | null;
  namesSource: boolean | null;
  namesDestination: boolean | null;
  amountMatches: boolean | null;
  feeKobo: number | null;
  currencyIsNgn: boolean | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function firstKey(
  record: Record<string, unknown>,
  candidates: readonly string[]
): string | null {
  return candidates.find((key) => key in record) ?? null;
}

export function analyseRecord(
  data: unknown,
  expected: {
    sourceWalletId: string | null;
    destinationWalletId: string | null;
    amountKobo: number | null;
  }
): RecordFacts {
  const record = asRecord(data) ?? {};
  const names = Object.keys(record);
  const sourceKey = firstKey(record, SOURCE_KEYS);
  const destinationKey = firstKey(record, DESTINATION_KEYS);
  const feeKey = names.find((key) => /(^|_)fee($|s$|_)/i.test(key)) ?? null;
  const fee = feeKey ? record[feeKey] : undefined;
  const currency = pickString(record, ['currency']);
  return {
    fieldNames: names,
    hasAmount: 'amount' in record,
    hasCurrency: 'currency' in record,
    hasFee: feeKey !== null,
    hasStatus: 'status' in record,
    sourceKey,
    destinationKey,
    namesSource:
      sourceKey && expected.sourceWalletId
        ? pickString(record, [sourceKey]) === expected.sourceWalletId
        : sourceKey
          ? null
          : false,
    namesDestination:
      destinationKey && expected.destinationWalletId
        ? pickString(record, [destinationKey]) === expected.destinationWalletId
        : destinationKey
          ? null
          : false,
    amountMatches:
      'amount' in record && expected.amountKobo !== null
        ? record.amount === expected.amountKobo
        : null,
    feeKobo:
      typeof fee === 'number' && Number.isInteger(fee) && fee >= 0 ? fee : null,
    currencyIsNgn: currency === null ? null : currency === 'NGN',
  };
}

export function statusVocabulary(statuses: readonly string[]): string {
  return statuses.join(' > ');
}

export function relationOfCredit(
  grossKobo: number,
  creditedKobo: number | null,
  feeKobo: number | null
): 'gross' | 'net_of_fee' | 'other' | 'unknown' | 'none' {
  if (creditedKobo === null || creditedKobo <= 0) return 'none';
  if (creditedKobo === grossKobo) return 'gross';
  // Without the fee, a credit below the gross cannot be told from "something else".
  if (feeKobo === null) return 'unknown';
  return creditedKobo === grossKobo - feeKobo ? 'net_of_fee' : 'other';
}
