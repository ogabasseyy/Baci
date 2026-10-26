const METADATA_FIELDS = [
  'id',
  'product_id',
  'variant_id',
  'title',
  'product_snapshot',
  'target_amount',
  'contribution_amount',
  'contribution_frequency',
  'source_mode',
  'status',
  'maturity_date',
] as const;

export function walletGoalMetadata(row: unknown): string | null {
  if (
    !row ||
    typeof row !== 'object' ||
    !('id' in row) ||
    typeof row.id !== 'string'
  )
    return null;
  const source = row as Record<string, unknown>;
  return JSON.stringify(
    METADATA_FIELDS.map((field) => [field, source[field] ?? null])
  );
}
