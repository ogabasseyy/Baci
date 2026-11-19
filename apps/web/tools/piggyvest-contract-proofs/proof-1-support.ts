import { pickString } from './loose-schemas';

/** Fields that differ between two wallets by definition, so they never distinguish the default. */
export const TRIVIALLY_DIFFERENT = new Set([
  'id',
  'created_at',
  'updated_at',
  'virtual_account_id',
  'balance',
  'api_customer_id',
]);

export function position(ids: string[], target: string | null): string | null {
  const index = target ? ids.indexOf(target) : -1;
  if (index < 0) return null;
  if (ids.length === 1) return 'only';
  return `${index === 0 ? 'first' : index === ids.length - 1 ? 'last' : 'middle'}_of_${ids.length}`;
}

export function walletIdsOf(list: { edges: unknown[] } | null): {
  ids: string[];
  edges: unknown[];
} {
  const edges = list?.edges ?? [];
  return {
    edges,
    ids: edges
      .map((edge) => pickString(edge, ['id']))
      .filter((id): id is string => id !== null),
  };
}

export const REPOST_QUESTIONS: ReadonlyArray<readonly [string, string]> = [
  [
    'repost_returns_same_wallet_id',
    'Does the re-POST return the SAME wallet_id as the original create?',
  ],
  [
    'repost_returns_same_customer_id',
    'Does the re-POST return the same customer_id?',
  ],
  [
    'repost_reports_existing_customer',
    'Does the re-POST report new_customer:false?',
  ],
  [
    'create_response_echoes_identifier',
    'Is third_party_identifier echoed in the create response?',
  ],
];
