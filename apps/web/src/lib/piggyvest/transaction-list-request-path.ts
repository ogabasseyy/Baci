import { piggyvestTransactionListSchemas } from '@/schemas/piggyvest-transaction-list';

export function isPiggyvestTransactionListRequestPath(
  path: string,
  isCanonicalIdentifier: (identifier: string) => boolean
): boolean {
  const match = /^\/api\/v1\/transaction\?([^#]+)$/.exec(path);
  if (!match) return false;
  const parameters = new URLSearchParams(match[1]);
  if (parameters.toString() !== match[1]) return false;
  const keys = Array.from(parameters.keys());
  if (
    new Set(keys).size !== keys.length ||
    keys.some(
      (key) => !['wallet_id', 'limit', 'collapse_batch', 'cursor'].includes(key)
    )
  )
    return false;
  const wallet = parameters.get('wallet_id');
  const limit = parameters.get('limit');
  if (
    !wallet ||
    !isCanonicalIdentifier(encodeURIComponent(wallet)) ||
    !limit ||
    !/^[1-9]\d{0,2}$/.test(limit) ||
    parameters.get('collapse_batch') !== '0'
  )
    return false;
  return piggyvestTransactionListSchemas.query.safeParse({
    limit: Number(limit),
    ...(parameters.has('cursor') ? { cursor: parameters.get('cursor') } : {}),
  }).success;
}
