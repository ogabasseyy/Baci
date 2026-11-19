const KLUMP_TRANSACTION_ID_KEYS = [
    'klump_transaction_id',
    'klumpTransactionId',
    'checkout_transaction_id',
    'checkoutTransactionId',
    'transaction_id',
    'transactionId',
    'tx_ref',
    'txRef',
    'id',
] as const;

export interface SearchParamReader {
    get: (name: string) => string | null;
}

function readSearchParam(
    searchParams: SearchParamReader,
    keys: readonly string[]
) {
    for (const key of keys) {
        const value = searchParams.get(key);
        if (typeof value === 'string' && value.trim()) {
            return value.trim();
        }
    }

    return null;
}

export function getKlumpTransactionId(searchParams: SearchParamReader) {
    return readSearchParam(searchParams, KLUMP_TRANSACTION_ID_KEYS);
}
